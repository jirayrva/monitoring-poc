**Subject: Re: URGENT: PoC Needed for Trade Show**

Hi,

The PoC of the monitoring service is ready.

**Running it:** on any laptop with Docker (Linux, macOS or Windows), get the code, run `docker compose up --build`, and
open <http://127.0.0.1:8080>. The dashboard comes up with ten simulated devices, each showing a different situation, so
the demo works before any real gear is plugged in. Build it once with internet before the show. After that it runs
offline. The README has the rest.

**What it does**

- Reads each device's health endpoint to learn what it speaks, then reads its diagnostics (HW, SW, FW, status,
  checksum) over REST or gRPC, whichever the device prefers.
- Shows the latest status of every device in a dashboard and a documented API. Devices can be added, changed or
  removed while it runs, without a restart.
- Avoids false alarms: a call that gets no answer is retried, and a failing device is "suspect" first, and "down" only
  after three failed checks in a row. A device that answers but is set up wrong, such as a wrong address or token, is
  shown as "misconfigured" instead, so it never raises a "down".
- Keeps the devices, and every status found, in Postgres for offline inspection.

**Checksum binary:** until it arrives, a stand-in makes the checksums, labelled as such on screen. The binary then goes
in `vendor/`, with its settings beside it, and needs no code change.

**To confirm before the show** (a one-line reply is enough if any is wrong)

1. Checksum binary: it has to be a Linux build (amd64 or arm64), as it runs in a Linux container. How it is called
   (payload on stdin, checksum on stdout) is my guess, and a setting if it differs.
2. Device APIs: I defined the health and diagnostics formats myself. With the real specs, the change is one adapter
   per protocol.
3. Network: I assumed the laptop is on the same network as the devices.
4. Who runs it: anyone with Docker, following the README.

**Limits:** one monitor at a time, and history is never pruned. There is no login or TLS, so only the laptop itself can
reach it. Both come first if the dashboard is to be shown from another device.

Thanks,
Jirayr
