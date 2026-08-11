# Architecture du contenu d'offre

## Statut et portée

Ce document est la référence normative du contenu d'offre implémenté. Il fixe
la représentation de `OfferContent`, sa provenance, son merge non destructif,
les politiques d'acquisition au niveau contenu et l'évaluation de suffisance.
L'identité et la persistance des observations sont résumées dans la
[fondation des données](./offer-data-foundation.md). L'orchestration est définie
dans le [flux de préparation](./offer-preparation-flow.md).

Les constats qui motivent ces décisions sont documentés dans
[`docs/offer-content-audit.md`](./offer-content-audit.md). Ce document d'audit
reste la source de vérité factuelle concernant France Travail, Careerjet,
Adzuna et HelloWork. Les politiques décrites ici reposent sur ces observations
et devront être réévaluées si les fournisseurs changent leur API, leur HTML ou
la nature du contenu exposé.

Cette architecture distingue quatre catégories :

- **Invariant architectural** : règle qui protège l'identité ou les données et
  ne doit pas être contournée par une optimisation locale.
- **Choix MVP** : solution volontairement minimale, susceptible d'évoluer sans
  remettre en cause les invariants.
- **Compatibilité temporaire** : comportement conservé pendant la transition
  afin de ne pas imposer une refonte simultanée du serveur et du desktop.
- **Évolution future** : extension prévue mais non requise pour la première
  implémentation.

`OfferContent` et `OfferContentEvaluator` sont **IMPLEMENTED**. `OfferAnalyzer`,
`ApplicationBrief` et la génération de candidature restent **FUTURE** ; leurs
contrats ne sont pas figés par ce document.

## Principes architecturaux

### `JobOffer` est une observation fournisseur

**Invariant architectural.** Un `JobOffer` représente une observation obtenue
auprès d'un fournisseur déterminé. Il ne représente plus une offre canonique
issue de la fusion de plusieurs fournisseurs.

Un même poste réel publié simultanément chez France Travail, Adzuna et
Careerjet produit trois `JobOffer` et trois lignes SQLite. Chaque observation
conserve sa propre identité, son URL de candidature, son contenu et ses dates.

### Identité et similarité sont distinctes

L'identité fournisseur répond à la question : « s'agit-il de la même annonce
chez ce fournisseur ? ». La déduplication cross-provider répond à la question :
« ces observations semblent-elles décrire le même poste réel ? ».

**Invariant architectural.** Une clé exacte de déduplication, un regroupement
sémantique ou une décision LLM ne constitue jamais une identité. Ces mécanismes
ne peuvent provoquer ni suppression, ni fusion irréversible, ni écrasement
d'observations persistées.

Au MVP, le regroupement cross-provider est une projection calculée. Il n'a pas
d'identité persistante et peut être recalculé lorsque les règles évoluent.

### Contenu persistant et projections légères

Le contenu complet est persisté sur l'observation fournisseur. La liste, la
déduplication et `SemanticRefiner` utilisent des projections dédiées et
bornées. La présence d'un texte de plusieurs milliers de caractères en base ne
doit jamais entraîner sa transmission automatique complète à React ou à un
LLM.

## Identité d'un `JobOffer`

Le modèle cible porte les attributs d'identité suivants :

```text
JobOffer {
  id,
  source,
  sourceId,
  identityKind,
  surrogateKey,
  surrogateMatchable,
  ...
}
```

### Identifiant interne Jobify

`id` est l'identité interne persistante de Jobify :

- colonne SQLite `INTEGER PRIMARY KEY` ;
- générée par SQLite lors de l'`INSERT` ;
- `number|null` en JavaScript ;
- `null` avant la première persistance ;
- stable pendant toute la vie de la ligne ;
- indépendante de la source, du `sourceId`, du surrogate et du regroupement
  cross-provider.

Les opérations métier ciblent toujours cet identifiant interne :

- consultation d'un détail persistant ;
- enrichissement d'une observation ;
- ajout d'un texte utilisateur ;
- remplacement d'un override utilisateur ;
- **FUTURE** : suppression explicite d'un override utilisateur.

Le client ne peut pas désigner arbitrairement une cible en fournissant une
combinaison `source`, `sourceId` ou URL. Il transmet un `id` interne ; le
serveur charge l'observation correspondante et valide lui-même sa source, son
URL et les opérations permises.

### Identité externe

