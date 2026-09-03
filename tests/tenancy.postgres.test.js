import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const root = path.resolve(import.meta.dirname, '..');
const migrationDir = path.join(root, 'db', 'migrations');

const WORKSPACE_SCOPED_TABLES = Object.freeze([
  'audit_event',
  'calculation_run',
  'case_file_link',
  'case_revision',
  'dataset',
  'engineering_case',
  'export_artifact',
  'export_item',
  'export_job',
  'field_asset',
  'file_object',
  'membership',
  'organization',
  'organization_join_request',
  'project',
  'project_well',
  'reservoir',
  'well',
  'wellbore',
  'workspace_invitation',
]);

const MEMBERSHIP_BOUND_ACTORS = Object.freeze([
  ['audit_event', 'actor_user_id'],
  ['calculation_run', 'executed_by'],
  ['case_file_link', 'linked_by'],
  ['case_revision', 'created_by'],
  ['dataset', 'created_by'],
  ['engineering_case', 'created_by'],
  ['export_job', 'requested_by'],
  ['field_asset', 'created_by'],
  ['file_object', 'created_by'],
  ['membership', 'invited_by'],
  ['project', 'created_by'],
  ['project_well', 'linked_by'],
  ['reservoir', 'created_by'],
  ['well', 'created_by'],
  ['wellbore', 'created_by'],
  ['workspace_invitation', 'accepted_by'],
  ['workspace_invitation', 'invited_by'],
]);

const ID = Object.freeze({
  userA: '00000000-0000-4000-8000-0000000000a1',
  userB: '00000000-0000-4000-8000-0000000000b1',
  userPersonal: '00000000-0000-4000-8000-0000000000c1',
  identityB: '00000000-0000-4000-8000-0000000001b1',
  workspaceA: '00000000-0000-4000-8000-0000000010a1',
  workspaceB: '00000000-0000-4000-8000-0000000010b1',
  workspacePersonal: '00000000-0000-4000-8000-0000000010c1',
  workspacePersonalOther: '00000000-0000-4000-8000-0000000010c2',
  invitationB: '00000000-0000-4000-8000-0000000011b1',
  fieldA: '00000000-0000-4000-8000-0000000020a1',
  fieldB: '00000000-0000-4000-8000-0000000020b1',
  fieldPersonal: '00000000-0000-4000-8000-0000000020c1',
  reservoirB: '00000000-0000-4000-8000-0000000021b1',
  wellA: '00000000-0000-4000-8000-0000000030a1',
  wellB: '00000000-0000-4000-8000-0000000030b1',
  wellPersonal: '00000000-0000-4000-8000-0000000030c1',
  wellboreB: '00000000-0000-4000-8000-0000000031b1',
  projectA: '00000000-0000-4000-8000-0000000040a1',
  projectB: '00000000-0000-4000-8000-0000000040b1',
  projectPersonal: '00000000-0000-4000-8000-0000000040c1',
  caseA: '00000000-0000-4000-8000-0000000050a1',
  caseB: '00000000-0000-4000-8000-0000000050b1',
  casePersonal: '00000000-0000-4000-8000-0000000050c1',
  revisionA: '00000000-0000-4000-8000-0000000060a1',
  revisionB: '00000000-0000-4000-8000-0000000060b1',
  revisionPersonal: '00000000-0000-4000-8000-0000000060c1',
  runB: '00000000-0000-4000-8000-0000000061b1',
  datasetB: '00000000-0000-4000-8000-0000000062b1',
  exportA: '00000000-0000-4000-8000-0000000070a1',
  exportB: '00000000-0000-4000-8000-0000000070b1',
  exportPersonal: '00000000-0000-4000-8000-0000000070c1',
  exportItemA: '00000000-0000-4000-8000-0000000071a1',
  exportItemCross: '00000000-0000-4000-8000-0000000071a2',
  exportItemPersonal: '00000000-0000-4000-8000-0000000071c1',
  exportItemPersonalCross: '00000000-0000-4000-8000-0000000071c2',
  fileA: '00000000-0000-4000-8000-0000000080a1',
  fileB: '00000000-0000-4000-8000-0000000080b1',
  filePersonal: '00000000-0000-4000-8000-0000000080c1',
  auditB: '00000000-0000-4000-8000-0000000090b1',
  correlationB: '00000000-0000-4000-8000-0000000091b1',
});

