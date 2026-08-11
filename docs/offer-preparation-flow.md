# Flux de préparation d'une offre

## Statut et objectif

Ce document est la référence normative du flux « Préparer ma candidature »
implémenté entre le serveur, le renderer desktop et Electron.

La préparation détermine si une offre déjà persistée contient suffisamment de
contexte pour permettre une future analyse de candidature. `READY` signifie
uniquement que le contenu est suffisant pour poursuivre ce futur pipeline. Il
ne signifie ni que l'offre a été analysée par un LLM, ni qu'une candidature,
une lettre ou un autre document a été généré.

Le modèle et la politique d'évaluation sont définis dans
[l'architecture du contenu](./offer-content-architecture.md). Les invariants
d'identité et de persistance sont définis dans la
[fondation des données](./offer-data-foundation.md).

## Responsabilités

### Serveur

Le serveur est l'autorité métier. Il recharge l'observation par son id SQLite,
évalue son contenu effectif, décide du prochain `prepareStatus`, persiste un
DETAIL ou un texte utilisateur lorsqu'il en reçoit un, puis réévalue.

Le serveur ne scrape jamais HelloWork directement.

### Desktop renderer

Le renderer orchestre les instructions du serveur, l'état visible, les retries
explicites et la concurrence. Il ne recalcule jamais la suffisance.

### Electron et `HelloWorkScraper`

Electron réalise l'acquisition HelloWork dans un environnement sécurisé et
expose un résultat IPC borné. `HelloWorkScraper` assure le scraping technique.
Ni Electron ni le scraper ne prennent de décision métier.

## Démarrage : `POST /api/offres/:id/prepare`

Cette opération est read-only. Le serveur recharge et évalue l'offre sans
écrire dans SQLite. La réponse est une enveloppe :

```json
{
  "prepareStatus": "READY | NEEDS_PROVIDER_ACQUISITION | NEEDS_USER_TEXT",
  "evaluation": {},
  "offre": {},
  "userContent": null,
  "providerAcquisition": null
}
```

Les trois statuts sont :

- `READY` : le contenu effectif est `SUFFICIENT` ;
- `NEEDS_PROVIDER_ACQUISITION` : une acquisition HelloWork est utile et
  autorisée ;
- `NEEDS_USER_TEXT` : le flux doit proposer un texte utilisateur.

## Décision serveur actuelle

La décision est strictement la suivante :

1. une évaluation `SUFFICIENT` produit `READY` ;
2. sinon, une offre HelloWork sans `userText` effectif, sans texte automatique
   DETAIL existant et avec une URL persistée valide produit
   `NEEDS_PROVIDER_ACQUISITION` ;
3. tous les autres cas produisent `NEEDS_USER_TEXT`.

Cette politique ne généralise pas l'acquisition à d'autres fournisseurs.

## Acquisition HelloWork

```text
POST /prepare
-> NEEDS_PROVIDER_ACQUISITION
-> instruction providerAcquisition
-> renderer
-> IPC Electron
-> HelloWorkScraper
-> résultat discriminé
```

Le contrat IPC public contient uniquement :

```json
{
  "status": "ACQUIRED",
  "detail": {
    "description": "...",
    "sourceUrl": "..."
  }
}
```

ou :

```json
{ "status": "NOT_FOUND" }
```

```json
{ "status": "FAILED" }
```

`FAILED` n'expose aucune exception brute. Electron revalide le `kind`, la
source, l'URL et la politique d'URL HelloWork avant l'acquisition.

## Persistance du DETAIL

Le renderer transmet un résultat `ACQUIRED` à :

```text
PATCH /api/offres/:id/contenu
```

Le serveur :

- recharge l'offre par son id SQLite ;
- valide sa source et l'URL avec la politique HelloWork commune ;
- construit lui-même la provenance `DETAIL` et `retrievedAt` ;
- classe le texte `PROVIDER_FULL` ;
- persiste uniquement le payload de l'offre ;
- préserve les timestamps d'observation.

Le PATCH réévalue immédiatement le contenu et retourne une nouvelle enveloppe
de préparation. Le desktop ne refait pas de `POST /prepare`.

## Texte utilisateur

```text
PUT /api/offres/:id/contenu-utilisateur
```

Le body est :

```json
{ "text": "..." }
```

Le texte doit être une chaîne non vide après trim et ne pas dépasser la limite
métier de 100000 unités UTF-16 (`String.length`). Sa valeur exacte est
conservée ; `providedAt` est produit par le serveur. Le même texte exact est un
no-op et un texte différent remplace explicitement le précédent. Aucun DELETE
de `userText` n'est actuellement implémenté.

`userText` reste séparé de `automaticText` et n'est jamais copié dans
`JobOffer.description`. Le PUT réévalue immédiatement le contenu et retourne
une nouvelle enveloppe de préparation.

## Ouverture read-only

Ouvrir `OfferDetail` ne déclenche aucun IPC, scraping, PATCH ou acquisition
fournisseur. L'acquisition commence seulement après une action explicite
« Préparer ma candidature » et une instruction
`NEEDS_PROVIDER_ACQUISITION` du serveur.

## Retries

Le flux ne contient aucune boucle ou retry automatique :

- `NOT_FOUND` ou `FAILED` conduit au fallback `userText` ;
- un retry fournisseur est toujours explicite ;
- après `ACQUIRED` suivi d'une erreur PATCH, le DETAIL reste en session dans le
  renderer afin de retenter le PATCH sans nouveau scraping ;
- une erreur POST ou PUT se retente explicitement.

## Concurrence et visibilité

Les invariants du renderer sont :

- fermer une modale ne peut jamais la rouvrir à la réception d'un résultat
  tardif ;
- le résultat tardif d'une offre A ne remplace jamais l'état visible d'une
  offre B ;
- la dernière opération visible gagne ;
- une offre retournée par le serveur peut mettre à jour l'élément correspondant
  dans la liste, car le résultat serveur est autoritatif ;
- l'état visible reste lié à l'offre actuellement sélectionnée.

## FUTURE

Le futur enchaînement envisagé est :

```text
READY
-> OfferAnalyzer
-> représentation structurée de candidature / ApplicationBrief
-> génération
```

`OfferAnalyzer`, `ApplicationBrief` et la génération ne sont pas implémentés.
Leurs contrats exacts ne sont pas figés.