`sourceId` est l'identifiant externe fourni par la source. Il est nullable.
`identityKind` vaut :

- `STABLE` lorsqu'une identité fournisseur exploitable est disponible ;
- `SURROGATE` lorsqu'aucune identité stable n'est démontrée et que Jobify doit
  utiliser une empreinte conservatrice.

Les politiques validées sont :

- France Travail : `(source, sourceId)` avec `raw.id`, identité `STABLE` ;
- Adzuna : `(source, sourceId)` avec `raw.id`, identité `STABLE` ;
- HelloWork : `(source, sourceId)` avec le `sourceId` obtenu en SEARCH,
  identité `STABLE` ;
- Careerjet : `sourceId = null`, identité `SURROGATE`.

Pour HelloWork, `applyUrl`, l'`identifier` JSON-LD et `JobPosting.url` sont des
signaux de rattachement du DETAIL. Ils ne remplacent pas automatiquement le
`sourceId` SEARCH.

### Hydratation et sérialisation

Deux chemins doivent être séparés :

- `JobOffer.fromJson(json)` traite une entrée externe non fiable et ignore
  toujours un éventuel `json.id` ;
- `JobOffer.fromPersistence(id, payload)` est réservé au repository et reçoit
  l'identifiant provenant de SQLite.

La colonne `offers.id` est la source de vérité. Le payload JSON SQLite ne la
duplique pas. Une représentation API peut en revanche exposer `id` afin de
permettre les opérations métier ultérieures.

Cette séparation garantit notamment qu'une observation Careerjet reste
adressable sans ambiguïté après son insertion, même sans `sourceId` stable.

## Identité surrogate Careerjet

L'audit a établi que `raw.url`, actuellement utilisé comme `sourceId`, varie
entre des recherches comparables. Le MVP ne suppose donc aucune identité
officielle stable Careerjet.

Le modèle Careerjet est :

```text
source = careerjet
sourceId = null
identityKind = SURROGATE
surrogateKey = empreinte déterministe
surrogateMatchable = booléen d'éligibilité au rapprochement
```

### Calcul du surrogate

Le matériau canonique contient exactement :

1. le titre normalisé ;
2. l'entreprise normalisée ;
3. le lieu normalisé ;
4. le jour UTC de publication au format `YYYY-MM-DD` ;
5. le SHA-256 de la description normalisée.

`raw.url` et `applyUrl` sont exclus du surrogate.

La normalisation suit ces règles :

- `TextNormalizer.slug()` pour le titre, l'entreprise et le lieu ;
- le lieu utilise la ville, puis le libellé en fallback ;
- la description HTML est convertie en texte ;
- ses espaces sont réduits ;
- sa casse et ses diacritiques sont normalisés ;
- le texte normalisé complet est haché en SHA-256 ;
- les cinq signaux sont assemblés sans ambiguïté, puis le composite final est
  lui-même haché en SHA-256 pour former `surrogateKey`.

`surrogateMatchable` vaut `true` uniquement si le titre, l'entreprise, le lieu,
le jour de publication et la description non vide sont tous disponibles. Une
observation incomplète peut porter une empreinte à des fins de diagnostic,
mais ne peut déclencher un UPDATE automatique.

### Persistance Careerjet

`surrogateKey` est indexé mais n'est pas `UNIQUE`. Aucun `ON CONFLICT` ne doit
l'utiliser pour remplacer une ligne.

Dans la transaction d'upsert, le repository recherche les observations
Careerjet `SURROGATE` qui possèdent exactement le même `surrogateKey` :

- surrogate non matchable : `INSERT` ;
- zéro candidat : `INSERT` ;
- exactement un candidat : `UPDATE` de cette ligne ;
- plusieurs candidats : ambiguïté, aucun candidat n'est modifié et une
  nouvelle ligne est insérée.

Lors d'un UPDATE, `id` et `firstSeenAt` sont conservés, `lastSeenAt` est
actualisé et `applyUrl` peut être rafraîchi. Le contenu suit séparément les
règles de merge non destructif.

**Choix MVP.** Une ambiguïté produit un doublon plutôt qu'une fusion
potentiellement incorrecte. Une modification de description ou de
`fragment_size` peut également modifier le surrogate et créer une nouvelle
ligne. Ces doublons éventuels sont un compromis assumé ; leur réconciliation
automatique est hors périmètre.

## Persistance SQLite

Le schéma cible conceptuel est :

