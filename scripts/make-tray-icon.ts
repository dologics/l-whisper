// Generates the menu bar (tray) waveform icon as macOS "template" PNGs.
// Template images = black shape + transparency; macOS recolors them for light/dark mode.
// Run: npx tsx scripts/make-tray-icon.ts
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// Draw a sound waveform (5 rounded vertical bars) on a 0..1 grid; returns alpha 0..1.
// Deliberately NOT a microphone, so it isn't confused with macOS's mic-in-use indicator.
const BARS = [
  { x: 0.14, h: 0.3 },
  { x: 0.32, h: 0.62 },
  { x: 0.5, h: 0.86 },
  { x: 0.68, h: 0.5 },
  { x: 0.86, h: 0.24 },
];
const BAR_HALF_WIDTH = 0.065;

function shapeAlpha(x: number, y: number): number {
  for (const bar of BARS) {
    // A bar = vertical capsule (rounded ends) centred at y = 0.5.
    const top = 0.5 - bar.h / 2 + BAR_HALF_WIDTH;
    const bottom = 0.5 + bar.h / 2 - BAR_HALF_WIDTH;
    const cy = Math.min(Math.max(y, top), bottom);
    if (Math.hypot(x - bar.x, y - cy) <= BAR_HALF_WIDTH) return 1;
  }
  return 0;
}

function makePng(size: number): Buffer {
  const SS = 4; // supersampling for smooth edges
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0; // PNG filter type: none
    for (let px = 0; px < size; px++) {
      let a = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) a += shapeAlpha((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size);
      const o = py * (size * 4 + 1) + 1 + px * 4;
      raw[o] = raw[o + 1] = raw[o + 2] = 0; // black
      raw[o + 3] = Math.round((a / (SS * SS)) * 255);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'trayTemplate.png'), makePng(18));
fs.writeFileSync(path.join(outDir, 'trayTemplate@2x.png'), makePng(36));
console.log('Wrote assets/trayTemplate.png and assets/trayTemplate@2x.png');
