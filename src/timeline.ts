import { $, el, fmt, monthLabel, monthName } from './format'

/** Month bars (the selection's monthly totals), a range slider over them, and play/pause. */
export class Timeline {
  private bars = $('bars')
  private range = $('month') as HTMLInputElement
  private play = $('play')
  private timer = 0

  constructor(private months: string[], private onMonth: (m: number) => void) {
    const n = months.length
    this.range.max = String(n - 1)
    this.range.addEventListener('input', () => { this.stop(); onMonth(+this.range.value) })
    this.play.addEventListener('click', () => (this.timer ? this.stop() : this.start()))
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
      const d = el('div', { title: `${monthLabel(this.months[i])}: ${fmt(v)} ${unit}` })
      d.style.height = `${Math.max(2, Math.round((v / (scaleMax || 1)) * 44))}px`
      if (i === month) d.className = 'on'
      d.addEventListener('click', () => { this.stop(); this.onMonth(i) })
      return d
    })
    this.bars.replaceChildren(...kids)
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
