import { Heat, rampColor, type Field, type Point } from './heat'
import { $, el, fmt, svgEl } from './format'

export interface Place extends Point { key: number; label: string }
export interface Anchor { x: number; y: number; label: string }
export interface TipContent {
  title: string; subtitle: string; city?: boolean; total: string; rows: [string, number][]; more: number
  /** "Show flights from X": a button on the pinned card, a hint while hovering */
  jump?: { label: string; run: () => void }
}

const LABELS = 12          // label the busiest visible places, skipping collisions
const HIT_PX = 16          // hover / click radius in screen pixels
const ZOOM_STEP = 1.6
const ZOOM_MAX = 8
const DRAG_PX = 4          // movement that turns a click into a pan
const PLANE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 22h20"></path><path d="M6.36 17.4 4 17l-2-4 1.1-.55a2 2 0 0 1 1.8 0l.17.1a2 2 0 0 0 1.8 0L8 12 5 6l.9-.45a2 2 0 0 1 2.09.2l4.02 3a2 2 0 0 0 2.1.2l4.19-2.06a2.41 2.41 0 0 1 1.73-.17L21 7a1.4 1.4 0 0 1 .87 1.99l-.38.76c-.23.46-.6.84-1.07 1.08L7.58 17.2a2 2 0 0 1-1.22.18Z"></path></svg>'
const ARROW = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"></path></svg>'

/**
 * Basemap (SVG), heat (canvas), route lines, dots, labels and the detail card.
 * Zoom and pan change the SVG viewBox and repaint the heat raster; strokes, dots and labels
 * keep their screen size. Hover shows the card; a click pins it until the next click.
 */
export class MapView {
  readonly heat: Heat
  private map = $('map')
  private wrap = $('map-wrap')
  private svgs = ['basemap', 'arcs', 'dots'].map(id => $(id))
  private dots = $('dots') as unknown as SVGSVGElement
  private arcs = $('arcs') as unknown as SVGSVGElement
  private canvas = $('heat') as HTMLCanvasElement
  private labels = $('labels')
  private tip = $('tooltip')
  private zoomIn = $('zoom-in') as HTMLButtonElement
  private zoomOut = $('zoom-out') as HTMLButtonElement
  private places: Place[] = []
  private origin: Anchor | null = null
  private shown: Place | null = null     // place whose card is up
  private pinned = false
  private k = 1                          // zoom
  private vx = 0                         // top-left of the view, in map units
  private vy = 0
  private press: { x: number; y: number; vx: number; vy: number; lastY: number; dragged: boolean } | null = null
  private touches = new Map<number, { x: number; y: number }>()   // fingers on the map
  private pinch: { d: number; mx: number; my: number } | null = null   // spread and midpoint (map px) last frame

