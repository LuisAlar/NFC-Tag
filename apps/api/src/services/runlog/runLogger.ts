/**
 * Run logger: records every step of a pipeline run so you can see exactly
 * which source answered, which ones missed, what was rejected and why, and
 * what it cost.
 *
 * Usage:
 *
 *   const run = Run.start({
 *     pipeline: { name: 'onboarding', version: '0.1.0' },
 *     subject: { tenantId: 'tenant_01', tagId: 'xK9_2pL9q0' },
 *     trigger: 'first_tap',
 *     sinks: [consoleSink(), jsonlSink('runs/onboarding.jsonl')],
 *   });
 *
 *   const match = await run.waterfall('identify', [
 *     { name: 'identify.vision_web_detection', provider: 'google-vision', run: (ctx) => vision(ctx, image) },
 *     { name: 'identify.museum_search', provider: 'aic', run: (ctx) => museum(ctx, hints) },
 *     { name: 'identify.user_input', kind: 'human', provider: 'user', run: (ctx) => askUser(ctx) },
 *   ], { accept: (m) => m.confidence >= 0.7 || `confidence ${m.confidence} < 0.7` });
 *
 *   await run.finish({ itemId, title: match?.value.title });
 *
 * Design rules:
 * - Logging never breaks the pipeline. Sink failures are caught and warned.
 * - A step that throws is recorded as "error" and returns null; the pipeline
 *   decides what to do next (usually: try the next waterfall rung).
 * - Rejected values are still logged, so you can see what a source returned
 *   and why it was not trusted.
 */

import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { DEFAULT_TRUNCATE, truncate, type TruncateOptions } from './truncate.js';
import type {
  RunEvent,
  RunRecord,
  RunSink,
  RunStatus,
  RunSubject,
  StepKind,
  StepRecord,
  ToolCallRecord,
} from './types.js';

export interface StartRunOptions {
  pipeline: { name: string; version: string };
  subject: RunSubject;
  trigger: string;
  sinks?: RunSink[];
  truncate?: TruncateOptions;
}

export interface StepOptions {
  kind?: StepKind;
  provider?: string;
  /** What the step was asked. Logged (truncated). Never pass image bytes. */
  input?: unknown;
}

export interface WaterfallRung<T> extends StepOptions {
  name: string;
  run: (ctx: StepContext) => Promise<T | null | undefined>;
}

/**
 * Return true to accept a value. Return false, or a string explaining why,
 * to reject it and move on to the next rung.
 */
export type AcceptFn<T> = (value: T, ctx: StepContext) => boolean | string;

export interface WaterfallResult<T> {
  value: T;
  /** Name of the winning step. */
  step: string;
}

/** Handed to every step function so it can annotate its own log record. */
export class StepContext {
  private missed = false;

  constructor(
    private readonly record: StepRecord,
    private readonly truncateOpts: TruncateOptions,
  ) {}

  get stepId(): string {
    return this.record.id;
  }

  /** 0..1. Clamped. */
  confidence(value: number): this {
    this.record.confidence = Math.max(0, Math.min(1, value));
    return this;
  }

  /** Record where a fact came from. Call once per URL the value relies on. */
  source(url: string, label?: string): this {
    this.record.sources.push({ url, label, retrievedAt: new Date().toISOString() });
    return this;
  }

  note(text: string): this {
    this.record.notes.push(text);
    return this;
  }

  cost(units: number, unit: string, usd?: number): this {
    this.record.cost = { units, unit, usd };
    return this;
  }

  cache(state: 'hit' | 'miss'): this {
    this.record.cache = state;
    return this;
  }

  /** Mark this step as a miss even if it returns a value. */
  miss(reason?: string): this {
    this.missed = true;
    if (reason) this.record.notes.push(`miss: ${reason}`);
    return this;
  }

