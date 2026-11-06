import { loadSamples } from '../../testing/schemas-and-samples.ts';
import { samplesDirectory } from '../index.ts';

const samples = loadSamples(samplesDirectory);

export { samples };
