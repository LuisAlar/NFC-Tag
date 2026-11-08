/**
 * The onboarding pipeline (Flow A in docs/processes.md), written against a
 * Providers interface so the demo can use fakes and the real app can swap in
 * Google Vision, Wikipedia, Wikidata and an LLM later without touching the
 * pipeline or the logging.
 *
 * Stages:
 *   identify  - waterfall: vision -> museum search -> user input
 *   resolve   - agent step, only when several candidate pages are close
 *   context   - fill facts from Wikipedia / Wikidata, each fact with a source
 *   inferred  - optional LLM guesses (style), stored apart from facts
 *   validate  - drop any fact without a source URL
 *   prompts   - LLM writes journaling questions from stored facts only
 */

import type { Run, StepContext } from '../runlog/index.js';

// -- Shapes the providers return ---------------------------------------------

export interface Candidate {
  title: string;
  artist?: string;
  wikipediaUrl?: string;
  confidence: number;
}

export interface Identification {
  title: string;
  artist?: string;
  confidence: number;
  candidates: Candidate[];
  via: 'vision' | 'museum' | 'user';
}

export interface Fact {
  value: string;
  sourceUrl?: string;
}

export interface ItemContext {
  facts: Record<string, Fact>;
  /** Model guesses. Shown to the user as "AI-inferred", never as facts. */
  inferred: Record<string, string>;
}

export interface Providers {
  vision(ctx: StepContext, imageKey: string): Promise<Identification | null>;
  museumSearch(ctx: StepContext, hint: string): Promise<Identification | null>;
  askUser(ctx: StepContext): Promise<Identification | null>;
  resolveAgent(ctx: StepContext, id: Identification): Promise<Candidate | null>;
  wikipediaSummary(ctx: StepContext, c: Candidate): Promise<Record<string, Fact> | null>;
  wikidataFacts(ctx: StepContext, c: Candidate): Promise<Record<string, Fact> | null>;
  inferStyle(ctx: StepContext, imageKey: string): Promise<Record<string, string> | null>;
  generatePrompts(ctx: StepContext, context: ItemContext, title: string): Promise<string[] | null>;
}

export interface OnboardInput {
  imageKey: string; // object storage key, never the image bytes
  hint?: string;
}

export interface OnboardResult {
  title: string;
  artist?: string;
  context: ItemContext;
  prompts: string[];
}

const ACCEPT_CONFIDENCE = 0.7;
/** If the top two candidates are within this margin, ask the agent to decide. */
const AMBIGUITY_MARGIN = 0.15;

export async function onboard(run: Run, p: Providers, input: OnboardInput): Promise<OnboardResult | null> {
  // 1. Identify -------------------------------------------------------------
  const identified = await run.waterfall<Identification>(
    'identify',
    [
      {
        name: 'identify.vision_web_detection',
        provider: 'google-vision',
        input: { imageKey: input.imageKey },
        run: (ctx) => p.vision(ctx, input.imageKey),
      },
      {
        name: 'identify.museum_search',
        provider: 'artic-api',
        input: { hint: input.hint },
        run: (ctx) => p.museumSearch(ctx, input.hint ?? ''),
      },
      {
        name: 'identify.user_input',
        kind: 'human',
        provider: 'user',
        run: (ctx) => p.askUser(ctx),
      },
    ],
    {
      accept: (id) =>
        id.confidence >= ACCEPT_CONFIDENCE || `confidence ${id.confidence.toFixed(2)} < ${ACCEPT_CONFIDENCE}`,
    },
  );

  if (!identified) return null;
  const id = identified.value;

  // 2. Resolve (only when ambiguous) ----------------------------------------
  const ranked = [...id.candidates].sort((a, b) => b.confidence - a.confidence);
  let chosen: Candidate | null = ranked[0] ?? null;

  const ambiguous =
    ranked.length > 1 && ranked[0].confidence - ranked[1].confidence < AMBIGUITY_MARGIN;

  if (ambiguous) {
    chosen = await run.step(
      'resolve.disambiguate',
      { kind: 'agent', provider: 'llm', input: { candidates: ranked.map((c) => c.title) } },
      (ctx) => p.resolveAgent(ctx, id),
    );
  } else {
    run.skip(
      'resolve.disambiguate',
      { kind: 'agent', provider: 'llm' },
      ranked.length === 0 ? 'no candidate pages to choose between' : 'top candidate is clear',
    );
  }

  // 3. Context: facts with sources ------------------------------------------
  const facts: Record<string, Fact> = {
    title: { value: chosen?.title ?? id.title, sourceUrl: chosen?.wikipediaUrl },
  };
  if (id.artist) facts.artist = { value: id.artist, sourceUrl: chosen?.wikipediaUrl };

  if (chosen?.wikipediaUrl) {
    const summary = await run.step('context.wikipedia_summary', { provider: 'wikipedia-rest', input: { url: chosen.wikipediaUrl } }, (ctx) =>
      p.wikipediaSummary(ctx, chosen!),
    );
    Object.assign(facts, summary ?? {});

    const wd = await run.step('context.wikidata_facts', { provider: 'wikidata', input: { title: chosen.title } }, (ctx) =>
      p.wikidataFacts(ctx, chosen!),
    );
    Object.assign(facts, wd ?? {});
  } else {
    // Unknown painting: try artist-level context instead.
    const artistCtx = await run.step(
      'context.wikipedia_artist',
      { provider: 'wikipedia-rest', input: { artist: id.artist } },
      (ctx) => p.wikipediaSummary(ctx, { title: id.artist ?? '', confidence: 0 }),
    );
    Object.assign(facts, artistCtx ?? {});
    run.skip('context.wikidata_facts', { provider: 'wikidata' }, 'no canonical page for this work');
  }

  // 4. Inferred (kept apart from facts) -------------------------------------
  const inferred =
    (await run.step('inferred.style', { kind: 'llm', provider: 'llm-vision', input: { imageKey: input.imageKey } }, (ctx) =>
      p.inferStyle(ctx, input.imageKey),
    )) ?? {};

  // 5. Validate provenance ---------------------------------------------------
  const validated = await run.step('validate.provenance', { input: { factKeys: Object.keys(facts) } }, async (ctx) => {
    const kept: Record<string, Fact> = {};
    const dropped: string[] = [];
    for (const [key, fact] of Object.entries(facts)) {
      const userSupplied = id.via === 'user' && (key === 'title' || key === 'artist');
      if (fact.sourceUrl || userSupplied) kept[key] = fact;
      else dropped.push(key);
    }
    ctx.note(`${Object.keys(facts).length} facts checked, ${dropped.length} dropped${dropped.length ? `: ${dropped.join(', ')}` : ''}`);
    ctx.confidence(Object.keys(kept).length / Math.max(1, Object.keys(facts).length));
    return kept;
  });

  const context: ItemContext = { facts: validated ?? {}, inferred };

  // 6. Prompts ---------------------------------------------------------------
  const prompts =
    (await run.step('prompts.generate', { kind: 'llm', provider: 'llm', input: { factKeys: Object.keys(context.facts) } }, (ctx) =>
      p.generatePrompts(ctx, context, facts.title.value),
    )) ?? [];

  return { title: facts.title.value, artist: id.artist, context, prompts };
}
