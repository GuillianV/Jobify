# Architecture de l'analyse d'offre

## Statut et portée

Ce document définit le contrat `OfferAnalysis` V1 et les primitives
déterministes implémentées pendant l'étape 7A. Il complète
[l'architecture du contenu](./offer-content-architecture.md) et le
[flux de préparation](./offer-preparation-flow.md).

L'étape 7A n'analyse encore aucune offre avec un LLM. Elle n'ajoute ni service
d'orchestration, ni endpoint, ni cache, ni persistance d'analyse, ni interface
desktop.

## Frontière avec la préparation

`OfferPreparationService` détermine si le contenu effectif est suffisamment
riche. Le futur `OfferAnalyzerService` restera responsable de recharger une
observation persistée, de la réévaluer et d'imposer `SUFFICIENT` avant toute
analyse.

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

## Étapes futures

Les éléments suivants restent **FUTURE** :

- **7B** : client Groq, prompt, analyse structurée, parsing et
  `OfferAnalyzerService` autoritatif ;
- **7C** : provenance complète, provider/modèle, cache et persistance,
  endpoint serveur ;
- **7D** : orchestration et affichage desktop ;
- `ApplicationBrief`, profil candidat, comparaison et génération de documents.

Après 7A, Jobify sait définir et vérifier une analyse, mais ne sait pas encore
en produire une automatiquement.
