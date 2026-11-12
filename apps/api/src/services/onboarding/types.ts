import type { ItemContext } from '../../models/types.js';
import type { Run } from '../runlog/index.js';

export interface OnboardRequest {
  tenantId: string;
  tagId: string;
  /** Storage key of the uploaded image. Never the bytes. */
  imageKey: string;
  titleOverride?: string;
  artistOverride?: string;
}

/** What an onboarder hands back; the service turns it into item + entry rows. */
export interface OnboardOutcome {
  title: string;
  artist: string | null;
  year: string | null;
  context: ItemContext;
  prompts: string[];
  /** False when the pipeline fell back to generic content. */
  recognized: boolean;
}

/** One per item kind. Runs inside a logged pipeline run. */
export type Onboarder = (run: Run, req: OnboardRequest) => Promise<OnboardOutcome>;
