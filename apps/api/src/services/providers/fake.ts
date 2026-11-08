/**
 * Fake providers with canned responses and small random delays, so the
 * logger can be exercised without API keys. Replace these one at a time with
 * real implementations of the Providers interface.
 *
 * Scenario "famous": a well-known painting. Vision recognizes it, but two
 *   paintings share the title, so the resolve agent has to pick one.
 * Scenario "thrift": an unknown thrift-store painting. Vision only finds
 *   generic labels, the museum API times out, and the user types the title.
 */

import type { Candidate, Fact, Identification, Providers } from '../onboarding/pipeline.js';

export type Scenario = 'famous' | 'thrift';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (base: number) => sleep(base + Math.random() * base * 0.5);

const MILLET: Candidate = {
  title: 'The Gleaners',
  artist: 'Jean-François Millet',
  wikipediaUrl: 'https://en.wikipedia.org/wiki/The_Gleaners',
  confidence: 0.91,
};
const BRETON: Candidate = {
  title: 'The Gleaners (Breton)',
  artist: 'Jules Breton',
  wikipediaUrl: 'https://en.wikipedia.org/wiki/Jules_Breton',
  confidence: 0.84,
};

export function fakeProviders(scenario: Scenario): Providers {
  return {
    async vision(ctx) {
      await jitter(120);
      ctx.cost(1, 'vision_request', 0.0035);
      if (scenario === 'famous') {
        ctx.confidence(MILLET.confidence);
        ctx.source(MILLET.wikipediaUrl!, 'pagesWithMatchingImages');
        return {
          title: MILLET.title,
          artist: MILLET.artist,
          confidence: MILLET.confidence,
          candidates: [MILLET, BRETON],
          via: 'vision',
        } satisfies Identification;
      }
      ctx.confidence(0.42);
      ctx.note('only generic web entities: "Landscape" (0.42), "Painting" (0.40)');
      return { title: 'Landscape', confidence: 0.42, candidates: [], via: 'vision' };
    },

    async museumSearch() {
      await jitter(200);
      const err = new Error('artic-api: request timed out after 3000ms');
      (err as Error & { code: string }).code = 'ETIMEDOUT';
      throw err;
    },

    async askUser(ctx) {
      await jitter(40);
      ctx.confidence(1);
      ctx.note('user typed title and read the signature');
      return {
        title: 'River at Dusk',
        artist: 'R. Alvarez',
        confidence: 1,
        candidates: [],
        via: 'user',
      };
    },

    async resolveAgent(ctx, id) {
      // A real version runs a model tool loop; here we replay what one would do.
      const results = await ctx.tool(
        'wikipedia_search',
        { query: `${id.title} painting` },
        async () => {
          await jitter(90);
          return [MILLET.title, BRETON.title];
        },
        'two candidates within the ambiguity margin; list pages with this title',
      );
      await ctx.tool(
        'wikipedia_summary',
        { title: results[0] },
        async () => {
          await jitter(80);
          return { extract: 'Oil painting by Jean-François Millet, completed in 1857…' };
        },
        'check whether the top result names the artist Vision detected',
      );
      ctx.confidence(0.95);
      ctx.note('Vision entity "Jean-François Millet" matches the Millet page; Breton page is about the artist, not this work');
      ctx.cost(2310, 'tokens', 0.0069);
      ctx.source(MILLET.wikipediaUrl!);
      return MILLET;
    },

    async wikipediaSummary(ctx, c): Promise<Record<string, Fact> | null> {
      await jitter(110);
      ctx.cache('miss');
      if (scenario === 'thrift') {
        ctx.note(`no unambiguous Wikipedia page for artist "${c.title}"`);
        return null;
      }
      ctx.source(c.wikipediaUrl!);
      return {
        summary: {
          value: 'Oil painting by Jean-François Millet depicting three peasant women gleaning a field after the harvest.',
          sourceUrl: c.wikipediaUrl,
        },
      };
    },

    async wikidataFacts(ctx, c) {
      await jitter(100);
      const url = `https://www.wikidata.org/w/index.php?search=${encodeURIComponent(c.title)}`;
      ctx.source(url);
      return {
        year: { value: '1857', sourceUrl: url },
        medium: { value: 'oil on canvas', sourceUrl: url },
        movement: { value: 'Realism', sourceUrl: url },
        collection: { value: "Musée d'Orsay", sourceUrl: url },
      };
    },

    async inferStyle(ctx) {
      await jitter(300);
      ctx.cost(1450, 'tokens', 0.0044);
      ctx.confidence(scenario === 'famous' ? 0.8 : 0.55);
      ctx.note('stored under context.inferred and labeled AI-inferred in the UI');
      return scenario === 'famous'
        ? { style: 'Realist rural scene, muted earth palette' }
        : { style: 'Loose impressionistic landscape, warm evening palette' };
    },

    async generatePrompts(ctx, context, title) {
      await jitter(350);
      ctx.cost(980, 'tokens', 0.003);
      ctx.note(`bound to ${Object.keys(context.facts).length} validated facts`);
      return [
        `What first made you stop and look at "${title}"?`,
        context.facts.movement
          ? `This work belongs to ${context.facts.movement.value}. What feels "real" to you in it?`
          : 'If this scene were a place you could visit, what would you hear there?',
        'Where in your room does it sit, and why there?',
      ];
    },
  };
}
