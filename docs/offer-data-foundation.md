# Offer data foundation

Cette évolution prépare Jobify à exploiter de manière fiable le contenu des
offres, notamment pour les futures fonctionnalités de préparation de
candidature et de génération de lettres de motivation.

Auparavant, identité, persistance et déduplication étaient trop liées. Des
observations provenant de plusieurs fournisseurs pouvaient être éliminées par
la déduplication avant même leur persistance.

## Les trois concepts séparés

Jobify distingue désormais trois responsabilités :

1. **Identité fournisseur** : reconnaître une même annonce au sein d'une source.
2. **Persistance** : conserver chaque observation fournisseur dans SQLite.
3. **Déduplication d'affichage** : choisir la représentation retournée par
   l'API et présentée dans l'interface.

```text
identité fournisseur
≠ persistance
≠ déduplication d'affichage
```

Un `JobOffer` représente donc toujours une observation fournisseur, et non une
offre canonique fusionnant plusieurs sources.

## 1. Identité des observations

Chaque observation persistée possède un `id` interne généré par SQLite. France
Travail, Adzuna et HelloWork ont une identité `STABLE`, fondée sur
`(source, sourceId)`.

Careerjet utilise une identité `SURROGATE`, car son URL n'est pas suffisamment
stable pour servir d'identifiant. Son empreinte combine plusieurs signaux de
l'offre. Si plusieurs observations correspondent à cette empreinte, Jobify
préfère conserver un doublon plutôt que risquer de fusionner deux offres
différentes. Le détail du calcul est décrit dans la
[documentation d'architecture](./offer-content-architecture.md).

## 2. Persistance par observation fournisseur

`dedup_key` n'est plus la clé primaire de `offers` : il reste uniquement un
signal de similarité. Chaque observation fournisseur possède sa propre ligne,
même lorsque plusieurs sources semblent décrire le même emploi.

```text
France Travail → observation #101
Careerjet      → observation #205

Même emploi possible, deux observations conservées.
```

## 3. Persistance avant déduplication

Le pipeline actuel suit cet ordre :

```text
observations fournisseurs
→ filtre de récence
→ persistance de toutes les observations récentes
→ déduplication exacte
→ raffinage et déduplication sémantique
→ tri
→ réponse API
```

La déduplication ne décide plus ce qui existe en base. Elle décide seulement
quelle représentation est retournée à l'utilisateur. Une observation écartée
ensuite par la déduplication ou la pertinence peut donc rester conservée dans
SQLite.

## 4. Choix du représentant

Careerjet peut représenter une offre lorsqu'il est la seule source disponible.
S'il est regroupé avec au moins une autre source, il reste persisté mais n'est
pas choisi comme représentant. Aucune priorité globale supplémentaire ne
départage France Travail, Adzuna et HelloWork.

Cette règle tient au contenu Careerjet actuellement récupéré par Jobify,
généralement plus tronqué et moins exploitable pour l'affichage. Elle est
transitoire : une logique générique fondée sur la qualité et la complétude du
contenu pourra la remplacer.

## 5. Base et interface

```text
Base SQLite            → conserve les observations fournisseur
Interface et API       → présentent une liste dédupliquée
```

La version affichée d'une offre n'est donc pas la seule version disponible en
base.

## 6. Pourquoi cette fondation est nécessaire pour les candidatures

Pour analyser une annonce et préparer une lettre de motivation, Jobify ne doit
pas dépendre uniquement de l'observation choisie pour afficher une carte. Cette
fondation permettra de :

- comparer plusieurs contenus disponibles ;
- conserver une version riche lorsqu'elle existe ;
- récupérer éventuellement un détail plus complet ;
- empêcher qu'un contenu pauvre remplace un contenu meilleur ;
- prendre en compte un texte fourni manuellement par l'utilisateur ;
- sélectionner le contenu le plus pertinent avant l'analyse de l'offre.

Elle ne met pas encore en œuvre la génération de candidature.

## 7. Prochaine étape

La prochaine étape architecturale est `OfferContent`, un modèle prévu autour de
trois notions :

- `automaticText` pour le meilleur texte acquis automatiquement ;
- `userText` pour un éventuel texte fourni par l'utilisateur ;
- `structured` pour les données structurées utiles de l'annonce.

Ses règles de merge devront être non destructives afin qu'une nouvelle donnée
plus pauvre ne dégrade pas un contenu déjà acquis. `OfferContent` et la future
`GroupProjection` ne sont pas encore implémentés ; les `alternates` actuels
restent un mécanisme legacy et transitoire.

La [documentation d'architecture](./offer-content-architecture.md) reste la
source normative pour les décisions et détails techniques.
