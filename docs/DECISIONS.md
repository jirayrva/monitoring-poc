# Decisions

What the [brief](./brief.md) asks for, what it leaves open, and what I decided. IDs are stable and never reused. A
decision that changes is edited in place, so this file says what holds now.

**R** stated requirement · **I** implied requirement · **Q** open question, with the assumption I work on · **D**
decision, numbered in the order made

## 1 Requirements

### Stated

| ID   | Requirement                                                | From the brief                                                                  |
|------|------------------------------------------------------------|---------------------------------------------------------------------------------|
| R-01 | A Node.js backend service                                  | "you need to implement the Node.js backend service"                             |
| R-02 | Monitor a list of network devices                          | "a device monitoring service that checks if a list of network devices is alive" |
| R-03 | Tell whether each device is alive                          | "checks if a list of network devices is alive"                                  |
| R-04 | Talk to devices over REST                                  | "It needs to support REST calls"                                                |
| R-05 | Talk to devices over gRPC where they support it            | "and ideally gRPC, some of our new devices support that"                        |
| R-06 | Learn each device's capabilities from its health endpoint  | "use its health endpoint to get the capabilities"                               |
| R-07 | Read diagnostics: HW, SW and FW versions, status, checksum | "the diagnostics data (HW, SW, FW version, status, checksum)"                   |
| R-08 | An API for the latest status of all devices                | "an API to retrieve the latest status of all monitored devices"                 |
| R-09 | Change the device list without restarting                  | "easy to update dynamically without restarting"                                 |
| R-10 | No false alarms                                            | "some devices are behind unstable networks … we don't want false alarms"        |
| R-11 | Handle a device that is down intelligently                 | "handle it intelligently—maybe retries? Maybe logging?"                         |
| R-12 | Store device identities and statuses in Postgres           | "Keep the device identities, status, etc stored in the Postgres database"       |
| R-13 | Keep what was found, for offline inspection                | "so that we can inspect them offline"                                           |
| R-14 | Check diagnostics with the external checksum binary        | "integrate … with an external checksum generator binary executable"             |
| R-15 | Work fully without the binary until it arrives             | "I don't have it yet, so just focus on preparing the full PoC"                  |
| R-16 | Pair the service with the PoC life-cycle                   | "It must be paired with the PoC life-cycle to get valid test results"           |
| R-17 | Make testing the whole system easy                         | "Testing the whole thing must be easy!"                                         |
| R-18 | Run on whatever hardware and OS the stand has              | "a bunch of different devices and operating systems for hosting the service"    |
| R-19 | Get it up and running quickly                              | "must be able to get it up and running quick and easy!"                         |
| R-20 | Simple, but professional                                   | "It should be simple but look professional"                                     |

### Implied

| ID   | Requirement                                                 | Why                                                                                |
|------|-------------------------------------------------------------|------------------------------------------------------------------------------------|
| I-01 | Logs say what happened to each device, and why              | Logging is suggested, and nobody attaches a debugger at a trade show               |
| I-02 | The demo works reliably, offline, without real devices      | Customers judge it, the venue's network is unknown, and only some gear has arrived |
| I-03 | New protocols, device types and a real binary fit in easily | "this might become part of something bigger"                                       |
| I-04 | Each device protocol is isolated from the others            | REST and gRPC must coexist, and more may follow                                    |
| I-05 | The checksum binary is isolated from the rest               | It is unknown, and "difficult to configure and setup"                              |
| I-06 | No OS-specific assumptions                                  | The hosting OS is unknown                                                          |
| I-07 | A slow or unreachable device never holds up the others      | Some devices are behind unstable networks                                          |
| I-08 | Starts and stops cleanly, keeps its data across restarts    | Stand gear gets unplugged, and data must survive for offline inspection            |
| I-09 | Stand staff can run it, and see what is wrong, on their own | Whoever could help is travelling, in another time zone                             |
| I-10 | Code colleagues can read and change                         | "how this code will affect your developer colleagues"                              |
| I-11 | Docs for developers                                         | "developer experience and the future of the company"                               |

