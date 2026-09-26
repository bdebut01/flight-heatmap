import type { Meta } from './data'
import { $, el, fmt, slug } from './format'

export interface Origin { kind: 'airport' | 'city'; index: number; airports: number[]; code: string; name: string }
interface Option extends Origin { rank: number; traffic: number; sub: string }

const MAX = 8
const CITY_MIN = 1000   // departures over the whole period
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

/** "Flying from" combobox: cities (metro areas with several airports) first, then airports. */
export class OriginPicker {
  private input = $('from') as HTMLInputElement
  private list = $('from-list')
  private box = $('from-box')
  private chosen = $('from-chosen')
  private options: Option[] = []
  private shown: Option[] = []
  private active = -1
  private all: Option[]
  private marketSlug: string[]

  constructor(meta: Meta, traffic: Float64Array, private period: string, private onPick: (o: Origin | null) => void) {
    this.marketSlug = meta.markets.map(m => slug(m.n))
    const byMarket = new Map<number, number[]>()
    for (let a = 0; a < meta.nUS; a++) {
      if (traffic[a] < CITY_MIN) continue   // a metro option needs two or more airports with real service
      const mk = meta.airports[a].mk!
      byMarket.set(mk, [...(byMarket.get(mk) ?? []), a])
    }
    this.all = []
    for (const [mk, aps] of byMarket) {
      if (aps.length < 2) continue
      aps.sort((x, y) => traffic[y] - traffic[x])
      const name = meta.markets[mk].n
      this.all.push({ kind: 'city', index: mk, airports: aps, code: aps.map(a => meta.airports[a].c).join(' · '),
        name: `${name.split(',')[0]} area`, sub: aps.map(a => meta.airports[a].c).join(' · '), rank: 0, traffic: aps.reduce((s, a) => s + traffic[a], 0) })
    }
    for (let a = 0; a < meta.nUS; a++) {
      if (traffic[a] < 1) continue
      const ap = meta.airports[a]
      this.all.push({ kind: 'airport', index: a, airports: [a], code: ap.c, name: ap.ci, sub: ap.n, rank: 0, traffic: traffic[a] })
    }
    this.input.addEventListener('input', () => this.search())
    this.input.addEventListener('focus', () => this.search())
    this.input.addEventListener('keydown', e => this.key(e))
    this.input.addEventListener('blur', () => setTimeout(() => this.close(), 150))
    $('from-clear').addEventListener('click', () => { this.set(null); this.input.focus() })
  }

  /** The origin for an airport or a metro area; a metro without two real airports falls back to its busiest one. */
  find(kind: 'airport' | 'city', index: number, fallbackAirport: number): Origin | null {
    return this.all.find(o => o.kind === kind && o.index === index)
      ?? this.all.find(o => o.kind === 'airport' && o.index === fallbackAirport) ?? null
  }

  /** link key for an origin: the airport code, or the metro's slug */
  keyOf(o: Origin) { return o.kind === 'city' ? this.marketSlug[o.index] : o.code }
  byKey(key: string): Origin | null {
    const k = key.toLowerCase()
    return this.all.find(o => o.kind === 'airport' && o.code.toLowerCase() === k)
      ?? this.all.find(o => o.kind === 'city' && this.marketSlug[o.index] === k) ?? null
  }

  set(o: Origin | null) {
    this.box.hidden = !!o; this.chosen.hidden = !o
    if (o) {
      $('from-code').textContent = o.kind === 'city' ? o.name : o.code
      $('from-code').classList.toggle('city', o.kind === 'city')
      $('from-name').textContent = o.kind === 'city' ? o.code : o.name
    }
    this.input.value = ''; this.close(); this.onPick(o)
  }

  private search() {
    const q = this.input.value.trim().toLowerCase()
    if (!q) { this.close(); return }
    this.options = []
    for (const o of this.all) {
      const code = o.kind === 'airport' ? o.code.toLowerCase() : ''
      let rank = -1
      if (code === q) rank = 0
      else if (code.startsWith(q)) rank = 1
      else if (words(`${o.name} ${o.sub}`).some(w => w.startsWith(q))) rank = 2
      if (rank >= 0) this.options.push({ ...o, rank })
    }
    this.options.sort((a, b) => a.rank - b.rank || b.traffic - a.traffic)
    // the section holding the best match comes first (DEN before "Denver area"; "new" puts New York City area first)
    const cities = this.options.filter(o => o.kind === 'city').slice(0, 2)
    const airports = this.options.filter(o => o.kind === 'airport').slice(0, MAX - cities.length)
    const cityFirst = cities.length > 0 && (!airports.length || cities[0].rank <= airports[0].rank)
    this.shown = cityFirst ? [...cities, ...airports] : [...airports, ...cities]
    this.active = this.shown.length ? 0 : -1
    this.draw()
  }

  private draw() {
    this.list.replaceChildren()
    if (!this.shown.length) {
      this.list.append(el('li', { class: 'opt-empty', role: 'presentation' }, 'No airports match'))
    }
    let section = ''
    this.shown.forEach((o, i) => {
      const s = o.kind === 'city' ? 'Cities' : 'Airports'
      if (s !== section) { section = s; this.list.append(el('li', { class: 'opt-head', role: 'presentation' }, s)) }
      const li = el('li', { role: 'option', id: `from-opt-${i}`, class: 'opt', 'aria-selected': String(i === this.active) })
      const text = el('span', { class: 'opt-text' })
      text.append(el('span', {}, o.name), el('small', {}, o.sub))
      li.append(el('span', { class: 'opt-code' }, o.kind === 'city' ? 'City' : o.code), text, el('span', { class: 'opt-n' }, fmt(o.traffic)))
      li.addEventListener('mousedown', e => { e.preventDefault(); this.set(o) })
      this.list.append(li)
    })
    if (this.shown.length) this.list.append(el('li', { class: 'opt-foot', role: 'presentation' }, `Departures, ${this.period}`))
    this.list.hidden = false
    this.input.setAttribute('aria-expanded', 'true')
    this.input.setAttribute('aria-activedescendant', this.active >= 0 ? `from-opt-${this.active}` : '')
  }

  private key(e: KeyboardEvent) {
    if (e.key === 'Escape') { this.close(); return }
    if (!this.shown.length) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      this.active = (this.active + (e.key === 'ArrowDown' ? 1 : -1) + this.shown.length) % this.shown.length
      this.draw()
    } else if (e.key === 'Enter' && this.active >= 0) {
      e.preventDefault(); this.set(this.shown[this.active])
    }
  }

  private close() {
    this.list.hidden = true; this.shown = []
    this.input.setAttribute('aria-expanded', 'false'); this.input.removeAttribute('aria-activedescendant')
  }
}
