# Audit du contenu des offres

## Statut et objectif

Ce document constitue la source de vérité factuelle de la phase d'audit des descriptions d'offres menée avant la conception de la fonctionnalité « Préparer ma candidature ».

> **État observé lors de l'audit du 9 août 2026.** Les mesures, comportements
> présents et décisions encore ouvertes ci-dessous décrivent le système à cette
> date. Plusieurs limites ont depuis été résolues. Elles restent formulées ici
> dans leur contexte historique afin de ne pas réécrire rétroactivement les
> observations.

Les audits visaient à déterminer, fournisseur par fournisseur :

- la nature du contenu réellement disponible dans SEARCH et, lorsqu'il existe, dans DETAIL ;
- les différences empiriques entre ces représentations ;
- les données perdues lors du mapping vers `JobOffer` ;
- les limites d'identité, de déduplication et de persistance du pipeline actuel.

**Date de synthèse :** 9 août 2026<br>
**Commit des outils d'audit :** `f6b9331`

Les chiffres ci-dessous proviennent des exécutions d'audit réalisées. Les rapports JSON complets et les descriptions intégrales ne sont pas reproduits ici.

Le document distingue trois niveaux :

1. **Observations empiriques / faits** : résultats directement mesurés ou comportements établis par le code actuel.
2. **Implications probables** : conséquences plausibles à prendre en compte dans la prochaine phase.
3. **Décisions encore ouvertes** : choix d'architecture qui ne sont pas tranchés par les audits.

## Résultats d'implémentation depuis l'audit

Depuis cet état observé, Jobify a implémenté les décisions suivantes :

- `OfferContent` conserve séparément texte automatique, texte utilisateur et
  snapshot structuré, avec un merge automatique non destructif ;
- Careerjet demande désormais `fragment_size=10000` en SEARCH et classe la
  complétude technique du texte comme `UNKNOWN` ;
- le DETAIL HelloWork est acquis par Electron sur instruction du serveur, puis
  persisté comme `PROVIDER_FULL` ;
- `OfferContentEvaluator` évalue à la demande et sans LLM la suffisance du texte
  effectif ;
- le serveur et le desktop implémentent le flux « Préparer ma candidature » ;
- le texte fourni par l'utilisateur est persisté séparément du texte
  automatique ;
- l'ouverture de `OfferDetail` est désormais read-only et ne déclenche aucune
  acquisition.

