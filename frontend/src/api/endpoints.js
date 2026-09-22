// One function per API endpoint, named after what the UI is trying to do.
// Keeping the URL strings in a single file means a route change on the backend
// is a one-line edit here rather than a search through components.

import { request, putToBlob, dataUrlToBlob } from './client.js';

// --- Auth ---------------------------------------------------------------------

export const auth = {
  login: (email, password) => request('/api/auth/login', { method: 'POST', body: { email, password }, auth: false }),
  me: () => request('/api/auth/me'),
  register: (payload) => request('/api/auth/register', { method: 'POST', body: payload }),
};

// --- Projects -----------------------------------------------------------------

export const projects = {
  list: () => request('/api/projects'),
  create: (name, description) => request('/api/projects', { method: 'POST', body: { name, description } }),
};

// --- Models -------------------------------------------------------------------

export const models = {
  list: ({ projectId, readyOnly } = {}) => {
    const q = new URLSearchParams();
    if (projectId) q.set('projectId', projectId);
    if (readyOnly) q.set('readyOnly', 'true');
    const qs = q.toString();
    return request(`/api/models${qs ? `?${qs}` : ''}`);
  },
  get: (id) => request(`/api/models/${id}`),
  create: (projectId, fileName, sizeBytes) =>
    request('/api/models', { method: 'POST', body: { projectId, fileName, sizeBytes } }),
  complete: (id, stats) => request(`/api/models/${id}/complete`, { method: 'POST', body: stats }),
  archive: (id) => request(`/api/models/${id}`, { method: 'DELETE' }),
};

/**
 * The full two-step upload: reserve the row, PUT the bytes to Blob, then report
 * what the browser parsed out of the file.
 *
 * `stats` comes from buildNodeGraph(), so the counts stored server-side are the
 * same ones the configurator shows — there is no second, divergent parser.
 */
export async function uploadModel({ projectId, file, stats, onProgress }) {
  onProgress?.('Reserving the model record…');
  const created = await models.create(projectId, file.name, file.size);

  onProgress?.(`Uploading ${(file.size / 1048576).toFixed(1)} MB to Blob Storage…`);
  await putToBlob(created.uploadUrl, file, 'model/gltf-binary');

  onProgress?.('Recording what the file contains…');
  await models.complete(created.modelId, {
    nodeCount: stats.nodeCount,
    meshCount: stats.meshCount,
    materialCount: stats.materialCount,
    textureCount: stats.textureCount,
    contentHash: null,
  });

  return created.modelId;
}

// --- Schedules ------------------------------------------------------------------

export const schedules = {
  /** The normalised option data, as stored when the workbook was attached. */
  getParsed: (modelId) => request(`/api/models/${modelId}/schedule`),
  getMeta: (modelId) => request(`/api/models/${modelId}/schedule/meta`),
  attach: (modelId, payload) => request(`/api/models/${modelId}/schedule`, { method: 'POST', body: payload }),
};

/**
 * Attaches the Configurator Parameters workbook to a model.
 *
 * The workbook is parsed here, in the browser, by the same reader the 3D
 * configurator already uses, and both the original file and the parsed result are
 * sent. The render worker then reads the parsed form without needing its own
 * .xlsx implementation, and the original stays available for audit.
 */
export async function attachSchedule({ modelId, file, shape }) {
  const groupCount = shape.groups.length;
  const optionCount = shape.optionCount ?? shape.groups.reduce((n, g) => n + g.options.length, 0);

  const res = await schedules.attach(modelId, {
    fileName: file.name,
    parsedJson: JSON.stringify(shape),
    groupCount,
    optionCount,
  });

  await putToBlob(
    res.uploadUrl,
    file,
    file.name.toLowerCase().endsWith('.xlsx')
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'application/octet-stream'
  );

  return { scheduleId: res.scheduleId, groupCount, optionCount };
}

// --- Captures ---------------------------------------------------------------------

export const captures = {
  list: (modelId, status) =>
    request(`/api/models/${modelId}/captures${status !== undefined && status !== null ? `?status=${status}` : ''}`),
  /** Everything module 2 needs to render a model: published angles with their layers. */
  views: (modelId) => request(`/api/models/${modelId}/views`),
  create: (modelId, payload) => request(`/api/models/${modelId}/captures`, { method: 'POST', body: payload }),
  update: (modelId, captureId, payload) =>
    request(`/api/models/${modelId}/captures/${captureId}`, { method: 'PATCH', body: payload }),
  remove: (modelId, captureId) => request(`/api/models/${modelId}/captures/${captureId}`, { method: 'DELETE' }),
  publish: (modelId, captureIds, generateLayers = true) =>
    request(`/api/models/${modelId}/captures/publish`, { method: 'POST', body: { captureIds, generateLayers } }),
};

/**
 * Saves one angle: reserve the capture, then PUT the full-size image and its
 * thumbnail to the two SAS URLs that come back.
 *
 * The capture is created as a Draft. Publishing is a separate, deliberate step
 * (Save All), so a capture session can be reviewed before anything reaches the
 * configurator.
 */
export async function saveCapture({ modelId, name, sortOrder, tier, dataUrl, thumbDataUrl, pose, width, height, visibleNodes, configurableNodes }) {
  const res = await captures.create(modelId, {
    name,
    sortOrder,
    width,
    height,
    tier,
    pose: {
      cameraX: pose.position[0],
      cameraY: pose.position[1],
      cameraZ: pose.position[2],
      targetX: pose.target[0],
      targetY: pose.target[1],
      targetZ: pose.target[2],
      fieldOfView: pose.fov ?? 45,
    },
    visibleNodes,
    configurableNodes,
  });

  await putToBlob(res.baseUploadUrl, dataUrlToBlob(dataUrl), 'image/png');
  await putToBlob(res.thumbnailUploadUrl, dataUrlToBlob(thumbDataUrl), 'image/png');

  return res.captureId;
}

// --- Saved configurations -----------------------------------------------------------

export const configurations = {
  list: (modelId) => request(`/api/configurations${modelId ? `?modelId=${modelId}` : ''}`),
  get: (id) => request(`/api/configurations/${id}`),
  save: (modelId, name, selections) =>
    request('/api/configurations', { method: 'POST', body: { modelId, name, selections } }),
  remove: (id) => request(`/api/configurations/${id}`, { method: 'DELETE' }),
};

// --- Enum mirrors ---------------------------------------------------------------------

export const ModelStatus = { Draft: 0, Processing: 1, Ready: 2, Archived: 3 };
export const CaptureStatus = { Draft: 0, Published: 1, Archived: 2 };
export const CaptureTier = { Full: 0, Detail: 1, Static: 2 };
export const LayerStatus = { NotRequested: 0, Queued: 1, Running: 2, Complete: 3, Failed: 4 };

export const MODEL_STATUS_LABEL = ['Draft', 'Processing', 'Ready', 'Archived'];
export const CAPTURE_STATUS_LABEL = ['Draft', 'Published', 'Archived'];
export const CAPTURE_TIER_LABEL = ['Full', 'Detail', 'Static'];
export const LAYER_STATUS_LABEL = ['Not requested', 'Queued', 'Rendering', 'Complete', 'Failed'];
