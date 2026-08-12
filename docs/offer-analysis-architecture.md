# Architecture de l'analyse d'offre

## Statut et portée

Ce document définit le contrat `OfferAnalysis` V1, ses primitives
déterministes 7A et son service d'analyse en mémoire 7B. Il complète
[l'architecture du contenu](./offer-content-architecture.md) et le
[flux de préparation](./offer-preparation-flow.md).

L'étape 7B ajoute un client Groq JSON dédié et un service d'orchestration
testable par injection. Elle n'ajoute ni endpoint, ni cache, ni persistance
d'analyse, ni interface desktop.

## Frontière avec la préparation

`OfferPreparationService` détermine si le contenu effectif est suffisamment
riche. `OfferAnalyzerService` recharge l'observation persistée, la réévalue et
impose exactement `SUFFICIENT` avant toute analyse. Il n'appelle pas le service
de préparation.

`OfferAnalysisInputProjector` est une primitive plus étroite. Il ne connaît pas
la politique de suffisance et ne dépend pas de `OfferContentEvaluator`.

## Contrat `OfferAnalysis` V1 — IMPLEMENTED

La version de schéma est `offer-analysis-schema-v1`. Elle est associée au
validator, mais ne fait pas partie de l'objet sémantique : elle appartiendra à
la future couche de provenance.

```text
OfferAnalysis {
  seniority,
  activities,
  requirements,
  context,
  workConditions {
    workMode,
    constraints
  }
}
```

L'absence est représentée par `null` pour `seniority` et `workMode`, et par un
tableau vide pour les collections. Une analyse sans aucune information
sémantique est invalide. Les propriétés inconnues sont rejetées.

Le contrat ne contient ni résumé, ni titre normalisé, ni famille de métier, ni
différenciateurs. Expérience, formation et langues vivent exclusivement dans
la liste canonique des exigences.

## Assertions et preuves — IMPLEMENTED

Une assertion vaut `EXPLICIT` ou `INFERRED`.

- `EXPLICIT` exige une preuve `{ text }` non vide, d'au plus 240 unités
  `String.length`, présente exactement dans le texte effectif avec
  `effectiveText.includes(evidence.text)`.
- `INFERRED` exige `evidence: null`.

La preuve conserve le texte source exact. Elle ne subit ni trim, ni réduction
d'espaces, ni normalisation Unicode. Une seule preuve explicite absente,
invalide ou introuvable rend l'analyse entière invalide.

Les activités, le contexte et la séniorité acceptent les deux assertions. Les
exigences, le mode de travail et les contraintes sont exclusivement explicites
en V1.

## Activités et exigences — IMPLEMENTED

`activities` rassemble missions, responsabilités et tâches principales dans
une collection unique.

`requirements` porte toutes les demandes employeur. Ses catégories sont :

- `TECHNICAL_SKILL` ;
- `FUNCTIONAL_SKILL` ;
- `TOOL_OR_TECHNOLOGY` ;
- `SOFT_SKILL` ;
- `EXPERIENCE` ;
- `EDUCATION` ;
- `LANGUAGE` ;
- `OTHER`.

Une technologie, un langage, un framework, un produit, une plateforme ou un
outil nommé relève de `TOOL_OR_TECHNOLOGY`. Une pratique ou capacité technique
relève de `TECHNICAL_SKILL`. L'importance vaut `REQUIRED`, `PREFERRED` ou
`UNSPECIFIED`.

## Séniorité, contexte et conditions — IMPLEMENTED

La séniorité nullable accepte jusqu'à trois niveaux parmi `JUNIOR`,
`CONFIRMED`, `SENIOR`, `LEAD` et `MANAGER`. Plusieurs niveaux permettent de
représenter une annonce ouverte à plusieurs profils.

Le contexte utilise les catégories `DOMAIN`, `TEAM` et `CHALLENGE`, sans
taxonomie métier.

Le mode de travail nullable vaut `REMOTE`, `HYBRID` ou `ONSITE`. Son détail
nullable conserve uniquement une nuance utile. Les contraintes explicites sont
classées en `TRAVEL`, `SCHEDULE` ou `OPERATIONAL`. Un permis ou une habilitation
demandée reste une exigence `OTHER`, tandis que le caractère itinérant relève
de `TRAVEL`.

## Limites — IMPLEMENTED

- 12 activités ;
- 20 exigences ;
- 8 éléments de contexte ;
- 8 contraintes ;
- 3 niveaux de séniorité ;
- 240 unités `String.length` par valeur, détail ou preuve ;
- 48 objets sémantiques au total.

La séniorité et le mode de travail comptent chacun comme un objet lorsqu'ils
sont présents. Les niveaux de séniorité ne sont pas comptés séparément.

## Validation et normalisation — IMPLEMENTED

L'ordre de traitement est :

1. validation de la structure brute, des clés, des types, des enums et des
   bornes ;
2. validation de la limite totale brute ;
3. normalisation des seules valeurs synthétiques ;
4. déduplication interne légère ;
5. validation des preuves, des invariants finaux, du résultat non vide et de la
   limite totale finale ;
6. construction d'un modèle `OfferAnalysis` détaché.

Les valeurs synthétiques sont trimées et leurs espaces internes sont réduits.
Les valeurs vides sont retirées. La déduplication ignore la casse et les
accents, conserve la première graphie et inclut la catégorie lorsqu'elle
existe. Deux exigences d'importances différentes restent distinctes. Aucune
taxonomie, synonymie ou correction intelligente n'est appliquée.

## Projection déterministe — IMPLEMENTED

Le projector reçoit un `JobOffer` hydraté et récupère exclusivement
`offer.offerContent.getEffectiveText()`. Un texte utilisateur effectif a donc
priorité sur le texte automatique. L'absence de texte produit une erreur
déterministe.

Sa sortie contient :

```text
{
  offerSnapshot,
  effectiveText,
  effectiveContentOrigin,
  contentFingerprint,
  deterministicInputFingerprint
}
```

`effectiveContentOrigin` vaut `USER` ou `AUTOMATIC`.

Le snapshot contient uniquement l'identifiant interne, la source, le titre, le
nom d'entreprise, les champs textuels de localisation, le contrat et le
salaire. Il exclut description, contenu persistant, URL de candidature,
alternates, date de publication, URLs et logo d'entreprise, latitude et
longitude.

## Fingerprints — IMPLEMENTED

`contentFingerprint` est le SHA-256 UTF-8 du texte effectif exact. Aucun trim,
changement de casse, réduction d'espaces ou traitement Unicode n'est appliqué.

`deterministicInputFingerprint` est le SHA-256 UTF-8 d'une sérialisation
canonique du snapshot. Les clés d'objets sont triées récursivement, l'ordre des
tableaux et les valeurs `null` sont conservés, et aucune propriété `undefined`
n'est sérialisée.

Ces empreintes sont des entrées destinées à une future clé de cache. Elles ne
constituent pas encore un cache ou une identité persistante.

## Client Groq JSON — IMPLEMENTED

`GroqJsonClient` encapsule uniquement le transport Analyzer. Il reçoit la clé,
le transport `fetch`, l'endpoint et les primitives de timer par injection. Une
requête utilise `temperature: 0`, le mode `json_object`, un plafond de tokens
fourni par le service — 4096 pour l'appel normal — et un timeout de 30
secondes. Il parse l'enveloppe Groq puis le contenu
JSON, sans connaître ni valider le contrat `OfferAnalysis`.

Ses erreurs stables distinguent indisponibilité, timeout, limitation de débit,
authentification, autre erreur HTTP et réponse invalide. Elles n'exposent ni
clé, ni prompt, ni texte d'offre, ni contenu brut du provider. Le client ne
fait lui-même aucun retry.

## Prompt et frontière non fiable — IMPLEMENTED

Le schéma de données reste `offer-analysis-schema-v1`, tandis que la politique
Analyzer devient `offer-analyzer-v5`. La politique V2 a validé trois analyses
sur six réponses HTTP 200 lors de sa calibration réelle, soit 50 % first-pass.
V3 applique donc un tuning ciblé sans modifier ni assouplir le validator.

V4 renforçait uniquement la classification `workConditions.workMode` après deux
rejets `ENUM` / `WORK_MODE` reproduits sur des providers différents. Le prompt
rappelle localement les trois valeurs fermées, exige une modalité explicite et
non ambiguë, et impose `workMode: null` lorsqu'aucune classification exacte
n'est soutenue. Le validator strict est conservé et aucune réparation d'enum
n'est ajoutée.

V5 applique un tuning ciblé du rappel `ONSITE` après un faux négatif sémantique
validé sous V4. Une déclaration explicite indiquant que le poste ou travail est
exercé en présentiel, ou que sa réalisation requiert une présence physique au
lieu de travail, peut produire `ONSITE` sans exiger une formulation formelle de
politique d'organisation du travail. Une adresse, localisation, mention de
site, chantier, bureau, contexte physique ou opérationnel, déplacement ou
absence de télétravail pris seuls restent insuffisants. Le validator reste
strict, aucune réparation d'enum n'est ajoutée et le schéma V1 ne change pas.

`OfferAnalyzerPrompt` présente séparément le contrat de sortie, les enums fermés
sensibles à la casse, les limites et le contrôle final silencieux. V3 renforce
la copie caractère pour caractère d'une preuve courte et contiguë, puis impose
l'omission d'un item explicite lorsqu'aucune preuve exacte ne peut le soutenir.
Elle ajoute une correspondance mécanique entre chaque field et ses valeurs enum,
clarifie les catégories d'exigences et leur importance, et élève la barre d'une
séniorité inférée. Les exigences, le mode de travail et les contraintes restent
exclusivement explicites.

Les protections V2 efficaces sont conservées : omission des exigences seulement
déduites, `TEAM` réservé aux vraies informations d'équipe, conditions de travail
explicites, exclusion du boilerplate et sélection sous les cardinalités V1.
Aucun sous-diagnostic SAFE et aucun repair retry ne sont ajoutés.

Le user prompt sérialise un objet JSON séparant `deterministicContext` et
`untrustedOfferText`. Le contexte contient uniquement titre, entreprise,
localisation et contrat. Il ne contient ni identifiant, source, salaire, URL,
date, alternates ou empreinte. Le texte effectif exact est une donnée externe
non fiable : ses éventuelles instructions ne sont jamais suivies. Cette
défense s'ajoute à l'absence d'outils et de secrets et à la validation serveur.
Aucune donnée candidat n'entre dans ce flux.

## Orchestration Analyzer — IMPLEMENTED

`OfferAnalyzerService.analyze(id)` valide l'identifiant interne, recharge
l'offre autoritativement, impose `SUFFICIENT`, puis délègue toute projection à
`OfferAnalysisInputProjector`. Un texte dépassant 100000 unités
`String.length` est rejeté sans troncature, chunking ou appel provider.

Le service effectue un appel Groq normal et, uniquement après un rejet
token-budget strictement reconnu, au maximum un second appel technique. Il
transmet ensuite la première valeur JSON produite à
`OfferAnalysisValidator.validate(raw, exactEffectiveText)`. Il
n'appelle jamais le normalizer directement. Une sortie partielle, une preuve
inventée ou une assertion interdite invalide toute l'analyse.
Les violations du contrat utilisent `OfferAnalysisValidationError` et deviennent
`ANALYZER_INVALID_OUTPUT`. Les erreurs internes de programmation inattendues ne
sont pas masquées par ce mapping.

`OfferAnalysisValidationError` associe chaque rejet à une catégorie fermée et
sûre. Pour un rejet du validator, `OfferAnalyzerService` expose
`validationCode` et, uniquement pour une branche `EVIDENCE` ou `ENUM` connue,
un `validationSubcode` optionnel. Les quatre sous-codes `EVIDENCE` fermés sont
`INFERRED_EVIDENCE_PRESENT`, `EXPLICIT_EVIDENCE_TEXT_INVALID`,
`EXPLICIT_EVIDENCE_TEXT_TOO_LONG` et `EXPLICIT_EVIDENCE_TEXT_NOT_FOUND`.
Les sous-codes `ENUM` fermés sont `SENIORITY_LEVEL`, `REQUIREMENT_CATEGORY`,
`REQUIREMENT_IMPORTANCE`, `CONTEXT_CATEGORY`, `WORK_MODE`,
`CONSTRAINT_CATEGORY` et `ASSERTION`.
Aucune valeur candidate, preuve ou donnée source n'entre dans ces diagnostics.
Le message et la cause restent internes. Une réponse Groq syntaxiquement
invalide intervient avant ce validator et ne reçoit donc aucun diagnostic
validator artificiel.

Cette instrumentation répond aux deux rejets `EVIDENCE` observés pendant la
calibration V3. Elle ne change ni les décisions accept/reject, ni le prompt,
ni la policy `offer-analyzer-v3`, ni le schéma `offer-analysis-schema-v1`, et ne
prétend pas corriger le problème evidence. Elle doit seulement identifier la
règle mécanique en échec lors de la prochaine calibration.

Le résultat en mémoire contient l'instance validée, le snapshot, l'origine du
contenu, les deux empreintes et la provenance analyzer
`offer-analyzer-v5`/`GROQ`/modèle. Il ne contient pas de date d'analyse, état
de cache ou métadonnée persistée. Sa provenance inclut également
`maxOutputTokens`, plafond effectivement utilisé par la génération validée.

## Budget de tokens Analyzer — IMPLEMENTED

L'investigation 7B.14 a confirmé que les HTTP 413 observés provenaient de
l'admission token du provider : la demande comptabilisée correspondait aux
tokens du prompt additionnés à `max_tokens`. La limite du compte ou du plan
n'est jamais codée en dur dans Jobify.

Le plafond normal Analyzer vaut désormais 4096 tokens. Lorsqu'un HTTP 413
contient le diagnostic Groq strict `tokens`/`rate_limit_exceeded` et une paire
entière cohérente `Limit`/`Requested`, le transport n'expose que ces deux
nombres sûrs. `OfferAnalyzerService` peut alors effectuer au maximum un retry
technique avec le même prompt, le même modèle et le même contenu. Seul le
plafond de sortie diminue, avec une marge d'un token sous la limite calculée.

Le retry exige au moins 2048 tokens de sortie disponibles. Ce seuil est un
plancher opérationnel provisoire à vérifier avec les `completion_tokens` de la
prochaine calibration ; il ne garantit pas la taille maximale théorique du
contrat. Si le budget restant est plus faible, l'offre n'est ni tronquée ni
renvoyée au provider. Un second rejet token-budget arrête aussi le flux. Les
413 non reconnus conservent le mapping HTTP/provider historique.

Ce mécanisme n'est pas un repair retry : une sortie produite puis rejetée par
le validator n'est jamais régénérée. Le champ transport reste `max_tokens` ;
une migration éventuelle vers `max_completion_tokens` est différée. V5 ne
modifie pas ce mécanisme de budget, le schéma reste
`offer-analysis-schema-v1` et seul le prompt WORK_MODE évolue.

La future provenance et la future clé de cache 7C devront tenir compte au
minimum de la policy, du provider, du modèle, de `maxOutputTokens`, des
empreintes de contenu et d'entrée, ainsi que de la version de schéma
appropriée. La prochaine calibration V5 reste requise avant 7C.

## Étapes futures

Les éléments suivants restent **FUTURE** :

- une recalibration first-pass de la politique V4 sur six nouvelles offres
  `READY`, choisies selon les sources réellement disponibles, avec une offre
  utilisateur sûre lorsqu'il en existe une ;
- **7C** : correction du fallback de modèle vide dans `AppConfig`, wiring
  runtime, cache, persistance, single-flight, date d'analyse persistée,
  controller, route et endpoint serveur ;
- **7D** : orchestration et affichage desktop ;
- `ApplicationBrief`, profil candidat, comparaison et génération de documents.

La recalibration V5 reste obligatoire avant de commencer 7C. Après 7B, Jobify
sait produire et vérifier une analyse en mémoire par instanciation directe du
service. Aucun consommateur API ou desktop n'est encore câblé.
