// Vite dev-server plugin that handles POST /api/save-texture.
//
// The browser sends a multipart/form-data body with three fields:
//   folder    - subfolder name under public/textures/ (derived from the .glb filename)
//   filename  - safe PNG filename for this texture
//   file      - the PNG blob
//
// The plugin writes the file to <projectRoot>/public/textures/<folder>/<filename>.
// It does nothing in production (vite build never starts a dev server).

import fs from 'node:fs';
import path from 'node:path';

/**
 * Parse a multipart/form-data body without any external dependency.
 * Returns a Map of field name → { filename?, data: Buffer }.
 */
function parseMultipart(buffer, boundary) {
  const fields = new Map();
  const sep = Buffer.from(`--${boundary}`);
  const parts = [];

  let start = 0;
  while (start < buffer.length) {
    const idx = buffer.indexOf(sep, start);
    if (idx === -1) break;
    const end = buffer.indexOf(sep, idx + sep.length);
    const chunk = end === -1 ? buffer.slice(idx + sep.length) : buffer.slice(idx + sep.length, end);
    parts.push(chunk);
    start = idx + sep.length;
    if (end === -1) break;
  }

  for (const part of parts) {
    // Each part: \r\n<headers>\r\n\r\n<body>
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headerText = part.slice(0, headerEnd).toString('utf8');
    // strip leading \r\n
    const body = part.slice(headerEnd + 4);
    // strip trailing \r\n--
    const bodyData = body[body.length - 2] === 0x0d && body[body.length - 1] === 0x0a
      ? body.slice(0, -2)
      : body;

    const nameMatch = headerText.match(/name="([^"]+)"/);
    const filenameMatch = headerText.match(/filename="([^"]+)"/);
    if (!nameMatch) continue;
    fields.set(nameMatch[1], {
      filename: filenameMatch?.[1] ?? null,
      data: bodyData,
    });
  }
  return fields;
}

export default function saveTexturePlugin() {
  return {
    name: 'save-texture',
    apply: 'serve', // dev server only
    configureServer(server) {
      server.middlewares.use('/api/save-texture', (req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405);
          res.end('Method Not Allowed');
          return;
        }

        const contentType = req.headers['content-type'] ?? '';
        const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
        if (!boundaryMatch) {
          res.writeHead(400);
          res.end('Missing boundary');
          return;
        }
        const boundary = boundaryMatch[1];

        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
          try {
            const body = Buffer.concat(chunks);
            const fields = parseMultipart(body, boundary);

            const folder = fields.get('folder')?.data.toString('utf8').trim();
            const filename = fields.get('filename')?.data.toString('utf8').trim();
            const fileField = fields.get('file');

            if (!folder || !filename || !fileField?.data) {
              res.writeHead(400);
              res.end('Missing folder, filename, or file');
              return;
            }

            // Safety: strip anything that could escape the target directory.
            const safeFolder = path.basename(folder);
            const safeFile = path.basename(filename);

            const destDir = path.resolve('public', 'textures', safeFolder);
            fs.mkdirSync(destDir, { recursive: true });

            const destPath = path.join(destDir, safeFile);
            fs.writeFileSync(destPath, fileField.data);

            console.log(`[save-texture] Saved ${safeFile} → public/textures/${safeFolder}/`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ path: `/textures/${safeFolder}/${safeFile}` }));
          } catch (err) {
            console.error('[save-texture] Error:', err);
            res.writeHead(500);
            res.end(err.message);
          }
        });

        req.on('error', (err) => {
          res.writeHead(500);
          res.end(err.message);
        });
      });
    },
  };
}