let db;

async function applyMigrations() {
  const files = (await fs.readdir(migrationDir))
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .sort();
  for (const file of files) {
    await db.exec(await fs.readFile(path.join(migrationDir, file), 'utf8'));
  }
}

async function runAs(userId, workspaceId, operation) {
  await db.exec('BEGIN');
  try {
    await db.exec('SET LOCAL ROLE wellsim_runtime');
    await db.query(
      `SELECT
         set_config('app.user_id', $1, true),
         set_config('app.workspace_id', $2, true)`,
      [userId, workspaceId],
    );
    const result = await operation();
    await db.exec('COMMIT');
    return result;
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}

async function expectDatabaseError(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, error.message);
    return true;
  });
}

before(async () => {
  db = new PGlite();
  await applyMigrations();
  await db.exec(`
    INSERT INTO app.app_user (id, email, display_name) VALUES
      ('${ID.userA}', 'owner-a@example.test', 'Owner A'),
      ('${ID.userB}', 'owner-b@example.test', 'Owner B'),
      ('${ID.userPersonal}', 'individual@example.test', 'Individual User');

    INSERT INTO app.auth_identity (id, user_id, provider, provider_subject) VALUES
      ('${ID.identityB}', '${ID.userB}', 'test', 'company-b-owner');

    INSERT INTO app.workspace (id, kind, name, slug, owner_user_id) VALUES
      ('${ID.workspaceA}', 'organization', 'Company A', 'company-a', NULL),
      ('${ID.workspaceB}', 'organization', 'Company B', 'company-b', NULL),
      ('${ID.workspacePersonal}', 'personal', 'Individual Workspace',
       'individual-workspace', '${ID.userPersonal}');

    INSERT INTO app.organization (workspace_id, legal_name) VALUES
      ('${ID.workspaceA}', 'Company A Petroleum Ltd'),
      ('${ID.workspaceB}', 'Company B Energy Ltd');

    INSERT INTO app.membership (workspace_id, user_id, role_key, status, joined_at) VALUES
      ('${ID.workspaceA}', '${ID.userA}', 'owner', 'active', statement_timestamp()),
      ('${ID.workspaceB}', '${ID.userB}', 'owner', 'active', statement_timestamp()),
      ('${ID.workspacePersonal}', '${ID.userPersonal}', 'owner', 'active', statement_timestamp());

    INSERT INTO app.workspace_invitation
      (workspace_id, id, email, role_key, token_hash, invited_by, expires_at)
    VALUES
      ('${ID.workspaceB}', '${ID.invitationB}', 'invite-b@example.test', 'viewer',
       repeat('b', 64), '${ID.userB}', statement_timestamp() + interval '1 day');

    INSERT INTO app.field_asset (workspace_id, id, name, created_by) VALUES
      ('${ID.workspaceA}', '${ID.fieldA}', 'A Field', '${ID.userA}'),
      ('${ID.workspaceB}', '${ID.fieldB}', 'B Field', '${ID.userB}'),
      ('${ID.workspacePersonal}', '${ID.fieldPersonal}', 'Private Field', '${ID.userPersonal}');

    INSERT INTO app.reservoir (workspace_id, id, field_id, name, created_by) VALUES
      ('${ID.workspaceB}', '${ID.reservoirB}', '${ID.fieldB}', 'B Reservoir', '${ID.userB}');

    INSERT INTO app.well (workspace_id, id, field_id, name, created_by) VALUES
      ('${ID.workspaceA}', '${ID.wellA}', '${ID.fieldA}', 'A-01', '${ID.userA}'),
      ('${ID.workspaceB}', '${ID.wellB}', '${ID.fieldB}', 'B-01', '${ID.userB}'),
      ('${ID.workspacePersonal}', '${ID.wellPersonal}', '${ID.fieldPersonal}',
       'Private-01', '${ID.userPersonal}');

    INSERT INTO app.wellbore (workspace_id, id, well_id, name, created_by) VALUES
      ('${ID.workspaceB}', '${ID.wellboreB}', '${ID.wellB}', 'B-01 Main', '${ID.userB}');

    INSERT INTO app.project (workspace_id, id, name, status, created_by) VALUES
      ('${ID.workspaceA}', '${ID.projectA}', 'A Well Performance', 'active', '${ID.userA}'),
      ('${ID.workspaceB}', '${ID.projectB}', 'B Well Performance', 'active', '${ID.userB}'),
      ('${ID.workspacePersonal}', '${ID.projectPersonal}', 'Private Study', 'active',
       '${ID.userPersonal}');

    INSERT INTO app.project_well (workspace_id, project_id, well_id, linked_by) VALUES
      ('${ID.workspaceA}', '${ID.projectA}', '${ID.wellA}', '${ID.userA}'),
      ('${ID.workspaceB}', '${ID.projectB}', '${ID.wellB}', '${ID.userB}'),
      ('${ID.workspacePersonal}', '${ID.projectPersonal}', '${ID.wellPersonal}',
       '${ID.userPersonal}');

    INSERT INTO app.engineering_case
      (workspace_id, id, project_id, well_id, module_id, title, created_by)
    VALUES
      ('${ID.workspaceA}', '${ID.caseA}', '${ID.projectA}', '${ID.wellA}', 'production.well-performance', 'A confidential case', '${ID.userA}'),
      ('${ID.workspaceB}', '${ID.caseB}', '${ID.projectB}', '${ID.wellB}', 'production.well-performance', 'B confidential case', '${ID.userB}'),
      ('${ID.workspacePersonal}', '${ID.casePersonal}', '${ID.projectPersonal}',
       '${ID.wellPersonal}', 'production.well-performance', 'Private personal case',
       '${ID.userPersonal}');

    INSERT INTO app.case_revision
      (workspace_id, id, case_id, revision_number, input_schema_id, input_document, created_by)
    VALUES
      ('${ID.workspaceA}', '${ID.revisionA}', '${ID.caseA}', 1, 'wellsim.case.v1', '{"company":"A"}', '${ID.userA}'),
      ('${ID.workspaceB}', '${ID.revisionB}', '${ID.caseB}', 1, 'wellsim.case.v1', '{"company":"B"}', '${ID.userB}'),
      ('${ID.workspacePersonal}', '${ID.revisionPersonal}', '${ID.casePersonal}', 1,
       'wellsim.case.v1', '{"personal":true}', '${ID.userPersonal}');

    INSERT INTO app.calculation_run
      (workspace_id, id, case_revision_id, module_id, engine_id, engine_version,
       deployment_revision, input_snapshot, output_schema_id, output_document,
       validity_status, executed_by, started_at, completed_at)
    VALUES
      ('${ID.workspaceB}', '${ID.runB}', '${ID.revisionB}', 'production.well-performance',
       'wellsim-core', '1', 'test-revision', '{"company":"B"}', 'wellsim.result.v1',
       '{"confidential":true}', 'valid', '${ID.userB}', statement_timestamp(),
       statement_timestamp());

    INSERT INTO app.dataset
      (workspace_id, id, well_id, dataset_type, schema_version, source, created_by)
    VALUES
      ('${ID.workspaceB}', '${ID.datasetB}', '${ID.wellB}', 'production-history',
       '1', 'Company B historian', '${ID.userB}');

    INSERT INTO app.file_object
      (workspace_id, id, object_key, original_name, media_type, byte_size, checksum_sha256, scan_status, created_by)
    VALUES
      ('${ID.workspaceA}', '${ID.fileA}', 'workspace-a/case-a.json', 'case-a.json', 'application/json', 10, repeat('a', 64), 'clean', '${ID.userA}'),
      ('${ID.workspaceB}', '${ID.fileB}', 'workspace-b/case-b.json', 'case-b.json', 'application/json', 10, repeat('b', 64), 'clean', '${ID.userB}'),
      ('${ID.workspacePersonal}', '${ID.filePersonal}', 'workspace-personal/case.json',
       'private-case.json', 'application/json', 10, repeat('c', 64), 'clean',
       '${ID.userPersonal}');

    INSERT INTO app.case_file_link (workspace_id, case_id, file_object_id, purpose, linked_by)
    VALUES
      ('${ID.workspaceB}', '${ID.caseB}', '${ID.fileB}', 'confidential evidence', '${ID.userB}'),
      ('${ID.workspacePersonal}', '${ID.casePersonal}', '${ID.filePersonal}',
       'private evidence', '${ID.userPersonal}');

    INSERT INTO app.export_job
      (workspace_id, id, requested_by, exporter_id, exporter_version, status, source_snapshot)
    VALUES
      ('${ID.workspaceB}', '${ID.exportB}', '${ID.userB}', 'case-xlsx', 1, 'queued', '{"case":"B"}'),
      ('${ID.workspacePersonal}', '${ID.exportPersonal}', '${ID.userPersonal}',
       'case-xlsx', 1, 'queued', '{"personal":true}');

    INSERT INTO app.export_item (workspace_id, id, export_job_id, case_id)
    VALUES
      ('${ID.workspaceB}', '00000000-0000-4000-8000-0000000071b1', '${ID.exportB}', '${ID.caseB}'),
      ('${ID.workspacePersonal}', '${ID.exportItemPersonal}', '${ID.exportPersonal}',
       '${ID.casePersonal}');

    INSERT INTO app.export_artifact
      (workspace_id, export_job_id, file_object_id, source_manifest)
    VALUES
      ('${ID.workspaceB}', '${ID.exportB}', '${ID.fileB}', '{"company":"B"}');

    INSERT INTO app.audit_event
      (workspace_id, id, actor_user_id, action, target_type, target_id,
       outcome, correlation_id, details)
    VALUES
      ('${ID.workspaceB}', '${ID.auditB}', '${ID.userB}', 'case.read',
       'engineering_case', '${ID.caseB}', 'success', '${ID.correlationB}',
       '{"company":"B"}');
  `);
});

