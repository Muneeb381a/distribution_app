/**
 * Starter catalog: the drinks and rice a Pakistani distributor usually stocks, so the owner picks
 * what they carry instead of typing 45 products. Everything here is a default; pack sizes and
 * names stay editable per product afterwards.
 *
 * Pack sizes (bottles per peti/carton), from Pakistani retail listings (Nov 2026):
 *  - 1 L, 1.5 L, 1.75 L, 2 L, 2.25 L PET: 6 per carton (some 2.25 L Pepsi packs are 4 — edit if so)
 *  - 345 ml and 500 ml PET, 250 ml cans: 12 per carton
 *  - 250 ml glass (returnable): 24 per crate
 *  - Juice 200/250 ml tetra: 24; juice 1 L: 12 (Slice 1 L: 6); water 500 ml: 12, 1.5 L: 6
 */

export interface DrinkSize {
  /** Shown on the product and bill, e.g. "1.5 L". */
  size: string;
  ml: number;
  /** Bottles (or packs) per peti/carton/crate. */
  pack: number;
  /** Glass bottles that come back to the distributor. */
  returnable?: boolean;
  /** "can", "glass", "PET", "tetra" — part of the size label when it matters. */
  kind?: 'PET' | 'can' | 'glass' | 'tetra';
}

const S = (size: string, ml: number, pack: number, kind: DrinkSize['kind'] = 'PET', returnable = false): DrinkSize => ({ size, ml, pack, kind, returnable });

const COLA_SIZES = [
  S('250 ml glass', 250, 24, 'glass', true), S('250 ml can', 250, 12, 'can'), S('345 ml', 345, 12), S('500 ml', 500, 12),
  S('1 L', 1000, 6), S('1.5 L', 1500, 6), S('1.75 L', 1750, 6), S('2.25 L', 2250, 6),
];
const LOCAL_SIZES = [S('250 ml glass', 250, 24, 'glass', true), S('345 ml', 345, 12), S('500 ml', 500, 12), S('1.5 L', 1500, 6), S('2.25 L', 2250, 6)];
const JUICE_SMALL = S('200 ml', 200, 24, 'tetra');
const JUICE_LITRE = S('1 L', 1000, 12, 'tetra');

export interface DrinkBrand {
  group: 'Soft drinks' | 'Juices' | 'Water' | 'Energy drinks';
  /** Category the products go under (one per brand, like the seed's "Coca-Cola"). */
  category: string[];
  company: string;
  /** Product names; flavours become separate products ("Fruita Vitals Mango"). */
  products: string[];
  sizes: DrinkSize[];
}

