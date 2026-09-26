// Self-hosted IBM Plex (SIL OFL), Latin subset: bundled by Vite, no third-party font requests.
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-500.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import { loadBase } from './data'
import { MapView, type Place, type TipContent } from './map'
import { OriginPicker, type Origin } from './origin'
import { Routes } from './routes'
import { Sidebar } from './sidebar'
import { Timeline } from './timeline'
import { $, el, fmt, monthLabel } from './format'

type Grouping = 'airports' | 'cities'

const store = {
  get(k: string) { try { return localStorage.getItem(k) } catch { return null } },
  set(k: string, v: string) { try { localStorage.setItem(k, v) } catch { /* private mode */ } },
}
/** days in a YYYY-MM month (day 0 of the next month is the last day of this one) */
const daysIn = (ym: string) => new Date(+ym.slice(0, 4), +ym.slice(5), 0).getDate()
const plural = (n: number, word: string) => `${fmt(n)} ${word}${n === 1 ? '' : 's'}`

async function boot() {
  const { model, basemap } = await loadBase()
  const { meta } = model
  const state = {
    month: model.M - 1,
    grouping: 'airports' as Grouping,
    on: new Uint8Array(model.nB).fill(1),
    origin: null as Origin | null,
  }
  let routes: Routes | null = null
  const allOn = new Uint8Array(model.nB).fill(1)
  const shortCity = (s: string) => s.split(',')[0]
  const routeMode = () => !!(state.origin && routes)
  const perDay = (v: number) => { const d = v / daysIn(meta.months[state.month]); return d >= 10 ? fmt(d) : d.toFixed(1) }

  /** Airport values -> map places, grouped into city markets in the Cities view. */
  const toPlaces = (value: (a: number) => number): Place[] => {
    if (state.grouping === 'airports') {
      return meta.airports.slice(0, meta.nUS).map((ap, a) => ({ key: a, x: ap.x!, y: ap.y!, w: value(a), label: ap.c }))
    }
    const w = new Float64Array(meta.markets.length)
    for (let a = 0; a < meta.nUS; a++) w[meta.airports[a].mk!] += value(a)
    return meta.markets.map((mk, i) => ({ key: i, x: mk.x, y: mk.y, w: w[i], label: shortCity(mk.n) }))
  }
  const heatPlaces = (on: Uint8Array) => {
    const tot = model.airportTotals(state.month, on)
    return toPlaces(a => tot[a])
  }
  const destValues = (on: Uint8Array) => routes!.destTotals(state.origin!.airports, state.month, on)

  /** airports behind a place, busiest first */
  const membersOf = (p: Place, value: (a: number) => number) => state.grouping === 'airports' ? [p.key]
    : meta.airports.slice(0, meta.nUS).map((ap, i) => (ap.mk === p.key && value(i) >= 0.5 ? i : -1))
      .filter(i => i >= 0).sort((a, b) => value(b) - value(a))
  const rowsFrom = (v: Float64Array): [string, number][] =>
    Array.from(v, (x, b) => [meta.brands[b].n, state.on[b] ? x : 0] as [string, number]).filter(r => r[1] >= 0.5).sort((a, b) => b[1] - a[1])

  const describe = (p: Place): TipContent => {
    const city = state.grouping === 'cities'
    let members: number[], rows: [string, number][]
    if (routeMode()) {
      const dv = destValues(state.on)
      members = membersOf(p, a => dv.get(a) ?? 0)
      rows = rowsFrom(routes!.brandTotals(state.origin!.airports, state.month, model.nB, new Set(members)))
    } else {
      const tot = model.airportTotals(state.month, state.on)
      members = membersOf(p, a => tot[a])
      const v = new Float64Array(model.nB)
      for (const a of members) for (const q of model.byAirport[a]) v[model.brandOf(q)] += model.value(q, state.month)
      rows = rowsFrom(v)
    }
    const n = rows.length
    const codes = members.map(a => meta.airports[a].c)
    const where = city ? shortCity(meta.markets[p.key].n) : meta.airports[p.key].c
    const subtitle = city ? (codes.length > 1 ? codes.slice(0, 4).join(' · ') + (codes.length > 4 ? ` +${codes.length - 4}` : '') : meta.markets[p.key].n)
      : meta.airports[p.key].ci
    const what = routeMode() ? 'nonstop flights' : 'departures'
    return {
      title: routeMode() ? `${originLabel()} → ${where}` : where, subtitle, city,
      total: `${fmt(p.w)} ${what}${routeMode() ? ` (${perDay(p.w)} a day)` : ''} · ${plural(n, 'airline')}`, rows: rows.slice(0, 4), more: Math.max(0, n - 4),
      jump: jumpFrom(city ? 'city' : 'airport', p.key, members[0] ?? p.key),
    }
  }
  /** "Show flights from X" for a card: makes that airport or city the origin (skipped if it already is). */
  const jumpFrom = (kind: 'airport' | 'city', index: number, busiest: number): TipContent['jump'] => {
    const o = picker?.find(kind, index, busiest)
    if (!o || (state.origin && o.kind === state.origin.kind && o.index === state.origin.index)) return undefined
    return { label: o.kind === 'city' ? o.name.replace(/ area$/, '') : o.code, run: () => picker.set(o) }
  }
  let picker: OriginPicker   // assigned below; cards only use it after start-up
  const originLabel = () => state.origin!.kind === 'city' ? state.origin!.name.replace(/ area$/, '') : state.origin!.code

  const map = new MapView(meta.W, meta.H, basemap, describe)
  const sidebar = new Sidebar($('groups'), model, {
    toggle(brands, on) { for (const b of brands) state.on[b] = on ? 1 : 0; render() },
    only(brands) { state.on.fill(0); for (const b of brands) state.on[b] = 1; render() },
  })
  sidebar.setSparklines(model.brandSeries())
  const timeline = new Timeline(meta.months, m => { state.month = m; render() })

  // total departures per airport over all months, to rank the origin search
  const traffic = new Float64Array(model.nA)
  for (let m = 0; m < model.M; m++) model.airportTotals(m, allOn).forEach((v, a) => (traffic[a] += v))
  picker = new OriginPicker(meta, traffic, `${monthLabel(meta.months[0])} – ${monthLabel(meta.months[model.M - 1])}`, async o => {
    state.origin = o
    if (o && !routes) {
      $('eyebrow').textContent = 'Loading routes…'
      try { routes = await Routes.load() } catch (e) { console.error(e); $('eyebrow').textContent = 'Could not load routes'; return }
    }
    render()
  })

  const theme = (): 'light' | 'dark' => {
    const t = document.documentElement.dataset.theme
    return t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light'
  }

  function render() {
    const ym = meta.months[state.month], ml = monthLabel(ym)
    const rm = routeMode()
    let bt: Float64Array, pl: Place[], series: Float64Array, seriesAll: Float64Array, extraDest = 0

    if (rm) {
      const o = state.origin!.airports
      bt = routes!.brandTotals(o, state.month, model.nB)
      const dv = destValues(state.on)
      pl = toPlaces(a => dv.get(a) ?? 0)
      const max = Math.max(0, ...pl.map(p => p.w))
      const anchor = state.origin!.kind === 'city' ? meta.markets[state.origin!.index] : meta.airports[o[0]]
      map.renderRoutes({ x: anchor.x!, y: anchor.y!, label: originLabel() }, pl, max, theme(),
        `Route map of nonstop flights from ${originLabel()}, ${ml}`)
      // destinations abroad
      const abroad = [...dv].filter(([a, v]) => a >= meta.nUS && v >= 0.5).sort((x, y) => y[1] - x[1])
      extraDest = abroad.length
      renderAbroad(abroad)
      series = routes!.monthlyTotals(o, state.on); seriesAll = routes!.monthlyTotals(o, null)
      sidebar.setVisible(routes!.brandsServing(o, model.nB))
    } else {
      bt = model.brandTotals(state.month)
      pl = heatPlaces(state.on)
      const field = map.heat.field(pl)
      map.render(pl, field, theme(),
        `Heatmap of scheduled passenger departures from US ${state.grouping}, ${ml}`)
      renderAbroad([])
      series = model.monthlyTotals(state.on); seriesAll = model.monthlyTotals(allOn)
      sidebar.setVisible(null)
    }

    const nOn = bt.reduce((n, v, b) => n + (v >= 0.5 && state.on[b] ? 1 : 0), 0)
    const nFlying = bt.reduce((n, v) => n + (v >= 0.5 ? 1 : 0), 0)
    const total = pl.reduce((s, p) => s + p.w, 0) + (rm ? [...destValues(state.on)].filter(([a]) => a >= meta.nUS).reduce((s, [, v]) => s + v, 0) : 0)
    const served = pl.filter(p => p.w >= 0.5).length + extraDest

    sidebar.update(bt, state.on)
    timeline.update(state.month, series, Math.max(...series), 'departures')

    $('month-label').textContent = ml
    $('eyebrow').textContent = rm ? `Nonstop from ${originLabel()}` : 'Showing'
    $('airlines-count').textContent = nOn < nFlying ? `Airlines · ${nOn} of ${nFlying} on`
      : rm ? `Airlines · ${nFlying} fly nonstop from ${originLabel()}` : `Airlines · ${nFlying} flying in ${ml}`
    $('all-on').hidden = nOn >= nFlying   // "Show all" only when something is off
    $('all-off').hidden = nOn === 0
    $('rail-n').textContent = String(nOn)
    $('ramp-heat').hidden = rm; $('ramp-arcs').hidden = !rm
    // share of everything flown this month (from this origin, in the route view), so size isn't lost
    const all = seriesAll[state.month], share = all > 0 ? total / all : 0
    const pct = share >= 0.9995 ? '100%' : share > 0 && share < 0.001 ? '<0.1%' : `${(share * 100).toFixed(1)}%`
    const stats: [string, string][] = [
      [fmt(total), 'departures'],
      ...(rm ? [[perDay(total), 'departures a day'] as [string, string]] : []),
      [pct, rm ? `of ${originLabel()} departures` : 'of all departures'],
      [fmt(served), rm ? 'destinations' : `${state.grouping} served`],
      [String(nOn), nOn === 1 ? 'airline on' : 'airlines on'],
    ]
    $('stats').replaceChildren(...stats.map(([v, l]) => { const d = el('div', { class: 'stat' }); d.append(el('b', {}, v), el('span', {}, l)); return d }))
    document.querySelectorAll<HTMLElement>('.seg[data-key]').forEach(seg => {
      const cur = String(state[seg.dataset.key as 'grouping'])
      seg.querySelectorAll<HTMLButtonElement>('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === cur)))
    })
    writeLink()
  }

  // ---- the view lives in the link (#from=DEN&month=2026-03&show=cities&only=UA,WN) so it can be shared
  // and survives a reload. replaceState keeps every tweak out of the back-button history.
  function writeLink() {
    const parts: string[] = []
    if (state.origin) parts.push(`from=${encodeURIComponent(picker.keyOf(state.origin))}`)
    if (state.month !== model.M - 1) parts.push(`month=${meta.months[state.month]}`)
    if (state.grouping === 'cities') parts.push('show=cities')
    const on = meta.brands.filter((_, b) => state.on[b]).map(b => b.c)
    const off = meta.brands.filter((_, b) => !state.on[b]).map(b => b.c)
    if (off.length) parts.push(on.length <= off.length ? `only=${on.join(',')}` : `off=${off.join(',')}`)
    const hash = parts.join('&')
    if (location.hash.slice(1) !== hash) history.replaceState(null, '', hash ? `#${hash}` : location.pathname + location.search)
  }
  function readLink() {
    const p = new URLSearchParams(location.hash.slice(1))
    const m = meta.months.indexOf(p.get('month') ?? '')
    state.month = m >= 0 ? m : model.M - 1
    state.grouping = p.get('show') === 'cities' ? 'cities' : 'airports'
    // airline codes; a list with no codes we know is ignored rather than switching everything off
    const known = new Set(meta.brands.map(b => b.c))
    const codes = (k: string) => new Set((p.get(k) ?? '').split(',').filter(c => known.has(c)))
    const only = codes('only'), off = codes('off')
    if (only.size) meta.brands.forEach((b, i) => (state.on[i] = only.has(b.c) ? 1 : 0))
    else if (off.size) meta.brands.forEach((b, i) => (state.on[i] = off.has(b.c) ? 0 : 1))
    else state.on.fill(1)
    const from = p.get('from'), o = from ? picker.byKey(from) : null
    if (o && !(state.origin && picker.keyOf(state.origin) === picker.keyOf(o))) {
      if (!routes) render()   // draw the heatmap while the routes load
      picker.set(o)           // renders again once they're in
    }
    else if (!o && state.origin) picker.set(null)
    else render()
  }

  // chips for nonstop destinations outside the US; the first few, then an expander
  let abroadOpen = false
  function renderAbroad(list: [number, number][]) {
    const box = $('abroad')
    box.hidden = !list.length
    if (!list.length) { box.replaceChildren(); abroadOpen = false; return }
    const SHOW = 6, shown = abroadOpen ? list : list.slice(0, SHOW)
    const kids: HTMLElement[] = [el('span', { class: 'abroad-title' }, `Also nonstop abroad · ${list.length}`)]
    for (const [a, v] of shown) {
      const ap = meta.airports[a], chip = el('span', { class: 'chip', title: ap.n })
      chip.append(el('b', {}, ap.c), el('span', {}, shortCity(ap.ci)), el('span', {}, fmt(v)))
      kids.push(chip)
    }
    if (list.length > SHOW) {
      const more = el('button', { type: 'button', class: 'link' }, abroadOpen ? 'Show fewer' : `+ ${list.length - SHOW} more`)
      more.addEventListener('click', () => { abroadOpen = !abroadOpen; render() })
      kids.push(more)
    }
    box.replaceChildren(...kids)
  }

  // ---- controls
  document.querySelectorAll<HTMLElement>('.seg[data-key]').forEach(seg => {
    seg.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest('button'); if (!b) return
      ;(state as Record<string, unknown>)[seg.dataset.key!] = b.dataset.v
      render()
    })
  })
  $('all-on').addEventListener('click', () => { state.on.fill(1); render() })
  $('all-off').addEventListener('click', () => { state.on.fill(0); render() })
  const search = $('search') as HTMLInputElement
  search.placeholder = `Search ${model.nB} airlines`
  search.addEventListener('input', () => sidebar.setQuery(search.value))

  const app = $('app')
  const setSidebar = (open: boolean) => {
    app.dataset.sidebar = open ? 'open' : 'closed'
    $('hide-side').setAttribute('aria-expanded', String(open))
    $('show-side').setAttribute('aria-expanded', String(open))
    store.set('sidebar', open ? 'open' : 'closed')
    requestAnimationFrame(() => map.fit())
  }
  $('hide-side').addEventListener('click', () => {
    const open = app.dataset.sidebar !== 'open'
    setSidebar(open)
    if (!open && !matchMedia('(max-width: 820px)').matches) $('show-side').focus()   // the hide button is going away
  })
  $('show-side').addEventListener('click', () => { setSidebar(true); $('hide-side').focus() })
  setSidebar(store.get('sidebar') !== 'closed')
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render)

  readLink()
  addEventListener('hashchange', readLink)   // a pasted or edited link
  map.fit()
  $('loading').hidden = true
}

boot().catch(err => {
  console.error(err)
  $('loading').textContent = 'Couldn’t load the flight data. Check your connection and reload the page.'
})