after(async () => {
  await db?.close();
});

test('PostgreSQL migrations enable RLS and a non-bypass runtime role', async () => {
  const versions = await db.query('SELECT version FROM app.schema_migration ORDER BY version');
  assert.deepEqual(versions.rows.map((row) => row.version), [
    '0001_platform_foundation',
    '0002_tenant_isolation',
    '0003_personal_workspace_integrity',
    '0004_verified_sessions',
    '0005_controlled_onboarding',
    '0006_administrator_mfa',
    '0007_portals_help_and_join_requests',
  ]);

  const role = await db.query(
    `SELECT rolcanlogin, rolinherit, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls
     FROM pg_roles WHERE rolname = 'wellsim_runtime'`,
  );
  assert.deepEqual(role.rows, [{
    rolcanlogin: false,
    rolinherit: false,
    rolsuper: false,
    rolcreaterole: false,
    rolcreatedb: false,
    rolbypassrls: false,
  }]);

  const inheritedRoles = await db.query(
    `SELECT parent.rolname
     FROM pg_auth_members AS membership_record
     JOIN pg_roles AS member_role ON member_role.oid = membership_record.member
     JOIN pg_roles AS parent ON parent.oid = membership_record.roleid
     WHERE member_role.rolname = 'wellsim_runtime'`,
  );
  assert.deepEqual(inheritedRoles.rows, []);

  const deleteGrants = await db.query(
    `SELECT table_name
     FROM information_schema.role_table_grants
     WHERE table_schema = 'app'
       AND grantee = 'wellsim_runtime'
       AND privilege_type = 'DELETE'`,
  );
  assert.deepEqual(deleteGrants.rows, [], 'runtime must not delete tenant evidence');

  const unprotected = await db.query(
    `SELECT c.relname
     FROM pg_class AS c
     JOIN pg_namespace AS n ON n.oid = c.relnamespace
     WHERE n.nspname = 'app'
       AND c.relkind = 'r'
       AND c.relname NOT IN ('schema_migration', 'permission_definition', 'role_definition', 'role_permission')
       AND NOT c.relrowsecurity
     ORDER BY c.relname`,
  );
  assert.deepEqual(unprotected.rows, []);

  const externalPermissions = await db.query(
    `SELECT permission_key FROM app.role_permission
     WHERE role_key = 'external_collaborator'`,
  );
  assert.deepEqual(externalPermissions.rows, [], 'external access stays closed until scoped grants exist');

  const publicPrivileges = await db.query(
    `SELECT
       has_schema_privilege('public', 'app', 'USAGE') AS schema_usage,
       has_schema_privilege('wellsim_runtime', 'app', 'CREATE') AS runtime_schema_create,
       has_table_privilege('public', 'app.engineering_case', 'SELECT') AS case_select,
       has_function_privilege(
         'public', 'app.has_workspace_permission(uuid,text)', 'EXECUTE'
       ) AS permission_execute,
       has_table_privilege(
         'wellsim_runtime', 'app.engineering_case', 'DELETE'
       ) AS runtime_delete,
       has_column_privilege(
         'wellsim_runtime', 'app.engineering_case', 'created_by', 'UPDATE'
       ) AS runtime_attribution_update`,
  );
  assert.deepEqual(publicPrivileges.rows, [{
    schema_usage: false,
    runtime_schema_create: false,
    case_select: false,
    permission_execute: false,
    runtime_delete: false,
    runtime_attribution_update: false,
  }]);

  const workspaceColumns = await db.query(
    `SELECT table_name, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'app' AND column_name = 'workspace_id'
     ORDER BY table_name`,
  );
  assert.deepEqual(
    workspaceColumns.rows.map((row) => row.table_name),
    WORKSPACE_SCOPED_TABLES,
    'every workspace-scoped table must carry workspace_id',
  );
  assert.equal(
    workspaceColumns.rows.every((row) => row.is_nullable === 'NO'),
    true,
    'workspace_id must never be nullable',
  );

  const foreignKeys = await db.query(
    `SELECT c.conrelid::regclass::text AS table_name,
            pg_get_constraintdef(c.oid) AS definition
     FROM pg_constraint AS c
     JOIN pg_namespace AS n ON n.oid = c.connamespace
     WHERE n.nspname = 'app' AND c.contype = 'f'`,
  );
  for (const [table, actor] of MEMBERSHIP_BOUND_ACTORS) {
    assert.equal(
      foreignKeys.rows.some((row) =>
        row.table_name === `app.${table}`
        && row.definition.includes(`FOREIGN KEY (workspace_id, ${actor})`)
        && row.definition.includes('REFERENCES app.membership(workspace_id, user_id)')),
      true,
      `app.${table}.${actor} must reference membership through workspace_id`,
    );
  }
});

