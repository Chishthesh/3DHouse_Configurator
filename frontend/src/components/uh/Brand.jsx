import React from 'react';

/**
 * The UH Homes lockup: a gold bar mark followed by the wordmark.
 * Drawn as SVG rather than shipped as a raster so it stays crisp at the two sizes
 * it appears in (auth card and top navigation) without two asset files.
 */
export function BrandMark({ size = 26 }) {
  return (
    <svg
      className="uh-brand-mark"
      width={size}
      height={size}
      viewBox="0 0 26 26"
      fill="none"
      role="img"
      aria-label="UH Homes"
    >
      <rect x="2" y="9" width="4.6" height="12" rx="1.6" fill="#e9c46a" />
      <rect x="8.8" y="4" width="4.6" height="17" rx="1.6" fill="#f2d68f" />
      <rect x="15.6" y="11.5" width="4.6" height="9.5" rx="1.6" fill="#e9c46a" />
      <rect x="22.4" y="7" width="2.2" height="14" rx="1.1" fill="#c9a227" />
    </svg>
  );
}

export function Brand({ size = 26, nameStyle }) {
  return (
    <div className="uh-brand">
      <BrandMark size={size} />
      <span className="uh-brand-name" style={nameStyle}>
        UH HOMES
      </span>
    </div>
  );
}

export default Brand;
