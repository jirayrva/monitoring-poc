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

## Documentation

- [Decisions](docs/DECISIONS.md): what the brief asks for, what it leaves open, and what was decided
- [Architecture](docs/ARCHITECTURE.md): how the code is put together
- [Development](docs/DEVELOPMENT.md): setting up, the commands, and the checks
