import { readJsonBody } from './onboarding-http.js';

export const publicHelpRoutes = Object.freeze({
  '/api/help/catalog': 'GET', '/api/help/page': 'GET',
});
export const portalRoutes = Object.freeze({
  '/api/v2/portal/context': 'GET', '/api/v2/portal/directory': 'GET',
  '/api/v2/portal/join-requests': 'GET', '/api/v2/portal/join-requests/create': 'POST',
  '/api/v2/portal/join-requests/cancel': 'POST', '/api/v2/portal/company': 'GET',
  '/api/v2/portal/company/update': 'POST', '/api/v2/portal/company/join-requests': 'GET',
  '/api/v2/portal/company/join-requests/review': 'POST', '/api/v2/admin/help': 'GET',
  '/api/v2/admin/help/page': 'GET', '/api/v2/admin/help/save': 'POST',
  '/api/v2/admin/help/publish': 'POST', '/api/v2/admin/help/unpublish': 'POST',
});

const invalid = (status = 400) => Object.assign(new Error('invalid_request'), { httpStatus: status });
const exactQuery = (url, allowed) => {
  for (const key of url.searchParams.keys()) if (!allowed.includes(key)) throw invalid();
  for (const key of allowed) if (url.searchParams.getAll(key).length > 1) throw invalid();
};
const slug = (value) => {
  if (typeof value !== 'string' || value.length > 80 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) throw invalid();
  return value;
};
const uuid = (value) => {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) throw invalid();
  return value;
};
const fields = (body, required, optional = []) => {
  const permitted = [...required, ...optional];
  if (Object.keys(body).some((key) => !permitted.includes(key))
    || required.some((key) => !Object.hasOwn(body, key))) throw invalid();
};
const text = (value, max, { empty = false } = {}) => {
  if (typeof value !== 'string' || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)
    || (!empty && !value.trim())) throw invalid();
  return value.trim();
};

export async function runPublicHelpRequest(url, repository) {
  if (url.pathname === '/api/help/catalog') {
    exactQuery(url, []); return { pages: await repository.helpCatalog() };
  }
  exactQuery(url, ['slug']);
  const page = await repository.helpPage(slug(url.searchParams.get('slug')));
  if (!page) throw invalid(404);
  return { page };
}

export async function runPortalRequest(req, url, hash, repository) {
  const pathname = url.pathname;
  if (req.method === 'GET') {
    if (pathname === '/api/v2/portal/context') { exactQuery(url, []); return repository.context(hash); }
    if (pathname === '/api/v2/portal/directory') {
      exactQuery(url, ['q']); return { companies: await repository.directory(hash, text(url.searchParams.get('q') ?? '', 80, { empty: true })) };
    }
    if (pathname === '/api/v2/portal/join-requests') { exactQuery(url, []); return { requests: await repository.joinRequests(hash) }; }
    if (pathname === '/api/v2/portal/company') {
      exactQuery(url, []); return { company: await repository.companySettings(hash, uuid(req.headers['x-workspace-id'])) };
    }
    if (pathname === '/api/v2/portal/company/join-requests') {
      exactQuery(url, []); return { requests: await repository.companyJoinRequests(hash, uuid(req.headers['x-workspace-id'])) };
    }
    if (pathname === '/api/v2/admin/help') { exactQuery(url, []); return { pages: await repository.adminHelpList(hash) }; }
    exactQuery(url, ['slug']); return { page: await repository.adminHelpPage(hash, slug(url.searchParams.get('slug'))) };
  }
  const body = await readJsonBody(req, pathname === '/api/v2/admin/help/save' ? 131072 : 8192);
  if (pathname === '/api/v2/portal/join-requests/create') {
    fields(body, ['workspaceId']); return repository.createJoinRequest(hash, uuid(body.workspaceId));
  }
  if (pathname === '/api/v2/portal/join-requests/cancel') {
    fields(body, ['requestId']); return repository.cancelJoinRequest(hash, uuid(body.requestId));
  }
  if (pathname === '/api/v2/portal/company/update') {
    fields(body, ['joinPolicy', 'directorySummary']);
    const policy = text(body.joinPolicy, 32);
    if (!['invite_only', 'request'].includes(policy)) throw invalid();
    return repository.updateCompanySettings(hash, uuid(req.headers['x-workspace-id']), policy,
      text(body.directorySummary, 500, { empty: true }));
  }
  if (pathname === '/api/v2/portal/company/join-requests/review') {
    fields(body, ['requestId', 'decision']);
    const decision = text(body.decision, 16);
    if (!['approved', 'declined'].includes(decision)) throw invalid();
    return repository.reviewJoinRequest(hash, uuid(req.headers['x-workspace-id']), uuid(body.requestId), decision);
  }
  if (pathname === '/api/v2/admin/help/save') {
    fields(body, ['slug', 'section', 'sortOrder', 'title', 'summary', 'bodyMarkdown']);
    if (!Number.isSafeInteger(body.sortOrder) || body.sortOrder < 0 || body.sortOrder > 10000) throw invalid();
    return repository.saveHelpPage(hash, { slug: slug(body.slug), section: slug(body.section),
      sortOrder: body.sortOrder, title: text(body.title, 160), summary: text(body.summary, 500, { empty: true }),
      bodyMarkdown: text(body.bodyMarkdown, 100000) });
  }
  fields(body, ['slug']);
  return pathname === '/api/v2/admin/help/publish'
    ? repository.publishHelpPage(hash, slug(body.slug))
    : repository.unpublishHelpPage(hash, slug(body.slug));
}
