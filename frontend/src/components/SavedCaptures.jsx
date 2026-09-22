import React, { useEffect, useMemo, useState } from 'react';
import { listCaptures, deleteCapture, renameCapture } from '../utils/captureStore.js';

function groupByTitle(all) {
  const groups = new Map();
  for (const c of all) {
    if (!groups.has(c.groupId)) groups.set(c.groupId, []);
    groups.get(c.groupId).push(c);
  }
  return [...groups.entries()]
    .map(([groupId, items]) => ({ groupId, items: items.sort((a, b) => (a.version ?? 0) - (b.version ?? 0)) }))
    .sort((a, b) => (b.items[b.items.length - 1].createdAt ?? 0) - (a.items[a.items.length - 1].createdAt ?? 0));
}

export default function SavedCaptures({ refreshToken, onRestore, canRestore, currentModelKey }) {
  const [all, setAll] = useState([]);
  const [lightbox, setLightbox] = useState(null);
  const [error, setError] = useState(null);
  const [onlyThisModel, setOnlyThisModel] = useState(false);

  const reload = () => {
    listCaptures()
      .then((rows) => {
        setAll(rows);
        setError(null);
      })
      .catch((e) => setError(e.message));
  };

  useEffect(reload, [refreshToken]);

  const groups = useMemo(() => {
    const rows = onlyThisModel && currentModelKey ? all.filter((c) => c.modelKey === currentModelKey) : all;
    return groupByTitle(rows);
  }, [all, onlyThisModel, currentModelKey]);

  const handleDelete = async (id) => {
    await deleteCapture(id);
    setLightbox(null);
    reload();
  };

  const handleRename = async (capture) => {
    // eslint-disable-next-line no-alert
    const next = window.prompt('Rename this capture', capture.title ?? capture.displayName);
    if (!next || !next.trim()) return;
    await renameCapture(capture.id, next.trim());
    setLightbox(null);
    reload();
  };

  if (error) {
    return (
      <div className="captures-page">
        <div className="captures-empty">
          <h3>Saved Captures unavailable</h3>
          <p>{error}</p>
          <p className="muted">
            Captures are stored in this browser&apos;s IndexedDB. Private/incognito windows and blocked site data will prevent
            saving.
          </p>
        </div>
      </div>
    );
  }

  if (all.length === 0) {
    return (
      <div className="captures-page">
        <div className="captures-empty">
          <h3>No saved captures yet</h3>
          <p>
            In the Configurator, pick a part, change its colour or material, then press <strong>Capture 2D Image</strong>. The
            snapshot and the exact set of finishes behind it are stored here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="captures-page">
      <div className="captures-toolbar">
        <div>
          <strong>{all.length}</strong> capture{all.length === 1 ? '' : 's'} in {groups.length} set{groups.length === 1 ? '' : 's'}
        </div>
        {currentModelKey && (
          <label className="inline-check">
            <input type="checkbox" checked={onlyThisModel} onChange={(e) => setOnlyThisModel(e.target.checked)} />
            Only the model currently loaded
          </label>
        )}
      </div>

      {groups.length === 0 && (
        <div className="captures-empty">
          <h3>Nothing for this model</h3>
          <p>Untick the filter above to see captures saved from other models.</p>
        </div>
      )}

      {groups.map((g) => (
        <div className="capture-group" key={g.groupId}>
          <div className="capture-group-header">
            <h3>{g.items[0].title ?? g.groupId}</h3>
            <span>
              {g.items[0].modelName ?? 'unknown model'}
              {g.items[0].focusNodeLabel ? ` · focused on ${g.items[0].focusNodeLabel}` : ''} · {g.items.length} version
              {g.items.length > 1 ? 's' : ''}
            </span>
          </div>
          <div className="capture-thumbs">
            {g.items.map((cap, i) => (
              <React.Fragment key={cap.id}>
                {i > 0 && <div className="capture-arrow">→</div>}
                <button type="button" className="capture-thumb" onClick={() => setLightbox(cap)}>
                  <img src={cap.thumbUrl ?? cap.dataUrl} alt={cap.displayName} />
                  <div className="capture-thumb-meta">
                    <span className="name">{cap.displayName}</span>
                    <span className="sub">{new Date(cap.createdAt).toLocaleString()}</span>
                    <span className="sub">
                      {cap.config?.length ?? 0} change{(cap.config?.length ?? 0) === 1 ? '' : 's'}
                      {cap.totalPrice ? ` · +$${cap.totalPrice.toLocaleString()}` : ''}
                    </span>
                  </div>
                </button>
              </React.Fragment>
            ))}
          </div>
        </div>
      ))}

      {lightbox && (
        <div className="lightbox-overlay" onClick={() => setLightbox(null)}>
          <div className="lightbox-card" onClick={(e) => e.stopPropagation()}>
            <img src={lightbox.dataUrl} alt={lightbox.displayName} />
            <div className="lightbox-body">
              <h3>{lightbox.displayName}</h3>
              <p className="muted">
                {lightbox.modelName ?? 'unknown model'}
                {lightbox.libraryName ? ` · schedule: ${lightbox.libraryName}` : ''} ·{' '}
                {new Date(lightbox.createdAt).toLocaleString()}
              </p>

              {lightbox.config?.length ? (
                <div className="config-list">
                  <div className="config-head">
                    <span>Finishes in this capture</span>
                    {!!lightbox.totalPrice && <strong>+${lightbox.totalPrice.toLocaleString()}</strong>}
                  </div>
                  {lightbox.config.map((c, i) => (
                    <div className="config-row" key={i}>
                      <i style={{ background: c.color ?? '#9aa' }} />
                      <span className="config-node">{c.nodeLabel ?? c.nodeName}</span>
                      <span className="config-opt">
                        {c.optionCode ? `${c.optionCode} · ` : ''}
                        {c.optionName ?? c.color}
                      </span>
                      {!!c.price && <span className="config-price">+${c.price.toLocaleString()}</span>}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">This capture recorded no finish changes — it is a view of the model as delivered.</p>
              )}

              <div className="lightbox-actions">
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={!canRestore || !lightbox.config?.length}
                  title={
                    !canRestore
                      ? 'Load a model in the Configurator first'
                      : !lightbox.config?.length
                      ? 'Nothing to re-apply'
                      : 'Re-apply these finishes to the loaded model'
                  }
                  onClick={() => onRestore(lightbox)}
                >
                  Re-apply to model
                </button>
                <a className="btn" href={lightbox.dataUrl} download={`${lightbox.displayName}.png`}>
                  Download PNG
                </a>
                <button className="btn" type="button" onClick={() => handleRename(lightbox)}>
                  Rename
                </button>
                <button className="btn btn-danger" type="button" onClick={() => handleDelete(lightbox.id)}>
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
