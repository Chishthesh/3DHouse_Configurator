import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { captures as capturesApi, configurations as configApi, models as modelsApi, schedules as schedulesApi } from '../../api/endpoints.js';
import { parseMaterialLibrary } from '../../utils/materialLibrary.js';
import { normalizeKey } from '../../utils/nodeGraph.js';
import { Empty, ErrorBox, Loading, Modal, useToast } from '../../components/uh/Ui.jsx';
import { ArrowLeftIcon, ArrowRightIcon, SaveIcon } from '../../components/uh/Icons.jsx';
import { navigate } from '../../router/Router.jsx';

/**
 * Module 2 — the GMC-style 2D configurator.
 *
 * The stage shows a pre-rendered photograph, not a live 3D scene. Left/right steps
 * between captured angles; the right-hand panel lists only the parts visible in the
 * angle on screen, and choosing an option swaps in a pre-rendered layer for that one
 * part. Layers composite additively, so ten parts with five options each is fifty
 * images — not five-to-the-tenth combinations.
 */

/** Groups in the schedule that target this node name. No 3D graph is loaded here, so matching is by name. */
function groupsForName(library, nodeName) {
  if (!library || !nodeName) return [];
  return library.groups.filter(
    (g) => !g.excludePatterns.some((p) => p.test(nodeName)) && g.nodePatterns.some((p) => p.test(nodeName))
  );
}

function swatchStyle(option) {
  if (option.texture) return { backgroundImage: `url(${option.texture})` };
  if (option.color) return { background: option.color };
  return {};
}