  /**
   * Run and record one tool call. Used inside agent steps so the log shows
   * every tool the model chose, with what input, and why.
   */
  async tool<R>(tool: string, input: unknown, fn: () => Promise<R>, rationale?: string): Promise<R> {
    const call: ToolCallRecord = {
      tool,
      rationale,
      input: truncate(input, this.truncateOpts),
      startedAt: new Date().toISOString(),
      durationMs: 0,
    };
    this.record.toolCalls.push(call);
    const t0 = performance.now();
    try {
      const out = await fn();
      call.output = truncate(out, this.truncateOpts);
      return out;
    } catch (err) {
      call.error = errorMessage(err);
      throw err;
    } finally {
      call.durationMs = round(performance.now() - t0);
    }
  }

  /** @internal */
  wasMarkedMiss(): boolean {
    return this.missed;
  }
}

export class Run {
  private readonly record: RunRecord;
  private readonly sinks: RunSink[];
  private readonly truncateOpts: TruncateOptions;
  private readonly t0 = performance.now();
  private seq = 0;
  private finished = false;

  private constructor(opts: StartRunOptions) {
    this.sinks = opts.sinks ?? [];
    this.truncateOpts = opts.truncate ?? DEFAULT_TRUNCATE;
    this.record = {
      schemaVersion: 1,
      runId: randomUUID(),
      pipeline: opts.pipeline,
      subject: opts.subject,
      trigger: opts.trigger,
      status: 'running',
      startedAt: new Date().toISOString(),
      steps: [],
      waterfalls: {},
      totals: { steps: 0, hits: 0, misses: 0, errors: 0, skipped: 0, toolCalls: 0, usd: 0 },
    };
  }

  static start(opts: StartRunOptions): Run {
    const run = new Run(opts);
    run.emit({ type: 'run_started', run: run.snapshot() });
    return run;
  }

  get id(): string {
    return this.record.runId;
  }

  /** Attach ids learned mid-run, e.g. the item id created after identification. */
  setSubject(patch: Partial<RunSubject>): void {
    Object.assign(this.record.subject, patch);
  }

  /**
   * Run one step. Returns the value on a hit, null on a miss or error.
   * Returning null/undefined from fn counts as a miss.
   */
  async step<T>(name: string, opts: StepOptions, fn: (ctx: StepContext) => Promise<T | null | undefined>): Promise<T | null> {
    return this.runStep(name, opts, fn);
  }

  /**
   * Try each rung in order and stop at the first accepted value. Rungs after
   * the winner are recorded as "skipped" so the log shows the whole ladder.
   */
  async waterfall<T>(
    name: string,
    rungs: WaterfallRung<T>[],
    opts: { accept?: AcceptFn<T> } = {},
  ): Promise<WaterfallResult<T> | null> {
    const total = rungs.length;
    let winner: WaterfallResult<T> | null = null;
    let tried = 0;

    for (let i = 0; i < rungs.length; i++) {
      const rung = rungs[i];
      const position = { name, rung: i + 1, of: total };

      if (winner) {
        this.recordSkipped(rung.name, rung, position, `waterfall "${name}" already won at ${winner.step}`);
        continue;
      }

      tried++;
      const value = await this.runStep(rung.name, rung, rung.run, opts.accept, position);
      if (value !== null) winner = { value, step: rung.name };
    }

    this.record.waterfalls[name] = {
      winner: winner?.step,
      rungsTried: tried,
      rungsTotal: total,
      outcome: winner ? 'hit' : 'exhausted',
    };
    return winner;
  }

  /** Record a step that was deliberately not run. */
  skip(name: string, opts: StepOptions, reason: string): void {
    this.recordSkipped(name, opts, undefined, reason);
  }

  /**
   * Close the run and flush it to every sink. Status is derived unless given:
   * a non-null result with no errors is "succeeded", with errors "partial",
   * and no result is "failed".
   */
  async finish(result?: unknown, status?: RunStatus): Promise<RunRecord> {
    if (this.finished) return this.snapshot();
    this.finished = true;

    this.record.finishedAt = new Date().toISOString();
    this.record.durationMs = round(performance.now() - this.t0);
    this.record.result = result === undefined ? undefined : truncate(result, this.truncateOpts);
    this.computeTotals();

    const hasResult = result !== undefined && result !== null;
    this.record.status =
      status ?? (hasResult ? (this.record.totals.errors > 0 ? 'partial' : 'succeeded') : 'failed');

    const snap = this.snapshot();
    await this.emit({ type: 'run_finished', run: snap });
    for (const sink of this.sinks) {
      try {
        await sink.onFinish(snap);
      } catch (err) {
        console.warn(`[runlog] sink onFinish failed: ${errorMessage(err)}`);
      }
    }
    return snap;
  }

