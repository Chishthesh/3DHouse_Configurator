// IndexedDB-backed store for "Saved Captures".
//
// A saved capture is a snapshot image PLUS the configuration that produced it (which
// finish was applied to which node, the camera pose, the running total). Storing the
// configuration is what lets a saved capture be re-opened and re-applied later
// instead of being just a picture.

const DB_NAME = 'house-configurator';
const DB_VERSION = 2;
const STORE = 'captures';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      const store = db.objectStoreNames.contains(STORE)
        ? req.transaction.objectStore(STORE)
        : db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      if (!store.indexNames.contains('groupId')) store.createIndex('groupId', 'groupId', { unique: false });
      // v2 adds per-model grouping so captures from different uploads stay separable.
      if (!store.indexNames.contains('modelKey')) store.createIndex('modelKey', 'modelKey', { unique: false });
      void event;
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Saved Captures database is blocked by another open tab.'));
  });
}

export async function listCaptures() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () =>
      resolve(
        req.result.sort(
          (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || String(a.groupId).localeCompare(String(b.groupId))
        )
      );
    req.onerror = () => reject(req.error);
  });
}

export async function nextVersionFor(groupId) {
  const all = await listCaptures();
  const versions = all.filter((c) => c.groupId === groupId).map((c) => c.version ?? 0);
  return versions.length ? Math.max(...versions) + 1 : 0;
}

export async function addCapture({
  groupId,
  title,
  modelKey,
  modelName,
  libraryName,
  focusNodeName,
  focusNodeLabel,
  config,
  totalPrice,
  cameraPosition,
  cameraTarget,
  dataUrl,
  thumbUrl,
  note,
}) {
  const version = await nextVersionFor(groupId);
  const record = {
    groupId,
    version,
    displayName: version === 0 ? title || groupId : `${title || groupId} · v${version + 1}`,
    title: title || groupId,
    modelKey: modelKey ?? 'unknown-model',
    modelName: modelName ?? null,
    libraryName: libraryName ?? null,
    focusNodeName: focusNodeName ?? null,
    focusNodeLabel: focusNodeLabel ?? null,
    config: config ?? [],
    totalPrice: totalPrice ?? 0,
    cameraPosition: cameraPosition ?? null,
    cameraTarget: cameraTarget ?? null,
    dataUrl,
    thumbUrl: thumbUrl ?? dataUrl,
    note: note ?? null,
    createdAt: Date.now(),
  };
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).add(record);
    req.onsuccess = () => resolve({ ...record, id: req.result });
    req.onerror = () => reject(req.error);
  });
}

export async function deleteCapture(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

export async function renameCapture(id, title) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const rec = getReq.result;
      if (!rec) {
        resolve(false);
        return;
      }
      rec.title = title;
      rec.displayName = rec.version === 0 ? title : `${title} · v${rec.version + 1}`;
      const putReq = store.put(rec);
      putReq.onsuccess = () => resolve(true);
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

export function slugify(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'capture';
}

/** Downscaled JPEG for the captures grid, so the gallery stays fast. */
export function makeThumbnail(dataUrl, maxSize = 480) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}
