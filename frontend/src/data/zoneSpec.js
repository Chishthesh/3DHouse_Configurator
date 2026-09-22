// Single source of truth for configurable zones, matching
// "3D Model Specification for Home Configurator" naming convention:
//   {category}_{zone}   e.g. flooring_hardwood, wall-tiles_bathroom
// Non-configurable geometry uses the "structure_" prefix and is ignored by the configurator.

export const CATEGORIES = [
  { key: 'flooring', label: 'Flooring' },
  { key: 'countertops', label: 'Countertops' },
  { key: 'wall-tiles', label: 'Wall Tiles' },
  { key: 'cabinets', label: 'Cabinets' },
  { key: 'paint', label: 'Paint' },
  { key: 'fixtures', label: 'Fixtures & Hardware' },
  { key: 'appliances', label: 'Appliances' },
  { key: 'exterior', label: 'Exterior' },
];

// zoneKey (group node name) -> full config
export const ZONES = {
  flooring_hardwood: {
    category: 'flooring',
    label: 'Hardwood Areas',
    rooms: ['Living room', 'Dining room', 'Hallway', 'Foyer'],
    default: { name: 'Light Oak (Default)', color: '#C8A87A', roughness: 0.55, metalness: 0.0 },
    options: [
      { name: 'Light Oak (Default)', color: '#C8A87A', roughness: 0.55, metalness: 0.0, price: 0 },
      { name: 'Walnut Hardwood', color: '#5B3A29', roughness: 0.5, metalness: 0.0, price: 2800 },
      { name: 'Ashwood Gray', color: '#A79E93', roughness: 0.55, metalness: 0.0, price: 2200 },
      { name: 'Ebony Stained', color: '#2B211C', roughness: 0.4, metalness: 0.0, price: 3600 },
      { name: 'Honey Maple', color: '#D8B27C', roughness: 0.55, metalness: 0.0, price: 1800 },
    ],
  },
  flooring_carpet: {
    category: 'flooring',
    label: 'Carpet Areas',
    rooms: ['Bedrooms'],
    default: { name: 'Ivory Plush (Default)', color: '#F5F0E8', roughness: 0.9, metalness: 0.0 },
    options: [
      { name: 'Ivory Plush (Default)', color: '#F5F0E8', roughness: 0.9, metalness: 0.0, price: 0 },
      { name: 'Charcoal Berber', color: '#4A4A4A', roughness: 0.95, metalness: 0.0, price: 1200 },
      { name: 'Warm Taupe', color: '#B7A392', roughness: 0.9, metalness: 0.0, price: 1000 },
      { name: 'Sage Green', color: '#9CAF88', roughness: 0.9, metalness: 0.0, price: 1400 },
    ],
  },
  flooring_tile: {
    category: 'flooring',
    label: 'Tile Areas',
    rooms: ['Kitchen', 'Bathrooms', 'Laundry', 'Mudroom'],
    default: { name: 'White Ceramic (Default)', color: '#F2F2F2', roughness: 0.3, metalness: 0.0 },
    options: [
      { name: 'White Ceramic (Default)', color: '#F2F2F2', roughness: 0.3, metalness: 0.0, price: 0 },
      { name: 'Slate Gray Porcelain', color: '#6E7275', roughness: 0.35, metalness: 0.0, price: 1600 },
      { name: 'Warm Travertine', color: '#D8C7A8', roughness: 0.4, metalness: 0.0, price: 2100 },
      { name: 'Black Marble Look', color: '#242426', roughness: 0.2, metalness: 0.0, price: 2600 },
    ],
  },
  countertops_kitchen: {
    category: 'countertops',
    label: 'Kitchen Countertops',
    rooms: ['Kitchen (including island)'],
    default: { name: 'Gray Granite (Default)', color: '#8A8A8A', roughness: 0.4, metalness: 0.0 },
    options: [
      { name: 'Gray Granite (Default)', color: '#8A8A8A', roughness: 0.4, metalness: 0.0, price: 0 },
      { name: 'Carrara White Quartz', color: '#EDEBE6', roughness: 0.25, metalness: 0.0, price: 2400 },
      { name: 'Midnight Black Granite', color: '#1C1C1E', roughness: 0.3, metalness: 0.0, price: 2900 },
      { name: 'Calacatta Gold Marble', color: '#E8DFC8', roughness: 0.2, metalness: 0.0, price: 3800 },
    ],
  },
  countertops_bathroom: {
    category: 'countertops',
    label: 'Bathroom Countertops',
    rooms: ['All bathrooms'],
    default: { name: 'White Cultured Marble (Default)', color: '#F5F2EE', roughness: 0.2, metalness: 0.0 },
    options: [
      { name: 'White Cultured Marble (Default)', color: '#F5F2EE', roughness: 0.2, metalness: 0.0, price: 0 },
      { name: 'Gray Quartz', color: '#9A9A9C', roughness: 0.25, metalness: 0.0, price: 1400 },
      { name: 'Beige Travertine', color: '#D9CBB0', roughness: 0.3, metalness: 0.0, price: 1600 },
    ],
  },
  'wall-tiles_kitchen': {
    category: 'wall-tiles',
    label: 'Kitchen Backsplash',
    rooms: ['Kitchen (behind counters)'],
    default: { name: 'White Subway Tile (Default)', color: '#F8F8F8', roughness: 0.35, metalness: 0.0 },
    options: [
      { name: 'White Subway Tile (Default)', color: '#F8F8F8', roughness: 0.35, metalness: 0.0, price: 0 },
      { name: 'Navy Mosaic', color: '#1F2E4A', roughness: 0.3, metalness: 0.0, price: 1300 },
      { name: 'Herringbone Marble', color: '#E5E0D8', roughness: 0.25, metalness: 0.0, price: 1900 },
    ],
  },
  'wall-tiles_bathroom': {
    category: 'wall-tiles',
    label: 'Bathroom Wall Tiles',
    rooms: ['Shower walls', 'Tub surround', 'Vanity backsplash'],
    default: { name: 'Mixed Stone (Default)', color: '#8C7E6A', roughness: 0.45, metalness: 0.0 },
    options: [
      { name: 'Mixed Stone (Default)', color: '#8C7E6A', roughness: 0.45, metalness: 0.0, price: 0 },
      { name: 'White Subway', color: '#F5F5F5', roughness: 0.3, metalness: 0.0, price: 2100 },
      { name: 'Warm Travertine', color: '#D6C4A2', roughness: 0.4, metalness: 0.0, price: 3400 },
      { name: 'Cool Gray', color: '#8C9096', roughness: 0.35, metalness: 0.0, price: 2400 },
      { name: 'Dark Bronze', color: '#2E241E', roughness: 0.4, metalness: 0.1, price: 3800 },
    ],
  },
  cabinets_kitchen: {
    category: 'cabinets',
    label: 'Kitchen Cabinets',
    rooms: ['Kitchen (upper + lower + island)'],
    default: { name: 'White Painted (Default)', color: '#FFFFFF', roughness: 0.5, metalness: 0.0 },
    options: [
      { name: 'White Painted (Default)', color: '#FFFFFF', roughness: 0.5, metalness: 0.0, price: 0 },
      { name: 'Navy Blue', color: '#1F2E4A', roughness: 0.45, metalness: 0.0, price: 2600 },
      { name: 'Forest Green', color: '#2E4034', roughness: 0.45, metalness: 0.0, price: 2600 },
      { name: 'Natural Walnut', color: '#5B3A29', roughness: 0.5, metalness: 0.0, price: 3100 },
      { name: 'Charcoal Matte', color: '#3A3A3C', roughness: 0.6, metalness: 0.0, price: 2400 },
    ],
  },
  cabinets_bathroom: {
    category: 'cabinets',
    label: 'Bathroom Vanity Cabinets',
    rooms: ['All bathrooms'],
    default: { name: 'White Painted (Default)', color: '#FFFFFF', roughness: 0.5, metalness: 0.0 },
    options: [
      { name: 'White Painted (Default)', color: '#FFFFFF', roughness: 0.5, metalness: 0.0, price: 0 },
      { name: 'Espresso', color: '#3A2A22', roughness: 0.5, metalness: 0.0, price: 1200 },
      { name: 'Soft Gray', color: '#B9BCC0', roughness: 0.5, metalness: 0.0, price: 900 },
    ],
  },
  cabinets_utility: {
    category: 'cabinets',
    label: 'Utility/Laundry Cabinets',
    rooms: ['Laundry room', 'Mudroom'],
    default: { name: 'White Laminate (Default)', color: '#F0F0F0', roughness: 0.6, metalness: 0.0 },
    options: [
      { name: 'White Laminate (Default)', color: '#F0F0F0', roughness: 0.6, metalness: 0.0, price: 0 },
      { name: 'Slate Gray', color: '#5B6066', roughness: 0.6, metalness: 0.0, price: 700 },
    ],
  },
  'paint_whole-home': {
    category: 'paint',
    label: 'Interior Wall Paint',
    rooms: ['Interior walls and ceilings in all rooms'],
    default: { name: 'Classic White (Default)', color: '#FAFAFA', roughness: 0.95, metalness: 0.0 },
    options: [
      { name: 'Classic White (Default)', color: '#FAFAFA', roughness: 0.95, metalness: 0.0, price: 0 },
      { name: 'Warm Greige', color: '#D8CFC2', roughness: 0.95, metalness: 0.0, price: 400 },
      { name: 'Soft Sage', color: '#C3CDB8', roughness: 0.95, metalness: 0.0, price: 400 },
      { name: 'Pale Sky Blue', color: '#CBDAE3', roughness: 0.95, metalness: 0.0, price: 400 },
      { name: 'Charcoal Accent', color: '#3D3D3F', roughness: 0.9, metalness: 0.0, price: 500 },
    ],
  },
  'fixtures_whole-home': {
    category: 'fixtures',
    label: 'Plumbing Fixtures & Hardware',
    rooms: ['Faucets', 'Handles', 'Towel bars', 'Light fixtures', 'Cabinet pulls'],
    default: { name: 'Brushed Nickel (Default)', color: '#C0C0C0', roughness: 0.4, metalness: 0.8 },
    options: [
      { name: 'Brushed Nickel (Default)', color: '#C0C0C0', roughness: 0.4, metalness: 0.8, price: 0 },
      { name: 'Matte Black', color: '#1C1C1C', roughness: 0.35, metalness: 0.7, price: 850 },
      { name: 'Polished Chrome', color: '#D8D8DA', roughness: 0.15, metalness: 0.9, price: 650 },
      { name: 'Brushed Gold', color: '#B08D57', roughness: 0.3, metalness: 0.85, price: 1100 },
    ],
  },
  'appliances_whole-home': {
    category: 'appliances',
    label: 'Kitchen Appliances',
    rooms: ['Refrigerator', 'Range/oven', 'Dishwasher', 'Range hood'],
    default: { name: 'Stainless Steel (Default)', color: '#B0B0B0', roughness: 0.3, metalness: 0.9 },
    options: [
      { name: 'Stainless Steel (Default)', color: '#B0B0B0', roughness: 0.3, metalness: 0.9, price: 0 },
      { name: 'Matte Black Slate', color: '#2A2A2C', roughness: 0.4, metalness: 0.6, price: 2200 },
      { name: 'Panel-Ready White', color: '#F2F2F2', roughness: 0.5, metalness: 0.1, price: 3200 },
    ],
  },
  'exterior_whole-home': {
    category: 'exterior',
    label: 'Exterior Siding',
    rooms: ['Facade', 'Siding', 'Brick areas'],
    default: { name: 'White Vinyl Siding (Default)', color: '#F0F0F0', roughness: 0.7, metalness: 0.0 },
    options: [
      { name: 'White Vinyl Siding (Default)', color: '#F0F0F0', roughness: 0.7, metalness: 0.0, price: 0 },
      { name: 'Full Brick', color: '#9C4A3A', roughness: 0.8, metalness: 0.0, price: 8500 },
      { name: 'Board & Batten Gray', color: '#6E7275', roughness: 0.65, metalness: 0.0, price: 5200 },
      { name: 'Coastal Blue', color: '#4A6A7A', roughness: 0.7, metalness: 0.0, price: 4800 },
    ],
  },
};

export const ZONE_KEYS = Object.keys(ZONES);

export function categoryZones(categoryKey) {
  return ZONE_KEYS.filter((k) => ZONES[k].category === categoryKey);
}

// Short filename-friendly word per category, used to build capture names like
// "kitchen_floor" / "kitchen_floor_1" as shown in the product requirements.
export const CATEGORY_SHORT_WORD = {
  flooring: 'floor',
  countertops: 'countertop',
  'wall-tiles': 'walltile',
  cabinets: 'cabinet',
  paint: 'paint',
  fixtures: 'fixtures',
  appliances: 'appliances',
  exterior: 'exterior',
};

export function isConfigurable(name) {
  return !!name && !name.startsWith('structure_') && !!ZONES[name];
}
