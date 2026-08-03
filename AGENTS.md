# AGENTS.md

## Source de vérité

Avant toute intervention, lire et respecter `CLAUDE.md`. Il constitue la source de vérité pour l’architecture, le style, les conventions de code et les critères de qualité communs au projet. Ne pas dupliquer ces règles ici.

## Périmètre et sécurité

- Utiliser Node.js 24.
- Limiter les modifications aux fichiers strictement nécessaires à la tâche demandée.
- Ne pas reformater ou modifier du code sans rapport avec la tâche.
- Ne jamais lire, afficher ou modifier `server/.env`.
- Utiliser uniquement `server/.env.example` pour connaître les noms des variables d’environnement.
- Ne jamais révéler de clé, jeton, identifiant ou autre secret.
- Ne jamais écraser ou supprimer des modifications existantes sans accord explicite.

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
