import React, { useCallback, useEffect, useState } from 'react';
import { models as modelsApi, MODEL_STATUS_LABEL, ModelStatus } from '../../api/endpoints.js';
import { Badge, Empty, ErrorBox, Loading, Modal, formatBytes, formatDate, useToast } from '../../components/uh/Ui.jsx';
import { CameraIcon, CubeIcon, PlusIcon, SlidersIcon, TrashIcon } from '../../components/uh/Icons.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import { navigate } from '../../router/Router.jsx';

/**
 * Module 1, list view: every .glb uploaded to the system, with enough state on the
 * card to decide what it needs next — more angles, a schedule, or publishing.
 */
export default function ModelsPage() {
  const { can } = useAuth();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [confirmArchive, setConfirmArchive] = useState(null);
  const [archiving, setArchiving] = useState(false);
  const toast = useToast();

  const load = useCallback(() => {
    setError(null);
    setItems(null);
    modelsApi
      .list()
      .then(setItems)
      .catch((err) => setError(err));
  }, []);

  useEffect(load, [load]);

  async function handleArchive() {
    setArchiving(true);
    try {
      await modelsApi.archive(confirmArchive.id);
      toast.show(`"${confirmArchive.name}" archived.`, 'success');
      setConfirmArchive(null);
      load();
    } catch (err) {
      toast.show(err.message, 'error');
    } finally {
      setArchiving(false);
    }
  }

  return (
    <div className="uh-page">
      <div className="uh-page-head">
        <div>
          <h1 className="uh-page-title">Models &amp; Captures</h1>
          <p className="uh-page-sub">
            Upload a .glb, capture the angles the configurator will use, then publish them.
          </p>
        </div>
        {can.manageModels && (
          <div className="uh-page-actions">
            <button className="uh-btn gold" onClick={() => navigate('/models/add')}>
              <PlusIcon size={17} />
              Add model
            </button>
          </div>
        )}
      </div>

      {error && <ErrorBox error={error} onRetry={load} />}
      {!error && items === null && <Loading label="Loading models…" />}

      {!error && items?.length === 0 && (
        <Empty
          title="No models yet"
          action={
            can.manageModels && (
              <button className="uh-btn gold" onClick={() => navigate('/models/add')}>
                <PlusIcon size={17} />
                Add your first model
              </button>
            )
          }
        >
          Upload a .glb to get started. The app reads the file itself — its nodes, sub-nodes, materials and textures —
          so no particular naming convention is required.
        </Empty>
      )}

      {!error && items?.length > 0 && (
        <div className="uh-grid">
          {items.map((m) => {
            // A model is only usable by module 2 once it has both a schedule and at
            // least one published capture; surface whichever half is missing.
            const publishable = m.captureCount > 0;
            const configurable = m.hasSchedule && m.publishedCaptureCount > 0;

            return (
              <article key={m.id} className="uh-model-card">
                <div className="uh-model-thumb">
                  <div className="uh-thumb-empty">
                    <CubeIcon size={30} />
                    <div style={{ marginTop: 6 }}>{formatBytes(m.sizeBytes)}</div>
                  </div>
                </div>

                <div className="uh-model-body">
                  <h2 className="uh-model-name">{m.name}</h2>

                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Badge kind={m.status === ModelStatus.Ready ? 'ready' : 'draft'}>
                      {MODEL_STATUS_LABEL[m.status] ?? m.status}
                    </Badge>
                    {configurable ? (
                      <Badge kind="published">Ready to configure</Badge>
                    ) : (
                      <Badge kind="warn">{!m.hasSchedule ? 'No schedule' : 'Nothing published'}</Badge>
                    )}
                  </div>

                  <div className="uh-meta-row">
                    <span>
                      {m.captureCount} capture{m.captureCount === 1 ? '' : 's'}
                    </span>
                    <span>{m.publishedCaptureCount} published</span>
                    <span>v{m.version}</span>
                    <span>{formatDate(m.uploadedAt)}</span>
                  </div>

                  <div className="uh-card-actions">
                    {can.manageModels && (
                      <button className="uh-btn sm" onClick={() => navigate(`/models/${m.id}/add`)} title="Open the capture studio">
                        <CameraIcon size={15} />
                        Add angles
                      </button>
                    )}
                    <button
                      className="uh-btn sm"
                      onClick={() => navigate(`/models/${m.id}/update`)}
                      disabled={!publishable}
                      title={publishable ? 'Manage saved captures' : 'Capture at least one angle first'}
                    >
                      Manage captures
                    </button>
                    {configurable && (
                      <button className="uh-btn sm" onClick={() => navigate(`/configurator/${m.id}`)}>
                        <SlidersIcon size={15} />
                        Open
                      </button>
                    )}
                    {can.manageModels && (
                      <button className="uh-btn sm danger" onClick={() => setConfirmArchive(m)} title="Archive this model">
                        <TrashIcon size={15} />
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {confirmArchive && (
        <Modal
          title="Archive this model?"
          confirmLabel="Archive"
          confirmKind="danger"
          busy={archiving}
          onCancel={() => setConfirmArchive(null)}
          onConfirm={handleArchive}
        >
          <strong>{confirmArchive.name}</strong> will be hidden from both modules. Its captures and schedule are kept,
          so this can be undone by an administrator — nothing is deleted from storage.
        </Modal>
      )}

      {toast.node}
    </div>
  );
}
