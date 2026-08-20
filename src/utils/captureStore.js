// Minimal IndexedDB-backed store for "Saved Captures" — PNG snapshots tagged with the
// mesh/zone group name they were taken of, plus enough context (camera pose, material
// choice) to reopen and re-edit them later and save follow-up versions for comparison.

const DB_NAME = 'house-configurator';
const DB_VERSION = 1;
const STORE = 'captures';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('groupId', 'groupId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const result = fn(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listCaptures() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result.sort((a, b) => a.groupId.localeCompare(b.groupId) || a.version - b.version));
    req.onerror = () => reject(req.error);
  });
}

export async function nextVersionFor(groupId) {
  const all = await listCaptures();
  const versions = all.filter((c) => c.groupId === groupId).map((c) => c.version);
  return versions.length ? Math.max(...versions) + 1 : 0;
}

export async function addCapture({ groupId, zoneKey, zoneLabel, roomLabel, materialChoice, cameraPosition, cameraTarget, dataUrl }) {
  const version = await nextVersionFor(groupId);
  const record = {
    groupId,
    version,
    displayName: version === 0 ? groupId : `${groupId}_${version}`,
    zoneKey,
    zoneLabel,
    roomLabel,
    materialChoice,
    cameraPosition,
    cameraTarget,
    dataUrl,
    createdAt: Date.now(),
  };
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.add(record);
    req.onsuccess = () => resolve({ ...record, id: req.result });
    req.onerror = () => reject(req.error);
  });
}

export async function deleteCapture(id) {
  return withStore('readwrite', (store) => store.delete(id));
}

export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
