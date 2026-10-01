/**
 * Demo catalog for local development: a realistic slice of a UAE hardware,
 * electrical and sanitary ware shop. Prices are net fils (VAT-exclusive).
 */

export interface SeedVariant {
  sku: string;
  options?: Record<string, string>;
  attrs?: Record<string, string>;
  baseUom?: string;
  weightGrams: number;
  uomConversions?: { uom: string; factor: number }[];
  retail: number; // fils per base uom
  tiers?: [minQty: number, fils: number][]; // retail quantity breaks
  trade?: number; // contractor price per base uom
  promo?: number; // online promo price
  stock: Record<string, number>; // branch code → qty
}

export interface SeedProduct {
  group: string;
  name: string;
  category: string;
  brand: string;
  description: string;
  specs: [string, string][];
  pickupOnly?: boolean;
  featured?: boolean;
  variants: SeedVariant[];
}

export const BRANCHES = [
  {
    code: 'MAIN',
    name: 'Al Quoz Showroom',
    emirate: 'DUBAI' as const,
    address: 'Street 8, Al Quoz Industrial Area 3, Dubai',
    phone: '+971 4 000 1111',
    lat: 25.1379,
    lng: 55.2343,
  },
  {
    code: 'SHJ',
    name: 'Sharjah Industrial Area',
    emirate: 'SHARJAH' as const,
    address: 'Industrial Area 10, Sharjah',
    phone: '+971 6 000 2222',
    lat: 25.3124,
    lng: 55.4413,
  },
  {
    code: 'AUH',
    name: 'Mussafah Warehouse',
    emirate: 'ABU_DHABI' as const,
    address: 'M-14, Mussafah Industrial, Abu Dhabi',
    phone: '+971 2 000 3333',
    lat: 24.3515,
    lng: 54.5042,
  },
];

export const OPENING_HOURS = {
  mon: '07:30-20:00',
  tue: '07:30-20:00',
  wed: '07:30-20:00',
  thu: '07:30-20:00',
  fri: '07:30-12:00, 14:00-20:00',
  sat: '07:30-20:00',
  sun: '08:00-18:00',
};

/** [slug, name, parentSlug] */
export const CATEGORIES: [string, string, string | null][] = [
  ['plumbing', 'Plumbing', null],
  ['pipes-fittings', 'Pipes & Fittings', 'plumbing'],
  ['valves', 'Valves', 'plumbing'],
  ['water-heaters', 'Water Heaters', 'plumbing'],
  ['pumps', 'Pumps', 'plumbing'],
  ['sanitary-ware', 'Sanitary Ware', null],
  ['mixers-taps', 'Mixers & Taps', 'sanitary-ware'],
  ['showers', 'Showers', 'sanitary-ware'],
  ['toilets', 'Toilets', 'sanitary-ware'],
  ['wash-basins', 'Wash Basins', 'sanitary-ware'],
  ['bathroom-accessories', 'Bathroom Accessories', 'sanitary-ware'],
  ['electrical', 'Electrical', null],
  ['cables-wires', 'Cables & Wires', 'electrical'],
  ['switches-sockets', 'Switches & Sockets', 'electrical'],
  ['circuit-breakers', 'Circuit Breakers', 'electrical'],
  ['lighting', 'Lighting', 'electrical'],
  ['hardware-tools', 'Hardware & Tools', null],
  ['power-tools', 'Power Tools', 'hardware-tools'],
  ['hand-tools', 'Hand Tools', 'hardware-tools'],
  ['fasteners', 'Fasteners', 'hardware-tools'],
  ['locks-door-hardware', 'Locks & Door Hardware', 'hardware-tools'],
  ['safety-ppe', 'Safety & PPE', 'hardware-tools'],
  ['paints-chemicals', 'Paints & Chemicals', null],
  ['interior-paint', 'Interior Paint', 'paints-chemicals'],
  ['exterior-paint', 'Exterior Paint', 'paints-chemicals'],
  ['adhesives-sealants', 'Adhesives & Sealants', 'paints-chemicals'],
  ['waterproofing', 'Waterproofing', 'paints-chemicals'],
  ['building-materials', 'Building Materials', null],
  ['cement-blocks', 'Cement & Blocks', 'building-materials'],
  ['tiles', 'Tiles', 'building-materials'],
  ['gypsum-boards', 'Gypsum & Boards', 'building-materials'],
  ['steel', 'Steel & Rebar', 'building-materials'],
];

/** [slug, name, featured] */
export const BRANDS: [string, string, boolean][] = [
  ['grohe', 'Grohe', true],
  ['hansgrohe', 'Hansgrohe', true],
  ['rak-ceramics', 'RAK Ceramics', true],
  ['duravit', 'Duravit', false],
  ['milano', 'Milano', false],
  ['schneider-electric', 'Schneider Electric', true],
  ['legrand', 'Legrand', true],
  ['abb', 'ABB', false],
  ['ducab', 'Ducab', true],
  ['philips', 'Philips', true],
  ['bosch', 'Bosch', true],
  ['makita', 'Makita', true],
  ['dewalt', 'DeWalt', false],
  ['stanley', 'Stanley', false],
  ['jotun', 'Jotun', true],
  ['national-paints', 'National Paints', false],
  ['sika', 'Sika', false],
  ['fosroc', 'Fosroc', false],
  ['cosmoplast', 'Cosmoplast', true],
  ['aquatherm', 'Aquatherm', false],
  ['ariston', 'Ariston', false],
  ['pedrollo', 'Pedrollo', false],
  ['yale', 'Yale', false],
  ['emirates-cement', 'Emirates Cement', false],
  ['knauf', 'Knauf', false],
  ['emirates-steel', 'Emirates Steel', false],
  ['3m', '3M', false],
];

