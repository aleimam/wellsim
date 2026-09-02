BEGIN;

CREATE SCHEMA app;

CREATE TABLE app.schema_migration (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT statement_timestamp()
);

CREATE TABLE app.app_user (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled', 'pending', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp()
);

CREATE UNIQUE INDEX app_user_email_lower_uidx
  ON app.app_user (lower(email));

CREATE TABLE app.auth_identity (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app.app_user(id),
  provider text NOT NULL,
  provider_subject text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  UNIQUE (provider, provider_subject)
);

CREATE TABLE app.permission_definition (
  permission_key text PRIMARY KEY,
  description text NOT NULL
);

CREATE TABLE app.role_definition (
  role_key text PRIMARY KEY,
  description text NOT NULL
);

CREATE TABLE app.role_permission (
  role_key text NOT NULL REFERENCES app.role_definition(role_key),
  permission_key text NOT NULL REFERENCES app.permission_definition(permission_key),
  PRIMARY KEY (role_key, permission_key)
);

INSERT INTO app.permission_definition (permission_key, description) VALUES
  ('workspace.read', 'Read workspace identity and settings'),
  ('workspace.manage', 'Change workspace and organization settings'),
  ('membership.read', 'Read workspace membership'),
  ('membership.manage', 'Invite, add, change or suspend members'),
  ('asset.read', 'Read fields, reservoirs, wells and wellbores'),
  ('asset.write', 'Create and change fields, reservoirs, wells and wellbores'),
  ('project.read', 'Read projects and their asset links'),
  ('project.write', 'Create and change projects and their asset links'),
  ('case.read', 'Read cases, revisions and calculation runs'),
  ('case.write', 'Create and change case lifecycle records and immutable revisions'),
  ('case.run', 'Create calculation runs'),
  ('case.review', 'Record a review decision'),
  ('case.approve', 'Record an approval decision'),
  ('case.export', 'Include case evidence in an export'),
  ('dataset.read', 'Read datasets and provenance'),
  ('dataset.write', 'Create and change datasets'),
  ('dataset.approve', 'Approve or reject governed datasets'),
  ('file.read', 'Read file metadata and request file delivery'),
  ('file.write', 'Create and change file metadata'),
  ('export.read', 'Read export jobs and artifacts'),
  ('export.create', 'Create export jobs and their immutable scope'),
  ('export.deliver', 'Attach rendered artifacts and issue delivery'),
  ('audit.read', 'Read workspace audit events'),
  ('audit.write', 'Append workspace audit events');

INSERT INTO app.role_definition (role_key, description) VALUES
  ('owner', 'Workspace owner'),
  ('administrator', 'Organization administrator'),
  ('engineering_manager', 'Engineering manager'),
  ('engineer', 'Engineer'),
  ('reviewer', 'Independent reviewer'),
  ('viewer', 'Read-only member'),
  ('external_collaborator', 'Reserved for future project-scoped grants');

INSERT INTO app.role_permission (role_key, permission_key)
SELECT 'owner', permission_key FROM app.permission_definition;

INSERT INTO app.role_permission (role_key, permission_key)
SELECT 'administrator', permission_key
FROM app.permission_definition;

INSERT INTO app.role_permission (role_key, permission_key)
SELECT 'engineering_manager', permission_key
FROM app.permission_definition
WHERE permission_key IN (
  'workspace.read', 'membership.read',
  'asset.read', 'asset.write', 'project.read', 'project.write',
  'case.read', 'case.write', 'case.run', 'case.review', 'case.approve', 'case.export',
  'dataset.read', 'dataset.write', 'dataset.approve',
  'file.read', 'file.write', 'export.read', 'export.create',
  'audit.read', 'audit.write'
);

INSERT INTO app.role_permission (role_key, permission_key)
SELECT 'engineer', permission_key
FROM app.permission_definition
WHERE permission_key IN (
  'workspace.read', 'membership.read',
  'asset.read', 'asset.write', 'project.read', 'project.write',
  'case.read', 'case.write', 'case.run', 'case.export',
  'dataset.read', 'dataset.write', 'file.read', 'file.write',
  'export.read', 'export.create', 'audit.write'
);

