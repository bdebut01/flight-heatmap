import { Heat, rampColor, type Field, type Point } from './heat'
import { $, el, fmt, svgEl } from './format'

export interface Place extends Point { key: number; label: string }
export interface Anchor { x: number; y: number; label: string }
export interface TipContent { title: string; subtitle: string; city?: boolean; total: string; rows: [string, number][]; more: number }

const LABELS = 12          // label the busiest places, skipping collisions
const HIT_PX = 16          // hover radius in screen pixels

/** Basemap (SVG), heat (canvas), airport dots, labels and the hover card. */
export class MapView {
  readonly heat: Heat
  private map = $('map')
  private wrap = $('map-wrap')
  private dots = $('dots') as unknown as SVGSVGElement
  private labels = $('labels')
  private tip = $('tooltip')
  private places: Place[] = []
  private hovered: Place | null = null
  private ring: SVGCircleElement
  private origin: Anchor | null = null
  private arcs = $('arcs') as unknown as SVGSVGElement
  private canvas = $('heat') as HTMLCanvasElement

  constructor(private W: number, private H: number, basemap: string, private describe: (p: Place) => TipContent) {
    for (const id of ['basemap', 'dots', 'arcs']) $(id).setAttribute('viewBox', `0 0 ${W} ${H}`)
    $('land').setAttribute('d', basemap)
    this.heat = new Heat($('heat') as HTMLCanvasElement, W, H)
    this.ring = svgEl('circle', { class: 'ring', r: 14 }) as SVGCircleElement
    this.map.addEventListener('pointermove', e => this.pointer(e))
    this.map.addEventListener('pointerdown', e => this.pointer(e))
    this.map.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') this.hover(null) })
    new ResizeObserver(() => this.fit()).observe(this.wrap)
  }

  private get scale() { return this.map.clientWidth / this.W }

  /** Size the map to fit its container at the projection's aspect ratio. */
  fit() {
    const narrow = matchMedia('(max-width: 820px)').matches
    const ar = this.W / this.H, cw = this.wrap.clientWidth
    const w = narrow ? cw : Math.min(cw, this.wrap.clientHeight * ar)
    this.map.style.width = `${Math.floor(w)}px`; this.map.style.height = `${Math.floor(w / ar)}px`
    this.drawLabels()
  }

  render(places: Place[], field: Field, ref: Field, theme: 'light' | 'dark', alt: string) {
    this.places = places; this.origin = null
    this.canvas.hidden = false; this.arcs.replaceChildren()
    this.heat.draw(field, ref, theme)
    this.canvas.setAttribute('aria-label', alt)
    this.drawDots()
  }

  /** Route lines from one origin; `max` sets the scale (Fixed: all airlines, Fit: the selection). */
  renderRoutes(origin: Anchor, dests: Place[], max: number, theme: 'light' | 'dark', alt: string) {
    this.places = dests; this.origin = origin
    this.canvas.hidden = true
    const frag = document.createDocumentFragment()
    for (const p of [...dests].filter(p => p.w >= 0.5).sort((a, b) => a.w - b.w)) {
      const k = Math.sqrt(Math.min(1, p.w / (max || 1)))
      const dx = p.x - origin.x, dy = p.y - origin.y
      const cx = (origin.x + p.x) / 2 - dy * 0.18, cy = (origin.y + p.y) / 2 + dx * 0.18
      frag.append(svgEl('path', {
        d: `M${origin.x.toFixed(1)} ${origin.y.toFixed(1)}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`,
        stroke: rampColor(0.25 + 0.75 * k, theme), 'stroke-width': (2 + k * 9).toFixed(1), 'stroke-opacity': (0.35 + 0.6 * k).toFixed(2),
      }))
    }
    this.arcs.replaceChildren(frag)
    this.arcs.setAttribute('aria-label', alt)
    this.drawDots()
  }

