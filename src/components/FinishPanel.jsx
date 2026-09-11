import React, { useEffect, useMemo, useState } from 'react';
import { ancestorChain } from '../utils/nodeGraph.js';

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
  onApplyColor,
  onApplyModelMaterial,
  onResetNode,
  onSelectNode,
  library,
  busy,
}) {
  const [customColor, setCustomColor] = useState('#c9a227');
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
              No material schedule loaded yet — you can still recolour any part by hand. To get catalogued finishes with
              codes and prices, use <strong>Upload schedule…</strong> in the top bar (or drop a <code>.json</code>/
              <code>.csv</code> onto the 3D view).
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
                ? `The loaded schedule ("${library.name}") has no group matching this part. Use the custom colour below, or add a group whose match.nodes includes "${node.name}".`
                : 'No material schedule loaded, so there are no catalogued finishes for this part yet. Use "Upload schedule…" in the top bar, or the custom colour below.'}
            </div>
          )}

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
                <h3>Custom colour</h3>
                <span className="group-cat">Any colour, off-catalogue</span>
              </div>
            </header>
            <div className="custom-color-row">
              <input type="color" value={customColor} onChange={(e) => setCustomColor(e.target.value)} aria-label="Pick a colour" />
              <code>{customColor.toUpperCase()}</code>
              <button type="button" className="btn btn-primary" onClick={() => onApplyColor(customColor)} disabled={busy}>
                Apply colour
              </button>
            </div>
            {edit?.kind === 'color' && (
              <p className="muted small">
                Currently showing custom colour <code>{edit.color.toUpperCase()}</code>.
              </p>
            )}
          </section>

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
