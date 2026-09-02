// The only database boundary for future authenticated v2 handlers. Identity
// must come from the server's verified session, never directly from a body.
import pg from 'pg';
import { createAuthRepository, runAuthStatement } from './auth-repository.js';

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function boundedInteger(value, fallback, min, max, name) {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(String(value))) throw new Error(`Invalid ${name}`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`Invalid ${name}`);
  }
  return number;
}

export function databaseConfigFromEnv(env = process.env) {
  if (env.WELLSIM_DATABASE_ENABLED !== '1') return Object.freeze({ enabled: false });
  const loginRole = env.WELLSIM_DB_LOGIN_ROLE;
  const runtimeRole = env.WELLSIM_DB_RUNTIME_ROLE;
  if (!IDENTIFIER.test(loginRole ?? '') || !IDENTIFIER.test(runtimeRole ?? '')
      || loginRole === runtimeRole) throw new Error('Invalid database role configuration');
  let url;
  try { url = new URL(env.DATABASE_URL); } catch { throw new Error('Invalid DATABASE_URL'); }
  // This deployment is deliberately loopback-only. Reject URL query overrides
  // (including host/user/options) rather than silently weakening that boundary.
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
      || url.hostname !== '127.0.0.1' || (url.port && url.port !== '5432')
      || url.search || url.hash || !url.password
      || decodeURIComponent(url.username) !== loginRole
      || !IDENTIFIER.test(url.pathname.slice(1))) {
    throw new Error('DATABASE_URL must identify the configured local application login');
  }
  return Object.freeze({
    enabled: true,
    connectionString: env.DATABASE_URL,
    loginRole,
    runtimeRole,
    max: boundedInteger(env.WELLSIM_DB_POOL_MAX, 10, 1, 20, 'database pool maximum'),
    maxPending: boundedInteger(env.WELLSIM_DB_MAX_PENDING, 50, 1, 500, 'database admission limit'),
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statementTimeoutMillis: boundedInteger(
      env.WELLSIM_DB_STATEMENT_TIMEOUT_MS, 15000, 100, 120000, 'database statement timeout',
    ),
  });
}

export class TenantAccessError extends Error {
  constructor() {
    super('Active workspace membership is required');
    this.code = 'tenant_access_denied';
  }
}

