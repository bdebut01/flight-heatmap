"""Build the app's data files from the raw BTS downloads in data/raw.

Inputs (see README):  T-100 Segment (All Carriers) zips, monthly Marketing Carrier
On-Time zips, the BTS Master Coordinate zip and us-atlas states-10m.json.
Outputs (public/data/): meta.json, summary.json, routes.json, basemap.json.

Standard library only:  python3 pipeline/build.py [--raw data/raw] [--out public/data]
"""
import argparse, csv, collections, io, json, math, re, sys, zipfile
from pathlib import Path

PACIFIC = {'GU', 'MP', 'AS', 'TT'}      # Guam, N. Marianas, American Samoa, Trust Territory: left off
INSETS = {'AK', 'HI', 'PR', 'VI'}
MERGE = {'HA': 'AS'}                     # Hawaiian reports under Alaska from 2026
W, H = 2200, 1360                        # projected map space

# ---------------------------------------------------------------- projection
def albers(lat, lon, lat0, lon0, p1, p2):
    r = math.radians
    n = (math.sin(r(p1)) + math.sin(r(p2))) / 2
    c = math.cos(r(p1)) ** 2 + 2 * n * math.sin(r(p1))
    rho = lambda la: math.sqrt(c - 2 * n * math.sin(r(la))) / n
    th = n * r(lon - lon0)
    return rho(lat) * math.sin(th), rho(lat0) - rho(lat) * math.cos(th)

_conus = lambda la, lo: albers(la, lo, 37.5, -96, 29.5, 45.5)
_X0 = min(_conus(48, -124.8)[0], _conus(40, -124.4)[0])
_X1 = _conus(45, -66.9)[0]
_Y1 = _conus(49.4, -95)[1]
_PAD = 60
_SC = (W - 2 * _PAD - 40) / (_X1 - _X0)

def project(lat, lon, region):
    """Lower 48 in Albers; Alaska, Hawaii and Puerto Rico/USVI as insets."""
    if region == 'AK':
        if lon > 0:
            lon -= 360
        x, y = albers(lat, lon, 62, -154, 55, 65); s = _SC * 0.24
        return 250 + x * s, H - 190 - y * s
    if region == 'HI':
        x, y = albers(lat, lon, 20.5, -157, 18, 22); s = _SC * 0.8
        return 640 + x * s, H - 85 - y * s
    if region in ('PR', 'VI'):
        x, y = albers(lat, lon, 18.2, -66, 17, 19); s = _SC * 1.1
        return 1990 + x * s, H - 120 - y * s
    x, y = _conus(lat, lon)
    return _PAD + (x - _X0) * _SC, _PAD + 75 + (_Y1 - y) * _SC

region_of = lambda state: state if state in INSETS else 'US'

# ---------------------------------------------------------------- inputs
def open_csv(path, member=None):
    """Yield dict rows from a CSV, or from the (first / named) CSV inside a zip."""
    path = Path(path)
    if path.suffix == '.zip':
        z = zipfile.ZipFile(path)
        name = member or next(n for n in z.namelist() if n.lower().endswith('.csv') and 'documentation' not in n.lower())
        with z.open(name) as f:
            yield from csv.DictReader(io.TextIOWrapper(f, encoding='utf-8-sig', newline=''))
    else:
        with open(path, encoding='utf-8-sig', newline='') as f:
            yield from csv.DictReader(f)

def load_airports(raw):
    src = next(iter(sorted(raw.glob('bts_master_coordinate*.zip'))), None) or raw / 'bts_master_coordinate' / 'T_MASTER_CORD.csv'
    return {r['AIRPORT_ID']: r for r in open_csv(src) if r['AIRPORT_IS_LATEST'] == '1'}

def load_regional_shares(raw):
    """Per month: shares of each regional operator's flights by the brand that sold them,
    per route and per operator overall (fallback for routes the file lacks)."""
    shares = {}
    for z in sorted(raw.glob('otp_mkt_*.zip')):
        m = re.match(r'otp_mkt_(\d{4})_(\d{2})\.zip', z.name)
        if not m:
            continue
        ym = f'{m[1]}-{m[2]}'
        route = collections.defaultdict(collections.Counter)
        carrier = collections.defaultdict(collections.Counter)
        for r in open_csv(z):
            if r['Cancelled'].startswith('1'):
                continue
            op = (r.get('Operating_Airline ') or r.get('Operating_Airline') or '').strip()
            mk = r['Marketing_Airline_Network'].strip()
            if op and mk and op != mk:
                route[(op, r['Origin'], r['Dest'])][mk] += 1
                carrier[op][mk] += 1
        norm = lambda c: {k: v / sum(c.values()) for k, v in c.items()}
        shares[ym] = ({k: norm(v) for k, v in route.items()}, {k: norm(v) for k, v in carrier.items()})
        print(f'  regional shares {ym}: {len(carrier)} operators', file=sys.stderr)
    return shares

