import React, { useCallback, useEffect, useState } from 'react';
import { captures as capturesApi, models as modelsApi, CaptureStatus } from '../../api/endpoints.js';
import { Badge, Empty, ErrorBox, Loading, formatDate, useToast } from '../../components/uh/Ui.jsx';
import ScheduleUpload from '../../components/uh/ScheduleUpload.jsx';
import { CubeIcon, LinkIcon, SlidersIcon } from '../../components/uh/Icons.jsx';
import { navigate } from '../../router/Router.jsx';

/**
 * The model's public link, built from the share token stored with it in the
 * database. It opens the configurator for that one model without signing in, for
 * pasting into other websites.
 */
function shareLink(shareToken) {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#/share/${encodeURIComponent(shareToken)}`;
}

/**
 * navigator.clipboard only exists in a secure context (the app is often served over
 * plain http on a LAN address), and embedded browsers can deny it outright — so fall
 * back to the old textarea trick in either case.
 */
async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Permission denied — try the fallback below.
    }
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(area);
  if (!ok) throw new Error('The browser refused to copy.');
}

/**
 * Module 2, list view.
 *
 * Shows every model with published angles, not only the ones the API considers
 * "ready". A model with angles but no schedule still belongs here, because this is
 * where the Configurator Parameters workbook is uploaded — filtering it out would
 * hide the very model the user came to attach a workbook to.
 */
export default function ConfigureListPage() {
  const [items, setItems] = useState(null);
  const [thumbs, setThumbs] = useState({});
  const [error, setError] = useState(null);
  const toast = useToast();

  const load = useCallback(() => {
    setError(null);
    modelsApi
      .list()
      .then(async (list) => {
        const withAngles = list.filter((m) => m.publishedCaptureCount > 0);
        setItems(withAngles);

        // One published thumbnail per model, fetched alongside rather than blocking
        // the list. A failure here costs a picture, not the page.
        const entries = await Promise.all(
          withAngles.map(async (m) => {
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
      {!error && items === null && <Loading label="Loading models…" />}

      {!error && items?.length === 0 && (
        <Empty title="Nothing published yet">
          A model appears here once it has at least one published capture. Publish some angles from Models &amp;
          Captures and they will show up — you can attach the finish schedule here afterwards.
        </Empty>
      )}

      {!error && items?.length > 0 && (
        <div className="uh-grid">
          {items.map((m) => {
            const ready = m.hasSchedule;
            return (
              <article
                key={m.id}
                className="uh-model-card"
                style={{ cursor: ready ? 'pointer' : 'default' }}
                onClick={ready ? () => navigate(`/configurator/${m.id}`) : undefined}
              >
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
                    {ready ? <Badge kind="info">Schedule attached</Badge> : <Badge kind="warn">Needs schedule</Badge>}
                  </div>
                  <div className="uh-meta-row">
                    <span>v{m.version}</span>
                    <span>{formatDate(m.uploadedAt)}</span>
                  </div>

                  {!ready && (
                    <p style={{ margin: 0, fontSize: 13, color: '#8a6a1d', lineHeight: 1.45 }}>
                      Upload the Configurator Parameters workbook to turn these angles into a configurator.
                    </p>
                  )}

                  <div className="uh-card-actions" onClick={(e) => e.stopPropagation()}>
                    {ready && (
                      <button className="uh-btn sm gold" onClick={() => navigate(`/configurator/${m.id}`)}>
                        <SlidersIcon size={15} />
                        Configure
                      </button>
                    )}
                    {ready && m.shareToken && (
                      <button
                        className="uh-btn sm"
                        title="Copy the public link that opens this model in the configurator — no sign-in needed"
                        onClick={() => {
                          const link = shareLink(m.shareToken);
                          copyText(link)
                            .then(() => toast.show('Link copied — anyone with it can open this model in the configurator.', 'success'))
                            .catch(() => toast.show(`Could not copy automatically. The link is: ${link}`, 'error'));
                        }}
                      >
                        <LinkIcon size={15} />
                        Copy link
                      </button>
                    )}
                    <ScheduleUpload
                      modelId={m.id}
                      current={m.hasSchedule}
                      className={`uh-btn sm${ready ? '' : ' gold'}`}
                      compact
                      onAttached={(res) => {
                        toast.show(`Schedule attached — ${res.groupCount} groups, ${res.optionCount} options.`, 'success');
                        load();
                      }}
                      onError={(err) => toast.show(`Could not attach the schedule: ${err.message}`, 'error')}
                    />
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {toast.node}
    </div>
  );
}