```text
offers (
  id INTEGER PRIMARY KEY,
  source,
  source_id,
  identity_kind,
  surrogate_key,
  payload,
  first_seen_at,
  last_seen_at,
  dedup_key
)
```

Pour les identités `STABLE`, le repository retrouve une observation par
`(source, sourceId)`. Careerjet applique l'algorithme conservateur précédent.
Chaque observation valide est persistée individuellement.

**Invariant architectural.** L'unicité d'une identité fournisseur `STABLE`
doit également être protégée par la base, afin qu'une concurrence ou un bug du
repository ne puisse créer deux lignes pour la même identité France Travail,
Adzuna ou HelloWork. La contrainte ou l'index unique doit être conceptuellement
équivalent à :

```text
UNIQUE(source, source_id)
WHERE identity_kind = 'STABLE'
```

La migration utilisera le mécanisme SQLite approprié plutôt que de supposer ici
une syntaxe d'implémentation non vérifiée. Les identités Careerjet `SURROGATE`
sont explicitement exclues de cette unicité : `surrogateKey` reste indexé mais
non unique.

Les opérations de persistance retournent les `JobOffer` persistés et hydratés
avec leur id interne :

```js
const persistedObservations = await repository.upsertMany(observations);
```

Après un INSERT, une observation reçue avec `id: null` est retournée avec l'id
généré par SQLite. Après l'UPDATE d'une identité connue, l'observation retournée
porte l'id persistant existant. Le repository ne dépend pas d'une mutation
implicite et silencieuse des objets reçus : son résultat constitue le contrat
explicite utilisé par la suite du pipeline, puis par la `GroupProjection`, le
DETAIL, l'enrichissement et `USER_PASTE`.

`dedup_key` n'est plus une identité et n'est plus la clé primaire. Il devient
seulement un signal ou un index de similarité susceptible de regrouper
plusieurs observations, y compris plusieurs observations d'un même
fournisseur.

La migration depuis le schéma historique doit préserver toutes les lignes
existantes et leurs timestamps. Elle ne peut pas reconstruire les observations
déjà éliminées ou écrasées par l'ancien pipeline ; cette perte historique doit
rester explicitement admise.

## Ordre du pipeline

### Transition sans rupture de l'API

Le flux transitoire est :

```text
connecteurs serveur + HelloWork injecté
→ observations fournisseur
→ filtre individuel de récence
→ persistance de toutes les observations
→ déduplication exacte
→ SemanticRefiner
→ réponse API historique
→ React actuel
```

**Invariant architectural.** La persistance intervient avant toute
déduplication cross-provider. Cela arrête la perte d'observations sans imposer
immédiatement une modification coordonnée du pipeline agrégé, de l'API et de
React.

**Compatibilité temporaire.** La réponse historique peut continuer à choisir
une observation représentative et à exposer des `alternates`. Ce résultat
agrégé ne détermine plus ce qui est persisté.

### Cible FUTURE : `GroupProjection`

```text
observations persistées
→ GroupProjection calculée
→ React
```

Une future `GroupProjection` pourra remplacer le regroupement historique
lorsque l'API et le desktop évolueront ensemble. Son contrat n'est pas figé.

## Modèle `OfferContent` — IMPLEMENTED

Le modèle MVP est :

```text
OfferContent {
  automaticText,
  userText,
  structured
}
```

Le modèle ne conserve pas un historique complet. Il distingue le meilleur
texte automatique, l'éventuel override utilisateur et un snapshot structuré.

`getEffectiveText()` retourne `userText.value` lorsqu'il existe, sinon
`automaticText.value`. Cette priorité ne modifie pas la représentation
automatique : `JobOffer.description` expose uniquement `automaticText.value`.
Un texte utilisateur ne remplace ni ne dégrade jamais le texte automatique et
n'est jamais exposé par ce champ.

### Texte automatique

```text
automaticText {
  value,
  acquisition,
  retrievedAt,
  completeness
}
```

`acquisition` vaut `SEARCH` ou `DETAIL`.

`completeness` décrit uniquement ce qui est techniquement connu du canal
fournisseur :

- `PROVIDER_FULL` : représentation complète exposée par le canal fournisseur
  considéré, sans troncature technique connue ;
- `KNOWN_TRUNCATED` : texte connu comme extrait ou tronqué ;
- `UNKNOWN` : aucune conclusion fiable sur une éventuelle troncature.