/** [code, name, unit, sortOrder] */
export const ATTRIBUTES: [string, string, string | null, number][] = [
  ['size', 'Size', null, 1],
  ['colour', 'Colour', null, 2],
  ['finish', 'Finish', null, 3],
  ['capacity', 'Capacity', null, 4],
  ['cable_size', 'Cable size', 'mm²', 5],
  ['rating', 'Current rating', 'A', 6],
  ['poles', 'Poles', null, 7],
  ['wattage', 'Wattage', 'W', 8],
  ['voltage', 'Voltage', 'V', 9],
  ['colour_temp', 'Colour temperature', 'K', 10],
  ['length', 'Length', 'm', 11],
];

const s = (main: number, shj: number, auh: number) => ({ MAIN: main, SHJ: shj, AUH: auh });

export const PRODUCTS: SeedProduct[] = [
  // ── Plumbing ──
  {
    group: 'PPR-PIPE-PN20',
    name: 'Cosmoplast PPR Pipe PN20 (4 m)',
    category: 'pipes-fittings',
    brand: 'cosmoplast',
    description:
      'Polypropylene random (PPR) pressure pipe for hot and cold water supply. PN20 rated for hot water up to 70 °C. Made in the UAE and approved by DEWA. Joined by heat fusion with matching PPR fittings.',
    specs: [['Material', 'PP-R Type 3'], ['Pressure rating', 'PN20'], ['Length', '4 m'], ['Max temperature', '95 °C (short term)'], ['Standard', 'DIN 8077/8078']],
    featured: true,
    variants: [
      { sku: 'CP-PPR20-20', options: { size: '20 mm' }, attrs: { size: '20 mm' }, weightGrams: 780, retail: 1450, tiers: [[10, 1350], [50, 1250]], trade: 1200, stock: s(420, 180, 120) },
      { sku: 'CP-PPR20-25', options: { size: '25 mm' }, attrs: { size: '25 mm' }, weightGrams: 1200, retail: 2150, tiers: [[10, 2000], [50, 1850]], trade: 1780, stock: s(300, 150, 90) },
      { sku: 'CP-PPR20-32', options: { size: '32 mm' }, attrs: { size: '32 mm' }, weightGrams: 1920, retail: 3400, tiers: [[10, 3150], [50, 2950]], trade: 2800, stock: s(160, 60, 40) },
    ],
  },
  {
    group: 'PPR-ELBOW-90',
    name: 'Cosmoplast PPR Elbow 90°',
    category: 'pipes-fittings',
    brand: 'cosmoplast',
    description: 'Heat-fusion PPR elbow for changing pipe direction by 90°. Use with Cosmoplast PPR pipes of the same diameter.',
    specs: [['Material', 'PP-R'], ['Angle', '90°'], ['Joining', 'Socket fusion']],
    variants: [
      { sku: 'CP-PPRE90-20', options: { size: '20 mm' }, attrs: { size: '20 mm' }, weightGrams: 20, retail: 150, tiers: [[50, 120]], trade: 110, stock: s(2500, 900, 800) },
      { sku: 'CP-PPRE90-25', options: { size: '25 mm' }, attrs: { size: '25 mm' }, weightGrams: 32, retail: 220, tiers: [[50, 180]], trade: 165, stock: s(1800, 700, 600) },
      { sku: 'CP-PPRE90-32', options: { size: '32 mm' }, attrs: { size: '32 mm' }, weightGrams: 55, retail: 380, tiers: [[50, 320]], trade: 300, stock: s(900, 300, 250) },
    ],
  },
  {
    group: 'UPVC-PIPE-DRAIN',
    name: 'Cosmoplast uPVC Drainage Pipe (6 m)',
    category: 'pipes-fittings',
    brand: 'cosmoplast',
    description: 'Unplasticised PVC pipe for soil, waste and rainwater drainage. Solvent-cement jointed. 6 m length.',
    specs: [['Material', 'uPVC'], ['Length', '6 m'], ['Application', 'Soil, waste & vent'], ['Standard', 'BS EN 1329']],
    pickupOnly: true,
    variants: [
      { sku: 'CP-UPVC-110', options: { size: '110 mm (4")' }, attrs: { size: '110 mm' }, weightGrams: 9800, retail: 6800, tiers: [[10, 6300]], trade: 6000, stock: s(140, 60, 45) },
      { sku: 'CP-UPVC-160', options: { size: '160 mm (6")' }, attrs: { size: '160 mm' }, weightGrams: 18500, retail: 13500, tiers: [[10, 12500]], trade: 12000, stock: s(60, 20, 20) },
    ],
  },
  {
    group: 'BALL-VALVE-BRASS',
    name: 'Brass Ball Valve, Lever Handle',
    category: 'valves',
    brand: 'milano',
    description: 'Full-bore forged brass ball valve with a steel lever handle. For water isolation on supply lines. Threaded BSP female both ends.',
    specs: [['Body', 'Forged brass CW617N'], ['Connection', 'BSP female'], ['Max pressure', 'PN25'], ['Max temperature', '120 °C']],
    variants: [
      { sku: 'ML-BV-050', options: { size: '1/2"' }, attrs: { size: '1/2"' }, weightGrams: 210, retail: 2500, tiers: [[12, 2250]], trade: 2100, promo: 2200, stock: s(260, 80, 60) },
      { sku: 'ML-BV-075', options: { size: '3/4"' }, attrs: { size: '3/4"' }, weightGrams: 320, retail: 3600, tiers: [[12, 3300]], trade: 3100, stock: s(180, 70, 40) },
      { sku: 'ML-BV-100', options: { size: '1"' }, attrs: { size: '1"' }, weightGrams: 480, retail: 5200, tiers: [[12, 4800]], trade: 4500, stock: s(90, 30, 25) },
    ],
  },
  {
    group: 'ARISTON-PRO1-ECO',
    name: 'Ariston Pro1 Eco Electric Water Heater',
    category: 'water-heaters',
    brand: 'ariston',
    description: 'Vertical electric storage water heater with titanium-enamelled tank, magnesium anode and adjustable thermostat. Ideal for villa and apartment bathrooms.',
    specs: [['Power', '1.5 kW'], ['Voltage', '230 V'], ['Tank', 'Titanium enamel'], ['Warranty', '5 years tank, 2 years parts']],
    featured: true,
    variants: [
      { sku: 'AR-PRO1-50', options: { capacity: '50 L' }, attrs: { capacity: '50 L', wattage: '1500' }, weightGrams: 17000, retail: 59900, trade: 55000, promo: 54900, stock: s(24, 10, 8) },
      { sku: 'AR-PRO1-80', options: { capacity: '80 L' }, attrs: { capacity: '80 L', wattage: '1500' }, weightGrams: 22000, retail: 72900, trade: 67000, stock: s(18, 8, 6) },
      { sku: 'AR-PRO1-100', options: { capacity: '100 L' }, attrs: { capacity: '100 L', wattage: '1500' }, weightGrams: 26000, retail: 84900, trade: 78000, stock: s(10, 4, 3) },
    ],
  },
  {
    group: 'PEDROLLO-PKM60',
    name: 'Pedrollo PKm 60 Peripheral Water Pump 0.5 HP',
    category: 'pumps',
    brand: 'pedrollo',
    description: 'Compact peripheral pump for boosting water pressure from roof or ground tanks in villas. Brass impeller, thermal protection built in.',
    specs: [['Power', '0.37 kW (0.5 HP)'], ['Max head', '40 m'], ['Max flow', '40 L/min'], ['Voltage', '230 V'], ['Made in', 'Italy']],
    variants: [{ sku: 'PD-PKM60', weightGrams: 5500, retail: 32500, trade: 29500, stock: s(30, 12, 10) }],
  },

  // ── Sanitary ware ──
  {
    group: 'GROHE-EUROSMART-BASIN',
    name: 'Grohe Eurosmart Basin Mixer',
    category: 'mixers-taps',
    brand: 'grohe',
    description:
      'Single-lever basin mixer with GROHE SilkMove ceramic cartridge for smooth control and EcoJoy water saving. StarLight chrome finish resists scratches and tarnish. Includes pop-up waste.',
    specs: [['Finish', 'StarLight Chrome'], ['Cartridge', '28 mm ceramic'], ['Flow rate', '5.7 L/min (EcoJoy)'], ['Warranty', '5 years']],
    featured: true,
    variants: [
      { sku: 'GR-33265003', options: { size: 'S-Size' }, attrs: { finish: 'Chrome', size: 'S-Size' }, weightGrams: 1800, retail: 38900, trade: 35000, promo: 33900, stock: s(35, 12, 10) },
      { sku: 'GR-23324003', options: { size: 'M-Size' }, attrs: { finish: 'Chrome', size: 'M-Size' }, weightGrams: 2000, retail: 45900, trade: 41500, stock: s(22, 8, 6) },
    ],
  },
  {
    group: 'GROHE-BAUEDGE-KITCHEN',
    name: 'Grohe BauEdge Kitchen Sink Mixer',
    category: 'mixers-taps',
    brand: 'grohe',
    description: 'High swivel-spout kitchen mixer with 360° rotation and single-lever control. Long-lasting ceramic cartridge.',
    specs: [['Finish', 'Chrome'], ['Spout', 'Tubular, swivel 360°'], ['Flow rate', '12 L/min']],
    variants: [{ sku: 'GR-31367000', attrs: { finish: 'Chrome' }, weightGrams: 2200, retail: 42500, trade: 38500, stock: s(18, 6, 5) }],
  },
  {
    group: 'MILANO-PILLAR-TAP',
    name: 'Milano Basin Pillar Tap',
    category: 'mixers-taps',
    brand: 'milano',
    description: 'Simple quarter-turn pillar tap for basins. Brass body with chrome plating. Good value for rentals and staff accommodation.',
    specs: [['Body', 'Brass'], ['Finish', 'Chrome'], ['Connection', '1/2" BSP']],
    variants: [
      { sku: 'ML-PT-CH', options: { finish: 'Chrome' }, attrs: { finish: 'Chrome' }, weightGrams: 550, retail: 4500, tiers: [[10, 4000]], trade: 3700, stock: s(150, 60, 40) },
      { sku: 'ML-PT-BK', options: { finish: 'Matt black' }, attrs: { finish: 'Matt black' }, weightGrams: 550, retail: 5500, tiers: [[10, 5000]], trade: 4600, stock: s(60, 20, 0) },
    ],
  },
  {
    group: 'HANSGROHE-CROMA-SHOWER',
    name: 'hansgrohe Croma Select S Shower Set',
    category: 'showers',
    brand: 'hansgrohe',
    description: 'Hand shower with 3 spray modes, 65 cm wall bar and 160 cm hose. Select button to change spray at a click. QuickClean nozzles make limescale easy to wipe off.',
    specs: [['Spray modes', 'Rain, RainAir, Massage'], ['Hand shower', '110 mm'], ['Wall bar', '65 cm'], ['Hose', '160 cm']],
    variants: [{ sku: 'HG-26562400', attrs: { finish: 'White/Chrome' }, weightGrams: 1600, retail: 52500, trade: 47500, stock: s(14, 6, 4) }],
  },
  {
    group: 'RAK-RESORT-WC',
    name: 'RAK Resort Close-Coupled WC',
    category: 'toilets',
    brand: 'rak-ceramics',
    description: 'Close-coupled toilet with rimless bowl, dual-flush cistern (3/6 L) and soft-close seat. Made in Ras Al Khaimah.',
    specs: [['Type', 'Close-coupled, floor standing'], ['Flush', 'Dual 3/6 L'], ['Outlet', 'P-trap / S-trap'], ['Seat', 'Soft close, quick release']],
    featured: true,
    variants: [
      { sku: 'RAK-RESWC-WH', options: { colour: 'White' }, attrs: { colour: 'White' }, weightGrams: 38000, retail: 89900, trade: 82000, stock: s(20, 10, 8) },
    ],
  },
  {
    group: 'DURAVIT-DSTYLE-BASIN',
    name: 'Duravit D-Neo Wash Basin 60 cm',
    category: 'wash-basins',
    brand: 'duravit',
    description: 'Wall-mounted ceramic wash basin with overflow and one tap hole. Clean, modern lines for residential bathrooms.',
    specs: [['Width', '600 mm'], ['Depth', '440 mm'], ['Material', 'Sanitary ceramic'], ['Tap holes', '1']],
    variants: [{ sku: 'DV-2366600000', attrs: { colour: 'White', size: '60 cm' }, weightGrams: 14000, retail: 64500, trade: 59000, stock: s(9, 3, 2) }],
  },
  {
    group: 'MILANO-BATH-SET',
    name: 'Milano Bathroom Accessory Set (4 pcs)',
    category: 'bathroom-accessories',
    brand: 'milano',
    description: 'Towel bar, towel ring, robe hook and toilet roll holder in brushed stainless steel. Concealed fixings included.',
    specs: [['Material', 'Stainless steel 304'], ['Finish', 'Brushed'], ['Pieces', '4']],
    variants: [{ sku: 'ML-ACC4-SS', attrs: { finish: 'Brushed steel' }, weightGrams: 1900, retail: 14900, trade: 13000, promo: 11900, stock: s(40, 15, 10) }],
  },

  // ── Electrical ──
  {
    group: 'DUCAB-PVC-SINGLE',
    name: 'Ducab Single Core PVC Cable (450/750 V)',
    category: 'cables-wires',
    brand: 'ducab',
    description:
      'Copper conductor, PVC insulated single-core building wire, made in the UAE. For fixed wiring in conduit. Sold per metre or as a 100 m coil.',
    specs: [['Conductor', 'Plain annealed copper, Class 2'], ['Insulation', 'PVC'], ['Voltage', '450/750 V'], ['Standard', 'BS EN 50525'], ['Coil', '100 m']],
    featured: true,
    variants: [
      { sku: 'DC-1C-1.5-RD', options: { size: '1.5 mm²', colour: 'Red' }, attrs: { cable_size: '1.5', colour: 'Red' }, baseUom: 'm', weightGrams: 20, uomConversions: [{ uom: 'roll', factor: 100 }], retail: 95, tiers: [[100, 82], [500, 78]], trade: 76, stock: s(4000, 1500, 1200) },
      { sku: 'DC-1C-2.5-RD', options: { size: '2.5 mm²', colour: 'Red' }, attrs: { cable_size: '2.5', colour: 'Red' }, baseUom: 'm', weightGrams: 32, uomConversions: [{ uom: 'roll', factor: 100 }], retail: 150, tiers: [[100, 132], [500, 125]], trade: 122, stock: s(3500, 1200, 1000) },
      { sku: 'DC-1C-2.5-BK', options: { size: '2.5 mm²', colour: 'Black' }, attrs: { cable_size: '2.5', colour: 'Black' }, baseUom: 'm', weightGrams: 32, uomConversions: [{ uom: 'roll', factor: 100 }], retail: 150, tiers: [[100, 132], [500, 125]], trade: 122, stock: s(3200, 1100, 900) },
      { sku: 'DC-1C-4.0-RD', options: { size: '4 mm²', colour: 'Red' }, attrs: { cable_size: '4', colour: 'Red' }, baseUom: 'm', weightGrams: 48, uomConversions: [{ uom: 'roll', factor: 100 }], retail: 240, tiers: [[100, 212], [500, 200]], trade: 195, stock: s(2000, 800, 600) },
      { sku: 'DC-1C-6.0-GY', options: { size: '6 mm²', colour: 'Green/Yellow' }, attrs: { cable_size: '6', colour: 'Green/Yellow' }, baseUom: 'm', weightGrams: 70, uomConversions: [{ uom: 'roll', factor: 100 }], retail: 360, tiers: [[100, 320], [500, 300]], trade: 290, stock: s(1500, 500, 400) },
    ],
  },
  {
    group: 'SCHNEIDER-UNICA-SOCKET',
    name: 'Schneider Electric Unica 13 A Switched Socket',
    category: 'switches-sockets',
    brand: 'schneider-electric',
    description: 'BS 1363 13 A switched socket outlet with shuttered earth. Modern Unica design, fits standard UK back boxes.',
    specs: [['Rating', '13 A, 250 V'], ['Standard', 'BS 1363'], ['Gang', '1 or 2']],
    variants: [
      { sku: 'SE-U13S1-WH', options: { size: '1 gang', colour: 'White' }, attrs: { rating: '13', colour: 'White' }, weightGrams: 120, retail: 1850, tiers: [[20, 1650]], trade: 1550, stock: s(600, 200, 180) },
      { sku: 'SE-U13S2-WH', options: { size: '2 gang', colour: 'White' }, attrs: { rating: '13', colour: 'White' }, weightGrams: 190, retail: 2950, tiers: [[20, 2650]], trade: 2500, stock: s(500, 180, 150) },
      { sku: 'SE-U13S2-BK', options: { size: '2 gang', colour: 'Black' }, attrs: { rating: '13', colour: 'Black' }, weightGrams: 190, retail: 3650, tiers: [[20, 3300]], trade: 3100, stock: s(120, 40, 0) },
    ],
  },
  {
    group: 'LEGRAND-BELANKO-SWITCH',
    name: 'Legrand Belanko S Light Switch',
    category: 'switches-sockets',
    brand: 'legrand',
    description: '10 AX one-way / two-way light switch with a slim profile plate. Easy screw terminals for quick installation.',
    specs: [['Rating', '10 AX, 250 V'], ['Operation', '1-way / 2-way'], ['Standard', 'BS EN 60669']],
    variants: [
      { sku: 'LG-BS-1G2W', options: { size: '1 gang' }, attrs: { rating: '10', colour: 'White' }, weightGrams: 80, retail: 1200, tiers: [[20, 1050]], trade: 980, stock: s(800, 300, 250) },
      { sku: 'LG-BS-2G2W', options: { size: '2 gang' }, attrs: { rating: '10', colour: 'White' }, weightGrams: 95, retail: 1650, tiers: [[20, 1450]], trade: 1350, stock: s(600, 250, 200) },
      { sku: 'LG-BS-3G2W', options: { size: '3 gang' }, attrs: { rating: '10', colour: 'White' }, weightGrams: 110, retail: 2150, tiers: [[20, 1900]], trade: 1800, stock: s(400, 150, 120) },
    ],
  },
  {
    group: 'ABB-MCB-SH200',
    name: 'ABB SH200 Miniature Circuit Breaker',
    category: 'circuit-breakers',
    brand: 'abb',
    description: 'DIN-rail MCB with C tripping curve, 6 kA breaking capacity. For protecting lighting and socket circuits in distribution boards.',
    specs: [['Curve', 'C'], ['Breaking capacity', '6 kA'], ['Mounting', 'DIN rail 35 mm'], ['Standard', 'IEC 60898-1']],
    variants: [
      { sku: 'ABB-SH201-C10', options: { rating: '10 A', poles: '1P' }, attrs: { rating: '10', poles: '1P' }, weightGrams: 120, retail: 1950, tiers: [[12, 1750]], trade: 1650, stock: s(300, 100, 90) },
      { sku: 'ABB-SH201-C20', options: { rating: '20 A', poles: '1P' }, attrs: { rating: '20', poles: '1P' }, weightGrams: 120, retail: 1950, tiers: [[12, 1750]], trade: 1650, stock: s(350, 120, 100) },
      { sku: 'ABB-SH201-C32', options: { rating: '32 A', poles: '1P' }, attrs: { rating: '32', poles: '1P' }, weightGrams: 120, retail: 2150, tiers: [[12, 1950]], trade: 1850, stock: s(200, 80, 60) },
      { sku: 'ABB-SH203-C63', options: { rating: '63 A', poles: '3P' }, attrs: { rating: '63', poles: '3P' }, weightGrams: 380, retail: 9800, tiers: [[6, 9000]], trade: 8600, stock: s(40, 12, 10) },
    ],
  },
  {
    group: 'PHILIPS-LED-BULB',
    name: 'Philips LED Bulb E27',
    category: 'lighting',
    brand: 'philips',
    description: 'Energy-saving LED bulb with instant full brightness and 15,000 hour life. Replaces traditional incandescent bulbs with up to 90% less energy.',
    specs: [['Base', 'E27'], ['Lifetime', '15,000 hours'], ['Dimmable', 'No'], ['Voltage', '220-240 V']],
    variants: [
      { sku: 'PH-LED9-WW', options: { wattage: '9 W', colour: 'Warm white' }, attrs: { wattage: '9', colour_temp: '3000' }, weightGrams: 45, retail: 950, tiers: [[12, 800]], trade: 750, promo: 790, stock: s(1200, 500, 400) },
      { sku: 'PH-LED9-CW', options: { wattage: '9 W', colour: 'Cool daylight' }, attrs: { wattage: '9', colour_temp: '6500' }, weightGrams: 45, retail: 950, tiers: [[12, 800]], trade: 750, promo: 790, stock: s(1500, 600, 500) },
      { sku: 'PH-LED13-CW', options: { wattage: '13 W', colour: 'Cool daylight' }, attrs: { wattage: '13', colour_temp: '6500' }, weightGrams: 60, retail: 1350, tiers: [[12, 1150]], trade: 1080, stock: s(900, 300, 250) },
    ],
  },
  {
    group: 'PHILIPS-DOWNLIGHT',
    name: 'Philips Meson LED Downlight',
    category: 'lighting',
    brand: 'philips',
    description: 'Recessed round LED downlight for false ceilings. Slim design, even light without glare. Driver included.',
    specs: [['Cut-out', 'Ø 105-150 mm'], ['IP rating', 'IP20'], ['Lifetime', '15,000 hours']],
    variants: [
      { sku: 'PH-MES-9W-4K', options: { wattage: '9 W', colour: 'Neutral white' }, attrs: { wattage: '9', colour_temp: '4000' }, weightGrams: 180, retail: 2200, tiers: [[20, 1900]], trade: 1800, stock: s(400, 150, 120) },
      { sku: 'PH-MES-13W-4K', options: { wattage: '13 W', colour: 'Neutral white' }, attrs: { wattage: '13', colour_temp: '4000' }, weightGrams: 240, retail: 2900, tiers: [[20, 2550]], trade: 2400, stock: s(300, 100, 80) },
    ],
  },

  // ── Hardware & tools ──
  {
    group: 'BOSCH-GSB-13RE',
    name: 'Bosch GSB 13 RE Professional Impact Drill 600 W',
    category: 'power-tools',
    brand: 'bosch',
    description: 'Compact and powerful impact drill for drilling in concrete, masonry, wood and metal. 13 mm keyless chuck, variable speed and reverse.',
    specs: [['Power', '600 W'], ['Chuck', '13 mm keyless'], ['Drill Ø concrete', '13 mm'], ['Weight', '1.8 kg'], ['Warranty', '1 year']],
    featured: true,
    variants: [{ sku: 'BO-06012171K0', attrs: { wattage: '600', voltage: '220' }, weightGrams: 2600, retail: 21900, trade: 19500, promo: 18900, stock: s(35, 15, 10) }],
  },
  {
    group: 'MAKITA-DHP482',
    name: 'Makita DHP482 18 V Cordless Combi Drill',
    category: 'power-tools',
    brand: 'makita',
    description: '18 V LXT cordless hammer driver drill with 2-speed gearbox and 62 Nm max torque. Kit includes 2 × 3.0 Ah batteries, charger and case.',
    specs: [['Voltage', '18 V LXT'], ['Max torque', '62 Nm'], ['Chuck', '13 mm'], ['Kit', '2 × 3.0 Ah, DC18RC charger, case']],
    variants: [
      { sku: 'MK-DHP482Z', options: { size: 'Body only' }, attrs: { voltage: '18' }, weightGrams: 1700, retail: 34900, trade: 31500, stock: s(20, 8, 6) },
      { sku: 'MK-DHP482RFE', options: { size: 'Kit (2 × 3.0 Ah)' }, attrs: { voltage: '18' }, weightGrams: 4800, retail: 89900, trade: 81000, stock: s(12, 4, 3) },
    ],
  },
  {
    group: 'DEWALT-DWE4050',
    name: 'DeWalt DWE4050 Angle Grinder 115 mm 800 W',
    category: 'power-tools',
    brand: 'dewalt',
    description: 'Slim-body 115 mm angle grinder with dust ejection system and anti-restart protection.',
    specs: [['Power', '800 W'], ['Disc', '115 mm'], ['No-load speed', '11,800 rpm']],
    variants: [{ sku: 'DW-DWE4050', attrs: { wattage: '800' }, weightGrams: 2400, retail: 17500, trade: 15800, stock: s(25, 10, 8) }],
  },
  {
    group: 'STANLEY-TAPE',
    name: 'Stanley PowerLock Tape Measure',
    category: 'hand-tools',
    brand: 'stanley',
    description: 'Classic chrome-case tape measure with a mylar-coated blade and positive blade lock. Metric and imperial markings.',
    specs: [['Blade width', '25 mm'], ['Markings', 'mm / inch'], ['Case', 'ABS / chrome']],
    variants: [
      { sku: 'ST-PL-5M', options: { size: '5 m' }, attrs: { length: '5' }, weightGrams: 300, retail: 3900, tiers: [[12, 3400]], trade: 3200, stock: s(200, 80, 60) },
      { sku: 'ST-PL-8M', options: { size: '8 m' }, attrs: { length: '8' }, weightGrams: 450, retail: 5900, tiers: [[12, 5200]], trade: 4900, stock: s(140, 50, 40) },
    ],
  },
  {
    group: 'STAINLESS-SCREWS',
    name: 'Stainless Steel Wood Screws (box of 200)',
    category: 'fasteners',
    brand: 'milano',
    description: 'A2 stainless steel countersunk Pozi screws for wood and wall plugs. Corrosion resistant for coastal and wet areas.',
    specs: [['Material', 'A2 stainless steel'], ['Head', 'Countersunk, Pozidriv'], ['Pack', '200 pcs']],
    variants: [
      { sku: 'FX-SS-4x30', options: { size: '4 × 30 mm' }, attrs: { size: '4 × 30 mm' }, baseUom: 'box', weightGrams: 520, retail: 2400, tiers: [[10, 2100]], trade: 1950, stock: s(150, 60, 50) },
      { sku: 'FX-SS-5x50', options: { size: '5 × 50 mm' }, attrs: { size: '5 × 50 mm' }, baseUom: 'box', weightGrams: 1300, retail: 3800, tiers: [[10, 3350]], trade: 3100, stock: s(100, 40, 30) },
    ],
  },
  {
    group: 'YALE-DIGITAL-LOCK',
    name: 'Yale YDM 4109 Digital Door Lock',
    category: 'locks-door-hardware',
    brand: 'yale',
    description: 'Smart mortise door lock with fingerprint, PIN, RFID card and mechanical key. Auto-lock and intrusion alarm.',
    specs: [['Access', 'Fingerprint, PIN, card, key'], ['Power', '4 × AA'], ['Door thickness', '40-80 mm']],
    variants: [{ sku: 'YL-YDM4109', attrs: { colour: 'Black' }, weightGrams: 4200, retail: 199900, trade: 185000, stock: s(6, 2, 1) }],
  },
  {
    group: '3M-SAFETY-GLASSES',
    name: '3M SecureFit Safety Glasses',
    category: 'safety-ppe',
    brand: '3m',
    description: 'Lightweight safety glasses with pressure diffusion temple technology for all-day comfort. Anti-scratch, 99.9% UV protection.',
    specs: [['Lens', 'Polycarbonate'], ['Standard', 'EN 166'], ['UV protection', '99.9%']],
    variants: [
      { sku: '3M-SF201', options: { colour: 'Clear' }, attrs: { colour: 'Clear' }, weightGrams: 60, retail: 1800, tiers: [[12, 1500]], trade: 1400, stock: s(300, 100, 100) },
      { sku: '3M-SF202', options: { colour: 'Grey' }, attrs: { colour: 'Grey' }, weightGrams: 60, retail: 1900, tiers: [[12, 1600]], trade: 1500, stock: s(200, 80, 60) },
    ],
  },

  // ── Paints & chemicals ──
  {
    group: 'JOTUN-FENOMASTIC-MATT',
    name: 'Jotun Fenomastic My Home Rich Matt',
    category: 'interior-paint',
    brand: 'jotun',
    description: 'Premium washable interior emulsion with low odour. Rich matt finish that hides wall imperfections. Tinted to thousands of colours in store.',
    specs: [['Finish', 'Matt'], ['Coverage', '10-12 m² per litre per coat'], ['Drying', 'Touch dry in 1 hour'], ['VOC', 'Low']],
    featured: true,
    variants: [
      { sku: 'JT-FMR-WH-4L', options: { size: '4 L', colour: 'White' }, attrs: { capacity: '4 L', colour: 'White' }, baseUom: 'can', weightGrams: 5600, retail: 12500, tiers: [[6, 11500]], trade: 11000, promo: 10900, stock: s(80, 30, 25) },
      { sku: 'JT-FMR-WH-18L', options: { size: '18 L', colour: 'White' }, attrs: { capacity: '18 L', colour: 'White' }, baseUom: 'can', weightGrams: 25000, retail: 47500, tiers: [[4, 44000]], trade: 42000, stock: s(40, 15, 10) },
    ],
  },
  {
    group: 'NATIONAL-WEATHERSHIELD',
    name: 'National Paints Weather Shield Exterior Emulsion',
    category: 'exterior-paint',
    brand: 'national-paints',
    description: 'Acrylic exterior emulsion designed for the Gulf climate: UV and heat resistant, anti-fungal, and breathable. Made in the UAE.',
    specs: [['Finish', 'Smooth matt'], ['Coverage', '8-10 m² per litre per coat'], ['Recoat', '4 hours']],
    variants: [
      { sku: 'NP-WS-WH-18L', options: { size: '18 L', colour: 'White' }, attrs: { capacity: '18 L', colour: 'White' }, baseUom: 'can', weightGrams: 25500, retail: 29500, tiers: [[4, 27500]], trade: 26500, stock: s(60, 30, 20) },
    ],
  },
  {
    group: 'SIKA-SIKAFLEX-11FC',
    name: 'Sikaflex-11 FC+ Polyurethane Sealant 300 ml',
    category: 'adhesives-sealants',
    brand: 'sika',
    description: 'Multi-purpose elastic joint sealant and adhesive. Bonds to concrete, masonry, metal, wood and most plastics. Paintable.',
    specs: [['Volume', '300 ml cartridge'], ['Base', '1-part polyurethane'], ['Movement capability', '±35%']],
    variants: [
      { sku: 'SK-11FC-GY', options: { colour: 'Grey' }, attrs: { colour: 'Grey' }, weightGrams: 450, retail: 2800, tiers: [[12, 2450]], trade: 2300, stock: s(240, 90, 80) },
      { sku: 'SK-11FC-WH', options: { colour: 'White' }, attrs: { colour: 'White' }, weightGrams: 450, retail: 2800, tiers: [[12, 2450]], trade: 2300, stock: s(260, 100, 80) },
    ],
  },
  {
    group: 'FOSROC-NITOPROOF',
    name: 'Fosroc Nitoproof 600 PF Waterproofing Membrane',
    category: 'waterproofing',
    brand: 'fosroc',
    description: 'Liquid-applied polyurethane waterproofing for roofs, wet areas and balconies. Forms a seamless elastic membrane.',
    specs: [['Coverage', '1.5 kg/m² (2 coats)'], ['Pack', '20 kg'], ['Colour', 'Grey']],
    pickupOnly: true,
    variants: [{ sku: 'FS-NP600-20', baseUom: 'pail', weightGrams: 21000, retail: 68000, trade: 62000, stock: s(25, 10, 8) }],
  },

  // ── Building materials ──
  {
    group: 'EMIRATES-OPC-50',
    name: 'Emirates Cement OPC 42.5N (50 kg bag)',
    category: 'cement-blocks',
    brand: 'emirates-cement',
    description: 'Ordinary Portland Cement to BS EN 197-1, strength class 42.5N. For concrete, block work and plastering. Store pickup only; bulk site delivery on request.',
    specs: [['Type', 'CEM I 42.5N'], ['Bag', '50 kg'], ['Standard', 'BS EN 197-1']],
    pickupOnly: true,
    variants: [{ sku: 'EC-OPC-50', baseUom: 'bag', weightGrams: 50000, retail: 1750, tiers: [[50, 1600], [200, 1500]], trade: 1450, stock: s(1500, 800, 600) }],
  },
  {
    group: 'RAK-PORCELAIN-60',
    name: 'RAK Ceramics Porcelain Floor Tile 60 × 60 cm',
    category: 'tiles',
    brand: 'rak-ceramics',
    description: 'Glazed porcelain floor and wall tile. Priced per square metre; sold in full boxes of 4 tiles (1.44 m²). Order 10% extra for cuts and breakage.',
    specs: [['Size', '600 × 600 mm'], ['Thickness', '9 mm'], ['Box', '4 tiles = 1.44 m²'], ['Water absorption', '< 0.5%']],
    variants: [
      { sku: 'RAK-P60-BEIGE', options: { colour: 'Beige matt' }, attrs: { colour: 'Beige', finish: 'Matt', size: '60 × 60 cm' }, baseUom: 'sqm', weightGrams: 20500, uomConversions: [{ uom: 'box', factor: 1.44 }], retail: 3900, tiers: [[50, 3600], [150, 3400]], trade: 3300, stock: s(900, 400, 300) },
      { sku: 'RAK-P60-GREY', options: { colour: 'Grey polished' }, attrs: { colour: 'Grey', finish: 'Polished', size: '60 × 60 cm' }, baseUom: 'sqm', weightGrams: 20500, uomConversions: [{ uom: 'box', factor: 1.44 }], retail: 4500, tiers: [[50, 4200], [150, 3950]], trade: 3850, stock: s(600, 250, 200) },
    ],
  },
  {
    group: 'KNAUF-GYPSUM-12',
    name: 'Knauf Standard Gypsum Board 12.5 mm',
    category: 'gypsum-boards',
    brand: 'knauf',
    description: 'Standard plasterboard for partitions and false ceilings. Tapered edges for seamless jointing. Store pickup only.',
    specs: [['Size', '1200 × 2400 mm'], ['Thickness', '12.5 mm'], ['Edge', 'Tapered']],
    pickupOnly: true,
    variants: [
      { sku: 'KN-GB-STD-12', options: { size: 'Standard' }, attrs: { size: '12.5 mm' }, baseUom: 'sheet', weightGrams: 23000, retail: 2400, tiers: [[50, 2200]], trade: 2100, stock: s(700, 300, 250) },
      { sku: 'KN-GB-MR-12', options: { size: 'Moisture resistant' }, attrs: { size: '12.5 mm' }, baseUom: 'sheet', weightGrams: 24000, retail: 3300, tiers: [[50, 3050]], trade: 2900, stock: s(400, 150, 120) },
    ],
  },
  {
    group: 'EMSTEEL-REBAR-B500',
    name: 'Emirates Steel Rebar B500B (12 m)',
    category: 'steel',
    brand: 'emirates-steel',
    description: 'High-yield deformed reinforcement bar to BS 4449 grade B500B, 12 m lengths. Store pickup only.',
    specs: [['Grade', 'B500B'], ['Length', '12 m'], ['Standard', 'BS 4449']],
    pickupOnly: true,
    variants: [
      { sku: 'ES-RB-10', options: { size: '10 mm' }, attrs: { size: '10 mm' }, weightGrams: 7400, retail: 2350, tiers: [[100, 2150]], trade: 2050, stock: s(2000, 900, 800) },
      { sku: 'ES-RB-12', options: { size: '12 mm' }, attrs: { size: '12 mm' }, weightGrams: 10650, retail: 3350, tiers: [[100, 3100]], trade: 2950, stock: s(1800, 800, 700) },
      { sku: 'ES-RB-16', options: { size: '16 mm' }, attrs: { size: '16 mm' }, weightGrams: 18950, retail: 5950, tiers: [[100, 5500]], trade: 5250, stock: s(900, 400, 300) },
    ],
  },
];

