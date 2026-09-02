BEGIN;

DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wellsim_runtime') THEN
    CREATE ROLE wellsim_runtime
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$role$;

ALTER ROLE wellsim_runtime
  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;

-- A role can SET ROLE to roles granted to it even when NOINHERIT is set.
-- Remove any unexpected memberships if this cluster-global role pre-existed.
DO $memberships$
DECLARE
  granted_role name;
BEGIN
  FOR granted_role IN
    SELECT parent.rolname
    FROM pg_auth_members AS membership_record
    JOIN pg_roles AS member_role ON member_role.oid = membership_record.member
    JOIN pg_roles AS parent ON parent.oid = membership_record.roleid
    WHERE member_role.rolname = 'wellsim_runtime'
  LOOP
    EXECUTE format('REVOKE %I FROM wellsim_runtime', granted_role);
  END LOOP;
END
$memberships$;

-- PostgreSQL grants schema usage and function execution to PUBLIC by default.
-- Keep the application schema private unless a privilege is explicitly granted.
REVOKE ALL ON SCHEMA app FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE FUNCTION app.current_user_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog
AS $function$
DECLARE
  value text;
BEGIN
  value := current_setting('app.user_id', true);
  IF value IS NULL OR value = '' THEN
    RETURN NULL;
  END IF;
  RETURN value::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END
$function$;

CREATE FUNCTION app.current_workspace_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog
AS $function$
DECLARE
  value text;
BEGIN
  value := current_setting('app.workspace_id', true);
  IF value IS NULL OR value = '' THEN
    RETURN NULL;
  END IF;
  RETURN value::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END
$function$;

