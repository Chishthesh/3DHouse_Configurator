// Minimal, dependency-free PNG encoder (8-bit RGBA, no interlace) built on Node's
// built-in zlib. Used so the model generator can embed real textures in the GLB
// without a canvas library (Node has neither DOM canvas nor OffscreenCanvas).
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

export function encodePNG(width, height, rgba) {
  const bytesPerRow = width * 4;
  const raw = Buffer.alloc(height * (1 + bytesPerRow));
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + bytesPerRow);
    raw[rowOffset] = 0; // filter type: None
    for (let x = 0; x < bytesPerRow; x++) {
      raw[rowOffset + 1 + x] = rgba[y * bytesPerRow + x];
    }
  }

  const idatData = zlib.deflateSync(raw, { level: 9 });

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type: RGBA
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdrData),
    chunk('IDAT', idatData),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