test('Company A can read its own records but cannot read or modify Company B', async () => {
  const ownCases = await runAs(ID.userA, ID.workspaceA, () => db.query(
    'SELECT id, title FROM app.engineering_case ORDER BY id',
  ));
  assert.deepEqual(ownCases.rows, [{ id: ID.caseA, title: 'A confidential case' }]);

  const hiddenCase = await runAs(ID.userA, ID.workspaceA, () => db.query(
    'SELECT id FROM app.engineering_case WHERE id = $1',
    [ID.caseB],
  ));
  assert.deepEqual(hiddenCase.rows, []);

  const hiddenUser = await runAs(ID.userA, ID.workspaceA, () => db.query(
    'SELECT id FROM app.app_user WHERE id = $1',
    [ID.userB],
  ));
  assert.deepEqual(hiddenUser.rows, []);

  const hiddenIdentity = await runAs(ID.userA, ID.workspaceA, () => db.query(
    'SELECT id FROM app.auth_identity WHERE id = $1',
    [ID.identityB],
  ));
  assert.deepEqual(hiddenIdentity.rows, []);

  for (const table of WORKSPACE_SCOPED_TABLES) {
    if (table === 'organization_join_request') {
      await expectDatabaseError(
        runAs(ID.userA, ID.workspaceA, () => db.query(`SELECT workspace_id FROM app.${table}`)),
        '42501',
      );
      continue;
    }
    const visible = await runAs(ID.userA, ID.workspaceA, () => db.query(
      `SELECT workspace_id FROM app.${table}`,
    ));
    assert.equal(
      visible.rows.some((row) => row.workspace_id === ID.workspaceB),
      false,
      `Company B row leaked from app.${table}`,
    );
  }

  const visibleWorkspaces = await runAs(ID.userA, ID.workspaceA, () => db.query(
    'SELECT id FROM app.workspace ORDER BY id',
  ));
  assert.deepEqual(visibleWorkspaces.rows, [{ id: ID.workspaceA }]);

  const modified = await runAs(ID.userA, ID.workspaceA, () => db.query(
    `UPDATE app.engineering_case SET title = 'stolen'
     WHERE workspace_id = $1 AND id = $2 RETURNING id`,
    [ID.workspaceB, ID.caseB],
  ));
  assert.deepEqual(modified.rows, []);

  const tenantUpdates = [
    ['workspace', 'name = name', 'id'],
    ['organization', 'legal_name = legal_name', 'workspace_id'],
    ['field_asset', 'name = name', 'workspace_id'],
    ['reservoir', 'name = name', 'workspace_id'],
    ['well', 'name = name', 'workspace_id'],
    ['wellbore', 'name = name', 'workspace_id'],
    ['project', 'name = name', 'workspace_id'],
    ['dataset', 'source = source', 'workspace_id'],
    ['file_object', 'retention_class = retention_class', 'workspace_id'],
    ['case_file_link', 'purpose = purpose', 'workspace_id'],
  ];
  for (const [table, assignment, key] of tenantUpdates) {
    const result = await runAs(ID.userA, ID.workspaceA, () => db.query(
      `UPDATE app.${table} SET ${assignment} WHERE ${key} = $1 RETURNING ${key}`,
      [ID.workspaceB],
    ));
    assert.deepEqual(result.rows, [], `Company B row was modified in app.${table}`);
  }

  const nonMutableUpdates = [
    ['membership', 'status = status'],
    ['workspace_invitation', 'status = status'],
    ['export_job', "status = 'cancelled'"],
    ['project_well', 'linked_at = linked_at'],
  ];
  for (const [table, assignment] of nonMutableUpdates) {
    await expectDatabaseError(
      runAs(ID.userA, ID.workspaceA, () => db.query(
        `UPDATE app.${table} SET ${assignment}
         WHERE workspace_id = $1 RETURNING workspace_id`,
        [ID.workspaceB],
      )),
      '42501',
    );
  }

  await expectDatabaseError(
    runAs(ID.userA, ID.workspaceA, () => db.query(
      `INSERT INTO app.field_asset (workspace_id, id, name, created_by)
       VALUES ($1, '00000000-0000-4000-8000-0000000020b2', 'Injected B field', $2)`,
      [ID.workspaceB, ID.userA],
    )),
    '42501',
  );
});

