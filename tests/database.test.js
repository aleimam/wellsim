import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  databaseConfigFromEnv, initializeDatabase, runTenantTransaction, TenantAccessError,
} from '../src/server/database.js';

const env = {
  WELLSIM_DATABASE_ENABLED: '1',
  WELLSIM_DB_LOGIN_ROLE: 'bldrz_app',
  WELLSIM_DB_RUNTIME_ROLE: 'bldrz_runtime',
  DATABASE_URL: 'postgresql://bldrz_app:test-only@127.0.0.1:5432/bldrz',
};
const config = databaseConfigFromEnv(env);
const context = {
  userId: '10000000-0000-4000-8000-000000000001',
  workspaceId: '10000000-0000-4000-8000-000000000010',
};

function fakePool(responder = () => undefined) {
  const calls = [];
  const releases = [];
  const client = {
    async query(query, values) {
      const text = typeof query === 'string' ? query : query.text;
      calls.push({ text, values: values ?? query.values, query });
      const override = await responder(text, values ?? query.values);
      if (override !== undefined) return override;
      if (text.includes('AS allowed')) return { rows: [{ allowed: true }] };
      if (text.includes('AS login_role')) return { rows: [{
        login_role: 'bldrz_app', effective_role: 'bldrz_app', can_set_runtime: true,
        direct_schema_access: false, unsafe_membership: false,
        rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolbypassrls: false, rolinherit: false,
      }] };
      if (text.includes('AS runtime_role')) return { rows: [{
        runtime_role: 'bldrz_runtime', rolcanlogin: false, rolsuper: false,
        rolcreatedb: false, rolcreaterole: false, rolbypassrls: false,
        schema_create: false, case_delete: false, parent_membership: false, visible_without_context: 0,
      }] };
      return { rows: [], command: text };
    },
    release(discard) { releases.push(discard); },
  };
  return {
    calls, releases, connects: 0, ended: false,
    async connect() { this.connects += 1; return client; },
    on() {},
    async end() { this.ended = true; },
  };
}

test('database configuration is opt-in, loopback-only and bounded', () => {
  assert.deepEqual(databaseConfigFromEnv({}), { enabled: false });
  assert.equal(config.max, 10);
  assert.equal(config.maxPending, 50);
  for (const override of [
    { DATABASE_URL: '' },
    { DATABASE_URL: env.DATABASE_URL.replace('127.0.0.1', 'db.example.test') },
    { DATABASE_URL: `${env.DATABASE_URL}?user=postgres` },
    { WELLSIM_DB_LOGIN_ROLE: 'postgres' },
    { WELLSIM_DB_RUNTIME_ROLE: 'runtime; RESET ROLE' },
    { WELLSIM_DB_POOL_MAX: '0' },
    { WELLSIM_DB_POOL_MAX: '21' },
    { WELLSIM_DB_MAX_PENDING: 'Infinity' },
  ]) {
    assert.throws(() => databaseConfigFromEnv({ ...env, ...override }), (error) => {
      assert.ok(!error.message.includes('test-only'));
      return true;
    });
  }
});

test('tenant transactions use local role/context and a scoped parameterized query handle', async () => {
  const pool = fakePool();
  let handle;
  const result = await runTenantTransaction(pool, config, context, async (tx) => {
    handle = tx;
    assert.deepEqual(Object.keys(tx), ['query']);
    await tx.query('SELECT $1::text', ['safe input']);
    return 42;
  });
  assert.equal(result, 42);
  assert.equal(pool.calls[0].text, 'BEGIN');
  assert.equal(pool.calls[1].text, 'SET LOCAL ROLE "bldrz_runtime"');
  assert.deepEqual(pool.calls[2].values, [context.userId, context.workspaceId, '15000ms']);
  assert.ok(pool.calls[3].text.includes('has_workspace_permission'));
  assert.equal(pool.calls[4].query.queryMode, 'extended');
  assert.equal(pool.calls.at(-1).text, 'COMMIT');
  assert.deepEqual(pool.releases, [false]);
  await assert.rejects(handle.query('SELECT 1'), /expired/);
});

test('invalid identity and inactive membership fail before a tenant operation runs', async () => {
  const pool = fakePool(() => ({ rows: [{ allowed: false }], command: 'ROLLBACK' }));
  for (const input of [null, {}, { ...context, userId: 'injected' }, { ...context, workspaceId: 1 }]) {
    await assert.rejects(runTenantTransaction(pool, config, input, () => {}), TenantAccessError);
  }
  assert.equal(pool.connects, 0);
  let called = false;
  await assert.rejects(runTenantTransaction(pool, config, context, () => { called = true; }), TenantAccessError);
  assert.equal(called, false);
  assert.equal(pool.calls.at(-1).text, 'ROLLBACK');
  assert.deepEqual(pool.releases, [false]);
});

test('transaction failures roll back and uncertain connections are destroyed', async () => {
  const error = new Error('application failed');
  for (const brokenRollback of [false, true]) {
    const pool = fakePool((text) => {
      if (text === 'ROLLBACK' && brokenRollback) throw new Error('connection lost');
    });
    await assert.rejects(runTenantTransaction(pool, config, context, async () => { throw error; }), (caught) => caught === error);
    assert.equal(pool.calls.at(-1).text, 'ROLLBACK');
    assert.deepEqual(pool.releases, [brokenRollback]);
  }
  const swallowed = fakePool((text) => text === 'COMMIT' ? { command: 'ROLLBACK' } : undefined);
  await assert.rejects(runTenantTransaction(swallowed, config, context, async () => {}), /did not commit/);
  assert.equal(swallowed.calls.at(-1).text, 'ROLLBACK');
});

test('unawaited transaction work cannot commit or escape its query scope', async () => {
  let finish;
  const pool = fakePool((text) => text === 'SELECT delayed'
    ? new Promise((resolve) => { finish = resolve; }) : undefined);
  const running = runTenantTransaction(pool, config, context, (tx) => {
    void tx.query('SELECT delayed');
    setImmediate(() => finish({ rows: [] }));
  });
  await assert.rejects(running, /must be awaited/);
  assert.equal(pool.calls.at(-1).text, 'ROLLBACK');
  assert.ok(!pool.calls.some(({ text }) => text === 'COMMIT'));
});

test('startup checks privileges, limits admission, closes pools and sanitizes failures', async () => {
  const pool = fakePool();
  let options;
  const runtime = await initializeDatabase({ ...env, WELLSIM_DB_MAX_PENDING: '1' }, {
    PoolClass: class { constructor(value) { options = value; return pool; } },
  });
  assert.equal(options.max, 10);
  assert.equal(options.connectionTimeoutMillis, 5000);
  assert.equal(options.statement_timeout, 15000);
  let finish;
  const first = runtime.withTenantTransaction(context, () => new Promise((resolve) => { finish = resolve; }));
  await assert.rejects(runtime.withTenantTransaction(context, async () => {}), { code: 'database_busy' });
  while (!finish) await new Promise(setImmediate);
  finish();
  await first;
  await runtime.close();
  assert.equal(pool.ended, true);
  await assert.rejects(runtime.withTenantTransaction(context, async () => {}), /shutting down/);

  const unsafe = fakePool((text) => text.includes('AS login_role') ? { rows: [{
    login_role: 'bldrz_app', effective_role: 'bldrz_app', can_set_runtime: true,
    unsafe_membership: true,
  }] } : undefined);
  await assert.rejects(initializeDatabase(env, {
    PoolClass: class { constructor() { return unsafe; } },
  }), /^Error: PostgreSQL startup boundary check failed$/);
  assert.equal(unsafe.ended, true);
});
