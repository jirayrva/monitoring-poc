import { testSchemasAndSamples } from '../../testing/schemas-and-samples.ts';
import { samplesDirectory, schemaDirectory } from '../index.ts';

testSchemasAndSamples({ schemaDirectory, samplesDirectory, sharedSchemas: ['device-registration'] });