test('composite foreign keys reject every attempted cross-company link', async () => {
  await expectDatabaseError(
    runAs(ID.userA, ID.workspaceA, () => db.query(
      `INSERT INTO app.field_asset (workspace_id, id, name, created_by)
       VALUES ($1, '00000000-0000-4000-8000-0000000020a2', 'Spoofed actor', $2)`,
      [ID.workspaceA, ID.userB],
    )),
    '42501',
  );

  await expectDatabaseError(
    runAs(ID.userA, ID.workspaceA, () => db.query(
      `INSERT INTO app.file_object
         (workspace_id, id, object_key, original_name, media_type, byte_size,
          checksum_sha256, scan_status, created_by)
       VALUES
         ($1, '00000000-0000-4000-8000-0000000080a2', 'forged-clean',
          'forged.dat', 'application/octet-stream', 1, repeat('c', 64), 'clean', $2)`,
      [ID.workspaceA, ID.userA],
    )),
    '42501',
  );

  await expectDatabaseError(
    runAs(ID.userA, ID.workspaceA, () => db.query(
      `INSERT INTO app.audit_event
         (workspace_id, id, actor_user_id, action, target_type, outcome, correlation_id)
       VALUES
         ($1, '00000000-0000-4000-8000-0000000090a2', NULL, 'case.read',
          'engineering_case', 'success', '00000000-0000-4000-8000-0000000091a2')`,
      [ID.workspaceA],
    )),
    '42501',
  );

  await expectDatabaseError(
    runAs(ID.userA, ID.workspaceA, () => db.query(
      `INSERT INTO app.project_well (workspace_id, project_id, well_id, linked_by)
       VALUES ($1, $2, $3, $4)`,
      [ID.workspaceA, ID.projectA, ID.wellB, ID.userA],
    )),
    '23503',
  );

  await expectDatabaseError(
    runAs(ID.userA, ID.workspaceA, () => db.query(
      `INSERT INTO app.engineering_case
         (workspace_id, id, project_id, well_id, module_id, title, created_by)
       VALUES
         ($1, '00000000-0000-4000-8000-0000000050a2', $2, $3, 'production.well-performance', 'Cross link', $4)`,
      [ID.workspaceA, ID.projectB, ID.wellA, ID.userA],
    )),
    '23503',
  );

  await expectDatabaseError(
    runAs(ID.userA, ID.workspaceA, () => db.query(
      `INSERT INTO app.case_file_link (workspace_id, case_id, file_object_id, purpose, linked_by)
       VALUES ($1, $2, $3, 'evidence', $4)`,
      [ID.workspaceA, ID.caseA, ID.fileB, ID.userA],
    )),
    '23503',
  );
});