Les règles normatives sont décrites dans
[l'architecture du contenu](./offer-content-architecture.md), le
[flux de préparation](./offer-preparation-flow.md) et la
[fondation des données](./offer-data-foundation.md). Les sections « décisions
encore ouvertes » du présent document restent celles de la date d'audit.

## Synthèse

| Fournisseur | SEARCH | DETAIL ou enrichissement | Point principal |
| --- | --- | --- | --- |
| France Travail | Description et données structurées riches | Aucun gain observé sur 16 comparaisons réussies | Les pertes importantes se trouvent dans le mapping SEARCH vers `JobOffer` |
| Careerjet | Taille configurable avec `fragment_size` | Pas de DETAIL audité ; `10000` est la valeur la plus riche testée | `raw.url`, utilisé comme `sourceId`, s'est révélé instable entre recherches |
| Adzuna | Snippet tronqué de 500 caractères sur 50 offres | Aucun endpoint public DETAIL identifié | SEARCH ne fournit pas une description riche ; une collision de clé de déduplication a été observée |
| HelloWork | Aucune description dans les cartes SEARCH | JSON-LD riche sur 9 des 10 DETAIL chargés | Le contenu DETAIL est riche mais non garanti et n'est actuellement pas persisté |

## France Travail

### Observations empiriques / faits

L'objectif était de déterminer si `GET /v2/offres/{id}` fournissait une description ou des propriétés plus riches que `GET /v2/offres/search`. Le contrat officiel utilise le même modèle `Offre` pour les items SEARCH et le DETAIL.

Deux exécutions ont été réalisées :

- première exécution : 2 offres SEARCH, 2 DETAIL réussis et 2 descriptions strictement identiques ;
- seconde exécution, avec « développeur » à Paris : 100 résultats SEARCH, 20 DETAIL sélectionnés, 14 réussites et 6 réponses HTTP 429 ; les 14 descriptions comparables étaient strictement identiques.

Au total :

- 16 comparaisons SEARCH/DETAIL réussies ;
- 16 descriptions sur 16 strictement identiques ;
- aucun chemin uniquement présent dans DETAIL ou uniquement présent dans SEARCH parmi les réponses réussies.

Les payloads SEARCH observés contenaient déjà, selon les offres, des données telles que :

- compétences ;
- expérience ;
- formations ;
- langues ;
- qualités professionnelles ;
- contexte de travail ;
- entreprise ;
- salaire.

Le mapping actuel vers `JobOffer` n'en conserve qu'une partie.

### Implications probables

- Ajouter un appel DETAIL uniquement pour améliorer la description France Travail augmenterait le coût et le risque de limitation HTTP sans bénéfice observé.
- La prochaine réflexion devrait porter prioritairement sur la conservation des données structurées déjà disponibles dans SEARCH.
- Les réponses HTTP 429 montrent qu'un éventuel usage futur de DETAIL devrait rester limité et gérer explicitement le débit.

### Décisions encore ouvertes

L'audit ne décide pas quels champs France Travail doivent devenir canoniques, ni sous quelle forme ils doivent être stockés.

## Careerjet

### Observations empiriques / faits

L'audit a mesuré l'effet du paramètre legacy `fragment_size` sur les descriptions SEARCH. Les variantes testées étaient : contrôle, `120`, `500`, `1000`, `3000`, `5000` et `10000`.

L'échantillon comparable commun comprenait 34 offres. Les longueurs normalisées moyennes observées étaient approximativement :

| Variante | Longueur moyenne |
| --- | ---: |
| contrôle | 242 |
| `120` | 242 |
| `500` | 929 |
| `1000` | 1 716 |
| `3000` | 3 256 |
| `5000` | 3 858 |
| `10000` | 4 051 |

Le comportement actuel était équivalent à environ `fragment_size=120`.

Entre `5000` et `10000` :

- 27 descriptions sur 34 étaient identiques ;
- 7 descriptions sur 34 changeaient encore à `10000`.

`10000` est donc la valeur la plus riche testée. La longueur brute maximale observée avec cette variante restait inférieure à 10 000 caractères sur cet échantillon.

Pour les 34 offres communes, les descriptions se terminaient par une ellipse pour toutes les variantes testées. Une ellipse finale ne permet donc pas, à elle seule, de déterminer la complétude d'une description Careerjet.

Autre résultat important : `raw.url` variait entre des appels SEARCH pour une même offre, alors que Jobify l'utilise actuellement comme `sourceId`. L'audit a dû utiliser une identité composite déterministe pour comparer les variantes entre requêtes. Cette identité était propre à l'expérience et ne constitue pas une décision de modèle de production.

### Implications probables

- `fragment_size` permet réellement de récupérer plusieurs milliers de caractères supplémentaires.
- Faire circuler systématiquement ces descriptions longues dans la recherche, la liste, la déduplication et `SemanticRefiner` augmenterait fortement le volume traité.
- L'identité fournisseur Careerjet doit être traitée séparément de la déduplication entre fournisseurs.

### Décisions encore ouvertes

L'audit ne décide ni d'utiliser définitivement `fragment_size=10000`, ni du moment où une description longue devrait être récupérée ou injectée dans le pipeline, ni du remplacement de l'identité Careerjet actuelle.

## Adzuna

### Observations empiriques / faits

Une recherche réelle a été effectuée avec « développeur », Paris, une distance de 10 km, la page 1 et `results_per_page=50`.

Le résultat contenait 50 offres et une métadonnée top-level `count` égale à 2 786.

Descriptions :

- 50 sur 50 présentes ;
- 50 sur 50 d'une longueur exacte de 500 caractères ;
- 50 sur 50 terminées par une ellipse ;
- aucune détection de contenu HTML-like ;
- aucune différence de longueur après normalisation HTML comparative.

Ces descriptions SEARCH étaient donc des snippets tronqués dans l'échantillon observé.

Identité :

- 50 identifiants, tous de type chaîne ;
- aucun identifiant absent, `null` ou vide ;
- 50 identifiants uniques ;
- aucune collision de coercition ;
- mapping `raw.id` vers `sourceId` correct pour 50 offres sur 50.

Déduplication :

- 49 clés exactes uniques ;
- une collision de clé entre deux `raw.id` distincts ;
- deux offres concernées.

Cette collision ne démontre pas que la fusion est incorrecte. Elle démontre que la clé de déduplication actuelle n'est pas équivalente à l'identité fournisseur.

Les 50 `redirect_url` avaient pour host `www.adzuna.fr`. Aucune redirection n'a été suivie et aucun site final n'a été scrapé.

Parmi les chemins observés mais non consommés par le mapping actuel figuraient notamment :

- `category.label` ;
- `category.tag` ;
- `salary_is_predicted` ;
- `contract_time` ;
- quelques champs techniques.

Aucun endpoint public DETAIL n'a été identifié dans le cadre de cet audit. `redirect_url` ne doit pas être interprété comme un endpoint DETAIL.

### Implications probables

- La description Adzuna actuelle n'est pas une source riche pour préparer une candidature.
- Le modèle devra probablement pouvoir exprimer qu'un texte connu est un snippet tronqué.
- Les champs non mappés méritent une évaluation séparée ; leur présence ne prouve pas automatiquement leur utilité.

### Décisions encore ouvertes

L'audit ne décide pas d'une stratégie d'enrichissement Adzuna, d'un éventuel fallback utilisateur, ni de la représentation finale de la qualité ou de la complétude du contenu.

## HelloWork

### Observations empiriques / faits

SEARCH a extrait 30 offres. Les 30 `applyUrl` étaient éligibles et 10 DETAIL ont été sélectionnés.

Chargement DETAIL :

- 10 chargements réussis sur 10 ;
- aucun timeout ;
- aucune origine externe acceptée ;
- 9 pages avec exactement un `JobPosting` exploitable ;
- une page sans JSON-LD ni `JobPosting` après une redirection interne HelloWork.

Pour les 9 `JobPosting` exploitables :

- description présente et non vide dans 9 cas sur 9 ;
- aucune description nettoyée ne terminait par une ellipse ;
- longueurs après le `cleanDescription()` actuel : 4 977, 3 223, 1 563, 4 000, 4 366, 5 047, 5 325, 6 122 et 2 717 caractères ;
- moyenne approximative : 4 149 caractères ;
- médiane : 4 366 caractères ;
- plage : 1 563 à 6 122 caractères.

Structure JSON-LD observée sur ces pages :

- 4 scripts JSON-LD par page ;
- `JobPosting` dans `scriptIndex 3` ;
- `JobPosting` direct ;
- `@type` représenté par une chaîne ;
- aucun cas avec plusieurs `JobPosting`.

Champs présents sur les 9 objets :

- `description` ;
- `title` ;
- `datePosted` ;
- `employmentType` ;
- `hiringOrganization` ;
- `jobLocation` ;
- `baseSalary` ;
- `identifier` ;
- `url` ;
- `validThrough`.

`skills` et `qualifications` étaient présents dans 8 cas sur 9. D'autres propriétés ont été observées selon les offres, notamment `educationRequirements`, `experienceRequirements`, `industry`, `occupationalCategory`, `applicantLocationRequirements`, `jobLocationType` et `estimatedSalary`.

Cohérence SEARCH/DETAIL sur les 9 offres exploitables :

- titre normalisé égal : 9 sur 9 ;
- entreprise normalisée égale : 9 sur 9 ;
- `JobPosting.url` exactement égal à SEARCH `applyUrl` : 9 sur 9 ;
- lieu égal : 3 sur 9 ;
- lieu différent : 6 sur 9.

Le lieu ne constitue donc pas une preuve stricte d'identité. La concordance des autres champs fournit des indices déterministes, pas une preuve formelle.

La page sans `JobPosting` avait chargé avec succès, subi une redirection interne et abouti à une URL différente. L'audit ne permet pas d'en établir la cause.

Le `cleanDescription()` actuel et `TextNormalizer.htmlToPlainText()` ont produit des résultats différents pour 9 descriptions sur 9, avec de faibles différences de longueur. Aucune décision de remplacement du cleaner n'est prise.

L'audit a utilisé une session Electron non persistante, une allowlist d'origine stricte, le blocage des navigations externes et des nouvelles fenêtres, le refus des permissions et téléchargements, la validation de l'URL finale et des DETAIL séquentiels.

Le mécanisme de production actuel ne possède pas tous ces durcissements. Son enrichissement DETAIL reste dans l'état React local de la modale, n'est pas écrit dans SQLite, est perdu à la fermeture et provoque une nouvelle récupération à la réouverture.

### Implications probables

- Le JSON-LD DETAIL constitue une source riche et structurée pour une future préparation de candidature sur l'échantillon observé.
- Un fallback est nécessaire lorsqu'aucun `JobPosting` n'est disponible.
- La récupération de production devrait probablement reprendre les protections de navigation et de session validées par l'audit.
- Une politique de cache ou de persistance éviterait les récupérations répétées et la perte du contenu à la fermeture de la modale.

### Décisions encore ouvertes

L'audit ne décide pas de la stratégie de cache, du format persistant, du cleaner définitif, des champs JSON-LD canoniques ni du comportement UX en l'absence de `JobPosting`.

## Problèmes transversaux établis

### Identité fournisseur et déduplication cross-provider

#### Observations empiriques / faits

- Careerjet a montré que `raw.url`, actuellement utilisé comme identité fournisseur, pouvait varier entre recherches.
- Adzuna a montré qu'une même clé de déduplication pouvait regrouper deux identifiants fournisseur distincts.

#### Implications probables

L'identité stable au sein d'un fournisseur et la similarité entre offres de fournisseurs différents doivent être représentées et traitées comme deux concepts distincts.

#### Décisions encore ouvertes

La future identité Careerjet et l'algorithme de déduplication ne sont pas définis ici.

### Persistance et non-dégradation

#### Observations empiriques / faits

`OfferRepository.upsertOne()` remplace actuellement le payload existant lors d'une mise à jour. Aucune politique ne préserve un contenu précédemment enrichi lorsqu'une nouvelle observation SEARCH est plus pauvre.

Le DETAIL HelloWork n'entre actuellement pas dans le repository.

#### Implications probables

Une future persistance de contenu enrichi nécessitera une règle explicite empêchant sa dégradation lors des recherches suivantes.

#### Décisions encore ouvertes

La politique précise de merge, de priorité, de fraîcheur et d'historisation reste à concevoir.

### Contenu léger et contenu riche

#### Observations empiriques / faits

Careerjet peut fournir environ 242 caractères dans le mode actuel ou plusieurs milliers avec une autre configuration. HelloWork fournit ses descriptions riches seulement au DETAIL. Adzuna fournit un snippet fixe dans SEARCH.

#### Implications probables

Le contenu utile à la recherche, à la liste, à la déduplication et à la pertinence sémantique n'a pas nécessairement besoin d'être identique au contenu utilisé pour le détail et la génération de candidature.

#### Décisions encore ouvertes

Le stockage et la circulation du contenu léger et du contenu riche restent à définir.

### Données structurées

#### Observations empiriques / faits

France Travail SEARCH et HelloWork DETAIL exposent des propriétés structurées qui ne sont pas intégralement conservées par le modèle actuel.

#### Implications probables

Ces données peuvent réduire la dépendance à une interprétation libre de la description et fournir des entrées plus précises à une future préparation de candidature.

#### Décisions encore ouvertes

Aucune liste de champs canoniques ni aucun modèle final n'est arrêté.

### Description tronquée Adzuna

#### Observations empiriques / faits

Les 50 descriptions Adzuna observées avaient exactement 500 caractères et terminaient par une ellipse.

#### Implications probables

Le système devrait pouvoir distinguer un snippet connu d'une description considérée comme complète ou de complétude inconnue.

#### Décisions encore ouvertes

Les enums, métadonnées fournisseur et règles d'évaluation de cette information restent à concevoir.

## Décisions d'architecture encore ouvertes

Cette phase d'audit ne décide pas :

- du modèle `OfferContent` ;
- des enums de qualité ou de complétude ;
- du modèle de métadonnées fournisseur ;
- du stockage séparé ou commun du contenu léger et du contenu riche ;
- de la politique précise de merge et de non-dégradation ;
- du correctif d'identité Careerjet ;
- de l'utilisation définitive de `fragment_size=10000` ;
- des champs structurés à rendre canoniques ;
- de la stratégie de cache HelloWork ;
- de `OfferContentEvaluator` ;
- de `ApplicationBrief` ;
- du fallback UX permettant à l'utilisateur de fournir ou compléter un texte.

Ces choix appartiennent à la phase d'architecture suivante.

## Outils d'audit dans le dépôt

Les rapports JSON d'exécution utilisés pour établir les chiffres de ce document ne sont pas versionnés dans le dépôt ; les scripts permettent de reproduire les mesures avec les accès fournisseur appropriés.

### Careerjet `fragment_size`

- `server/scripts/careerjet-fragment-size/CareerjetFragmentSizeAudit.js`
- `server/scripts/careerjet-fragment-size/CareerjetFragmentSizeAuditConfig.js`
- `server/scripts/careerjet-fragment-size/runCareerjetFragmentSizeAudit.js`
- test existant du mapping Careerjet : `server/test/connectors/CareerjetConnector.test.js`

Il n'existe pas de test dédié `CareerjetFragmentSizeAudit.test.js`.

### France Travail SEARCH/DETAIL

- `server/scripts/france-travail-detail/FranceTravailDetailAudit.js`
- `server/scripts/france-travail-detail/FranceTravailDetailAuditConfig.js`
- `server/scripts/france-travail-detail/runFranceTravailDetailAudit.js`
- `server/test/scripts/FranceTravailDetailAudit.test.js`

### Adzuna SEARCH

- `server/scripts/adzuna-search/AdzunaSearchAudit.js`
- `server/scripts/adzuna-search/AdzunaSearchAuditConfig.js`
- `server/scripts/adzuna-search/runAdzunaSearchAudit.js`
- `server/test/scripts/AdzunaSearchAudit.test.js`

### HelloWork SEARCH/DETAIL

- `desktop/electron/audits/hellowork/HelloWorkAudit.cjs`
- `desktop/electron/audits/hellowork/HelloWorkAuditConfig.cjs`
- `desktop/electron/audits/hellowork/HelloWorkJsonLdAnalyzer.cjs`
- `desktop/electron/audits/hellowork/HelloWorkUrlPolicy.cjs`
- `desktop/electron/audits/hellowork/runHelloWorkAudit.cjs`
- `desktop/test/audits/HelloWorkAudit.test.cjs`

## Limites de cette phase

Les mesures proviennent d'échantillons limités, pris à un moment donné et pour des recherches précises. Elles établissent les comportements observés, pas une garantie permanente sur les fournisseurs externes.

Les audits n'ont pas évalué la qualité rédactionnelle, la véracité des offres, les conditions contractuelles de réutilisation, ni la pertinence finale d'un dossier de candidature généré.
