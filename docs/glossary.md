# Glossary -- NFC Art Journal

> Shared vocabulary for the project. Referenced by
> [requirements.md](file:///c:/Users/alarc/Developer/NFC-Tag/docs/requirements.md) and
> [specifications.md](file:///c:/Users/alarc/Developer/NFC-Tag/docs/specifications.md).

---

**API-First** -- A design approach where the backend exposes all functionality
through a structured API (typically JSON over HTTP) before any frontend is built.
The API is the product; frontends are interchangeable consumers.

**Artsy API** -- An open database of artworks, artists, and exhibitions. A
candidate source for factual art context in this project.

**Design Tokens** -- A theme configuration file (e.g., `theme.json`) that defines
colors, typography, spacing, and other visual properties. Swapping this file
changes the entire look of a frontend without modifying code.

**EEPROM** -- Electrically Erasable Programmable Read-Only Memory. The type of
memory inside an NFC tag's microchip where the payload data (e.g., a URL) is
stored. Data persists without power and can be rewritten unless the tag is locked.

**Ferrite Backing** -- A shielding layer built into on-metal NFC tags that
isolates the antenna from metal surfaces, preventing signal interference.

**Headless** -- An architecture where the backend has no built-in user interface.
It processes data and serves it via an API, allowing any frontend (web app,
mobile app, third-party site) to present it.

**Multi-Tenant** -- A software architecture where a single instance of the
application serves multiple separate organizations (tenants). Each tenant's data
is isolated, but they share the same underlying infrastructure.

**NDEF** -- NFC Data Exchange Format. The standardized format for storing data
records on NFC tags. Common record types include URLs, plain text, and vCards.

**NFC** -- Near Field Communication. A short-range wireless technology operating
at 13.56 MHz that allows two devices (or a device and a passive tag) to exchange
data when held within a few centimeters of each other.

**NTAG213** -- An NFC tag chip with 144 bytes of user-writable memory. Best
suited for short payloads like URLs. Cost: roughly \$0.20-\$0.50 each in bulk.

**NTAG215** -- An NFC tag chip with 504 bytes of user-writable memory. Suitable
for longer URLs, payload data, or vCards.

**NTAG216** -- An NFC tag chip with 888 bytes of user-writable memory. The
largest common consumer NFC chip.

**On-Metal Tag** -- An NFC tag variant designed to function when placed on metal
surfaces. Includes a ferrite backing layer to prevent the metal from shorting out
the tag's magnetic field.

**PLG (Product-Led Growth)** -- A business model where the product itself drives
user acquisition. Users adopt the tool organically to solve a personal problem,
then bring it into teams and organizations. Contrasts with top-down enterprise
sales. (Examples: Figma, Slack, Notion.)

**PWA (Progressive Web App)** -- A web application that uses modern browser APIs
to deliver app-like experiences including offline access, push notifications, and
home screen installation, without requiring distribution through an app store.

**Tenant** -- A single organization or user account within a multi-tenant system.
Each tenant's data is logically isolated from all other tenants. In this project,
Tenant 01 is the personal prototype.

**Web NFC API** -- A browser API that allows web pages to read from and write to
NFC tags. Currently supported only in Chrome for Android. iOS Safari does not
support writing via this API.

**Exhibition View** -- A read-only presentation mode rendered when a guest device taps a registered NFC tag. Displays the identified artwork's factual metadata, archival history, and reference photo, while completely withholding private personal journal entries.

**Owner Secret Token** -- A high-entropy cryptographic secret minted during the initial tag onboarding flow and stored permanently in the owner device's local storage. Allows accountless, friction-free ownership and edit access without requiring passwords or signups.

**White-Label** -- A product built by one company that is rebranded and resold by
another. In this project, a white-labeled frontend would carry a gallery's
branding and design while running on the shared backend infrastructure.