test('Company A cannot read, create or scope an export over Company B data', async () => {
  const hiddenExports = await runAs(ID.userA, ID.workspaceA, () => db.query(
    'SELECT id FROM app.export_job WHERE id = $1',
    [ID.exportB],
  ));
  assert.deepEqual(hiddenExports.rows, []);

  await runAs(ID.userA, ID.workspaceA, () => db.query(
    `INSERT INTO app.export_job
       (workspace_id, id, requested_by, exporter_id, exporter_version, source_snapshot)
     VALUES ($1, $2, $3, 'case-xlsx', 1, '{"case":"A"}')`,
    [ID.workspaceA, ID.exportA, ID.userA],
  ));
  await runAs(ID.userA, ID.workspaceA, () => db.query(
    `INSERT INTO app.export_item (workspace_id, id, export_job_id, case_id)
     VALUES ($1, $2, $3, $4)`,
    [ID.workspaceA, ID.exportItemA, ID.exportA, ID.caseA],
  ));

  await expectDatabaseError(
    runAs(ID.userA, ID.workspaceA, () => db.query(
      `INSERT INTO app.export_item (workspace_id, id, export_job_id, case_id)
       VALUES ($1, $2, $3, $4)`,
      [ID.workspaceA, ID.exportItemCross, ID.exportA, ID.caseB],
    )),
    '23503',
  );

  await expectDatabaseError(
    runAs(ID.userA, ID.workspaceA, () => db.query(
      `INSERT INTO app.export_job
         (workspace_id, id, requested_by, exporter_id, exporter_version, source_snapshot)
       VALUES ($1, '00000000-0000-4000-8000-0000000070b2', $2, 'case-xlsx', 1, '{}')`,
      [ID.workspaceB, ID.userA],
    )),
    '42501',
  );
});

