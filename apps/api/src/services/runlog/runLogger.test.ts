import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Run, memorySink, truncate } from './index.js';

const start = (sink = memorySink()) => ({
  sink,
  run: Run.start({
    pipeline: { name: 'test', version: '0' },
    subject: { tenantId: 't1' },
    trigger: 'test',
    sinks: [sink],
  }),
});

test('step: value is a hit, null is a miss, throw is an error', async () => {
  const { run, sink } = start();
  assert.equal(await run.step('a', {}, async () => 42), 42);
  assert.equal(await run.step('b', {}, async () => null), null);
  assert.equal(await run.step('c', {}, async () => { throw new Error('boom'); }), null);
  await run.finish({ ok: true });

  const rec = sink.runs[0];
  assert.deepEqual(rec.steps.map((s) => s.status), ['hit', 'miss', 'error']);
  assert.equal(rec.steps[2].error?.message, 'boom');
  assert.equal(rec.status, 'partial');
  assert.deepEqual(
    { hits: rec.totals.hits, misses: rec.totals.misses, errors: rec.totals.errors },
    { hits: 1, misses: 1, errors: 1 },
  );
});

test('waterfall: stops at the first accepted rung, logs rejections and skips', async () => {
  const { run, sink } = start();
  const result = await run.waterfall<{ conf: number }>(
    'identify',
    [
      { name: 'r1', run: async () => ({ conf: 0.3 }) },
      { name: 'r2', run: async () => { throw new Error('timeout'); } },
      { name: 'r3', run: async () => ({ conf: 0.9 }) },
      { name: 'r4', run: async () => ({ conf: 1 }) },
    ],
    { accept: (v) => v.conf >= 0.7 || `conf ${v.conf} too low` },
  );
  await run.finish(result);

  assert.equal(result?.step, 'r3');
  const rec = sink.runs[0];
  assert.deepEqual(rec.steps.map((s) => s.status), ['miss', 'error', 'hit', 'skipped']);
  assert.match(rec.steps[0].notes[0], /rejected: conf 0.3 too low/);
  assert.deepEqual(rec.steps[0].output, { conf: 0.3 }, 'rejected output is still logged');
  assert.deepEqual(rec.waterfalls.identify, { winner: 'r3', rungsTried: 3, rungsTotal: 4, outcome: 'hit' });
});

test('waterfall: exhausted when nothing is accepted; run fails without a result', async () => {
  const { run, sink } = start();
  const result = await run.waterfall('w', [{ name: 'only', run: async () => null }]);
  await run.finish(result);
  assert.equal(result, null);
  assert.equal(sink.runs[0].waterfalls.w.outcome, 'exhausted');
  assert.equal(sink.runs[0].status, 'failed');
});

test('ctx annotations: tool calls, sources, cost, ctx.miss', async () => {
  const { run, sink } = start();
  await run.step('agent', { kind: 'agent' }, async (ctx) => {
    await ctx.tool('search', { q: 'x' }, async () => ['a'], 'find pages');
    ctx.source('https://example.org/a').cost(100, 'tokens', 0.01).confidence(1.7);
    return 'a';
  });
  await run.step('forced', {}, async (ctx) => {
    ctx.miss('looked fine but was a placeholder');
    return 'placeholder';
  });
  await run.finish('done');

  const [agent, forced] = sink.runs[0].steps;
  assert.equal(agent.toolCalls[0].rationale, 'find pages');
  assert.deepEqual(agent.toolCalls[0].output, ['a']);
  assert.equal(agent.confidence, 1, 'confidence is clamped');
  assert.equal(sink.runs[0].totals.usd, 0.01);
  assert.equal(forced.status, 'miss');
});

test('a failing sink never breaks the pipeline', async () => {
  const run = Run.start({
    pipeline: { name: 'test', version: '0' },
    subject: { tenantId: 't1' },
    trigger: 'test',
    sinks: [{ onEvent() { throw new Error('sink down'); }, onFinish() { throw new Error('sink down'); } }],
  });
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await run.step('a', {}, async () => 1), 1);
    const rec = await run.finish(1);
    assert.equal(rec.status, 'succeeded');
  } finally {
    console.warn = warn;
  }
});

test('truncate: long strings, big arrays, binary and data URIs', () => {
  const out = truncate(
    { s: 'x'.repeat(1500), arr: Array.from({ length: 30 }, (_, i) => i), bin: Buffer.alloc(2048), img: `data:image/png;base64,${'A'.repeat(500)}` },
  ) as Record<string, unknown>;
  assert.match(out.s as string, /\[\+500 chars\]$/);
  assert.equal((out.arr as unknown[]).length, 21);
  assert.equal(out.bin, '[binary, 2048 bytes omitted]');
  assert.match(out.img as string, /^\[data URI/);
});
