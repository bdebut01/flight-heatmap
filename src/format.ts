const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
export const fmt = (n: number) => nf.format(Math.round(n))
/** 'Portland, OR' -> 'portland-or', for readable links */
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const monthName = (ym: string) => MN[+ym.slice(5) - 1]
export const monthLabel = (ym: string) => `${monthName(ym)} ${ym.slice(0, 4)}`

export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string) => {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  if (text !== undefined) e.textContent = text
  return e
}
export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

const SVG = 'http://www.w3.org/2000/svg'
export const svgEl = (tag: string, attrs: Record<string, string | number> = {}) => {
  const e = document.createElementNS(SVG, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v))
  return e
}

export function sparkline(vals: ArrayLike<number>, w = 56, h = 18) {
  let mx = 0
  for (let i = 0; i < vals.length; i++) mx = Math.max(mx, vals[i])
  const pts = Array.from({ length: vals.length }, (_, i) =>
    `${((i * w) / (vals.length - 1)).toFixed(1)},${(h - 1 - (mx ? vals[i] / mx : 0) * (h - 2)).toFixed(1)}`).join(' ')
  const s = svgEl('svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}`, 'aria-hidden': 'true' })
  s.append(svgEl('polyline', { points: pts, fill: 'none', 'stroke-width': 1.5, 'stroke-linejoin': 'round' }))
  return s
}