  private drawDots() {
    const frag = document.createDocumentFragment()
    for (const p of this.places) if (p.w >= 0.5) frag.append(svgEl('circle', { cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: this.origin ? 4.5 : 3.5 }))
    if (this.origin) frag.append(svgEl('circle', { class: 'origin', cx: this.origin.x, cy: this.origin.y, r: 11 }))
    this.dots.replaceChildren(frag)
    this.drawLabels()
    if (this.hovered) this.hover(this.places.find(p => p.key === this.hovered!.key && p.w >= 0.5) ?? null)
  }

  private drawLabels() {
    const s = this.scale; if (!s) return
    const boxes: [number, number, number, number][] = []
    const out: HTMLElement[] = []
    if (this.origin) {
      const o = this.origin, w = o.label.length * 8 + 12
      boxes.push([o.x * s - w / 2, o.y * s - 30, o.x * s + w / 2, o.y * s + 10])
      const span = el('span', { class: 'origin-label' }, o.label)
      span.style.left = `${(o.x / this.W) * 100}%`; span.style.top = `${(o.y / this.H) * 100}%`
      out.push(span)
    }
    const top = [...this.places].filter(p => p.w >= 0.5).sort((a, b) => b.w - a.w)
    for (const p of top) {
      if (out.length >= LABELS + (this.origin ? 1 : 0)) break
      const x = p.x * s + 6, y = p.y * s, w = p.label.length * 7 + 8, h = 16
      const box: [number, number, number, number] = [x - 8, y - h / 2, x + w, y + h / 2]
      if (box[2] > this.map.clientWidth) continue
      if (boxes.some(b => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue
      boxes.push(box)
      const span = el('span', {}, p.label)
      span.style.left = `${(p.x / this.W) * 100}%`; span.style.top = `${(p.y / this.H) * 100}%`
      out.push(span)
    }
    this.labels.replaceChildren(...out)
  }

  private pointer(e: PointerEvent) {
    const r = this.map.getBoundingClientRect(), s = this.scale
    const mx = (e.clientX - r.left) / s, my = (e.clientY - r.top) / s
    let best: Place | null = null, bd = (HIT_PX / s) ** 2
    for (const p of this.places) {
      if (p.w < 0.5) continue
      const d = (p.x - mx) ** 2 + (p.y - my) ** 2
      if (d < bd) { bd = d; best = p }
    }
    this.hover(best)
  }

  private hover(p: Place | null) {
    this.hovered = p
    if (!p) { this.tip.hidden = true; this.ring.remove(); return }
    this.ring.setAttribute('cx', String(p.x)); this.ring.setAttribute('cy', String(p.y))
    this.dots.append(this.ring)
    const c = this.describe(p)
    const mx = c.rows.length ? c.rows[0][1] : 1
    this.tip.replaceChildren(
      (() => { const t = el('div', { class: c.city ? 'tt-title city' : 'tt-title' }); t.append(el('b', {}, c.title), el('span', {}, c.subtitle)); return t })(),
      el('div', { class: 'tt-total' }, c.total),
      (() => {
        const box = el('div', { class: 'tt-rows' })
        for (const [name, v] of c.rows) {
          const row = el('div', { class: 'tt-row' }), bar = el('i')
          bar.style.width = `${Math.max(2, (v / mx) * 100)}%`
          row.append(el('span', {}, name), bar, el('span', {}, fmt(v)))
          box.append(row)
        }
        return box
      })(),
    )
    if (c.more > 0) this.tip.append(el('div', { class: 'tt-more' }, `+ ${c.more} more airline${c.more === 1 ? '' : 's'}`))
    this.tip.hidden = false
    const s = this.scale, px = p.x * s, py = p.y * s
    const tw = this.tip.offsetWidth, th = this.tip.offsetHeight, W = this.map.clientWidth, H = this.map.clientHeight
    const left = px + 18 + tw > W ? px - 18 - tw : px + 18
    this.tip.style.left = `${Math.max(8, left)}px`
    this.tip.style.top = `${Math.min(Math.max(8, py - 40), H - th - 8)}px`
  }
}
