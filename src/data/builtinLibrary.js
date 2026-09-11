// The original spec-driven zone catalogue, re-expressed as a material schedule.
//
// The configurator is now model-driven: it reads whatever node/material names the
// uploaded .glb actually contains, and finishes come from an uploaded schedule. This
// adapter keeps the earlier `{category}_{zone}` catalogue working as a *built-in*
// schedule, so a file exported to that convention (the bundled sample house) still
// gets its curated options with no document to upload.
import { CATEGORIES, ZONES } from './zoneSpec.js';

const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label]));

export function buildInHouseScheduleShape() {
  return {
    name: 'Built-in house schedule',
    version: '1.0',
    description:
      'Ships with the app. Matches models exported to the {category}_{zone} naming convention (e.g. cabinets_kitchen, flooring_hardwood).',
    // So the model tree reads "Kitchen Cabinets" rather than "Cabinets Kitchen".
    nodeLabels: Object.fromEntries(Object.entries(ZONES).map(([zoneKey, zone]) => [zoneKey, zone.label])),
    groups: Object.entries(ZONES).map(([zoneKey, zone]) => ({
      id: `builtin-${zoneKey}`,
      label: zone.label,
      category: CATEGORY_LABEL[zone.category] ?? zone.category,
      description: `Applies to: ${zone.rooms.join(', ')}`,
      match: { nodes: [zoneKey, `${zoneKey}*`] },
      options: zone.options.map((opt, i) => ({
        code: `${zoneKey.toUpperCase().slice(0, 3)}-${String(i + 1).padStart(2, '0')}`,
        name: opt.name,
        color: opt.color,
        roughness: opt.roughness,
        metalness: opt.metalness,
        price: opt.price,
        default: opt.name === zone.default.name,
      })),
    })),
  };
}
