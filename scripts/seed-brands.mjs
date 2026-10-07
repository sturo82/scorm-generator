// Crea brand demo WCAG AA con logo SVG (wordmark) come data-URI.
// Uso: node scripts/seed-brands.mjs  (richiede API su :3000 e dev-token).
// Idempotente: salta i brand già esistenti con lo stesso nome.

const API = process.env.API_URL || 'http://localhost:3000';
const TOKEN = process.env.DEV_TOKEN || 'dev-token';

/** Contrasto WCAG tra due hex. */
function luminance(hex) {
  const c = hex.replace('#', '');
  const ch = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
  const f = (x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
  const [r, g, b] = ch.map(f);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const l1 = luminance(a), l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Logo wordmark SVG come data-URI: banda arrotondata col primario + nome. */
function logoDataUri(name, primary, onPrimary) {
  const w = 320, h = 96;
  const label = name.toUpperCase();
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}">` +
    `<rect width="${w}" height="${h}" rx="18" fill="${primary}"/>` +
    `<circle cx="48" cy="48" r="20" fill="${onPrimary}" opacity="0.18"/>` +
    `<circle cx="48" cy="48" r="10" fill="${onPrimary}"/>` +
    `<text x="86" y="58" font-family="Inter, Arial, sans-serif" font-size="30" font-weight="800" fill="${onPrimary}" letter-spacing="1">${label}</text>` +
    `</svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

const BRANDS = [
  {
    name: 'Meridiana Blu',
    colors: { primary: '#1B4DB3', onPrimary: '#FFFFFF', surface: '#FFFFFF', onSurface: '#13203A', success: '#1A7F4B', warning: '#9A5B00', error: '#B42318' },
  },
  {
    name: 'Verde Acero',
    colors: { primary: '#0F7A4E', onPrimary: '#FFFFFF', surface: '#FFFFFF', onSurface: '#10261C', success: '#116B45', warning: '#8A5300', error: '#B42318' },
  },
  {
    name: 'Prugna Scura',
    colors: { primary: '#6A1B6A', onPrimary: '#FFFFFF', surface: '#FDF9FD', onSurface: '#2A122A', success: '#166534', warning: '#92400E', error: '#B91C1C' },
  },
];

async function listBrands() {
  const res = await fetch(`${API}/brands`, { headers: { authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) throw new Error(`GET /brands ${res.status}`);
  return res.json();
}

async function createBrand(def) {
  const res = await fetch(`${API}/brands`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(def),
  });
  if (!res.ok) throw new Error(`POST /brands ${res.status}: ${await res.text()}`);
  return res.json();
}

async function main() {
  const existing = new Set((await listBrands()).map((b) => b.name));
  for (const b of BRANDS) {
    const cp = contrast(b.colors.primary, b.colors.onPrimary);
    const cs = contrast(b.colors.surface, b.colors.onSurface);
    const aa = cp >= 4.5 && cs >= 4.5;
    console.log(`${b.name}: primary/onPrimary=${cp.toFixed(2)} surface/onSurface=${cs.toFixed(2)} ${aa ? 'AA OK' : 'FAIL'}`);
    if (!aa) { console.error('  palette non AA, salto'); continue; }
    if (existing.has(b.name)) { console.log('  esiste già, salto'); continue; }
    const def = {
      name: b.name,
      assets: { logoPrimaryUrl: logoDataUri(b.name, b.colors.primary, b.colors.onPrimary) },
      colors: b.colors,
      typography: { fontFamilyHeading: 'Inter', fontFamilyBody: 'Inter' },
    };
    const created = await createBrand(def);
    console.log(`  creato brand id=${created.id}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
