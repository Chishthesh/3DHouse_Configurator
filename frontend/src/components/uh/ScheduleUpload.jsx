import React, { useRef, useState } from 'react';
import { attachSchedule } from '../../api/endpoints.js';
import { parseMaterialLibrary, parseMaterialWorkbook } from '../../utils/materialLibrary.js';
import { SheetIcon } from './Icons.jsx';

/**
 * Attaches the Configurator Parameters workbook to a model.
 *
 * The file is parsed here, in the browser, by the same reader the 3D studio uses, and
 * both the original and the parsed result are sent — so the stored option data cannot
 * drift from what the studio showed, and the render worker never needs its own .xlsx
 * implementation.
 *
 * Uploading is a one-off per model: the schedule is stored against the model, not
 * against a session, and replacing it supersedes the previous version rather than
 * overwriting it.
 */
export default function ScheduleUpload({ modelId, current, onAttached, onError, className = 'uh-btn', compact = false }) {
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

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

      // The raw document is stored, not the finalized library: a finalized group
      // holds compiled RegExps, and JSON.stringify turns a RegExp into {}.
      const shape = { ...result.shape, optionCount: result.library.optionCount };
      const res = await attachSchedule({ modelId, file, shape });
      onAttached?.(res, result);
    } catch (err) {
      onError?.(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <label className={className} style={{ cursor: busy ? 'wait' : 'pointer' }} title="Excel (.xlsx), CSV or JSON">
      <SheetIcon size={compact ? 15 : 16} />
      {busy ? 'Reading…' : current ? 'Replace schedule' : 'Upload schedule'}
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xlsm,.csv,.json"
        style={{ display: 'none' }}
        disabled={busy}
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
    </label>
  );
}