INSERT INTO app.role_permission (role_key, permission_key)
SELECT 'reviewer', permission_key
FROM app.permission_definition
WHERE permission_key IN (
  'workspace.read', 'membership.read', 'asset.read', 'project.read',
  'case.read', 'case.review', 'case.export', 'dataset.read', 'file.read',
  'export.read', 'export.create', 'audit.write'
);

INSERT INTO app.role_permission (role_key, permission_key)
SELECT 'viewer', permission_key
FROM app.permission_definition
WHERE permission_key IN (
  'workspace.read', 'asset.read', 'project.read', 'case.read',
  'dataset.read', 'file.read', 'export.read', 'audit.write'
);

-- external_collaborator intentionally receives no workspace-wide permissions.
-- Project/asset grants must exist before that role becomes usable.

CREATE TABLE app.workspace (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('organization', 'personal')),
  name text NOT NULL,
  slug text NOT NULL,
  owner_user_id uuid REFERENCES app.app_user(id),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'archived')),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CHECK ((kind = 'personal' AND owner_user_id IS NOT NULL) OR kind = 'organization'),
  UNIQUE (kind, slug),
  UNIQUE (id, kind)
);

CREATE TABLE app.organization (
  workspace_id uuid PRIMARY KEY,
  workspace_kind text NOT NULL DEFAULT 'organization'
    CHECK (workspace_kind = 'organization'),
  legal_name text,
  registration_country text,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  FOREIGN KEY (workspace_id, workspace_kind)
    REFERENCES app.workspace(id, kind)
);

CREATE TABLE app.membership (
  workspace_id uuid NOT NULL REFERENCES app.workspace(id),
  user_id uuid NOT NULL REFERENCES app.app_user(id),
  role_key text NOT NULL REFERENCES app.role_definition(role_key),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('invited', 'active', 'suspended', 'expired', 'removed')),
  invited_by uuid,
  joined_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (workspace_id, user_id),
  FOREIGN KEY (workspace_id, invited_by)
    REFERENCES app.membership(workspace_id, user_id)
);

CREATE INDEX membership_user_active_idx
  ON app.membership (user_id, workspace_id)
  WHERE status = 'active';

CREATE TABLE app.workspace_invitation (
  workspace_id uuid NOT NULL REFERENCES app.workspace(id),
  id uuid NOT NULL,
  email text NOT NULL,
  role_key text NOT NULL REFERENCES app.role_definition(role_key),
  token_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  invited_by uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  accepted_by uuid,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, invited_by)
    REFERENCES app.membership(workspace_id, user_id),
  FOREIGN KEY (workspace_id, accepted_by)
    REFERENCES app.membership(workspace_id, user_id),
  UNIQUE (token_hash)
);

CREATE TABLE app.field_asset (
  workspace_id uuid NOT NULL REFERENCES app.workspace(id),
  id uuid NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'archived')),
  external_identifiers jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(external_identifiers) = 'object'),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, created_by)
    REFERENCES app.membership(workspace_id, user_id)
);

CREATE TABLE app.reservoir (
  workspace_id uuid NOT NULL REFERENCES app.workspace(id),
  id uuid NOT NULL,
  field_id uuid NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'archived')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, field_id)
    REFERENCES app.field_asset(workspace_id, id),
  FOREIGN KEY (workspace_id, created_by)
    REFERENCES app.membership(workspace_id, user_id)
);

CREATE TABLE app.well (
  workspace_id uuid NOT NULL REFERENCES app.workspace(id),
  id uuid NOT NULL,
  field_id uuid NOT NULL,
  name text NOT NULL,
  unique_well_identifier text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('planned', 'active', 'suspended', 'abandoned', 'archived')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, field_id)
    REFERENCES app.field_asset(workspace_id, id),
  FOREIGN KEY (workspace_id, created_by)
    REFERENCES app.membership(workspace_id, user_id),
  UNIQUE (workspace_id, unique_well_identifier)
);

