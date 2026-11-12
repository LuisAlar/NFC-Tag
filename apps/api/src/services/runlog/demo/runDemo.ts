/**
 * Runs the onboarding pipeline twice with fake providers and logs both runs
 * to the console and to runs/onboarding.jsonl.
 *
 *   npm run demo            # both scenarios
 *   npm run demo -- thrift  # one scenario
 *   npm run demo -- --live  # print steps as they finish
 */

import { Run, consoleSink, jsonlSink } from '../index.js';
import { fakeProviders, type Scenario } from '../../providers/fake.js';
import { onboard } from '../../onboarding/pipeline.js';

const LOG_PATH = process.env.RUNLOG_PATH ?? 'runs/onboarding.jsonl';

const args = process.argv.slice(2);
const live = args.includes('--live');
const requested = args.filter((a) => !a.startsWith('--')) as Scenario[];
const scenarios: Scenario[] = requested.length ? requested : ['famous', 'thrift'];

const sinks = [consoleSink({ live }), jsonlSink(LOG_PATH)];

for (const scenario of scenarios) {
  const run = Run.start({
    pipeline: { name: 'onboarding', version: '0.1.0' },
    subject: { tenantId: 'tenant_01', tagId: `demo_${scenario}` },
    trigger: 'first_tap',
    sinks,
  });

  const result = await onboard(run, fakeProviders(scenario), {
    imageKey: `tenants/tenant_01/uploads/${scenario}.jpg`,
    hint: scenario === 'thrift' ? 'river landscape, signed lower right' : undefined,
  });

  if (result) run.setSubject({ itemId: `item_${scenario}` });
  await run.finish(result);
}

console.log(`Runs appended to ${LOG_PATH}. View them with: npm run runs -- --stats`);
