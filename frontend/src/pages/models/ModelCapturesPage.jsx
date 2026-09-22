import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  captures as capturesApi,
  models as modelsApi,

  CaptureStatus,
  CAPTURE_STATUS_LABEL,
  CAPTURE_TIER_LABEL,
  CaptureTier,
  LAYER_STATUS_LABEL,
  LayerStatus,
} from '../../api/endpoints.js';
import { Badge, Empty, ErrorBox, Loading, Modal, formatDate, useToast } from '../../components/uh/Ui.jsx';
import { ArrowLeftIcon, CameraIcon, CheckIcon, SheetIcon, TrashIcon } from '../../components/uh/Icons.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import { navigate } from '../../router/Router.jsx';

/**
 * Module 1, /Update: everything captured for one model.
 *
 * Renaming, reordering and re-tiering happen inline; publishing is explicit and
 * batched, because publishing is what makes an angle visible to customers.
 */
export default function ModelCapturesPage({ modelId }) {
  const { can } = useAuth();
  const toast = useToast();

  const [model, setModel] = useState(null);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = useCallback(() => {
    setError(null);
    Promise.all([modelsApi.get(modelId), capturesApi.list(modelId)])
      .then(([m, c]) => {
        setModel(m);
        setRows(c);
        setSelected(new Set());
      })
      .catch(setError);
  }, [modelId]);

  useEffect(load, [load]);

  const draftIds = useMemo(() => (rows ?? []).filter((r) => r.status === CaptureStatus.Draft).map((r) => r.id), [rows]);

  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // --- Inline edits ---------------------------------------------------------------

  async function patch(row, changes) {
    // Optimistic: the row updates immediately and rolls back if the API refuses,
    // because waiting a round trip to see your own typing appear feels broken.
    const before = rows;
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...changes } : r)));
    try {
      await capturesApi.update(modelId, row.id, {
        name: changes.name ?? null,
        sortOrder: changes.sortOrder ?? null,
        tier: changes.tier ?? null,
        configurableNodes: null,
      });
    } catch (err) {
      setRows(before);
      toast.show(err.message, 'error');
    }
  }

  async function publish(ids) {
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const res = await capturesApi.publish(modelId, ids, true);
      toast.show(
        `${res.publishedCount} published` + (res.queuedForLayers > 0 ? `, ${res.queuedForLayers} queued for layers.` : '.'),
        'success'
      );
      load();
    } catch (err) {
      toast.show(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    try {
      await capturesApi.remove(modelId, confirmDelete.id);
      toast.show(`"${confirmDelete.name}" deleted.`, 'success');
      setConfirmDelete(null);
      load();
    } catch (err) {
      toast.show(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  // --- Render --------------------------------------------------------------------------

  if (error) {
    return (
      <div className="uh-page">
        <ErrorBox error={error} onRetry={load} />
        <div style={{ marginTop: 14 }}>
          <button className="uh-btn" onClick={() => navigate('/models')}>
            <ArrowLeftIcon size={16} />
            Back to models
          </button>
        </div>
      </div>
    );
  }

  if (!rows || !model) {
    return (
      <div className="uh-page">
        <Loading label="Loading captures…" />
      </div>
    );
  }

  return (
    <div className="uh-page">
      <div className="uh-page-head">
        <div style={{ minWidth: 0 }}>
          <button className="uh-btn sm" style={{ marginBottom: 10 }} onClick={() => navigate('/models')}>
            <ArrowLeftIcon size={15} />
            Models
          </button>
          <h1 className="uh-page-title">{model.name}</h1>
          <p className="uh-page-sub">
            {rows.length} capture{rows.length === 1 ? '' : 's'} ·{' '}
            {rows.filter((r) => r.status === CaptureStatus.Published).length} published ·{' '}
            {model.nodeCount} nodes, {model.materialCount} materials, {model.textureCount} textures
          </p>
        </div>

        <div className="uh-page-actions">
          {can.manageModels && (
            <button className="uh-btn" onClick={() => navigate(`/models/${modelId}/add`)}>
              <CameraIcon size={16} />
              Add angles
            </button>
          )}
          {can.publish && (
            <button className="uh-btn gold" disabled={busy || draftIds.length === 0} onClick={() => publish(draftIds)}>
              <CheckIcon size={16} />
              Save All ({draftIds.length})
            </button>
          )}
        </div>
      </div>

      <div className="uh-card uh-card-pad" style={{ marginBottom: 18 }}>
        {model.schedule ? (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <SheetIcon size={18} />
            <strong style={{ color: '#1d2238' }}>{model.schedule.fileName}</strong>
            <Badge kind="info">v{model.schedule.version}</Badge>
            <span style={{ color: '#67718c', fontSize: 14 }}>
              {model.schedule.groupCount} groups · {model.schedule.optionCount} options · attached{' '}
              {formatDate(model.schedule.uploadedAt)}
            </span>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', color: '#8a6a1d' }}>
            <SheetIcon size={18} />
            <span>
              No Configurator Parameters workbook is attached yet. Angles can still be captured — upload the workbook
              from the <strong>Image Configurator</strong> when it is ready, and layer rendering picks up the published
              captures automatically.
            </span>
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <Empty
          title="No captures yet"
          action={
            can.manageModels && (
              <button className="uh-btn gold" onClick={() => navigate(`/models/${modelId}/add`)}>
                <CameraIcon size={16} />
                Open the capture studio
              </button>
            )
          }
        >
          Open the studio, frame the views this model needs, and save each one. Around {30} angles gives the
          configurator smooth left/right movement around the model.
        </Empty>
      ) : (
        <div className="uh-card" style={{ overflowX: 'auto' }}>
          <table className="uh-table">
            <thead>
              <tr>
                <th style={{ width: 38 }}>
                  <input
                    className="uh-checkbox"
                    type="checkbox"
                    aria-label="Select all drafts"
                    checked={draftIds.length > 0 && draftIds.every((id) => selected.has(id))}
                    onChange={(e) => setSelected(e.target.checked ? new Set(draftIds) : new Set())}
                  />
                </th>
                <th style={{ width: 104 }}>Preview</th>
                <th>Name</th>
                <th style={{ width: 90 }}>Order</th>
                <th style={{ width: 110 }}>Tier</th>
                <th style={{ width: 120 }}>Parts visible</th>
                <th style={{ width: 130 }}>Layers</th>
                <th style={{ width: 110 }}>Status</th>
                <th style={{ width: 150 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={selected.has(r.id) ? 'selected' : ''}>
                  <td>
                    <input
                      className="uh-checkbox"
                      type="checkbox"
                      aria-label={`Select ${r.name}`}
                      disabled={r.status !== CaptureStatus.Draft}
                      checked={selected.has(r.id)}
                      onChange={() => toggle(r.id)}
                    />
                  </td>
                  <td>
                    <img className="uh-table-thumb" src={r.thumbnailUrl} alt={r.name} loading="lazy" />
                  </td>
                  <td>
                    <input
                      className="uh-inline-input"
                      defaultValue={r.name}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== r.name) patch(r, { name: v });
                        else e.target.value = r.name;
                      }}
                    />
                  </td>
                  <td>
                    <input
                      className="uh-inline-input"
                      type="number"
                      defaultValue={r.sortOrder}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v) && v !== r.sortOrder) patch(r, { sortOrder: v });
                      }}
                    />
                  </td>
                  <td>
                    <select className="uh-inline-input" value={r.tier} onChange={(e) => patch(r, { tier: Number(e.target.value) })}>
                      {CAPTURE_TIER_LABEL.map((label, i) => (
                        <option key={label} value={i}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>{r.visibleNodes.length}</td>
                  <td>
                    <span style={{ fontSize: 13, color: r.layerStatus === LayerStatus.Failed ? '#a5423c' : '#5b6480' }}>
                      {LAYER_STATUS_LABEL[r.layerStatus] ?? r.layerStatus}
                      {r.layerCount > 0 ? ` (${r.layerCount})` : ''}
                    </span>
                  </td>
                  <td>
                    <Badge kind={r.status === CaptureStatus.Published ? 'published' : 'draft'}>
                      {CAPTURE_STATUS_LABEL[r.status] ?? r.status}
                    </Badge>
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {can.publish && r.status === CaptureStatus.Draft && (
                      <button className="uh-btn sm" disabled={busy} onClick={() => publish([r.id])}>
                        Save
                      </button>
                    )}
                    {can.manageModels && (
                      <button
                        className="uh-btn sm danger"
                        style={{ marginLeft: 6 }}
                        onClick={() => setConfirmDelete(r)}
                        title="Delete this capture"
                      >
                        <TrashIcon size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected.size > 0 && can.publish && (
        <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
          <button className="uh-btn gold" disabled={busy} onClick={() => publish([...selected])}>
            <CheckIcon size={16} />
            Save {selected.size} selected
          </button>
          <button className="uh-btn" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </div>
      )}

      {confirmDelete && (
        <Modal
          title="Delete this capture?"
          confirmLabel="Delete"
          confirmKind="danger"
          busy={busy}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={handleDelete}
        >
          <strong>{confirmDelete.name}</strong> and its rendered layers will be removed from storage. This cannot be
          undone — the angle would have to be captured again.
        </Modal>
      )}

      {toast.node}
    </div>
  );
}
