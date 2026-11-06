import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, it } from 'node:test';
import { Ajv } from 'ajv';
import addFormatsModule from 'ajv-formats';

/** Sample contents have no static type: each test decides what it expects to find. */
type Samples = Record<string, any>;

const toCamelCase = (name: string) => name.replaceAll(/-(\w)/g, (_match, letter: string) => letter.toUpperCase());

const loadSamples = (directory: string): Samples => {
  const entries = readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return [[toCamelCase(entry.name), loadSamples(path)]];
    }

    if (entry.name.endsWith('.json')) {
      return [[basename(entry.name, '.json'), JSON.parse(readFileSync(path, 'utf8'))]];
    }

    return [];
  });

  return Object.fromEntries(entries);
};

type SchemaTestOptions = {
  schemaDirectory: string;
  samplesDirectory: string;
  /** Building blocks that other schemas refer to, so they have no samples of their own. */
  sharedSchemas?: string[];
};

const addFormats = addFormatsModule.default;

/**
 * Tests that every schema in a folder has samples, that every valid sample passes and every invalid
 * one fails. Each owner of a contract runs it on its own schemas.
 */
const testSchemasAndSamples = (options: SchemaTestOptions) => {
  const { schemaDirectory, samplesDirectory, sharedSchemas = [] } = options;
  const samples = loadSamples(samplesDirectory);
  const schemaFiles = readdirSync(schemaDirectory).filter((file) => file.endsWith('.schema.json'));
  const schemaNames = schemaFiles.map((file) => file.replace('.schema.json', ''));

  const ajv = new Ajv({ strict: true, allErrors: true, discriminator: true });
  addFormats(ajv);
  for (const file of schemaFiles) {
    ajv.addSchema(JSON.parse(readFileSync(join(schemaDirectory, file), 'utf8')));
  }

  describe('schemas and samples', () => {
    it('every sample folder has a schema', () => {
      // Arrange
      const contracts = schemaNames.map(toCamelCase);

      // Act
      const withoutSchema = Object.keys(samples).filter((folder) => !contracts.includes(folder));

      // Assert
      assert.deepEqual(withoutSchema, []);
    });

    it('every schema has samples, unless it is shared', () => {
      // Arrange
      const folders = Object.keys(samples);

      // Act
      const withoutSamples = schemaNames.filter(
        (name) => !sharedSchemas.includes(name) && !folders.includes(toCamelCase(name)),
      );

      // Assert
      assert.deepEqual(withoutSamples, []);
    });

    for (const name of schemaNames.filter((schemaName) => !sharedSchemas.includes(schemaName))) {
      const contract = samples[toCamelCase(name)];

      describe(name, () => {
        it('has valid and invalid samples', () => {
          // Assert
          assert.ok(Object.keys(contract?.valid ?? {}).length > 0, 'no valid samples');
          assert.ok(Object.keys(contract?.invalid ?? {}).length > 0, 'no invalid samples');
        });

        for (const [sampleName, sample] of Object.entries(contract?.valid ?? {})) {
          it(`accepts valid/${sampleName}`, () => {
            // Arrange
            const validate = ajv.getSchema(`${name}.schema.json`);

            // Act
            const accepted = validate?.(sample);

            // Assert
            assert.equal(accepted, true, JSON.stringify(validate?.errors));
          });
        }

        for (const [sampleName, sample] of Object.entries(contract?.invalid ?? {})) {
          it(`rejects invalid/${sampleName}`, () => {
            // Arrange
            const validate = ajv.getSchema(`${name}.schema.json`);

            // Act
            const accepted = validate?.(sample);

            // Assert
            assert.equal(accepted, false);
          });
        }
      });
    }
  });
};

export { loadSamples, testSchemasAndSamples };
