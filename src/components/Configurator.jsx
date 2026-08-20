import React from 'react';
import SceneViewer from './SceneViewer.jsx';
import UploadPanel from './UploadPanel.jsx';
import OptionPanel from './OptionPanel.jsx';
import { ZONES } from '../data/zoneSpec.js';

export default function Configurator({
  sceneViewerRef,
  glbUrl,
  onFileChosen,
  flyTo,
  groundY,
  areas,
  activeAreaId,
  onAreaSelect,
  onZoneClick,
  selectedZoneKey,
  activeCategory,
  setActiveCategory,
  activeZone,
  setActiveZone,
  presentZoneKeys,
  genericAreas,
  genericTints,
  onGenericTint,
  onGenericReset,
  selections,
  onPick,
  onCapture,
  toast,
  editingCapture,
  onSceneReady,
}) {
  return (
    <div className="configurator">
      <div className="viewport">
        <SceneViewer ref={sceneViewerRef} glbUrl={glbUrl} flyTo={flyTo} groundY={groundY} onZoneClick={onZoneClick} onSceneReady={onSceneReady} />

        {!glbUrl && <UploadPanel onFileChosen={onFileChosen} sampleUrl="/models/sample-house.glb" />}

        {glbUrl && (
          <>
            {selectedZoneKey && (
              <div className="selected-zone-badge">
                {ZONES[selectedZoneKey].label} <span>· click "Capture" to save this view</span>
              </div>
            )}

            {editingCapture && (
              <div className="selected-zone-badge" style={{ top: selectedZoneKey ? 56 : 16 }}>
                Editing capture <strong>{editingCapture.groupId}</strong>
              </div>
            )}

            <div className="room-presets">
              {areas.map((area) => (
                <button key={area.id} className={`room-pill ${activeAreaId === area.id ? 'active' : ''}`} onClick={() => onAreaSelect(area)}>
                  {area.label}
                </button>
              ))}
              <button className="room-pill" style={{ background: 'var(--accent-green)' }} onClick={onCapture}>
                📷 Capture
              </button>
            </div>

            {toast && <div className="capture-toast">{toast}</div>}
          </>
        )}
      </div>

      <OptionPanel
        activeCategory={activeCategory}
        setActiveCategory={setActiveCategory}
        activeZone={activeZone}
        setActiveZone={setActiveZone}
        presentZoneKeys={presentZoneKeys}
        genericAreas={genericAreas}
        genericTints={genericTints}
        onGenericTint={onGenericTint}
        onGenericReset={onGenericReset}
        selections={selections}
        onPick={onPick}
      />
    </div>
  );
}