CREATE TABLE app.wellbore (
  workspace_id uuid NOT NULL REFERENCES app.workspace(id),
  id uuid NOT NULL,
  well_id uuid NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('planned', 'active', 'suspended', 'abandoned', 'archived')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, well_id)
    REFERENCES app.well(workspace_id, id),
  FOREIGN KEY (workspace_id, created_by)
    REFERENCES app.membership(workspace_id, user_id)
);

CREATE TABLE app.project (
  workspace_id uuid NOT NULL REFERENCES app.workspace(id),
  id uuid NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'completed', 'archived')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, created_by)
    REFERENCES app.membership(workspace_id, user_id)
);

CREATE TABLE app.project_well (
  workspace_id uuid NOT NULL REFERENCES app.workspace(id),
  project_id uuid NOT NULL,
  well_id uuid NOT NULL,
  linked_by uuid NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (workspace_id, project_id, well_id),
  FOREIGN KEY (workspace_id, project_id)
    REFERENCES app.project(workspace_id, id),
  FOREIGN KEY (workspace_id, well_id)
    REFERENCES app.well(workspace_id, id),
  FOREIGN KEY (workspace_id, linked_by)
    REFERENCES app.membership(workspace_id, user_id)
);

CREATE TABLE app.engineering_case (
  workspace_id uuid NOT NULL REFERENCES app.workspace(id),
  id uuid NOT NULL,
  project_id uuid NOT NULL,
  well_id uuid,
  module_id text NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'in_review', 'approved', 'archived')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, project_id)
    REFERENCES app.project(workspace_id, id),
  FOREIGN KEY (workspace_id, well_id)
    REFERENCES app.well(workspace_id, id),
  FOREIGN KEY (workspace_id, created_by)
    REFERENCES app.membership(workspace_id, user_id)
);

CREATE TABLE app.case_revision (
  workspace_id uuid NOT NULL REFERENCES app.workspace(id),
  id uuid NOT NULL,
  case_id uuid NOT NULL,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  input_schema_id text NOT NULL,
  input_document jsonb NOT NULL CHECK (jsonb_typeof(input_document) = 'object'),
  display_units jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(display_units) = 'object'),
  source_manifest jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(source_manifest) = 'object'),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, case_id)
    REFERENCES app.engineering_case(workspace_id, id),
  FOREIGN KEY (workspace_id, created_by)
    REFERENCES app.membership(workspace_id, user_id),
  UNIQUE (workspace_id, case_id, revision_number)
);

CREATE TABLE app.calculation_run (
  workspace_id uuid NOT NULL REFERENCES app.workspace(id),
  id uuid NOT NULL,
  case_revision_id uuid NOT NULL,
  module_id text NOT NULL,
  engine_id text NOT NULL,
  engine_version text NOT NULL,
  deployment_revision text NOT NULL,
  input_snapshot jsonb NOT NULL CHECK (jsonb_typeof(input_snapshot) = 'object'),
  output_schema_id text NOT NULL,
  output_document jsonb NOT NULL CHECK (jsonb_typeof(output_document) = 'object'),
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(warnings) = 'array'),
  validity_status text NOT NULL
    CHECK (validity_status IN ('valid', 'warning', 'invalid', 'failed')),
  executed_by uuid NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, case_revision_id)
    REFERENCES app.case_revision(workspace_id, id),
  FOREIGN KEY (workspace_id, executed_by)
    REFERENCES app.membership(workspace_id, user_id),
  CHECK (completed_at IS NULL OR completed_at >= started_at)
);

CREATE TABLE app.dataset (
  workspace_id uuid NOT NULL REFERENCES app.workspace(id),
  id uuid NOT NULL,
  well_id uuid,
  dataset_type text NOT NULL,
  schema_version text NOT NULL,
  quality_state text NOT NULL DEFAULT 'raw'
    CHECK (quality_state IN ('raw', 'screened', 'validated', 'approved', 'rejected', 'superseded')),
  source text NOT NULL,
  acquired_at timestamptz,
  canonical_units jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(canonical_units) = 'object'),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(provenance) = 'object'),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, well_id)
    REFERENCES app.well(workspace_id, id),
  FOREIGN KEY (workspace_id, created_by)
    REFERENCES app.membership(workspace_id, user_id)
);

