// Extract textures that are embedded in a loaded GLB and save them to
// public/textures/<modelSlug>/ via the Vite dev-server endpoint.
//
// This only runs in development (the endpoint doesn't exist in production builds),
// and it silently skips any texture whose image can't be drawn to a canvas (e.g.
// a compressed GPU texture that hasn't been decoded to a bitmap).

/**
 * Turn a THREE.Texture into a PNG Blob via an offscreen canvas.
 * Returns null if the image is unavailable or the canvas is tainted.
 */
function textureToPngBlob(texture) {
  return new Promise((resolve) => {
    try {
      const img = texture.image;
      if (!img) return resolve(null);
      const w = img.width || img.videoWidth || 0;
      const h = img.height || img.videoHeight || 0;
      if (!w || !h) return resolve(null);

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    } catch {
      resolve(null);
    }
  });
}

/**
 * Derive a safe filename from the texture's own name, falling back to its uuid.
 * Strips characters that are unsafe in file paths and ensures a .png extension.
 */
function safeFilename(texture, index) {
  const raw = texture.name || texture.image?.name || '';
  const base = raw
    .trim()
    .replace(/\.[^.]+$/, '')           // strip any existing extension
    .replace(/[^a-zA-Z0-9_\-. ]/g, '') // keep only safe chars
    .replace(/\s+/g, '_')
    .slice(0, 80);
  return (base || `texture_${index}`) + '.png';
}

/**
 * Turn the model's filename into a safe folder name.
 * "Modern Kitchen.glb" → "modern_kitchen"
 */
export function modelSlug(modelName) {
  return (modelName || 'model')
    .replace(/\.glb$/i, '')
    .trim()
    .replace(/[^a-zA-Z0-9_\- ]/g, '')
    .replace(/\s+/g, '_')
    .toLowerCase()
    .slice(0, 60);
}

/**
 * Extract all embedded textures from `graph.textures` and POST each one to
 * the dev-server endpoint that writes it into public/textures/<slug>/.
 *
 * @param {object[]} textures  - graph.textures array from buildNodeGraph()
 * @param {string}   modelName - original filename of the .glb (e.g. "kitchen.glb")
 * @returns {Promise<{saved: string[], skipped: string[]}>}
 */
export async function extractGlbTextures(textures, modelName) {
  if (!textures?.length) return { saved: [], skipped: [] };

  const slug = modelSlug(modelName);
  const saved = [];
  const skipped = [];

  await Promise.all(
    textures.map(async (rec, index) => {
      const blob = await textureToPngBlob(rec.texture);
      if (!blob) {
        skipped.push(rec.name);
        return;
      }

      const filename = safeFilename(rec.texture, index);
      const form = new FormData();
      form.append('folder', slug);
      form.append('filename', filename);
      form.append('file', blob, filename);

      try {
        const res = await fetch('/api/save-texture', { method: 'POST', body: form });
        if (res.ok) {
          saved.push(`/textures/${slug}/${filename}`);
        } else {
          const text = await res.text();
          console.warn(`[extractGlbTextures] Server rejected ${filename}: ${text}`);
          skipped.push(filename);
        }
      } catch (err) {
        console.warn(`[extractGlbTextures] Could not reach save-texture endpoint:`, err.message);
        skipped.push(filename);
      }
    })
  );

  return { saved, skipped };
}
