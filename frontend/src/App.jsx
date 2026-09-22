import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import Configurator from './components/Configurator.jsx';
import SavedCaptures from './components/SavedCaptures.jsx';
import InspectorPanel from './components/InspectorPanel.jsx';
import ScheduleUploadButton from './components/ScheduleUploadButton.jsx';
import { buildNodeGraph, selectableNodeFor, normalizeKey, meshesForScope } from './utils/nodeGraph.js';
import { MaterialEditor } from './utils/materialApply.js';
import { parseMaterialLibrary, parseMaterialWorkbook, groupsForNode, analyzeCoverage } from './utils/materialLibrary.js';
import { buildInHouseScheduleShape } from './data/builtinLibrary.js';
import { extractGlbTextures } from './utils/extractGlbTextures.js';
import { frameForBox, frameOpeningShot } from './utils/cameraFraming.js';
import { addCapture, makeThumbnail, slugify } from './utils/captureStore.js';

export default function App() {
  const [activeTab, setActiveTab] = useState('configurator');

  const [model, setModel] = useState(null); // { url, name, key, isBlob }
  const [graph, setGraph] = useState(null);
  const [sceneMeta, setSceneMeta] = useState(null); // { center, radius, groundY, box, enclosed }

  const [library, setLibrary] = useState(null);
  const [libErrors, setLibErrors] = useState([]);
  const [libWarnings, setLibWarnings] = useState([]);
  const [workbook, setWorkbook] = useState(null); // { sheets, activeSheet } for .xlsx uploads

  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [scope, setScope] = useState('smart');
  const [edits, setEdits] = useState({});
  const [flyTo, setFlyTo] = useState(null);
  const [flying, setFlying] = useState(false);
  const [hoverName, setHoverName] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [captureRefreshToken, setCaptureRefreshToken] = useState(0);

  const sceneViewerRef = useRef(null);
  const sceneRootRef = useRef(null);
  const editorRef = useRef(null);
  const toastTimer = useRef(null);
  const objectUrlRef = useRef(null);
  const workbookFileRef = useRef(null);
  const libraryTokenRef = useRef(0);
  const modelRef = useRef(null); // mirrors `model` state for callbacks with empty dep arrays

  const showToast = useCallback((message, kind = 'info') => {
    setToast({ message, kind });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // --- Model loading -------------------------------------------------------------

  const resetForNewModel = useCallback((next) => {
    editorRef.current?.dispose();
    editorRef.current = null;
    sceneRootRef.current = null;
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setGraph(null);
    setSceneMeta(null);
    setSelectedNodeId(null);
    setEdits({});
    setFlyTo(null);
    setHoverName(null);
    setScope('smart');
    if (next?.isBlob) objectUrlRef.current = next.url;
    modelRef.current = next;
    setModel(next);
  }, []);

  const handleFileChosen = useCallback(
    (file) => {
      const url = URL.createObjectURL(file);
      resetForNewModel({
        url,
        name: file.name,
        key: `${file.name}:${file.size}`,
        isBlob: true,
        sizeMB: file.size / 1024 / 1024,
      });
    },
    [resetForNewModel]
  );

  // Everything below is derived by inspecting the scene graph that was actually
  // loaded — no node names, room names or coordinates are hardcoded in this app.
  const handleSceneReady = useCallback(
    (scene) => {
      if (sceneRootRef.current === scene) return; // StrictMode double-invoke guard
      sceneRootRef.current = scene;
      editorRef.current?.dispose();
      editorRef.current = new MaterialEditor(scene);

      const nextGraph = buildNodeGraph(scene);
      setGraph(nextGraph);
      // Handy when diagnosing a model that frames or selects oddly; dev-only.
      if (import.meta.env.DEV) {
        window.__configuratorScene = scene;
        window.__three = THREE;
      }

      // Extract and persist embedded textures to public/textures/<model-name>/
      // so they can be referenced in material schedules. Runs in dev only —
      // the save-texture endpoint is provided by the Vite plugin.
      if (import.meta.env.DEV && nextGraph.textures.length > 0) {
        extractGlbTextures(nextGraph.textures, modelRef.current?.name ?? 'model').then(({ saved, skipped }) => {
          if (saved.length > 0) {
            console.log(`[textures] Saved ${saved.length} texture(s) to public/textures/:`, saved);
          }
          if (skipped.length > 0) {
            console.warn(`[textures] Skipped ${skipped.length} texture(s) (compressed / unavailable):`, skipped);
          }
        });
      }

      const opening = frameOpeningShot(scene);
      const size = opening.box.getSize(new THREE.Vector3());
      const center = opening.box.getCenter(new THREE.Vector3());
      setSceneMeta({
        box: opening.box,
        center: center.toArray(),
        radius: Math.max(size.length() / 2, 0.5),
        groundY: opening.box.min.y - Math.max(size.y * 0.002, 0.01),
        openSided: opening.openSided,
        openingPosition: opening.position,
      });
      setFlyTo({ ...opening, instant: true, _t: Date.now() });
      setSelectedNodeId(null);
      setEdits({});
    },
    []
  );

  useEffect(
    () => () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    },
    []
  );

  // --- Material schedule ---------------------------------------------------------

  // A schedule naming a texture that is not actually in the texture folder is an easy
  // mistake and, without this, only shows up as a failure when someone clicks the
  // option. Checked once per load, and guarded against a newer load landing first.
  const validateTextures = useCallback(async (lib, token) => {
    const urls = new Set();
    lib.groups.forEach((g) => g.options.forEach((o) => o.texture && urls.add(o.texture)));
    if (urls.size === 0) return;
    const missing = [];
    await Promise.all(
      [...urls].map(async (url) => {
        try {
          const res = await fetch(url, { method: 'HEAD' });
          // A dev server that falls back to index.html answers 200 with HTML, so the
          // status alone is not enough to prove the image is there.
          const type = res.headers.get('content-type') ?? '';
          if (!res.ok || !/^(image|application\/octet-stream)/.test(type)) missing.push(url);
        } catch {
          missing.push(url);
        }
      })
    );
    if (missing.length > 0 && libraryTokenRef.current === token) {
      setLibWarnings((prev) => [
        ...prev,
        `${missing.length} texture${missing.length === 1 ? '' : 's'} named in the schedule could not be found: ${missing
          .map((m) => m.split('/').pop())
          .join(', ')}. Add the file${missing.length === 1 ? '' : 's'} to public/textures/.`,
      ]);
    }
  }, []);

  const applyParsedLibrary = useCallback(
    (result, sourceLabel) => {
      setLibErrors(result.errors);
      setLibWarnings(result.warnings);
      // Only workbooks carry sheets; anything else clears the picker.
      setWorkbook(result.sheets?.length ? { sheets: result.sheets, activeSheet: result.activeSheet } : null);
      if (result.library) {
        setLibrary(result.library);
        const token = (libraryTokenRef.current = (libraryTokenRef.current ?? 0) + 1);
        validateTextures(result.library, token);
        const g = result.library.groups.length;
        const o = result.library.optionCount;
        showToast(
          `Loaded "${result.library.name}" — ${g} group${g === 1 ? '' : 's'}, ${o} option${o === 1 ? '' : 's'}.`,
          'success'
        );
      } else {
        setLibrary(null);
        showToast(`Could not read ${sourceLabel}: ${result.errors[0] ?? 'unknown problem'}`, 'error');
      }
    },
    [showToast, validateTextures]
  );

  const isWorkbookName = (name) => /\.xlsx?$/i.test(name) || /\.xlsm$/i.test(name);

  // One entry point for every format. An .xlsx is binary so it takes the ArrayBuffer
  // path; JSON and CSV keep the text path they already used.
  const readSchedule = useCallback(async (blob, name, preferredSheet = null) => {
    if (/\.xls$/i.test(name)) {
      return {
        library: null,
        warnings: [],
        errors: [`"${name}" is the old binary Excel format. Open it in Excel and save as .xlsx, then upload again.`],
      };
    }
    if (isWorkbookName(name)) {
      return parseMaterialWorkbook(await blob.arrayBuffer(), name, preferredSheet);
    }
    return parseMaterialLibrary(await blob.text(), name);
  }, []);

  const handleLoadLibraryFile = useCallback(
    async (file) => {
      try {
        // Kept so switching worksheets later does not require re-picking the file.
        workbookFileRef.current = isWorkbookName(file.name) ? { blob: file, name: file.name } : null;
        applyParsedLibrary(await readSchedule(file, file.name), file.name);
      } catch (err) {
        setLibrary(null);
        setWorkbook(null);
        setLibErrors([`Could not read the file: ${err.message}`]);
      }
    },
    [applyParsedLibrary, readSchedule]
  );

  const handleSelectSheet = useCallback(
    async (sheetName) => {
      const held = workbookFileRef.current;
      if (!held) return;
      applyParsedLibrary(await readSchedule(held.blob, held.name, sheetName), sheetName);
    },
    [applyParsedLibrary, readSchedule]
  );

  const handleClearLibrary = useCallback(() => {
    setLibrary(null);
    setLibErrors([]);
    setLibWarnings([]);
    setWorkbook(null);
    workbookFileRef.current = null;
  }, []);

  // A model exported to the older {category}_{zone} convention gets its built-in
  // catalogue automatically, so that workflow keeps working with nothing to upload.
  useEffect(() => {
    if (!graph || library) return;
    const builtin = parseMaterialLibrary(JSON.stringify(buildInHouseScheduleShape()), 'built-in');
    if (!builtin.library) return;
    const coverage = analyzeCoverage(builtin.library, graph);
    if (coverage && coverage.matchedGroupCount > 0) {
      setLibrary(builtin.library);
      setLibErrors([]);
      setLibWarnings([]);
      showToast('This model follows the {category}_{zone} convention — built-in finish catalogue applied.', 'success');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  // --- Derived -------------------------------------------------------------------

  const labelFor = useCallback(
    (node) => {
      if (!node) return '';
      const override = library?.nodeLabels.get(normalizeKey(node.name));
      return override ?? node.displayName;
    },
    [library]
  );

  const nodeMatches = useMemo(() => {
    const map = new Map();
    if (!graph || !library) return map;
    for (const node of graph.nodes) map.set(node.id, groupsForNode(library, graph, node));
    return map;
  }, [graph, library]);

  const coverage = useMemo(() => (graph && library ? analyzeCoverage(library, graph) : null), [graph, library]);

  const optionCountFor = useCallback(
    (node) => (nodeMatches.get(node.id) ?? []).reduce((sum, m) => sum + m.group.options.length, 0),
    [nodeMatches]
  );

  const selectedNode = selectedNodeId && graph ? graph.byId.get(selectedNodeId) ?? null : null;
  const matchedGroups = selectedNode ? nodeMatches.get(selectedNode.id) ?? [] : [];
  const editedNodeIds = useMemo(() => new Set(Object.keys(edits)), [edits]);
  const totalPrice = useMemo(() => Object.values(edits).reduce((s, e) => s + (e.price || 0), 0), [edits]);
  // A schedule with no price column (the workbook format has none) must not imply a
  // quote of zero, so the running total only appears once something is actually priced.
  const hasPricing = useMemo(() => Object.values(edits).some((e) => typeof e.price === 'number'), [edits]);

  // --- Selection & navigation ----------------------------------------------------

  const flyToNode = useCallback(
    (node) => {
      const root = sceneRootRef.current;
      if (!root || !node?.box || !sceneMeta) return;
      const frame = frameForBox(node.box, {
        root,
        ignoreObject: node.object,
        towardCenter: new THREE.Vector3(...sceneMeta.center),
        containBox: sceneMeta.box,
        openingPosition: sceneMeta.openingPosition,
      });
      setFlyTo({ ...frame, _t: Date.now() });
    },
    [sceneMeta]
  );

  const handleSelectNode = useCallback(
    (node) => {
      if (!node) return;
      setSelectedNodeId(node.id);
      setActiveTab('configurator');
      if (node.box) flyToNode(node);
      else showToast(`"${node.name || node.rawType}" is a grouping node with no geometry — nothing to fly to.`, 'info');
    },
    [flyToNode, showToast]
  );

  const handlePickInScene = useCallback(
    (object) => {
      if (!graph) return;
      const node = selectableNodeFor(graph, object);
      if (node) handleSelectNode(node);
    },
    [graph, handleSelectNode]
  );

  const handleHover = useCallback(
    (object) => {
      if (!object || !graph) {
        setHoverName(null);
        return;
      }
      const node = selectableNodeFor(graph, object);
      const next = node ? labelFor(node) : null;
      setHoverName((prev) => (prev === next ? prev : next));
    },
    [graph, labelFor]
  );

  const handleOverview = useCallback(() => {
    const root = sceneRootRef.current;
    if (!root || !sceneMeta) return;
    setSelectedNodeId(null);
    setFlyTo({ ...frameOpeningShot(root), _t: Date.now() });
  }, [sceneMeta]);

  // --- Applying finishes ---------------------------------------------------------

  // A sub-part is "separately configurable" only when the schedule targets it by its
  // own node name (score 100). Matching merely because of the material it uses is not
  // enough: the island cabinets and the two primitive meshes inside them all match
  // the same Cabinetry group via the "cabinets wood" material, and treating those
  // children as independent would leave the default scope with nothing to apply to.
  const hasOwnFinishes = useCallback(
    (nodeId) => (nodeMatches.get(nodeId) ?? []).some((m) => m.score === 100),
    [nodeMatches]
  );

  const meshesFor = useCallback(
    (node, requestedScope) => (graph && node ? meshesForScope(graph, node, requestedScope, hasOwnFinishes) : []),
    [graph, hasOwnFinishes]
  );

  const scopeCounts = useMemo(() => {
    if (!selectedNode) return { smart: 0, subtree: 0 };
    return {
      smart: meshesFor(selectedNode, 'smart').length,
      subtree: meshesFor(selectedNode, 'subtree').length,
    };
  }, [selectedNode, meshesFor]);

  // A pure group node whose every sub-part is separately configurable has no surface
  // of its own to change, so "this part" would apply to nothing. Start such a
  // selection on the wider scope rather than letting the user click into a no-op.
  useEffect(() => {
    if (!selectedNodeId) return;
    setScope(scopeCounts.smart > 0 ? 'smart' : 'subtree');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId]);

  const recordEdit = useCallback((node, record) => {
    setEdits((prev) => ({ ...prev, [node.id]: record }));
  }, []);

  const handleApplyOption = useCallback(
    async (group, option) => {
      const editor = editorRef.current;
      if (!editor || !selectedNode) return;
      const meshes = meshesFor(selectedNode, scope);
      if (meshes.length === 0) {
        showToast(`Nothing to change: this selection has no surface at the "${scope}" scope.`, 'error');
        return;
      }
      setBusy(true);
      try {
        const { meshCount, textureError } = await editor.applyOption(meshes, option);
        recordEdit(selectedNode, {
          nodeId: selectedNode.id,
          nodeName: selectedNode.name,
          nodePath: selectedNode.path,
          nodeLabel: labelFor(selectedNode),
          scope,
          kind: 'option',
          groupId: group.id,
          groupLabel: group.label,
          optionCode: option.code,
          optionName: option.name,
          color: option.color,
          price: option.price,
          option,
        });
        if (textureError) showToast(`${option.name} applied, but its texture failed to load (${textureError}).`, 'error');
        else showToast(`${option.name} applied to ${meshCount} surface${meshCount === 1 ? '' : 's'}.`, 'success');
      } catch (err) {
        showToast(`Could not apply ${option.name}: ${err.message}`, 'error');
      } finally {
        setBusy(false);
      }
    },
    [selectedNode, scope, meshesFor, labelFor, recordEdit, showToast]
  );

  const handleApplyModelMaterial = useCallback(
    (materialRecord) => {
      const editor = editorRef.current;
      if (!editor || !selectedNode) return;
      const meshes = meshesFor(selectedNode, scope);
      if (meshes.length === 0) {
        showToast(`Nothing to change: this selection has no surface at the "${scope}" scope.`, 'error');
        return;
      }
      const meshCount = editor.applyExistingMaterial(meshes, materialRecord.material);
      recordEdit(selectedNode, {
        nodeId: selectedNode.id,
        nodeName: selectedNode.name,
        nodePath: selectedNode.path,
        nodeLabel: labelFor(selectedNode),
        scope,
        kind: 'modelMaterial',
        materialName: materialRecord.name,
        color: materialRecord.original.color,
        optionName: `Material "${materialRecord.name}" from this file`,
        price: 0,
      });
      showToast(`"${materialRecord.name}" applied to ${meshCount} surface${meshCount === 1 ? '' : 's'}.`, 'success');
    },
    [selectedNode, scope, meshesFor, labelFor, recordEdit, showToast]
  );

  const handleResetNode = useCallback(
    (node) => {
      const editor = editorRef.current;
      if (!editor || !node) return;
      // Reset always covers the whole subtree: forgiving, and it cannot leave a
      // sub-part stranded with a finish the user thinks they have already undone.
      editor.resetMeshes(meshesFor(node, 'subtree'));
      setEdits((prev) => {
        const next = { ...prev };
        delete next[node.id];
        return next;
      });
      showToast(`${labelFor(node)} restored to the finish in the file.`, 'info');
    },
    [meshesFor, labelFor, showToast]
  );

  const handleResetAll = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const count = editor.resetAll();
    setEdits({});
    showToast(`All changes reverted (${count} surface${count === 1 ? '' : 's'}).`, 'info');
  }, [showToast]);

  // --- Saving --------------------------------------------------------------------

  const handleSave = useCallback(
    async (title) => {
      if (!sceneViewerRef.current || !model) return;
      setBusy(true);
      try {
        const dataUrl = sceneViewerRef.current.captureImage();
        if (!dataUrl || dataUrl.length < 512) throw new Error('the renderer returned an empty image');
        const pose = sceneViewerRef.current.getCameraPose();
        const thumbUrl = await makeThumbnail(dataUrl);
        const config = Object.values(edits).map((e) => ({
          nodeName: e.nodeName,
          nodePath: e.nodePath,
          nodeLabel: e.nodeLabel,
          scope: e.scope,
          kind: e.kind,
          groupId: e.groupId ?? null,
          groupLabel: e.groupLabel ?? null,
          optionCode: e.optionCode ?? null,
          optionName: e.optionName ?? null,
          materialName: e.materialName ?? null,
          color: e.color ?? null,
          price: e.price ?? 0,
          // The full option is stored so a capture can be re-applied later even if
          // the schedule document has changed or is no longer loaded.
          option: e.option ?? null,
        }));

        const record = await addCapture({
          groupId: slugify(title),
          title,
          modelKey: model.key,
          modelName: model.name,
          libraryName: library?.name ?? null,
          focusNodeName: selectedNode?.name ?? null,
          focusNodeLabel: selectedNode ? labelFor(selectedNode) : null,
          config,
          totalPrice,
          cameraPosition: pose?.position ?? null,
          cameraTarget: pose?.target ?? null,
          dataUrl,
          thumbUrl,
        });
        setCaptureRefreshToken((t) => t + 1);
        showToast(`Saved "${record.displayName}" to Saved Captures.`, 'success');
      } catch (err) {
        showToast(`Could not save: ${err.message}`, 'error');
      } finally {
        setBusy(false);
      }
    },
    [model, edits, totalPrice, library, selectedNode, labelFor, showToast]
  );

  const handleRestoreCapture = useCallback(
    async (capture) => {
      const editor = editorRef.current;
      if (!editor || !graph) {
        showToast('Load a model first, then re-apply a capture onto it.', 'error');
        return;
      }
      setActiveTab('configurator');
      setBusy(true);
      let applied = 0;
      const missing = [];
      const nextEdits = {};
      try {
        for (const entry of capture.config ?? []) {
          const node =
            graph.nodes.find((n) => n.path === entry.nodePath) ?? graph.nodes.find((n) => n.name === entry.nodeName);
          if (!node) {
            missing.push(entry.nodeLabel ?? entry.nodeName);
            continue;
          }
          const meshes = meshesFor(node, entry.scope === 'subtree' ? 'subtree' : 'smart');
          if (entry.kind === 'option' && entry.option) {
            await editor.applyOption(meshes, entry.option);
          } else if (entry.kind === 'color' && entry.color) {
            // The custom-colour picker has been removed from the UI, but captures
            // saved while it existed still hold 'color' entries — they must keep
            // re-applying, or an old saved scheme would come back incomplete.
            editor.applyColor(meshes, entry.color);
          } else if (entry.kind === 'modelMaterial' && entry.materialName) {
            const mat = graph.materials.find((m) => m.name === entry.materialName);
            if (!mat) {
              missing.push(entry.nodeLabel ?? entry.nodeName);
              continue;
            }
            editor.applyExistingMaterial(meshes, mat.material);
          } else if (entry.color) {
            editor.applyColor(meshes, entry.color);
          } else {
            missing.push(entry.nodeLabel ?? entry.nodeName);
            continue;
          }
          applied += 1;
          nextEdits[node.id] = { ...entry, nodeId: node.id, nodeLabel: entry.nodeLabel ?? labelFor(node) };
        }
        setEdits(nextEdits);

        if (capture.cameraPosition && capture.cameraTarget) {
          const [px, py, pz] = capture.cameraPosition;
          const [tx, ty, tz] = capture.cameraTarget;
          const dist = Math.hypot(px - tx, py - ty, pz - tz) || 1;
          setFlyTo({
            position: capture.cameraPosition,
            target: capture.cameraTarget,
            minDistance: Math.max(dist * 0.1, 0.05),
            maxDistance: dist * 6,
            enablePan: true,
            _t: Date.now(),
          });
        }

        if (missing.length > 0) {
          showToast(
            `Re-applied ${applied} of ${capture.config.length} finishes. Not found in this model: ${missing
              .slice(0, 3)
              .join(', ')}${missing.length > 3 ? `, +${missing.length - 3} more` : ''}.`,
            'error'
          );
        } else {
          showToast(`Re-applied ${applied} finish${applied === 1 ? '' : 'es'} from "${capture.displayName}".`, 'success');
        }
      } finally {
        setBusy(false);
      }
    },
    [graph, meshesFor, labelFor, showToast]
  );

  // --- Render --------------------------------------------------------------------

  const selectionBox = selectedNode?.box ?? null;

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="topbar-title">
          <strong>3D Configurator</strong>
          <span>{model ? model.name : 'Upload a .glb to begin'}</span>
        </div>

        <div className="tabs">
          <button className={`tab-btn ${activeTab === 'configurator' ? 'active' : ''}`} onClick={() => setActiveTab('configurator')}>
            Configurator
          </button>
          <button className={`tab-btn ${activeTab === 'inspector' ? 'active' : ''}`} onClick={() => setActiveTab('inspector')}>
            Materials &amp; Textures
            {graph && <em>{graph.stats.materialCount}</em>}
          </button>
          <button className={`tab-btn ${activeTab === 'captures' ? 'active' : ''}`} onClick={() => setActiveTab('captures')}>
            Saved Captures
          </button>
        </div>

        <div className="topbar-right">
          {/* Loading the client's finish schedule is a top-level task, so it gets a
              top-level control rather than living only at the bottom of a
              scrollable sidebar section. */}
          {graph && (
            <div className="schedule-status" title={library ? `${library.groups.length} groups, ${library.optionCount} options` : 'No material schedule loaded'}>
              <span className={library ? 'ok' : 'none'}>
                {library ? `Schedule: ${library.name}` : 'No material schedule'}
              </span>
              <ScheduleUploadButton onLoadFile={handleLoadLibraryFile} className="btn btn-sm">
                {library ? 'Replace…' : 'Upload schedule…'}
              </ScheduleUploadButton>
            </div>
          )}
          {editedNodeIds.size > 0 && (
            <>
              <div className="edit-count">
                {editedNodeIds.size} change{editedNodeIds.size === 1 ? '' : 's'}
              </div>
              {hasPricing && <div className="price-total">+${totalPrice.toLocaleString()}</div>}
              <button className="btn btn-sm" onClick={handleResetAll}>
                Revert all
              </button>
            </>
          )}
          {model && (
            <button className="btn btn-sm" onClick={() => resetForNewModel(null)}>
              Load another model
            </button>
          )}
        </div>
      </div>

      {activeTab === 'configurator' && (
        <Configurator
          sceneViewerRef={sceneViewerRef}
          model={model}
          graph={graph}
          sceneMeta={sceneMeta}
          onFileChosen={handleFileChosen}
          onSceneReady={handleSceneReady}
          flyTo={flyTo}
          flying={flying}
          onFlyStateChange={setFlying}
          selectionBox={selectionBox}
          selectedNode={selectedNode}
          onPickInScene={handlePickInScene}
          onHover={handleHover}
          hoverName={hoverName}
          onMiss={() => setHoverName(null)}
          onOverview={handleOverview}
          labelFor={labelFor}
          optionCountFor={optionCountFor}
          editedNodeIds={editedNodeIds}
          onSelectNode={handleSelectNode}
          matchedGroups={matchedGroups}
          edit={selectedNode ? edits[selectedNode.id] : null}
          scope={scope}
          scopeCounts={scopeCounts}
          onScopeChange={setScope}
          onApplyOption={handleApplyOption}
          onApplyModelMaterial={handleApplyModelMaterial}
          onResetNode={handleResetNode}
          library={library}
          libErrors={libErrors}
          libWarnings={libWarnings}
          coverage={coverage}
          workbook={workbook}
          onSelectSheet={handleSelectSheet}
          onLoadLibraryFile={handleLoadLibraryFile}
          onClearLibrary={handleClearLibrary}
          onSave={handleSave}
          canSave={!!model && !!graph}
          editCount={editedNodeIds.size}
          busy={busy}
          toast={toast}
        />
      )}

      {activeTab === 'inspector' && <InspectorPanel graph={graph} onSelectNode={handleSelectNode} />}

      {activeTab === 'captures' && (
        <SavedCaptures
          refreshToken={captureRefreshToken}
          onRestore={handleRestoreCapture}
          canRestore={!!graph}
          currentModelKey={model?.key ?? null}
        />
      )}
    </div>
  );
}
