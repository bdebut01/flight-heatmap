/**
 * Heat layer: departures splatted at airport positions, blurred at two radii
 * (a sharp one for hubs, a wide one for regional glow) and mapped to a one-hue ramp.
 */
export interface Point { x: number; y: number; w: number }
export interface Field { a: Float32Array; b: Float32Array; maxA: number; maxB: number }

const SCALE = 0.5            // raster is half the projected map size
// Spread: between "tight" (7, no glow) and "medium" (12 + 48 at 0.55) from the design canvas, nearer tight.
const SIGMA_A = 9 * SCALE    // sharp layer: individual airports
const SIGMA_B = 30 * SCALE   // wide layer: faint regional glow
const WEIGHT_B = 0.3

// Sequential blue, light surface: near-zero recedes toward the surface.
const RAMP_LIGHT = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b']
// Dark surface: the same hue stepped the other way, so low values recede into the dark map.
const RAMP_DARK = ['#0d366b', '#104281', '#184f95', '#1c5cab', '#256abf', '#2a78d6', '#3987e5', '#5598e7', '#6da7ec', '#86b6ef', '#9ec5f4', '#b7d3f6', '#cde2fb']

function lut(ramp: string[]) {
  const rgb = ramp.map(h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)))
  const out = new Uint8ClampedArray(256 * 4)
  for (let i = 0; i < 256; i++) {
    const v = i / 255
    const t = Math.min(1, v * 1.1) * (rgb.length - 1)
    const i0 = Math.floor(t), i1 = Math.min(i0 + 1, rgb.length - 1), fr = t - i0
    for (let c = 0; c < 3; c++) out[i * 4 + c] = rgb[i0][c] * (1 - fr) + rgb[i1][c] * fr
    out[i * 4 + 3] = Math.pow(Math.min(1, v / 0.35), 1.5) * 235
  }
  return out
}
const LUTS = { light: lut(RAMP_LIGHT), dark: lut(RAMP_DARK) }

/** Ramp colour for t in 0..1, used for route lines. */
export const rampColor = (t: number, theme: 'light' | 'dark') => {
  const r = theme === 'light' ? RAMP_LIGHT : RAMP_DARK
  return r[Math.min(r.length - 1, Math.max(0, Math.round(t * (r.length - 1))))]
}

function boxSizes(sigma: number, n = 3) {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1)
  let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--
  const wu = wl + 2
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4))
  return Array.from({ length: n }, (_, i) => (i < m ? wl : wu))
}

function boxH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const iarr = 1 / (r + r + 1)
  for (let y = 0; y < h; y++) {
    const row = y * w
    let acc = 0
    for (let x = -r - 1; x < r; x++) acc += x >= 0 && x < w ? src[row + x] : 0
    for (let x = 0; x < w; x++) {
      const add = x + r, sub = x - r - 1
      acc += (add < w ? src[row + add] : 0) - (sub >= 0 ? src[row + sub] : 0)
      dst[row + x] = acc * iarr
    }
  }
}
function boxV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const iarr = 1 / (r + r + 1)
  for (let x = 0; x < w; x++) {
    let acc = 0
    for (let y = -r - 1; y < r; y++) acc += y >= 0 && y < h ? src[y * w + x] : 0
    for (let y = 0; y < h; y++) {
      const add = y + r, sub = y - r - 1
      acc += (add < h ? src[add * w + x] : 0) - (sub >= 0 ? src[sub * w + x] : 0)
      dst[y * w + x] = acc * iarr
    }
  }
}
function blur(src: Float32Array, w: number, h: number, sigma: number) {
  let a = Float32Array.from(src), b = new Float32Array(src.length)
  for (const size of boxSizes(sigma)) {
    const r = (size - 1) / 2
    boxH(a, b, w, h, r); boxV(b, a, w, h, r)
  }
  return a
}
const maxOf = (a: Float32Array) => { let m = 0; for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i]; return m }

export class Heat {
  readonly w: number
  readonly h: number
  /** offscreen raster; the map paints the visible part of it at the current zoom */
  readonly raster = document.createElement('canvas')
  private ctx: CanvasRenderingContext2D
  private img: ImageData

  constructor(W: number, H: number) {
    this.w = Math.round(W * SCALE); this.h = Math.round(H * SCALE)
    this.raster.width = this.w; this.raster.height = this.h
    this.ctx = this.raster.getContext('2d')!
    this.img = this.ctx.createImageData(this.w, this.h)
  }

  field(points: Point[]): Field {
    const g = new Float32Array(this.w * this.h)
    for (const p of points) {   // bilinear splat keeps sub-pixel positions smooth
      const fx = p.x * SCALE, fy = p.y * SCALE
      const x = Math.floor(fx), y = Math.floor(fy), dx = fx - x, dy = fy - y
      const put = (xx: number, yy: number, v: number) => { if (xx >= 0 && yy >= 0 && xx < this.w && yy < this.h) g[yy * this.w + xx] += v }
      put(x, y, p.w * (1 - dx) * (1 - dy)); put(x + 1, y, p.w * dx * (1 - dy))
      put(x, y + 1, p.w * (1 - dx) * dy); put(x + 1, y + 1, p.w * dx * dy)
    }
    const a = blur(g, this.w, this.h, SIGMA_A), b = blur(g, this.w, this.h, SIGMA_B)
    return { a, b, maxA: maxOf(a), maxB: maxOf(b) }
  }

  /** Draw a field, scaled to its own peak so any selection uses the full colour range. */
  draw(f: Field, theme: 'light' | 'dark') {
    const L = LUTS[theme], d = this.img.data
    const ia = f.maxA ? 1 / f.maxA : 0, ib = f.maxB ? WEIGHT_B / f.maxB : 0, norm = 1 / (1 + WEIGHT_B)
    for (let i = 0; i < f.a.length; i++) {
      const v = Math.min(1, (f.a[i] * ia + f.b[i] * ib) * norm)
      const k = (Math.pow(v, 0.45) * 255) | 0
      d[i * 4] = L[k * 4]; d[i * 4 + 1] = L[k * 4 + 1]; d[i * 4 + 2] = L[k * 4 + 2]; d[i * 4 + 3] = L[k * 4 + 3]
    }
    this.ctx.putImageData(this.img, 0, 0)
  }
}
