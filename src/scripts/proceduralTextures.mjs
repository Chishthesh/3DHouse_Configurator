// Procedural, tileable, near-neutral grayscale textures for the sample model.
// Kept close to white/gray (per the spec: "textures should be neutral/white-balanced
// so color tinting works naturally") so a zone's MeshStandardMaterial.color still
// tints them correctly when the configurator swaps colors.

function makeBuffer(size) {
  return new Uint8ClampedArray(size * size * 4);
}

function setPixel(buf, size, x, y, v) {
  const i = (y * size + x) * 4;
  buf[i] = v;
  buf[i + 1] = v;
  buf[i + 2] = v;
  buf[i + 3] = 255;
}

export function makePlankTexture({ size = 256, planks = 8, base = 232 } = {}) {
  const buf = makeBuffer(size);
  const plankHeight = size / planks;
  for (let y = 0; y < size; y++) {
    const plankIndex = Math.floor(y / plankHeight);
    const seamDist = y % plankHeight;
    for (let x = 0; x < size; x++) {
      let v = base;
      v += Math.sin(x / size * 40 + plankIndex * 3.1) * 6;
      v += Math.sin(x / size * 130 + plankIndex * 7.7) * 3;
      v += (Math.random() - 0.5) * 8;
      if (seamDist < 2 || seamDist > plankHeight - 3) v -= 45;
      setPixel(buf, size, x, y, Math.max(0, Math.min(255, v)));
    }
  }
  return { width: size, height: size, data: buf };
}

export function makeTileTexture({ size = 256, grid = 4, base = 238, groutBase = 190 } = {}) {
  const buf = makeBuffer(size);
  const cell = size / grid;
  for (let y = 0; y < size; y++) {
    const gy = y % cell;
    for (let x = 0; x < size; x++) {
      const gx = x % cell;
      let v = base + (Math.random() - 0.5) * 5;
      if (gx < 2 || gy < 2) v = groutBase;
      setPixel(buf, size, x, y, Math.max(0, Math.min(255, v)));
    }
  }
  return { width: size, height: size, data: buf };
}

export function makeStoneSpeckleTexture({ size = 256, base = 233 } = {}) {
  const buf = makeBuffer(size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      setPixel(buf, size, x, y, base + (Math.random() - 0.5) * 8);
    }
  }
  const speckleCount = Math.floor(size * size * 0.025);
  for (let i = 0; i < speckleCount; i++) {
    const x = Math.floor(Math.random() * size);
    const y = Math.floor(Math.random() * size);
    const dark = Math.random() < 0.5;
    const v = dark ? base - 70 - Math.random() * 40 : base + 15 + Math.random() * 10;
    setPixel(buf, size, x, y, Math.max(0, Math.min(255, v)));
  }
  for (let i = 0; i < 5; i++) {
    let x = Math.random() * size;
    const dx = (Math.random() - 0.5) * 1.6;
    for (let y = 0; y < size; y++) {
      const xi = ((Math.floor(x) % size) + size) % size;
      setPixel(buf, size, xi, y, base - 28);
      x += dx;
    }
  }
  return { width: size, height: size, data: buf };
}

export function makeFabricNoiseTexture({ size = 128, base = 236 } = {}) {
  const buf = makeBuffer(size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      setPixel(buf, size, x, y, base + (Math.random() - 0.5) * 16);
    }
  }
  return { width: size, height: size, data: buf };
}

export function makeBrushedMetalTexture({ size = 256, base = 222 } = {}) {
  const buf = makeBuffer(size);
  for (let y = 0; y < size; y++) {
    const rowVal = base + (Math.random() - 0.5) * 10;
    for (let x = 0; x < size; x++) {
      setPixel(buf, size, x, y, rowVal + (Math.random() - 0.5) * 5);
    }
  }
  return { width: size, height: size, data: buf };
}

export function makeSidingTexture({ size = 256, lines = 12, base = 235 } = {}) {
  const buf = makeBuffer(size);
  const lineHeight = size / lines;
  for (let y = 0; y < size; y++) {
    const seamDist = y % lineHeight;
    for (let x = 0; x < size; x++) {
      let v = base + (Math.random() - 0.5) * 4;
      if (seamDist < 2) v -= 45;
      setPixel(buf, size, x, y, Math.max(0, Math.min(255, v)));
    }
  }
  return { width: size, height: size, data: buf };
}
