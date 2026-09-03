const el = (id) => document.getElementById(id);
const make = (tag, text, className) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (className) n.className = className; return n; };
const roleLabel = (role) => role.replaceAll('_', ' ');
let csrf, session, workspaces = [], epoch = 0;

function status(text, error = false) {
  const target = el('status'); if (!target) return;
  target.textContent = text; target.classList.toggle('error', error);
}
function clearPrivate() {
  epoch += 1; csrf = undefined; session = undefined; workspaces = [];
  for (const id of ['directory-results','my-requests','company-requests','team-list']) el(id)?.replaceChildren();
  if (el('private')) el('private').hidden = true;
}
async function api(path, { body, workspace } = {}) {
  const pageEpoch = epoch;
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json', 'x-csrf-token': csrf }),
      ...(workspace ? { 'x-workspace-id': workspace } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json().catch(() => ({}));
  if (pageEpoch !== epoch) throw new Error('This page session has ended.');
  if (!response.ok) {
    if (response.status === 401) { clearPrivate(); el('signed-out').hidden = false; }
    if (response.status === 403 && result.error === 'mfa_required') throw new Error('Recent MFA is required. Verify, then retry the action.');
    const text = { 400:'Check the submitted information.',401:'Please sign in again.',403:'This action is not allowed.',
      404:'This item is not available to this account.',409:'The request conflicts with an existing membership or request.',
      429:'The account or company limit has been reached.' }[response.status];
    throw new Error(text ?? 'The service is temporarily unavailable.');
  }
  return result;
}
async function action(event, operation) {
  event?.preventDefault(); const buttons = [...document.querySelectorAll('button')];
  buttons.forEach((button) => { button.disabled = true; });
  try { await operation(); } catch (error) { status(error.message, true); }
  finally { buttons.forEach((button) => { if (button.isConnected) button.disabled = false; }); }
}
function item(title, details, badge) {
  const row = make('div', undefined, 'item'); const h = make('h3', title); row.append(h);
  if (badge) h.append(' ', make('span', badge, 'pill'));
  row.append(make('p', details, 'meta')); return row;
}
function setSelect(target, values) {
  target.replaceChildren(...values.map((workspace) => {
    const option = make('option', `${workspace.name} · ${roleLabel(workspace.role_key)}`); option.value = workspace.id; return option;
  }));
}
async function startMfa() {
  const { redirectTo } = await api('/auth/step-up', { body: {} }); const destination = new URL(redirectTo);
  if (destination.protocol !== 'https:' || destination.username || destination.password) throw new Error('Invalid verification destination.');
  clearPrivate(); location.assign(destination.href);
}

async function loadPersonalRequests() {
  const target = el('my-requests'); target.replaceChildren();
  const { requests } = await api('/api/v2/portal/join-requests');
  if (!requests.length) { target.append(make('p', 'You have no company membership requests.', 'empty')); return; }
  for (const request of requests) {
    const row = item(request.companyName, `Requested ${new Date(request.requestedAt).toLocaleString()}`, request.status);
    if (request.status === 'pending') {
      const cancel = make('button', 'Cancel request', 'danger'); cancel.type = 'button';
      cancel.addEventListener('click', (event) => action(event, async () => {
        await api('/api/v2/portal/join-requests/cancel', { body: { requestId: request.id } });
        await loadPersonalRequests(); status('The pending request was cancelled.');
      })); row.append(cancel);
    }
    target.append(row);
  }
}
async function searchCompanies() {
  const query = el('company-search').value.trim();
  const { companies } = await api(`/api/v2/portal/directory?q=${encodeURIComponent(query)}`);
  const target = el('directory-results'); target.replaceChildren();
  if (!companies.length) { target.append(make('p', 'No available companies matched. A company may be invitation-only.', 'empty')); return; }
  for (const company of companies) {
    const row = item(company.name, company.summary || 'This company accepts membership requests.');
    const request = make('button', 'Request to join'); request.type = 'button';
    request.addEventListener('click', (event) => action(event, async () => {
      await api('/api/v2/portal/join-requests/create', { body: { workspaceId: company.id } });
      row.remove(); await loadPersonalRequests(); status(`Request sent to ${company.name}. It grants no access until approved.`);
    })); row.append(request); target.append(row);
  }
}

async function loadCompany() {
  const workspace = el('company-select').value;
  if (!workspace) return;
  const { company } = await api('/api/v2/portal/company', { workspace });
  el('join-policy').value = company.joinPolicy; el('directory-summary').value = company.directorySummary;
  const target = el('company-requests'); target.replaceChildren();
  try {
    const { requests } = await api('/api/v2/portal/company/join-requests', { workspace });
    if (!requests.length) { target.append(make('p', 'No membership requests for this company.', 'empty')); return; }
    for (const request of requests) {
      const row = item(request.displayName, `${request.email} · ${new Date(request.requestedAt).toLocaleString()}`, request.status);
      if (request.status === 'pending') {
        const actions = make('div', undefined, 'actions');
        for (const [decision, label] of [['approved','Approve as engineer'],['declined','Decline']]) {
          const button = make('button', label, decision === 'declined' ? 'danger' : undefined); button.type = 'button';
          button.addEventListener('click', (event) => action(event, async () => {
            if (!confirm(`${label} for ${request.displayName}?`)) return;
            await api('/api/v2/portal/company/join-requests/review', { workspace,
              body: { requestId: request.id, decision } });
            await loadCompany(); status(decision === 'approved' ? 'Membership approved with Engineer access.' : 'Membership request declined.');
          })); actions.append(button);
        }
        row.append(actions);
      }
      target.append(row);
    }
  } catch (error) { target.append(make('p', error.message, 'empty')); }
}

async function pagePersonal() {
  await loadPersonalRequests();
  el('directory-form').addEventListener('submit', (event) => action(event, async () => { await searchCompanies(); status('Company search complete.'); }));
}
async function pageCompany() {
  const managed = workspaces.filter((w) => w.kind === 'organization' && ['owner','administrator'].includes(w.role_key));
  if (!managed.length) { el('company-console').hidden = true; status('You do not administer a company.'); return; }
  setSelect(el('company-select'), managed); el('company-select').addEventListener('change', (event) => action(event, loadCompany));
  el('company-form').addEventListener('submit', (event) => action(event, async () => {
    const workspace = el('company-select').value;
    await api('/api/v2/portal/company/update', { workspace, body: { joinPolicy: el('join-policy').value,
      directorySummary: el('directory-summary').value } });
    await loadCompany(); status('Company directory settings saved.');
  })); await loadCompany();
}
async function pageTeam() {
  const target = el('team-list'); const companies = workspaces.filter((w) => w.kind === 'organization');
  if (!companies.length) { target.append(make('p', 'You are not currently a member of a company.', 'empty')); return; }
  for (const company of companies) {
    const row = item(company.name, `Your role: ${roleLabel(company.role_key)}.`, 'active member');
    const actions = make('div', undefined, 'actions');
    const tools = make('a', 'Open engineering tools', 'button'); tools.href = '/'; actions.append(tools);
    if (['owner','administrator'].includes(company.role_key)) { const admin = make('a', 'Company administration'); admin.href = '/portal/company.html'; actions.append(admin); }
    row.append(actions); target.append(row);
  }
}
async function pageHome() {
  const personal = workspaces.filter((w) => w.kind === 'personal').length;
  const companies = workspaces.filter((w) => w.kind === 'organization').length;
  el('workspace-summary').textContent = `${personal} private workspace · ${companies} company membership${companies === 1 ? '' : 's'}`;
}

async function initialize() {
  const pageEpoch = epoch;
  try {
    const response = await fetch('/auth/session', { credentials: 'same-origin', cache: 'no-store' });
    if (response.status === 404) { status('Secure portals are not enabled on this deployment.'); return; }
    if (response.status === 401) { el('signed-out').hidden = false; status('Sign in to open your portal.'); return; }
    if (!response.ok) throw new Error('Secure sign-in is temporarily unavailable.');
    session = await response.json(); if (pageEpoch !== epoch) return;
    if (!session.portalEnabled) { status('The portal rollout is not enabled on this deployment.'); return; }
    csrf = session.csrfToken; workspaces = (await api('/api/v2/workspaces')).workspaces;
    el('private').hidden = false; el('who').textContent = `Signed in as ${session.user.displayName}`;
    if (el('admin-link')) el('admin-link').hidden = !session.platformAdministrator;
    const mfaUntil = new Date(session.mfaExpiresAt);
    el('mfa-note').textContent = mfaUntil.getTime() > Date.now()
      ? `MFA verified until ${mfaUntil.toLocaleTimeString()}.` : 'MFA is required for administrative changes.';
    const page = document.body.dataset.portal;
    if (page === 'personal') await pagePersonal(); else if (page === 'company') await pageCompany();
    else if (page === 'team') await pageTeam(); else await pageHome();
    status('Portal ready.');
  } catch (error) { status(error.message, true); }
}
el('verify-mfa')?.addEventListener('click', (event) => action(event, startMfa));
el('signout')?.addEventListener('click', (event) => action(event, async () => {
  await api('/auth/logout', { body: {} }); clearPrivate(); el('signed-out').hidden = false; status('Signed out.');
}));
addEventListener('pagehide', clearPrivate);
addEventListener('pageshow', (event) => { if (event.persisted) location.reload(); });
initialize();
