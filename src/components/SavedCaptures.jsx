import React, { useEffect, useState } from 'react';
import { listCaptures, deleteCapture } from '../utils/captureStore.js';

function groupCaptures(all) {
  const groups = new Map();
  for (const c of all) {
    if (!groups.has(c.groupId)) groups.set(c.groupId, []);
    groups.get(c.groupId).push(c);
  }
  return [...groups.entries()].map(([groupId, items]) => ({
    groupId,
    items: items.sort((a, b) => a.version - b.version),
  }));
}

export default function SavedCaptures({ refreshToken, onEditCapture }) {
  const [groups, setGroups] = useState([]);
  const [lightbox, setLightbox] = useState(null);

  useEffect(() => {
    listCaptures().then((all) => setGroups(groupCaptures(all)));
  }, [refreshToken]);

  const handleDelete = async (id) => {
    await deleteCapture(id);
    const all = await listCaptures();
    setGroups(groupCaptures(all));
    setLightbox(null);
  };

  if (groups.length === 0) {
    return (
      <div className="captures-page">
        <div className="captures-empty">
          <h3>No saved captures yet</h3>
          <p>Go to the Configurator, pick a zone, and click "Capture" to save a snapshot here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="captures-page">
      {groups.map((g) => {
        const first = g.items[0];
        return (
          <div className="capture-group" key={g.groupId}>
            <div className="capture-group-header">
              <h3>{g.groupId}</h3>
              <span>
                {first.roomLabel ?? ''} {first.zoneLabel ? `· ${first.zoneLabel}` : ''} · {g.items.length} version{g.items.length > 1 ? 's' : ''}
              </span>
            </div>
            <div className="capture-thumbs">
              {g.items.map((cap, i) => (
                <React.Fragment key={cap.id}>
                  {i > 0 && <div className="capture-arrow">→</div>}
                  <div className="capture-thumb" onClick={() => setLightbox(cap)}>
                    <img src={cap.dataUrl} alt={cap.displayName} />
                    <div className="capture-thumb-meta">
                      <span className="name">{cap.displayName}</span>
                      <span className="sub">{new Date(cap.createdAt).toLocaleString()}</span>
                      {cap.materialChoice && (
                        <div className="material-chip">
                          <i style={{ background: cap.materialChoice.color }} />
                          {cap.materialChoice.name}
                        </div>
                      )}
                    </div>
                  </div>
                </React.Fragment>
              ))}
            </div>
          </div>
        );
      })}

      {lightbox && (
        <div className="lightbox-overlay" onClick={() => setLightbox(null)}>
          <div className="lightbox-card" onClick={(e) => e.stopPropagation()}>
            <img src={lightbox.dataUrl} alt={lightbox.displayName} />
            <div className="lightbox-body">
              <h3>{lightbox.displayName}</h3>
              <p>
                {lightbox.roomLabel ?? 'View'} {lightbox.zoneLabel ? `· ${lightbox.zoneLabel}` : ''}
                {lightbox.materialChoice ? ` · ${lightbox.materialChoice.name}` : ''}
              </p>
              <div className="lightbox-actions">
                <button className="btn btn-primary" onClick={() => onEditCapture(lightbox)} disabled={!lightbox.zoneKey}>
                  Edit colors
                </button>
                <button className="btn" onClick={() => handleDelete(lightbox.id)}>
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
