/**
 * Configures the local Azurite blob service for browser uploads.
 *
 * The browser PUTs .glb files and capture images straight to Blob Storage using a
 * SAS URL, so the storage service — not the API — is the origin being called. That
 * request is cross-origin, and a storage account with no CORS rules rejects the
 * preflight. Real Azure needs the same rules set once per storage account; this is
 * the local equivalent.
 *
 * Written against the REST API with Node's own crypto and http modules so it needs
 * no npm install, matching the rest of this repo (the .xlsx reader has no
 * dependency either). Run it after starting Azurite:
 *
 *   node backend/tools/azurite-setup.mjs
 *
 * Safe to re-run: setting the properties again simply overwrites the same rules.
 */
import crypto from 'node:crypto';
import http from 'node:http';

// Azurite's well-known development account. These are published credentials for a
// local emulator, not a secret — the same pair appears in Microsoft's own docs.
const ACCOUNT = 'devstoreaccount1';
const KEY = 'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==';
const HOST = '127.0.0.1';
const PORT = 10000;
const API_VERSION = '2021-08-06';

const CORS_XML = `<?xml version="1.0" encoding="utf-8"?>
<StorageServiceProperties>
  <Cors>
    <CorsRule>
      <AllowedOrigins>*</AllowedOrigins>
      <AllowedMethods>GET,HEAD,PUT,OPTIONS</AllowedMethods>
      <AllowedHeaders>*</AllowedHeaders>
      <ExposedHeaders>*</ExposedHeaders>
      <MaxAgeInSeconds>3600</MaxAgeInSeconds>
    </CorsRule>
  </Cors>
</StorageServiceProperties>`;

/**
 * Shared Key signature.
 *
 * The canonicalized resource is the emulator's one real trap: the account name
 * appears both as the signing prefix and as the first path segment, so it is
 * "/devstoreaccount1/devstoreaccount1" here where a real account would give
 * "/myaccount/". Getting that wrong returns 403 with no hint as to why.
 */
function sign({ method, path, query, headers, contentLength }) {
  const canonicalHeaders = Object.keys(headers)
    .filter((h) => h.toLowerCase().startsWith('x-ms-'))
    .map((h) => h.toLowerCase())
    .sort()
    .map((h) => `${h}:${headers[Object.keys(headers).find((k) => k.toLowerCase() === h)]}`)
    .join('\n');

  const canonicalResource =
    `/${ACCOUNT}${path}` +
    Object.keys(query)
      .sort()
      .map((k) => `\n${k}:${query[k]}`)
      .join('');

  const stringToSign = [
    method,
    '', // Content-Encoding
    '', // Content-Language
    contentLength > 0 ? String(contentLength) : '',
    '', // Content-MD5
    headers['Content-Type'] ?? '',
    '', // Date (x-ms-date is used instead)
    '', // If-Modified-Since
    '', // If-Match
    '', // If-None-Match
    '', // If-Unmodified-Since
    '', // Range
    canonicalHeaders,
    canonicalResource,
  ].join('\n');

  const signature = crypto.createHmac('sha256', Buffer.from(KEY, 'base64')).update(stringToSign, 'utf8').digest('base64');
  return `SharedKey ${ACCOUNT}:${signature}`;
}

function send({ method, body }) {
  const path = `/${ACCOUNT}`;
  const query = { restype: 'service', comp: 'properties' };
  const contentLength = body ? Buffer.byteLength(body) : 0;

  const headers = {
    'x-ms-date': new Date().toUTCString(),
    'x-ms-version': API_VERSION,
  };
  if (body) {
    headers['Content-Type'] = 'application/xml';
    headers['Content-Length'] = contentLength;
  }
  headers.Authorization = sign({ method, path, query, headers, contentLength });

  const search = new URLSearchParams(query).toString();

  return new Promise((resolve, reject) => {
    const req = http.request({ host: HOST, port: PORT, method, path: `${path}?${search}`, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

try {
  const put = await send({ method: 'PUT', body: CORS_XML });
  if (put.status !== 202) {
    console.error(`Setting CORS failed: HTTP ${put.status}\n${put.body}`);
    process.exit(1);
  }
  console.log('CORS rules applied to the Azurite blob service.');

  const check = await send({ method: 'GET' });
  const rule = /<CorsRule>[\s\S]*?<\/CorsRule>/.exec(check.body);
  console.log(rule ? `Verified:\n${rule[0].replace(/\s+</g, '\n  <')}` : 'Warning: read back no CORS rule.');
} catch (err) {
  console.error(
    `Could not reach Azurite at http://${HOST}:${PORT}. Start it first, then run this again.\n${err.message}`
  );
  process.exit(1);
}
