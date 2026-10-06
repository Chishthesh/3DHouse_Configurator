import React, { useEffect, useMemo, useRef, useState } from 'react';
import { schedules as schedulesApi } from '../../api/endpoints.js';
import { describeScheduleTextures, safeTextureName } from '../../utils/scheduleTextures.js';
import { Modal } from './Ui.jsx';

const extOf = (name) => (/\.[^.]+$/.exec(name)?.[0] ?? '').toLowerCase();

/**
 * Step two of attaching a schedule: the workbook has been read, and every texture it
 * names gets an upload slot, labelled with the name from the sheet.
 *
 * A picked file is stored under the sheet's name whatever it was called on disk, so
 * "mosaico.jpg" in the workbook is always the file the user chose for that slot.
 * Nothing leaves the browser until Save; `onSave(files)` receives the chosen files
 * keyed by sheet name, and `existing` marks names already stored for this model.
 */
export default function ScheduleTexturesDialog({ modelId, shape, fileName, busy, progress, onSave, onCancel }) {
  const { rows, textureNames } = useMemo(() => describeScheduleTextures(shape), [shape]);
  const [existing, setExisting] = useState(() => new Set());
  const [chosen, setChosen] = useState({}); // sheet name -> File
  const [problem, setProblem] = useState(null);
  const previewUrls = useRef(new Map()); // File -> object URL, created once per file
  const inputs = useRef({});

  useEffect(() => {
    let cancelled = false;
    schedulesApi
      .listTextures(modelId)
      .then((list) => !cancelled && setExisting(new Set(list.map((t) => t.fileName))))
      .catch(() => {
        /* nothing uploaded yet, or storage is offline — every slot simply shows as empty */
      });
    return () => {
      cancelled = true;
    };
  }, [modelId]);

  useEffect(() => {
    const urls = previewUrls.current;
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const previewOf = (file) => {
    if (!previewUrls.current.has(file)) previewUrls.current.set(file, URL.createObjectURL(file));
    return previewUrls.current.get(file);
  };

  const isUploaded = (name) => existing.has(safeTextureName(name));
  const missing = textureNames.filter((n) => !chosen[n] && !isUploaded(n));

  function pick(name, file) {
    if (!file) return;
    if (extOf(file.name) !== extOf(name)) {
      setProblem(`"${name}" in the workbook is a ${extOf(name) || 'typeless'} file, but you chose ${file.name}. Pick a ${extOf(name)} image, or change the name in the workbook.`);
      return;
    }
    setProblem(null);
    setChosen((prev) => ({ ...prev, [name]: file }));
  }

  function slot(name) {
    const file = chosen[name];
    const state = file ? 'chosen' : isUploaded(name) ? 'uploaded' : 'missing';
    return (
      <div key={name} className={`uh-tex-slot ${state}`}>
        <span
          className="uh-tex-thumb"
          style={
            file
              ? { backgroundImage: `url(${previewOf(file)})` }
              : isUploaded(name)
                ? { backgroundImage: `url(${schedulesApi.textureUrl(modelId, name)})` }
                : undefined
          }
        />
        <span className="uh-tex-name" title={name}>
          {name}
        </span>
        <span className="uh-tex-state">{file ? 'Ready to save' : isUploaded(name) ? 'Uploaded' : 'Not uploaded'}</span>
        <button
          type="button"
          className="uh-btn sm"
          disabled={busy}
          onClick={() => inputs.current[name]?.click()}
        >
          {file || isUploaded(name) ? 'Replace' : 'Upload'}
        </button>
        <input
          ref={(el) => (inputs.current[name] = el)}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            pick(name, e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>
    );
  }

  return (
    <Modal
      title="Upload textures"
      width={880}
      confirmLabel={missing.length > 0 ? 'Save without all textures' : 'Save'}
      busy={busy}
      onCancel={onCancel}
      onConfirm={() => onSave(chosen)}
    >
      <p style={{ margin: '0 0 10px' }}>
        <strong>{fileName}</strong> names {textureNames.length} texture{textureNames.length === 1 ? '' : 's'} across{' '}
        {rows.filter((r) => r.textures.length).length} part
        {rows.filter((r) => r.textures.length).length === 1 ? '' : 's'}. Upload an image for each name; they are saved to
        the server with the schedule and the configurator loads them from there.
      </p>

      {problem && <div className="uh-tex-problem">{problem}</div>}
      {busy && progress && <div className="uh-tex-progress">{progress}</div>}

      <div className="uh-tex-table-wrap">
        <table className="uh-tex-table">
          <thead>
            <tr>
              <th>Unique Name</th>
              <th>Display Name</th>
              <th>Colours</th>
              <th>Textures</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.node}>
                <td>
                  <code>{r.node}</code>
                </td>
                <td>{r.label || '—'}</td>
                <td>
                  <div className="uh-tex-colours">
                    {r.colours.map((c) => (
                      <span key={c} className="uh-tex-colour" style={{ background: c }} title={c} />
                    ))}
                  </div>
                </td>
                <td>{r.textures.map(slot)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {missing.length > 0 && (
        <p style={{ margin: '10px 0 0', fontSize: 13, color: '#8a6a1d' }}>
          {missing.length} texture{missing.length === 1 ? ' has' : 's have'} no image yet ({missing.slice(0, 3).join(', ')}
          {missing.length > 3 ? '…' : ''}). Those options will not show a picture until you upload them.
        </p>
      )}
    </Modal>
  );
}