// SET LOCAL and transaction-local GUCs are reset by both COMMIT and ROLLBACK.
// An uncertain/broken connection is destroyed instead of returned to the pool.
export async function runTenantTransaction(pool, config, context, operation) {
  const { userId, workspaceId } = context ?? {};
  if (typeof userId !== 'string' || typeof workspaceId !== 'string'
      || !UUID.test(userId) || !UUID.test(workspaceId)) throw new TenantAccessError();
  if (typeof operation !== 'function') throw new TypeError('Transaction operation is required');
  if (!IDENTIFIER.test(config.runtimeRole)) throw new Error('Invalid runtime role');
  const client = await pool.connect();
  let transaction = false;
  let discard = false;
  let active = false;
  const pending = new Set();
  try {
    // Mark uncertain BEGIN failures for rollback/destruction too.
    transaction = true;
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE "${config.runtimeRole}"`);
    await client.query(
      `SELECT set_config('app.user_id', $1, true),
              set_config('app.workspace_id', $2, true),
              set_config('statement_timeout', $3, true)`,
      [userId, workspaceId, `${config.statementTimeoutMillis}ms`],
    );
    const membership = await client.query(
      "SELECT app.has_workspace_permission($1::uuid, 'workspace.read') AS allowed",
      [workspaceId],
    );
    if (membership.rows[0]?.allowed !== true) throw new TenantAccessError();
    active = true;
    const query = (text, values = []) => {
      if (!active) return Promise.reject(new Error('Transaction query handle has expired'));
      if (typeof text !== 'string' || !Array.isArray(values)) {
        return Promise.reject(new TypeError('Use parameterized SQL text and a values array'));
      }
      // Extended protocol also refuses stacked SQL statements. SQL text is
      // trusted application code; user data belongs only in the values array.
      const result = client.query({ text, values, queryMode: 'extended' });
      pending.add(result);
      result.then(() => pending.delete(result), () => pending.delete(result));
      return result;
    };
    const result = await operation(Object.freeze({ query }));
    active = false;
    if (pending.size) {
      await Promise.allSettled([...pending]);
      throw new Error('Every transaction query must be awaited');
    }
    const commit = await client.query('COMMIT');
    // PostgreSQL reports ROLLBACK if a callback swallowed a database error.
    if (commit.command !== 'COMMIT') throw new Error('Transaction did not commit');
    transaction = false;
    return result;
  } catch (error) {
    active = false;
    if (transaction) {
      try { await client.query('ROLLBACK'); } catch { discard = true; }
    }
    throw error;
  } finally {
    active = false;
    client.release(discard);
  }
}

export async function verifyDatabaseBoundary(pool, config) {
  const client = await pool.connect();
  let transaction = false;
  let discard = false;
  try {
    const identity = await client.query(
      `SELECT session_user AS login_role, current_user AS effective_role,
              pg_has_role(session_user, $1::text, 'SET') AS can_set_runtime,
              has_schema_privilege(session_user, 'app', 'USAGE') AS direct_schema_access,
              EXISTS (
                SELECT 1 FROM pg_auth_members m JOIN pg_roles parent ON parent.oid=m.roleid
                WHERE m.member=r.oid AND (parent.rolname <> $1 OR m.admin_option
                  OR m.inherit_option OR NOT m.set_option)
              ) AS unsafe_membership,
              r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolbypassrls, r.rolinherit
       FROM pg_roles AS r WHERE r.rolname = session_user`,
      [config.runtimeRole],
    );
    const login = identity.rows[0];
    if (!login || login.login_role !== config.loginRole || login.effective_role !== config.loginRole
        || !login.can_set_runtime || login.direct_schema_access || login.unsafe_membership
        || login.rolsuper || login.rolcreatedb || login.rolcreaterole
        || login.rolbypassrls || login.rolinherit) throw new Error('Unsafe database login privileges');
    transaction = true;
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE "${config.runtimeRole}"`);
    const privileges = await client.query(
      `SELECT current_user AS runtime_role, r.rolcanlogin, r.rolsuper,
              r.rolcreatedb, r.rolcreaterole, r.rolbypassrls,
              has_schema_privilege(current_user, 'app', 'CREATE') AS schema_create,
              has_table_privilege(current_user, 'app.engineering_case', 'DELETE') AS case_delete,
              EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid) AS parent_membership,
              (SELECT count(*)::integer FROM app.workspace) AS visible_without_context
       FROM pg_roles AS r WHERE r.rolname = current_user`,
    );
    const runtime = privileges.rows[0];
    if (!runtime || runtime.runtime_role !== config.runtimeRole || runtime.rolcanlogin
        || runtime.rolsuper || runtime.rolcreatedb || runtime.rolcreaterole || runtime.rolbypassrls
        || runtime.schema_create || runtime.case_delete || runtime.parent_membership
        || runtime.visible_without_context !== 0) {
      throw new Error('Unsafe database runtime privileges');
    }
    await client.query('ROLLBACK');
    transaction = false;
  } finally {
    if (transaction) {
      try { await client.query('ROLLBACK'); } catch { discard = true; }
    }
    client.release(discard);
  }
}

export async function initializeDatabase(env = process.env, {
  PoolClass = pg.Pool,
  onPoolError = () => console.error('PostgreSQL idle connection failed; connection discarded'),
} = {}) {
  const config = databaseConfigFromEnv(env);
  if (!config.enabled) return Object.freeze({ enabled: false, close: async () => {} });
  const pool = new PoolClass({
    connectionString: config.connectionString,
    max: config.max,
    connectionTimeoutMillis: config.connectionTimeoutMillis,
    idleTimeoutMillis: config.idleTimeoutMillis,
    statement_timeout: config.statementTimeoutMillis,
    idle_in_transaction_session_timeout: config.statementTimeoutMillis,
    application_name: 'bldrz-v2',
    keepAlive: true,
  });
  pool.on('error', onPoolError);
  try { await verifyDatabaseBoundary(pool, config); } catch {
    await pool.end();
    // Never include connection URLs, credentials or driver details in startup logs.
    throw new Error('PostgreSQL startup boundary check failed');
  }
  let pending = 0;
  let closed = false;
  async function admit(operation) {
    if (closed) throw new Error('Database is shutting down');
    if (pending >= config.maxPending) {
      const error = new Error('Database is busy; retry later');
      error.code = 'database_busy';
      throw error;
    }
    pending += 1;
    try { return await operation(); }
    finally { pending -= 1; }
  }
  return Object.freeze({
    enabled: true,
    auth: createAuthRepository((text, values) =>
      admit(() => runAuthStatement(pool, config, text, values))),
    async withTenantTransaction(context, operation) {
      return admit(() => runTenantTransaction(pool, config, context, operation));
    },
    async close() {
      closed = true;
      await pool.end();
    },
  });
}
