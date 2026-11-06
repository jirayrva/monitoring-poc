/**
 * The device API, as the monitor assumes it (Q-01): what devices answer, as JSON Schemas, with samples of each. The
 * monitor validates answers with them.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const schemaDirectory = join(import.meta.dirname, 'schema');
const samplesDirectory = join(import.meta.dirname, 'samples');

const healthSchema: Record<string, unknown> = JSON.parse(
  readFileSync(join(schemaDirectory, 'health.schema.json'), 'utf8'),
);

export { healthSchema, samplesDirectory, schemaDirectory };
