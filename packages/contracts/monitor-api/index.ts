/** The monitor's API: its request and response bodies as JSON Schemas, with samples of each. */
import { join } from 'node:path';

const schemaDirectory = join(import.meta.dirname, 'schema');
const samplesDirectory = join(import.meta.dirname, 'samples');

export { samplesDirectory, schemaDirectory };