## 2 Questions / Unknowns

Each says what I assume and what it costs if wrong. All are assumptions until answered: the real device
contracts settle Q-01 to Q-06, and the real binary Q-07.

### Q-01 What do a device's health and diagnostics endpoints return?

- Assumption: JSON, in a contract I define. Health says whether the device is up, its ID, and its capabilities:
  type, protocols (name, version, port) and checksum algorithm. Diagnostics are a separate call, in a protocol the
  device speaks.
- If wrong: only the device-facing code and the contract change.

### Q-02 Do all devices speak the same contract?

- Assumption: one contract per protocol, whatever the device type.
- If wrong: one adapter per device type and protocol.

### Q-03 How do devices offer gRPC?

- Assumption: a diagnostics service, on a port the health answer gives. Health is REST only.
- If wrong: the gRPC code changes.

### Q-04 Are diagnostics read in one call, or one per capability?

- Assumption: one call, in the protocol the device prefers.
- If wrong: the diagnostics code changes.

### Q-05 How is the status in diagnostics different from health?

- Assumption: health is the device's word on whether it works, from a small set the monitor knows (D-29).
  The diagnostics status is a detail in the device's own words, kept as sent and never interpreted. Neither changes
  the state (D-27).
- If wrong: if they mean the same, drop one. If the monitor must act on the diagnostics status, it gets a known set
  too, and the client's verdict (D-27) weighs it.

### Q-06 What does the binary checksum?

- Assumption: the diagnostics as sent, with the algorithm from capabilities. The device sends its checksum beside
  them, in a header, so the bytes checksummed are exactly the bytes sent. The service compares the two.
- If wrong: only what is passed to the binary changes.

### Q-07 How is the binary run?

- Assumption: payload on stdin, checksum in hex on stdout. Path, arguments and environment are settings.
- If wrong: settings change, at worst the code that runs it.

### Q-08 How often is a device checked?

- Assumption: about every 30 seconds, a setting.
- If wrong: a setting changes.

### Q-09 How many devices?

- Assumption: a handful at the stand, up to about a thousand later. Several checked at once, up to a limit.
- If wrong: the limit changes, and beyond that the scheduling (Q-10).

### Q-10 Are some devices checked more often than others?

- Assumption: no, one pace for all.
- If wrong: each device gets its own next check time, in the database.

### Q-11 Are diagnostics read on every check?

- Assumption: yes, after a health call that answers.
- If wrong: diagnostics get a slower pace, or sampling.

### Q-12 How long may a call take before it gives up?

- Assumption: 3 seconds, leaving room for a retry on an unstable network.
- If wrong: settings change.

### Q-13 Who may use the API?

- Assumption: only the presenter, through the dashboard on the laptop it runs on. Nothing listens beyond that laptop:
  visitors watch the screen.
- If wrong: other machines need access, such as a second screen or a tablet, and sign-in comes first.

### Q-14 Do devices need credentials?

- Assumption: some take a bearer token. Tokens never go in the database.
- If wrong: other schemes, per device as needed.

### Q-15 What does pairing with the PoC life-cycle mean?

- Assumption: the binary runs inside the service's life-cycle: run by the service for each checksum, stopped with it,
  deployed with it. Until it arrives, a stand-in runs through the same code, so the real binary changes settings, not
  tests, and their results hold.
- If wrong: the tests follow the life-cycle meant. The service does not change.

### Q-16 What happens to a removed device?

- Assumption: its checks stop, and its history stays.
- If wrong: removal deletes its history too.

### Q-17 How does an error answer count, such as a 404, a 500 or an HTML page?

- Assumption: a failed check, recorded with why: no answer, or an unexpected one. Misconfigured instead when it shows
  the registration is wrong: 401 or 403, 404 on the health path, another device answering, a TLS failure, no token
  to send.
- If wrong: some answers count as up, or move between failed and misconfigured. The outcome mapping and transitions
  change.

### Q-18 Where does the service run?