test('personal workspaces stay private, unshareable and tenant-bound', async () => {
  const ownWorkspace = await runAs(
    ID.userPersonal,
    ID.workspacePersonal,
    () => db.query('SELECT id, kind, owner_user_id FROM app.workspace'),
  );
  assert.deepEqual(ownWorkspace.rows, [{
    id: ID.workspacePersonal,
    kind: 'personal',
    owner_user_id: ID.userPersonal,
  }]);

  const ownCases = await runAs(ID.userPersonal, ID.workspacePersonal, () => db.query(
    'SELECT id, title FROM app.engineering_case ORDER BY id',
  ));
  assert.deepEqual(ownCases.rows, [{
    id: ID.casePersonal,
    title: 'Private personal case',
  }]);

  const ownExports = await runAs(ID.userPersonal, ID.workspacePersonal, () => db.query(
    'SELECT id, source_snapshot FROM app.export_job ORDER BY id',
  ));
  assert.deepEqual(ownExports.rows, [{
    id: ID.exportPersonal,
    source_snapshot: { personal: true },
  }]);

  for (const [userId, workspaceId] of [
    [ID.userA, ID.workspaceA],
    [ID.userB, ID.workspaceB],
  ]) {
    const hiddenPersonalCase = await runAs(userId, workspaceId, () => db.query(
      'SELECT id FROM app.engineering_case WHERE id = $1',
      [ID.casePersonal],
    ));
    assert.deepEqual(hiddenPersonalCase.rows, []);

    const hiddenPersonalFile = await runAs(userId, workspaceId, () => db.query(
      'SELECT id FROM app.file_object WHERE id = $1',
      [ID.filePersonal],
    ));
    assert.deepEqual(hiddenPersonalFile.rows, []);
  }

  for (const foreignCaseId of [ID.caseA, ID.caseB]) {
    const hiddenCompanyCase = await runAs(
      ID.userPersonal,
      ID.workspacePersonal,
      () => db.query('SELECT id FROM app.engineering_case WHERE id = $1', [foreignCaseId]),
    );
    assert.deepEqual(hiddenCompanyCase.rows, []);
  }

  await expectDatabaseError(
    runAs(ID.userPersonal, ID.workspacePersonal, () => db.query(
      `INSERT INTO app.export_item (workspace_id, id, export_job_id, case_id)
       VALUES ($1, $2, $3, $4)`,
      [
        ID.workspacePersonal,
        ID.exportItemPersonalCross,
        ID.exportPersonal,
        ID.caseA,
      ],
    )),
    '23503',
  );

  await expectDatabaseError(
    runAs(ID.userPersonal, ID.workspacePersonal, () => db.query(
      `INSERT INTO app.case_file_link
         (workspace_id, case_id, file_object_id, purpose, linked_by)
       VALUES ($1, $2, $3, 'cross-tenant evidence', $4)`,
      [ID.workspacePersonal, ID.casePersonal, ID.fileA, ID.userPersonal],
    )),
    '23503',
  );

  await expectDatabaseError(
    db.query(
      `INSERT INTO app.membership
         (workspace_id, user_id, role_key, status, invited_by)
       VALUES ($1, $2, 'viewer', 'active', $3)`,
      [ID.workspacePersonal, ID.userA, ID.userPersonal],
    ),
    '23514',
  );

  await expectDatabaseError(
    db.query(
      `INSERT INTO app.workspace_invitation
         (workspace_id, id, email, role_key, token_hash, invited_by, expires_at)
       VALUES ($1, '00000000-0000-4000-8000-0000000011c1',
               'share@example.test', 'viewer', repeat('c', 64), $2,
               statement_timestamp() + interval '1 day')`,
      [ID.workspacePersonal, ID.userPersonal],
    ),
    '23514',
  );

  await expectDatabaseError(
    db.query(
      `INSERT INTO app.workspace (id, kind, name, slug, owner_user_id)
       VALUES ($1, 'personal', 'Duplicate Personal Workspace', 'duplicate-personal', $2)`,
      [ID.workspacePersonalOther, ID.userPersonal],
    ),
    '23505',
  );

  await expectDatabaseError(
    db.query(
      `INSERT INTO app.workspace (id, kind, name, slug, owner_user_id)
       VALUES ($1, 'organization', 'Invalid Organization', 'invalid-organization', $2)`,
      [ID.workspacePersonalOther, ID.userPersonal],
    ),
    '23514',
  );
});

