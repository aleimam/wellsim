import { randomBytes, createHash } from 'node:crypto';

export const onboardingRoutes = Object.freeze({
  '/api/v2/profile': 'POST', '/api/v2/companies': 'POST',
  '/api/v2/members': 'GET', '/api/v2/invitations': 'GET',
  '/api/v2/invitations/create': 'POST', '/api/v2/invitations/revoke': 'POST',
  '/api/v2/invitations/accept': 'POST', '/api/v2/members/change': 'POST',
  '/api/v2/workspace/leave': 'POST',
});
const invalid = (status = 400) => Object.assign(new Error('invalid_request'), { httpStatus: status });
const uuid = (value) => {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) throw invalid();
  return value;
};
const string = (value, max) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw invalid();
  return value.trim();
};
const digest = (value) => createHash('sha256').update(value).digest('hex');

// Do not accept parsed req.body, unlimited streams, compressed bodies, or an
// unbounded wait for a slow client. Authentication/CSRF precede body parsing.
export async function readOnboardingBody(req) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '')
    || (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity')) throw invalid(415);
  if (req.headers['content-length'] && (!/^\d+$/.test(req.headers['content-length'])
    || Number(req.headers['content-length']) > 8192)) throw invalid(413);
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const finish = (error, value) => {
      clearTimeout(timer);
      req.off('data', data); req.off('end', end); req.off('error', fail); req.off('aborted', aborted);
      if (error) { req.resume(); reject(error); } else resolve(value);
    };
    const data = (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > 8192) finish(invalid(413)); else chunks.push(Buffer.from(chunk));
    };
    const end = () => {
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || Array.isArray(value) || typeof value !== 'object') throw invalid();
        finish(null, value);
      } catch { finish(invalid()); }
    };
    const fail = () => finish(invalid());
    const aborted = () => finish(invalid());
    const timer = setTimeout(() => finish(invalid(408)), 10000);
    timer.unref?.();
    req.on('data', data); req.on('end', end); req.on('error', fail); req.on('aborted', aborted);
  });
}

export async function runOnboardingRequest(req, pathname, hash, repository, origin) {
  const body = req.method === 'POST' ? await readOnboardingBody(req) : {};
  const fields = {
    '/api/v2/profile': ['displayName'], '/api/v2/companies': ['name'],
    '/api/v2/invitations/create': ['email', 'role'],
    '/api/v2/invitations/revoke': ['invitationId'], '/api/v2/invitations/accept': ['token'],
    '/api/v2/members/change': ['userId', 'role', 'status'],
  }[pathname] ?? [];
  if (Object.keys(body).some((key) => !fields.includes(key)) || fields.some((key) => !Object.hasOwn(body, key))) throw invalid();
  if (pathname === '/api/v2/profile') return repository.profile(hash, string(body.displayName, 100));
  if (pathname === '/api/v2/companies') return repository.createCompany(hash, string(body.name, 160));
  if (pathname === '/api/v2/invitations/accept') {
    if (typeof body.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.token)) throw invalid();
    return repository.accept(hash, digest(body.token));
  }
  const workspace = uuid(req.headers['x-workspace-id']);
  if (pathname === '/api/v2/members') return { members: await repository.members(hash, workspace) };
  if (pathname === '/api/v2/invitations') return { invitations: await repository.invitations(hash, workspace) };
  if (pathname === '/api/v2/invitations/create') {
    const email = string(body.email, 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw invalid();
    const invitationToken = randomBytes(32).toString('base64url');
    const result = await repository.invite(hash, workspace, email, string(body.role, 32), digest(invitationToken));
    // Fragment is never sent to the server/proxy; raw token is returned once.
    return { ...result, invitationUrl: `${origin}/workspace.html#invite=${invitationToken}` };
  }
  if (pathname === '/api/v2/invitations/revoke') return repository.revoke(hash, workspace, uuid(body.invitationId));
  if (pathname === '/api/v2/members/change') return repository.changeMember(hash, workspace,
    uuid(body.userId), string(body.role, 32), string(body.status, 16));
  return repository.leave(hash, workspace);
}