export default function ImageConfiguratorPage({ modelId }) {
  const toast = useToast();

  const [model, setModel] = useState(null);
  const [views, setViews] = useState(null);
  const [library, setLibrary] = useState(null);
  const [error, setError] = useState(null);

  const [index, setIndex] = useState(0);
  const [activeNode, setActiveNode] = useState(null);
  const [selections, setSelections] = useState({}); // nodeName -> option
  const [saving, setSaving] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');

  const stageRef = useRef(null);

  // --- Load ------------------------------------------------------------------------

  const load = useCallback(() => {
    setError(null);
    Promise.all([modelsApi.get(modelId), capturesApi.views(modelId), schedulesApi.getParsed(modelId).catch(() => null)])
      .then(([m, v, parsed]) => {
        setModel(m);
        setViews(v.sort((a, b) => a.sortOrder - b.sortOrder));
        if (parsed) {
          // Re-parsed here so the option data is identical to what the 3D studio saw.
          const result = parseMaterialLibrary(JSON.stringify(parsed), parsed.name ?? 'schedule');
          setLibrary(result.library);
        }
      })
      .catch(setError);
  }, [modelId]);

  useEffect(load, [load]);

  const view = views?.[index] ?? null;

  // --- Which parts this angle offers -------------------------------------------------

  const nodes = useMemo(() => {
    if (!view || !library) return [];

    // Captures taken before the workbook was attached have no configurableNodes, so
    // fall back to intersecting what is visible with what the schedule can change.
    // That keeps Flow B working: capture first, attach the schedule afterwards.
    const candidates = view.configurableNodes?.length ? view.configurableNodes : view.visibleNodes ?? [];

    const seen = new Set();
    const out = [];
    for (const name of candidates) {
      const groups = groupsForName(library, name);
      if (groups.length === 0) continue;
      const key = normalizeKey(name);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        name,
        label: library.nodeLabels?.get(key) ?? name,
        groups,
        optionCount: groups.reduce((n, g) => n + g.options.length, 0),
      });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }, [view, library]);

  // Keep a sensible selection as the angle changes: stay on the same part if it is
  // still in shot, otherwise fall to the first one rather than emptying the panel.
  useEffect(() => {
    if (nodes.length === 0) {
      setActiveNode(null);
      return;
    }
    setActiveNode((prev) => (prev && nodes.some((n) => n.name === prev) ? prev : nodes[0].name));
  }, [nodes]);

  // --- Layer lookup ---------------------------------------------------------------------

  const layerFor = useCallback(
    (nodeName, optionCode) =>
      view?.layers?.find((l) => l.nodeName === nodeName && l.optionKey === optionCode)?.imageUrl ?? null,
    [view]
  );

  const activeLayers = useMemo(() => {
    if (!view) return [];
    return Object.entries(selections)
      .map(([nodeName, option]) => ({ key: `${nodeName}:${option.code}`, url: layerFor(nodeName, option.code) }))
      .filter((l) => l.url);
  }, [selections, view, layerFor]);

  // --- Navigation -------------------------------------------------------------------------

  const go = useCallback(
    (delta) => {
      if (!views?.length) return;
      setIndex((i) => Math.min(views.length - 1, Math.max(0, i + delta)));
    },
    [views]
  );

  useEffect(() => {
    const onKey = (e) => {
      if (saveOpen) return;
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, saveOpen]);

  // Warm the neighbouring angles so stepping left or right doesn't flash white.
  useEffect(() => {
    if (!views) return;
    [index - 1, index + 1].forEach((i) => {
      const url = views[i]?.baseImageUrl;
      if (url) {
        const img = new Image();
        img.src = url;
      }
    });
  }, [views, index]);

  // --- Saving ----------------------------------------------------------------------------

  async function handleSave() {
    setSaving(true);
    try {
      await configApi.save(
        modelId,
        saveName.trim() || `${model.name} configuration`,
        Object.entries(selections).map(([nodeName, option]) => ({
          nodeName,
          optionKey: option.code,
          optionName: option.name ?? null,
          color: option.color ?? null,
          texture: option.texture ?? null,
        }))
      );
      toast.show('Configuration saved.', 'success');
      setSaveOpen(false);
    } catch (err) {
      toast.show(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  const totalPrice = useMemo(
    () => Object.values(selections).reduce((sum, o) => sum + (Number(o.price) || 0), 0),
    [selections]
  );
  const hasPricing = useMemo(() => Object.values(selections).some((o) => Number.isFinite(Number(o.price)) && o.price), [selections]);

  // --- Render -------------------------------------------------------------------------------

  if (error) {
    return (
      <div className="uh-page">
        <ErrorBox error={error} onRetry={load} />
        <div style={{ marginTop: 14 }}>
          <button className="uh-btn" onClick={() => navigate('/configurator')}>
            <ArrowLeftIcon size={16} />
            Back
          </button>
        </div>
      </div>
    );
  }

  if (!views || !model) {
    return (
      <div className="uh-page">
        <Loading label="Loading the configurator…" />
      </div>
    );
  }

  if (views.length === 0) {
    return (
      <div className="uh-page">
        <Empty
          title="No published angles"
          action={
            <button className="uh-btn" onClick={() => navigate('/configurator')}>
              Back to models
            </button>
          }
        >
          {model.name} has no published captures yet, so there is nothing to show. Publish some angles from Models &amp;
          Captures first.
        </Empty>
      </div>
    );
  }

  const activeNodeRecord = nodes.find((n) => n.name === activeNode) ?? null;

  return (
    <div className="uh-cfg">
      <div className="uh-cfg-stage">
        <div className="uh-stage-canvas">
          <div
            className="uh-stage-frame"
            ref={stageRef}
            style={{ '--shot-aspect': `${view.width || 16} / ${view.height || 10}` }}
          >
            <img src={view.baseImageUrl} alt={view.name} />
            {activeLayers.map((l) => (
              <img key={l.key} className="layer" src={l.url} alt="" />
            ))}
          </div>

          <button className="uh-arrow prev" onClick={() => go(-1)} disabled={index === 0} aria-label="Previous angle">
            <ArrowLeftIcon size={22} />
          </button>
          <button
            className="uh-arrow next"
            onClick={() => go(1)}
            disabled={index === views.length - 1}
            aria-label="Next angle"
          >
            <ArrowRightIcon size={22} />
          </button>
        </div>

        <div className="uh-stage-foot">
          <div className="uh-angle-dots">
            {views.map((v, i) => (
              <button
                key={v.id}
                className={`uh-angle-dot ${i === index ? 'active' : ''}`}
                onClick={() => setIndex(i)}
                title={v.name}
                aria-label={`Angle ${i + 1}: ${v.name}`}
              />
            ))}
          </div>
          <div className="uh-angle-label">
            {view.name} — angle {index + 1} of {views.length}
          </div>
        </div>
      </div>

      <aside className="uh-cfg-panel">
        <div className="uh-panel-head">
          <h2>{model.name}</h2>
          <p>
            {nodes.length === 0
              ? 'Nothing in this view can be changed.'
              : `${nodes.length} part${nodes.length === 1 ? '' : 's'} in this view`}
          </p>
        </div>

        <div className="uh-node-list">
          {nodes.length === 0 && (
            <div style={{ padding: '10px 4px', color: '#8a93ab', fontSize: 13.5 }}>
              {library
                ? 'None of the parts visible from this angle appear in the finish schedule. Try another angle.'
                : 'No finish schedule is attached to this model yet.'}
            </div>
          )}
          {nodes.map((n) => {
            const chosen = selections[n.name];
            return (
              <button
                key={n.name}
                className={`uh-node-btn ${activeNode === n.name ? 'active' : ''}`}
                onClick={() => setActiveNode(n.name)}
              >
                <span className="uh-swatch-dot" style={chosen ? swatchStyle(chosen) : { background: '#dfe3ed' }} />
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.label}</span>
                <span className="count">{chosen ? chosen.name : `${n.optionCount} options`}</span>
              </button>
            );
          })}
        </div>

        <div className="uh-option-area">
          {activeNodeRecord?.groups.map((group) => (
            <div className="uh-option-group" key={group.id}>
              <h3>{group.label}</h3>
              {group.category && <p className="sub">{group.category}</p>}
              <div className="uh-options">
                {group.options.map((option) => {
                  const chosen = selections[activeNodeRecord.name]?.code === option.code;
                  const hasLayer = !!layerFor(activeNodeRecord.name, option.code);
                  return (
                    <button
                      key={option.code}
                      className={`uh-option ${chosen ? 'active' : ''} ${hasLayer ? '' : 'unavailable'}`}
                      onClick={() =>
                        setSelections((prev) =>
                          prev[activeNodeRecord.name]?.code === option.code
                            ? Object.fromEntries(Object.entries(prev).filter(([k]) => k !== activeNodeRecord.name))
                            : { ...prev, [activeNodeRecord.name]: option }
                        )
                      }
                      title={
                        hasLayer
                          ? option.name
                          : `${option.name} — no rendered layer for this angle yet, so the image will not change.`
                      }
                    >
                      <span className="uh-option-swatch" style={swatchStyle(option)} />
                      {!hasLayer && <span className="flag">no layer</span>}
                      <span className="uh-option-name">{option.name}</span>
                      {Number(option.price) > 0 && <span className="uh-option-price">+${Number(option.price).toLocaleString()}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="uh-panel-foot">
          <div className="uh-total">
            {Object.keys(selections).length} change{Object.keys(selections).length === 1 ? '' : 's'}
            {hasPricing && (
              <>
                {' · '}
                <strong>+${totalPrice.toLocaleString()}</strong>
              </>
            )}
          </div>
          <button className="uh-btn sm" disabled={Object.keys(selections).length === 0} onClick={() => setSelections({})}>
            Reset
          </button>
          <button
            className="uh-btn sm gold"
            disabled={Object.keys(selections).length === 0}
            onClick={() => {
              setSaveName(`${model.name} configuration`);
              setSaveOpen(true);
            }}
          >
            <SaveIcon size={15} />
            Save
          </button>
        </div>
      </aside>

      {saveOpen && (
        <Modal
          title="Save this configuration"
          confirmLabel="Save"
          busy={saving}
          confirmDisabled={!saveName.trim()}
          onCancel={() => setSaveOpen(false)}
          onConfirm={handleSave}
        >
          Stores the {Object.keys(selections).length} selection
          {Object.keys(selections).length === 1 ? '' : 's'} against this model so it can be reopened later.
          <input
            className="uh-inline-input"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="Configuration name"
            autoFocus
          />
        </Modal>
      )}

      {toast.node}
    </div>
  );
}
