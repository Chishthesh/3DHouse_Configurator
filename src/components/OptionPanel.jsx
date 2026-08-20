import React from 'react';
import { CATEGORIES, ZONES, categoryZones } from '../data/zoneSpec.js';

function GenericTintSection({ genericAreas, genericTints, onGenericTint, onGenericReset, asMain }) {
  return (
    <div className={`generic-tint-section ${asMain ? 'as-main' : ''}`}>
      <p className="generic-tint-intro">
        {asMain
          ? <>No group node matches the spec's <code>{'{category}_{zone}'}</code> naming, so there's no curated color catalog for this file — but
              you can still tint each named part it does have. This shifts the color of everything under that part at once (there's no way to
              isolate just the cabinets, say, unless the file separates them).</>
          : 'These parts of the model don’t match a known zone, so there’s no curated catalog for them — plain tint only:'}
      </p>
      {genericAreas.map((area) => {
        const current = genericTints[area.id];
        return (
          <div className="generic-tint-row" key={area.id}>
            <span className="generic-tint-name">{area.label}</span>
            <input
              type="color"
              className="generic-tint-swatch"
              value={current ?? '#ffffff'}
              onChange={(e) => onGenericTint(area, e.target.value)}
              title={`Tint ${area.label}`}
            />
            <button className="generic-tint-reset" disabled={!current} onClick={() => onGenericReset(area)}>
              Reset
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default function OptionPanel({
  activeCategory,
  setActiveCategory,
  activeZone,
  setActiveZone,
  presentZoneKeys,
  genericAreas,
  genericTints,
  onGenericTint,
  onGenericReset,
  selections,
  onPick,
}) {
  const hasAnyZones = presentZoneKeys.size > 0;
  const visibleCategories = CATEGORIES.filter((c) => categoryZones(c.key).some((zk) => presentZoneKeys.has(zk)));
  const zonesInCategory = activeCategory ? categoryZones(activeCategory).filter((zk) => presentZoneKeys.has(zk)) : [];

  if (!hasAnyZones) {
    return (
      <div className="side-panel">
        {genericAreas.length > 0 ? (
          <GenericTintSection genericAreas={genericAreas} genericTints={genericTints} onGenericTint={onGenericTint} onGenericReset={onGenericReset} asMain />
        ) : (
          <div className="empty-panel">
            <div className="empty-panel-content">
              This model doesn't contain any named configurable zones — no group node in it matches the <code>{'{category}_{zone}'}</code> naming
              convention from the spec (e.g. <code>cabinets_kitchen</code>). You can still walk through it using the buttons below the 3D view, but
              material colors can't be swapped until the model is re-exported with that naming convention.
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="side-panel">
      <div className="category-tabs">
        {visibleCategories.map((c) => (
          <button
            key={c.key}
            className={`category-chip ${c.key === activeCategory ? 'active' : ''}`}
            onClick={() => setActiveCategory(c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>

      {zonesInCategory.length > 1 && (
        <div className="zone-tabs">
          {zonesInCategory.map((zKey) => (
            <button key={zKey} className={`zone-chip ${zKey === activeZone ? 'active' : ''}`} onClick={() => setActiveZone(zKey)}>
              {ZONES[zKey].label}
            </button>
          ))}
        </div>
      )}

      {activeZone ? (
        <>
          <div className="panel-heading">
            {ZONES[activeZone].label}
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', marginTop: 2 }}>
              Applies to: {ZONES[activeZone].rooms.join(', ')}
            </div>
          </div>
          <div className="option-list">
            {ZONES[activeZone].options.map((opt) => {
              const isSelected = (selections[activeZone]?.name ?? ZONES[activeZone].default.name) === opt.name;
              return (
                <div key={opt.name} className={`option-row ${isSelected ? 'selected' : ''}`} onClick={() => onPick(activeZone, opt)}>
                  <div className="swatch" style={{ background: opt.color }} />
                  <div className="option-name">{opt.name}</div>
                  <div className={`option-price ${opt.price === 0 ? 'included' : ''}`}>
                    {opt.price === 0 ? 'Included' : `+$${opt.price.toLocaleString()}`}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="empty-panel">
          <div className="empty-panel-content">Click a category above, or click any part of the house, to start customizing.</div>
        </div>
      )}

      {genericAreas.length > 0 && (
        <GenericTintSection genericAreas={genericAreas} genericTints={genericTints} onGenericTint={onGenericTint} onGenericReset={onGenericReset} />
      )}
    </div>
  );
}
