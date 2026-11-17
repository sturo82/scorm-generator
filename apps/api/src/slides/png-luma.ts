import { inflateSync } from 'node:zlib';

/**
 * Lettore PNG minimale per l'analisi delle slide: restituisce una griglia di luminanza
 * ridotta (media per cella). Supporta i PNG prodotti da pdftoppm e dai renderer comuni:
 * 8 bit per canale, colore grigio/RGB/RGBA (con o senza alpha), non interlacciati.
 * Nessuna dipendenza nativa: usa solo zlib di Node.
 */
export interface LumaGrid {
  cols: number;
  rows: number;
  /** Luminanza 0..255 per cella, riga per riga. */
  cells: Float32Array;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function pngLumaGrid(png: Buffer, cols = 64, rows = 36): LumaGrid {
  if (png.length < 8 || !png.subarray(0, 8).equals(SIGNATURE)) throw new Error('Non è un PNG');
  let width = 0;
  let height = 0;
  let colorType = 0;
  let bitDepth = 0;
  let interlace = 0;
  const idat: Buffer[] = [];
  for (let off = 8; off + 8 <= png.length; ) {
    const len = png.readUInt32BE(off);
    const type = png.toString('latin1', off + 4, off + 8);
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8]!;
      colorType = data[9]!;
      interlace = data[12]!;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0;
  if (!width || !height || bitDepth !== 8 || channels === 0 || interlace !== 0) {
    throw new Error(`PNG non supportato (tipo ${colorType}, ${bitDepth} bit, interlace ${interlace})`);
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const cur = new Uint8Array(stride);
  const prev = new Uint8Array(stride);
  const sums = new Float64Array(cols * rows);
  const counts = new Uint32Array(cols * rows);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++]!;
    for (let x = 0; x < stride; x++) {
      const v = raw[p++]!;
      const a = x >= channels ? cur[x - channels]! : 0;
      const b = prev[x]!;
      const c = x >= channels ? prev[x - channels]! : 0;
      let out: number;
      switch (filter) {
        case 1: out = v + a; break;
        case 2: out = v + b; break;
        case 3: out = v + ((a + b) >> 1); break;
        case 4: {
          const pa = Math.abs(b - c);
          const pb = Math.abs(a - c);
          const pc = Math.abs(a + b - 2 * c);
          out = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: out = v;
      }
      cur[x] = out & 0xff;
    }
    const ry = Math.min(rows - 1, Math.floor((y * rows) / height));
    for (let x = 0; x < width; x++) {
      const i = x * channels;
      const l = channels >= 3 ? 0.2126 * cur[i]! + 0.7152 * cur[i + 1]! + 0.0722 * cur[i + 2]! : cur[i]!;
      const cell = ry * cols + Math.min(cols - 1, Math.floor((x * cols) / width));
      sums[cell] += l;
      counts[cell] += 1;
    }
    prev.set(cur);
  }
  const cells = new Float32Array(cols * rows);
  for (let i = 0; i < cells.length; i++) cells[i] = counts[i] ? sums[i]! / counts[i]! : 0;
  return { cols, rows, cells };
}
