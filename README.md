# Monitoring Service - PoC

Monitors network devices and reports their latest status.

## Running it

It needs only [Docker](https://docs.docker.com/get-docker/).

```bash
docker compose up --build
```

This starts the monitor and its Postgres. The API is on <http://127.0.0.1:8080>, with its reference at
[`/docs/`](http://127.0.0.1:8080/docs/). Set `MONITOR_PORT` to publish it on another port. Stop it with Ctrl-C, or
`docker compose down`. The data stays in a Docker volume until `docker compose down --volumes`.

The first `--build` downloads the base images and npm packages, so run it once on a good connection. After that,
`docker compose up` starts from the images on the machine, with no internet.

- **Device tokens**: for devices with bearer auth, put each token in `.env.devices`, as `DEVICE_<NAME>=<token>`, named
  by the device's `secretRef`. Git ignores the file.
- **The vendor's checksum binary**: until it arrives, a stand-in makes the checksums, and every result says so. To use
  the binary, put it in `vendor/`, which Git ignores, and its settings in `vendor/checksum.env`:

  ```bash
  CHECKSUM_BINARY_PATH=/opt/vendor/checksum
  CHECKSUM_BINARY_ALGORITHMS=sha256
  CHECKSUM_BINARY_ARGS=["--algorithm", "{algorithm}"]
  ```

  Compose mounts `vendor/` read-only at `/opt/vendor`. The image is Debian, so the binary must be built for glibc, on
  the host's architecture, and runnable by the `node` user. The monitor stops at startup when it cannot run it. Every
  setting is in [DEVELOPMENT](docs/DEVELOPMENT.md#running-the-monitor).

## Simulated devices

The stack includes a simulator, so the monitor has devices to probe without real ones. It starts with the nine devices
in [`apps/simulator/demo-devices.json`](apps/simulator/demo-devices.json), one per thing worth showing: working, with a
token, updating, slow and degraded, an unknown status, tampered diagnostics, not answering, another device at its
address, and a wrong path. It registers them with the monitor as it starts, and leaves one already registered as it
is, so a restart does not undo a change made through the monitor's API.

Its devices answer on
`127.0.0.1:4100`, each at `http://127.0.0.1:4100/devices/<deviceId>`, and its control API on `127.0.0.1:4101`. Inside
Compose, the monitor reaches a device at `http://simulator:4100/devices/<deviceId>`.

Add a device, register it with the monitor, then change how it answers while the monitor watches:

```bash
curl -X PUT http://127.0.0.1:4101/devices/sim-1 -H 'content-type: application/json' -d '{"deviceType":"switch"}'
curl -X POST http://127.0.0.1:8080/v1/devices -H 'content-type: application/json' \
  -d '{"deviceId":"sim-1","name":"Simulated switch","baseUrl":"http://simulator:4100/devices/sim-1","auth":{"strategy":"none"}}'
curl -X PATCH http://127.0.0.1:4101/devices/sim-1 -H 'content-type: application/json' -d '{"health":"hangs"}'
```

`GET /devices` lists the simulated devices. `PUT /devices/<deviceId>` adds or replaces one from the defaults, `PATCH`
changes some of its settings, and `DELETE` removes it. The settings, which the simulator takes as they come (D-63):

| Setting                                          | Default  | What it does                                            |
|--------------------------------------------------|----------|---------------------------------------------------------|
| `health`, `diagnostics`                          | `normal` | How it answers that call. See below                     |
| `status`                                         | `ok`     | Its word on its health. Any word, such as `maintenance` |
| `token`                                          | none     | A bearer token every call must carry, or 401            |
| `delayMs`                                        | `0`      | A wait before every answer                              |
| `dropNext`                                       | `0`      | How many of its next calls drop the connection          |
| `deviceType`                                     | `switch` | Its type                                                |
| `hardware`, `softwareVersion`, `firmwareVersion` |          | What its diagnostics report                             |

How it answers a call: `normal`, `garbage` (JSON the device API never sends), `html` (a page, as a captive portal
sends), `fails` (500), `not_found` (404), `gateway_error` (502), `hangs`, `resets`, or `truncates` (cut off partway).
Health can also be `impostor` (another device's ID), and diagnostics `tampered` (a checksum that does not match).

The simulator keeps changes in memory, so a restart brings back the devices in the file as they are there.
`SIMULATOR_DEVICE_PORT` and `SIMULATOR_CONTROL_PORT` move its ports. Run on its own (`pnpm --filter
@device-monitor/simulator dev`), it starts empty, unless `SIMULATOR_DEVICES_FILE` names a file, and registers them only
with the monitor `SIMULATOR_MONITOR_URL` names, at `SIMULATOR_DEVICE_BASE_URL`.

## Documentation

- [Decisions](docs/DECISIONS.md): what the brief asks for, what it leaves open, and what was decided
- [Architecture](docs/ARCHITECTURE.md): how the code is put together
- [Development](docs/DEVELOPMENT.md): setting up, the commands, and the checks