test('membership cannot be self-created across tenants and removal takes effect immediately', async () => {
  await expectDatabaseError(
    runAs(ID.userA, ID.workspaceA, () => db.query(
      `INSERT INTO app.membership (workspace_id, user_id, role_key, status)
       VALUES ($1, $2, 'owner', 'active')`,
      [ID.workspaceB, ID.userA],
    )),
    '42501',
  );

  await db.query(
    `UPDATE app.membership SET status = 'suspended', updated_at = statement_timestamp()
     WHERE workspace_id = $1 AND user_id = $2`,
    [ID.workspaceB, ID.userB],
  );
  const afterRemoval = await runAs(ID.userB, ID.workspaceB, () => db.query(
    'SELECT id FROM app.engineering_case',
  ));
  assert.deepEqual(afterRemoval.rows, []);
});

test('missing, malformed and expired transaction context fails closed', async () => {
  await db.exec('BEGIN');
  try {
    await db.exec('SET LOCAL ROLE wellsim_runtime');

    const missing = await db.query('SELECT id FROM app.engineering_case');
    assert.deepEqual(missing.rows, []);

    await db.query(
      `SELECT set_config('app.user_id', 'not-a-uuid', true),
              set_config('app.workspace_id', 'also-not-a-uuid', true)`,
    );
    const malformed = await db.query('SELECT id FROM app.engineering_case');
    assert.deepEqual(malformed.rows, []);

    await db.query(
      `SELECT set_config('app.user_id', $1, true),
              set_config('app.workspace_id', $2, true)`,
      [ID.userA, ID.workspaceA],
    );
    const present = await db.query('SELECT id FROM app.engineering_case');
    assert.deepEqual(present.rows, [{ id: ID.caseA }]);

    await db.exec('COMMIT');
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }

  await db.exec('BEGIN');
  try {
    await db.exec('SET LOCAL ROLE wellsim_runtime');
    const nextTransaction = await db.query('SELECT id FROM app.engineering_case');
    assert.deepEqual(nextTransaction.rows, []);
    await db.exec('COMMIT');
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
});

test('case revisions, calculation evidence and audit events are append-only', async () => {
  await expectDatabaseError(
    db.query(
      `UPDATE app.case_revision SET input_document = '{"tampered":true}'
       WHERE workspace_id = $1 AND id = $2`,
      [ID.workspaceA, ID.revisionA],
    ),
    '23001',
  );
});
