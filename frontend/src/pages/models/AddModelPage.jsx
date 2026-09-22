import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import App from '../../App.jsx';
import {
  captures as capturesApi,
  models as modelsApi,
  projects as projectsApi,
  schedules as schedulesApi,
  saveCapture,
  uploadModel,
  CaptureStatus,
  CaptureTier,
} from '../../api/endpoints.js';
import { ErrorBox, Loading, Modal, useToast } from '../../components/uh/Ui.jsx';
import { ArrowLeftIcon, CheckIcon, UploadIcon } from '../../components/uh/Icons.jsx';
import { navigate } from '../../router/Router.jsx';

const MIN_ANGLES = 30; // agreed target coverage per model

/**
 * Module 1, /Add: upload a .glb and capture the angles the 2D configurator will use.
 *
 * Reached two ways — with no id to upload a new model, or with one to add more
 * angles to a model that already exists. Both paths converge on the same studio.
 */
export default function AddModelPage({ modelId: existingId }) {
  const toast = useToast();

  const [phase, setPhase] = useState(existingId ? 'fetching' : 'choose');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState(null);

  const [projects, setProjects] = useState(null);
  const [projectId, setProjectId] = useState('');
  const [newProjectName, setNewProjectName] = useState('');

  const [modelId, setModelId] = useState(existingId ?? null);
  const [modelName, setModelName] = useState('');
  const [localModel, setLocalModel] = useState(null); // { url, name, key, isBlob }
  const [scheduleShape, setScheduleShape] = useState(null);

  const [shots, setShots] = useState([]);
  const [publishing, setPublishing] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);

  const completedRef = useRef(false);
  const objectUrlRef = useRef(null);

  useEffect(
    () => () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    },
    []
  );

  // --- Loading an existing model ------------------------------------------------

  useEffect(() => {
    if (!existingId) return;
    let cancelled = false;

    (async () => {
      try {
        setProgress('Reading the model record…');
        const detail = await modelsApi.get(existingId);
        if (cancelled) return;
        setModelName(detail.name);

        // Its schedule, if one is attached, so the studio knows which visible parts
        // are configurable while angles are being lined up.
        if (detail.schedule) {
          try {
            const parsed = await schedulesApi.getParsed(existingId);
            if (!cancelled) setScheduleShape(parsed);
          } catch {
            /* the angles can still be captured without it */
          }
        }

        setProgress('Downloading the .glb…');
        const res = await fetch(detail.downloadUrl);
        if (!res.ok) throw new Error(`Blob Storage returned ${res.status} for the model file.`);
        const blob = await res.blob();
        if (cancelled) return;

        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        completedRef.current = true; // an existing model already has its counts
        setLocalModel({ url, name: detail.name, key: `api:${existingId}`, isBlob: true, externalUrl: true });
        setPhase('studio');
      } catch (err) {
        if (!cancelled) {
          setError(
            err.name === 'TypeError'
              ? new Error(
                  'The browser could not download the .glb from Blob Storage. Add this origin to the storage account CORS rules (allowed methods GET, allowed headers *).'
                )
              : err
          );
          setPhase('error');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [existingId]);

  // --- Projects (new model only) --------------------------------------------------

  useEffect(() => {
    if (existingId) return;
    projectsApi
      .list()
      .then((list) => {
        setProjects(list);
        if (list.length > 0) setProjectId(list[0].id);
        else setNewProjectName('UH Homes');
      })
      .catch(setError);
  }, [existingId]);

  const handleFilePicked = useCallback(
    async (file) => {
      if (!file) return;
      if (!/\.glb$/i.test(file.name)) {
        toast.show('Please choose a .glb file.', 'error');
        return;
      }

      setError(null);
      setPhase('uploading');
      try {
        let pid = projectId;
        if (!pid) {
          setProgress('Creating the project…');
          const created = await projectsApi.create(newProjectName.trim() || 'UH Homes', null);
          pid = created.id;
          setProjectId(pid);
        }

        // The counts are filled in by complete() once the studio has parsed the
        // file, so a zeroed placeholder goes up with the reservation.
        const id = await uploadModel({
          projectId: pid,
          file,
          stats: { nodeCount: 0, meshCount: 0, materialCount: 0, textureCount: 0 },
          onProgress: setProgress,
        });

        const url = URL.createObjectURL(file);
        objectUrlRef.current = url;
        setModelId(id);
        setModelName(file.name);
        setLocalModel({ url, name: file.name, key: `api:${id}`, isBlob: true, externalUrl: true });
        setPhase('studio');
        toast.show(`"${file.name}" uploaded. Capture the angles you need.`, 'success');
      } catch (err) {
        setError(err);
        setPhase('choose');
      }
    },
    [projectId, newProjectName, toast]
  );

  // --- Studio callbacks ------------------------------------------------------------

  const refreshShots = useCallback(async (id) => {
    try {
      setShots(await capturesApi.list(id));
    } catch {
      /* the strip is a convenience; a failure here must not break capturing */
    }
  }, []);

  useEffect(() => {
    if (modelId && phase === 'studio') refreshShots(modelId);
  }, [modelId, phase, refreshShots]);

  const handleGraphReady = useCallback(
    (stats) => {
      if (completedRef.current || !modelId) return;
      completedRef.current = true;
      // Records what the file actually contains, so the list view and the render
      // worker see the same numbers the configurator does.
      modelsApi.complete(modelId, { ...stats, contentHash: null }).catch(() => {
        completedRef.current = false;
      });
    },
    [modelId]
  );

  const handleSaveCapture = useCallback(
    async (payload) => {
      if (!modelId) return;
      try {
        await saveCapture({
          modelId,
          name: payload.title,
          sortOrder: shots.length,
          tier: payload.focusNodeName ? CaptureTier.Detail : CaptureTier.Full,
          dataUrl: payload.dataUrl,
          thumbDataUrl: payload.thumbUrl,
          pose: payload.pose,
          width: payload.width,
          height: payload.height,
          visibleNodes: payload.visibleNodes,
          configurableNodes: payload.configurableNodes,
        });
        await refreshShots(modelId);
        toast.show(
          `Captured "${payload.title}" — ${payload.visibleNodes.length} part${
            payload.visibleNodes.length === 1 ? '' : 's'
          } visible, ${payload.configurableNodes.length} configurable.`,
          'success'
        );
      } catch (err) {
        toast.show(err.message, 'error');
        throw err;
      }
    },
    [modelId, shots.length, refreshShots, toast]
  );

  const studio = useMemo(
    () => ({
      initialModel: localModel,
      scheduleShape,
      onGraphReady: handleGraphReady,
      onSaveCapture: handleSaveCapture,
    }),
    [localModel, scheduleShape, handleGraphReady, handleSaveCapture]
  );

  // --- Publishing -------------------------------------------------------------------

  const draftIds = useMemo(() => shots.filter((s) => s.status === CaptureStatus.Draft).map((s) => s.id), [shots]);

  async function handlePublish() {
    setPublishing(true);
    try {
      const res = await capturesApi.publish(modelId, draftIds, true);
      await refreshShots(modelId);
      setConfirmPublish(false);
      toast.show(
        `${res.publishedCount} capture${res.publishedCount === 1 ? '' : 's'} published` +
          (res.queuedForLayers > 0 ? `, ${res.queuedForLayers} queued for layer rendering.` : '.'),
        'success'
      );
    } catch (err) {
      toast.show(err.message, 'error');
    } finally {
      setPublishing(false);
    }
  }

  // --- Render ------------------------------------------------------------------------

  if (phase === 'error') {
    return (
      <div className="uh-page">
        <ErrorBox error={error} />
        <div style={{ marginTop: 14 }}>
          <button className="uh-btn" onClick={() => navigate('/models')}>
            <ArrowLeftIcon size={16} />
            Back to models
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'fetching' || phase === 'uploading') {
    return (
      <div className="uh-page">
        <Loading label={progress || 'Working…'} />
      </div>
    );
  }

  if (phase === 'choose') {
    return (
      <div className="uh-page" style={{ maxWidth: 680 }}>
        <div className="uh-page-head">
          <div>
            <h1 className="uh-page-title">Add a model</h1>
            <p className="uh-page-sub">Upload a .glb, then capture the angles the configurator will offer.</p>
          </div>
        </div>

        {error && (
          <div style={{ marginBottom: 16 }}>
            <ErrorBox error={error} />
          </div>
        )}

        <div className="uh-card uh-card-pad">
          <label className="uh-label" style={{ color: '#2a3048' }} htmlFor="uh-project">
            Project
          </label>
          {projects === null ? (
            <Loading label="Loading projects…" />
          ) : projects.length > 0 ? (
            <select
              id="uh-project"
              className="uh-inline-input"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.modelCount} model{p.modelCount === 1 ? '' : 's'})
                </option>
              ))}
            </select>
          ) : (
            <>
              <input
                id="uh-project"
                className="uh-inline-input"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="Project name"
              />
              <p className="uh-hint" style={{ color: '#77819c' }}>
                No projects exist yet — this one will be created with the first upload.
              </p>
            </>
          )}

          <div style={{ marginTop: 22, paddingTop: 20, borderTop: '1px solid #edeff5' }}>
            <label className="uh-label" style={{ color: '#2a3048' }}>
              Model file
            </label>
            <p className="uh-hint" style={{ color: '#77819c', marginBottom: 12 }}>
              The app reads the file itself — nodes, sub-nodes, materials and textures — so no naming convention is
              required. The file uploads straight to Blob Storage, not through the API.
            </p>
            <label className="uh-btn gold" style={{ cursor: 'pointer' }}>
              <UploadIcon size={17} />
              Choose .glb file
              <input
                type="file"
                accept=".glb,model/gltf-binary"
                style={{ display: 'none' }}
                onChange={(e) => handleFilePicked(e.target.files?.[0])}
              />
            </label>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <button className="uh-btn" onClick={() => navigate('/models')}>
            <ArrowLeftIcon size={16} />
            Back to models
          </button>
        </div>

        {toast.node}
      </div>
    );
  }

  // --- Studio -------------------------------------------------------------------------

  const published = shots.filter((s) => s.status === CaptureStatus.Published).length;

  return (
    <div className="uh-studio">
      <div className="uh-studio-bar">
        <button className="uh-btn sm" onClick={() => navigate('/models')}>
          <ArrowLeftIcon size={15} />
          Models
        </button>
        <div className="uh-studio-title">{modelName}</div>
        <div className="uh-studio-step">
          {shots.length} of {MIN_ANGLES} angles · {published} published
          {!scheduleShape && ' · no schedule attached yet'}
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="uh-btn sm" onClick={() => navigate(`/models/${modelId}/update`)}>
            Manage captures
          </button>
          <button className="uh-btn sm gold" disabled={draftIds.length === 0} onClick={() => setConfirmPublish(true)}>
            <CheckIcon size={15} />
            Save All ({draftIds.length})
          </button>
        </div>
      </div>

      <div className="uh-studio-body">
        <App studio={studio} />
      </div>

      <div className="uh-strip">
        {shots.length === 0 ? (
          <div className="uh-strip-empty">
            No angles captured yet. Frame a view, then use <strong>Capture 2D Image</strong> to save it.
          </div>
        ) : (
          shots.map((s) => (
            <div key={s.id} className="uh-shot" title={`${s.name} · ${s.visibleNodes.length} parts visible`}>
              <img src={s.thumbnailUrl} alt={s.name} loading="lazy" />
              <div className="uh-shot-cap">
                <span>{s.name}</span>
                <i className={`uh-dot ${s.status === CaptureStatus.Published ? 'published' : ''}`} />
              </div>
            </div>
          ))
        )}
      </div>

      {confirmPublish && (
        <Modal
          title={`Publish ${draftIds.length} capture${draftIds.length === 1 ? '' : 's'}?`}
          confirmLabel="Save All"
          busy={publishing}
          onCancel={() => setConfirmPublish(false)}
          onConfirm={handlePublish}
        >
          Published angles become visible in the Image Configurator. Layer rendering is queued at the same time, so each
          configurable part gets one image per option — the configurator then swaps layers instead of re-rendering.
          {!scheduleShape && (
            <p style={{ marginTop: 10, color: '#8a6a1d' }}>
              No schedule is attached to this model yet. You can publish now and attach the workbook afterwards —
              layers are generated once it arrives.
            </p>
          )}
        </Modal>
      )}

      {toast.node}
    </div>
  );
}
