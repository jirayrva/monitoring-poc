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
contracts settle Q-01 to Q-05, and the real binary Q-06.

### Q-01 What do a device's health and diagnostics endpoints return?

- Assumption: JSON, in a contract I define. Health says whether the device is up, and its capabilities: type,
  protocols (name, version, port) and checksum algorithm. Diagnostics are a separate call, in a protocol the device
  speaks.
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

### Q-05 What does the binary checksum?

- Assumption: the diagnostics as sent, without the checksum the device reported, with the algorithm from
  capabilities. The service compares the two.
- If wrong: only what is passed to the binary changes.

### Q-06 How is the binary run?

- Assumption: payload on stdin, checksum in hex on stdout. Path, arguments and environment are settings.
- If wrong: settings change, at worst the code that runs it.

### Q-07 How often is a device checked?

- Assumption: about every 30 seconds, a setting.
- If wrong: a setting changes.

### Q-08 How many devices?

- Assumption: a handful at the stand, up to about a thousand later. Several checked at once, up to a limit.
- If wrong: the limit changes, and beyond that the scheduling (Q-09).

### Q-09 Are some devices checked more often than others?

- Assumption: no, one pace for all.
- If wrong: each device gets its own next check time, in the database.

### Q-10 Are diagnostics read on every check?

- Assumption: yes, after a health call that answers.
- If wrong: diagnostics get a slower pace, or sampling.

### Q-11 How long may a call take before it gives up?

- Assumption: 3 seconds, leaving room for a retry on an unstable network.
- If wrong: settings change.

### Q-12 Who may use the API?

- Assumption: only the presenter, through the dashboard on the laptop it runs on. Nothing listens beyond that laptop:
  visitors watch the screen.
- If wrong: other machines need access, such as a second screen or a tablet, and sign-in comes first.

### Q-13 Do devices need credentials?

- Assumption: some take a bearer token. Tokens never go in the database.
- If wrong: other schemes, per device as needed.

### Q-14 What does pairing with the PoC life-cycle mean?

- Assumption: the checksum integration is tested before the binary arrives. A stand-in runs through the code that
  will run the real one, where it will run: startup, every probe, on demand. The real binary changes settings, not
  tests, so their results hold.
- If wrong: the tests follow the life-cycle meant. The service does not change.

### Q-15 What happens to a removed device?

- Assumption: its checks stop, and its history stays.
- If wrong: removal deletes its history too.

### Q-16 How does an error answer count, such as a 404, a 500 or an HTML page?

- Assumption: a failed check, recorded with why: no answer, or an unexpected one.
- If wrong: some answers count as up. The outcome mapping and transitions change.

### Q-17 Where does the service run?

- Assumption: on a laptop at the stand, with Postgres beside it.
- If wrong: the setup changes, not the service. In the cloud, retune probes at once, and move device tokens to the
  platform's secret store.

### Q-18 Can more than one instance run at once?

- Assumption: no, one (follows from Q-17).
- If wrong: split checks between instances, and assess database connections.

### Q-19 How long is the list of devices?

- Assumption: up to about a thousand.
- If wrong: pagination comes sooner.

### Q-20 How often are capabilities discovered again?

- Assumption: on every check, as health returns them.
- If wrong: keep them, and reread at a slower pace.

### Q-21 Is a device's history needed through the API?

- Assumption: no, the brief asks for the latest status. History is kept for offline inspection.
- If wrong: add an endpoint. History is kept either way.

### Q-22 What does a device ID look like?

- Assumption: text that fits in a URL path, chosen by the user or the vendor.
- If wrong: derive a URL-safe ID, such as a hash of the vendor's.

### Q-23 Must changes to the device list be audited?

- Assumption: no.
- If wrong: an audit log beside the devices, or event sourcing.

### Q-24 Is a screen to show customers needed?

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
- Serves: R-01, R-08, R-16, R-17, R-19, I-02 · Answers: Q-24

#### D-02 Work on assumptions, each cheap to change

- Why: no time to dig out the real contracts, and sensible mock ones go a long way.
- Then: each assumption sits behind one replaceable piece: a setting, a feature flag, an injected implementation of
  an interface.
- Serves: I-03 · Answers: every Q

### Process

#### D-14 Add things when they are needed

- Why: nothing is maintained before it earns its place, and each commit shows why what it adds exists.
- Then: each tool, port and setting arrives with the first code that needs it.
- Serves: I-10

### Minor decisions

Details, where there are any, are in [DEVELOPMENT.md](./DEVELOPMENT.md).

| ID   | Decision                                                                  | Serves           |
|------|---------------------------------------------------------------------------|------------------|
| D-08 | Node.js 26 (current LTS) and pnpm, pinned by mise                         | R-01, R-18, R-19 |
| D-09 | TypeScript, run by Node.js as is: no build step, `tsc` only checks        | I-10             |
| D-10 | One pnpm workspace for every part                                         | R-19, I-10       |
| D-11 | Node.js's test runner, the kind of test in the file name                  | R-17             |
| D-12 | Keep a sanity test, as `tsc` and oxlint fail with no files                | R-17             |
| D-13 | One command for every quick check: `pnpm check`                           | R-17, I-10       |
| D-15 | Small commits, in a linear history                                        | I-10             |
| D-16 | oxfmt formats the code, not Markdown                                      | I-10             |
| D-17 | oxlint, with types, only checks. Fixes are applied separately, for review | I-10             |
| D-18 | One way to write each thing, enforced by lint                             | I-10             |
| D-19 | Git hooks with hk, installed by mise                                      | R-17, I-10       |
| D-20 | CI runs what the pre-push hook runs                                       | R-17             |

## 4 Not doing (yet)

| ID   | Not doing          | Why                            | Brings it in                                  |
|------|--------------------|--------------------------------|-----------------------------------------------|
| D-03 | Auth               | Presenter's laptop only (Q-12) | After the trade show                          |
| D-04 | Multiple instances | One laptop (Q-17, Q-18)        | Too many devices, or an autoscaling cloud     |
| D-05 | Metrics, tracing   | Logs cover the stand (I-01)    | Real use (trends, alerts), tuning concurrency |
| D-06 | Rate limiting      | Only the presenter has access  | As D-03                                       |
| D-07 | Per-device pace    | One pace for all (Q-09)        | Mixed paces, or too many for one round        |
