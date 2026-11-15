import { readDevicesFile } from './devices-file.ts';
import { registerDevices } from './register.ts';
import { createSimulator } from './simulator.ts';

const env = (name: string) => process.env[name] || undefined;
const devicePort = Number(env('SIMULATOR_DEVICE_PORT') ?? 4100);
const devicesFile = env('SIMULATOR_DEVICES_FILE');
const playing = devicesFile === undefined ? [] : readDevicesFile(devicesFile);

// Registers the devices from the file with a monitor, when told which. Before listening, so the simulator is healthy
// only once its devices are registered.
const monitorUrl = env('SIMULATOR_MONITOR_URL');
if (monitorUrl !== undefined) {
  const outcomes = await registerDevices({
    entries: playing.map(({ entry }) => entry),
    monitorUrl,
    deviceBaseUrl: env('SIMULATOR_DEVICE_BASE_URL') ?? `http://127.0.0.1:${devicePort}/devices`,
  });
  for (const outcome of outcomes) {
    console.log(JSON.stringify({ msg: 'Registered with the monitor', ...outcome }));
  }
}

const simulator = createSimulator({
  host: env('HOST') ?? '127.0.0.1',
  devicePort,
  grpcPort: Number(env('SIMULATOR_GRPC_PORT') ?? 4102),
  controlPort: Number(env('SIMULATOR_CONTROL_PORT') ?? 4101),
  devices: playing.map(({ device }) => device),
});
const { deviceUrl, grpcPort, controlUrl } = await simulator.start();
console.log(JSON.stringify({ msg: 'Simulator started', deviceUrl, grpcPort, controlUrl, devices: playing.length }));

const stop = () => void simulator[Symbol.asyncDispose]();
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
