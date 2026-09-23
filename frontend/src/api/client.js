// Thin transport layer over the Configurator API.
//
// Two things here are deliberate:
//   * Large binaries never travel through the API. Endpoints hand back a SAS URL
//     and the browser PUTs straight to Blob Storage, so a 6 MB .glb or a 2,000-image
//     layer set doesn't occupy an API connection.
//   * Errors are normalised into one ApiError shape. The API returns ProblemDetails
//     in some places and { message } in others; the UI should not have to care.

const TOKEN_KEY = 'uh.auth.token';
const USER_KEY = 'uh.auth.user';

// The API's plain-HTTP port, on whatever host the page itself was opened from.
//
// Following window.location.hostname matters: 127.0.0.1 and localhost are separate
// origins to a browser, so opening the app at one and calling the API at the other
// turns every request into a cross-origin request that CORS then rejects.
//
// Port 7280 is deliberately not the default. It is the HTTPS endpoint — reaching it
// over http:// fails outright, and over https:// it needs the ASP.NET development
// certificate trusted first (dotnet dev-certs https --trust). Set VITE_API_BASE to
// https://localhost:7280 once that is done, or to the real host when deploying.
const devDefault =
  typeof window !== 'undefined'
    ? `http://${window.location.hostname || 'localhost'}:5280`
    : 'http://localhost:5280';

export const API_BASE = (import.meta.env?.VITE_API_BASE ?? devDefault).replace(/\/$/, '');

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }

  /** True when the API is reachable but Azure Blob Storage has not been configured. */
  get isStorageUnconfigured() {
    return /blob storage is not configured/i.test(this.message);
  }
}

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setSession(token, user) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* private mode — the session simply won't survive a reload */
  }
}

export function getStoredUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    /* nothing to clear */
  }
}

// Set by AuthContext so a 401 anywhere drops the session instead of leaving the
// user staring at a page that silently fails to load.
let onUnauthorized = null;
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

async function readError(response) {
  const text = await response.text().catch(() => '');
  if (!text) return new ApiError(`${response.status} ${response.statusText}`, response.status);

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return new ApiError(text.slice(0, 400), response.status);
  }

  // ASP.NET validation problems arrive as { errors: { Field: ["msg"] } }.
  if (body?.errors && typeof body.errors === 'object') {
    const flat = Object.entries(body.errors)
      .map(([field, msgs]) => `${field}: ${[].concat(msgs).join(', ')}`)
      .join(' · ');
    return new ApiError(flat || body.title || 'Validation failed', response.status, body);
  }

  const message = body?.message ?? body?.detail ?? body?.title ?? `${response.status} ${response.statusText}`;
  return new ApiError(message, response.status, body);
}

export async function request(path, { method = 'GET', body, auth = true, raw = false, signal } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    // fetch() rejects with a bare "Failed to fetch" for a dead server, a CORS
    // rejection and an untrusted certificate alike — none of which tells the
    // user what to do next.
    throw new ApiError(
      `Cannot reach the API at ${API_BASE}. Start the backend (dotnet run --project backend/src/Configurator.Api) and check that this origin is allowed by CORS.`,
      0
    );
  }

  if (response.status === 401 && auth) {
    onUnauthorized?.();
    throw new ApiError('Your session has expired. Please sign in again.', 401);
  }

  if (!response.ok) throw await readError(response);

  if (response.status === 204) return null;
  if (raw) return response;

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

/**
 * Uploads bytes to a SAS URL handed out by the API.
 *
 * x-ms-blob-type is not optional: Azure rejects a PUT to a block blob without it,
 * and the resulting 400 mentions only "one of the request inputs is out of range",
 * which is a miserable thing to debug.
 */
export async function putToBlob(sasUrl, blob, contentType) {
  let response;
  try {
    response = await fetch(sasUrl, {
      method: 'PUT',
      headers: {
        'x-ms-blob-type': 'BlockBlob',
        'Content-Type': contentType || blob.type || 'application/octet-stream',
      },
      body: blob,
    });
  } catch {
    throw new ApiError(
      'The browser could not reach Blob Storage. If you are running Azurite, confirm it is listening on 127.0.0.1:10000; if you are on real Azure, add this origin to the storage account CORS rules.',
      0
    );
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const hint = response.status === 403 ? ' The upload URL may have expired — try again.' : '';
    throw new ApiError(`Upload failed (${response.status}).${hint} ${detail.slice(0, 300)}`.trim(), response.status);
  }
  return true;
}

/**
 * Works out why a direct read from Blob Storage failed, and says so.
 *
 * fetch() reports a dead server, a DNS failure and a CORS rejection as the same
 * bare TypeError, so guessing between them sends people to fix the wrong thing —
 * a stopped Azurite reads exactly like a missing CORS rule.
 *
 * A `no-cors` probe separates them: CORS returns an opaque response rather than
 * throwing, so if the probe succeeds something is listening and the browser
 * blocked the read; if it throws, nothing is there at all.
 */
export async function describeStorageFailure(url) {
  let origin = null;
  try {
    origin = new URL(url).origin;
  } catch {
    /* not a URL we can reason about */
  }
  if (!origin) return 'The browser could not read the file from Blob Storage.';

  const isLocalEmulator = /^https?:\/\/(127\.0\.0\.1|localhost):100\d\d$/.test(origin);

  try {
    await fetch(origin, { mode: 'no-cors', cache: 'no-store' });
  } catch {
    return isLocalEmulator
      ? `Nothing is listening at ${origin}, so Azurite is not running. Start it with backend\\tools\\start-azurite.cmd and reload — your uploads are kept in backend\\.azurite and will still be there.`
      : `Nothing is listening at ${origin}. Check that the storage account is reachable from this machine.`;
  }

  return `Blob Storage answered at ${origin} but the browser blocked the response, which means CORS. Allow this page's origin (${window.location.origin}) on the storage account with GET and HEAD.`;
}

/** Turns a data: URL from the WebGL canvas into a Blob without a round trip. */
export function dataUrlToBlob(dataUrl) {
  const [meta, b64] = dataUrl.split(',');
  const mime = /:(.*?);/.exec(meta)?.[1] ?? 'image/png';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
