# Jobify

Jobify is a **desktop app** that aggregates job offers from several sources,
normalizes and persists each provider observation, then deduplicates the list
shown for review. It can determine whether an offer contains enough effective
content to continue a future application workflow. Analysis and generation of
tailored CVs, cover letters, messages or company information remain **FUTURE**.
There is no automatic submission: the human always decides whether to apply.

## Architecture in one minute

- **`server/`** — local Node.js + Express API (class-based MVC). Calls only
  **legal, official APIs** (France Travail, Adzuna, Careerjet), normalizes and
  deduplicates the results, persists them in a local SQLite database.
- **`desktop/`** — Electron + React (Vite) app. In addition to querying the
  server, it does the **client-side scraping** (HelloWork today) using the
  user's own browser session — cookies never leave the machine. Scraped offers
  are sent to the server so they go through the same dedup pipeline.
- **Deduplication / relevance** — exact matching, deterministic obvious-match
  rules, then optional guarded semantic refinement. Without a Groq key, the
  deterministic rules remain active.

```
jobify/
├── server/
│   ├── index.js              Entry point: wires the classes together
│   ├── .env.example          Template for API keys (copy to .env)
│   ├── data/                 Local SQLite database (auto-created, git-ignored)
│   └── src/
│       ├── connectors/       One class per legal API source
│       ├── normalization/    Text / contract / date / salary normalizers
│       ├── services/         Search orchestration, semantic refiner, geo resolver
│       ├── persistence/      SQLite Database + repositories
│       ├── models/           Canonical JobOffer, SearchProfile, value objects
│       ├── controllers/ routes/ views/ config/ constants/
│       └── Application.js
├── desktop/
│   ├── electron/             Main process + preload + scrapers/ (HelloWork)
│   └── src/                  React renderer (functional components + hooks)
├── eslint.config.mjs         Lint rules enforcing the conventions
└── CLAUDE.md                 Mandatory coding conventions
```

### Offer management

Jobify stores observations from France Travail, Adzuna, Careerjet, and
HelloWork separately, then deduplicates the results for display. Provider
identity, persistence, and deduplication are intentionally separate so that
different versions of the same posting remain available and Jobify can later
select the most relevant content for analysis and application preparation.

Each observation has an `OfferContent` that keeps automatic content, optional
user-provided content and structured data separate. Its effective text is
evaluated deterministically before the preparation flow continues.

See the [data foundation](docs/offer-data-foundation.md), the
[content architecture](docs/offer-content-architecture.md), and the
[preparation flow](docs/offer-preparation-flow.md).

## Requirements

- **Node.js 24** (see `.nvmrc`). With nvm: `nvm use`.
  The app relies on Node 24 built-ins: `node:sqlite` and `--env-file`.
- macOS / Windows / Linux. macOS on Apple Silicon has two automatic helpers
  (see *Notes for macOS* below).

## Setup

```bash
# 1. Install dependencies (root + server + desktop)
npm run install:all

# 2. Configure API keys
cp server/.env.example server/.env
#    then fill in the keys you have (see the table below)

# 3. Run the server and the desktop app together
npm run dev
```

- Server: http://localhost:3001
- Vite dev server: http://localhost:5173 (loaded inside the Electron window)

Run the two sides separately if needed:

```bash
npm run dev:server     # API only
npm run dev:desktop    # Vite + Electron only
```

## API keys

Keys live in `server/.env` (git-ignored). **None is strictly required to start**
— every connector is skipped when its key is missing, and HelloWork scraping
works with no key at all. The more keys you add, the more sources you get.

