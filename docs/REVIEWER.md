# Reviewer guide

## How it is built

- **Decide, record, then build.** Every requirement, assumption and decision is in DECISIONS before the code that
  follows it. When the code and the documents disagree, the code changes.
- **Inside out.** Each feature starts with the core behind its ports, then its driving adapter, then the real driven
  adapters, then the wiring (D-44). The core imports only the core, and lint fails otherwise (D-21).
- **Consistent patterns.** Adapters follow the same shape: a folder each, and a contract suite for the driven ports
  that have one (D-40). Expected failures are returned rather than thrown (D-22). A new protocol, store or checksum
  binary is mostly one more adapter.
- **One change per commit, in the right place.** Each commit passes every check on its own. A fix goes into the commit
  that introduced what it fixes. Nothing is added before something needs it.
- **Tests that bite.** Each test was seen to fail against code broken on purpose. A break no test caught meant a
  missing test, or code that did nothing, which was removed.

The code rules are enforced by lint where they can be, and listed in DEVELOPMENT's code style.

## Reading order

1. [README](../README.md): run the stack and look at the dashboard. It needs only Docker.
2. [DECISIONS](./DECISIONS.md): what the brief asks for (R), what it implies (I), what it leaves open and what I
   assumed (Q), and every decision (D), each with what it serves.
3. [ARCHITECTURE](./ARCHITECTURE.md): the design the code follows.
4. The history, oldest first: `git log --reverse --stat`. Each commit is one change, passes every check on its own,
   and says why in its message. It reads as the story of the build: requirements, design, the core inside out, then
   each adapter, then the stack.
5. [DEVELOPMENT](./DEVELOPMENT.md): the commands, the settings and the tests.

The history is groomed to read as a clean progression. That holds until the first code review, which is now.

## Codebase size

The repository has about 18,400 lines in 253 files. Most of them are mechanical or tests. The monitor is the critical part.

| What                                              | Files | Lines |
|---------------------------------------------------|-------|-------|
| JSON: schemas, their samples, OpenAPI, Hoppscotch | 109   | 4,179 |
| The lockfile                                      | 1     | 1,885 |
| Tests                                             | 49    | 6,274 |
| Documents                                         | 8     | 1,146 |
| Simulator and dashboard                           | 8     | 1,464 |
| The monitor                                       | 56    | 2,828 |

The monitor itself is small files of one concern each, none over 230 lines. A change stays in one place: a new
protocol is one adapter folder and its wiring in `main.ts`, and a new API field is a schema, its samples and a route.

## AI usage

I used an LLM agent harness at different levels in different parts, based on criticality.
- The monitor and the contracts are mine: I designed them, set the rules, and reviewed every change. The AI did work
  already decided, often from examples I gave: samples from named cases, schemas from the samples, tests
  from a reference.
- The simulator and the dashboard are AI-generated: I decided what they do and checked that they work, without
  reviewing line by line.
- The tooling, Compose, CI are AI-assisted and I reviewed.

## What's next

- Authentication, authorization and TLS, before the dashboard is shown from another device (D-03). With them, limit
  which hosts a device's token may be sent to (D-55), and harden the other external calls.
- Confirm the device APIs and the checksum binary's call with the vendor (Q-01, Q-06, Q-07).
- Metrics, tracing and telemetry, once there is real use to watch (D-05).
- Past about a thousand devices, a timer per device through a bounded queue rather than rounds, so a slow device delays
  no other (D-07).
- Tune concurrency on a single instance at scale, where DNS and TLS weigh in.
- Tune the settings and their defaults to where the service runs: in the cloud or on a device.
- Other retry strategies, if the stand's networks call for them.
- Server-sent events rather than polling, for the dashboard.
- Optimization based on where this service will run: cloud vs on-device
- Failover between protocols
- Sampling of diagnostics
