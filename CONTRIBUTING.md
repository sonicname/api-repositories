# Contributing

Thanks for helping out! This guide covers the local workflow.

## Setup

```bash
pnpm install
```

Node 18+ and pnpm 12+ are required. `pnpm install` also installs the git hooks.

## Daily commands

| Command           | What it does                                  |
| ----------------- | --------------------------------------------- |
| `pnpm dev`        | Rebuild on every change                       |
| `pnpm test:watch` | Run tests in watch mode                       |
| `pnpm lint:fix`   | Lint and auto-fix                             |
| `pnpm format`     | Format with Prettier                          |
| `pnpm check`      | Everything CI runs: types, lint, tests, build |
| `pnpm docs:api`   | Generate API docs into `docs/` with TypeDoc   |

## Commits

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) and are
checked by commitlint, for example `feat: add clamp helper` or `fix(repository): handle empty id`.

## Changesets

Every user-facing change needs a changeset:

```bash
pnpm changeset
```

Pick the bump type (patch, minor, major) and write a short summary. Commit the generated file
in `.changeset/` with your change.

## Pull requests

1. Branch from `main`.
2. Make your change with tests.
3. Run `pnpm check`.
4. Open a PR and fill in the template.
