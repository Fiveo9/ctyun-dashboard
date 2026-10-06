/*
 * QR Code Model 2 byte encoder, adapted from Project Nayuki.
 * Copyright (c) Project Nayuki. (MIT License)
 * https://www.nayuki.io/page/qr-code-generator-library
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 * - The above copyright notice and this permission notice shall be included in
 *   all copies or substantial portions of the Software.
 * - The Software is provided "as is", without warranty of any kind, express or
 *   implied, including but not limited to the warranties of merchantability,
 *   fitness for a particular purpose and noninfringement. In no event shall the
 *   authors or copyright holders be liable for any claim, damages or other
 *   liability, whether in an action of contract, tort or otherwise, arising from,
 *   out of or in connection with the Software or the use or other dealings in the
 *   Software.
 */
'use strict';

// UTF-8 byte mode, M error correction, versions 1–40, standard mask 0.
// All work stays in this process; the payload never goes to an image service.
const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
const NUM_BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];

function rawDataModules(version) {
  let count = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    count -= (25 * align - 10) * align - 55;
    if (version >= 7) count -= 36;
  }
  return count;
}

function gfMultiply(x, y) {
  let result = 0;
  for (let i = 7; i >= 0; i--) {
    result = (result << 1) ^ ((result >>> 7) * 0x11d);
    result ^= ((y >>> i) & 1) * x;
  }
  return result;
}

function rsDivisor(degree) {
  const result = Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 2);
  }
  return result;
}

function rsRemainder(data, divisor) {
  const result = Array(divisor.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ result.shift();
    result.push(0);
    for (let i = 0; i < divisor.length; i++) result[i] ^= gfMultiply(divisor[i], factor);
  }
  return result;
}

function interleaveCodewords(data, version) {
  const count = NUM_BLOCKS[version];
  const eccLength = ECC_PER_BLOCK[version];
  const rawWords = Math.floor(rawDataModules(version) / 8);
  const shortCount = count - rawWords % count;
  const shortLength = Math.floor(rawWords / count);
  const divisor = rsDivisor(eccLength);
  const blocks = [];
  let offset = 0;
  for (let i = 0; i < count; i++) {
    const length = shortLength - eccLength + (i < shortCount ? 0 : 1);
    const block = data.slice(offset, offset + length);
    offset += length;
    const ecc = rsRemainder(block, divisor);
    if (i < shortCount) block.push(0);
    blocks.push(block.concat(ecc));
  }
  const result = [];
  for (let i = 0; i < blocks[0].length; i++) {
    for (let j = 0; j < count; j++) {
      if (i !== shortLength - eccLength || j >= shortCount) result.push(blocks[j][i]);
    }
  }
  return result;
}

function createQrMatrix(text) {
  if (typeof text !== 'string' || !text) throw new TypeError('二维码内容不能为空');
  const bytes = Buffer.from(text, 'utf8');
  let version;
  let capacity;
  for (version = 1; version <= 40; version++) {
    capacity = Math.floor(rawDataModules(version) / 8) - ECC_PER_BLOCK[version] * NUM_BLOCKS[version];
    const countBits = version < 10 ? 8 : 16;
    if (bytes.length < 2 ** countBits && 4 + countBits + bytes.length * 8 <= capacity * 8) break;
  }
  if (version > 40) throw new RangeError('二维码内容超过最大容量');
  const bits = [];
  const append = (value, length) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  append(4, 4);
  append(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) append(byte, 8);
  append(0, Math.min(4, capacity * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  for (let pad = 0xec; bits.length < capacity * 8; pad ^= 0xec ^ 0x11) append(pad, 8);
  const data = Array(capacity).fill(0);
  bits.forEach((bit, i) => { data[i >>> 3] |= bit << (7 - (i & 7)); });
  const codewords = interleaveCodewords(data, version);

  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => Array(size).fill(false));
  const functions = Array.from({ length: size }, () => Array(size).fill(false));
  const set = (x, y, dark) => {
    modules[y][x] = !!dark;
    functions[y][x] = true;
  };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy;
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && y >= 0 && x < size && y < size) set(x, y, distance !== 2 && distance !== 4);
      }
    }
  }
  const positions = [];
  if (version > 1) {
    const count = Math.floor(version / 7) + 2;
    const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
    positions.push(6);
    for (let pos = size - 7; positions.length < count; pos -= step) positions.splice(1, 0, pos);
  }
  for (let i = 0; i < positions.length; i++) {
    for (let j = 0; j < positions.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === positions.length - 1) || (i === positions.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) set(positions[i] + dx, positions[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }
  // M level has format bits 00; mask 0 therefore has the fixed BCH word 0x5412.
  const format = 0x5412;
  const bitAt = (value, bit) => ((value >>> bit) & 1) !== 0;
  for (let i = 0; i <= 5; i++) set(8, i, bitAt(format, i));
  set(8, 7, bitAt(format, 6)); set(8, 8, bitAt(format, 7)); set(7, 8, bitAt(format, 8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bitAt(format, i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bitAt(format, i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bitAt(format, i));
  set(8, size - 8, true);
  if (version >= 7) {
    let remainder = version;
    for (let i = 0; i < 12; i++) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
    const versionBits = (version << 12) | remainder;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + i % 3, b = Math.floor(i / 3);
      set(a, b, bitAt(versionBits, i)); set(b, a, bitAt(versionBits, i));
    }
  }
  let offset = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical++) {
      const y = ((right + 1) & 2) === 0 ? size - 1 - vertical : vertical;
      for (let column = 0; column < 2; column++) {
        const x = right - column;
        if (!functions[y][x] && offset < codewords.length * 8) {
          modules[y][x] = bitAt(codewords[offset >>> 3], 7 - (offset & 7));
          offset++;
        }
      }
    }
  }
  if (offset !== codewords.length * 8) throw new Error('二维码数据布局失败');
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!functions[y][x] && (x + y) % 2 === 0) modules[y][x] = !modules[y][x];
    }
  }
  return { version, size, modules };
}

function generateQrSvgDataUrl(text) {
  const qr = createQrMatrix(text);
  const border = 4;
  const dimension = qr.size + border * 2;
  const path = [];
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.modules[y][x]) path.push(`M${x + border},${y + border}h1v1h-1z`);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 ${dimension} ${dimension}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${path.join('')}" fill="#000"/></svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64');
}

module.exports = { createQrMatrix, generateQrSvgDataUrl };
