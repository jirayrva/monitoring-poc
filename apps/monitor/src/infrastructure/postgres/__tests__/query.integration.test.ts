import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Pool } from 'pg';
import { classifyPostgresError } from '../errors.ts';
import { queryWithSignal } from '../query.ts';
import { testConnectionString } from '../testing/test-database.ts';

const createPool = (t: { after: (fn: () => Promise<void>) => void }) => {
  const pool = new Pool({ connectionString: testConnectionString, max: 2 });
  pool.on('error', () => {});
  t.after(() => pool.end());
  return pool;
};

const reject = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return assert.fail('Expected the query to reject');
};

describe('queryWithSignal', () => {
  it('runs a query as pool.query does', async (t) => {
    // Arrange
    const pool = createPool(t);

    // Act
    const { rows } = await queryWithSignal<{ answer: number }>(
      pool,
      new AbortController().signal,
      'SELECT $1::int AS answer',
      [42],
    );

    // Assert
    assert.deepEqual(rows, [{ answer: 42 }]);
  });

  it('runs nothing when the signal has already aborted, and rejects as cancelled', async (t) => {
    // Arrange
    const pool = createPool(t);

    // Act
    const error = await reject(queryWithSignal(pool, AbortSignal.abort(), 'SELECT 1'));

    // Assert
    assert.equal(classifyPostgresError(error), 'cancelled');
    assert.equal(pool.totalCount, 0);
  });

  it('has the server cancel a running query when the signal aborts, and rejects as cancelled', async (t) => {
    // Arrange
    const pool = createPool(t);
    const started = performance.now();

    // Act
    const error = await reject(queryWithSignal(pool, AbortSignal.timeout(100), 'SELECT pg_sleep(10)'));

    // Assert
    assert.equal(classifyPostgresError(error), 'cancelled');
    assert.ok(performance.now() - started < 5000, 'the query should end long before pg_sleep would');
  });

  it('closes the connection a cancel was sent for, so a late cancel cannot stop the next query', async (t) => {
    // Arrange
    const pool = createPool(t);
    await reject(queryWithSignal(pool, AbortSignal.timeout(100), 'SELECT pg_sleep(10)'));

    // Act
    const { rows } = await queryWithSignal<{ one: number }>(pool, new AbortController().signal, 'SELECT 1 AS one');

    // Assert
    assert.deepEqual(rows, [{ one: 1 }]);
    assert.equal(pool.totalCount, 1, 'the cancelled connection was closed; only the one that sent the cancel is left');
  });
});
