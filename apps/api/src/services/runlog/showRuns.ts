/**
 * Reads runs from a JSONL file and prints them.
 *
 *   npm run runs                    # last 5 runs as trees
 *   npm run runs -- --last 20       # last 20
 *   npm run runs -- --verbose       # include each step's output
 *   npm run runs -- --stats         # per-step hit rates, latency, cost
 *   npm run runs -- --failed        # only failed or partial runs
 *   npm run runs -- --file path.jsonl
 *
 * --stats is the view that tells you which tools to build or fix next:
 * a step that misses most of the time, or a waterfall rung that never wins,
 * is where the work is.
 */

import { readFile } from 'node:fs/promises';
import { formatRun } from './sinks.js';
import type { RunRecord, StepStatus } from './types.js';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const file = opt('file') ?? process.env.RUNLOG_PATH ?? 'runs/onboarding.jsonl';
const last = Number(opt('last') ?? 5);

let raw: string;
try {
  raw = await readFile(file, 'utf8');
} catch {
  console.error(`No run log at ${file}. Run "npm run demo" first.`);
  process.exit(1);
}

const runs: RunRecord[] = [];
raw.split('\n').forEach((line, i) => {
  if (!line.trim()) return;
  try {
    runs.push(JSON.parse(line));
  } catch {
    console.warn(`skipping malformed line ${i + 1}`);
  }
});

let selected = runs;
if (flag('failed')) selected = selected.filter((r) => r.status !== 'succeeded');

if (flag('stats')) {
  printStats(selected);
} else {
  for (const run of selected.slice(-last)) {
    console.log(`${formatRun(run, { verbose: flag('verbose') })}\n`);
  }
  console.log(`${Math.min(last, selected.length)} of ${selected.length} runs shown from ${file}`);
}

function printStats(rs: RunRecord[]): void {
  const byStatus: Record<string, number> = {};
  for (const r of rs) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;

  type Agg = { name: string; counts: Record<StepStatus, number>; ms: number[]; usd: number };
  const steps = new Map<string, Agg>();
  const wins = new Map<string, Map<string, number>>();

  for (const r of rs) {
    for (const s of r.steps) {
      const a =
        steps.get(s.name) ??
        { name: s.name, counts: { running: 0, hit: 0, miss: 0, error: 0, skipped: 0 }, ms: [], usd: 0 };
      a.counts[s.status]++;
      if (s.status !== 'skipped' && s.durationMs !== undefined) a.ms.push(s.durationMs);
      a.usd += s.cost?.usd ?? 0;
      steps.set(s.name, a);
    }
    for (const [wf, summary] of Object.entries(r.waterfalls)) {
      const m = wins.get(wf) ?? new Map<string, number>();
      const key = summary.winner ?? '(exhausted)';
      m.set(key, (m.get(key) ?? 0) + 1);
      wins.set(wf, m);
    }
  }

  const totalUsd = rs.reduce((sum, r) => sum + r.totals.usd, 0);
  console.log(`${rs.length} runs · ${Object.entries(byStatus).map(([k, v]) => `${v} ${k}`).join(' · ')} · $${totalUsd.toFixed(4)} total\n`);

  const rows = [...steps.values()].map((a) => {
    const ran = a.counts.hit + a.counts.miss + a.counts.error;
    const sorted = [...a.ms].sort((x, y) => x - y);
    const p50 = sorted.length ? sorted[Math.floor((sorted.length - 1) * 0.5)] : 0;
    const p95 = sorted.length ? sorted[Math.floor((sorted.length - 1) * 0.95)] : 0;
    return {
      step: a.name,
      ran,
      'hit %': ran ? `${Math.round((a.counts.hit / ran) * 100)}%` : '-',
      miss: a.counts.miss,
      err: a.counts.error,
      skip: a.counts.skipped,
      'p50 ms': Math.round(p50),
      'p95 ms': Math.round(p95),
      usd: a.usd.toFixed(4),
    };
  });
  console.table(rows);

  console.log('\nWaterfall winners');
  for (const [wf, m] of wins) {
    const total = [...m.values()].reduce((x, y) => x + y, 0);
    const parts = [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, n]) => `${name} ${Math.round((n / total) * 100)}%`);
    console.log(`  ${wf}: ${parts.join(' · ')}`);
  }
}
