import React, { useRef, useState } from 'react';
import { attachSchedule, schedules as schedulesApi } from '../../api/endpoints.js';
import { parseMaterialLibrary, parseMaterialWorkbook } from '../../utils/materialLibrary.js';
import { describeScheduleTextures, withUploadedTextures } from '../../utils/scheduleTextures.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { navigate } from '../../router/Router.jsx';
import { SheetIcon } from './Icons.jsx';
import ScheduleTexturesDialog from './ScheduleTexturesDialog.jsx';

/**
 * Attaches the Configurator Parameters workbook to a model.
 *
 * The file is parsed here, in the browser, by the same reader the 3D studio uses, and
 * both the original and the parsed result are sent — so the stored option data cannot
 * drift from what the studio showed, and the render worker never needs its own .xlsx
 * implementation.
 *
 * When the workbook names textures, a second step shows each part with an upload slot
 * per texture name. The images are saved to the server first, then the schedule is
 * attached with those textures pointing at the API — so what the configurator later
 * loads from the API is the same schedule, textures included.
 *
 * When the model already has published angles, attaching finishes by opening the studio
 * with layer rendering started (see attach()).
 *
 * Uploading is a one-off per model: the schedule is stored against the model, not
 * against a session, and replacing it supersedes the previous version rather than
 * overwriting it.
 */
export default function ScheduleUpload({ modelId, current, hasAngles = false, onAttached, onError, className = 'uh-btn', compact = false }) {
  const { can } = useAuth();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null); // { file, result, shape } awaiting textures
  const [progress, setProgress] = useState('');
  const inputRef = useRef(null);

  async function attach(file, result, shape) {
    // The raw document is stored, not the finalized library: a finalized group
    // holds compiled RegExps, and JSON.stringify turns a RegExp into {}.
    const res = await attachSchedule({ modelId, file, shape: { ...shape, optionCount: result.library.optionCount } });
    onAttached?.(res, result);

    // New options or replaced textures make every rendered layer out of date. Rendering
    // needs the 3D scene, which lives in the capture studio, so hand over to it with
    // the run already started — the user watches a progress popup instead of having to
    // find and press "render layers".
    if (hasAngles && can.manageModels) navigate(`/models/${modelId}/add?generate=1&all=1`);
  }

  async function handleFile(file) {
    if (!file) return;
    setBusy(true);
    try {
      if (/\.xls$/i.test(file.name)) {
        throw new Error('That is the old binary Excel format. Open it in Excel, save as .xlsx, and upload again.');
      }

      const result = /\.xlsx?$|\.xlsm$/i.test(file.name)
        ? await parseMaterialWorkbook(await file.arrayBuffer(), file.name)
        : parseMaterialLibrary(await file.text(), file.name);

      if (!result.library) throw new Error(result.errors?.[0] ?? 'the file could not be read');

      if (describeScheduleTextures(result.shape).textureNames.length > 0) {
        setPending({ file, result, shape: result.shape });
      } else {
        await attach(file, result, result.shape);
      }
    } catch (err) {
      onError?.(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function saveWithTextures(chosen) {
    const { file, result, shape } = pending;
    setBusy(true);
    try {
      const entries = Object.entries(chosen);
      for (let i = 0; i < entries.length; i += 1) {
        const [name, image] = entries[i];
        setProgress(`Uploading texture ${i + 1} of ${entries.length}: ${name}`);
        // Stored under the sheet's own name, whatever the file was called on disk.
        await schedulesApi.uploadTexture(modelId, new File([image], name, { type: image.type }));
      }

      setProgress('Saving the schedule…');
      const stored = await schedulesApi.listTextures(modelId).catch(() => []);
      const uploaded = new Set([...stored.map((t) => t.fileName), ...entries.map(([name]) => name)]);
      await attach(file, result, withUploadedTextures(shape, modelId, uploaded));
      setPending(null);
    } catch (err) {
      onError?.(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setBusy(false);
      setProgress('');
    }
  }

  return (
    <>
      <label className={className} style={{ cursor: busy ? 'wait' : 'pointer' }} title="Excel (.xlsx), CSV or JSON">
        <SheetIcon size={compact ? 15 : 16} />
        {busy && !pending ? 'Reading…' : current ? 'Replace schedule' : 'Upload schedule'}
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xlsm,.csv,.json"
          style={{ display: 'none' }}
          disabled={busy}
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </label>
      {pending && (
        <ScheduleTexturesDialog
          modelId={modelId}
          shape={pending.shape}
          fileName={pending.file.name}
          busy={busy}
          progress={progress}
          onSave={saveWithTextures}
          onCancel={() => setPending(null)}
        />
      )}
    </>
  );
}