`PROVIDER_FULL` ne signifie ni que l'annonce est exhaustive, ni qu'elle est de
bonne qualité, ni que son contenu est suffisant pour préparer une candidature.
Cette suffisance relève de `OfferContentEvaluator` et reste indépendante de la
complétude fournisseur.

Les politiques actuellement implémentées, issues des observations d'audit,
sont :

- France Travail : SEARCH, `PROVIDER_FULL` ;
- Adzuna : SEARCH, `KNOWN_TRUNCATED` ;
- Careerjet : SEARCH avec `fragment_size=10000`, `UNKNOWN` ;
- HelloWork : SEARCH sans texte automatique exploitable, puis DETAIL acquis par
  Electron et persisté `PROVIDER_FULL` lorsqu'une acquisition valide aboutit.

Ces classifications sont des politiques révisables si les fournisseurs
changent. Elles ne transforment pas les échantillons d'audit en garantie
universelle.

### Texte utilisateur

```text
userText {
  value,
  providedAt
} | null
```

Le texte effectif est `userText.value` lorsqu'un override existe, sinon
`automaticText.value`.

`USER_PASTE` est une autorité utilisateur explicite, pas un niveau dans une
échelle de qualité automatique. Une récupération automatique peut continuer à
améliorer `automaticText`, mais elle ne remplace et ne masque jamais
`userText`. Une action explicite de l'utilisateur peut remplacer cet override.
Sa suppression explicite reste **FUTURE**.

### Merge du texte automatique

Le remplacement de `automaticText` est déterministe :

1. `PROVIDER_FULL` est préféré à `UNKNOWN`, lui-même préféré à
   `KNOWN_TRUNCATED` ;
2. à complétude identique, `DETAIL` est préféré à `SEARCH` ;
3. à complétude et acquisition identiques, le timestamp valide le plus récent
   gagne ;
4. à égalité, l'existant gagne ;
5. une observation plus fraîche ne peut pas provoquer une dégradation.

La longueur du texte n'établit jamais sa complétude et ne participe pas à ce
classement.

Un DETAIL `PROVIDER_FULL` dont le texte est strictement identique à un DETAIL
`PROVIDER_FULL` existant est un no-op : `retrievedAt` seul ne provoque pas une
écriture. En revanche, le même texte DETAIL précédemment classé `UNKNOWN` ou
`KNOWN_TRUNCATED` peut être persisté de nouveau afin de devenir
`PROVIDER_FULL`.

### Snapshot structuré

```text
structured {
  value,
  acquisition,
  retrievedAt
} | null
```

**Choix MVP.** `structured` est un snapshot atomique issu d'une seule
observation. Aucun merge champ par champ n'est effectué entre des snapshots de
provenances différentes, afin de ne pas produire artificiellement un ensemble
dont la provenance serait fausse.

La règle de remplacement est minimale :

- absence de snapshot : le nouveau snapshot non vide est conservé ;
- `SEARCH` puis `DETAIL` : le DETAIL remplace le SEARCH ;
- `DETAIL` puis `SEARCH` : le DETAIL reste ;
- même canal : le snapshot le plus récent gagne ;
- un snapshot vide ou `null` n'efface pas un snapshot non vide.

La richesse apparente, le nombre de champs et la longueur des tableaux ne sont
pas des critères de comparaison au MVP.

## `OfferContentEvaluator` — IMPLEMENTED

`OfferContentEvaluator` détermine à la demande si le texte effectif contient
assez de matière pour poursuivre une future préparation de candidature. Il est
pur, déterministe, sans LLM et utilise `getEffectiveText()`, donc le texte
utilisateur lorsqu'il existe.

La distinction suivante est normative :

```text
provider completeness != application sufficiency
```

La politique courante porte la version
`offer-content-sufficiency-v1`. Elle retourne `SUFFICIENT`, `INSUFFICIENT` ou
`UNDETERMINED`, accompagnés de raisons et des métriques :

- `characterCount` ;
- `wordCount` ;
- `distinctWordCount` ;
- `repeatedFiveGramShare`.

La décision V1 est appliquée dans cet ordre :

1. l'absence de texte produit `INSUFFICIENT` avec `MISSING_TEXT` ;
2. si `characterCount < 300`, ou `wordCount < 40`, ou
   `distinctWordCount < 30`, le contenu reçoit `TOO_SHORT` ;
3. un texte égal, après la normalisation prévue, à l'un des placeholders V1
   reçoit `PLACEHOLDER_CONTENT` ;
