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

The integration tests need Postgres, and each makes a schema of its own (D-52).
[Docker](https://docs.docker.com/get-docker/) runs it from `compose.yaml`, on `127.0.0.1:5432`. Set `POSTGRES_PORT`
to publish it on another port, and point `DATASTORE_CONNECTION_STRING` at it.

```bash
docker compose up -d --wait
pnpm test:integration
```

## Commands

Run `pnpm check` before you commit (D-13). Checks that need services running stay out of it. Root scripts put the verb
first, as in `test:unit`, so related ones sort together.

| Command                   | What it does                                                                       |
|---------------------------|------------------------------------------------------------------------------------|
| `pnpm check`              | Format check, lint, types, OpenAPI lint and unit tests. Pre-push and CI run it too |
| `pnpm format`             | Applies formatting                                                                 |
| `pnpm format:check`       | Checks formatting                                                                  |
| `pnpm lint`               | Checks linting                                                                     |
| `pnpm lint:fix`           | Applies lint fixes, for you to review                                              |
| `pnpm lint:openapi`       | Lints the OpenAPI document with Redocly (D-50)                                     |
| `pnpm typecheck`          | Checks types                                                                       |
| `pnpm test`               | Runs all tests                                                                     |
| `pnpm test:unit`          | Runs `*.unit.test.ts`, which need nothing running                                  |
| `pnpm test:integration`   | Runs `*.integration.test.ts`, which need the services they talk to                 |
| `pnpm clean:compose`      | Stops Compose and deletes its volumes, so Postgres starts empty next time          |
| `pnpm clean:dependencies` | Removes every `node_modules` folder                                                |
| `pnpm clean`              | Both of the above. Run `pnpm install` afterwards                                   |

## Running the monitor

From `apps/monitor`, or from the root with `pnpm --filter @device-monitor/monitor <command>`:

| Command                 | What it does                                                                    |
|-------------------------|---------------------------------------------------------------------------------|
| `pnpm dev`              | Runs the service and restarts it when a file changes, with the debugger enabled |
| `pnpm start`            | Runs the service                                                                |
| `pnpm openapi:generate` | Regenerates the OpenAPI document from the routes. A test fails when it's stale  |

It needs Postgres (see [Setup](#setup)), and applies any pending migrations when it starts (D-51). It listens on
<http://127.0.0.1:3000> by default. The API reference is at [`/docs/`](http://127.0.0.1:3000/docs/), and the
OpenAPI document at [`/docs/openapi.json`](http://127.0.0.1:3000/docs/openapi.json). Every setting has a default. A
wrong one stops the service at startup, with every problem listed (D-48), as does a checksum binary it cannot run, or
a setting for one without it. When a step's attempts and waits do not fit its budget, the service warns at startup
(D-37).

`SIGINT` or `SIGTERM` (Ctrl-C) stops it cleanly, in the order in [ARCHITECTURE](ARCHITECTURE.md#stopping-the-service).
It exits 0, or 1 when something failed to start or stop, when stopping took longer than `SHUTDOWN_TIMEOUT_MS`, or on
a second signal while stopping.

To call it by hand, [hoppscotch/](../hoppscotch/README.md) has a collection of its API (D-49).

| Variable                                    | Default                                             | What it sets                                                             |
|---------------------------------------------|-----------------------------------------------------|--------------------------------------------------------------------------|
| `HOST`                                      | `127.0.0.1`                                         | Address to listen on. `0.0.0.0` accepts other machines                   |
| `PORT`                                      | `3000`                                              | Port to listen on                                                        |
| `LOG_LEVEL`                                 | `info`                                              | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`           |
| `SHUTDOWN_TIMEOUT_MS`                       | `9000`                                              | Longest stop, then exit 1. Under Docker's 10 s                           |
| `SHUTDOWN_DRAIN_TIMEOUT_MS`                 | `3000`                                              | Time API requests get to finish on stop. Then 503 `cancelled`            |
| `DATASTORE_CONNECTION_STRING`               | `postgres://monitor:monitor@127.0.0.1:5432/monitor` | The Postgres to store devices and statuses in                            |
| `DATASTORE_SCHEMA`                          | `monitor`                                           | Schema for the tables and migrations, never `public`. Created if missing |
| `DATASTORE_CONNECTION_TIMEOUT_MS`           | `5000`                                              | Wait for a connection, then 503 `unavailable`                            |
| `DATASTORE_QUERY_TIMEOUT_MS`                | `5000`                                              | Longest query, then 503 `timeout`                                        |
| `MONITORING_INTERVAL_MS`                    | `30000`                                             | Wait between the end of one round and the start of the next (Q-08)       |
| `MONITORING_DOWN_PROBE_THRESHOLD`           | `3`                                                 | Failed probes in a row before `down` (D-28)                              |
| `MONITORING_MAX_CONCURRENT_PROBES`          | `250`                                               | Devices probed at once                                                   |
| `MONITORING_HEALTH_ATTEMPT_TIMEOUT_MS`      | `3000`                                              | Longest health attempt (D-37)                                            |
| `MONITORING_HEALTH_BUDGET_MS`               | `7000`                                              | Longest health step: every attempt and the waits between them            |
| `MONITORING_DIAGNOSTICS_ATTEMPT_TIMEOUT_MS` | `3000`                                              | Longest diagnostics attempt                                              |
| `MONITORING_DIAGNOSTICS_BUDGET_MS`          | `7000`                                              | Longest diagnostics step: every attempt and the waits between them       |
| `MONITORING_CHECKSUM_TIMEOUT_MS`            | `2000`                                              | Longest checksum generation. Not retried                                 |
| `MONITORING_RETRY_COUNT`                    | `1`                                                 | Retries after the first attempt of a device call. `0`: none (D-35)       |
| `MONITORING_RETRY_BASE_DELAY_MS`            | `1000`                                              | Backoff before the first retry, doubled for each one after               |
| `MONITORING_RETRY_MAX_DELAY_MS`             | `4000`                                              | Longest backoff. Each wait is a random time up to it (D-36)              |
| `CHECKSUM_BINARY_PATH`                      | —                                                   | The checksum binary, as an absolute path. Unset: the stand-in (Q-07)     |
| `CHECKSUM_BINARY_ARGS`                      | `[]`                                                | Its arguments, as a JSON array. `{algorithm}` names the algorithm (D-58) |
| `CHECKSUM_BINARY_ALGORITHMS`                | —                                                   | The algorithms it supports, comma-separated. Required with a binary      |
| `CHECKSUM_BINARY_VERSION`                   | `unknown`                                           | Its version, named with every checksum                                   |
| `CHECKSUM_ENV_*`                            | —                                                   | `CHECKSUM_ENV_<NAME>` is `<NAME>` in its environment, its only variables |
| `DEVICE_*`                                  | —                                                   | Device tokens, each named by a registration's `secretRef` (D-38)         |

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

- Pre-commit: formats staged files and stages the result, and lints them. Checks types, lints the OpenAPI document and
  runs unit tests when files they cover changed. Unstaged edits are set aside meanwhile, so only what is committed is
  checked.
- Pre-push and CI: `pnpm check`. GitHub Actions runs it on every pull request and push to `main` (D-20).
- CI then starts Postgres with Compose and runs the integration tests (D-20).

## Commits

Per D-14 and D-15:

- Add things when the code first needs them.
- One change per commit, each passing `pnpm check`.
- [Conventional Commits](https://www.conventionalcommits.org), scoped to the app or package when there is one:
  `feat(monitor): …`. The subject says what changes, the body why.
- Linear history: rebase, never merge.
- During review, fixup commits, squashed once approved, before merging. No force-push once review has started.
