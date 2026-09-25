export type Group = 'us' | 'regional' | 'foreign'
export type Measure = 'flights' | 'seats'

export interface Airport { c: string; n: string; ci: string; mk?: number; x?: number; y?: number; f?: 1 }
export interface Market { n: string; x: number; y: number }
export interface Brand { c: string; n: string; g: Group }
export interface Meta {
  months: string[]; W: number; H: number; nUS: number
  airports: Airport[]; markets: Market[]; brands: Brand[]; source: string
}
interface Summary { k: [number, number][]; f: number[][]; s: number[][] }

const url = (name: string) => `${import.meta.env.BASE_URL}data/${name}`
const getJSON = async <T>(name: string): Promise<T> => {
  const r = await fetch(url(name))
  if (!r.ok) throw new Error(`${name}: ${r.status}`)
  return r.json()
}

export async function loadBase() {
  const [meta, summary, basemap] = await Promise.all([
    getJSON<Meta>('meta.json'), getJSON<Summary>('summary.json'), getJSON<{ d: string }>('basemap.json'),
  ])
  return { model: new Model(meta, summary), basemap: basemap.d }
}

/** Origin airport x brand x month flights and seats, with the sums the UI needs. */
export class Model {
  readonly M: number
  readonly nB: number
  readonly nA: number
  private pa: Int32Array
  private pb: Int32Array
  private F: Float64Array
  private S: Float64Array
  /** pair indices per airport, for tooltips */
  readonly byAirport: number[][]

  constructor(readonly meta: Meta, s: Summary) {
    this.M = meta.months.length; this.nB = meta.brands.length; this.nA = meta.airports.length
    const P = s.k.length
    this.pa = new Int32Array(P); this.pb = new Int32Array(P)
    this.F = new Float64Array(P * this.M); this.S = new Float64Array(P * this.M)
    this.byAirport = Array.from({ length: this.nA }, () => [])
    s.k.forEach(([a, b], p) => {
      this.pa[p] = a; this.pb[p] = b; this.byAirport[a].push(p)
      for (let m = 0; m < this.M; m++) { this.F[p * this.M + m] = s.f[p][m]; this.S[p * this.M + m] = s.s[p][m] }
    })
  }

  get P() { return this.pa.length }
  brandOf(p: number) { return this.pb[p] }
  value(p: number, m: number, measure: Measure) {
    return (measure === 'flights' ? this.F : this.S)[p * this.M + m]
  }

  /** totals per brand for one month */
  brandTotals(m: number, measure: Measure) {
    const out = new Float64Array(this.nB)
    for (let p = 0; p < this.P; p++) out[this.pb[p]] += this.value(p, m, measure)
    return out
  }

  /** totals per airport for one month, enabled brands only */
  airportTotals(m: number, measure: Measure, on: Uint8Array) {
    const out = new Float64Array(this.nA)
    for (let p = 0; p < this.P; p++) if (on[this.pb[p]]) out[this.pa[p]] += this.value(p, m, measure)
    return out
  }

  /** totals per month, enabled brands only */
  monthlyTotals(measure: Measure, on: Uint8Array) {
    const out = new Float64Array(this.M)
    for (let p = 0; p < this.P; p++) {
      if (!on[this.pb[p]]) continue
      for (let m = 0; m < this.M; m++) out[m] += this.value(p, m, measure)
    }
    return out
  }

  /** per-brand monthly series, for sparklines */
  brandSeries(measure: Measure) {
    const out = Array.from({ length: this.nB }, () => new Float64Array(this.M))
    for (let p = 0; p < this.P; p++) for (let m = 0; m < this.M; m++) out[this.pb[p]][m] += this.value(p, m, measure)
    return out
  }
}