  constructor(private W: number, private H: number, basemap: string, private describe: (p: Place) => TipContent) {
    $('land').setAttribute('d', basemap)
    this.heat = new Heat(W, H)
    this.map.addEventListener('pointerdown', e => this.down(e))
    this.map.addEventListener('pointermove', e => this.move(e))
    this.map.addEventListener('pointerup', e => this.up(e))
    this.map.addEventListener('pointercancel', e => this.lift(e))
    // Safari's own pinch events: the map handles pinching itself
    this.map.addEventListener('gesturestart', e => e.preventDefault())
    this.map.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !this.pinned && !this.press) this.show(null) })
    // Scroll wheel zooms around the cursor. Trackpad pinch arrives as ctrl + wheel with small deltas.
    // In the narrow layout the page scrolls, so there only a pinch zooms.
    this.map.addEventListener('wheel', e => {
      if (!e.ctrlKey && matchMedia('(max-width: 820px)').matches) return
      e.preventDefault()
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1)
      const r = this.map.getBoundingClientRect()
      this.zoomAt(Math.exp(-dy / (e.ctrlKey ? 100 : 300)), e.clientX - r.left, e.clientY - r.top)
    }, { passive: false })
    document.addEventListener('pointerdown', e => { if (this.pinned && !this.map.contains(e.target as Node)) this.unpin() })
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && this.pinned) this.unpin() })
    this.zoomIn.addEventListener('click', () => this.zoomAt(ZOOM_STEP))
    this.zoomOut.addEventListener('click', () => this.zoomAt(1 / ZOOM_STEP))
    new ResizeObserver(() => this.fit()).observe(this.wrap)
  }

  /** screen pixels per map unit at the current zoom */
  private get s() { return (this.map.clientWidth / this.W) * this.k }
  private sx(x: number) { return (x - this.vx) * this.s }
  private sy(y: number) { return (y - this.vy) * this.s }

  /** Size the map to fit its container at the projection's aspect ratio. */
  fit() {
    const narrow = matchMedia('(max-width: 820px)').matches
    const ar = this.W / this.H, cw = this.wrap.clientWidth
    const w = narrow ? cw : Math.min(cw, this.wrap.clientHeight * ar)
    this.map.style.width = `${Math.floor(w)}px`; this.map.style.height = `${Math.floor(w / ar)}px`
    const dpr = window.devicePixelRatio || 1
    this.canvas.width = Math.round(Math.floor(w) * dpr); this.canvas.height = Math.round(Math.floor(w / ar) * dpr)
    this.view()
  }

  render(places: Place[], field: Field, theme: 'light' | 'dark', alt: string) {
    this.places = places; this.origin = null
    this.canvas.hidden = false; this.arcs.replaceChildren()
    this.heat.draw(field, theme)
    this.canvas.setAttribute('aria-label', alt)
    this.paintHeat(); this.drawDots(); this.refreshCard()
  }

  /** Route lines from one origin; line weight is relative to `max`, the busiest route shown. */
  renderRoutes(origin: Anchor, dests: Place[], max: number, theme: 'light' | 'dark', alt: string) {
    this.places = dests; this.origin = origin
    this.canvas.hidden = true
    const frag = document.createDocumentFragment()
    for (const p of [...dests].filter(p => p.w >= 0.5).sort((a, b) => a.w - b.w)) {
      const t = Math.sqrt(Math.min(1, p.w / (max || 1)))
      const dx = p.x - origin.x, dy = p.y - origin.y
      const cx = (origin.x + p.x) / 2 - dy * 0.18, cy = (origin.y + p.y) / 2 + dx * 0.18
      frag.append(svgEl('path', {
        d: `M${origin.x.toFixed(1)} ${origin.y.toFixed(1)}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`,
        stroke: rampColor(0.25 + 0.75 * t, theme), 'stroke-width': (1 + t * 4).toFixed(2), 'stroke-opacity': (0.35 + 0.6 * t).toFixed(2),
      }))
    }
    this.arcs.replaceChildren(frag)
    this.arcs.setAttribute('aria-label', alt)
    this.drawDots(); this.refreshCard()
  }

  // ---------------------------------------------------------------- view

  private zoomAt(factor: number, px = this.map.clientWidth / 2, py = this.map.clientHeight / 2) {
    const mx = this.vx + px / this.s, my = this.vy + py / this.s
    this.k = Math.min(ZOOM_MAX, Math.max(1, this.k * factor))
    this.vx = mx - px / this.s; this.vy = my - py / this.s
    this.view()
  }

  /** Clamp the view, then redraw everything that depends on it. */
  private view() {
    this.vx = Math.min(Math.max(0, this.vx), this.W - this.W / this.k)
    this.vy = Math.min(Math.max(0, this.vy), this.H - this.H / this.k)
    const vb = `${this.vx.toFixed(2)} ${this.vy.toFixed(2)} ${(this.W / this.k).toFixed(2)} ${(this.H / this.k).toFixed(2)}`
    for (const s of this.svgs) s.setAttribute('viewBox', vb)
    this.zoomIn.disabled = this.k >= ZOOM_MAX - 1e-6
    this.zoomOut.disabled = this.k <= 1 + 1e-6
    this.map.classList.toggle('zoomed', this.k > 1)
    this.paintHeat(); this.drawDots(); this.placeCard()
  }

  private paintHeat() {
    if (this.canvas.hidden || !this.canvas.width) return
    const ctx = this.canvas.getContext('2d')!, r = this.heat.raster, f = r.width / this.W
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(r, this.vx * f, this.vy * f, (this.W / this.k) * f, (this.H / this.k) * f, 0, 0, this.canvas.width, this.canvas.height)
  }

  private drawDots() {
    const frag = document.createDocumentFragment(), r = (this.origin ? 4.5 : 3.5) / Math.pow(this.k, 0.8)
    for (const p of this.places) if (p.w >= 0.5) frag.append(svgEl('circle', { cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: r.toFixed(2) }))
    if (this.origin) frag.append(svgEl('circle', { class: 'origin', cx: this.origin.x, cy: this.origin.y, r: (11 / this.k).toFixed(2) }))
    if (this.shown) frag.append(svgEl('circle', { class: 'ring', cx: this.shown.x, cy: this.shown.y, r: (14 / this.k).toFixed(2) }))
    this.dots.replaceChildren(frag)
    this.drawLabels()
  }

  private drawLabels() {
    const s = this.s; if (!s) return
    const Wpx = this.map.clientWidth, Hpx = this.map.clientHeight
    const boxes: [number, number, number, number][] = []
    const out: HTMLElement[] = []
    const put = (x: number, y: number, text: string, cls?: string) => {
      const span = el('span', cls ? { class: cls } : {}, text)
      span.style.left = `${x.toFixed(1)}px`; span.style.top = `${y.toFixed(1)}px`
      out.push(span)
    }
    if (this.origin) {
      const x = this.sx(this.origin.x), y = this.sy(this.origin.y), w = this.origin.label.length * 8 + 12
      boxes.push([x - w / 2, y - 30, x + w / 2, y + 10]); put(x, y, this.origin.label, 'origin-label')
    }
    const limit = Math.round(LABELS * Math.min(2, Math.sqrt(this.k)))
    let n = 0
    for (const p of [...this.places].filter(p => p.w >= 0.5).sort((a, b) => b.w - a.w)) {
      if (n >= limit) break
      const x = this.sx(p.x), y = this.sy(p.y)
      if (x < 0 || y < 8 || y > Hpx - 8) continue
      const w = p.label.length * 7 + 8, box: [number, number, number, number] = [x - 2, y - 8, x + 6 + w, y + 8]
      if (box[2] > Wpx) continue
      if (boxes.some(b => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue
      boxes.push(box); put(x, y, p.label); n++
    }
    this.labels.replaceChildren(...out)
  }

  // ---------------------------------------------------------------- pointer

  private hit(e: PointerEvent): Place | null {
    const r = this.map.getBoundingClientRect(), s = this.s
    const mx = this.vx + (e.clientX - r.left) / s, my = this.vy + (e.clientY - r.top) / s
    let best: Place | null = null, bd = (HIT_PX / s) ** 2
    for (const p of this.places) {
      if (p.w < 0.5) continue
      const d = (p.x - mx) ** 2 + (p.y - my) ** 2
      if (d < bd) { bd = d; best = p }
    }
    return best
  }
  private onControl(e: Event) { return !!(e.target as HTMLElement).closest('.zoom, .tooltip') }

  private down(e: PointerEvent) {
    if (this.onControl(e) || e.button !== 0) return
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
      this.capture(e.pointerId)
      if (this.touches.size === 2) { this.press = null; this.pinch = this.spread(); return }   // two fingers: pinch
      if (this.touches.size > 2) return
    }
    this.press = { x: e.clientX, y: e.clientY, vx: this.vx, vy: this.vy, lastY: e.clientY, dragged: false }
  }
  private move(e: PointerEvent) {
    if (this.touches.has(e.pointerId)) this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (this.pinch && this.touches.size >= 2) {
      // zoom by the change in finger spread around the midpoint, and pan with the midpoint
      const now = this.spread(), prev = this.pinch
      const mx = this.vx + prev.mx / this.s, my = this.vy + prev.my / this.s   // map point under last midpoint
      this.k = Math.min(ZOOM_MAX, Math.max(1, this.k * (now.d / (prev.d || 1))))
      this.vx = mx - now.mx / this.s; this.vy = my - now.my / this.s
      this.pinch = now; this.view(); return
    }
    const p = this.press
    if (p) {
      const dx = e.clientX - p.x, dy = e.clientY - p.y
      if (!p.dragged && Math.hypot(dx, dy) > DRAG_PX) {
        p.dragged = true
        if (e.pointerType !== 'touch' && this.k > 1) this.capture(e.pointerId)
      }
      if (p.dragged && this.k > 1) { this.vx = p.vx - dx / this.s; this.vy = p.vy - dy / this.s; this.view(); return }
      // not zoomed: a finger drag scrolls the page (the map takes all touch gestures, so do it here)
      if (p.dragged && e.pointerType === 'touch') { window.scrollBy(0, p.lastY - e.clientY); p.lastY = e.clientY; return }
    }
    if (e.pointerType === 'mouse' && !this.pinned && !this.onControl(e)) this.show(this.hit(e))
  }
  /** keep receiving a pointer's moves outside the map; a pointer the browser no longer tracks is ignored */
  private capture(id: number) { try { this.map.setPointerCapture(id) } catch { /* not an active pointer */ } }
  /** finger spread and midpoint, relative to the map */
  private spread() {
    const [a, b] = [...this.touches.values()], r = this.map.getBoundingClientRect()
    return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2 - r.left, my: (a.y + b.y) / 2 - r.top }
  }
  /** a finger or pointer leaves: ending a pinch never counts as a tap */
  private lift(e: PointerEvent) {
    const wasPinch = !!this.pinch
    this.touches.delete(e.pointerId)
    if (this.touches.size < 2) this.pinch = null
    if (wasPinch || e.type === 'pointercancel') { this.press = null; return true }
    return false
  }
  private up(e: PointerEvent) {
    if (this.lift(e)) return
    const p = this.press; this.press = null
    if (!p || p.dragged || this.onControl(e)) return
    const target = this.hit(e)
    if (target && !(this.pinned && this.shown?.key === target.key)) { this.pinned = true; this.show(target) }
    else this.unpin()
  }
  private unpin() { this.pinned = false; this.show(null) }

  // ---------------------------------------------------------------- detail card

  private show(p: Place | null) {
    const pinnedNow = this.pinned && !!p
    const same = p?.key === this.shown?.key && p?.x === this.shown?.x
    this.tip.classList.toggle('pinned', pinnedNow)
    if (same && this.tip.dataset.pinned === String(pinnedNow)) return   // refill when a hovered card gets pinned
    this.shown = p
    this.drawDots()
    if (!p) { this.tip.hidden = true; return }
    this.fillCard(p)
  }

  /** After a data change, keep the card on the same place (or close it if that place has gone). */
  private refreshCard() {
    if (!this.shown) return
    const p = this.places.find(q => q.key === this.shown!.key && q.w >= 0.5) ?? null
    if (!p) { this.pinned = false; this.shown = null; this.tip.hidden = true; this.drawDots(); return }
    this.shown = p; this.fillCard(p)
  }

  private fillCard(p: Place) {
    const c = this.describe(p)
    const mx = c.rows.length ? c.rows[0][1] : 1
    const title = el('div', { class: c.city ? 'tt-title city' : 'tt-title' })
    title.append(el('b', {}, c.title), el('span', {}, c.subtitle))
    const rows = el('div', { class: 'tt-rows' })
    for (const [name, v] of c.rows) {
      const row = el('div', { class: 'tt-row' }), bar = el('i')
      bar.style.width = `${Math.max(2, (v / mx) * 100)}%`
      row.append(el('span', {}, name), bar, el('span', {}, fmt(v)))
      rows.append(row)
    }
    this.tip.replaceChildren(title, el('div', { class: 'tt-total' }, c.total), rows)
    if (c.more > 0) this.tip.append(el('div', { class: 'tt-more' }, `+ ${c.more} more airline${c.more === 1 ? '' : 's'}`))
    if (c.jump && this.pinned) {
      const b = el('button', { type: 'button', class: 'tt-jump' })
      b.innerHTML = PLANE
      b.append(el('span', {}, `Show flights from ${c.jump.label}`))
      b.insertAdjacentHTML('beforeend', ARROW)
      const run = c.jump.run
      b.addEventListener('click', () => { this.unpin(); run() })
      this.tip.append(b)
    } else if (c.jump) {
      this.tip.append(el('div', { class: 'tt-hint' }, `Click to pin, then show flights from ${c.jump.label}`))
    }
    this.tip.dataset.pinned = String(this.pinned)
    this.tip.hidden = false
    this.placeCard()
  }

  private placeCard() {
    const p = this.shown
    if (!p || this.tip.hidden) return
    const px = this.sx(p.x), py = this.sy(p.y)
    const tw = this.tip.offsetWidth, th = this.tip.offsetHeight, W = this.map.clientWidth, H = this.map.clientHeight
    const left = px + 18 + tw > W ? px - 18 - tw : px + 18
    this.tip.style.left = `${Math.max(8, left)}px`
    this.tip.style.top = `${Math.min(Math.max(8, py - 40), H - th - 8)}px`
  }
}