- Assumption: on a laptop at the stand, with Postgres beside it.
- If wrong: the setup changes, not the service. In the cloud, retune probes at once, and move device tokens to the
  platform's secret store.

### Q-19 Can more than one instance run at once?

- Assumption: no, one (follows from Q-18).
- If wrong: split checks between instances, and assess database connections.

### Q-20 How long is the list of devices?

- Assumption: up to about a thousand.
- If wrong: pagination comes sooner.

### Q-21 How often are capabilities discovered again?

- Assumption: on every check, as health returns them.
- If wrong: keep them, and reread at a slower pace.

### Q-22 Is a device's history needed through the API?

- Assumption: no, the brief asks for the latest status. History is kept for offline inspection.
- If wrong: add an endpoint. History is kept either way.

### Q-23 What does a device ID look like?

- Assumption: the device's own ID, and text that fits in a URL path. Whoever registers a device enters it, as the
  device's health answer gives it. Each probe compares the ID in the health answer with the registered one: another
  ID means the base URL reaches the wrong device (`wrong_device`).
- If wrong: an ID the user chooses, and the registration keeps the device's own ID to compare with. Not URL-safe:
  derive one, such as a hash.

### Q-24 Must changes to the device list be audited?

- Assumption: no.
- If wrong: an audit log beside the devices, or event sourcing.

### Q-25 Is a screen to show customers needed?

- Assumption: yes, a simple dashboard: "makes our hardware look smart" and "look professional", though the API is what
  is asked for.
- If wrong: drop it, it is an extra.

## 3 Decisions

