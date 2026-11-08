/**
 * Run log types.
 *
 * A "run" is one execution of a pipeline for one subject (e.g. onboarding
 * one painting). A run is made of "steps". Each step is one attempt to get
 * one piece of information from one source: a Vision call, a Wikipedia
 * lookup, an LLM decision, or the user typing a title in by hand.
 *
 * This mirrors how a Clay table row works: every cell records which
 * provider was tried, whether it returned something, and what it cost.
 */

/** What kind of work a step does. Used to keep LLM output separate from facts. */
export type StepKind =
  | 'code' // deterministic code or a plain API call (Vision, Wikipedia, Wikidata)
  | 'llm' // a single model call (e.g. generate journaling prompts)
  | 'agent' // a model running a tool loop (e.g. resolve an ambiguous match)
  | 'human'; // the user supplied the value (manual title entry, retake)

/**
 * hit     - the step produced a usable value
 * miss    - the step ran fine but found nothing usable (or the value was rejected)
 * error   - the step threw (network failure, quota, bad response)
 * skipped - the step was not needed (an earlier waterfall rung already hit)
 */
export type StepStatus = 'running' | 'hit' | 'miss' | 'error' | 'skipped';

/**
 * succeeded - the pipeline produced a result and no step errored
 * partial   - a result exists but at least one step errored along the way
 * failed    - no result
 */
export type RunStatus = 'running' | 'succeeded' | 'partial' | 'failed';

/** Where a fact came from. Every stored fact should trace back to one of these. */
export interface SourceRef {
  url: string;
  label?: string;
  retrievedAt: string;
}

/** One tool call made inside an agent step. */
export interface ToolCallRecord {
  tool: string;
  /** Why the agent called this tool. Cheap to ask for, very useful when debugging. */
  rationale?: string;
  input: unknown;
  output?: unknown;
  error?: string;
  startedAt: string;
  durationMs: number;
}

export interface StepCost {
  /** e.g. 1 Vision request, 1840 LLM tokens */
  units: number;
  unit: string;
  /** Optional dollar estimate, summed into run totals. */
  usd?: number;
}

export interface StepRecord {
  /** Run-scoped sequential id, e.g. "s03". */
  id: string;
  /** Dotted name: "<stage>.<source>", e.g. "identify.vision_web_detection". */
  name: string;
  kind: StepKind;
  /** Who answered: "google-vision", "wikipedia-rest", "anthropic:<model>", "user". */
  provider?: string;
  /** Set when the step is one rung of a waterfall. rung is 1-based. */
  waterfall?: { name: string; rung: number; of: number };
  status: StepStatus;
  input?: unknown;
  output?: unknown;
  /** 0..1, when the source gives one or the code computes one. */
  confidence?: number;
  sources: SourceRef[];
  toolCalls: ToolCallRecord[];
  notes: string[];
  cache?: 'hit' | 'miss';
  cost?: StepCost;
  error?: { message: string; code?: string };
  startedAt: string;
  durationMs?: number;
}

export interface WaterfallSummary {
  /** Name of the step that won, if any. */
  winner?: string;
  rungsTried: number;
  rungsTotal: number;
  outcome: 'hit' | 'exhausted';
}

export interface RunSubject {
  tenantId: string;
  tagId?: string;
  itemId?: string;
}

export interface RunRecord {
  schemaVersion: 1;
  runId: string;
  pipeline: { name: string; version: string };
  subject: RunSubject;
  /** What started the run: "first_tap", "manual_rerun", "backfill". */
  trigger: string;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  steps: StepRecord[];
  waterfalls: Record<string, WaterfallSummary>;
  result?: unknown;
  totals: {
    steps: number;
    hits: number;
    misses: number;
    errors: number;
    skipped: number;
    toolCalls: number;
    usd: number;
  };
}

/** Events emitted while a run is in progress, so a sink can stream them live. */
export type RunEvent =
  | { type: 'run_started'; run: RunRecord }
  | { type: 'step_started'; runId: string; step: StepRecord }
  | { type: 'step_finished'; runId: string; step: StepRecord }
  | { type: 'run_finished'; run: RunRecord };

/** Anywhere a run can be written: console, a JSONL file, Postgres, etc. */
export interface RunSink {
  onEvent?(event: RunEvent): void | Promise<void>;
  onFinish(run: RunRecord): void | Promise<void>;
}
