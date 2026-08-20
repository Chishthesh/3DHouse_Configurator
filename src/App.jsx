import React, { useMemo, useRef, useState } from 'react';
import Configurator from './components/Configurator.jsx';
import SavedCaptures from './components/SavedCaptures.jsx';
import { ZONES, CATEGORY_SHORT_WORD, categoryZones } from './data/zoneSpec.js';
import { applyZoneOption } from './utils/zoneResolve.js';
import { addCapture, slugify } from './utils/captureStore.js';
import { discoverAreas, discoverPresentZones, frameForWholeScene, frameForBox, tintNode, resetNodeTint } from './utils/sceneAnalysis.js';

export default function App() {
  const [activeTab, setActiveTab] = useState('configurator');
  const [glbUrl, setGlbUrl] = useState(null);
  const [selections, setSelections] = useState({});
  const [activeCategory, setActiveCategory] = useState(null);
  const [activeZone, setActiveZone] = useState(null);
  const [areas, setAreas] = useState([]);
  const [presentZones, setPresentZones] = useState([]); // [{ zoneKey, box }]
  const [activeAreaId, setActiveAreaId] = useState(null);
  const [genericTints, setGenericTints] = useState({}); // areaId -> current hex color
  const [groundY, setGroundY] = useState(-0.05);
  const [flyTo, setFlyTo] = useState(null);
  const [selectedZoneKey, setSelectedZoneKey] = useState(null);
  const [editingCapture, setEditingCapture] = useState(null);
  const [toast, setToast] = useState(null);
  const [captureRefreshToken, setCaptureRefreshToken] = useState(0);

  const sceneViewerRef = useRef(null);
  const sceneRef = useRef(null);
  const toastTimer = useRef(null);

  const presentZoneKeys = useMemo(() => new Set(presentZones.map((z) => z.zoneKey)), [presentZones]);
  // Areas that aren't one of the 14 known {category}_{zone} groups have no curated
  // option catalog — offer them a plain color tint instead, purely additive to the
  // curated system (never shown for areas that already match a real zone).
  const genericAreas = useMemo(() => areas.filter((a) => !ZONES[a.id]), [areas]);
  const totalPrice = useMemo(() => Object.values(selections).reduce((sum, opt) => sum + (opt?.price || 0), 0), [selections]);

  function resetForNewModel(url) {
    setGlbUrl(url);
    setSelections({});
    setSelectedZoneKey(null);
    setEditingCapture(null);
    setAreas([]);
    setPresentZones([]);
    setActiveAreaId(null);
    setGenericTints({});
    setActiveCategory(null);
    setActiveZone(null);
    setFlyTo(null);
    sceneRef.current = null;
  }

  function handleFileChosen(fileOrUrl) {
    if (typeof fileOrUrl === 'string') {
      resetForNewModel(fileOrUrl);
      return;
    }
    const url = URL.createObjectURL(fileOrUrl);
    resetForNewModel(url);
  }

  // Everything below is derived by inspecting the scene graph that was actually
  // loaded — no room names or coordinates are hardcoded anywhere in this app.
  function handleSceneReady(scene) {
    sceneRef.current = scene;

    // "structure_" nodes are explicitly non-configurable per the spec (roofs, framing,
    // etc.) — they're real nodes in the file, but not useful as walkthrough stops, so
    // they're left out of the nav pills while everything else stays fully dynamic.
    const discoveredAreas = discoverAreas(scene).filter((a) => !a.id.startsWith('structure_'));
    setAreas(discoveredAreas);

    const zones = discoverPresentZones(scene);
    setPresentZones(zones);
    if (zones.length > 0) {
      setActiveCategory(ZONES[zones[0].zoneKey].category);
      setActiveZone(zones[0].zoneKey);
    } else {
      setActiveCategory(null);
      setActiveZone(null);
    }

    const overview = frameForWholeScene(scene);
    setGroundY(overview.box.min.y - 0.02);
    setActiveAreaId(null);
    setFlyTo({ position: overview.position, target: overview.target, minDistance: overview.minDistance, maxDistance: overview.maxDistance, enablePan: overview.enablePan, _t: Date.now() });
  }

  function handleCategoryChange(cat) {
    setActiveCategory(cat);
    const firstPresent = categoryZones(cat).find((zk) => presentZoneKeys.has(zk));
    setActiveZone(firstPresent ?? null);
  }

  function handleAreaSelect(area) {
    setActiveAreaId(area.id);
    const frame = frameForBox(area.box);
    setFlyTo({ ...frame, _t: Date.now() });
  }

  function handleGenericTint(area, colorHex) {
    tintNode(area.node, colorHex);
    setGenericTints((prev) => ({ ...prev, [area.id]: colorHex }));
  }

  function handleGenericReset(area) {
    resetNodeTint(area.node);
    setGenericTints((prev) => {
      const next = { ...prev };
      delete next[area.id];
      return next;
    });
  }

  function handleZoneClick(zoneKey) {
    setSelectedZoneKey(zoneKey);
    setActiveAreaId(null);
    if (zoneKey) {
      setActiveCategory(ZONES[zoneKey].category);
      setActiveZone(zoneKey);
    }
  }

  function handlePick(zoneKey, option) {
    setSelections((prev) => ({ ...prev, [zoneKey]: option }));
    if (sceneRef.current) applyZoneOption(sceneRef.current, zoneKey, option);
  }

  function showToast(message) {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }

  async function handleCapture() {
    if (!sceneViewerRef.current) return;
    const dataUrl = sceneViewerRef.current.captureImage();
    const pose = sceneViewerRef.current.getCameraPose();
    if (!dataUrl) return;

    const zoneKey = editingCapture?.zoneKey ?? selectedZoneKey ?? activeZone ?? null;
    const areaId = editingCapture?.areaId ?? activeAreaId ?? 'view';
    const areaLabel = areas.find((a) => a.id === areaId)?.label ?? (areaId === 'view' ? 'Overview' : areaId);

    let groupId, zoneLabel, materialChoice;
    if (zoneKey && ZONES[zoneKey]) {
      zoneLabel = ZONES[zoneKey].label;
      materialChoice = selections[zoneKey] ?? ZONES[zoneKey].default;
      groupId = editingCapture?.groupId ?? slugify(`${areaId}_${CATEGORY_SHORT_WORD[ZONES[zoneKey].category]}`);
    } else {
      zoneLabel = null;
      materialChoice = null;
      groupId = slugify(`${areaId}_view`);
    }

    const record = await addCapture({
      groupId,
      zoneKey,
      zoneLabel,
      roomLabel: areaLabel,
      materialChoice,
      cameraPosition: pose?.position ?? null,
      cameraTarget: pose?.target ?? null,
      dataUrl,
    });

    setCaptureRefreshToken((t) => t + 1);
    showToast(`Saved "${record.displayName}" to Saved Captures`);
  }

  function handleEditCapture(capture) {
    if (!capture.zoneKey) return;
    const areaId = areas.find((a) => a.label === capture.roomLabel)?.id ?? null;
    setActiveTab('configurator');
    setActiveAreaId(areaId);
    setActiveCategory(ZONES[capture.zoneKey].category);
    setActiveZone(capture.zoneKey);
    setSelectedZoneKey(capture.zoneKey);
    setEditingCapture({ groupId: capture.groupId, zoneKey: capture.zoneKey, areaId: areaId ?? 'view' });

    if (capture.materialChoice && sceneRef.current) {
      applyZoneOption(sceneRef.current, capture.zoneKey, capture.materialChoice);
      setSelections((prev) => ({ ...prev, [capture.zoneKey]: capture.materialChoice }));
    }
    if (capture.cameraPosition && capture.cameraTarget) {
      // Derive sensible zoom limits from the saved shot itself (distance from camera
      // to target) rather than any named-room lookup, since captures can outlive
      // whichever model produced them.
      const [px, py, pz] = capture.cameraPosition;
      const [tx, ty, tz] = capture.cameraTarget;
      const dist = Math.hypot(px - tx, py - ty, pz - tz) || 1;
      setFlyTo({
        position: capture.cameraPosition,
        target: capture.cameraTarget,
        minDistance: Math.max(dist * 0.15, 0.15),
        maxDistance: dist * 4,
        enablePan: false,
        _t: Date.now(),
      });
    }
  }

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="topbar-title">
          <strong>3D House Configurator</strong>
          <span>Upload any spec-compliant .glb to customize it</span>
        </div>

        <div className="tabs">
          <button className={`tab-btn ${activeTab === 'configurator' ? 'active' : ''}`} onClick={() => setActiveTab('configurator')}>
            Configurator
          </button>
          <button className={`tab-btn ${activeTab === 'captures' ? 'active' : ''}`} onClick={() => setActiveTab('captures')}>
            Saved Captures
          </button>
        </div>

        <div className="topbar-right">
          {glbUrl && <div className="price-total">+${totalPrice.toLocaleString()}</div>}
          {glbUrl && (
            <button className="btn" onClick={() => resetForNewModel(null)}>
              Upload different model
            </button>
          )}
        </div>
      </div>

      {activeTab === 'configurator' ? (
        <Configurator
          sceneViewerRef={sceneViewerRef}
          glbUrl={glbUrl}
          onFileChosen={handleFileChosen}
          onSceneReady={handleSceneReady}
          flyTo={flyTo}
          groundY={groundY}
          areas={areas}
          activeAreaId={activeAreaId}
          onAreaSelect={handleAreaSelect}
          onZoneClick={handleZoneClick}
          selectedZoneKey={selectedZoneKey}
          activeCategory={activeCategory}
          setActiveCategory={handleCategoryChange}
          activeZone={activeZone}
          setActiveZone={setActiveZone}
          presentZoneKeys={presentZoneKeys}
          genericAreas={genericAreas}
          genericTints={genericTints}
          onGenericTint={handleGenericTint}
          onGenericReset={handleGenericReset}
          selections={selections}
          onPick={handlePick}
          onCapture={handleCapture}
          toast={toast}
          editingCapture={editingCapture}
        />
      ) : (
        <SavedCaptures refreshToken={captureRefreshToken} onEditCapture={handleEditCapture} />
      )}
    </div>
  );
}
