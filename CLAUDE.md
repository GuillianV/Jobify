# Jobify - Coding conventions

This file defines the mandatory conventions for every contribution to this
repository (human or AI). All code must comply, and linting must pass before a
change is considered done.

## Runtime

- Node.js **24** (see `.nvmrc`). Use `nvm use` before working.

## Architecture

- **MVC** everywhere.
  - **Model**: domain data and business rules (`models/`).
  - **View**: output rendering / response formatting (`views/`).
  - **Controller**: request handling and orchestration (`controllers/`).
  - Supporting layers: `config/`, `constants/`, `routes/`, and an application
    bootstrap class that wires the pieces together.
- Dependencies are injected through constructors, never imported ad hoc inside
  methods.

## Language and style

- **Class-based by default.** Write business logic (server, domain models,
  services) as classes, in an object-oriented style. Entry-point files only
  instantiate classes and call a method.
  - **Exception - React renderer (`desktop/src/`).** UI is written as
    **functional components with hooks** (idiomatic modern React). Classes are
    not required there.
- **No one-liners.** Every control-flow statement uses a block with braces on
  its own lines. Arrow functions always use a block body. One statement per
  line.
- **No magic numbers.** Every numeric literal lives in a `config/` or
  `constants/` class with a descriptive name and is referenced by that name.
  The only literals allowed inline are `-1`, `0`, and `1`.
- **No emoji.** Not in code, strings, comments, log output, or identifiers.
- **JSDoc only** for explanation. Do not use inline `//` comments to describe
  behaviour. Every class and every method carries a JSDoc block with a
  description (and `@param` / `@returns` where relevant). Code should otherwise
  be self-explanatory through naming.
- **Classic JavaScript conventions.**
  - `camelCase` for variables, methods, and instances.
  - `PascalCase` for classes.
  - `UPPER_SNAKE_CASE` for constants.
  - One class per file; the file name matches the class name.

## Linting

- ESLint (flat config in `eslint.config.mjs`) enforces the rules above.
- Run before committing:

```bash
npm run lint        # verify
npm run lint:fix    # auto-fix what can be fixed
```

- A change is not finished until `npm run lint` reports zero problems.
