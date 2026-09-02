// Fixed identity-plane operations only: callers cannot supply SQL, user IDs,
// permissions or memberships. No raw pool/query handle leaves this boundary.
export function createAuthRepository(call) {
  return Object.freeze({
    async ready() {
      const result = await call(`SELECT
        (SELECT bool_and(p.prosecdef AND p.proowner =
          (SELECT relowner FROM pg_class WHERE oid='app.engineering_case'::regclass)
          AND p.proconfig @> ARRAY['search_path=pg_catalog']
          AND has_function_privilege(current_user, p.oid, 'EXECUTE')
          AND NOT has_function_privilege('public', p.oid, 'EXECUTE'))
        FROM pg_proc p WHERE p.oid = ANY(ARRAY[
          'app.auth_create_flow(text,text,text,text,boolean,uuid)'::regprocedure,
          'app.auth_consume_flow(text)'::regprocedure,
          'app.auth_create_session(text,text,text,text,text)'::regprocedure,
          'app.auth_complete_login(text,text,text,boolean,text,text,text,bigint,uuid,boolean)'::regprocedure,
          'app.auth_read_session(text)'::regprocedure,
          'app.auth_revoke_session(text)'::regprocedure,
          'app.auth_list_workspaces(text)'::regprocedure]::oid[]))
        AND NOT EXISTS (SELECT FROM unnest(ARRAY['app.login_transaction',
          'app.web_session', 'app.authentication_event']) AS t(name)
          WHERE has_table_privilege(current_user, name, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
            OR has_any_column_privilege(current_user, name, 'SELECT,INSERT,UPDATE,REFERENCES'))
        AS safe`, []);
      if (result.rows[0]?.safe !== true) throw new Error('Unsafe identity repository privileges');
    },
    async createFlow(hash, flow) {
      const result = await call('SELECT app.auth_create_flow($1,$2,$3,$4,$5,$6::uuid) AS accepted',
        [hash, flow.state, flow.nonce, flow.codeVerifier, flow.requireMfa === true, flow.expectedUserId ?? null]);
      return result.rows[0]?.accepted === true;
    },
    async consumeFlow(hash) {
      const result = await call('SELECT * FROM app.auth_consume_flow($1)', [hash]);
      const row = result.rows[0];
      return row && { state: row.state, nonce: row.nonce, codeVerifier: row.code_verifier,
        ...(row.require_mfa ? { requireMfa: true, expectedUserId: row.expected_user_id } : {}) };
    },
    async completeLogin(identity, hash, csrf, previousHash, { expectedUserId = null, onboardingEnabled = false } = {}) {
      const result = await call('SELECT app.auth_complete_login($1,$2,$3,$4,$5,$6,$7,$8::bigint,$9::uuid,$10) AS id',
        [identity.issuer, identity.subject, identity.email ?? null, identity.emailVerified === true,
          hash, csrf, previousHash, identity.mfaAuthenticatedAt ?? null, expectedUserId, onboardingEnabled]);
      return result.rows[0]?.id ?? undefined;
    },
    async createSession(identity, hash, csrf, previousHash) {
      const result = await call('SELECT * FROM app.auth_create_session($1,$2,$3,$4,$5)',
        [identity.issuer, identity.subject, hash, csrf, previousHash]);
      return result.rows[0]?.user_id;
    },
    async readSession(hash) {
      const result = await call('SELECT * FROM app.auth_read_session($1)', [hash]);
      const row = result.rows[0];
      return row && { userId: row.user_id, displayName: row.display_name, csrfToken: row.csrf_token,
        mfaExpiresAt: row.mfa_expires_at ?? null };
    },
    async revokeSession(hash) { await call('SELECT app.auth_revoke_session($1)', [hash]); },
    async listWorkspaces(hash) {
      return (await call('SELECT * FROM app.auth_list_workspaces($1)', [hash])).rows;
    },
  });
}

export async function runAuthStatement(pool, config, text, values) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(config.runtimeRole)) throw new Error('Invalid runtime role');
  const client = await pool.connect();
  let transaction = false;
  let discard = false;
  try {
    transaction = true;
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE "${config.runtimeRole}"`);
    await client.query(`SELECT set_config('app.user_id', '', true),
      set_config('app.workspace_id', '', true), set_config('statement_timeout', $1, true)`,
    [`${config.statementTimeoutMillis}ms`]);
    const result = await client.query({ text, values, queryMode: 'extended' });
    const commit = await client.query('COMMIT');
    if (commit.command !== 'COMMIT') throw new Error('Identity transaction did not commit');
    transaction = false;
    return result;
  } catch (error) {
    if (transaction) {
      try { await client.query('ROLLBACK'); } catch { discard = true; }
    }
    throw error;
  } finally { client.release(discard); }
}
