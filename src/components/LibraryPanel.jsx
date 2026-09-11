import ScheduleUploadButton from './ScheduleUploadButton.jsx';

export default function LibraryPanel({
  library,
  samples,
  workbook,
  onSelectSheet,
  onLoadFile,
  onLoadSample,
  onClear,
}) {
  return (
    <div className="library-panel">
      <div className="lib-fixed">
        <div className="lib-head">
          <h3>Material schedule</h3>
          {library && (
            <button className="link-btn" type="button" onClick={onClear}>
              Clear
            </button>
          )}
        </div>

        <ScheduleUploadButton onLoadFile={onLoadFile} />

        {workbook && workbook.sheets.length > 1 && (
          <label className="lib-sheet-picker">
            <span>Worksheet</span>
            <select value={workbook.activeSheet ?? ''} onChange={(e) => onSelectSheet(e.target.value)}>
              {workbook.sheets.map((s) => (
                <option key={s.name} value={s.name} disabled={!s.usable}>
                  {s.name}
                  {s.usable ? ` — ${s.rowsWithFinishes} part${s.rowsWithFinishes === 1 ? '' : 's'}` : ' — no finishes'}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="lib-actions">
          {samples.map((s) => (
            <button key={s.url} className="btn btn-sm" type="button" onClick={() => onLoadSample(s)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