def nearest(months, ym):
    key = lambda m: abs((int(m[:4]) * 12 + int(m[5:])) - (int(ym[:4]) * 12 + int(ym[5:])))
    return min(months, key=key)

# ---------------------------------------------------------------- names
NAMES = {
    'AA': 'American', 'DL': 'Delta', 'UA': 'United', 'WN': 'Southwest', 'AS': 'Alaska', 'B6': 'JetBlue',
    'F9': 'Frontier', 'G4': 'Allegiant', 'NK': 'Spirit', 'MX': 'Breeze', 'SY': 'Sun Country', 'XP': 'Avelo',
    '9K': 'Cape Air', 'GV': 'Grant Aviation', '9X': 'Mokulele', 'K2': 'Yute Commuter', '8E': 'Bering Air',
    'LF': 'Contour', 'KG': 'Denver Air Connection', 'M5': 'Kenmore Air', '8V': 'Wright Air', 'J5': 'Alaska Seaplanes',
    'AC': 'Air Canada', 'QK': 'Air Canada Jazz', 'RV': 'Air Canada Rouge', 'WS': 'WestJet', 'Y4': 'Volaris',
    'AM': 'Aeroméxico', 'BA': 'British Airways', 'CM': 'Copa', 'AV': 'Avianca', 'TA': 'Avianca El Salvador',
    'LH': 'Lufthansa', 'AF': 'Air France', 'VS': 'Virgin Atlantic', 'TK': 'Turkish Airlines', 'EI': 'Aer Lingus',
    'JL': 'Japan Airlines', 'NH': 'ANA', 'KE': 'Korean Air', 'FI': 'Icelandair', 'VB': 'VivaAerobus',
    'PD': 'Porter', 'P3': 'Porter', 'ZW': 'Air Wisconsin', '2NQ': 'Fly The Whale',
}

def clean_name(code, raw_name):
    if code in NAMES:
        return NAMES[code]
    n = raw_name
    m = re.search(r'\(([^)]+)\)\s*$', n)
    if m and not re.search(r'\b(PACL|PAI)\b', m[1]):
        n = m[1]
    m = re.search(r'\bd/?b/?a/?\s+(.+?)(\s+d/?b/?a.*)?$', n, re.I)
    if m:
        n = m[1]
    n = re.sub(r'\s*\b(Inc\.?|LLC|L\.L\.C\.|Co\.|Corp\.?|Corporation|Ltd\.?|Limited|Plc|LP|S\.?A\.?( de C\.?V\.?)?|A\.O\.)\s*$', '', n, flags=re.I)
    return re.sub(r'\s+', ' ', n).strip(' ,')

# ---------------------------------------------------------------- basemap
def basemap(atlas_path):
    topo = json.load(open(atlas_path))
    (sx, sy), (tx, ty) = topo['transform']['scale'], topo['transform']['translate']
    arcs = []
    for a in topo['arcs']:
        x = y = 0; pts = []
        for dx, dy in a:
            x += dx; y += dy; pts.append((x * sx + tx, y * sy + ty))
        arcs.append(pts)
    def ring(idx):
        out = []
        for i in idx:
            pts = arcs[i] if i >= 0 else arcs[~i][::-1]
            out.extend(pts if not out else pts[1:])
        return out
    def rdp(pts, eps):
        if len(pts) < 3:
            return pts
        (x1, y1), (x2, y2) = pts[0], pts[-1]
        dx, dy = x2 - x1, y2 - y1; L = math.hypot(dx, dy) or 1
        d = [abs(dy * (x - x1) - dx * (y - y1)) / L for x, y in pts[1:-1]]
        i = max(range(len(d)), key=d.__getitem__)
        return rdp(pts[:i + 2], eps)[:-1] + rdp(pts[i + 1:], eps) if d[i] > eps else [pts[0], pts[-1]]
    fips_region = {'02': 'AK', '15': 'HI', '72': 'PR', '78': 'VI'}
    sys.setrecursionlimit(20000)
    parts = []
    for g in topo['objects']['states']['geometries']:
        if g['id'] in ('60', '66', '69'):
            continue
        reg = fips_region.get(g['id'], 'US')
        for poly in (g['arcs'] if g['type'] == 'MultiPolygon' else [g['arcs']]):
            for rg in poly:
                pts = [project(la, lo, reg) for lo, la in ring(rg)]
                if pts[0] == pts[-1]:
                    pts = pts[:-1]
                if len(pts) < 3:
                    continue
                h = len(pts) // 2
                p = rdp(pts[:h + 1], 1.0)[:-1] + rdp(pts[h:], 1.0)
                if len(p) >= 3:
                    parts.append('M' + 'L'.join(f'{x:.0f} {y:.0f}' for x, y in p) + 'Z')
    return ''.join(parts)

# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--raw', default='data/raw'); ap.add_argument('--out', default='public/data')
    a = ap.parse_args(); raw, out = Path(a.raw), Path(a.out); out.mkdir(parents=True, exist_ok=True)

    mc = load_airports(raw)
    shares = load_regional_shares(raw)
    if not shares:
        sys.exit('no otp_mkt_YYYY_MM.zip files in ' + str(raw))

    flights = collections.defaultdict(float)   # (ym, o_id, d_id, brand) -> departures
    seats = collections.defaultdict(float)
    carrier_name, foreign, cgroup = {}, set(), {}
    fallback_months = set()
    t100 = sorted(raw.glob('t100_segment_all_*.zip'))
    for path in t100:
        for r in open_csv(path):
            if r['CLASS'] != 'F' or r['ORIGIN_COUNTRY'] != 'US' or float(r['SEATS'] or 0) == 0:
                continue
            o, d = mc.get(r['ORIGIN_AIRPORT_ID']), mc.get(r['DEST_AIRPORT_ID'])
            if o is None or d is None or o['AIRPORT_STATE_CODE'] in PACIFIC or d['AIRPORT_STATE_CODE'] in PACIFIC:
                continue
            c = r['UNIQUE_CARRIER']; carrier_name.setdefault(c, r['UNIQUE_CARRIER_NAME'])
            c = MERGE.get(c, c)
            if r['DATA_SOURCE'].endswith('F'):
                foreign.add(c)
            cgroup[c] = r['CARRIER_GROUP_NEW']
            ym = f"{r['YEAR']}-{int(r['MONTH']):02d}"
            sm = ym if ym in shares else nearest(list(shares), ym)
            if sm != ym:
                fallback_months.add((ym, sm))
            route_s, carrier_s = shares[sm]
            split = route_s.get((c, r['ORIGIN'], r['DEST'])) or carrier_s.get(c) or {c: 1.0}
            dep, st = float(r['DEPARTURES_PERFORMED'] or 0), float(r['SEATS'] or 0)
            for b, w in split.items():
                k = (ym, r['ORIGIN_AIRPORT_ID'], r['DEST_AIRPORT_ID'], b)
                flights[k] += dep * w; seats[k] += st * w
    for ym, sm in sorted(fallback_months):
        print(f'  WARNING {ym}: no marketing-carrier file, used {sm} shares', file=sys.stderr)

    months = sorted({k[0] for k in flights}); mi = {m: i for i, m in enumerate(months)}; M = len(months)

    # airports: US ones that appear, then foreign destinations; markets for the Cities view
    used = {k[1] for k in flights} | {k[2] for k in flights}
    us_ids = sorted((i for i in used if mc[i]['AIRPORT_COUNTRY_CODE_ISO'] == 'US'), key=lambda i: mc[i]['AIRPORT'])
    fx_ids = sorted((i for i in used if mc[i]['AIRPORT_COUNTRY_CODE_ISO'] != 'US'), key=lambda i: mc[i]['AIRPORT'])
    aidx = {i: n for n, i in enumerate(us_ids + fx_ids)}
    dep_by_ap = collections.Counter()
    for k, v in flights.items():
        dep_by_ap[k[1]] += v
    market_names, market_idx, mpos = [], {}, collections.defaultdict(lambda: [0.0, 0.0, 0.0])
    airports = []
    for i in us_ids:
        m = mc[i]; x, y = project(float(m['LATITUDE']), float(m['LONGITUDE']), region_of(m['AIRPORT_STATE_CODE']))
        mk = m['DISPLAY_CITY_MARKET_NAME_FULL'].replace(' (Metropolitan Area)', '')
        if mk not in market_idx:
            market_idx[mk] = len(market_names); market_names.append(mk)
        w = dep_by_ap[i] or 1e-6; p = mpos[mk]; p[0] += x * w; p[1] += y * w; p[2] += w
        airports.append({'c': m['AIRPORT'], 'n': m['DISPLAY_AIRPORT_NAME'], 'ci': m['DISPLAY_AIRPORT_CITY_NAME_FULL'],
                         'mk': market_idx[mk], 'x': round(x, 1), 'y': round(y, 1)})
    for i in fx_ids:
        m = mc[i]
        airports.append({'c': m['AIRPORT'], 'n': m['DISPLAY_AIRPORT_NAME'], 'ci': m['DISPLAY_AIRPORT_CITY_NAME_FULL'], 'f': 1})
    markets = [{'n': n, 'x': round(mpos[n][0] / mpos[n][2], 1), 'y': round(mpos[n][1] / mpos[n][2], 1)} for n in market_names]

    # brands, ordered by total departures
    btot = collections.Counter()
    for k, v in flights.items():
        btot[k[3]] += v
    group = lambda c: 'foreign' if c in foreign else ('us' if cgroup.get(c) in ('2', '3') else 'regional')
    blist = [b for b, _ in btot.most_common() if btot[b] >= 1]
    bidx = {b: n for n, b in enumerate(blist)}
    brands = [{'c': b, 'n': clean_name(b, carrier_name.get(b, b)), 'g': group(b)} for b in blist]

    # tier 1: origin airport x brand x month (exact flights and seats)
    s_f = collections.defaultdict(lambda: [0.0] * M); s_s = collections.defaultdict(lambda: [0.0] * M)
    for (ym, o, d, b), v in flights.items():
        if b in bidx:
            s_f[(aidx[o], bidx[b])][mi[ym]] += v; s_s[(aidx[o], bidx[b])][mi[ym]] += seats[(ym, o, d, b)]
    skeys = sorted(k for k in s_f if round(sum(s_f[k])) >= 1)
    summary = {'k': [list(k) for k in skeys],
               'f': [[round(v) for v in s_f[k]] for k in skeys],
               's': [[round(v) for v in s_s[k]] for k in skeys]}

    # tier 2: route x brand x month; seats as seats per flight
    r_f = collections.defaultdict(lambda: [0.0] * M); r_s = collections.defaultdict(lambda: [0.0] * M)
    for (ym, o, d, b), v in flights.items():
        if b in bidx:
            k = (aidx[o], aidx[d], bidx[b]); r_f[k][mi[ym]] += v; r_s[k][mi[ym]] += seats[(ym, o, d, b)]
    rkeys = sorted(k for k in r_f if any(round(v) >= 1 for v in r_f[k]))
    routes = {'k': [list(k) for k in rkeys],
              'f': [[round(v) for v in r_f[k]] for k in rkeys],
              'r': [[round(r_s[k][m] / r_f[k][m]) if r_f[k][m] >= 0.5 else 0 for m in range(M)] for k in rkeys]}

    meta = {'months': months, 'W': W, 'H': H, 'nUS': len(us_ids), 'airports': airports, 'markets': markets, 'brands': brands,
            'source': 'BTS T-100 Segment (All Carriers); regional flights credited to the selling brand using BTS Marketing Carrier On-Time data'}
    dump = lambda name, obj: (out / name).write_text(json.dumps(obj, separators=(',', ':'), ensure_ascii=False))
    dump('meta.json', meta); dump('summary.json', summary); dump('routes.json', routes)
    dump('basemap.json', {'d': basemap(next(iter(sorted(raw.glob('us-atlas-states-10m.json')))))})
    for f in sorted(out.glob('*.json')):
        print(f'  {f.name}: {f.stat().st_size / 1e6:.2f} MB', file=sys.stderr)
    print(f'  {M} months, {len(us_ids)} US airports, {len(fx_ids)} foreign, {len(brands)} brands, '
          f'{len(skeys)} airport-brand pairs, {len(rkeys)} route-brand pairs', file=sys.stderr)

if __name__ == '__main__':
    main()
