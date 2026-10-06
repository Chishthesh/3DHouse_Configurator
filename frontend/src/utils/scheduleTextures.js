// Helpers for the texture files a schedule names.
//
// A workbook only lists texture *names* ("mosaico.jpg"). The images are uploaded
// separately, one per name, and stored by the API against the model. Once uploaded,
// the schedule's URL for that texture is rewritten from the local `/textures/<name>`
// fallback to the API's stable texture endpoint, so every consumer of the schedule —
// the configurator, the shared link, the layer renderer — loads it from the backend.

import { API_BASE } from '../api/client.js';

const LOCAL_PREFIX = '/textures/';

/** Mirrors the server's blob-name sanitising so names compare equal on both sides. */
export function safeTextureName(name) {
  return String(name).replace(/[^A-Za-z0-9._-]/g, '-');
}

export function textureApiPath(modelId, name) {
  return `/api/models/${modelId}/schedule/textures/${encodeURIComponent(safeTextureName(name))}`;
}

function eachOption(shape, fn) {
  const groups = Array.isArray(shape?.groups) ? shape.groups : Array.isArray(shape?.zones) ? shape.zones : [];
  for (const g of groups) for (const o of g.options ?? []) fn(o, g);
}

/** The bare file name a texture URL points at, or null when it isn't a local one. */
function localTextureName(url) {
  return typeof url === 'string' && url.startsWith(LOCAL_PREFIX) ? url.slice(LOCAL_PREFIX.length) : null;
}

/**
 * The schedule laid out for the upload step: one row per part with its colours and
 * the texture names it asks for, plus the de-duplicated list of names to upload.
 */
export function describeScheduleTextures(shape) {
  const rows = new Map();
  const names = new Map(); // safe name -> display name
  const labels = shape?.nodeLabels ?? {};

  eachOption(shape, (option, group) => {
    for (const node of group.match?.nodes ?? []) {
      if (!rows.has(node)) rows.set(node, { node, label: labels[node] ?? '', colours: [], textures: [] });
      const row = rows.get(node);
      if (option.color && !row.colours.includes(option.color)) row.colours.push(option.color);
      const name = localTextureName(option.texture);
      if (name) {
        if (!row.textures.includes(name)) row.textures.push(name);
        names.set(safeTextureName(name), name);
      }
    }
  });

  return { rows: [...rows.values()], textureNames: [...names.values()] };
}

/**
 * Returns a copy of the schedule in which every texture that has been uploaded
 * points at the API. Names not in `uploaded` keep their local fallback path.
 */
export function withUploadedTextures(shape, modelId, uploaded) {
  const have = new Set([...uploaded].map(safeTextureName));
  const copy = JSON.parse(JSON.stringify(shape));
  // A replaced image keeps its URL, so without a version the browser's cache and the
  // renderer's texture cache would go on showing the old one.
  const version = Date.now();
  eachOption(copy, (option) => {
    const name = localTextureName(option.texture);
    if (name && have.has(safeTextureName(name))) option.texture = `${textureApiPath(modelId, name)}?v=${version}`;
  });
  return copy;
}

/** API-served texture paths are stored host-relative; make them absolute for the browser. */
export function absolutizeTextureUrls(shape) {
  if (!shape) return shape;
  eachOption(shape, (option) => {
    if (typeof option.texture === 'string' && option.texture.startsWith('/api/')) {
      option.texture = `${API_BASE}${option.texture}`;
    }
  });
  return shape;
}
