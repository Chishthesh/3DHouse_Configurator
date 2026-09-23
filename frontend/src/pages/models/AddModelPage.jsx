import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import App from '../../App.jsx';
import {
  captures as capturesApi,
  layers as layersApi,
  models as modelsApi,
  projects as projectsApi,
  schedules as schedulesApi,
  saveCapture,
  uploadLayer,
  uploadModel,
  CaptureStatus,
  CaptureTier,
  LayerStatus,
} from '../../api/endpoints.js';
import { describeStorageFailure } from '../../api/client.js';
import { ErrorBox, Loading, Modal, useToast } from '../../components/uh/Ui.jsx';
import { ArrowLeftIcon, CheckIcon, LayersIcon, UploadIcon } from '../../components/uh/Icons.jsx';
import { navigate } from '../../router/Router.jsx';

const MIN_ANGLES = 30; // agreed target coverage per model

/**
 * Module 1, /Add: upload a .glb and capture the angles the 2D configurator will use.
 *
 * Reached two ways — with no id to upload a new model, or with one to add more
 * angles to a model that already exists. Both paths converge on the same studio.
 */
export default function AddModelPage({ modelId: existingId, autoGenerate = false }) {
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

  // Set by the studio once the model and schedule are both loaded; null until then.
  const layerRunnerRef = useRef(null);
  const [layerReady, setLayerReady] = useState(false);
  const [layerRun, setLayerRun] = useState(null); // { capture, index, total, label }
  const cancelLayersRef = useRef(false);

  const registerLayerRunner = useCallback((fn) => {
    layerRunnerRef.current = fn;
    setLayerReady(!!fn);
  }, []);

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

    // Held outside the try so the failure path can say which host went silent.
    let downloadUrl = null;

    (async () => {
      try {
        setProgress('Reading the model record…');
        const detail = await modelsApi.get(existingId);
        if (cancelled) return;
        setModelName(detail.name);
        downloadUrl = detail.downloadUrl;

        setProgress('Downloading the .glb…');
        const res = await fetch(downloadUrl);
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
          // A failed fetch says nothing about why. Ask, rather than assume.
          setError(
            err.name === 'TypeError' && downloadUrl
              ? new Error(await describeStorageFailure(downloadUrl))
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

  // The workbook can be attached at any point in a model's life — including long
  // after it was uploaded and captured — so the studio fetches it whenever it has a
  // model, not only when reopening an existing one.
  //
  // Fetching it only on the reopen path meant a model uploaded, captured and
  // published in one sitting never had a schedule here. Without one there is nothing
  // to render options against, so the layer runner was never offered and publishing
  // could not produce layers. The angle then reached the configurator looking
  // complete and unable to change its own picture.
  useEffect(() => {
    if (!modelId || phase !== 'studio') return undefined;
    let cancelled = false;
    schedulesApi
      .getParsed(modelId)
      .then((parsed) => {
        if (!cancelled && parsed) setScheduleShape(parsed);
      })
      .catch(() => {
        /* none attached yet — angles can still be captured */
      });
    return () => {
      cancelled = true;
    };
  }, [modelId, phase]);

  // Published angles whose layers were never rendered. These are the ones that look
  // finished in the configurator but cannot respond to a choice.
  const pendingLayers = useMemo(
    () => shots.filter((s) => s.status === CaptureStatus.Published && s.layerCount === 0),
    [shots]
  );

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
      registerLayerRunner,
    }),
    [localModel, scheduleShape, handleGraphReady, handleSaveCapture, registerLayerRunner]
  );

  // --- Layer generation ---------------------------------------------------------------

  /**
   * Renders every option image for the published captures of this model.
   *
   * This is the step that makes the configurator's images actually change. Each
   * layer is one part wearing one option, cut to that part's silhouette, so the
   * configurator stacks them over the base image instead of re-rendering.
   */
  async function handleGenerateLayers(targetsOverride = null) {
    const runner = layerRunnerRef.current;
    if (!runner) return;

    // Publishing passes the captures it just published, because `shots` will not
    // have caught up with the state change yet.
    const targets = targetsOverride ?? shots.filter((s) => s.status === CaptureStatus.Published);
    if (targets.length === 0) {
      if (!targetsOverride) toast.show('Publish some angles first — layers are rendered for published captures.', 'error');
      return;
    }

    cancelLayersRef.current = false;
    let totalRendered = 0;
    const problems = [];

    try {
      for (const shot of targets) {
        if (cancelLayersRef.current) break;

        // The spec carries the exact pose the angle was shot from, so the layers
        // line up with the base image pixel for pixel.
        const spec = await layersApi.spec(shot.id);
        const configurable = JSON.parse(spec.configurableNodesJson || '[]');
        const visible = JSON.parse(spec.visibleNodesJson || '[]');
        // Captures taken before the workbook arrived have no configurable list;
        // fall back to everything visible and let the schedule decide.
        const nodeNames = configurable.length > 0 ? configurable : visible;

        setLayerRun({ capture: shot.name, index: 0, total: 0, label: 'working out what to render…' });

        const result = await runner({
          pose: {
            position: spec.pose.camera,
            target: spec.pose.target,
            fov: spec.pose.fov,
          },
          width: spec.width,
          height: spec.height,
          nodeNames,
          shouldStop: () => cancelLayersRef.current,
          onProgress: ({ index, total, nodeName, optionName }) =>
            setLayerRun({ capture: shot.name, index, total, label: nodeName ? `${nodeName} · ${optionName}` : optionName }),
          upload: ({ nodeName, optionKey, blob }) => uploadLayer({ captureId: shot.id, nodeName, optionKey, blob }),
        });

        totalRendered += result.rendered;
        problems.push(...result.failures);

        await layersApi.reportStatus(
          shot.id,
          result.failures.length > 0 && result.rendered === 0 ? LayerStatus.Failed : LayerStatus.Complete,
          result.failures[0] ?? null
        );
      }

      await refreshShots(modelId);
      toast.show(
        cancelLayersRef.current
          ? `Stopped after ${totalRendered} layers.`
          : `${totalRendered} layer${totalRendered === 1 ? '' : 's'} rendered.` +
              (problems.length > 0 ? ` ${problems.length} failed.` : ''),
        problems.length > 0 && totalRendered === 0 ? 'error' : 'success'
      );
    } catch (err) {
      toast.show(`Layer generation stopped: ${err.message}`, 'error');
    } finally {
      setLayerRun(null);
    }
  }

  // Arriving from the configurator with ?generate=1 means someone pressed "render
  // these layers" over there, where there is no 3D scene to render with. Start as
  // soon as the model and its schedule are both in memory. The ref keeps it to one
  // run: the effect re-fires as `shots` changes underneath it.
  const autoRunRef = useRef(false);
  useEffect(() => {
    if (!autoGenerate || autoRunRef.current) return;
    if (!layerReady || layerRun || pendingLayers.length === 0) return;
    autoRunRef.current = true;
    handleGenerateLayers(pendingLayers);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGenerate, layerReady, layerRun, pendingLayers]);

  // --- Publishing -------------------------------------------------------------------

  const draftIds = useMemo(() => shots.filter((s) => s.status === CaptureStatus.Draft).map((s) => s.id), [shots]);

  async function handlePublish() {
    setPublishing(true);
    try {
      const justPublished = new Set(draftIds);
      const res = await capturesApi.publish(modelId, draftIds, true);

      const fresh = await capturesApi.list(modelId);
      setShots(fresh);
      setConfirmPublish(false);
      setPublishing(false);
      toast.show(`${res.publishedCount} capture${res.publishedCount === 1 ? '' : 's'} published.`, 'success');

      // Publishing is what makes an angle available to customers, so its layers are
      // rendered here and now rather than left to a queue. The API marks them Queued
      // on publish, and nothing consumes that queue yet — leaving it there would
      // promise work that never happens, which is exactly how a published angle ends
      // up in the configurator unable to change its own picture.
      if (layerRunnerRef.current) {
        await handleGenerateLayers(fresh.filter((s) => justPublished.has(s.id)));
      } else {
        toast.show(
          'Published. Layers still need rendering — attach the schedule, then use Generate layers.',
          'info'
        );
      }
    } catch (err) {
      toast.show(err.message, 'error');
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
          <button
            className="uh-btn sm"
            disabled={!layerReady || !!layerRun || published === 0}
            onClick={() => handleGenerateLayers()}
            title={
              !layerReady
                ? 'Needs the model and its schedule loaded'
                : published === 0
                ? 'Publish an angle first'
                : 'Render one image per option so the configurator can change the picture'
            }
          >
            <LayersIcon size={15} />
            Generate layers
          </button>
          <button className="uh-btn sm gold" disabled={draftIds.length === 0} onClick={() => setConfirmPublish(true)}>
            <CheckIcon size={15} />
            Save All ({draftIds.length})
          </button>
        </div>
      </div>

      {/* Published, but nothing to show for it. Easy to miss otherwise: the strip
          shows a thumbnail and the configurator lists the parts, so the angle looks
          done from every side except the one that matters. */}
      {!layerRun && pendingLayers.length > 0 && (
        <div className="uh-layer-progress">
          <LayersIcon size={18} style={{ flex: 'none', color: 'var(--uh-gold)' }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="uh-layer-line">
              {pendingLayers.length} published angle{pendingLayers.length === 1 ? ' has' : 's have'} no rendered
              layers, so options will not change {pendingLayers.length === 1 ? 'its' : 'their'} picture.
            </div>
          </div>
          <button
            className="uh-btn sm gold"
            disabled={!layerReady}
            title={layerReady ? 'Render one image per option' : 'Waiting for the model and its schedule'}
            onClick={() => handleGenerateLayers(pendingLayers)}
          >
            <LayersIcon size={15} />
            Render {pendingLayers.length} now
          </button>
        </div>
      )}

      {layerRun && (
        <div className="uh-layer-progress">
          <span className="uh-spinner light" />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="uh-layer-line">
              Rendering layers for <strong>{layerRun.capture}</strong> — {layerRun.index}
              {layerRun.total ? ` of ~${layerRun.total}` : ''} · {layerRun.label}
            </div>
            <div className="uh-layer-bar">
              <i style={{ width: `${layerRun.total ? Math.min(100, (layerRun.index / layerRun.total) * 100) : 5}%` }} />
            </div>
          </div>
          <button className="uh-btn sm" onClick={() => { cancelLayersRef.current = true; }}>
            Stop
          </button>
        </div>
      )}

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
