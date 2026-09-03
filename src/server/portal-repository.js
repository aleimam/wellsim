// Portal operations use verified session hashes. Browser-supplied user, role
// and platform-administrator claims are never accepted by this boundary.
export function createPortalRepository(call) {
  const portal = async (hash, action, workspace, input = {}) =>
    (await call('SELECT app.portal_command($1,$2,$3::uuid,$4::jsonb) AS result',
      [hash, action, workspace, JSON.stringify(input)])).rows[0]?.result;
  const admin = async (hash, action, input = {}) =>
    (await call('SELECT app.platform_help_command($1,$2,$3::jsonb) AS result',
      [hash, action, JSON.stringify(input)])).rows[0]?.result;
  return Object.freeze({
    async ready() {
      const result = await call(`SELECT
        (SELECT bool_and(p.prosecdef AND p.proowner=
          (SELECT relowner FROM pg_class WHERE oid='app.engineering_case'::regclass)
          AND p.proconfig @> ARRAY['search_path=pg_catalog']
          AND has_function_privilege(current_user,p.oid,'EXECUTE')
          AND NOT has_function_privilege('public',p.oid,'EXECUTE'))
          FROM pg_proc p WHERE p.oid=ANY(ARRAY[
            'app.help_catalog()'::regprocedure,'app.help_read(text)'::regprocedure,
            'app.portal_command(text,text,uuid,jsonb)'::regprocedure,
            'app.platform_help_command(text,text,jsonb)'::regprocedure]::oid[]))
        AND NOT EXISTS (SELECT FROM (VALUES
          ('organization_join_request'),('platform_administrator'),('help_page'),
          ('help_revision'),('platform_audit_event')) AS guarded(name)
          WHERE has_table_privilege(current_user,'app.'||guarded.name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
            OR has_any_column_privilege(current_user,'app.'||guarded.name,'SELECT,INSERT,UPDATE,REFERENCES')) AS safe`, []);
      if (result.rows[0]?.safe !== true) throw new Error('Unsafe portal privileges');
    },
    context: (hash) => portal(hash, 'context', null),
    directory: (hash, query) => portal(hash, 'directory.search', null, { query }),
    joinRequests: (hash) => portal(hash, 'join.mine', null),
    createJoinRequest: (hash, workspace) => portal(hash, 'join.create', workspace),
    cancelJoinRequest: (hash, requestId) => portal(hash, 'join.cancel', null, { requestId }),
    companySettings: (hash, workspace) => portal(hash, 'company.settings.get', workspace),
    updateCompanySettings: (hash, workspace, joinPolicy, directorySummary) =>
      portal(hash, 'company.settings.update', workspace, { joinPolicy, directorySummary }),
    companyJoinRequests: (hash, workspace) => portal(hash, 'company.join.list', workspace),
    reviewJoinRequest: (hash, workspace, requestId, decision) =>
      portal(hash, 'company.join.review', workspace, { requestId, decision }),
    helpCatalog: async () => (await call('SELECT app.help_catalog() AS result', [])).rows[0]?.result,
    helpPage: async (slug) => (await call('SELECT app.help_read($1) AS result', [slug])).rows[0]?.result,
    adminHelpList: (hash) => admin(hash, 'list'),
    adminHelpPage: (hash, slug) => admin(hash, 'get', { slug }),
    saveHelpPage: (hash, page) => admin(hash, 'save', page),
    publishHelpPage: (hash, slug) => admin(hash, 'publish', { slug }),
    unpublishHelpPage: (hash, slug) => admin(hash, 'unpublish', { slug }),
  });
}
