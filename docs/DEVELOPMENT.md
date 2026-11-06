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

| Command                 | What it does                                                         |
|-------------------------|----------------------------------------------------------------------|
| `pnpm check`            | Format check, lint, types and unit tests. Pre-push and CI run it too |
| `pnpm format`           | Applies formatting                                                   |
| `pnpm format:check`     | Checks formatting                                                    |
| `pnpm lint`             | Checks linting                                                       |
| `pnpm lint:fix`         | Applies lint fixes, for you to review                                |
| `pnpm typecheck`        | Checks types                                                         |
| `pnpm test`             | Runs all tests                                                       |
| `pnpm test:unit`        | Runs `*.unit.test.ts`, which need nothing running                    |
| `pnpm test:integration` | Runs `*.integration.test.ts`, which need the services they talk to   |
| `pnpm clean`            | Removes every `node_modules` folder                                  |

## Running the monitor

From `apps/monitor`, or from the root with `pnpm --filter @device-monitor/monitor <command>`:

| Command      | What it does                                                                    |
|--------------|---------------------------------------------------------------------------------|
| `pnpm dev`   | Runs the service and restarts it when a file changes, with the debugger enabled |
| `pnpm start` | Runs the service                                                                |

It listens on <http://127.0.0.1:3000> by default, and keeps devices in memory for now. Every setting has a default.
A wrong one stops the service at startup, with every problem listed (D-48).

| Variable    | Default     | What it sets                                                                   |
|-------------|-------------|--------------------------------------------------------------------------------|
| `HOST`      | `127.0.0.1` | Address to listen on. Use `0.0.0.0` to accept connections from other machines. |
| `PORT`      | `3000`      | Port to listen on                                                              |
| `LOG_LEVEL` | `info`      | Log level: `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`      |

## Layout

One pnpm workspace (D-10):

- `apps/`: what runs. `apps/monitor` is the service.
- `packages/`: what the apps share. `packages/contracts` holds the APIs' JSON Schemas, each with valid and invalid
  samples that a test checks against it (D-45).
- `tooling/`: scripts and checks for the repository itself.

What works together sits together (D-43): tests in `__tests__/` beside the code they test, and a port's contract
suite in `testing/` beside the port.

## Tests

Node's test runner runs them, and the file name says which kind a test is (D-11):

- `*.unit.test.ts` need nothing running.
- `*.integration.test.ts` need the services they talk to.

`tooling/sanity.unit.test.ts` stays, so the tools always have a file to work on (D-12).

Each port has a contract suite beside it, in `core/ports/<driving|driven>/testing/<port>.contract.ts`. Each adapter of
the port has a test file that runs the suite, so every adapter, the fakes included, keeps the same promises
(D-40).

## Code style

- TypeScript runs as is, with no build step, so only strippable syntax (`erasableSyntaxOnly`): no enums, namespaces or
  parameter properties. `tsc` only checks (D-09).
- Formatting is oxfmt's: 120 columns, single quotes. Markdown and the lockfile are left as written (D-16).
- Lint only checks, everywhere. `pnpm lint:fix` applies fixes for you to review. It also catches floating and misused
  promises (D-17).
- Lint enforces: `type` rather than `interface`, function expressions, property signatures for functions in types,
  imports first and exports grouped at the end, and `undefined` rather than `null` (D-18).
- Expected failures are returned as a `Result`, `{ ok, value | failure }`. A throw means a bug (D-22).
- A type with variants is a discriminated union, not optional or nullable fields (D-23).
- Every call leaving the process takes `CallOptions`, with an abort signal (D-24).
- Port types are named `<Method>Input` and `<Method>Output` (D-41).

## Git hooks and CI

hk runs the hooks, from `hk.pkl` (D-19). Each step calls the root script of the same name, so hooks, CI and you run
the same thing.

- Pre-commit: formats staged files and stages the result, and lints them. Checks types and runs unit tests when files
  they cover changed. Unstaged edits are set aside meanwhile, so only what is committed is checked.
- Pre-push and CI: `pnpm check`. GitHub Actions runs it on every pull request and push to `main` (D-20).
  Integration and end-to-end tests join once there is a stack to run them against.

## Commits

Per D-14 and D-15:

- Add things when the code first needs them.
- One change per commit, each passing `pnpm check`.
- [Conventional Commits](https://www.conventionalcommits.org), scoped to the app or package when there is one:
  `feat(monitor): …`. The subject says what changes, the body why.
- Linear history: rebase, never merge.
- During review, fixup commits, squashed once approved, before merging. No force-push once review has started.
