// Zero the PE Authenticode security-directory entry of an exe.
// After postject injects the SEA blob into node.exe, the original
// certificate-table pointer is stale and blocks re-signing — Node's own SEA
// docs call for removing the signature; this does it without signtool.
// Usage: node portable/strip-signature.js <path-to-exe>
import fs from 'node:fs';

const file = process.argv[2];
const buf = fs.readFileSync(file);
const peOff = buf.readUInt32LE(0x3c);
if (buf.readUInt32LE(peOff) !== 0x00004550) throw new Error('not a PE file');
const optOff = peOff + 24;
const magic = buf.readUInt16LE(optOff);
if (magic !== 0x20b && magic !== 0x10b) throw new Error(`unknown optional header magic 0x${magic.toString(16)}`);
// DataDirectory offset: PE32+ = OptionalHeader+112, PE32 = +96; Security = index 4
const ddOff = optOff + (magic === 0x20b ? 112 : 96) + 4 * 8;
const certOff = buf.readUInt32LE(ddOff);
const certSize = buf.readUInt32LE(ddOff + 4);
if (certOff === 0 && certSize === 0) {
  console.log('no security directory — nothing to strip');
} else {
  buf.writeUInt32LE(0, ddOff);
  buf.writeUInt32LE(0, ddOff + 4);
  // if the certificate blob sits at the end of the file, drop it entirely
  const out = certOff + certSize === buf.length ? buf.subarray(0, certOff) : buf;
  fs.writeFileSync(file, out);
  console.log(`stripped security directory (offset ${certOff}, ${certSize} bytes${certOff + certSize === buf.length ? ', truncated' : ', entry zeroed'})`);
}
