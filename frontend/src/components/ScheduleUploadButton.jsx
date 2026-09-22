import React, { useRef } from 'react';

// The single upload control for the material schedule, so the same action can sit
// both in the sidebar and in the top bar without duplicating the file input or
// drifting out of sync.
export default function ScheduleUploadButton({ onLoadFile, className = 'btn btn-primary btn-sm', children }) {
  const inputRef = useRef(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xlsm,.csv,.json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,application/json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onLoadFile(file);
          // Cleared so re-picking the same filename still fires a change event.
          e.target.value = '';
        }}
      />
      <button className={className} type="button" onClick={() => inputRef.current?.click()}>
        {children ?? 'Upload schedule (.xlsx / .csv / .json)'}
      </button>
    </>
  );
}
