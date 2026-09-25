interface RoutesFile { k: [number, number, number][]; f: number[][] }

/** Route (origin, destination) x brand x month, loaded when an origin is first chosen. */
export class Routes {
  readonly M: number
  private ro: Int32Array
  private rd: Int32Array
  private rb: Int32Array
  private F: Float64Array
  private byOrigin = new Map<number, number[]>()

  static async load() {
    const r = await fetch(`${import.meta.env.BASE_URL}data/routes.json`)
    if (!r.ok) throw new Error(`routes.json: ${r.status}`)
    return new Routes(await r.json())
  }

  private constructor(d: RoutesFile) {
    const n = d.k.length
    this.M = d.f[0]?.length ?? 0
    this.ro = new Int32Array(n); this.rd = new Int32Array(n); this.rb = new Int32Array(n)
    this.F = new Float64Array(n * this.M)
    d.k.forEach(([o, dst, b], i) => {
      this.ro[i] = o; this.rd[i] = dst; this.rb[i] = b
      for (let m = 0; m < this.M; m++) this.F[i * this.M + m] = d.f[i][m]
      let list = this.byOrigin.get(o)
      if (!list) this.byOrigin.set(o, (list = []))
      list.push(i)
    })
  }

  private *each(origins: number[]) {
    for (const o of origins) for (const i of this.byOrigin.get(o) ?? []) yield i
  }
  private val(i: number, m: number) { return this.F[i * this.M + m] }

  /** destination airport -> value, enabled brands only */
  destTotals(origins: number[], m: number, on: Uint8Array) {
    const out = new Map<number, number>()
    for (const i of this.each(origins)) {
      if (!on[this.rb[i]]) continue
      const v = this.val(i, m)
      if (v > 0) out.set(this.rd[i], (out.get(this.rd[i]) ?? 0) + v)
    }
    return out
  }

  /** brand -> value on the given destinations (all destinations when omitted) */
  brandTotals(origins: number[], m: number, nB: number, dests?: Set<number>) {
    const out = new Float64Array(nB)
    for (const i of this.each(origins)) if (!dests || dests.has(this.rd[i])) out[this.rb[i]] += this.val(i, m)
    return out
  }

  monthlyTotals(origins: number[], on: Uint8Array | null) {
    const out = new Float64Array(this.M)
    for (const i of this.each(origins)) {
      if (on && !on[this.rb[i]]) continue
      for (let m = 0; m < this.M; m++) out[m] += this.val(i, m)
    }
    return out
  }

  /** brands with any flights from these origins in any month */
  brandsServing(origins: number[], nB: number) {
    const out = new Uint8Array(nB)
    for (const i of this.each(origins)) out[this.rb[i]] = 1
    return out
  }
}
