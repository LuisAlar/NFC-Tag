# Run log

Records every step of a pipeline run: which source was tried, whether it hit, missed or errored, what it returned, why a value was rejected, which tools an agent called, where each fact came from, how long it took and what it cost.

It's the "raw recognition data" layer from `docs/data-model.md`, generalized so every pipeline (onboarding now, others later) logs the same way.

## Quick start

```bash
cd apps/api
npm install
npm run demo                 # runs the onboarding pipeline with fake providers
npm run runs                 # tree view of the last 5 runs
npm run runs -- --stats      # hit rates, latency and cost per step
npm test
```

Runs are appended to `runs/onboarding.jsonl` (one JSON object per line). Set `RUNLOG_PATH` to change it.

## Vocabulary

| Term | Meaning |
| --- | --- |
| Run | One execution of a pipeline for one subject (one painting's onboarding). |
| Step | One attempt to get one thing from one source. |
| Waterfall | Ordered steps for the same thing; stop at the first accepted value. |
| Kind | `code` (plain API/code), `llm` (one model call), `agent` (model tool loop), `human` (user typed it). |
| Status | `hit`, `miss` (ran fine, nothing usable or rejected), `error` (threw), `skipped` (not needed). |
| Source | URL a value came from. The provenance check drops facts without one. |

## Using it

```ts
import { Run, consoleSink, jsonlSink } from './services/runlog/index.js';

const run = Run.start({
  pipeline: { name: 'onboarding', version: '0.1.0' },
  subject: { tenantId, tagId },
  trigger: 'first_tap',
  sinks: [consoleSink(), jsonlSink('runs/onboarding.jsonl')],
});

// A single step. Return a value for a hit, null for a miss; throwing is an error.
const summary = await run.step('context.wikipedia_summary', { provider: 'wikipedia-rest', input: { title } }, async (ctx) => {
  const res = await fetchSummary(title);
  if (!res) return null;
  ctx.source(res.url).cache('miss');
  return res;
});

// A waterfall. Rejected values are still logged with the reason.
const id = await run.waterfall('identify', rungs, {
  accept: (m) => m.confidence >= 0.7 || `confidence ${m.confidence} < 0.7`,
});

// Inside an agent step, wrap each tool call so the log shows the model's choices.
await ctx.tool('wikipedia_search', { query }, () => search(query), 'why the model called it');

await run.finish(result); // derives succeeded / partial / failed and flushes sinks
```

## Files

- `types.ts`: the record shapes (`RunRecord`, `StepRecord`, …). Start here.
- `runLogger.ts`: `Run` and `StepContext`.
- `sinks.ts`: console, JSONL and in-memory sinks, plus `formatRun`.
- `truncate.ts`: keeps payloads readable; never logs image bytes.
- `showRuns.ts`: CLI over the JSONL file.
- `demo/`: runs the onboarding pipeline (`../onboarding/pipeline.ts`) with the fakes in `../providers/fake.ts`.
- `../../db/migrations/002_pipeline_runs.sql`: Postgres table for when the database exists.

## Next

1. Replace fake providers one at a time with real ones (`services/providers/fake.ts` → `services/providers/*`). The pipeline and log don't change.
Done: `pgSink.ts` writes every run to `pipeline_runs`, and each item stores its `run_id` in `raw_recognition_data`.
