// Dependency-free PNG writer for the KITT icon: charcoal square, cyan scanner bar, white lead segment (radius 0).
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };

function png(size) {
  const px = Buffer.alloc(size * size * 4);
  const fill = (x0, y0, x1, y1, [r, g, b]) => { for (let y = Math.round(y0 * size); y < Math.round(y1 * size); y++) for (let x = Math.round(x0 * size); x < Math.round(x1 * size); x++) { const i = (y * size + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255; } };
  fill(0, 0, 1, 1, [0x3a, 0x3a, 0x3a]);
  fill(10 / 64, 29 / 64, 54 / 64, 35 / 64, [0x00, 0xbc, 0xd4]);
  fill(10 / 64, 29 / 64, 24 / 64, 35 / 64, [0xff, 0xff, 0xff]);
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
for (const [name, size] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) { writeFileSync(new URL(`../public/${name}`, import.meta.url), png(size)); console.log('wrote', name, size); }
