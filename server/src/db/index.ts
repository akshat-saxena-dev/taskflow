import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { config } from '../config';
import { writeLog } from '../logger';

let pool: Pool | null = null;

export interface DbExecutor {
  query: <T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]) => Promise<QueryResult<T>>;
}

export const getPool = (): Pool => {
  if (!pool) {
    if (!config.databaseUrl) {
      throw new Error(
        'DATABASE_URL environment variable is missing. Please set DATABASE_URL in server/.env with your Neon connection string.'
      );
    }

    pool = new Pool({
      connectionString: config.databaseUrl,
      ssl: {
        rejectUnauthorized: false // Required for Neon cloud connections
      },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });

    pool.on('error', (err) => {
      writeLog('api', 'error', 'postgres_pool_error', { error: err });
    });
  }

  return pool;
};

/**
 * Database interface allowing easy mocking in unit and integration tests
 */
export const db = {
  query: async <T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[]
  ): Promise<QueryResult<T>> => {
    const activePool = getPool();
    return activePool.query<T>(text, params);
  },
  transaction: async <T>(callback: (client: DbExecutor) => Promise<T>): Promise<T> => {
    const client: PoolClient = await getPool().connect();
    try {
      await client.query('BEGIN');
      const result = await callback({ query: client.query.bind(client) as DbExecutor['query'] });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
};

export const closeDb = async (): Promise<void> => {
  if (pool) await pool.end();
  pool = null;
};

/**
 * Test connectivity to PostgreSQL without throwing an uncaught exception
 */
export const checkDbConnection = async (): Promise<{ connected: boolean; message: string }> => {
  if (!config.databaseUrl) {
    return {
      connected: false,
      message: 'DATABASE_URL is not set in server/.env'
    };
  }

  try {
    await db.query('SELECT 1');
    return { connected: true, message: 'Database connection successful' };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown database connection error';
    return { connected: false, message };
  }
};