  /** A deep copy of the current record, safe to serialize or hand out. */
  snapshot(): RunRecord {
    return structuredClone(this.record);
  }

  // ---------------------------------------------------------------------------

  private async runStep<T>(
    name: string,
    opts: StepOptions,
    fn: (ctx: StepContext) => Promise<T | null | undefined>,
    accept?: AcceptFn<T>,
    waterfall?: StepRecord['waterfall'],
  ): Promise<T | null> {
    const rec = this.newStep(name, opts, waterfall);
    const ctx = new StepContext(rec, this.truncateOpts);
    await this.emit({ type: 'step_started', runId: this.record.runId, step: structuredClone(rec) });

    const t0 = performance.now();
    let result: T | null = null;

    try {
      const value = await fn(ctx);
      if (value === null || value === undefined) {
        rec.status = 'miss';
      } else {
        rec.output = truncate(value, this.truncateOpts);
        const verdict = accept ? accept(value, ctx) : true;
        if (ctx.wasMarkedMiss()) {
          rec.status = 'miss';
        } else if (verdict === true) {
          rec.status = 'hit';
          result = value;
        } else {
          rec.status = 'miss';
          rec.notes.push(`rejected: ${typeof verdict === 'string' ? verdict : 'accept() returned false'}`);
        }
      }
    } catch (err) {
      rec.status = 'error';
      rec.error = { message: errorMessage(err), code: errorCode(err) };
    } finally {
      rec.durationMs = round(performance.now() - t0);
    }

    await this.emit({ type: 'step_finished', runId: this.record.runId, step: structuredClone(rec) });
    return result;
  }

  private recordSkipped(name: string, opts: StepOptions, waterfall: StepRecord['waterfall'], reason: string): void {
    const rec = this.newStep(name, opts, waterfall);
    rec.status = 'skipped';
    rec.durationMs = 0;
    rec.notes.push(reason);
    void this.emit({ type: 'step_finished', runId: this.record.runId, step: structuredClone(rec) });
  }

  private newStep(name: string, opts: StepOptions, waterfall?: StepRecord['waterfall']): StepRecord {
    this.seq++;
    const rec: StepRecord = {
      id: `s${String(this.seq).padStart(2, '0')}`,
      name,
      kind: opts.kind ?? 'code',
      provider: opts.provider,
      waterfall,
      status: 'running',
      input: opts.input === undefined ? undefined : truncate(opts.input, this.truncateOpts),
      sources: [],
      toolCalls: [],
      notes: [],
      startedAt: new Date().toISOString(),
    };
    this.record.steps.push(rec);
    return rec;
  }

  private computeTotals(): void {
    const t = { steps: 0, hits: 0, misses: 0, errors: 0, skipped: 0, toolCalls: 0, usd: 0 };
    for (const s of this.record.steps) {
      t.steps++;
      if (s.status === 'hit') t.hits++;
      else if (s.status === 'miss') t.misses++;
      else if (s.status === 'error') t.errors++;
      else if (s.status === 'skipped') t.skipped++;
      t.toolCalls += s.toolCalls.length;
      t.usd += s.cost?.usd ?? 0;
    }
    t.usd = Math.round(t.usd * 1e6) / 1e6;
    this.record.totals = t;
  }

  private async emit(event: RunEvent): Promise<void> {
    for (const sink of this.sinks) {
      if (!sink.onEvent) continue;
      try {
        await sink.onEvent(event);
      } catch (err) {
        console.warn(`[runlog] sink onEvent failed: ${errorMessage(err)}`);
      }
    }
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function errorCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: unknown }).code;
    return code === undefined ? undefined : String(code);
  }
  return undefined;
}

function round(ms: number): number {
  return Math.round(ms * 10) / 10;
}
