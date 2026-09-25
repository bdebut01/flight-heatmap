import { $, el, fmt, monthLabel, monthName } from './format'

/** Month bars (the selection's monthly totals), a range slider over them, and play/pause. */
export class Timeline {
  private bars = $('bars')
  private range = $('month') as HTMLInputElement
  private play = $('play')
  private timer = 0
  private tip = el('div', { class: 'bar-tip', 'aria-hidden': 'true' })
  private hovered = -1
  private totals: ArrayLike<number> = []
  private unit = ''

  constructor(private months: string[], private onMonth: (m: number) => void) {
    const n = months.length
    this.range.max = String(n - 1)
    $('bars').parentElement!.style.setProperty('--n', String(n))
    this.range.addEventListener('input', () => { this.stop(); onMonth(+this.range.value) })
    this.play.addEventListener('click', () => (this.timer ? this.stop() : this.start()))
    // hover anywhere over the track: shade that month's bar and name it above
    const track = this.bars.parentElement!
    track.append(this.tip)
    track.addEventListener('pointermove', e => {
      const r = this.bars.getBoundingClientRect()
      this.hover(Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n))))
    })
    track.addEventListener('pointerleave', () => this.hover(-1))
    const ticks = $('ticks')
    months.forEach((ym, i) => {
      const label = i === n - 1 ? monthName(ym) : ym.endsWith('-01') ? monthLabel(ym) : ym.endsWith('-07') ? monthName(ym) : ''
      if (!label || (i !== n - 1 && n - 1 - i < 3)) return
      const s = el('span', {}, label); s.style.left = `${((i + 0.5) / n) * 100}%`; ticks.append(s)
    })
  }

  update(month: number, totals: Float64Array, scaleMax: number, unit: string) {
    this.range.value = String(month)
    this.range.setAttribute('aria-valuetext', monthLabel(this.months[month]))
    const kids = Array.from(totals, (v, i) => {
      const d = el('div')
      d.style.height = `${Math.max(2, Math.round((v / (scaleMax || 1)) * 44))}px`
      if (i === month) d.className = 'on'
      d.addEventListener('click', () => { this.stop(); this.onMonth(i) })
      return d
    })
    this.bars.replaceChildren(...kids)
    this.totals = totals; this.unit = unit
    this.hover(this.hovered)
  }

  private hover(i: number) {
    const kids = this.bars.children
    if (this.hovered >= 0 && kids[this.hovered]) kids[this.hovered].classList.remove('hover')
    this.hovered = i
    if (i < 0 || !kids[i]) { this.tip.hidden = true; return }
    kids[i].classList.add('hover')
    this.tip.textContent = `${monthLabel(this.months[i])} · ${fmt(this.totals[i] ?? 0)} ${this.unit}`
    this.tip.hidden = false
    // centre on the bar, but keep the label inside the track
    const n = this.months.length, w = this.bars.clientWidth, tw = this.tip.offsetWidth
    const cx = ((i + 0.5) / n) * w
    this.tip.style.left = `${Math.min(w - tw, Math.max(0, cx - tw / 2))}px`
  }

  private start() {
    this.play.setAttribute('aria-pressed', 'true'); this.play.setAttribute('aria-label', 'Pause')
    this.timer = window.setInterval(() => this.onMonth((+this.range.value + 1) % this.months.length), 900)
  }
  stop() {
    if (!this.timer) return
    clearInterval(this.timer); this.timer = 0
    this.play.setAttribute('aria-pressed', 'false'); this.play.setAttribute('aria-label', 'Play months')
  }
}
