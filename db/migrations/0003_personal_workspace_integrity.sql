BEGIN;

-- A workspace has either an organization identity or one personal owner, never
-- both. Personal workspaces are intentionally private: collaboration belongs
-- in an organization workspace where membership changes are auditable.
ALTER TABLE app.workspace
  ADD CONSTRAINT workspace_owner_matches_kind_chk
  CHECK (
    (kind = 'personal' AND owner_user_id IS NOT NULL)
    OR (kind = 'organization' AND owner_user_id IS NULL)
  );

CREATE UNIQUE INDEX workspace_personal_owner_uidx
  ON app.workspace (owner_user_id)
  WHERE kind = 'personal';

CREATE FUNCTION app.enforce_personal_workspace_membership()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
DECLARE
  personal_owner uuid;
BEGIN
  SELECT workspace_record.owner_user_id
    INTO personal_owner
  FROM app.workspace AS workspace_record
  WHERE workspace_record.id = NEW.workspace_id
    AND workspace_record.kind = 'personal';

  IF FOUND AND (
    NEW.user_id IS DISTINCT FROM personal_owner
    OR NEW.role_key IS DISTINCT FROM 'owner'
    OR NEW.invited_by IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'personal workspace membership is restricted to its owner'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$function$;

CREATE FUNCTION app.reject_personal_workspace_invitation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM app.workspace AS workspace_record
    WHERE workspace_record.id = NEW.workspace_id
      AND workspace_record.kind = 'personal'
  ) THEN
    RAISE EXCEPTION 'personal workspaces cannot issue invitations'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION app.enforce_personal_workspace_membership() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.reject_personal_workspace_invitation() FROM PUBLIC;

CREATE TRIGGER membership_personal_workspace_integrity
  BEFORE INSERT OR UPDATE OF workspace_id, user_id, role_key, invited_by
  ON app.membership
  FOR EACH ROW EXECUTE FUNCTION app.enforce_personal_workspace_membership();

CREATE TRIGGER invitation_personal_workspace_integrity
  BEFORE INSERT OR UPDATE OF workspace_id
  ON app.workspace_invitation
  FOR EACH ROW EXECUTE FUNCTION app.reject_personal_workspace_invitation();

INSERT INTO app.schema_migration(version)
VALUES ('0003_personal_workspace_integrity');

COMMIT;
