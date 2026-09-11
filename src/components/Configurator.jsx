import React, { useEffect, useState } from 'react';
import { useProgress } from '@react-three/drei';
import SceneViewer from './SceneViewer.jsx';
import UploadPanel from './UploadPanel.jsx';
import NodeTree from './NodeTree.jsx';
import FinishPanel from './FinishPanel.jsx';
import LibraryPanel from './LibraryPanel.jsx';

function SaveDialog({ defaultName, editCount, busy, onCancel, onSave }) {
  const [name, setName] = useState(defaultName);
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h3>Save changes</h3>
        <p className="muted small">
          Stores the current view as an image together with the {editCount} finish change{editCount === 1 ? '' : 's'} behind
          it. Saving under a name you have used before adds a new version next to it, so alternatives stay side by side.
        </p>
        {editCount === 0 && (
          <div className="panel-note warn">
            Nothing has been changed yet — this will save the model exactly as delivered. That is a valid &quot;before&quot;
            shot, just be aware it records no finishes.
          </div>
        )}
        <label className="modal-label">
          Name
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) onSave(name.trim());
              if (e.key === 'Escape') onCancel();
            }}
            placeholder="e.g. kitchen_floor"
          />
        </label>
        <div className="modal-actions">
          <button className="btn" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary" type="button" disabled={!name.trim() || busy} onClick={() => onSave(name.trim())}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function LoadingOverlay({ modelName, sizeMB }) {
  const { active, progress, item } = useProgress();
  if (!active) return null;
  return (
    <div className="loading-overlay">
      <div className="loading-card">
        <div className="spinner" />
        <strong>Loading {modelName ?? 'model'}…</strong>
        <div className="loading-bar">
          <i style={{ width: `${Math.max(4, progress)}%` }} />
        </div>
        <span className="muted small">
          {Math.round(progress)}%{sizeMB ? ` · ${sizeMB.toFixed(1)} MB` : ''}
          {item ? ` · ${String(item).slice(0, 60)}` : ''}
        </span>
      </div>
    </div>
  );
}

// Dropping a file on the 3D view is the other obvious way someone tries to load a
// document, so it is wired up and routed by extension: a model replaces the model, a
// schedule loads as the schedule.
function useViewportDrop({ onFileChosen, onLoadLibraryFile, enabled }) {
  const [dragKind, setDragKind] = useState(null);

  const handlers = enabled
    ? {
        onDragOver: (e) => {
          e.preventDefault();
          setDragKind('file');
        },
        onDragLeave: () => setDragKind(null),
        onDrop: (e) => {
          e.preventDefault();
          setDragKind(null);
          const file = e.dataTransfer.files?.[0];
          if (!file) return;
          const name = file.name.toLowerCase();
          if (/\.(xlsx|xlsm|xls|csv|json)$/.test(name)) onLoadLibraryFile(file);
          else onFileChosen(file);
        },
      }
    : {};

  return { dragKind, handlers };
}