4. si `repeatedFiveGramShare >= 0.80`, le contenu reçoit
   `HIGHLY_REPETITIVE` ;
5. la présence d'au moins une de ces raisons produit `INSUFFICIENT` ;
6. sinon, si `characterCount >= 800`, et `wordCount >= 120`, et
   `distinctWordCount >= 80`, le contenu est `SUFFICIENT` ;
7. dans tous les autres cas, il est `UNDETERMINED`.

Les placeholders V1 exacts sont : `description non disponible`,
`description indisponible`, `contenu non disponible`, `contenu indisponible`,
`voir l'annonce`, `consulter l'annonce`, `voir l'offre`, `consulter l'offre` et
`cliquez ici pour voir l'annonce`. Une ponctuation terminale et les variantes
d'apostrophe prévues par la normalisation ne changent pas leur reconnaissance.

Une décision `SUFFICIENT` porte la raison `SUFFICIENT_TEXT_VOLUME` et une
décision `UNDETERMINED` la raison `INTERMEDIATE_CONTENT`. Les métriques d'un
texte absent valent zéro et indiquent la source `NONE`. La complétude et le
canal d'acquisition sont exposés à titre diagnostique mais ne prennent pas part
à la décision.

## Données spécifiques aux fournisseurs

Le MVP n'introduit pas :

- de `providerData` générique ;
- de `providerReferences` ;
- de payload fournisseur brut persistant.

Chaque donnée conservée doit avoir une destination métier explicite : identité
fournisseur, URL de candidature, champ canonique ou snapshot structuré. Les
données techniques, les duplications de champs canoniques et les informations
sans usage établi ne sont pas stockées « au cas où ».

Les références aux autres fournisseurs vivent dans une projection de groupe,
pas dans chaque observation persistée.

## Évolution de `alternates`

`JobOffer.alternates` est legacy dans l'architecture cible.

**Compatibilité temporaire.** Il peut rester présent afin de préserver la
forme de l'API et le comportement React pendant les premières étapes. Il sera
supprimé lorsque la `GroupProjection` remplacera le regroupement historique.
Il ne doit recevoir aucune nouvelle responsabilité persistante.

## Projections

Les projections suivantes sont conceptuellement distinctes :

- projection légère de liste : attributs nécessaires aux cartes et résumé
  borné ;
- projection `SemanticRefiner` : signaux de déduplication et de pertinence,
  avec texte strictement borné ;
- projection de détail : contenu effectif et attributs nécessaires à la vue ;
- future `GroupProjection` : projection calculée regroupant plusieurs
  observations équivalentes, destinée à remplacer progressivement le mécanisme
  legacy `alternates`. Son contrat exact reste à définir.

**Invariant architectural.** Le `OfferContent` complet persistant ne doit
jamais être automatiquement sérialisé en entier dans le prompt de
`SemanticRefiner`. La projection doit appliquer une limite explicite,
configurée et testée.

## État d'implémentation

Les étapes suivantes sont **IMPLEMENTED** :

1. formaliser l'identité de `JobOffer`, l'id interne et les chemins
   d'hydratation ;
2. migrer SQLite et adapter le repository pour conserver une ligne par
   observation fournisseur ;
3. persister les observations avant la déduplication tout en conservant
   temporairement les réponses API et React existantes ;
4. `OfferContent` et ses règles de merge non destructif ;
5. `OfferContentEvaluator` et la politique de suffisance V1.

Careerjet utilise désormais `fragment_size=10000`. La projection utilisée par
`SemanticRefiner` est explicitement bornée et couverte par des tests avec des
descriptions longues. Le stockage d'un contenu riche n'autorise pas sa
propagation implicite dans le contexte LLM.

## Évolutions FUTURE

Les sujets suivants ne sont pas implémentés et leurs contrats ne sont pas
figés :

- `OfferAnalyzer` ;
- `ApplicationBrief` ;
- génération de lettre, message ou autre texte de candidature ;
- évolution éventuelle de la politique de suffisance après V1 ;
- suppression explicite d'un `userText` ;
- `GroupProjection` et retrait des `alternates` historiques ;
- historique complet des versions ;
- déduplication persistante sophistiquée ;
- réconciliation automatique des doublons Careerjet.

Ils devront s'appuyer sur les identités et le contenu définis ici sans en
affaiblir les invariants de persistance et de non-dégradation.
