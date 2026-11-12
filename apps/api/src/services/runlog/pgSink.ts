/**
 * Writes finished runs to the pipeline_runs table (migration 002). This is
 * the run log on Vercel, where there is no persistent disk for JSONL.
 * One INSERT per onboarding; it only fires on finish, never per step.
 */

import type { Repo } from '../../db/repo.js';
import type { RunSink } from './types.js';

export function pgSink(repo: Repo): RunSink {
  return {
    async onFinish(run) {
      await repo.insertRun(run);
    },
  };
}
