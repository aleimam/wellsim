// The verified session, not request-supplied user/role claims, is the authority.
export function createOnboardingRepository(call) {
  const command = async (hash, action, workspace, input = {}) =>
    (await call('SELECT app.onboarding_command($1,$2,$3::uuid,$4::jsonb) AS result',
      [hash, action, workspace, JSON.stringify(input)])).rows[0]?.result;
  return Object.freeze({
    async ready() {
      const result = await call(`SELECT
        (SELECT bool_and(p.prosecdef AND p.proowner =
          (SELECT relowner FROM pg_class WHERE oid='app.engineering_case'::regclass)
          AND p.proconfig @> ARRAY['search_path=pg_catalog']
          AND has_function_privilege(current_user,p.oid,'EXECUTE')
          AND NOT has_function_privilege('public',p.oid,'EXECUTE')) FROM pg_proc p
          WHERE p.oid=ANY(ARRAY[
            'app.onboarding_sign_in(text,text,text,boolean,text,text,text)'::regprocedure,
            'app.onboarding_command(text,text,uuid,jsonb)'::regprocedure]::oid[]))
        AND NOT has_table_privilege(current_user,'app.membership','INSERT,DELETE,TRUNCATE')
        AND NOT has_any_column_privilege(current_user,'app.membership','UPDATE')
        AND NOT has_table_privilege(current_user,'app.workspace_invitation','INSERT,DELETE,TRUNCATE')
        AND NOT has_any_column_privilege(current_user,'app.workspace_invitation','UPDATE') AS safe`, []);
      if (result.rows[0]?.safe !== true) throw new Error('Unsafe onboarding privileges');
    },
    async signIn(identity, hash, csrf, previousHash) {
      return (await call('SELECT app.onboarding_sign_in($1,$2,$3,$4,$5,$6,$7) AS id',
        [identity.issuer, identity.subject, identity.email, identity.emailVerified === true,
          hash, csrf, previousHash])).rows[0]?.id;
    },
    profile: (hash, name) => command(hash, 'profile', null, { displayName: name }),
    createCompany: (hash, name) => command(hash, 'company.create', null, { name }),
    members: (hash, workspace) => command(hash, 'members.list', workspace),
    invitations: (hash, workspace) => command(hash, 'invitations.list', workspace),
    invite: (hash, workspace, email, role, tokenHash) =>
      command(hash, 'invitation.create', workspace, { email, role, tokenHash }),
    revoke: (hash, workspace, invitationId) => command(hash, 'invitation.revoke', workspace, { invitationId }),
    accept: (hash, tokenHash) => command(hash, 'invitation.accept', null, { tokenHash }),
    changeMember: (hash, workspace, userId, role, status) =>
      command(hash, 'member.change', workspace, { userId, role, status }),
    leave: (hash, workspace) => command(hash, 'member.leave', workspace),
  });
}
