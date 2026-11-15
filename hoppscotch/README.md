# Hoppscotch

[Hoppscotch](https://hoppscotch.io) collections of the monitor's API, `device-monitor.collection.json`, and of the
simulator's control API, `simulator.collection.json`, with an environment for the stack on this machine.

Import the collections under Collections and `local.environment.json` under Environments, then select the
environment. The files are in the format Hoppscotch 24.10 writes, which that version opens as is. Newer versions
migrate them on import.

## The environment

| Variable    | Default                 | What it is                                                                |
|-------------|-------------------------|---------------------------------------------------------------------------|
| `monitor`   | `http://127.0.0.1:8080` | The monitor's API, through the gateway. `pnpm dev` serves it on port 3000 |
| `deviceId`  | `hoppscotch-switch`     | The device the requests register, change and unregister                   |
| `simulator` | `http://127.0.0.1:4101` | The simulator's control API                                               |
| `devices`   | `http://127.0.0.1:4100` | Where the simulated devices answer                                        |

## Running it

Each request checks the status it answers, so the Hoppscotch CLI runs a collection as a smoke test of the running
stack:

```bash
pnpm dlx @hoppscotch/cli@0.31.4 test hoppscotch/device-monitor.collection.json -e hoppscotch/local.environment.json
pnpm dlx @hoppscotch/cli@0.31.4 test hoppscotch/simulator.collection.json -e hoppscotch/local.environment.json
```

The monitor's registers `deviceId`, changes it and unregisters it again, then stops and starts monitoring. The
simulator's adds `deviceId`, calls its health and diagnostics, makes its health fail, and removes it. Each leaves what
it calls as it found it, unless monitoring was stopped.