export const DRINK_CATALOG: DrinkBrand[] = [
  { group: 'Soft drinks', category: ['Coca-Cola'], company: 'Coca-Cola', products: ['Coca-Cola'], sizes: COLA_SIZES },
  { group: 'Soft drinks', category: ['Sprite'], company: 'Coca-Cola', products: ['Sprite'], sizes: COLA_SIZES },
  { group: 'Soft drinks', category: ['Fanta'], company: 'Coca-Cola', products: ['Fanta Orange'], sizes: COLA_SIZES.filter((s) => s.ml !== 1750) },
  { group: 'Soft drinks', category: ['Pepsi'], company: 'PepsiCo', products: ['Pepsi'], sizes: COLA_SIZES },
  { group: 'Soft drinks', category: ['7Up'], company: 'PepsiCo', products: ['7Up'], sizes: COLA_SIZES.filter((s) => s.ml !== 1750) },
  { group: 'Soft drinks', category: ['Mirinda'], company: 'PepsiCo', products: ['Mirinda Orange'], sizes: COLA_SIZES.filter((s) => s.ml !== 1750) },
  { group: 'Soft drinks', category: ['Mountain Dew'], company: 'PepsiCo', products: ['Mountain Dew'], sizes: COLA_SIZES.filter((s) => s.ml !== 1750) },
  { group: 'Soft drinks', category: ['Pakola'], company: 'Mehran Bottlers', products: ['Pakola Ice Cream Soda'], sizes: LOCAL_SIZES },
  { group: 'Soft drinks', category: ['Gourmet'], company: 'Gourmet', products: ['Gourmet Cola'], sizes: LOCAL_SIZES.filter((s) => !s.returnable) },
  { group: 'Energy drinks', category: ['Energy drinks', 'Sting'], company: 'PepsiCo', products: ['Sting'], sizes: [S('250 ml can', 250, 12, 'can'), S('345 ml', 345, 12), S('500 ml', 500, 12)] },
  { group: 'Juices', category: ['Juices', 'Nestlé Fruita Vitals'], company: 'Nestlé', products: ['Fruita Vitals Chaunsa', 'Fruita Vitals Orange', 'Fruita Vitals Apple', 'Fruita Vitals Peach'], sizes: [JUICE_SMALL, JUICE_LITRE] },
  { group: 'Juices', category: ['Juices', 'Nesfruta'], company: 'Nestlé', products: ['Nesfruta Mango', 'Nesfruta Apple'], sizes: [JUICE_SMALL, JUICE_LITRE] },
  { group: 'Juices', category: ['Juices', 'Shezan'], company: 'Shezan', products: ['Shezan Mango', 'Shezan Apple', 'Shezan Orange'], sizes: [S('250 ml', 250, 24, 'tetra'), JUICE_LITRE] },
  { group: 'Juices', category: ['Juices', 'Slice'], company: 'PepsiCo', products: ['Slice Mango'], sizes: [JUICE_SMALL, S('355 ml', 355, 12), S('1 L', 1000, 6, 'tetra')] },
  { group: 'Juices', category: ['Juices', 'Fresher'], company: 'Fresher', products: ['Fresher Mango', 'Fresher Guava'], sizes: [JUICE_SMALL, JUICE_LITRE] },
  { group: 'Water', category: ['Water', 'Aquafina'], company: 'PepsiCo', products: ['Aquafina'], sizes: [S('500 ml', 500, 12), S('1.5 L', 1500, 6)] },
  { group: 'Water', category: ['Water', 'Nestlé Pure Life'], company: 'Nestlé', products: ['Nestlé Pure Life'], sizes: [S('500 ml', 500, 12), S('1.5 L', 1500, 6)] },
  { group: 'Water', category: ['Water', 'Kinley'], company: 'Coca-Cola', products: ['Kinley'], sizes: [S('500 ml', 500, 12), S('1.5 L', 1500, 6)] },
];

/** Sizes offered when adding a drink by hand, with their usual pack. */
export const DRINK_SIZE_PRESETS: DrinkSize[] = [
  S('200 ml', 200, 24, 'tetra'), S('250 ml glass', 250, 24, 'glass', true), S('250 ml can', 250, 12, 'can'), S('345 ml', 345, 12),
  S('500 ml', 500, 12), S('1 L', 1000, 6), S('1.5 L', 1500, 6), S('1.75 L', 1750, 6), S('2.25 L', 2250, 6),
];

/** Usual bottles per peti for a size typed by hand ("1.5 L", "500ml"); null if it can't tell. */
export function defaultPack(size: string): { pack: number; returnable: boolean } | null {
  const preset = DRINK_SIZE_PRESETS.find((p) => p.size.toLowerCase() === size.trim().toLowerCase());
  if (preset) return { pack: preset.pack, returnable: !!preset.returnable };
  const m = size.toLowerCase().replace(/\s+/g, '').match(/^(\d+(?:\.\d+)?)(ml|l|ltr|litre|liter)/);
  if (!m) return null;
  const ml = m[2] === 'ml' ? Number(m[1]) : Number(m[1]) * 1000;
  const glass = /glass/i.test(size);
  return { pack: glass ? 24 : ml >= 1000 ? 6 : ml <= 250 && /tetra|juice/i.test(size) ? 24 : 12, returnable: glass };
}

/* ------------------------------------------------------------------ rice */

