#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const zlib = require('node:zlib');

const [file, minimumText = '1'] = process.argv.slice(2);
const minimum = Number(minimumText);
if (!file || !Number.isFinite(minimum) || minimum < 1) {
  throw new Error('Usage: node qa/check-png-nonblank.cjs <png-file> <minimum-non-white-pixels>');
}

const source = fs.readFileSync(file);
const signature = '89504e470d0a1a0a';
if (source.subarray(0, 8).toString('hex') !== signature) throw new Error('Expected a PNG file.');

let cursor = 8;
let width = 0;
let height = 0;
let bitDepth = 0;
let colorType = 0;
const idat = [];
while (cursor < source.length) {
  const length = source.readUInt32BE(cursor); cursor += 4;
  const type = source.subarray(cursor, cursor + 4).toString('ascii'); cursor += 4;
  const data = source.subarray(cursor, cursor + length); cursor += length + 4;
  if (type === 'IHDR') {
    width = data.readUInt32BE(0);
    height = data.readUInt32BE(4);
    bitDepth = data[8];
    colorType = data[9];
  } else if (type === 'IDAT') idat.push(data);
  else if (type === 'IEND') break;
}

const bytesPerPixel = ({ 0: 1, 2: 3, 4: 2, 6: 4 })[colorType];
if (!width || !height || bitDepth !== 8 || !bytesPerPixel) throw new Error('Unsupported PNG format for visual QA.');
const rowBytes = width * bytesPerPixel;
const decoded = zlib.inflateSync(Buffer.concat(idat));
const previous = Buffer.alloc(rowBytes);
const row = Buffer.alloc(rowBytes);
let offset = 0;
let nonWhite = 0;
let minX = width;
let minY = height;
let maxX = -1;
let maxY = -1;

for (let y = 0; y < height; y += 1) {
  const filter = decoded[offset++];
  const encoded = decoded.subarray(offset, offset + rowBytes); offset += rowBytes;
  for (let x = 0; x < rowBytes; x += 1) {
    const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
    const up = previous[x];
    const upLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] : 0;
    const value = encoded[x];
    if (filter === 0) row[x] = value;
    else if (filter === 1) row[x] = (value + left) & 255;
    else if (filter === 2) row[x] = (value + up) & 255;
    else if (filter === 3) row[x] = (value + Math.floor((left + up) / 2)) & 255;
    else if (filter === 4) {
      const p = left + up - upLeft;
      const pa = Math.abs(p - left); const pb = Math.abs(p - up); const pc = Math.abs(p - upLeft);
      row[x] = (value + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)) & 255;
    } else throw new Error(`Unsupported PNG filter ${filter}.`);
  }
  for (let x = 0; x < width; x += 1) {
    const index = x * bytesPerPixel;
    const red = row[index]; const green = bytesPerPixel > 1 ? row[index + 1] : red; const blue = bytesPerPixel > 2 ? row[index + 2] : red;
    if (red < 245 || green < 245 || blue < 245) {
      nonWhite += 1;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
  }
  row.copy(previous);
}

if (nonWhite < minimum) throw new Error(`Rendered PDF page is effectively blank: ${nonWhite} non-white pixels.`);
console.log(`PNG visual QA PASS: ${nonWhite} non-white pixels at ${minX},${minY}-${maxX},${maxY}`);
