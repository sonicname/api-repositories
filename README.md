# api-repositories

[![CI](https://github.com/egohub/api-repositories/actions/workflows/ci.yml/badge.svg)](https://github.com/egohub/api-repositories/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/api-repositories.svg)](https://www.npmjs.com/package/api-repositories)
[![npm downloads](https://img.shields.io/npm/dm/api-repositories.svg)](https://www.npmjs.com/package/api-repositories)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

A production-ready TypeScript library boilerplate for publishing to npm.

## Features

- **TypeScript** with the strictest compiler options enabled
- **Dual ESM + CJS** output with type declarations for both, built by [tsup](https://tsup.egoist.dev)
- **Vitest** for tests with V8 coverage and thresholds
- **ESLint** (typed, flat config) + **Prettier**
- **Husky**, **lint-staged** and **commitlint** (Conventional Commits) git hooks
- **Changesets** for versioning, changelog and publishing
- **GitHub Actions**: CI matrix across Node 18 to 24 on Linux and Windows, automated release with npm provenance
- **publint** and **Are The Types Wrong** to validate the published package
- **size-limit** to keep bundle size in check
- **TypeDoc** for API documentation
- Dependabot, issue and PR templates, VS Code settings, EditorConfig

## Installation

```bash
pnpm add api-repositories
# or
npm install api-repositories
```

## Usage

```ts
import { greet, sum, clamp, Repository } from 'api-repositories';

greet('World'); // "Hello, World!"
sum([1, 2, 3]); // 6
clamp(15, 0, 10); // 10

const users = new Repository<{ id: string; name: string }>();
users.save({ id: '1', name: 'Ann' });
users.find('1'); // { id: '1', name: 'Ann' }
```

CommonJS works too:

```js
const { greet } = require('api-repositories');
```

## Using this as a template

1. Clone or click "Use this template" on GitHub.
2. Search and replace `api-repositories` with your package name, and `egohub/api-repositories` with your GitHub repo.
3. Update `author`, `description` and `keywords` in `package.json`, and the copyright line in `LICENSE`.
4. Replace the example code in `src/` and tests in `tests/`.
5. Add `NPM_TOKEN` (an npm automation token) to the repository secrets. Add `CODECOV_TOKEN` if you want coverage reports.
6. Run `pnpm install`.

## Scripts

| Script               | Description                                                |
| -------------------- | ---------------------------------------------------------- |
| `pnpm build`         | Build ESM, CJS and `.d.ts` into `dist/`                    |
| `pnpm dev`           | Build in watch mode                                        |
| `pnpm test`          | Run tests once                                             |
| `pnpm test:watch`    | Run tests in watch mode                                    |
| `pnpm test:coverage` | Run tests with coverage                                    |
| `pnpm typecheck`     | Type-check without emitting                                |
| `pnpm lint`          | Lint with ESLint                                           |
| `pnpm lint:fix`      | Lint and fix                                               |
| `pnpm format`        | Format with Prettier                                       |
| `pnpm format:check`  | Check formatting                                           |
| `pnpm check:exports` | Validate `package.json` exports and types (attw + publint) |
| `pnpm size`          | Check bundle size against `.size-limit.json`               |
| `pnpm docs:api`      | Generate API docs into `docs/`                             |
| `pnpm check`         | Run everything CI runs                                     |
| `pnpm changeset`     | Add a changeset describing your change                     |
| `pnpm release`       | Build and publish (used by the release workflow)           |

## Release workflow

1. Make changes and run `pnpm changeset` to describe them.
2. Merge to `main`. The release workflow opens a "Version Packages" PR that bumps the version and updates `CHANGELOG.md`.
3. Merge that PR. The workflow builds, publishes to npm with provenance, and creates a GitHub release.

To publish manually instead:

```bash
pnpm changeset version
pnpm release
```

## Project structure

```
.
├── .changeset/          # Pending changesets and config
├── .github/             # CI, release, Dependabot, templates
├── .husky/              # Git hooks
├── src/                 # Library source (src/index.ts is the entry)
├── tests/               # Vitest tests
├── eslint.config.js
├── pnpm-workspace.yaml  # pnpm settings (allowed build scripts)
├── tsconfig.json
├── tsup.config.ts
└── vitest.config.ts
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE) © Phạm Anh Đức
