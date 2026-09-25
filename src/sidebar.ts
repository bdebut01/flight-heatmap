import type { Group, Model } from './data'
import { el, fmt, sparkline } from './format'

const GROUPS: { g: Group; name: string }[] = [
  { g: 'us', name: 'US airlines' },
  { g: 'regional', name: 'Regional & commuter' },
  { g: 'foreign', name: 'Foreign airlines' },
]
const CHEVRON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"></path></svg>'

interface Row { b: number; label: HTMLLabelElement; box: HTMLInputElement; meter: HTMLElement; none: HTMLElement; val: HTMLElement; spark: HTMLElement; search: string }
interface GroupUI { g: Group; head: HTMLElement; box: HTMLInputElement; state: HTMLElement; total: HTMLElement; expand: HTMLButtonElement; body: HTMLElement; rows: Row[] }

export interface SidebarHandlers {
  toggle(brands: number[], on: boolean): void
}

/** Grouped airline list: group checkbox (all / some / none), expandable rows, search filter. */
export class Sidebar {
  private groups: GroupUI[] = []
  private expanded: Record<Group, boolean> = { us: true, regional: false, foreign: false }
  private query = ''
  private visible: Uint8Array | null = null

  constructor(root: HTMLElement, model: Model, h: SidebarHandlers) {
    const brands = model.meta.brands
    for (const { g, name } of GROUPS) {
      const members = brands.map((b, i) => ({ b, i })).filter(x => x.b.g === g)
      if (!members.length) continue
      const id = `grp-${g}`
      const head = el('div', { class: 'group-head' })
      const check = el('label', { class: 'group-check' })   // only the checkbox toggles the group's airlines
      const box = el('input', { type: 'checkbox' }) as HTMLInputElement
      const state = el('span', { class: 'group-state' })
      const names = el('span', { class: 'group-names' })
      names.append(el('span', { class: 'group-name' }, name), state)
      check.append(box, el('span', { class: 'vh' }, `All ${name}`))
      const total = el('span', { class: 'group-total' })
      const expand = el('button', { type: 'button', class: 'expand', 'aria-controls': id, 'aria-label': `Show ${name}` }) as HTMLButtonElement
      expand.innerHTML = CHEVRON
      head.append(check, names, total, expand)
      const body = el('div', { class: 'group-body', id })
      const rows: Row[] = members.map(({ b, i }) => {
        const label = el('label', { class: 'row' }) as HTMLLabelElement
        const rbox = el('input', { type: 'checkbox' }) as HTMLInputElement
        const nameCol = el('span', { class: 'name' })
        const meter = el('span', { class: 'meter' }), none = el('span', { class: 'none' }, 'No flights this month')
        nameCol.append(el('span', {}, b.n), meter, none)
        const spark = el('span'), val = el('span', { class: 'val' })
        label.append(rbox, nameCol, spark, val)
        rbox.addEventListener('change', () => h.toggle([i], rbox.checked))
        body.append(label)
        return { b: i, label, box: rbox, meter, none, val, spark, search: `${b.n} ${b.c}`.toLowerCase() }
      })
      box.addEventListener('change', () => h.toggle(rows.filter(r => this.shows(r)).map(r => r.b), box.checked))
      // the rest of the header (name, count, total, chevron) opens and closes the group
      head.addEventListener('click', e => {
        if ((e.target as HTMLElement).closest('.group-check')) return
        this.expanded[g] = !this.expanded[g]; this.layout()
      })
      root.append(head, body)
      this.groups.push({ g, head, box, state, total, expand, body, rows })
    }
    this.layout()
  }

  setQuery(q: string) { this.query = q.trim().toLowerCase(); this.layout() }

  /** Limit the list to some brands (the ones serving the chosen origin), or show all with null. */
  setVisible(mask: Uint8Array | null) { this.visible = mask; this.layout() }
  private shows(r: Row) { return !this.visible || !!this.visible[r.b] }

  setSparklines(series: Float64Array[]) {
    for (const G of this.groups) for (const r of G.rows) r.spark.replaceChildren(sparkline(series[r.b]))
  }

  /** values: this month's totals per brand (all brands); on: enabled mask */
  update(values: Float64Array, on: Uint8Array) {
    let mx = 0
    for (const v of values) mx = Math.max(mx, v)
    for (const G of this.groups) {
      let nOn = 0, nFlying = 0, total = 0
      const rows = G.rows.filter(r => this.shows(r))
      for (const r of rows) {
        const v = values[r.b], isOn = !!on[r.b]
        r.box.checked = isOn
        r.label.classList.toggle('off', !isOn)
        r.val.textContent = v >= 0.5 ? fmt(v) : '—'
        const flying = v >= 0.5
        r.meter.hidden = !flying; r.none.hidden = flying
        r.meter.style.width = `${Math.max(1, (v / (mx || 1)) * 100).toFixed(1)}%`
        if (flying) { nFlying++; total += v; if (isOn) nOn++ }
      }
      const allOn = rows.every(r => on[r.b]), noneOn = rows.every(r => !on[r.b])
      G.box.checked = allOn; G.box.indeterminate = !allOn && !noneOn
      G.state.textContent = allOn ? `${nFlying} airlines` : `${nOn} of ${nFlying} on`
      G.total.textContent = fmt(total)
    }
  }

  private layout() {
    for (const G of this.groups) {
      let matches = 0
      for (const r of G.rows) {
        const hit = this.shows(r) && (!this.query || r.search.includes(this.query))
        r.label.hidden = !hit
        if (hit) matches++
      }
      const open = this.query ? matches > 0 : this.expanded[G.g]
      G.head.hidden = G.body.hidden = matches === 0
      if (!G.head.hidden) G.body.hidden = !open
      G.expand.setAttribute('aria-expanded', String(open))
    }
  }
}
