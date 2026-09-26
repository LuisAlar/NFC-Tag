# Open Questions -- NFC Art Journal

> Living document. Questions are logged as they surface and marked resolved when
> decisions are made. These drive the refinement of
> [specifications.md](file:///c:/Users/alarc/Developer/NFC-Tag/docs/specifications.md).

---

## Resolved

### Q1. Phase 1 Boundary

> Should the requirements documents focus exclusively on Phase 1, or also
> formally capture Phases 2 and 3 as documented future requirements?

**Answer**: Phase 1 only. These documents are for building the first prototype
for personal use. Phases 2 and 3 are captured as future vision in
[requirements.md](file:///c:/Users/alarc/Developer/NFC-Tag/docs/requirements.md) to
inform architecture, but are not in scope for development. The documents will
evolve as the idea grows.

### Q2. Tech Stack Scope

> Should the spec lock in specific tools (Google Cloud Vision, TipTap, etc.), or
> should alternatives be evaluated?

**Answer**: Nothing is locked in. The user is fluent in tech stack decisions and
wants ongoing conversations to evaluate tools, libraries, and architectural
choices. The goal is to optimize for a lean, refined, well-engineered solution.
Each tool decision will be made through deliberate discussion before committing.

---

## Unresolved

### Q3. Image Recognition Tool

> The journal names Google Cloud Vision API (WEB_DETECTION) as the candidate.
> Are there open-source or lower-cost alternatives worth evaluating (e.g., CLIP,
> reverse image search APIs)?

Status: Open. To be discussed.

### Q4. Journaling UI Library

> TipTap vs. Editor.js. TipTap is more React-native and extensible; Editor.js is
> framework-agnostic and simpler. Which fits the desired writing experience
> better?

Status: Open. To be discussed.

### Q5. Platform Target

> The journal implies a web app opened via NFC tap in the browser. Should the
> spec account for a PWA (Progressive Web App) approach for offline access and
> home screen install? Is native mobile off the table entirely?

Status: Open. To be discussed.

### Q6. LLM Usage Boundary

> Factual context must not be LLM-generated. But the journal allows an LLM for
> generating journaling prompts based on retrieved facts. Should the LLM be
> treated as optional (system works without it) or required (prompts are a core
> feature)?

Status: Open. To be discussed.

### Q7. NFC Hardware Decision

> Adhesive, hidden tags are the preference. Have NTAG213/215 stickers been
> purchased? Is on-metal vs. standard relevant for the current physical setup
> (e.g., metal frames)?

Status: Open. To be discussed.
