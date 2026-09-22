import React, { useCallback, useEffect, useState } from 'react';
import { captures as capturesApi, models as modelsApi, CaptureStatus } from '../../api/endpoints.js';
import { Badge, Empty, ErrorBox, Loading, formatDate } from '../../components/uh/Ui.jsx';
import { CubeIcon, SlidersIcon } from '../../components/uh/Icons.jsx';
import { navigate } from '../../router/Router.jsx';

/**
 * Module 2, list view: the models a customer can actually configure.
 *
 * `readyOnly` is applied by the API — a model needs both a schedule and at least one
 * published capture, or the configurator would open onto an empty panel.
 */
export default function ConfigureListPage() {
  const [items, setItems] = useState(null);
  const [thumbs, setThumbs] = useState({});
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setError(null);
    setItems(null);
    modelsApi
      .list({ readyOnly: true })
      .then(async (list) => {
        setItems(list);
        // One published thumbnail per model, fetched alongside rather than blocking
        // the list. A failure here costs a picture, not the page.
        const entries = await Promise.all(
          list.map(async (m) => {
            try {
              const shots = await capturesApi.list(m.id, CaptureStatus.Published);
              return [m.id, shots[0]?.thumbnailUrl ?? null];
            } catch {
              return [m.id, null];
            }
          })
        );
        setThumbs(Object.fromEntries(entries));
      })
      .catch(setError);
  }, []);

  useEffect(load, [load]);

  return (
    <div className="uh-page">
      <div className="uh-page-head">
        <div>
          <h1 className="uh-page-title">Image Configurator</h1>
          <p className="uh-page-sub">Choose a model, move around it, and change the finishes on what you can see.</p>
        </div>
      </div>

      {error && <ErrorBox error={error} onRetry={load} />}
      {!error && items === null && <Loading label="Loading published models…" />}

      {!error && items?.length === 0 && (
        <Empty title="Nothing published yet">
          A model appears here once it has a finish schedule attached and at least one published capture. Publish some
          angles from Models &amp; Captures and they will show up.
        </Empty>
      )}

      {!error && items?.length > 0 && (
        <div className="uh-grid">
          {items.map((m) => (
            <article key={m.id} className="uh-model-card" style={{ cursor: 'pointer' }} onClick={() => navigate(`/configurator/${m.id}`)}>
              <div className="uh-model-thumb">
                {thumbs[m.id] ? (
                  <img src={thumbs[m.id]} alt={m.name} loading="lazy" />
                ) : (
                  <div className="uh-thumb-empty">
                    <CubeIcon size={30} />
                  </div>
                )}
              </div>
              <div className="uh-model-body">
                <h2 className="uh-model-name">{m.name}</h2>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <Badge kind="published">{m.publishedCaptureCount} angles</Badge>
                  <Badge kind="info">Schedule attached</Badge>
                </div>
                <div className="uh-meta-row">
                  <span>v{m.version}</span>
                  <span>{formatDate(m.uploadedAt)}</span>
                </div>
                <div className="uh-card-actions">
                  <button className="uh-btn sm gold" onClick={(e) => { e.stopPropagation(); navigate(`/configurator/${m.id}`); }}>
                    <SlidersIcon size={15} />
                    Configure
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