| Source | Env variables | Required? | Where to get it |
|---|---|---|---|
| **France Travail** (main source) | `FRANCE_TRAVAIL_CLIENT_ID`, `FRANCE_TRAVAIL_CLIENT_SECRET`, `FRANCE_TRAVAIL_SCOPE` | Recommended | https://francetravail.io/inscription — create an app **and subscribe it to the "Offres d'emploi v2" API**, then paste the client id/secret. |
| **Adzuna** | `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` | Optional | https://developer.adzuna.com/signup |
| **Careerjet** | `CAREERJET_AFFID` | Optional | https://www.careerjet.com/partners/ |
| **Groq** (dedup + relevance) | `GROQ_API_KEY`, `GROQ_MODEL` | Optional | https://console.groq.com/keys — without it, deterministic deduplication remains active; only semantic deduplication is disabled. |
| **HelloWork** (scraping) | none | — | Client-side, uses the user's session. No key. |

Notes:
- `FRANCE_TRAVAIL_SCOPE` is pre-filled in the template; don't change it unless
  the docs say so.
- `GROQ_MODEL` defaults to `llama-3.3-70b-versatile` when left empty. The free
  tier has a **daily token cap (~100k/day)**; once hit, the server logs a 429
  and keeps deterministic deduplication active without the semantic layer until
  it resets.

## How it works locally

1. In the app, enter keywords + a city + a radius and hit **Rechercher**.
2. The desktop app scrapes HelloWork locally, then POSTs the search (with the
   scraped offers) to the server.
3. The server queries the configured legal APIs, filters recent observations,
   persists every provider observation to SQLite, then applies exact,
   deterministic obvious and optional guarded semantic deduplication for the
   returned list.
4. Click an offer to open its detail view. Opening it is read-only and never
   starts scraping or content acquisition. **Voir l'annonce sur le site** opens
   the original posting.
5. **Préparer ma candidature** asks the server to evaluate the persisted offer.
   For HelloWork, the desktop acquires and persists DETAIL content only when the
   server requests it. If automatic content remains insufficient, the user can
   provide the offer text. `READY` means only that the content is sufficient to
   continue the future application pipeline.
6. **+ Enregistrer cette recherche** saves the current search as a profile
   (shown as a chip you can re-run or delete).

### HTTP API (for reference)

- `GET|POST /api/offres?motsCles=&lieu=&distance=` — search (POST body may carry
  `{ "scrapedOffers": [...] }`).
- `POST /api/offres/:id/prepare` — evaluate an offer and return the next
  preparation instruction.
- `PATCH /api/offres/:id/contenu` — persist provider DETAIL content requested by
  the server and return the updated preparation state.
- `PUT /api/offres/:id/contenu-utilisateur` — persist explicit user-provided
  text separately and return the updated preparation state.
- `GET /api/profils` · `POST /api/profils` · `DELETE /api/profils/:id` — saved
  search profiles.

### Data

The SQLite database is created automatically at `server/data/jobify.db` (git-
ignored). Delete the file to reset all stored offers and profiles.

## Linting

Conventions in `CLAUDE.md` are enforced by ESLint. A change is not done until
this reports zero problems:

```bash
npm run lint
npm run lint:fix
```

In short: class-based MVC on the server (functional components + hooks in the
React renderer), no one-liners, no magic numbers, no emoji, JSDoc on every class
and method, classic JavaScript naming.

## Notes for macOS

Two helper scripts (run automatically) keep Electron healthy:

- `desktop/scripts/fix-electron-macos.mjs` (postinstall) re-signs Electron
  ad-hoc to avoid code-signature kills on Apple Silicon.
- `desktop/scripts/start-electron.mjs` strips `ELECTRON_RUN_AS_NODE` before
  launch, which some editor terminals set and which would otherwise break boot.

The `Autofill.enable failed` messages in the DevTools console are cosmetic.

## Status

Done: multi-source aggregation, normalization, separate provider-observation
persistence, deterministic + guarded semantic deduplication, recency/distance
filters, non-destructive offer content, deterministic content evaluation,
server/desktop preparation flow, persisted HelloWork DETAIL acquisition,
user-text fallback, and saved search profiles.

**FUTURE:** scheduled background searches and notifications; `OfferAnalyzer`;
a structured application representation such as `ApplicationBrief`; tailored
CV, cover letter and message generation; and the company sheet (SIRENE). Their
exact contracts are not yet fixed.
