import React, { useEffect, useMemo, useState } from 'react';
import { textureThumbnail } from '../utils/nodeGraph.js';

// Read-only inventory of what the uploaded file actually contains: every material,
// its PBR values, which parts use it, and previews of the textures embedded in the
// .glb (rendered to a canvas, since embedded images have no URL of their own).
export default function InspectorPanel({ graph, onSelectNode }) {
  const [thumbs, setThumbs] = useState({});
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!graph) return;
    const next = {};
    for (const t of graph.textures) {
      const url = textureThumbnail(t.texture, 128);
      if (url) next[t.id] = url;
    }
    setThumbs(next);
  }, [graph]);

  const materials = useMemo(() => {
    if (!graph) return [];
    const q = query.trim().toLowerCase();
    const list = [...graph.materials].sort((a, b) => a.name.localeCompare(b.name));
    if (!q) return list;
    return list.filter((m) => m.name.toLowerCase().includes(q) || m.nodeNames.some((n) => n.toLowerCase().includes(q)));
  }, [graph, query]);

  if (!graph) {
    return (
      <div className="inspector-page">
        <div className="captures-empty">
          <h3>No model loaded</h3>
          <p>Upload a .glb in the Configurator tab to see its materials and textures here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="inspector-page">
      <div className="inspector-summary">
        <div>
          <strong>{graph.stats.nodeCount}</strong>
          <span>nodes &amp; sub-nodes</span>
        </div>
        <div>
          <strong>{graph.stats.meshCount}</strong>
          <span>meshes</span>
        </div>
        <div>
          <strong>{graph.stats.materialCount}</strong>
          <span>materials</span>
        </div>
        <div>
          <strong>{graph.stats.textureCount}</strong>
          <span>textures</span>
        </div>
        <div>
          <strong>{graph.stats.triangles.toLocaleString()}</strong>
          <span>triangles</span>
        </div>
      </div>

      <section className="inspector-section">
        <h3>Textures embedded in this file</h3>
        {graph.textures.length === 0 ? (
          <p className="muted">This model has no textures — every surface is a plain colour.</p>
        ) : (
          <div className="texture-grid">
            {graph.textures.map((t) => (
              <div className="texture-card" key={t.id}>
                {thumbs[t.id] ? <img src={thumbs[t.id]} alt={t.name} /> : <div className="texture-noimg">no preview</div>}
                <div className="texture-info">
                  <strong title={t.name}>{t.name}</strong>
                  <span>
                    {t.width && t.height ? `${t.width}×${t.height}` : 'size unknown'} · {t.slots.join(', ')}
                  </span>
                  <span className="muted">used by {t.materialNames.join(', ')}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="inspector-section">
        <div className="inspector-section-head">
          <h3>Materials</h3>
          <input
            className="tree-search"
            type="search"
            placeholder="Filter by material or part…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="material-table">
          <div className="material-row head">
            <span aria-hidden="true" />
            <span>Name</span>
            <span>Type</span>
            <span>Rough / Metal</span>
            <span>Maps</span>
            <span>Used by</span>
          </div>
          {materials.map((m) => (
            <div className="material-row" key={m.id}>
              <span className="mat-swatch" style={{ background: m.original.color ?? 'repeating-linear-gradient(45deg,#ddd,#ddd 4px,#bbb 4px,#bbb 8px)' }} />
              <span className="mat-name">
                {m.name}
                {m.original.emissive && m.original.emissive !== '#000000' && (
                  <em title={`Emissive ${m.original.emissive}`}> glows</em>
                )}
              </span>
              <span className="muted">{m.type.replace('Mesh', '').replace('Material', '')}</span>
              <span className="muted">
                {m.original.roughness == null ? '—' : m.original.roughness.toFixed(2)} /{' '}
                {m.original.metalness == null ? '—' : m.original.metalness.toFixed(2)}
              </span>
              <span className="muted">{m.maps.length ? m.maps.map((x) => x.slot).join(', ') : '—'}</span>
              <span className="mat-users">
                {m.nodeIds.slice(0, 6).map((id) => {
                  const node = graph.byId.get(id);
                  if (!node) return null;
                  return (
                    <button key={id} type="button" onClick={() => onSelectNode(node)}>
                      {node.name || node.rawType}
                    </button>
                  );
                })}
                {m.nodeIds.length > 6 && <span className="muted">+{m.nodeIds.length - 6}</span>}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
