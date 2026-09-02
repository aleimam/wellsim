const el = (id) => document.getElementById(id);
const roles = ['owner', 'administrator', 'engineering_manager', 'engineer', 'reviewer', 'viewer'];
const label = (value) => value.replaceAll('_', ' ');
let csrf, workspaces = [], currentUser;
let pageEpoch = 0;
const selected = () => workspaces.find((w) => w.id === el('workspace-select').value);
const message = (text, error = false) => { el('message').textContent = text; el('message').classList.toggle('error', error); };
const option = (value, text) => { const node = document.createElement('option'); node.value = value; node.textContent = text; return node; };

function clearPrivateUi() {
  pageEpoch += 1;
  csrf = undefined; currentUser = undefined; workspaces = [];
  el('signed-in').hidden = true;
  for (const id of ['members', 'invitations', 'workspace-select']) el(id).replaceChildren();
  for (const id of ['display-name', 'company-name', 'invite-email', 'invitation-url', 'accept-token']) el(id).value = '';
  el('who').textContent = ''; el('workspace-description').textContent = '';
}
async function api(path, body, workspaceId) {
  const epoch = pageEpoch;
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin', cache: 'no-store', headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json', 'x-csrf-token': csrf }),
      ...(workspaceId ? { 'x-workspace-id': workspaceId } : {}),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  if (epoch !== pageEpoch) throw new Error('This page session has ended.');
  if (!response.ok) {
    if (response.status === 401) { clearPrivateUi(); el('signed-out').hidden = false; }
    const descriptions = { 400: 'Check the information and try again.',
      401: 'Please sign in again.', 403: 'Request not allowed. Refresh and sign in again.',
      404: 'Not available. Check your access, invitation recipient, and expiry.',
      409: 'This change is not allowed. A company must retain an active owner.',
      429: 'The limit has been reached. Please try later or contact support.' };
    throw new Error(descriptions[response.status] ?? 'The service is unavailable. Please try again.');
  }
  return result;
}
async function action(event, operation) {
  event.preventDefault();
  const buttons = new Map([...document.querySelectorAll('button')].map((button) => [button, button.disabled]));
  buttons.forEach((_, button) => { button.disabled = true; });
  try { await operation(); } catch (error) { message(error.message, true); }
  finally { buttons.forEach((disabled, button) => { if (button.isConnected) button.disabled = disabled; }); }
}
async function refresh(prefer) {
  workspaces = (await api('/api/v2/workspaces')).workspaces;
  const previous = prefer ?? selected()?.id;
  el('workspace-select').replaceChildren(...workspaces.map((w) => option(w.id, `${w.name} · ${w.kind === 'personal' ? 'Private' : label(w.role_key)}`)));
  if (workspaces.some((w) => w.id === previous)) el('workspace-select').value = previous;
  await showWorkspace();
}
async function showWorkspace() {
  const workspace = selected();
  el('members').replaceChildren(); el('invitations').replaceChildren();
  el('invitation-result').hidden = true; el('invitation-url').value = '';
  el('team').hidden = true; el('leave-company').hidden = true;
  el('workspace-description').textContent = workspace
    ? `${workspace.name} — ${workspace.kind === 'personal' ? 'Only you can access this workspace. It cannot invite members.' : `Your role: ${label(workspace.role_key)}.`}`
    : 'No active workspace is available. Contact your workspace owner.';
  if (!workspace || workspace.kind === 'personal') return;
  el('leave-company').hidden = false;
  if (!['owner', 'administrator'].includes(workspace.role_key)) return;
  const [members, invitations] = await Promise.all([
    api('/api/v2/members', undefined, workspace.id), api('/api/v2/invitations', undefined, workspace.id),
  ]);
  if (selected()?.id !== workspace.id) return; // ignore a superseded selection
  el('team').hidden = false;
  const permitted = workspace.role_key === 'owner' ? roles : roles.slice(2);
  el('invite-role').replaceChildren(...permitted.filter((r) => r !== 'owner').map((r) => option(r, label(r))));
  el('invite-role').value = 'engineer';
  for (const member of members.members) {
    const row = document.createElement('tr');
    const name = document.createElement('td'); name.textContent = `${member.displayName}${member.userId === currentUser ? ' (you)' : ''}`;
    row.append(name);
    const role = document.createElement('select'); role.setAttribute('aria-label', `Role for ${member.displayName}`);
    role.replaceChildren(...[...new Set([member.role, ...permitted])].map((r) => option(r, label(r)))); role.value = member.role;
    const status = document.createElement('select'); status.setAttribute('aria-label', `Status for ${member.displayName}`);
    status.replaceChildren(...[...new Set([member.status, 'active', 'suspended', 'removed'])].map((s) => option(s, s))); status.value = member.status;
    const save = document.createElement('button'); save.textContent = 'Apply'; save.type = 'button';
    const restricted = workspace.role_key !== 'owner' && ['owner', 'administrator'].includes(member.role);
    role.disabled = restricted; status.disabled = restricted; save.disabled = restricted;
    save.addEventListener('click', (event) => action(event, async () => {
      if (!confirm(`Change ${member.displayName} to ${label(role.value)} / ${status.value}?`)) return;
      await api('/api/v2/members/change', { userId: member.userId, role: role.value, status: status.value }, workspace.id);
      await refresh(workspace.id); message('Membership updated. Access is rechecked on the next request.');
    }));
    for (const control of [role, status, save]) { const cell = document.createElement('td'); cell.append(control); row.append(cell); }
    el('members').append(row);
  }
  for (const invite of invitations.invitations) {
    const item = document.createElement('li');
    item.textContent = `${invite.email} · ${label(invite.role)} · ${invite.status} · expires ${new Date(invite.expiresAt).toLocaleString()}`;
    if (invite.status === 'pending' && (workspace.role_key === 'owner' || invite.role !== 'administrator')) {
      const revoke = document.createElement('button'); revoke.textContent = 'Revoke'; revoke.type = 'button'; revoke.className = 'secondary';
      revoke.addEventListener('click', (event) => action(event, async () => {
        await api('/api/v2/invitations/revoke', { invitationId: invite.id }, workspace.id);
        await showWorkspace(); message('Invitation revoked.');
      })); item.append(revoke);
    }
    el('invitations').append(item);
  }
}
el('profile-form').addEventListener('submit', (event) => action(event, async () => {
  const result = await api('/api/v2/profile', { displayName: el('display-name').value });
  el('who').textContent = `Signed in as ${result.displayName}`; message('Display name saved.');
}));
el('company-form').addEventListener('submit', (event) => action(event, async () => {
  const company = await api('/api/v2/companies', { name: el('company-name').value });
  el('company-name').value = ''; await refresh(company.id); message('Company created. You are its owner.');
}));
el('invite-form').addEventListener('submit', (event) => action(event, async () => {
  const workspace = selected();
  const result = await api('/api/v2/invitations/create', { email: el('invite-email').value, role: el('invite-role').value }, workspace.id);
  await showWorkspace();
  if (selected()?.id !== workspace.id) return;
  el('invitation-url').value = result.invitationUrl; el('invitation-result').hidden = false;
  message('Invitation created. Copy the link and share it privately; no email was sent.');
}));
el('copy-invitation').addEventListener('click', (event) => action(event, async () => {
  try { await navigator.clipboard.writeText(el('invitation-url').value); message('Invitation link copied.'); }
  catch { el('invitation-url').select(); message('Select and copy the invitation link manually.'); }
}));
el('accept-form').addEventListener('submit', (event) => action(event, async () => {
  let token = el('accept-token').value.trim();
  if (token.startsWith('https://')) {
    const link = new URL(token);
    if (link.origin !== location.origin || link.pathname !== '/workspace.html') throw new Error('Use an invitation link from this site.');
    token = new URLSearchParams(link.hash.slice(1)).get('invite');
  }
  const result = await api('/api/v2/invitations/accept', { token });
  el('accept-token').value = ''; await refresh(result.workspaceId); message('Invitation accepted. Your private workspace is unchanged.');
}));
el('leave').addEventListener('click', (event) => action(event, async () => {
  if (!confirm(`Leave ${selected()?.name}? Your access to its data will end.`)) return;
  await api('/api/v2/workspace/leave', {}, selected().id); await refresh(); message('You have left the company.');
}));
el('signout').addEventListener('click', (event) => action(event, async () => {
  await api('/auth/logout', {}); clearPrivateUi(); el('signed-out').hidden = false; message('Signed out.');
}));
el('workspace-select').addEventListener('change', (event) => action(event, showWorkspace));
// Avoid keeping identity/member/invitation data in the back-forward cache.
addEventListener('pagehide', clearPrivateUi);
addEventListener('pageshow', (event) => { if (event.persisted) location.reload(); });
async function initialize() {
  const epoch = pageEpoch;
  let invitation = new URLSearchParams(location.hash.slice(1)).get('invite');
  if (location.hash) history.replaceState(null, '', location.pathname);
  try {
    const response = await fetch('/auth/session', { cache: 'no-store', credentials: 'same-origin' });
    if (response.status === 404) { message('Workspace onboarding is not enabled on this deployment. Engineering tools remain available.'); return; }
    if (response.status === 401) {
      if ((await response.json()).onboardingEnabled) {
        el('signed-out').hidden = false; message('Sign in securely to create or open your workspaces.');
      } else message('Workspace onboarding is not enabled on this deployment.');
      return;
    }
    if (!response.ok) throw new Error('Secure sign-in is temporarily unavailable.');
    const session = await response.json();
    if (epoch !== pageEpoch) return;
    if (!session.onboardingEnabled) { message('Workspace onboarding is not enabled on this deployment.'); return; }
    csrf = session.csrfToken; currentUser = session.user.id;
    el('who').textContent = `Signed in as ${session.user.displayName}`;
    el('display-name').value = session.user.displayName;
    el('signed-in').hidden = false;
    if (invitation && /^[A-Za-z0-9_-]{43}$/.test(invitation)) el('accept-token').value = invitation;
    invitation = undefined;
    await refresh(); message('Choose a workspace, create a company, or accept an invitation.');
  } catch (error) { message(error.message, true); }
}
initialize();