export default function Configurator({
  sceneViewerRef,
  model,
  graph,
  sceneMeta,
  onFileChosen,
  onSampleChosen,
  onSceneReady,
  flyTo,
  flying,
  onFlyStateChange,
  selectionBox,
  selectedNode,
  onPickInScene,
  onHover,
  hoverName,
  onMiss,
  onOverview,
  labelFor,
  optionCountFor,
  isScheduled,
  editedNodeIds,
  onSelectNode,
  matchedGroups,
  edit,
  scope,
  scopeCounts,
  onScopeChange,
  onApplyOption,
  onApplyColor,
  onApplyModelMaterial,
  onResetNode,
  library,
  libErrors,
  libWarnings,
  coverage,
  samples,
  workbook,
  onSelectSheet,
  onLoadLibraryFile,
  onLoadLibrarySample,
  onClearLibrary,
  onSave,
  canSave,
  editCount,
  busy,
  toast,
}) {
  const [saveOpen, setSaveOpen] = useState(false);
  const { dragKind, handlers: dropHandlers } = useViewportDrop({
    onFileChosen,
    onLoadLibraryFile,
    enabled: !!model,
  });

  // Keyboard shortcuts that a repeat user will want: Esc clears the selection,
  // "o" returns to the overview shot.
  useEffect(() => {
    const onKey = (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Escape') onMiss?.();
      if (e.key === 'o' || e.key === 'O') onOverview?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onMiss, onOverview]);

  return (
    <div className="configurator">
      <aside className="sidebar">
        {graph ? (
          <>
            <div className="sidebar-section grow">
              <h3 className="sidebar-title">Model contents</h3>
              <NodeTree
                graph={graph}
                labelFor={labelFor}
                selectedId={selectedNode?.id ?? null}
                editedNodeIds={editedNodeIds}
                optionCountFor={optionCountFor}
                isScheduled={isScheduled}
                onSelect={onSelectNode}
              />
            </div>
            <div className="sidebar-section schedule">
              <LibraryPanel
                library={library}
                errors={libErrors}
                warnings={libWarnings}
                coverage={coverage}
                samples={samples}
                workbook={workbook}
                onSelectSheet={onSelectSheet}
                graph={graph}
                onLoadFile={onLoadLibraryFile}
                onLoadSample={onLoadLibrarySample}
                onClear={onClearLibrary}
                onSelectNode={onSelectNode}
              />
            </div>
          </>
        ) : (
          <div className="sidebar-section">
            <p className="muted small">
              The model tree, its materials and its textures appear here once a .glb is loaded.
            </p>
          </div>
        )}
      </aside>

      <div className="viewport" {...dropHandlers}>
        <SceneViewer
          ref={sceneViewerRef}
          glbUrl={model?.url ?? null}
          flyTo={flyTo}
          groundY={sceneMeta?.groundY}
          sceneCenter={sceneMeta?.center}
          sceneRadius={sceneMeta?.radius}
          selectionBox={selectionBox}
          showGround
          onPick={onPickInScene}
          onHover={onHover}
          onMiss={onMiss}
          onSceneReady={onSceneReady}
          onFlyStateChange={onFlyStateChange}
        />

        {!model && <UploadPanel onFileChosen={onFileChosen} onSampleChosen={onSampleChosen} />}
        {model && <LoadingOverlay modelName={model.name} sizeMB={model.sizeMB} />}

        {model && graph && (
          <>
            <div className="viewport-toolbar">
              <button className="pill" type="button" onClick={onOverview} title="Back to the whole model (O)">
                ⤢ Overview
              </button>
              {selectedNode && (
                <div className="pill selected-pill">
                  {labelFor(selectedNode)}
                  <em>{selectedNode.name}</em>
                </div>
              )}
              <div className="toolbar-spacer" />
              <button
                className="pill primary"
                type="button"
                disabled={!canSave || busy}
                onClick={() => setSaveOpen(true)}
                title="Save this view and the finishes applied"
              >
                💾 Save changes
              </button>
            </div>

            <div className="viewport-hints">
              {flying ? 'Flying to selection…' : hoverName ? `Click to select: ${hoverName}` : 'Click a surface to select it · drag to orbit · scroll to zoom'}
            </div>
          </>
        )}

        {dragKind && (
          <div className="drop-hint">
            <div>
              <strong>Drop to load</strong>
              <span>
                <code>.xlsx</code> / <code>.csv</code> / <code>.json</code> loads a material schedule · <code>.glb</code>{' '}
                replaces the model
              </span>
            </div>
          </div>
        )}

        {toast && <div className={`capture-toast ${toast.kind}`}>{toast.message}</div>}
      </div>

      <FinishPanel
        graph={graph}
        node={selectedNode}
        labelFor={labelFor}
        matchedGroups={matchedGroups}
        edit={edit}
        scope={scope}
        scopeCounts={scopeCounts}
        onScopeChange={onScopeChange}
        onApplyOption={onApplyOption}
        onApplyColor={onApplyColor}
        onApplyModelMaterial={onApplyModelMaterial}
        onResetNode={onResetNode}
        onSelectNode={onSelectNode}
        library={library}
        busy={busy}
      />

      {saveOpen && (
        <SaveDialog
          defaultName={selectedNode?.name || 'overview'}
          editCount={editCount}
          busy={busy}
          onCancel={() => setSaveOpen(false)}
          onSave={async (name) => {
            await onSave(name);
            setSaveOpen(false);
          }}
        />
      )}
    </div>
  );
}
