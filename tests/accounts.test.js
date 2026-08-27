// Server case database — company accounts, auth, and per-company isolation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// isolate the data dir BEFORE the module loads
process.env.WELLSIM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wellsim-acct-'));
const {
  register, login, logout, caseSave, caseList, caseLoad, caseDelete,
} = await import('../src/server/accounts.js');

const CASE = { app: 'WellSim', version: 1, inputs: { 'oil-thpPsi': '700' }, radios: {}, grids: {} };

test('register + login + wrong password', () => {
  const r = register({ company: 'Acme Oil', username: 'Ali', password: 'secret7' });
  assert.ok(!r.error, r.error);
  assert.equal(r.company, 'acme-oil'); // slugged
  assert.equal(r.username, 'ali');
  assert.ok(r.token);
  assert.ok(/already exists/.test(register({ company: 'acme-oil', username: 'ali', password: 'x1234' }).error));
  assert.ok(/wrong username or password/.test(login({ username: 'ali', password: 'nope' }).error));
  const l = login({ username: 'ali', password: 'secret7' });
  assert.ok(l.token && l.token !== r.token);
});

test('save / list / load / delete a case; auth required', () => {
  const { token } = login({ username: 'ali', password: 'secret7' });
  assert.ok(/not signed in/.test(caseSave({ token: 'bad', name: 'x', case: CASE }).error));
  assert.ok(/not a WellSim case/.test(caseSave({ token, name: 'x', case: { foo: 1 } }).error));
  const s = caseSave({ token, name: 'Well A-1 match', case: CASE });
  assert.ok(!s.error, s.error);
  assert.equal(s.name, 'well-a-1-match');
  const list = caseList({ token });
  assert.equal(list.cases.length, 1);
  assert.equal(list.cases[0].savedBy, 'ali');
  const loaded = caseLoad({ token, name: 'well-a-1-match' });
  assert.deepEqual(loaded.case, CASE);
  assert.ok(/not found/.test(caseLoad({ token, name: 'nope' }).error));
  assert.ok(caseDelete({ token, name: 'well-a-1-match' }).ok);
  assert.equal(caseList({ token }).cases.length, 0);
});

test('login throttle: 5 failures lock the username for the window', () => {
  register({ company: 'Gamma Co', username: 'carol', password: 'goodpw1' });
  for (let i = 0; i < 5; i++) {
    assert.ok(/wrong username or password/.test(login({ username: 'carol', password: 'bad' }).error));
  }
  // 6th attempt (even with the RIGHT password) is throttled
  assert.ok(/too many failed attempts/.test(login({ username: 'carol', password: 'goodpw1' }).error));
  // other usernames are unaffected
  assert.ok(login({ username: 'ali', password: 'secret7' }).token);
});

test('invite word gates registration when WELLSIM_INVITE is set', () => {
  process.env.WELLSIM_INVITE = 'drillbit';
  try {
    assert.ok(/invite word/.test(register({ company: 'X', username: 'noinv', password: 'pass1' }).error));
    assert.ok(register({ company: 'X', username: 'withinv', password: 'pass1', invite: 'drillbit' }).token);
  } finally {
    delete process.env.WELLSIM_INVITE;
  }
});

test('cases are isolated per company; logout kills the token', () => {
  const a = login({ username: 'ali', password: 'secret7' });
  caseSave({ token: a.token, name: 'acme-secret', case: CASE });
  const b = register({ company: 'Beta Energy', username: 'bob', password: 'pass99' });
  const bl = caseList({ token: b.token });
  assert.equal(bl.company, 'beta-energy');
  assert.equal(bl.cases.length, 0, 'Beta must not see Acme cases');
  assert.ok(/not found/.test(caseLoad({ token: b.token, name: 'acme-secret' }).error));
  logout({ token: a.token });
  assert.ok(/not signed in/.test(caseList({ token: a.token }).error));
});
