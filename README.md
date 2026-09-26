# Who Flies Where

Which airlines serve which US airports, and where you can fly nonstop from any airport or city. Toggle airlines on and off, scrub by month,
switch between airports and metro areas, and see the routes flown from any airport or city.

Data: US DOT Bureau of Transportation Statistics.

- **T-100 Segment (All Carriers)** gives every nonstop route touching a US airport, by operating
  airline and month: scheduled passenger service only (class F).
- **Marketing Carrier On-Time Performance** credits regional flights (SkyWest, Republic, Envoy…)
  to the brand that sold them, using each month's own route-by-route shares.
- **Master Coordinate** gives airport positions and city markets. The basemap is
  [us-atlas](https://github.com/topojson/us-atlas) `states-10m`.

Hawaiian is merged into Alaska. Guam, Saipan and American Samoa are left off.

BTS data is a US government work in the public domain. The basemap is derived from us-atlas,
© Mike Bostock, [ISC license](https://github.com/topojson/us-atlas/blob/master/LICENSE), itself built from US Census Bureau cartographic boundaries.

## Commands

```bash
npm install
npm run data      # rebuild public/data/ from data/raw/ (Python 3, standard library only)
npm run dev       # local server
npm run build     # static site in dist/ (SITE_URL=https://your.host/path/ for link-preview URLs)
```

## Raw data (`data/raw/`, not committed)

| File | Source |
|---|---|
| `t100_segment_all_<year>.zip` | TranStats → T-100 Segment (All Carriers), all fields, one year per file |
| `otp_mkt_<yyyy>_<mm>.zip` | `https://www.transtats.bts.gov/PREZIP/On_Time_Marketing_Carrier_On_Time_Performance_Beginning_January_2018_<yyyy>_<m>.zip` |
| `bts_master_coordinate.zip` | TranStats → Aviation Support Tables → Master Coordinate |
| `us-atlas-states-10m.json` | `https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json` |

A month without an on-time file falls back to the nearest month's regional shares; the build
prints a warning when that happens.

## Output (`public/data/`)

| File | Contents | Loaded |
|---|---|---|
| `meta.json` | months, airports (pre-projected x/y), city markets, airlines and their groups | at start |
| `summary.json` | origin airport × airline: monthly departures | at start |
| `basemap.json` | state outlines as one pre-projected SVG path | at start |
| `routes.json` | route × airline: monthly departures | by the origin view |
