import React, { useRef } from 'react';

export default function UploadPanel({ onFileChosen, sampleUrl }) {
  const inputRef = useRef(null);

  const handleChange = (e) => {
    const file = e.target.files?.[0];
    if (file) onFileChosen(file);
  };

  return (
    <div className="upload-overlay">
      <div className="upload-card">
        <h2>Upload your 3D house model</h2>
        <p>Select a .glb file (binary glTF 2.0) with zones named per the configurator's mesh-naming convention.</p>
        <input ref={inputRef} type="file" accept=".glb" onChange={handleChange} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button className="btn btn-primary" onClick={() => inputRef.current?.click()}>
            Choose .glb file
          </button>
          {sampleUrl && (
            <button className="btn" onClick={() => onFileChosen(sampleUrl)}>
              Use sample house
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
