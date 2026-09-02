// Explicit operational check, not part of the application or normal test suite.
// Never prints keys, decrypted content, or child-process stderr.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [age, keygen, archive, identity, privateParent] = process.argv.slice(2);
assert.ok([age, keygen, archive, identity, privateParent].every((p) => p && path.isAbsolute(p)),
  'Provide absolute age, keygen, archive, identity and private scratch parent paths');
const parent = await fs.realpath(privateParent);
const scratch = await fs.mkdtemp(path.join(parent, 'encryption-check-'));
const run = (binary, args) => {
  const result = spawnSync(binary, args, { stdio: 'ignore', timeout: 120_000 });
  if (result.error) throw new Error('Encryption check could not run the required tool');
  assert.equal(result.signal, null, 'Encryption tool was interrupted');
  return result.status;
};
try {
  const wrongKey = path.join(scratch, 'wrong-identity.txt');
  assert.equal(run(keygen, ['-o', wrongKey]), 0);
  assert.notEqual(run(age, ['--decrypt', '-i', wrongKey, '-o', path.join(scratch, 'wrong.dump'), archive]), 0);
  const altered = path.join(scratch, 'altered.dump.age');
  await fs.copyFile(archive, altered);
  const file = await fs.open(altered, 'r+');
  try {
    const { size } = await file.stat();
    assert.ok(size > 0);
    const byte = Buffer.alloc(1);
    await file.read(byte, 0, 1, size - 1);
    byte[0] ^= 1;
    await file.write(byte, 0, 1, size - 1);
  } finally { await file.close(); }
  assert.notEqual(run(age, ['--decrypt', '-i', identity, '-o', path.join(scratch, 'altered.dump'), altered]), 0);
  console.log('BACKUP_WRONG_KEY_AND_TAMPER_REJECTION_OK');
} finally {
  const resolved = await fs.realpath(scratch);
  assert.equal(path.dirname(resolved), parent);
  assert.ok(path.basename(resolved).startsWith('encryption-check-'));
  await fs.rm(resolved, { recursive: true });
}
