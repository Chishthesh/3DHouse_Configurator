import React, { useState } from 'react';
import ScheduleUploadButton from './ScheduleUploadButton.jsx';

// Loading and validating the material schedule, plus an honest report of how well it
// fits the model that is actually loaded. The report exists because a schedule that
// matches nothing is the most likely real-world failure, and without this it reads as
// "the configurator is broken" rather than "the document targets other node names".
export default function LibraryPanel({
  library,
  errors,
  warnings,
  coverage,
  samples,
  workbook,
  onSelectSheet,
  onLoadFile,
  onLoadSample,
  onClear,
  graph,
  onSelectNode,
}) {
  const [showUncovered, setShowUncovered] = useState(false);

  return (
    <div className="library-panel">
      {/* The heading and the upload button never scroll away. Previously the primary
          action sat inside the scrolling area and slid out of view behind the sample
          buttons and the coverage report, which made it impossible to find. */}
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

        {/* A real workbook often keeps a draft sheet beside the final one — the
            sample file does exactly that — so the chosen sheet is stated and can be
            changed rather than silently guessed. */}
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

        {/* Collapsed by default: the bundled samples are handy for a demo but they
            are not what this panel is for, and three permanent rows of them crowded
            out the validation report. */}
        <details className="lib-samples">
          <summary>or load a bundled sample ({samples.length})</summary>
          <div className="lib-actions">
            {samples.map((s) => (
              <button key={s.url} className="btn btn-sm" type="button" onClick={() => onLoadSample(s)}>
                {s.label}
              </button>
            ))}
          </div>
        </details>
      </div>

      <div className="lib-report">
        {library ? (
          <div className="lib-loaded">
            <strong>{library.name}</strong>
            <div className="lib-meta">
              {library.version && <span>v{library.version}</span>}
              <span>
                {library.groups.length} group{library.groups.length === 1 ? '' : 's'}
              </span>
              <span>
                {library.optionCount} option{library.optionCount === 1 ? '' : 's'}
              </span>
            </div>
            <div className="lib-source">from {library.source}</div>
          </div>
        ) : (
          <p className="muted small">
            No schedule loaded. Parts can still be recoloured by hand, but catalogued finishes (codes, prices, textures)
            come from this document.
          </p>
        )}

        {errors.length > 0 && (
          <div className="lib-issues error">
            <strong>
              {errors.length} problem{errors.length === 1 ? '' : 's'} in the document
            </strong>
            <ul>
              {errors.slice(0, 8).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
            {errors.length > 8 && <div className="muted small">…and {errors.length - 8} more.</div>}
          </div>
        )}

        {warnings.length > 0 && (
          <div className="lib-issues warn">
            <strong>
              {warnings.length} warning{warnings.length === 1 ? '' : 's'}
            </strong>
            <ul>
              {warnings.slice(0, 5).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {library && coverage && (
          <div className="lib-coverage">
            <div className="cov-row">
              <span>Groups matched</span>
              <strong className={coverage.matchedGroupCount === library.groups.length ? 'ok' : 'partial'}>
                {coverage.matchedGroupCount} / {library.groups.length}
              </strong>
            </div>
            <div className="cov-row">
              <span>Parts with finishes</span>
              <strong className={coverage.coveredNodeCount === coverage.geometryNodeCount ? 'ok' : 'partial'}>
                {coverage.coveredNodeCount} / {coverage.geometryNodeCount}
              </strong>
            </div>
            <div className="cov-bar">
              <i
                style={{
                  width: `${coverage.geometryNodeCount ? (coverage.coveredNodeCount / coverage.geometryNodeCount) * 100 : 0}%`,
                }}
              />
            </div>

            {coverage.unmatchedGroups.length > 0 && (
              <div className="lib-issues warn">
                <strong>Matches nothing in this model</strong>
                <ul>
                  {coverage.unmatchedGroups.map((g) => (
                    <li key={g.id}>
                      {g.label} — looked for {g.nodePatterns.map((p) => `"${p.raw}"`).join(', ') || 'no node names'}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {coverage.uncoveredNodes.length > 0 && (
              <div className="lib-uncovered">
                <button className="link-btn" type="button" onClick={() => setShowUncovered((v) => !v)}>
                  {showUncovered ? 'Hide' : 'Show'} {coverage.uncoveredNodes.length} part
                  {coverage.uncoveredNodes.length === 1 ? '' : 's'} with no catalogued finish
                </button>
                {showUncovered && (
                  <ul className="uncovered-list">
                    {coverage.uncoveredNodes.slice(0, 40).map((n) => (
                      <li key={n.id}>
                        <button type="button" onClick={() => onSelectNode(graph.byId.get(n.id))}>
                          {n.name || n.rawType}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
