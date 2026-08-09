# Jobify

Jobify is a **desktop app** that aggregates job offers from several sources,
normalizes them into a single model, deduplicates them, and presents them ready
to review. It prepares **complete application dossiers** (offer, and — planned —
tailored CV, cover letter, company info, contacts). There is **no automatic
submission**: everything is laid out and the human decides whether to apply.

## Architecture in one minute

- **`server/`** — local Node.js + Express API (class-based MVC). Calls only
  **legal, official APIs** (France Travail, Adzuna, Careerjet), normalizes and
  deduplicates the results, persists them in a local SQLite database.
- **`desktop/`** — Electron + React (Vite) app. In addition to querying the
  server, it does the **client-side scraping** (HelloWork today) using the
  user's own browser session — cookies never leave the machine. Scraped offers
  are sent to the server so they go through the same dedup pipeline.
- **Deduplication / relevance** — an optional Groq LLM call clusters duplicate
  offers across sources and scores relevance. Without a key it degrades
  gracefully to exact deduplication.

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

See [`docs/offer-data-foundation.md`](docs/offer-data-foundation.md).

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
| **Groq** (dedup + relevance) | `GROQ_API_KEY`, `GROQ_MODEL` | Optional | https://console.groq.com/keys — without it, exact dedup only. |
| **HelloWork** (scraping) | none | — | Client-side, uses the user's session. No key. |

Notes:
- `FRANCE_TRAVAIL_SCOPE` is pre-filled in the template; don't change it unless
  the docs say so.
- `GROQ_MODEL` defaults to `llama-3.3-70b-versatile` when left empty. The free
  tier has a **daily token cap (~100k/day)**; once hit, the server logs a 429
  and falls back to exact dedup until it resets.

## How it works locally

1. In the app, enter keywords + a city + a radius and hit **Rechercher**.
2. The desktop app scrapes HelloWork locally, then POSTs the search (with the
   scraped offers) to the server.
3. The server queries the configured legal APIs, merges everything, dedups
   (exact + optional Groq), filters to the last 3 weeks, sorts by date, persists
   to SQLite, and returns the list.
4. Click an offer to open the detail view. For HelloWork offers, the full
   description, exact date/time and salary are fetched on demand from the offer
   page. **Voir l'annonce sur le site** opens the original posting.
5. **+ Enregistrer cette recherche** saves the current search as a profile
   (shown as a chip you can re-run or delete).

### HTTP API (for reference)

- `GET|POST /api/offres?motsCles=&lieu=&distance=` — search (POST body may carry
  `{ "scrapedOffers": [...] }`).
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

Done: multi-source aggregation (France Travail + Adzuna + Careerjet), full
normalization, exact + semantic dedup, recency/distance filters, detail view
with on-demand HelloWork enrichment, SQLite persistence, saved search profiles.

Next: scheduled background searches + new-offer notifications, then tailored
CV / cover letter generation and the company sheet (SIRENE).
