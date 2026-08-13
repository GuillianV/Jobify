# Candidate dossier architecture

## Boundary

`SearchProfile` remains the historical saved job-search model. `CandidateDossier`
is a separate domain contract containing only candidate facts explicitly supplied
by the user for future application matching.

CandidateDossier V1 has schema version `candidate-dossier-schema-v1` and contains
six required collections: experiences, projects, skills, education, languages and
soft skills. Empty collections are valid at the domain level; matching sufficiency
belongs to a later layer.

## Facts and references

Every item has a caller-supplied stable ID. IDs are never generated from array
positions, so a future evidence reference can identify a fact such as
`EXPERIENCE / exp-1 / activities[0]` after a reorder.

The contract never derives expertise, seniority, years of experience, domains or
language levels. A declared technology means only that the user declared it.
Calendar duration and semantic equivalence remain future matching concerns and
must not become persisted candidate facts.

## Deliberate exclusions

Candidate logistics are intentionally outside CandidateDossier V1: location,
mobility, availability, work preference, remote preference, travel preference and
schedule preference are not schema fields. Generic `OTHER` facts are also excluded.

Identity and contact data such as name, address, email and phone are excluded
because they are unnecessary for matching and must not be sent to a future
matching model. A separate document or signature layer may own them later.

`OfferAnalysis.workConditions` remains factual offer data, but ApplicationBrief V1
will not compare work mode or travel, schedule and operational constraints with
CandidateDossier. Choosing to apply only disables that matching dimension; it does
not create mobility, availability or acceptance claims.

## Domain validation

The model is immutable, serializes only its public factual contract and is built
only after strict validation of exact keys, limits, IDs, enums and dates. Unknown
fields are rejected and no repair or semantic normalization occurs.

Validation occurs in the service boundary, never in the repository. Invalid PUT
input remains a user validation error, while an invalid persisted payload is a
safe persistence failure. No repair or semantic normalization occurs.

## Singleton persistence and API

The shared SQLite database owns one `candidate_dossier` row constrained to the
singleton key `1`. It stores the complete dossier as a JSON payload with a
separate `updated_at` timestamp. The repository parses JSON only and performs an
atomic full replacement; it does not import the model or validator.

`GET /api/dossier-candidat` returns the validated persisted dossier. When no row
exists, it returns `CandidateDossier.empty()` with `updatedAt: null` and performs
no database write. `PUT /api/dossier-candidat` accepts the complete
CandidateDossier body directly and atomically replaces the singleton after strict
validation. Only GET and PUT exist: there is no POST, PATCH, DELETE or ID route.

Persistence metadata remains outside the domain. V1 has no candidate dossier ID,
revision, fingerprint or cache. `SearchProfile` and its `profiles` table remain a
distinct concern. No CandidateDossier UI, ApplicationBrief, matching logic or LLM
integration exists yet.
