import { createSimulator } from './simulator.ts';

const port = (name: string, fallback: number) => Number(process.env[name] || fallback);

const simulator = createSimulator({
  host: process.env['HOST'] || '127.0.0.1',
  devicePort: port('SIMULATOR_DEVICE_PORT', 4100),
  controlPort: port('SIMULATOR_CONTROL_PORT', 4101),
  devices: [],
});
const { deviceUrl, controlUrl } = await simulator.start();
console.log(JSON.stringify({ msg: 'Simulator started', deviceUrl, controlUrl }));

const stop = () => void simulator[Symbol.asyncDispose]();
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
