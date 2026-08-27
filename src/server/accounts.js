// Server case database — client-company accounts with username/password.
// The free version stays: every calculation endpoint works without signing
// in; accounts only add per-company case storage on the server.
//
// Storage (zero-dependency, JSON on disk under data/):
//   data/users.json                       [{company, username, salt, hash}]
//   data/cases/<company>/<case>.json      {name, savedBy, savedAt, case}
// Passwords: scrypt (random salt, timing-safe compare). Sessions: in-memory
// tokens (crypto.randomUUID) — a server restart signs everyone out.
// NOTE: served over plain HTTP; put TLS in front for internet deployment.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = process.env.WELLSIM_DATA_DIR ?? path.join(process.cwd(), 'data');
const usersFile = () => path.join(DATA_DIR, 'users.json');
const casesRoot = () => path.join(DATA_DIR, 'cases');

const sessions = new Map(); // token -> { company, username }

/** Path-safe slug: lowercase, [a-z0-9-_], spaces -> dashes, max 60. */
const slug = (s) =>
  String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 60);

function loadUsers() {
  try {
    return JSON.parse(fs.readFileSync(usersFile(), 'utf8'));
  } catch {
    return [];
  }
}

function saveUsers(users) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(usersFile(), JSON.stringify(users, null, 1));
}

const hashPw = (pw, salt) => crypto.scryptSync(String(pw), salt, 64).toString('hex');

export function register({ company, username, password }) {
  const c = slug(company);
  const u = slug(username);
  if (!c) return { error: 'company name required' };
  if (!u) return { error: 'username required' };
  if (!password || String(password).length < 4)
    return { error: 'password must be at least 4 characters' };
  const users = loadUsers();
  if (users.some((x) => x.username === u))
    return { error: `username "${u}" already exists — sign in instead` };
  const salt = crypto.randomBytes(16).toString('hex');
  users.push({
    company: c,
    username: u,
    salt,
    hash: hashPw(password, salt),
    createdAt: new Date().toISOString(),
  });
  saveUsers(users);
  return login({ username: u, password });
}

export function login({ username, password }) {
  const u = slug(username);
  const rec = loadUsers().find((x) => x.username === u);
  const bad = { error: 'wrong username or password' };
  if (!rec) return bad;
  const h = hashPw(password ?? '', rec.salt);
  if (!crypto.timingSafeEqual(Buffer.from(h), Buffer.from(rec.hash))) return bad;
  const token = crypto.randomUUID();
  sessions.set(token, { company: rec.company, username: rec.username });
  return { token, company: rec.company, username: rec.username };
}

export function logout({ token }) {
  sessions.delete(token);
  return { ok: true };
}

const auth = (body) => sessions.get(body?.token) ?? null;
const companyDir = (company) => path.join(casesRoot(), company);

export function caseSave(body) {
  const s = auth(body);
  if (!s) return { error: 'not signed in' };
  const name = slug(body.name);
  if (!name) return { error: 'case name required' };
  if (!body.case || body.case.app !== 'WellSim') return { error: 'not a WellSim case' };
  fs.mkdirSync(companyDir(s.company), { recursive: true });
  fs.writeFileSync(
    path.join(companyDir(s.company), `${name}.json`),
    JSON.stringify(
      { name, savedBy: s.username, savedAt: new Date().toISOString(), case: body.case },
      null,
      1
    )
  );
  return { ok: true, name, company: s.company };
}

export function caseList(body) {
  const s = auth(body);
  if (!s) return { error: 'not signed in' };
  let files = [];
  try {
    files = fs.readdirSync(companyDir(s.company)).filter((f) => f.endsWith('.json'));
  } catch {
    /* company has no cases yet */
  }
  const cases = files
    .map((f) => {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(companyDir(s.company), f), 'utf8'));
        return { name: j.name ?? f.replace(/\.json$/, ''), savedBy: j.savedBy ?? null, savedAt: j.savedAt ?? null };
      } catch {
        return { name: f.replace(/\.json$/, ''), savedBy: null, savedAt: null };
      }
    })
    .sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  return { company: s.company, username: s.username, cases };
}

export function caseLoad(body) {
  const s = auth(body);
  if (!s) return { error: 'not signed in' };
  const name = slug(body.name);
  try {
    const j = JSON.parse(
      fs.readFileSync(path.join(companyDir(s.company), `${name}.json`), 'utf8')
    );
    return { name: j.name, savedBy: j.savedBy, savedAt: j.savedAt, case: j.case };
  } catch {
    return { error: `case "${name}" not found` };
  }
}

export function caseDelete(body) {
  const s = auth(body);
  if (!s) return { error: 'not signed in' };
  const name = slug(body.name);
  try {
    fs.unlinkSync(path.join(companyDir(s.company), `${name}.json`));
    return { ok: true };
  } catch {
    return { error: `case "${name}" not found` };
  }
}

export const accountHandlers = {
  'auth/register': register,
  'auth/login': login,
  'auth/logout': logout,
  'cases/save': caseSave,
  'cases/list': caseList,
  'cases/load': caseLoad,
  'cases/delete': caseDelete,
};
