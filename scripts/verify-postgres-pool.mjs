// Native, destructive-to-fixture checks are deliberately confined to a named
// disposable clone. The caller supplies only the application's credentials.
import assert from 'node:assert/strict';
import pg from 'pg';
import { initializeDatabase } from '../src/server/database.js';

const url = new URL(process.env.DATABASE_URL);
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.pathname, '/bldrz_pool_probe', 'Refusing to test outside the disposable clone');
const tenants = [
  { userId: '10000000-0000-4000-8000-000000000001', workspaceId: '10000000-0000-4000-8000-000000000010' },
  { userId: '20000000-0000-4000-8000-000000000002', workspaceId: '20000000-0000-4000-8000-000000000020' },
];
let pool;
const database = await initializeDatabase({
  ...process.env,
  WELLSIM_DATABASE_ENABLED: '1',
  WELLSIM_DB_LOGIN_ROLE: 'bldrz_app',
  WELLSIM_DB_RUNTIME_ROLE: 'bldrz_runtime',
  WELLSIM_DB_POOL_MAX: '1',
  WELLSIM_DB_MAX_PENDING: '50',
  WELLSIM_DB_STATEMENT_TIMEOUT_MS: '500',
}, {
  PoolClass: class extends pg.Pool {
    constructor(options) { super(options); pool = this; }
  },
});

async function assertReset() {
  const client = await pool.connect();
  try {
    const { rows: [row] } = await client.query(`
      SELECT current_user AS role,
        COALESCE(current_setting('app.user_id', true), '') AS user_id,
        COALESCE(current_setting('app.workspace_id', true), '') AS workspace_id
    `);
    assert.deepEqual(row, { role: 'bldrz_app', user_id: '', workspace_id: '' });
  } finally { client.release(); }
}

const readCases = (tenant) => database.withTenantTransaction(tenant, async (tx) => {
  const { rows } = await tx.query('SELECT workspace_id, title, pg_backend_pid() AS pid FROM app.engineering_case');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].workspace_id, tenant.workspaceId);
  return rows[0];
});

try {
  const a = await readCases(tenants[0]);
  await assertReset();
  const b = await readCases(tenants[1]);
  await assertReset();
  assert.equal(a.pid, b.pid, 'The same physical connection must be reused');
  console.log('PASS sequential tenant reuse and context reset');

  let invoked = false;
  await assert.rejects(database.withTenantTransaction({
    userId: tenants[0].userId, workspaceId: tenants[1].workspaceId,
  }, () => { invoked = true; }), { code: 'tenant_access_denied' });
  assert.equal(invoked, false);
  await assertReset();
  console.log('PASS mismatched membership fails before application SQL');

  await assert.rejects(database.withTenantTransaction(tenants[0], async (tx) => {
    await tx.query('UPDATE app.engineering_case SET title=$1', ['must roll back']);
    throw new Error('deliberate callback failure');
  }), /deliberate callback failure/);
  assert.equal((await readCases(tenants[0])).title, 'A Confidential');
  await assertReset();
  console.log('PASS callback failure rolls back writes and context');

  await assert.rejects(database.withTenantTransaction(tenants[0], (tx) =>
    tx.query('SELECT $1::integer', ['not-an-integer'])), { code: '22P02' });
  await assertReset();
  await assert.rejects(database.withTenantTransaction(tenants[0], (tx) =>
    tx.query('SELECT pg_sleep(2)')), { code: '57014' });
  await assertReset();
  await readCases(tenants[1]);
  console.log('PASS SQL error/timeout recovery on the next tenant request');

  await assert.rejects(database.withTenantTransaction(tenants[0], (tx) =>
    tx.query('SELECT 1; SELECT 2')), { code: '42601' });
  await assertReset();
  console.log('PASS extended protocol rejects stacked SQL');

  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => readCases(tenants[i % 2])));
  assert.ok(results.every((row, i) => row.workspace_id === tenants[i % 2].workspaceId));
  assert.equal(pool.totalCount, 1);
  await assertReset();
  console.log('PASS 20 interleaved requests isolated through one pooled connection');
  console.log('NATIVE_POOL_VERIFICATION_OK');
} finally {
  await database.close();
}