-- This function is SECURITY DEFINER only to read membership while membership's
-- own RLS policy is being evaluated. The fixed search_path prevents an object
-- in a caller-controlled schema from replacing a referenced object.
CREATE FUNCTION app.has_workspace_permission(
  target_workspace_id uuid,
  requested_permission text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $function$
  SELECT
    target_workspace_id = app.current_workspace_id()
    AND EXISTS (
      SELECT 1
      FROM app.membership AS membership_record
      JOIN app.role_permission AS granted
        ON granted.role_key = membership_record.role_key
      JOIN app.workspace AS workspace_record
        ON workspace_record.id = membership_record.workspace_id
      JOIN app.app_user AS user_record
        ON user_record.id = membership_record.user_id
      WHERE membership_record.workspace_id = target_workspace_id
        AND membership_record.user_id = app.current_user_id()
        AND membership_record.status = 'active'
        AND (membership_record.expires_at IS NULL OR membership_record.expires_at > statement_timestamp())
        AND workspace_record.status = 'active'
        AND user_record.status = 'active'
        AND granted.permission_key = requested_permission
    )
$function$;

CREATE FUNCTION app.reject_workspace_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
    RAISE EXCEPTION 'workspace ownership is immutable'
      USING ERRCODE = '23001';
  END IF;
  RETURN NEW;
END
$function$;

CREATE FUNCTION app.reject_immutable_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  RAISE EXCEPTION '% records are append-only', TG_TABLE_NAME
    USING ERRCODE = '23001';
END
$function$;

REVOKE ALL ON FUNCTION app.current_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.current_workspace_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.has_workspace_permission(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.reject_workspace_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.reject_immutable_mutation() FROM PUBLIC;

GRANT USAGE ON SCHEMA app TO wellsim_runtime;
GRANT EXECUTE ON FUNCTION app.current_user_id() TO wellsim_runtime;
GRANT EXECUTE ON FUNCTION app.current_workspace_id() TO wellsim_runtime;
GRANT EXECUTE ON FUNCTION app.has_workspace_permission(uuid, text) TO wellsim_runtime;

GRANT SELECT ON app.permission_definition, app.role_definition, app.role_permission
  TO wellsim_runtime;
GRANT SELECT ON app.app_user, app.auth_identity TO wellsim_runtime;
GRANT UPDATE (display_name, updated_at) ON app.app_user TO wellsim_runtime;

GRANT SELECT ON app.workspace, app.organization, app.membership, app.workspace_invitation
  TO wellsim_runtime;
GRANT UPDATE (name, slug, status, updated_at) ON app.workspace TO wellsim_runtime;
GRANT UPDATE (legal_name, registration_country) ON app.organization TO wellsim_runtime;
GRANT INSERT ON app.membership, app.workspace_invitation TO wellsim_runtime;
GRANT UPDATE (role_key, status, joined_at, expires_at, updated_at)
  ON app.membership TO wellsim_runtime;
GRANT UPDATE (status, accepted_by) ON app.workspace_invitation TO wellsim_runtime;

GRANT SELECT, INSERT ON
  app.field_asset, app.reservoir, app.well, app.wellbore,
  app.project, app.project_well, app.engineering_case,
  app.dataset, app.file_object, app.case_file_link
  TO wellsim_runtime;

GRANT UPDATE (name, status, external_identifiers, updated_at)
  ON app.field_asset TO wellsim_runtime;
GRANT UPDATE (field_id, name, status, updated_at)
  ON app.reservoir TO wellsim_runtime;
GRANT UPDATE (field_id, name, unique_well_identifier, status, updated_at)
  ON app.well TO wellsim_runtime;
GRANT UPDATE (well_id, name, status, updated_at)
  ON app.wellbore TO wellsim_runtime;
GRANT UPDATE (name, status, updated_at)
  ON app.project TO wellsim_runtime;
GRANT UPDATE (project_id, well_id, module_id, title, status, updated_at)
  ON app.engineering_case TO wellsim_runtime;
GRANT UPDATE (
  well_id, dataset_type, schema_version, quality_state, source,
  acquired_at, canonical_units, provenance, updated_at
) ON app.dataset TO wellsim_runtime;
GRANT UPDATE (retention_class)
  ON app.file_object TO wellsim_runtime;
GRANT UPDATE (purpose)
  ON app.case_file_link TO wellsim_runtime;

GRANT SELECT, INSERT ON
  app.case_revision, app.calculation_run,
  app.export_job, app.export_item, app.audit_event
  TO wellsim_runtime;

GRANT SELECT ON app.export_artifact TO wellsim_runtime;

ALTER TABLE app.app_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.auth_identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.workspace ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.organization ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.membership ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.workspace_invitation ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.field_asset ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.reservoir ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.well ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.wellbore ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.project ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.project_well ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.engineering_case ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.case_revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.calculation_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.dataset ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.file_object ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.case_file_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.export_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.export_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.export_artifact ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.audit_event ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_self_select ON app.app_user
  FOR SELECT TO wellsim_runtime
  USING (id = app.current_user_id());
CREATE POLICY app_user_self_update ON app.app_user
  FOR UPDATE TO wellsim_runtime
  USING (id = app.current_user_id())
  WITH CHECK (id = app.current_user_id());

CREATE POLICY auth_identity_self_select ON app.auth_identity
  FOR SELECT TO wellsim_runtime
  USING (user_id = app.current_user_id());

CREATE POLICY workspace_select ON app.workspace
  FOR SELECT TO wellsim_runtime
  USING (app.has_workspace_permission(id, 'workspace.read'));
CREATE POLICY workspace_update ON app.workspace
  FOR UPDATE TO wellsim_runtime
  USING (app.has_workspace_permission(id, 'workspace.manage'))
  WITH CHECK (app.has_workspace_permission(id, 'workspace.manage'));

CREATE POLICY organization_select ON app.organization
  FOR SELECT TO wellsim_runtime
  USING (app.has_workspace_permission(workspace_id, 'workspace.read'));
CREATE POLICY organization_update ON app.organization
  FOR UPDATE TO wellsim_runtime
  USING (app.has_workspace_permission(workspace_id, 'workspace.manage'))
  WITH CHECK (app.has_workspace_permission(workspace_id, 'workspace.manage'));

CREATE POLICY membership_select ON app.membership
  FOR SELECT TO wellsim_runtime
  USING (app.has_workspace_permission(workspace_id, 'membership.read'));
CREATE POLICY membership_insert ON app.membership
  FOR INSERT TO wellsim_runtime
  WITH CHECK (
    invited_by = app.current_user_id()
    AND app.has_workspace_permission(workspace_id, 'membership.manage')
  );
CREATE POLICY membership_update ON app.membership
  FOR UPDATE TO wellsim_runtime
  USING (app.has_workspace_permission(workspace_id, 'membership.manage'))
  WITH CHECK (app.has_workspace_permission(workspace_id, 'membership.manage'));

CREATE POLICY invitation_select ON app.workspace_invitation
  FOR SELECT TO wellsim_runtime
  USING (app.has_workspace_permission(workspace_id, 'membership.manage'));
CREATE POLICY invitation_insert ON app.workspace_invitation
  FOR INSERT TO wellsim_runtime
  WITH CHECK (
    invited_by = app.current_user_id()
    AND app.has_workspace_permission(workspace_id, 'membership.manage')
  );
CREATE POLICY invitation_update ON app.workspace_invitation
  FOR UPDATE TO wellsim_runtime
  USING (app.has_workspace_permission(workspace_id, 'membership.manage'))
  WITH CHECK (
    (accepted_by IS NULL OR accepted_by = app.current_user_id())
    AND app.has_workspace_permission(workspace_id, 'membership.manage')
  );

CREATE POLICY field_asset_select ON app.field_asset
  FOR SELECT TO wellsim_runtime
  USING (app.has_workspace_permission(workspace_id, 'asset.read'));
CREATE POLICY field_asset_insert ON app.field_asset
  FOR INSERT TO wellsim_runtime
  WITH CHECK (
    created_by = app.current_user_id()
    AND app.has_workspace_permission(workspace_id, 'asset.write')
  );
CREATE POLICY field_asset_update ON app.field_asset
  FOR UPDATE TO wellsim_runtime
  USING (app.has_workspace_permission(workspace_id, 'asset.write'))
  WITH CHECK (app.has_workspace_permission(workspace_id, 'asset.write'));

CREATE POLICY reservoir_select ON app.reservoir
  FOR SELECT TO wellsim_runtime
  USING (app.has_workspace_permission(workspace_id, 'asset.read'));
CREATE POLICY reservoir_insert ON app.reservoir
  FOR INSERT TO wellsim_runtime
  WITH CHECK (
    created_by = app.current_user_id()
    AND app.has_workspace_permission(workspace_id, 'asset.write')
  );
CREATE POLICY reservoir_update ON app.reservoir
  FOR UPDATE TO wellsim_runtime
  USING (app.has_workspace_permission(workspace_id, 'asset.write'))
  WITH CHECK (app.has_workspace_permission(workspace_id, 'asset.write'));

CREATE POLICY well_select ON app.well
  FOR SELECT TO wellsim_runtime
  USING (app.has_workspace_permission(workspace_id, 'asset.read'));
CREATE POLICY well_insert ON app.well
  FOR INSERT TO wellsim_runtime
  WITH CHECK (
    created_by = app.current_user_id()
    AND app.has_workspace_permission(workspace_id, 'asset.write')
  );
CREATE POLICY well_update ON app.well
  FOR UPDATE TO wellsim_runtime
  USING (app.has_workspace_permission(workspace_id, 'asset.write'))
  WITH CHECK (app.has_workspace_permission(workspace_id, 'asset.write'));

CREATE POLICY wellbore_select ON app.wellbore
  FOR SELECT TO wellsim_runtime
  USING (app.has_workspace_permission(workspace_id, 'asset.read'));
CREATE POLICY wellbore_insert ON app.wellbore
  FOR INSERT TO wellsim_runtime
  WITH CHECK (
    created_by = app.current_user_id()
    AND app.has_workspace_permission(workspace_id, 'asset.write')
  );
CREATE POLICY wellbore_update ON app.wellbore
  FOR UPDATE TO wellsim_runtime
  USING (app.has_workspace_permission(workspace_id, 'asset.write'))
  WITH CHECK (app.has_workspace_permission(workspace_id, 'asset.write'));

CREATE POLICY project_select ON app.project
  FOR SELECT TO wellsim_runtime
  USING (app.has_workspace_permission(workspace_id, 'project.read'));
CREATE POLICY project_insert ON app.project
  FOR INSERT TO wellsim_runtime
  WITH CHECK (
    created_by = app.current_user_id()
    AND app.has_workspace_permission(workspace_id, 'project.write')
  );
CREATE POLICY project_update ON app.project
  FOR UPDATE TO wellsim_runtime
  USING (app.has_workspace_permission(workspace_id, 'project.write'))
  WITH CHECK (app.has_workspace_permission(workspace_id, 'project.write'));

CREATE POLICY project_well_select ON app.project_well
  FOR SELECT TO wellsim_runtime
  USING (app.has_workspace_permission(workspace_id, 'project.read'));
CREATE POLICY project_well_insert ON app.project_well
  FOR INSERT TO wellsim_runtime
  WITH CHECK (
    linked_by = app.current_user_id()
    AND app.has_workspace_permission(workspace_id, 'project.write')
  );
CREATE POLICY project_well_update ON app.project_well
  FOR UPDATE TO wellsim_runtime
  USING (app.has_workspace_permission(workspace_id, 'project.write'))
  WITH CHECK (app.has_workspace_permission(workspace_id, 'project.write'));

CREATE POLICY engineering_case_select ON app.engineering_case
  FOR SELECT TO wellsim_runtime
  USING (app.has_workspace_permission(workspace_id, 'case.read'));
CREATE POLICY engineering_case_insert ON app.engineering_case
  FOR INSERT TO wellsim_runtime
  WITH CHECK (
    created_by = app.current_user_id()
    AND app.has_workspace_permission(workspace_id, 'case.write')
  );
CREATE POLICY engineering_case_update ON app.engineering_case
  FOR UPDATE TO wellsim_runtime
  USING (app.has_workspace_permission(workspace_id, 'case.write'))
  WITH CHECK (app.has_workspace_permission(workspace_id, 'case.write'));

CREATE POLICY case_revision_select ON app.case_revision
  FOR SELECT TO wellsim_runtime
  USING (app.has_workspace_permission(workspace_id, 'case.read'));
CREATE POLICY case_revision_insert ON app.case_revision
  FOR INSERT TO wellsim_runtime
  WITH CHECK (
    created_by = app.current_user_id()
    AND app.has_workspace_permission(workspace_id, 'case.write')
  );

CREATE POLICY calculation_run_select ON app.calculation_run
  FOR SELECT TO wellsim_runtime
  USING (app.has_workspace_permission(workspace_id, 'case.read'));
CREATE POLICY calculation_run_insert ON app.calculation_run
  FOR INSERT TO wellsim_runtime
  WITH CHECK (
    executed_by = app.current_user_id()
    AND app.has_workspace_permission(workspace_id, 'case.run')
  );

CREATE POLICY dataset_select ON app.dataset
  FOR SELECT TO wellsim_runtime
  USING (app.has_workspace_permission(workspace_id, 'dataset.read'));
CREATE POLICY dataset_insert ON app.dataset
  FOR INSERT TO wellsim_runtime
  WITH CHECK (
    created_by = app.current_user_id()
    AND app.has_workspace_permission(workspace_id, 'dataset.write')
  );
CREATE POLICY dataset_update ON app.dataset
  FOR UPDATE TO wellsim_runtime
  USING (app.has_workspace_permission(workspace_id, 'dataset.write'))
  WITH CHECK (app.has_workspace_permission(workspace_id, 'dataset.write'));

CREATE POLICY file_object_select ON app.file_object
  FOR SELECT TO wellsim_runtime
  USING (app.has_workspace_permission(workspace_id, 'file.read'));
CREATE POLICY file_object_insert ON app.file_object
  FOR INSERT TO wellsim_runtime
  WITH CHECK (
    created_by = app.current_user_id()
    AND scan_status = 'pending'
    AND app.has_workspace_permission(workspace_id, 'file.write')
  );
CREATE POLICY file_object_update ON app.file_object
  FOR UPDATE TO wellsim_runtime
  USING (app.has_workspace_permission(workspace_id, 'file.write'))
  WITH CHECK (app.has_workspace_permission(workspace_id, 'file.write'));

CREATE POLICY case_file_link_select ON app.case_file_link
  FOR SELECT TO wellsim_runtime
  USING (app.has_workspace_permission(workspace_id, 'case.read'));
CREATE POLICY case_file_link_insert ON app.case_file_link
  FOR INSERT TO wellsim_runtime
  WITH CHECK (
    linked_by = app.current_user_id()
    AND
    app.has_workspace_permission(workspace_id, 'case.write')
    AND app.has_workspace_permission(workspace_id, 'file.read')
  );
CREATE POLICY case_file_link_update ON app.case_file_link
  FOR UPDATE TO wellsim_runtime
  USING (app.has_workspace_permission(workspace_id, 'case.write'))
  WITH CHECK (app.has_workspace_permission(workspace_id, 'case.write'));

CREATE POLICY export_job_select ON app.export_job
  FOR SELECT TO wellsim_runtime
  USING (app.has_workspace_permission(workspace_id, 'export.read'));
CREATE POLICY export_job_insert ON app.export_job
  FOR INSERT TO wellsim_runtime
  WITH CHECK (
    requested_by = app.current_user_id()
    AND app.has_workspace_permission(workspace_id, 'export.create')
  );

CREATE POLICY export_item_select ON app.export_item
  FOR SELECT TO wellsim_runtime
  USING (app.has_workspace_permission(workspace_id, 'export.read'));
CREATE POLICY export_item_insert ON app.export_item
  FOR INSERT TO wellsim_runtime
  WITH CHECK (app.has_workspace_permission(workspace_id, 'export.create'));

CREATE POLICY export_artifact_select ON app.export_artifact
  FOR SELECT TO wellsim_runtime
  USING (app.has_workspace_permission(workspace_id, 'export.read'));

CREATE POLICY audit_event_select ON app.audit_event
  FOR SELECT TO wellsim_runtime
  USING (app.has_workspace_permission(workspace_id, 'audit.read'));
CREATE POLICY audit_event_insert ON app.audit_event
  FOR INSERT TO wellsim_runtime
  WITH CHECK (
    app.has_workspace_permission(workspace_id, 'audit.write')
    AND actor_user_id = app.current_user_id()
  );

CREATE TRIGGER organization_workspace_immutable
  BEFORE UPDATE OF workspace_id ON app.organization
  FOR EACH ROW EXECUTE FUNCTION app.reject_workspace_change();
CREATE TRIGGER membership_workspace_immutable
  BEFORE UPDATE OF workspace_id ON app.membership
  FOR EACH ROW EXECUTE FUNCTION app.reject_workspace_change();
CREATE TRIGGER invitation_workspace_immutable
  BEFORE UPDATE OF workspace_id ON app.workspace_invitation
  FOR EACH ROW EXECUTE FUNCTION app.reject_workspace_change();
CREATE TRIGGER field_asset_workspace_immutable
  BEFORE UPDATE OF workspace_id ON app.field_asset
  FOR EACH ROW EXECUTE FUNCTION app.reject_workspace_change();
CREATE TRIGGER reservoir_workspace_immutable
  BEFORE UPDATE OF workspace_id ON app.reservoir
  FOR EACH ROW EXECUTE FUNCTION app.reject_workspace_change();
CREATE TRIGGER well_workspace_immutable
  BEFORE UPDATE OF workspace_id ON app.well
  FOR EACH ROW EXECUTE FUNCTION app.reject_workspace_change();
CREATE TRIGGER wellbore_workspace_immutable
  BEFORE UPDATE OF workspace_id ON app.wellbore
  FOR EACH ROW EXECUTE FUNCTION app.reject_workspace_change();
CREATE TRIGGER project_workspace_immutable
  BEFORE UPDATE OF workspace_id ON app.project
  FOR EACH ROW EXECUTE FUNCTION app.reject_workspace_change();
CREATE TRIGGER project_well_workspace_immutable
  BEFORE UPDATE OF workspace_id ON app.project_well
  FOR EACH ROW EXECUTE FUNCTION app.reject_workspace_change();
CREATE TRIGGER engineering_case_workspace_immutable
  BEFORE UPDATE OF workspace_id ON app.engineering_case
  FOR EACH ROW EXECUTE FUNCTION app.reject_workspace_change();
CREATE TRIGGER case_revision_workspace_immutable
  BEFORE UPDATE OF workspace_id ON app.case_revision
  FOR EACH ROW EXECUTE FUNCTION app.reject_workspace_change();
CREATE TRIGGER calculation_run_workspace_immutable
  BEFORE UPDATE OF workspace_id ON app.calculation_run
  FOR EACH ROW EXECUTE FUNCTION app.reject_workspace_change();
CREATE TRIGGER dataset_workspace_immutable
  BEFORE UPDATE OF workspace_id ON app.dataset
  FOR EACH ROW EXECUTE FUNCTION app.reject_workspace_change();
CREATE TRIGGER file_object_workspace_immutable
  BEFORE UPDATE OF workspace_id ON app.file_object
  FOR EACH ROW EXECUTE FUNCTION app.reject_workspace_change();
CREATE TRIGGER case_file_link_workspace_immutable
  BEFORE UPDATE OF workspace_id ON app.case_file_link
  FOR EACH ROW EXECUTE FUNCTION app.reject_workspace_change();
CREATE TRIGGER export_job_workspace_immutable
  BEFORE UPDATE OF workspace_id ON app.export_job
  FOR EACH ROW EXECUTE FUNCTION app.reject_workspace_change();
CREATE TRIGGER export_item_workspace_immutable
  BEFORE UPDATE OF workspace_id ON app.export_item
  FOR EACH ROW EXECUTE FUNCTION app.reject_workspace_change();
CREATE TRIGGER export_artifact_workspace_immutable
  BEFORE UPDATE OF workspace_id ON app.export_artifact
  FOR EACH ROW EXECUTE FUNCTION app.reject_workspace_change();
CREATE TRIGGER audit_event_workspace_immutable
  BEFORE UPDATE OF workspace_id ON app.audit_event
  FOR EACH ROW EXECUTE FUNCTION app.reject_workspace_change();

CREATE TRIGGER case_revision_append_only
  BEFORE UPDATE OR DELETE ON app.case_revision
  FOR EACH ROW EXECUTE FUNCTION app.reject_immutable_mutation();
CREATE TRIGGER calculation_run_append_only
  BEFORE UPDATE OR DELETE ON app.calculation_run
  FOR EACH ROW EXECUTE FUNCTION app.reject_immutable_mutation();
CREATE TRIGGER export_item_append_only
  BEFORE UPDATE OR DELETE ON app.export_item
  FOR EACH ROW EXECUTE FUNCTION app.reject_immutable_mutation();
CREATE TRIGGER export_artifact_append_only
  BEFORE UPDATE OR DELETE ON app.export_artifact
  FOR EACH ROW EXECUTE FUNCTION app.reject_immutable_mutation();
CREATE TRIGGER audit_event_append_only
  BEFORE UPDATE OR DELETE ON app.audit_event
  FOR EACH ROW EXECUTE FUNCTION app.reject_immutable_mutation();

INSERT INTO app.schema_migration(version) VALUES ('0002_tenant_isolation');

COMMIT;