/** [fromGroup, toGroup, kind] */
export const LINKS: [string, string, 'BOUGHT_TOGETHER' | 'RELATED' | 'ALTERNATIVE'][] = [
  ['PPR-PIPE-PN20', 'PPR-ELBOW-90', 'BOUGHT_TOGETHER'],
  ['PPR-PIPE-PN20', 'BALL-VALVE-BRASS', 'BOUGHT_TOGETHER'],
  ['PPR-ELBOW-90', 'PPR-PIPE-PN20', 'BOUGHT_TOGETHER'],
  ['GROHE-EUROSMART-BASIN', 'DURAVIT-DSTYLE-BASIN', 'BOUGHT_TOGETHER'],
  ['GROHE-EUROSMART-BASIN', 'MILANO-PILLAR-TAP', 'ALTERNATIVE'],
  ['MILANO-PILLAR-TAP', 'GROHE-EUROSMART-BASIN', 'ALTERNATIVE'],
  ['RAK-RESORT-WC', 'MILANO-BATH-SET', 'BOUGHT_TOGETHER'],
  ['DUCAB-PVC-SINGLE', 'ABB-MCB-SH200', 'BOUGHT_TOGETHER'],
  ['DUCAB-PVC-SINGLE', 'SCHNEIDER-UNICA-SOCKET', 'RELATED'],
  ['SCHNEIDER-UNICA-SOCKET', 'LEGRAND-BELANKO-SWITCH', 'RELATED'],
  ['LEGRAND-BELANKO-SWITCH', 'SCHNEIDER-UNICA-SOCKET', 'RELATED'],
  ['BOSCH-GSB-13RE', 'MAKITA-DHP482', 'ALTERNATIVE'],
  ['MAKITA-DHP482', 'BOSCH-GSB-13RE', 'ALTERNATIVE'],
  ['BOSCH-GSB-13RE', '3M-SAFETY-GLASSES', 'BOUGHT_TOGETHER'],
  ['JOTUN-FENOMASTIC-MATT', 'SIKA-SIKAFLEX-11FC', 'RELATED'],
  ['RAK-PORCELAIN-60', 'SIKA-SIKAFLEX-11FC', 'BOUGHT_TOGETHER'],
  ['PHILIPS-LED-BULB', 'PHILIPS-DOWNLIGHT', 'RELATED'],
  ['EMIRATES-OPC-50', 'EMSTEEL-REBAR-B500', 'BOUGHT_TOGETHER'],
];
