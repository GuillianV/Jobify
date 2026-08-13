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

## 8A.1 scope

The model is immutable, serializes only its public factual contract and is built
only after strict validation of exact keys, limits, IDs, enums and dates. Unknown
fields are rejected and no repair or semantic normalization occurs.

8A.1 adds no persistence, database schema, API, UI, cache, LLM integration,
ApplicationBrief or matching logic. Later phases may add storage and use stable
item IDs as the basis for validated evidence references.
