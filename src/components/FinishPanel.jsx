import React, { useEffect, useMemo, useState } from 'react';
import { ancestorChain, textureThumbnail } from '../utils/nodeGraph.js';

/**
 * What the selected part is made of according to the .glb itself — the finish the
 * artist exported, before anyone picks anything.
 *
 * Shown when no schedule has been loaded yet. Until a document arrives there are no
 * options to offer, and an empty panel gives the user nothing to go on; the model
 * already knows the answer to "what is this made of?", so it is worth saying. Values
 * come from the snapshot taken when the file loaded, so they stay the as-delivered
 * figures even after edits.
 */
function AsBuiltSection({ graph, node }) {
  const materials = useMemo(
    () => node.materialIds.map((id) => graph.materials.find((m) => m.id === id)).filter(Boolean),
    [graph, node]
  );

  const [thumbs, setThumbs] = useState({});
  useEffect(() => {
    const next = {};
    for (const mat of materials) {
      for (const map of mat.maps) {
        if (next[map.textureId]) continue;
        const record = graph.textures.find((t) => t.id === map.textureId);
        const url = record && textureThumbnail(record.texture, 96);
        if (url) next[map.textureId] = url;
      }
    }
    setThumbs(next);
  }, [graph, materials]);

  if (materials.length === 0) return null;

  return (
    <section className="option-group">
      <header>
        <div>
          <h3>In the model</h3>
          <span className="group-cat">The finish this part was exported with</span>
        </div>
      </header>
      <div className="option-list">
        {materials.map((mat) => {
          const baseMap = mat.maps.find((m) => m.slot === 'map') ?? mat.maps[0] ?? null;
          const thumb = baseMap ? thumbs[baseMap.textureId] : null;
          const glows = mat.original.emissive && mat.original.emissive !== '#000000';
          return (
            <div className="as-built-row" key={mat.id}>
              <span className="option-swatch">
                {thumb ? <img src={thumb} alt="" /> : <i style={{ background: mat.original.color ?? '#bbb' }} />}
              </span>
              <span className="option-text">
                <span className="option-name">{mat.name}</span>
                <span className="option-sub">
                  {mat.original.color && <span className="option-hex">{mat.original.color.toUpperCase()}</span>}
                  {mat.original.roughness != null && <span>rough {mat.original.roughness.toFixed(2)}</span>}
                  {mat.original.metalness != null && <span>metal {mat.original.metalness.toFixed(2)}</span>}
                  {glows && <span>emissive {mat.original.emissive.toUpperCase()}</span>}
                </span>
                {mat.maps.length > 0 && (
                  <span className="option-notes">
                    {mat.maps.map((m) => `${m.name} (${m.slot})`).join(', ')}
                  </span>
                )}
                {mat.maps.length === 0 && <span className="option-notes">No texture — plain colour</span>}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// null means the document carried no price for this option, which is not the same as
// quoting zero — so nothing is shown rather than an unearned "Included".
function money(n) {
  if (n == null) return null;
  if (!n) return 'Included';
  return `+$${Number(n).toLocaleString()}`;
}

function OptionRow({ option, selected, pending, disabled, onPick }) {
  return (
    <button
      className={`option-row ${selected ? 'selected' : ''} ${pending ? 'pending' : ''}`}
      onClick={() => onPick(option)}
      type="button"
      disabled={disabled}
    >
      <span className="option-swatch">
        {option.texture ? (
          <img src={option.texture} alt="" style={option.color ? { filter: 'none' } : undefined} />
        ) : (
          <i style={{ background: option.color }} />
        )}
      </span>
      <span className="option-text">
        <span className="option-name">
          {option.name}
          {pending && <em className="option-applied pending">applying…</em>}
          {selected && !pending && <em className="option-applied">applied</em>}
        </span>
        <span className="option-sub">
          {option.code && <code>{option.code}</code>}
          {option.finish && <span>{option.finish}</span>}
          {/* A workbook gives no product names, so the hex *is* the option name —
              repeating it underneath would just be noise. */}
          {option.color && option.name.toUpperCase() !== option.color.toUpperCase() && (
            <span className="option-hex">{option.color.toUpperCase()}</span>
          )}
          {option.texture && <span>textured</span>}
        </span>
        {option.notes && <span className="option-notes">{option.notes}</span>}
      </span>
      {money(option.price) !== null && (
        <span className={`option-price ${option.price ? '' : 'included'}`}>{money(option.price)}</span>
      )}
    </button>
  );
}

export default function FinishPanel({
  graph,
  node,
  labelFor,
  matchedGroups,
  edit,
  scope,
  scopeCounts,
  onScopeChange,
  onApplyOption,
  onApplyModelMaterial,
  onResetNode,
  onSelectNode,
  library,
  busy,
}) {
  const [showModelMaterials, setShowModelMaterials] = useState(false);
  // A textured finish has to fetch and decode its image, so there is a real gap
  // between the click and the change appearing. Without this the panel looks inert
  // and the obvious response is to click again.
  const [pendingKey, setPendingKey] = useState(null);
  useEffect(() => {
    if (!busy) setPendingKey(null);
  }, [busy]);

  const modelMaterials = useMemo(() => {
    if (!graph) return [];
    const seen = new Map();
    for (const m of graph.materials) {
      if (!seen.has(m.name)) seen.set(m.name, m);
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [graph]);

  if (!node) {
    return (
      <div className="finish-panel">
        <div className="panel-placeholder">
          <h3>Pick a part to customise</h3>
          <p>
            Click any surface in the 3D view, or choose a part from the model tree on the left. The camera flies to it and the
            finishes that apply to that part appear here.
          </p>
          {library ? (
            <p className="muted">
              Loaded schedule: <strong>{library.name}</strong> — {library.groups.length} groups, {library.optionCount} options.
            </p>
          ) : (
            <p className="muted">
              {/* No material schedule loaded yet — you can still recolour any part by hand. To get catalogued finishes with
              codes and prices, use <strong>Upload schedule…</strong> in the top bar (or drop a <code>.json</code>/
              <code>.csv</code> onto the 3D view). */}
            </p>
          )}
        </div>
      </div>
    );
  }

  const chain = ancestorChain(graph, node.id);
  const counts = scopeCounts ?? { smart: node.meshCount, subtree: node.meshCount };
  const sharedMaterialNote = node.materialIds
    .map((id) => graph.materials.find((m) => m.id === id))
    .filter((m) => m && m.nodeIds.length > 1);

  return (
    <div className="finish-panel">
      <div className="panel-head">
        {chain.length > 1 && (
          <div className="breadcrumb">
            {chain.slice(0, -1).map((n) => (
              <button key={n.id} type="button" onClick={() => onSelectNode(n)}>
                {labelFor(n)}
              </button>
            ))}
            <span>{labelFor(node)}</span>
          </div>
        )}
        <h2>{labelFor(node)}</h2>
        <div className="panel-meta">
          <code>{node.name || node.rawType}</code>
          <span>{node.meshCount} mesh{node.meshCount === 1 ? '' : 'es'}</span>
          <span>{Math.round(node.triangles).toLocaleString()} tris</span>
          <span>
            {node.materialNames.length} material{node.materialNames.length === 1 ? '' : 's'}
          </span>
        </div>
        {node.materialNames.length > 0 && (
          <div className="panel-mats">
            {node.materialNames.map((m) => (
              <span className="mat-tag" key={m}>
                {m}
              </span>
            ))}
          </div>
        )}
      </div>

      {node.meshCount === 0 ? (
        <div className="panel-note warn">This node has no geometry, so there is nothing to re-finish here.</div>
      ) : (
        <>
          <div className="scope-row">
            <span>Apply to</span>
            <div className="scope-toggle">
              <button
                type="button"
                className={scope === 'smart' ? 'active' : ''}
                disabled={counts.smart === 0}
                onClick={() => onScopeChange('smart')}
                title={
                  counts.smart === 0
                    ? 'This is a grouping node and every sub-part has its own finishes, so there is no surface here to change on its own'
                    : 'This part, plus any sub-parts that have no finishes of their own'
                }
              >
                This part ({counts.smart})
              </button>
              <button
                type="button"
                className={scope === 'subtree' ? 'active' : ''}
                disabled={counts.subtree === counts.smart}
                onClick={() => onScopeChange('subtree')}
                title={
                  counts.subtree === counts.smart
                    ? 'This part has no separately configurable sub-parts'
                    : 'Everything under this part, including sub-parts that have their own finishes'
                }
              >
                + all sub-parts ({counts.subtree})
              </button>
            </div>
          </div>
          {scope === 'smart' && counts.subtree > counts.smart && (
            <div className="panel-note">
              {counts.subtree - counts.smart} sub-part surface{counts.subtree - counts.smart === 1 ? '' : 's'} under this part
              have their own finish options, so they are left alone. Switch to &quot;+ all sub-parts&quot; to override them too.
            </div>
          )}

          {sharedMaterialNote.length > 0 && (
            <div className="panel-note">
              {sharedMaterialNote.map((m) => m.name).join(', ')} {sharedMaterialNote.length === 1 ? 'is' : 'are'} also used by
              other parts of the model. Your change is isolated to this selection — the other parts keep their finish.
            </div>
          )}

          {matchedGroups.length === 0 && (
            <div className="panel-note warn">
              {library
                ? `The loaded schedule ("${library.name}") has no group matching this part. Add a group whose match.nodes includes "${node.name}" to offer finishes here.`
                : 'No material schedule loaded, so there is nothing to choose from yet — below is the finish this part already has. Use "Upload schedule…" in the top bar to load the options.'}
            </div>
          )}

          {!library && <AsBuiltSection graph={graph} node={node} />}

          {matchedGroups.map(({ group, reason }) => (
            <section className="option-group" key={group.id}>
              <header>
                <div>
                  <h3>{group.label}</h3>
                  <span className="group-cat">{group.category}</span>
                </div>
                <span className="match-reason" title="Why these options are offered here">
                  {reason}
                </span>
              </header>
              {group.description && <p className="group-desc">{group.description}</p>}
              <div className="option-list">
                {group.options.map((option) => {
                  const key = `${group.id}-${option.name}`;
                  return (
                    <OptionRow
                      key={key}
                      option={option}
                      selected={edit?.kind === 'option' && edit.groupId === group.id && edit.optionName === option.name}
                      pending={pendingKey === key}
                      disabled={busy && pendingKey !== key}
                      onPick={(opt) => {
                        setPendingKey(key);
                        onApplyOption(group, opt);
                      }}
                    />
                  );
                })}
              </div>
            </section>
          ))}

          <section className="option-group">
            <header>
              <div>
                <h3>Reuse a material from this file</h3>
                <span className="group-cat">{modelMaterials.length} materials in the .glb</span>
              </div>
              <button type="button" className="link-btn" onClick={() => setShowModelMaterials((v) => !v)}>
                {showModelMaterials ? 'Hide' : 'Show'}
              </button>
            </header>
            {showModelMaterials && (
              <>
                <p className="group-desc">
                  Copies a material the model already ships with — including its texture — onto this part. Works with no
                  schedule and no external assets.
                </p>
                <div className="model-mat-grid">
                  {modelMaterials.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className={`model-mat ${edit?.kind === 'modelMaterial' && edit.materialName === m.name ? 'selected' : ''}`}
                      onClick={() => onApplyModelMaterial(m)}
                      title={`${m.name}${m.maps.length ? ` · ${m.maps.length} texture map(s)` : ''}`}
                    >
                      <i style={{ background: m.original.color ?? '#888' }} />
                      <span>{m.name}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>

          <div className="panel-actions">
            <button type="button" className="btn" onClick={() => onResetNode(node)} disabled={!edit}>
              Reset this part
            </button>
          </div>
        </>
      )}
    </div>
  );
}
