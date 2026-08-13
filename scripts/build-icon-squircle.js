'use strict';

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'build', 'icon-square-backup.png');
const pngPath = path.join(root, 'build', 'icon.png');
const icoPath = path.join(root, 'build', 'icon.ico');
const source = PNG.sync.read(fs.readFileSync(sourcePath));

function squircleAlpha(x, y, width, height) {
  const nx = Math.abs((x + 0.5 - width / 2) / (width * 0.482));
  const ny = Math.abs((y + 0.5 - height / 2) / (height * 0.482));
  const distance = Math.pow(Math.pow(nx, 4) + Math.pow(ny, 4), 0.25);
  return Math.max(0, Math.min(1, (1 - distance) / 0.008));
}

function resizeAndMask(size) {
  const output = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y++) {
    const sy = Math.min(source.height - 1, Math.round((y + 0.5) * source.height / size - 0.5));
    for (let x = 0; x < size; x++) {
      const sx = Math.min(source.width - 1, Math.round((x + 0.5) * source.width / size - 0.5));
      const src = (sy * source.width + sx) * 4;
      const dst = (y * size + x) * 4;
      output.data[dst] = source.data[src];
      output.data[dst + 1] = source.data[src + 1];
      output.data[dst + 2] = source.data[src + 2];
      output.data[dst + 3] = Math.round(source.data[src + 3] * squircleAlpha(x, y, size, size));
    }
  }
  return PNG.sync.write(output, { colorType: 6 });
}

const largePng = resizeAndMask(1024);
const iconPng = resizeAndMask(256);
fs.writeFileSync(pngPath, largePng);

// Modern Windows accepts a PNG-compressed 256px image inside an ICO container.
const header = Buffer.alloc(6 + 16);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header[6] = 0;
header[7] = 0;
header[8] = 0;
header[9] = 0;
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(iconPng.length, 14);
header.writeUInt32LE(header.length, 18);
fs.writeFileSync(icoPath, Buffer.concat([header, iconPng]));
console.log(`Generated squircle icon: ${largePng.length} bytes PNG, ${iconPng.length} bytes ICO payload`);
