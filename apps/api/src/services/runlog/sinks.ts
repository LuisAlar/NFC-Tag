/**
 * Sinks decide where finished runs go. Start with the console and a JSONL
 * file; Postgres goes through pgSink.ts (table from
 * src/db/migrations/002_pipeline_runs.sql).
 */

import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { RunRecord, RunSink, StepRecord, StepStatus } from './types.js';

// -- Console -----------------------------------------------------------------

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: number) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const c = {
  dim: paint(2),
  bold: paint(1),
  green: paint(32),
  yellow: paint(33),
  red: paint(31),
  cyan: paint(36),
  magenta: paint(35),
};

const STATUS_MARK: Record<StepStatus, string> = {
  running: c.cyan('…'),
  hit: c.green('✓ hit '),
  miss: c.yellow('· miss'),
  error: c.red('✗ err '),
  skipped: c.dim('– skip'),
};

/** Human-readable tree view of one run. Also used by the show-runs CLI. */
export function formatRun(run: RunRecord, opts: { verbose?: boolean } = {}): string {
  const lines: string[] = [];
  const statusColor =
    run.status === 'succeeded' ? c.green : run.status === 'partial' ? c.yellow : c.red;

  lines.push(
    `${c.bold(`${run.pipeline.name}@${run.pipeline.version}`)}  ${statusColor(run.status.toUpperCase())}  ` +
      c.dim(`run ${run.runId.slice(0, 8)} · ${run.trigger} · ${run.durationMs ?? '?'}ms · ${run.startedAt}`),
  );
  const subj = Object.entries(run.subject)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  lines.push(c.dim(`  subject: ${subj}`));

  let currentWaterfall: string | undefined;
  for (const step of run.steps) {
    const wf = step.waterfall?.name;
    if (wf && wf !== currentWaterfall) {
      const summary = run.waterfalls[wf];
      const tag = summary
        ? summary.outcome === 'hit'
          ? c.green(`won by ${summary.winner}`)
          : c.red('exhausted')
        : '';
      lines.push(`  ${c.magenta(`▸ waterfall ${wf}`)}  ${tag}`);
    }
    currentWaterfall = wf;
    lines.push(...formatStep(step, wf ? '    ' : '  ', opts.verbose));
  }

  const t = run.totals;
  lines.push(
    c.dim(
      `  totals: ${t.steps} steps · ${t.hits} hit · ${t.misses} miss · ${t.errors} err · ` +
        `${t.skipped} skip · ${t.toolCalls} tool calls · $${t.usd.toFixed(4)}`,
    ),
  );
  if (run.result !== undefined) {
    lines.push(c.dim(`  result: ${oneLine(run.result, 160)}`));
  }
  return lines.join('\n');
}

function formatStep(step: StepRecord, indent: string, verbose = false): string[] {
  const lines: string[] = [];
  const rung = step.waterfall ? c.dim(`[${step.waterfall.rung}/${step.waterfall.of}] `) : '';
  const meta = [
    step.kind !== 'code' ? step.kind : undefined,
    step.provider,
    step.durationMs !== undefined ? `${step.durationMs}ms` : undefined,
    step.confidence !== undefined ? `conf ${step.confidence.toFixed(2)}` : undefined,
    step.cache ? `cache ${step.cache}` : undefined,
    step.cost?.usd !== undefined ? `$${step.cost.usd.toFixed(4)}` : undefined,
  ]
    .filter(Boolean)
    .join(' · ');

  lines.push(`${indent}${STATUS_MARK[step.status]} ${rung}${step.name}  ${c.dim(meta)}`);

  const sub = `${indent}    `;
  if (step.error) lines.push(`${sub}${c.red(`error: ${step.error.message}`)}`);
  for (const n of step.notes) lines.push(`${sub}${c.dim(n)}`);
  for (const call of step.toolCalls) {
    const why = call.rationale ? c.dim(` — ${call.rationale}`) : '';
    const err = call.error ? c.red(` ✗ ${call.error}`) : '';
    lines.push(`${sub}${c.cyan('⚙')} ${call.tool}(${oneLine(call.input, 60)})${why}${err}`);
  }
  for (const s of step.sources) lines.push(`${sub}${c.dim(`↳ ${s.url}`)}`);
  if (verbose && step.output !== undefined) lines.push(`${sub}${c.dim(`out: ${oneLine(step.output, 200)}`)}`);
  return lines;
}

function oneLine(value: unknown, max: number): string {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  if (!s) return String(s);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * Prints each run when it finishes. With live: true, also prints each step
 * as it completes, which is handy while a slow external API is running.
 */
export function consoleSink(opts: { live?: boolean; verbose?: boolean } = {}): RunSink {
  return {
    onEvent(event) {
      if (!opts.live || event.type !== 'step_finished') return;
      console.log(formatStep(event.step, c.dim(`[${event.runId.slice(0, 8)}] `), opts.verbose).join('\n'));
    },
    onFinish(run) {
      console.log(`\n${formatRun(run, opts)}\n`);
    },
  };
}

// -- JSONL file --------------------------------------------------------------

/**
 * Appends one JSON line per finished run. Easy to grep, tail, or load into
 * DuckDB / pandas later to answer "which source wins most often?"
 */
export function jsonlSink(path: string): RunSink {
  let ready: Promise<unknown> | undefined;
  return {
    async onFinish(run) {
      ready ??= mkdir(dirname(path), { recursive: true });
      await ready;
      await appendFile(path, `${JSON.stringify(run)}\n`, 'utf8');
    },
  };
}

// -- Memory ------------------------------------------------------------------

/** Keeps runs in an array. Use in tests to assert on what was logged. */
export function memorySink(): RunSink & { runs: RunRecord[] } {
  const runs: RunRecord[] = [];
  return {
    runs,
    onFinish(run) {
      runs.push(run);
    },
  };
}
