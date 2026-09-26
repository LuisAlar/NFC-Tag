# Specifications -- NFC Art Journal

> Source: [Journal.md](file:///c:/Users/alarc/Developer/NFC-Tag/docs/Journal.md) (September 13, 2026)
>
> Status: Draft. These represent the technical ideas discussed in the journal
> conversation. Specific tool and library decisions are still open and will be
> refined through conversation before development begins.
>
> See also: [processes.md](file:///c:/Users/alarc/Developer/NFC-Tag/docs/processes.md) for detailed function breakdowns, lifecycle mechanics, and tap state routing.

---

## Technical Pipeline

The journal describes a five-stage pipeline from physical tap to journal entry:

### 1. Image Capture (Frontend)

- When the user taps the NFC tag behind a painting, the web app opens.
- If no journal entry exists yet for this item, the UI prompts the user to take
  a photo.
- Uses the HTML5 `<input type="file" accept="image/*" capture="environment">`
  attribute to open the phone's native camera.

### 2. Image Recognition (Backend)

- Reverse-image search that returns structured data, not a list of image results.
- Candidate tool: **Google Cloud Vision API** (WEB_DETECTION feature).
- Sends the captured image to the API. The API searches the web and returns
  recognized Web Entities -- the entity ID, painting name, artist, and often a
  direct Wikipedia link.

### 3. Factual Context Retrieval (Backend)

- Once the painting is identified (e.g., "The Gleaners by Jean-Francois Millet"),
  the system queries a factual database for archival information.
- Candidate tools: **Wikipedia REST API**, **Artsy API** (open database of
  artworks).
- Retrieves: year, art movement, medium, brief factual summary.
- No LLM is used to generate this content.

### 4. Prompt Generation (Backend)

- An LLM can be used here, but strictly bound by the retrieved facts.
- The LLM receives the Wikipedia summary and a strict instruction: "Based ONLY
  on these facts, generate three introspective questions to help the user journal
  about this painting."
- Example output: "This piece is from the 19th-century Realism movement,
  focusing on rural working-class life. What about the muted colors drew you to
  it in the thrift store?"

### 5. Journaling UI (Frontend)

- A visually appealing, fluid interface similar to Obsidian or Notion.
- Text should feel impermanent until the user decides to keep it.
- Candidate tools: **TipTap** or **Editor.js** (headless, block-based rich text
  editors for React).
- Layout: Factual context (Wikipedia snippet) at the top. LLM-generated
  questions appear below as lightweight, grayed-out blocks. The user types
  answers underneath or deletes prompt blocks to write freeform.

---

## Architecture Decisions

The journal identifies three structural rules to follow from day one, even while
building a personal prototype, so the infrastructure is ready for future scaling.

### Headless / API-First

- The backend (database, image recognition logic, storage) is completely
  decoupled from the frontend UI.
- The backend does not render HTML or CSS. It only sends and receives raw data
  via an API (JSON).
- This allows any frontend -- the personal journaling app, a gallery's custom
  domain, or a future white-labeled UI -- to consume the same API.

### Multi-Tenant

- One instance of the software serves multiple organizations (tenants) as if each
  had their own private system.
- Tenant 01: personal (the user's room).
- Future tenants: indie galleries, fashion brands, etc.
- All tenants share the same database but can never see each other's data.

### Database Pattern -- tenant_id

- Every database table includes a `tenant_id` column.
- An `Organizations` (or `Tenants`) table is created first.
- Every piece of art, journal entry, and NFC tag record is tied to a `tenant_id`.
- On every API request, the backend checks `tenant_id` and filters data
  accordingly.

### Accountless Ownership & Role Resolution

- **Problem Solved**: Eliminate signup forms, passwords, and account overhead while preventing visitors from viewing or modifying private journal entries.
- **Mechanism**:
  - The first phone to tap an unclaimed tag acts as the creator.
  - The backend generates a high-entropy secret token (`raw_owner_secret`) returned exclusively to that initial device during the onboarding handshake.
  - The backend stores `owner_token_hash = sha256(raw_owner_secret)` on the `tags` record.
  - The device stores the raw secret locally (`localStorage` / secure storage).
  - Subsequent requests pass this secret via an authorization header (`Authorization: Bearer <secret>`).
  - **Resolution**:
    - Valid hash match -> Backend returns full payload (artwork facts + private notes) and sets write permissions.
    - Missing or invalid secret -> Backend strips all journal entries and returns a clean, read-only exhibition view (artwork title, artist, movement, Wikipedia summary).

---

## NFC Payload Structure

- The data written to the physical NFC sticker should not hardcode a specific
  frontend URL.
- Instead, the routing URL includes tenant and item identifiers:
  `https://api.yourstudio.com/route?tenant=01&item=8847`
- A routing server reads the `tenant` parameter, looks up the frontend URL for
  that tenant in the database, and redirects the phone there with the item data.

---

## UI Theming -- Design Tokens

- The frontend uses a theme configuration file (design tokens) rather than
  hardcoded colors.
- When building a white-labeled UI for a future client, the process is:
  duplicate the frontend template, swap the `theme.json` file, point it to the
  client's `tenant_id`, and deploy.

---

## NFC Hardware Notes

- **Chip types**: NTAG213 (144 bytes, best for URLs) or NTAG215 (504 bytes,
  ideal for longer URLs, payload data, or vCards).
- **Form factor**: Adhesive paper or PET stickers (usually 25mm diameter).
  Hidden behind the painting.
- **On-metal caveat**: Standard NFC tags fail on metal surfaces because metal
  shorts out the magnetic field. On-metal / anti-metal stickers with ferrite
  backing are required if the tag is placed on or near metal.

### Writing Tags

Two paths discussed in the journal:

1. **Zero-code path** (fastest testing) -- Use the NFC Tools app (free, iOS and
   Android) to write a URL record to the tag.
2. **Custom code path** -- Build an internal dashboard that encodes tags
   programmatically. Web NFC API is available in Chrome for Android but not in
   iOS Safari for writing.
