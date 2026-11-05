# Development

How to work on the code. The why is in [DECISIONS.md](./DECISIONS.md), by ID.

## Setup

Install [mise](https://mise.jdx.dev). It installs the Node.js and pnpm pinned in `mise.toml`, which `package.json` also
requires (D-08), and the git hooks (D-19).

```bash
mise trust
mise install
pnpm install
pnpm check
```

## Commands

Run `pnpm check` before you commit (D-13). Checks that need services running stay out of it. Root scripts put the verb
first, as in `test:unit`, so related ones sort together.

| Command                 | What it does                                                       |
|-------------------------|--------------------------------------------------------------------|
| `pnpm check`            | Format check, lint, types and unit tests. Pre-push runs it too     |
| `pnpm format`           | Applies formatting                                                 |
| `pnpm format:check`     | Checks formatting                                                  |
| `pnpm lint`             | Checks linting                                                     |
| `pnpm lint:fix`         | Applies lint fixes, for you to review                              |
| `pnpm typecheck`        | Checks types                                                       |
| `pnpm test`             | Runs all tests                                                     |
| `pnpm test:unit`        | Runs `*.unit.test.ts`, which need nothing running                  |
| `pnpm test:integration` | Runs `*.integration.test.ts`, which need the services they talk to |
| `pnpm clean`            | Removes every `node_modules` folder                                |

## Layout

One pnpm workspace (D-10):

- `apps/`: what runs.
- `packages/`: what the apps share.
- `tooling/`: scripts and checks for the repository itself.

## Tests

Node's test runner runs them, and the file name says which kind a test is (D-11):

- `*.unit.test.ts` need nothing running.
- `*.integration.test.ts` need the services they talk to.

`tooling/sanity.unit.test.ts` stays, so the tools always have a file to work on (D-12).

## Code style

- TypeScript runs as is, with no build step, so only strippable syntax (`erasableSyntaxOnly`): no enums, namespaces or
  parameter properties. `tsc` only checks (D-09).
- Formatting is oxfmt's: 120 columns, single quotes. Markdown and the lockfile are left as written (D-16).
- Lint only checks, everywhere. `pnpm lint:fix` applies fixes for you to review. It also catches floating and misused
  promises (D-17).
- Lint enforces: `type` rather than `interface`, function expressions, property signatures for functions in types,
  imports first and exports grouped at the end, and `undefined` rather than `null` (D-18).

## Git hooks

hk runs the hooks, from `hk.pkl` (D-19). Each step calls the root script of the same name, so hooks, CI and you run
the same thing.

- Pre-commit: formats staged files and stages the result, and lints them. Checks types and runs unit tests when files
  they cover changed. Unstaged edits are set aside meanwhile, so only what is committed is checked.
- Pre-push: `pnpm check`.

## Commits

Per D-14 and D-15:

- Add things when the code first needs them.
- One change per commit, each passing `pnpm check`.
- [Conventional Commits](https://www.conventionalcommits.org), scoped to the app or package when there is one:
  `feat(monitor): …`. The subject says what changes, the body why.
- Linear history: rebase, never merge.
- During review, fixup commits, squashed once approved, before merging. No force-push once review has started.