CREATE TABLE app.file_object (
  workspace_id uuid NOT NULL REFERENCES app.workspace(id),
  id uuid NOT NULL,
  object_key text NOT NULL,
  original_name text NOT NULL,
  media_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  scan_status text NOT NULL DEFAULT 'pending'
    CHECK (scan_status IN ('pending', 'clean', 'rejected', 'failed')),
  retention_class text NOT NULL DEFAULT 'standard',
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, created_by)
    REFERENCES app.membership(workspace_id, user_id),
  UNIQUE (workspace_id, object_key)
);

CREATE TABLE app.case_file_link (
  workspace_id uuid NOT NULL REFERENCES app.workspace(id),
  case_id uuid NOT NULL,
  file_object_id uuid NOT NULL,
  purpose text NOT NULL,
  linked_by uuid NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (workspace_id, case_id, file_object_id),
  FOREIGN KEY (workspace_id, case_id)
    REFERENCES app.engineering_case(workspace_id, id),
  FOREIGN KEY (workspace_id, file_object_id)
    REFERENCES app.file_object(workspace_id, id),
  FOREIGN KEY (workspace_id, linked_by)
    REFERENCES app.membership(workspace_id, user_id)
);

CREATE TABLE app.export_job (
  workspace_id uuid NOT NULL REFERENCES app.workspace(id),
  id uuid NOT NULL,
  requested_by uuid NOT NULL,
  exporter_id text NOT NULL,
  exporter_version integer NOT NULL CHECK (exporter_version > 0),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'expired', 'cancelled')),
  source_snapshot jsonb NOT NULL CHECK (jsonb_typeof(source_snapshot) = 'object'),
  requested_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  completed_at timestamptz,
  expires_at timestamptz,
  failure_code text,
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, requested_by)
    REFERENCES app.membership(workspace_id, user_id),
  CHECK (completed_at IS NULL OR completed_at >= requested_at)
);

CREATE TABLE app.export_item (
  workspace_id uuid NOT NULL REFERENCES app.workspace(id),
  id uuid NOT NULL,
  export_job_id uuid NOT NULL,
  case_id uuid,
  dataset_id uuid,
  file_object_id uuid,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, export_job_id)
    REFERENCES app.export_job(workspace_id, id),
  FOREIGN KEY (workspace_id, case_id)
    REFERENCES app.engineering_case(workspace_id, id),
  FOREIGN KEY (workspace_id, dataset_id)
    REFERENCES app.dataset(workspace_id, id),
  FOREIGN KEY (workspace_id, file_object_id)
    REFERENCES app.file_object(workspace_id, id),
  CHECK (num_nonnulls(case_id, dataset_id, file_object_id) = 1)
);

CREATE TABLE app.export_artifact (
  workspace_id uuid NOT NULL REFERENCES app.workspace(id),
  export_job_id uuid NOT NULL,
  file_object_id uuid NOT NULL,
  source_manifest jsonb NOT NULL CHECK (jsonb_typeof(source_manifest) = 'object'),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (workspace_id, export_job_id, file_object_id),
  FOREIGN KEY (workspace_id, export_job_id)
    REFERENCES app.export_job(workspace_id, id),
  FOREIGN KEY (workspace_id, file_object_id)
    REFERENCES app.file_object(workspace_id, id)
);

CREATE TABLE app.audit_event (
  workspace_id uuid NOT NULL REFERENCES app.workspace(id),
  id uuid NOT NULL,
  actor_user_id uuid,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  outcome text NOT NULL CHECK (outcome IN ('success', 'denied', 'failed')),
  correlation_id uuid NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(details) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, actor_user_id)
    REFERENCES app.membership(workspace_id, user_id)
);

INSERT INTO app.schema_migration(version) VALUES ('0001_platform_foundation');

COMMIT;
