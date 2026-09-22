import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertIcon } from './Icons.jsx';

/** Transient status messages. One at a time — stacked toasts hide each other. */
export function useToast() {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);

  const show = useCallback((message, kind = 'info') => {
    setToast({ message, kind, id: Date.now() });
    clearTimeout(timer.current);
    // Errors are usually longer and worth reading twice.
    timer.current = setTimeout(() => setToast(null), kind === 'error' ? 6000 : 3200);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  const node = toast ? (
    <div className={`uh-toast ${toast.kind}`} role="status">
      {toast.message}
    </div>
  ) : null;

  return { show, node };
}

export function Loading({ label = 'Loading…' }) {
  return (
    <div className="uh-loading">
      <span className="uh-spinner" />
      {label}
    </div>
  );
}

export function Empty({ title, children, action }) {
  return (
    <div className="uh-card uh-empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

/**
 * Failure panel that explains the two conditions this app hits most often —
 * a backend that isn't running, and Blob Storage that hasn't been configured —
 * instead of printing a stack trace at the user.
 */
export function ErrorBox({ error, onRetry }) {
  if (!error) return null;

  let body;
  if (error.status === 0) {
    body = (
      <>
        <strong>The API is not reachable.</strong>
        <br />
        {error.message}
      </>
    );
  } else if (error.isStorageUnconfigured) {
    body = (
      <>
        <strong>Azure Blob Storage has not been configured.</strong>
        <br />
        Images and .glb files are stored in Blob, so uploads and thumbnails cannot work until{' '}
        <code>Storage:ConnectionString</code> is set in <code>appsettings.Development.json</code>. For local work, run
        Azurite and use its development connection string.
      </>
    );
  } else {
    body = error.message;
  }

  return (
    <div className="uh-error-box">
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <AlertIcon size={18} style={{ flex: 'none', marginTop: 2 }} />
        <div style={{ minWidth: 0 }}>{body}</div>
      </div>
      {onRetry && (
        <div style={{ marginTop: 12 }}>
          <button className="uh-btn sm" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

export function Modal({ title, children, confirmLabel = 'Confirm', confirmKind = 'gold', onConfirm, onCancel, busy, confirmDisabled }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onCancel?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, busy]);

  return (
    <div className="uh-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel?.()}>
      <div className="uh-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="uh-modal-head">
          <h2>{title}</h2>
        </div>
        <div className="uh-modal-body">{children}</div>
        <div className="uh-modal-foot">
          <button className="uh-btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className={`uh-btn ${confirmKind}`} onClick={onConfirm} disabled={busy || confirmDisabled}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Badge({ kind = '', children }) {
  return <span className={`uh-badge ${kind}`}>{children}</span>;
}

export function formatBytes(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
