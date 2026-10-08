// Makes a GLB self-contained: every image referenced by an external `uri` is appended to the
// binary chunk and referenced by bufferView instead. Kenney kits ship textures beside the GLB.
//   node tools/embed-textures.ts <in.glb> <texture-dir> <out.glb>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [inPath, texDir, outPath] = process.argv.slice(2);
if (!inPath || !texDir || !outPath) throw new Error('usage: embed-textures.ts <in.glb> <texture-dir> <out.glb>');

const glb = readFileSync(inPath);
if (glb.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
const jsonLen = glb.readUInt32LE(12);
const json = JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf8'));
let bin: Buffer = Buffer.alloc(0);
if (glb.length > 20 + jsonLen) {
  const binLen = glb.readUInt32LE(20 + jsonLen);
  bin = Buffer.from(glb.subarray(28 + jsonLen, 28 + jsonLen + binLen));
}

const pad4 = (b: Buffer, fill: number): Buffer => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4), fill)]) : b);
let embedded = 0;
for (const image of json.images ?? []) {
  if (!image.uri || image.uri.startsWith('data:')) continue;
  const bytes = readFileSync(join(texDir, image.uri.split('/').pop()));
  bin = pad4(bin, 0);
  json.bufferViews.push({ buffer: 0, byteOffset: bin.length, byteLength: bytes.length });
  image.bufferView = json.bufferViews.length - 1;
  image.mimeType = image.uri.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
  delete image.uri;
  bin = Buffer.concat([bin, bytes]);
  embedded++;
}
bin = pad4(bin, 0);
json.buffers[0].byteLength = bin.length;

const jsonBuf = pad4(Buffer.from(JSON.stringify(json), 'utf8'), 0x20);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
const chunk = (len: number, type: number) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
writeFileSync(outPath, Buffer.concat([header, chunk(jsonBuf.length, 0x4e4f534a), jsonBuf, chunk(bin.length, 0x004e4942), bin]));
console.log(`${outPath}: embedded ${embedded} texture(s)`);