The decisions that shape the design. Minor ones are one line each in [Minor decisions](#minor-decisions).

### Scope

#### D-01 Deliver a stack, not only a service

The service and its API, Postgres, a device simulator, a dashboard, tests at every level, one command to start it all,
docs, and the reply.

- Why: the brief asks for a service but judges the demo. With no devices at hand, only a simulator makes the demo
  and the tests possible.
- Then: AI builds the simulator and dashboard.
- Serves: R-01, R-08, R-16, R-17, R-19, I-02 · Answers: Q-25

#### D-02 Work on assumptions, each cheap to change

- Why: no time to dig out the real contracts, and sensible mock ones go a long way.
- Then: each assumption sits behind one replaceable piece: a setting, a feature flag, an injected implementation of
  an interface.
- Serves: I-03 · Answers: every Q

### Architecture

#### D-21 Ports and Adapters, boundaries enforced by lint

- Why: device protocols, the checksum binary, storage and the API each sit behind a port, so each assumption is one
  adapter to replace (D-02).
- Then: the core imports only the core, and infrastructure nothing of the monitor's. Lint fails otherwise.
- Serves: I-03, I-04, I-05

#### D-25 Design first: docs in one commit, then types in one commit

- Why: everything speaks the domain model, so its names are settled and reviewed before code uses them.
- Then: the one exception to D-14. Behaviour arrives later, each with its tests.
- Serves: I-10

#### D-44 Each feature is built from the inside out

First the core behind its driving port, tested with stubs of the driven ports, as the core imports no adapter (D-21).
Then the driving adapter that exposes it. The real driven adapters come last, each passing its port's contract suite
(D-40). A fake adapter exists only where something outside the core needs one, such as the API tests.

- Why: the core is written and tested before any database, device or binary exists, and each step builds on tested
  code.
- Then: a real adapter is done once it passes the contract suite.
- Serves: R-17, I-03, I-10

### Data

#### D-26 A device's identity is kept apart from how to reach it

`Device` is the ID and name. `DeviceRegistration` adds the base URL and auth.

- Why: statuses and history refer to a device after it is unregistered (Q-16), and need nothing else of it.
- Serves: R-12, R-13

#### D-27 The monitor's conclusion is kept apart from what the device reports

The state (`unknown`, `up`, `suspect`, `down`, `misconfigured`) is the monitor's. Health, capabilities and diagnostics
are the device's, kept as reported.

- Why: a device that says "degraded" still answered, so it is up. Folding its words into the state stores a policy,
  and changing it would mean rewriting history.
- Then: a client wanting one verdict combines state, health and checksum itself.
- Serves: R-03, R-06, R-07

#### D-28 Down after N failed probes in a row, up after one that succeeds

No response and unexpected responses count (Q-17). Misconfigured ones do not (D-39).

- Why: slow to raise an alarm on an unstable network, quick to clear it.
- Then: a real outage shows as `suspect` for the first N - 1 failed probes.
- Serves: R-10, R-11

#### D-39 A misconfigured registration is its own state, never down

One answer showing the registration is wrong is enough (Q-17). It leaves the state as from `up`.

- Why: `down` would send staff to a device that may be fine. Asking again gets the same answer, so no debounce (D-28).
- Then: staff see what to fix, and the next probe after the fix recovers it.
- Serves: R-11, I-09 · Answers: Q-17

#### D-42 Datastores copy what goes in and comes out

- Why: no caller can change stored data through an object it holds, so an in-memory store behaves as Postgres does.
- Serves: R-17

#### D-54 A device not probed yet is unknown since it was registered, worked out when read

The status store holds only what probes found. Reading the latest statuses gives a registered device with none as
`unknown` since its `registeredAt`, under its current name.

- Why: registering writes one row, so it cannot leave a device without its first status.
- Then: the device list keeps `registeredAt`. An unregistered device's statuses are left out, and its history stays.
- Serves: R-08, R-09 · Answers: Q-16

### Monitoring

#### D-31 Monitoring State lives in memory, and starts as running

- Why: the demo works as soon as the service starts, and a restarted laptop monitors again.
- Then: a stop does not survive a restart.
- Serves: R-19, I-09

#### D-32 Stopping monitoring lets the round in progress finish

- Why: no device is left half checked. At the stand, a round takes seconds.
- Then: probing stops within one round, and until then the state is `stopping`.
- Serves: R-13

#### D-33 The next round starts a fixed time after the previous one ends

- Why: rounds never overlap, so the concurrency limit holds and no device is probed twice at once.
- Then: the pace is the interval plus the round's duration, which is logged (I-01).
- Serves: R-10, I-07

#### D-34 Diagnostics are read only after a health call that answers

- Why: health says which protocols the device speaks (R-06), and a silent device would only use up the diagnostics
  budget.
- Then: a failing probe takes at most the health budget.
- Serves: R-06, R-07 · Answers: Q-11

#### D-35 Retry a device call only when asking again could get another answer

That is, no response or a 5xx. A call that succeeded is never repeated.

- Why: a dropped packet, or an error while a device restarts, passes. A 404 comes back the same.
- Then: exponential backoff with full jitter, one policy for all devices.
- Serves: R-10, R-11

#### D-37 Every timeout sits inside a budget

A timeout limits one wait, a budget a group of them with their retries. Defaults are in
[ARCHITECTURE.md](./ARCHITECTURE.md#timeouts-and-budgets).

- Why: a slow device cannot hold a round past its budget, nor lose its retry to one long attempt.
- Then: the service warns at startup when a step's attempts do not fit its budget.
- Serves: R-10, I-07 · Answers: Q-12

### Code and process

#### D-38 Device tokens are referred to, never stored

A device's `auth` names where its token is kept (`secretRef`) (Q-14). The name must start with `DEVICE_`, so a
registration cannot read the service's own settings.

- Why: the database can be inspected offline (R-13) without exposing device credentials.
- Serves: R-13

#### D-22 Expected failures are returned, not thrown

A `Result`, `{ ok, value | failure }`, whose failure says why. A throw means a bug.

- Why: failures are part of a port's contract, and the types make callers handle them.
- Serves: R-11, I-10

#### D-40 Each port has a contract suite, and each adapter runs it

- Why: a fake and a real adapter keep the same promises, so tests using the fake stay valid.
- Then: the suite sits beside its port, in `testing/`, and each adapter's test file runs it.
- Serves: R-17

#### D-14 Add things when they are needed

- Why: nothing is maintained before it earns its place, and each commit shows why what it adds exists.
- Then: each tool, port and setting arrives with the first code that needs it.
- Serves: I-10

### Minor decisions

Details, where there are any, are in [DEVELOPMENT.md](./DEVELOPMENT.md).

| ID   | Decision                                                                                       | Serves           |
|------|------------------------------------------------------------------------------------------------|------------------|
| D-08 | Node.js 26 (current LTS) and pnpm, pinned by mise                                              | R-01, R-18, R-19 |
| D-09 | TypeScript, run by Node.js as is: no build step, `tsc` only checks                             | I-10             |
| D-10 | One pnpm workspace for every part                                                              | R-19, I-10       |
| D-11 | Node.js's test runner, the kind of test in the file name                                       | R-17             |
| D-12 | Keep a sanity test, as `tsc` and oxlint fail with no files                                     | R-17             |
| D-13 | One command for every quick check: `pnpm check`                                                | R-17, I-10       |
| D-15 | Small commits, in a linear history                                                             | I-10             |
| D-16 | oxfmt formats the code, not Markdown                                                           | I-10             |
| D-17 | oxlint, with types, only checks. Fixes are applied separately, for review                      | I-10             |
| D-18 | One way to write each thing, enforced by lint                                                  | I-10             |
| D-19 | Git hooks with hk, installed by mise                                                           | R-17, I-10       |
| D-20 | CI runs what the pre-push hook runs, then the integration tests on Compose's Postgres          | R-17             |
| D-23 | Variants are discriminated unions                                                              | I-10             |
| D-24 | Every call that leaves the process takes an abort signal                                       | I-07, I-08       |
| D-29 | A health word the monitor does not know is kept as `unrecognized`, not failed                  | R-06, R-10       |
| D-30 | Devices are listed by ID, in code-point order, the same in every datastore                     | R-08             |
| D-36 | Jitter spreads a wait within its backoff, never lengthens it                                   | R-10, I-07       |
| D-41 | Port types are named `<Method>Input` and `<Method>Output`                                      | I-10             |
| D-43 | What works together sits together: tests, contract suites, adapter files                       | I-10             |
| D-45 | API bodies are JSON Schemas in `packages/contracts`, with checked samples                      | R-17, I-10       |
| D-46 | Fastify serves the API, validating and serializing with the contract schemas                   | I-10             |
| D-47 | Every API path starts with its major version, `/v1`                                            | I-10             |
| D-48 | Every setting has a default, and a wrong one stops startup with every problem listed           | R-19, I-10       |
| D-49 | A Hoppscotch collection of the API, to call it by hand and smoke-test a running monitor        | R-17             |
| D-50 | The OpenAPI document comes from the routes, checked in, linted, and served at `/docs/`         | I-10, I-11       |
| D-51 | `pg` and `node-pg-migrate`. Each Postgres adapter owns its migrations, applied as one sequence | I-03, I-10       |
| D-52 | Integration tests run on Compose's Postgres, each in a schema of its own                       | R-17             |

## 4 Not doing (yet)

| ID   | Not doing                  | Why                                    | Brings it in                                  |
|------|----------------------------|----------------------------------------|-----------------------------------------------|
| D-03 | Auth                       | Presenter's laptop only (Q-13)         | After the trade show                          |
| D-04 | Multiple instances         | One laptop (Q-18, Q-19)                | Too many devices, or an autoscaling cloud     |
| D-05 | Metrics, tracing           | Logs cover the stand (I-01)            | Real use (trends, alerts), tuning concurrency |
| D-06 | Rate limiting              | Only the presenter has access          | As D-03                                       |
| D-07 | Per-device pace            | One pace for all (Q-10)                | Mixed paces, or too many for one round        |
| D-53 | A state machine library    | `nextStatus` already is the diagram    | Many more states, or per device type          |
| D-55 | SSRF guard                 | Would block devices on private LANs    | As D-03                                       |
| D-56 | A latest-statuses table    | An index serves a thousand devices     | Listing statuses measured too slow            |
| D-57 | Keep the diagnostics bytes | Checked on arrival, nothing reads them | The binary arrives, or Q-06 is in doubt       |
