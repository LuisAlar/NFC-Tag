/**
 * Artwork onboarder: runs the identify -> context -> prompts pipeline and
 * turns its result into the item fields the API stores.
 */

import type { Run } from '../runlog/index.js';
import type { ItemContext } from '../../models/types.js';
import { onboard, type Providers } from './pipeline.js';
import type { Onboarder, OnboardRequest } from './types.js';

/** Used when the pipeline can't identify the work (Flow A: "Continue" with generic questions). */
export const GENERIC_ART_PROMPTS = [
  'What made you stop and pick this piece up?',
  'If this scene were a place you could visit, what would you hear there?',
  'Where will it hang, and why there?',
];

/**
 * The pipeline's last identify rung is "ask the user". Over HTTP that answer
 * arrives up front as title_override / artist_override, so wire it in here.
 */
function withUserAnswer(base: Providers, req: OnboardRequest): Providers {
  return {
    ...base,
    async askUser(ctx) {
      if (!req.titleOverride) {
        ctx.note('no manual title supplied with the upload');
        return null;
      }
      ctx.confidence(1).note('title supplied with the upload');
      return {
        title: req.titleOverride,
        artist: req.artistOverride,
        confidence: 1,
        candidates: [],
        via: 'user',
      };
    },
  };
}

export function artworkOnboarder(providers: Providers): Onboarder {
  return async (run: Run, req: OnboardRequest) => {
    const result = await onboard(run, withUserAnswer(providers, req), {
      imageKey: req.imageKey,
      hint: req.titleOverride,
    });

    const facts = result?.context.facts ?? {};
    const context: ItemContext = {
      summary: facts.summary?.value ?? '',
      source_url: facts.summary?.sourceUrl ?? facts.title?.sourceUrl,
      year: facts.year?.value,
      facts,
      inferred: result?.context.inferred ?? {},
    };

    // Manual overrides win over recognition: the owner is looking at the painting.
    return {
      title: req.titleOverride ?? result?.title ?? 'Untitled',
      artist: req.artistOverride ?? result?.artist ?? null,
      year: facts.year?.value ?? null,
      context,
      prompts: result?.prompts.length ? result.prompts : GENERIC_ART_PROMPTS,
      recognized: Boolean(result),
    };
  };
}
