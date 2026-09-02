import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { authConfigFromEnv, createOidcProvider } from './oidc.js';

const SESSION = '__Host-bldrz_session';
const FLOW = '__Host-bldrz_login';
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const tokenHash = (value) => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const cookie = (name, value, maxAge) =>
  `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;

function readCookie(req, name) {
  const values = (req.headers.cookie ?? '').split(';').map((v) => v.trim())
    .filter((v) => v.startsWith(`${name}=`)).map((v) => v.slice(name.length + 1));
  return values.length === 1 && TOKEN.test(values[0]) ? values[0] : undefined;
}
function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function send(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}
function redirect(res, location) { res.writeHead(303, { location }); res.end(); }

export function createAuthHttp({ settings, provider, database }) {
  let inFlight = 0;
  return async function handle(req, res) {
    const rawPath = req.url.split('?')[0];
    if (!rawPath.startsWith('/auth/') && !rawPath.startsWith('/api/v2/')) return false;
    res.setHeader('cache-control', 'no-store');
    res.setHeader('pragma', 'no-cache');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('x-content-type-options', 'nosniff');
    if (!settings.enabled) { send(res, 404, { error: 'not_available' }); return true; }
    // A process-local admission cap complements the shared database flow cap.
    if (inFlight >= 20) { send(res, 503, { error: 'temporarily_unavailable' }); return true; }
    inFlight += 1;
    try {
      const url = new URL(req.url, settings.origin);
      if (url.origin !== settings.origin) { send(res, 400, { error: 'invalid_request' }); return true; }
      const methods = { '/auth/login': 'GET', '/auth/callback': 'GET', '/auth/session': 'GET',
        '/auth/logout': 'POST', '/api/v2/workspaces': 'GET', '/api/v2/workspace': 'GET' };
      const method = methods[url.pathname];
      if (!method) { send(res, 404, { error: 'not_found' }); return true; }
      if (req.method !== method) {
        res.setHeader('allow', method); send(res, 405, { error: 'method_not_allowed' }); return true;
      }
      if (url.pathname === '/auth/login') {
        const { flow, url: location } = await provider.start();
        const browserToken = token();
        if (!await database.auth.createFlow(tokenHash(browserToken), flow)) {
          send(res, 429, { error: 'try_again_later' }); return true;
        }
        res.setHeader('set-cookie', cookie(FLOW, browserToken, 600));
        redirect(res, location); return true;
      }
      if (url.pathname === '/auth/callback') {
        res.setHeader('set-cookie', cookie(FLOW, '', 0));
        const browserToken = readCookie(req, FLOW);
        const flow = browserToken && await database.auth.consumeFlow(tokenHash(browserToken));
        if (!flow || url.searchParams.getAll('state').length !== 1 ||
            url.searchParams.getAll('code').length !== 1 ||
            !equal(flow.state, url.searchParams.get('state')) || url.searchParams.has('error')) {
          send(res, 400, { error: 'sign_in_failed' }); return true;
        }
        let identity;
        try { identity = await provider.finish(url, flow); }
        catch { send(res, 400, { error: 'sign_in_failed' }); return true; }
        const sessionToken = token();
        const previous = readCookie(req, SESSION);
        const userId = await database.auth.createSession(identity, tokenHash(sessionToken),
          randomBytes(32).toString('hex'), previous ? tokenHash(previous) : null);
        if (!userId) { send(res, 403, { error: 'access_not_provisioned' }); return true; }
        res.setHeader('set-cookie', [cookie(FLOW, '', 0), cookie(SESSION, sessionToken, 28800)]);
        // Fixed same-origin destination. No returnTo/open redirect parameter.
        redirect(res, '/'); return true;
      }
      const browserToken = readCookie(req, SESSION);
      const hash = browserToken && tokenHash(browserToken);
      const session = hash && await database.auth.readSession(hash);
      if (!session) {
        res.setHeader('set-cookie', cookie(SESSION, '', 0));
        send(res, 401, { error: 'authentication_required' }); return true;
      }
      if (url.pathname === '/auth/logout') {
        if (req.headers.origin !== settings.origin ||
            !equal(req.headers['x-csrf-token'], session.csrfToken)) {
          send(res, 403, { error: 'request_not_allowed' }); return true;
        }
        await database.auth.revokeSession(hash);
        res.setHeader('set-cookie', cookie(SESSION, '', 0));
        send(res, 200, { signedOut: true }); return true;
      }
      if (url.pathname === '/auth/session') {
        send(res, 200, { user: { id: session.userId, displayName: session.displayName }, csrfToken: session.csrfToken });
      } else if (url.pathname === '/api/v2/workspaces') {
        send(res, 200, { workspaces: await database.auth.listWorkspaces(hash) });
      } else {
        // Workspace ID is a selection, never authority. Membership/permissions
        // are rechecked by the existing transaction boundary on every request.
        const workspace = await database.withTenantTransaction(
          { userId: session.userId, workspaceId: req.headers['x-workspace-id'] },
          async (tx) => (await tx.query('SELECT id, kind, name FROM app.workspace WHERE id=$1',
            [req.headers['x-workspace-id']])).rows[0]);
        if (!workspace) send(res, 404, { error: 'not_found' });
        else send(res, 200, { workspace });
      }
    } catch (error) {
      if (error.code === 'tenant_access_denied') send(res, 404, { error: 'not_found' });
      else send(res, 503, { error: 'temporarily_unavailable' });
      // Never log driver errors, callback URLs, cookies, provider tokens or PII.
    } finally { inFlight -= 1; }
    return true;
  };
}

export async function initializeAuthentication(database, env = process.env) {
  const settings = authConfigFromEnv(env);
  if (!settings.enabled) return createAuthHttp({ settings });
  try {
    if (!database.enabled || !database.auth) throw new Error('Database required');
    await database.auth.ready();
    const provider = await createOidcProvider(settings);
    return createAuthHttp({ settings, provider, database });
  } catch { throw new Error('Verified authentication startup failed'); }
}
