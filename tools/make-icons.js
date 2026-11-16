// Erzeugt app/icon-192.png und app/icon-512.png (Unihockeyball auf blauem Grund) ohne externe Abhängigkeiten.
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = b => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
function png(n) {
  const raw = Buffer.alloc(n * (n * 3 + 1)), holes = [[0, 0], [0.42, 0], [-0.42, 0], [0.21, 0.37], [-0.21, 0.37], [0.21, -0.37], [-0.21, -0.37]];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let cov = 0, hc = 0;
    for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) {
      const u = ((x + (sx + .5) / 3) / n - .5) * 2, v = ((y + (sy + .5) / 3) / n - .5) * 2;
      if (u * u + v * v < 0.56 * 0.56) { cov++; if (holes.some(([hx, hy]) => (u - hx * .9) ** 2 + (v - hy * .9) ** 2 < 0.085 ** 2)) hc++; }
    }
    const a = (cov - hc) / 9, o = y * (n * 3 + 1) + 1 + x * 3;
    raw[o] = Math.round(10 + (255 - 10) * a); raw[o + 1] = Math.round(95 + (255 - 95) * a); raw[o + 2] = Math.round(180 + (255 - 180) * a);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
for (const n of [192, 512]) fs.writeFileSync(path.join(__dirname, '..', 'app', `icon-${n}.png`), png(n));
console.log('Icons geschrieben');
