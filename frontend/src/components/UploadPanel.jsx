import React, { useRef, useState } from 'react';

export default function UploadPanel({ onFileChosen }) {
  const inputRef = useRef(null);
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);

  const accept = (file) => {
    setError(null);
    if (!file) return;
    const name = file.name.toLowerCase();
    if (name.endsWith('.gltf')) {
      // A .gltf references its buffers and images as sibling files. Loading one from
      // a browser file picker gives no access to those siblings, so it would load as
      // an empty scene — better to say so than to show nothing and look broken.
      setError('Please export as .glb (binary). A .gltf file keeps its textures and geometry in separate files, which a browser upload cannot reach.');
      return;
    }
    if (!name.endsWith('.glb')) {
      setError(`"${file.name}" is not a .glb file.`);
      return;
    }
    onFileChosen(file);
  };

  return (
    <div className="upload-overlay">
      <div
        className={`upload-card ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          accept(e.dataTransfer.files?.[0]);
        }}
      >
        <h2>Upload a 3D model</h2>
        <p>
          Drop a <strong>.glb</strong> here, or choose a file. The configurator reads the model itself - its nodes, sub-nodes,
          materials and textures - so no particular naming convention is required.
        </p>

        <input
          ref={inputRef}
          type="file"
          accept=".glb,model/gltf-binary"
          style={{ display: 'none' }}
          onChange={(e) => {
            accept(e.target.files?.[0]);
            e.target.value = '';
          }}
        />

        <div className="upload-buttons">
          <button className="btn btn-primary" type="button" onClick={() => inputRef.current?.click()}>
            Choose .glb file
          </button>
        </div>

        {error && <div className="upload-error">{error}</div>}
      </div>
    </div>
  );
}