/** Starting rice tree (plan §7.1): Type › Variety › Form. The seed creates these categories. */
export const RICE_TREE: Record<string, Record<string, string[]>> = {
  Basmati: Object.fromEntries(['Super Kernel', '1121', 'D-98', 'Super Basmati', '385', '515', 'Kissan'].map((v) => [v, ['White', 'Sella', 'Steam']])),
  'Non-basmati': Object.fromEntries(['PK-386', 'IRRI-6', 'IRRI-9', 'KS-282'].map((v) => [v, ['White', 'Sella', 'Steam', 'Parboiled']])),
  Broken: { Tota: ['5%', '25%', '100%'] },
};

/**
 * RICE_TREE as ordered lists. Object keys like "1121" and "385" are integer-like, so JavaScript
 * lists them before "Super Kernel"; screens use this to show varieties in the intended order.
 */
export const RICE_VARIETIES: { type: string; varieties: { variety: string; forms: string[] }[] }[] = [
  { type: 'Basmati', varieties: ['Super Kernel', '1121', 'D-98', 'Super Basmati', '385', '515', 'Kissan'].map((variety) => ({ variety, forms: RICE_TREE.Basmati[variety] })) },
  { type: 'Non-basmati', varieties: ['PK-386', 'IRRI-6', 'IRRI-9', 'KS-282'].map((variety) => ({ variety, forms: RICE_TREE['Non-basmati'][variety] })) },
  { type: 'Broken', varieties: [{ variety: 'Tota', forms: RICE_TREE.Broken.Tota }] },
];

/** How rice is sold: loose by kg/maund (optionally by the bori), or in packed bags. */
export const RICE_PACKINGS = [
  { key: 'loose', label: 'Loose (kg / maund)', bagKg: null, packed: false, hint: 'Sold by weight; a 50 kg bori unit is added' },
  { key: 'bag5', label: '5 kg bag', bagKg: 5, packed: true },
  { key: 'bag10', label: '10 kg bag', bagKg: 10, packed: true },
  { key: 'bag25', label: '25 kg bag', bagKg: 25, packed: true },
  { key: 'bag50', label: '50 kg bag', bagKg: 50, packed: true },
] as const;
export type RicePacking = (typeof RICE_PACKINGS)[number]['key'];

/** A product to create, the same shape the Excel import uses. */
export interface ProductSpec {
  line: 'BOTTLES' | 'RICE';
  /** Category path from the top, e.g. ["Juices", "Shezan"] or ["Basmati", "Super Kernel", "Sella"]. */
  path: string[];
  name: string;
  brand: string | null;
  size: string | null;
  /** Bottles per peti (bottles only). */
  packSize: number;
  /** Bag weight in kg (rice only); null for loose. */
  bagKg: number | null;
  returnableEmpty: boolean;
  /** Packed rice (sold by the bag only). */
  isPacked?: boolean;
}

/** Same product? Name and size, ignoring case and spacing. */
export const productKey = (name: string, size: string | null | undefined) => `${name.trim().toLowerCase().replace(/\s+/g, ' ')}|${(size ?? '').trim().toLowerCase().replace(/\s+/g, ' ')}`;

export function drinkSpecs(brand: DrinkBrand, productName: string, sizes: DrinkSize[]): ProductSpec[] {
  return sizes.map((s) => ({
    line: 'BOTTLES', path: brand.category, name: productName, brand: brand.company, size: s.size,
    packSize: s.pack, bagKg: null, returnableEmpty: !!s.returnable,
  }));
}

export function riceSpecs(type: string, variety: string, form: string, packings: RicePacking[]): ProductSpec[] {
  const name = `${variety} ${form}`;
  return packings.map((k) => {
    const p = RICE_PACKINGS.find((x) => x.key === k)!;
    return {
      line: 'RICE', path: [type, variety, form], name, brand: null,
      size: p.packed ? `${p.bagKg} kg bag` : null,
      packSize: 1, bagKg: p.packed ? p.bagKg : 50, returnableEmpty: false, isPacked: p.packed,
    };
  });
}
