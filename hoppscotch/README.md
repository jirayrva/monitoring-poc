# Hoppscotch

A [Hoppscotch](https://hoppscotch.io) collection of the monitor's API, with an environment for a monitor on this
machine.

Import `device-monitor.collection.json` under Collections and `local.environment.json` under Environments, then select
the environment. The files are in the format Hoppscotch 24.10 writes, which that version opens as is. Newer versions
migrate them on import.

## The environment

| Variable   | Default                 | What it is                                              |
|------------|-------------------------|---------------------------------------------------------|
| `monitor`  | `http://127.0.0.1:3000` | The monitor's API. Change it when `PORT` is set         |
| `deviceId` | `hoppscotch-switch`     | The device the requests register, change and unregister |

## Running it

Each request checks the status it answers, so the Hoppscotch CLI runs the collection as a smoke test of a running
monitor:

```bash
pnpm dlx @hoppscotch/cli@0.31.4 test hoppscotch/device-monitor.collection.json -e hoppscotch/local.environment.json
```

It registers `deviceId`, changes it and unregisters it again, so it leaves the monitor as it found it.
