/**
 * The monitor's API: its request and response bodies as JSON Schemas, with samples of each, and the OpenAPI document
 * the monitor builds from its routes.
 */
import { join } from 'node:path';

const schemaDirectory = join(import.meta.dirname, 'schema');
const samplesDirectory = join(import.meta.dirname, 'samples');

/** Written by the monitor's openapi:generate. A monitor test fails when it is out of date. */
const openApiPath = join(import.meta.dirname, 'openapi.json');

export { openApiPath, samplesDirectory, schemaDirectory };
