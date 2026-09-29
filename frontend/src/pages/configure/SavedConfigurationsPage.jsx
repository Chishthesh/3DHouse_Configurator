import React, { useCallback, useEffect, useState } from 'react';
import { configurations as configApi, models as modelsApi } from '../../api/endpoints.js';
import { Badge, Empty, ErrorBox, Loading, Modal, formatDate, useToast } from '../../components/uh/Ui.jsx';
import { SlidersIcon, TrashIcon } from '../../components/uh/Icons.jsx';
import { navigate } from '../../router/Router.jsx';

/**
 * The configurations this user has saved.
 *
 * Saving already worked and said so, but there was nowhere to go and look — the
 * selections sat in the database unseen. Opening one hands its id to the viewer,
 * which re-applies the selections onto the model.
 *
 * Configurations are per-user: the API scopes every read to the signed-in owner,
 * so this is "mine", not "everyone's".
 */
export default function SavedConfigurationsPage() {
  const [rows, setRows] = useState(null);
  const [modelsById, setModelsById] = useState({});
  const [error, setError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = useCallback(() => {
    setError(null);
    Promise.all([configApi.list(), modelsApi.list().catch(() => [])])
      .then(([saved, models]) => {
        setRows(saved);
        setModelsById(Object.fromEntries(models.map((m) => [m.id, m])));
      })
      .catch(setError);
  }, []);

  useEffect(load, [load]);

  async function handleDelete() {
    setBusy(true);
    try {
      await configApi.remove(confirmDelete.id);
      toast.show(`"${confirmDelete.name}" deleted.`, 'success');
      setConfirmDelete(null);
      load();
    } catch (err) {
      toast.show(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="uh-page">
      <div className="uh-page-head">
        <div>
          <h1 className="uh-page-title">Saved Configurations</h1>
          <p className="uh-page-sub">Open one to pick up where you left off, on the model it was saved against.</p>
        </div>
      </div>

      {error && <ErrorBox error={error} onRetry={load} />}
      {!error && rows === null && <Loading label="Loading your configurations…" />}

      {!error && rows?.length === 0 && (
        <Empty
          title="Nothing saved yet"
          action={
            <button className="uh-btn gold" onClick={() => navigate('/configurator')}>
              <SlidersIcon size={16} />
              Open the configurator
            </button>
          }
        >
          Choose finishes in the Image Configurator and press Save, and the combination will be kept here.
        </Empty>
      )}

      {!error && rows?.length > 0 && (
        <div className="uh-card" style={{ overflowX: 'auto' }}>
          <table className="uh-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Model</th>
                <th style={{ width: 120 }}>Choices</th>
                <th style={{ width: 150 }}>Last saved</th>
                <th style={{ width: 170 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                // A configuration outlives the model listing if the model was
                // archived, so the row stays readable and only Open is withheld.
                const model = modelsById[c.modelId];
                return (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 600, color: '#1d2238' }}>{c.name}</td>
                    <td>
                      {model ? (
                        model.name
                      ) : (
                        <Badge kind="warn">Model no longer available</Badge>
                      )}
                    </td>
                    <td>
                      {c.selections.length} part{c.selections.length === 1 ? '' : 's'}
                    </td>
                    <td>{formatDate(c.updatedAt)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        className="uh-btn sm gold"
                        disabled={!model}
                        title={model ? 'Open this configuration' : 'The model it was saved against is not available'}
                        onClick={() => navigate(`/configurator/${c.modelId}?configuration=${c.id}`)}
                      >
                        <SlidersIcon size={15} />
                        Open
                      </button>
                      <button
                        className="uh-btn sm danger"
                        style={{ marginLeft: 6 }}
                        onClick={() => setConfirmDelete(c)}
                        title="Delete this configuration"
                      >
                        <TrashIcon size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {confirmDelete && (
        <Modal
          title="Delete this configuration?"
          confirmLabel="Delete"
          confirmKind="danger"
          busy={busy}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={handleDelete}
        >
          <strong>{confirmDelete.name}</strong> will be removed. The model and its images are untouched — only this
          set of choices is deleted.
        </Modal>
      )}

      {toast.node}
    </div>
  );
}
