# AGENTS.md

## Source de vérité

Avant toute intervention, lire et respecter `CLAUDE.md`. Il constitue la source de vérité pour l’architecture, le style, les conventions de code et les critères de qualité communs au projet. Ne pas dupliquer ces règles ici.

## Périmètre et sécurité

- Utiliser Node.js 24.
- Limiter les modifications aux fichiers strictement nécessaires à la tâche demandée.
- Ne pas reformater ou modifier du code sans rapport avec la tâche.
- Ne jamais écraser ou supprimer des modifications existantes sans accord explicite.

## Secrets et fichiers d’environnement

- Traiter `server/.env` et tout fichier d’environnement contenant des secrets comme sensibles.
- Ne pas lire `server/.env` par défaut. Utiliser uniquement `server/.env.example` pour connaître les noms des variables d’environnement.
- Ne jamais afficher, imprimer, citer, dumper, journaliser, commiter, modifier ou exposer le contenu de `server/.env`.
- Ne jamais inclure de valeur secrète dans un prompt, rapport, erreur, sortie de test, fichier temporaire, commit ou documentation.
- Ne jamais utiliser `cat`, `type`, `Get-Content`, `grep`, `rg` ou une commande équivalente d’une manière qui afficherait des valeurs secrètes.
- Exception : lorsque l’utilisateur autorise explicitement l’accès pour la tâche en cours et qu’un secret local est requis pour l’exécuter, Codex peut lire uniquement les variables spécifiquement nécessaires depuis `server/.env`.
- Sous cette autorisation explicite :
  - charger uniquement les variables requises ;
  - conserver leurs valeurs uniquement dans la mémoire du processus ;
  - ne jamais afficher une partie d’un secret, y compris sa longueur, son préfixe, son suffixe ou son hash ;
  - limiter toute confirmation visible à la présence ou l’absence de la variable requise ;
  - ne jamais modifier `server/.env` ;
  - ne jamais persister le secret ailleurs.
- L’autorisation est spécifique à la tâche et n’accorde aucun accès pour un travail sans rapport.
- Ne jamais révéler de clé, jeton, identifiant ou autre secret.

## Dépendances et fichiers générés

- Ne pas installer, supprimer ou mettre à jour une dépendance sans accord explicite.
- Ne pas modifier les fichiers `package-lock.json` sans changement de dépendance explicitement autorisé.
- Ne jamais exécuter `npm audit fix --force`.
- Ne pas exécuter `npm run lint:fix` sans accord explicite.

## Git et collaboration

- Vérifier l’état du dépôt avec `git status --short` avant et après toute intervention.
- Ne jamais créer de commit, pousser une branche ou ouvrir une pull request sans demande explicite.
- Ne jamais annuler les changements d’un autre développeur sans demande explicite.

## Vérification et compte rendu

- Avant de considérer une modification terminée, exécuter au minimum `npm run lint`.
- Exécuter les autres vérifications pertinentes disponibles pour la tâche.
- Expliquer les commandes importantes exécutées.
- Résumer les fichiers modifiés et les choix techniques effectués.
- Signaler clairement toute vérification qui n’a pas pu être réalisée, avec sa raison.
