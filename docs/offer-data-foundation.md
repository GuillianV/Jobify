# Offer data foundation

Cette fondation permet à Jobify d'exploiter le contenu des offres sans confondre
identité fournisseur, persistance et déduplication d'affichage. Un `JobOffer`
représente toujours une observation fournisseur, jamais une offre canonique
fusionnant plusieurs sources.

## Les trois responsabilités

Jobify distingue :

1. **Identité fournisseur** : reconnaître une même annonce au sein d'une
   source.
2. **Persistance** : conserver chaque observation fournisseur dans SQLite.
3. **Déduplication d'affichage** : calculer la représentation présentée par
   l'API et le desktop.

```text
identité fournisseur
!= persistance
!= déduplication d'affichage
```

## Identité des observations

Chaque observation persistée possède un `id` interne généré par SQLite.
`offers.id INTEGER PRIMARY KEY` est l'identité interne autoritative de
l'observation persistée. France Travail, Adzuna et HelloWork ont une identité
`STABLE`, fondée sur `(source, sourceId)`.

Careerjet utilise une identité `SURROGATE`, car son URL n'est pas suffisamment
stable. Son empreinte combine plusieurs signaux de l'offre. Si plusieurs lignes
correspondent, Jobify insère une nouvelle observation plutôt que de risquer une
fusion incorrecte. Le calcul et les règles d'upsert sont décrits dans
[l'architecture du contenu](./offer-content-architecture.md).

## Persistance par observation fournisseur

`dedup_key` est un signal de similarité, pas une identité. Chaque observation
fournisseur possède sa propre ligne, même lorsque plusieurs sources semblent
décrire le même emploi.

```text
France Travail -> observation #101
Careerjet      -> observation #205

Même emploi possible, deux observations conservées.
```

La persistance intervient avant toute déduplication cross-provider :

```text
observations fournisseurs
-> filtre individuel de récence
-> persistance de toutes les observations récentes
-> déduplication exacte
-> rapprochements déterministes évidents
-> raffinement sémantique gardé
-> tri
-> réponse API
```

La déduplication décide uniquement quelle représentation est retournée. Une
observation écartée de la liste reste disponible dans SQLite. Les scores et
regroupements sémantiques sont non destructifs et leur cache est persistant ;
ils ne suppriment ni ne fusionnent les observations fournisseur.

## Politique de déduplication

Le pipeline applique successivement :

- une déduplication exacte ;
- des règles déterministes pour les équivalences évidentes ;
- un raffinement sémantique optionnel, protégé par des gardes cross-provider.

La politique est conservatrice : un faux négatif, qui conserve deux cartes
possiblement équivalentes, est préférable à un faux positif qui masquerait ou
fusionnerait abusivement deux offres. Un score sémantique n'est jamais un filtre
destructif.

Les rapprochements cross-provider ne deviennent pas une identité persistante.
Ils restent une projection calculée qui peut évoluer et être recalculée.

## Choix du représentant

Careerjet utilise actuellement `fragment_size=10000` et peut porter un contenu
SEARCH riche, de complétude technique `UNKNOWN`. Il peut représenter une offre
lorsqu'il est la seule observation disponible. Lorsqu'un groupe contient une
observation équivalente non-Careerjet, Careerjet reste persisté mais n'est pas
choisi comme représentant.

Aucune priorité globale supplémentaire ne départage France Travail, Adzuna et
HelloWork. Cette règle de représentation reste indépendante de l'identité et de
la conservation des lignes.

## Base et interface

```text
Base SQLite      -> conserve les observations fournisseur
Interface et API -> présentent une projection dédupliquée
```

La version affichée n'est donc pas la seule version disponible en base. Les
`alternates` actuels restent une compatibilité transitoire ; une éventuelle
`GroupProjection` est **FUTURE** et son contrat n'est pas figé.

## Raccord avec la préparation

Chaque observation persistée porte désormais un `OfferContent` non destructif.
Son texte effectif est évalué à la demande, puis le flux de préparation décide
s'il faut acquérir un DETAIL fournisseur ou demander un texte utilisateur :

```text
OfferContent -> OfferContentEvaluator -> préparation
```

Voir [l'architecture du contenu](./offer-content-architecture.md) pour le modèle
et l'évaluation, puis le [flux de préparation](./offer-preparation-flow.md) pour
l'orchestration serveur, desktop et Electron.

`OfferAnalyzer`, `ApplicationBrief` et la génération de candidature restent
**FUTURE**.
