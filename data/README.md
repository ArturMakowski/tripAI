# Seed data (`data/`)

Committed JSON snapshots used offline by scoring and the API. Each file has a top-level
`meta` with `source`, `fetched_at` (UTC), and the `generator` command that rebuilds it.
Read the files through `tripai.seed.load` rather than parsing the JSON yourself.

| File | Built by (`cd backend`) | Source | What it holds |
|---|---|---|---|
| `cities.json` | `uv run python -m tripai.seed.cities` | hand-curated | 36 cities: IATA codes plus all airports, lat/lon, NUTS2 code, `direct_from` (KRK/KTW/WAW/GDN, approximate), 8 taste tags (`food history art beach nature hiking nightlife ski`) weighted 0..1 |
| `crowds.json` | `uv run python -m tripai.seed.crowds` | Eurostat `tour_occ_nin2m` (live API) | Jan..Dec `score` (min-max per city: 0 = quietest, 1 = busiest), `peak_ratio`, mean monthly `nights` over the last 3 complete years |
| `holidays.json` | `uv run python -m tripai.seed.holidays` | Nager.Date, OpenHolidays, MEN | public holidays 2026–27 (PL + 20 destination countries), PL long weekends with bridge days, PL school breaks 2026/27 with **ferie per voivodeship**, destination school holidays |
| `attractions.json` | `uv run python -m tripai.seed.attractions` | Wikidata SPARQL | top 8 per city: tags, popularity (Wikipedia sitelinks), Wikipedia/Wikidata URL, Commons image |

Run `cities` first, because the other three scripts read `cities.json`. A failed fetch exits
non-zero and leaves the committed file untouched; for attractions, a failed city keeps its
previous entry.

```python
from datetime import date
from tripai.seed import load

load.city("CIA").name                       # "Rome" (lookup by id, IATA or any airport)
load.crowd_score("rome", 1)                 # 0.0
load.crowd_evidence("rome", 1)              # tripai.models.Evidence (source + fetched_at)
load.school_breaks(airport="KRK")           # includes ferie 15–28 Feb 2027 (małopolskie)
load.crowd_flags("rome", date(2027, 4, 24), date(2027, 4, 26))  # ["Liberation Day (IT, ...)"]
load.attractions("catania", tags=profile.interests, limit=3)
```

## Caveats and fallbacks
- **Crowds**: the data is regional (NUTS2), not city-level. For example, Málaga uses all of
  Andalucía, and Split and Dubrovnik share HR03. Iceland uses country-level `tour_occ_nim`
  because the regional series stops in 2023. London has no Eurostat data after Brexit, so it
  uses a `proxy`: the mean profile of FR10, NL32 and IE06, with `geo_level: "proxy"`.
  `score` is relative within one city's own year: Tenerife's quietest month (May) scores 0 even
  though May is busy in absolute terms. For "−X% vs peak" evidence, use `peak_ratio`.
- **Ferie 2027**: the dates are hard-coded from the MEN 2026/27 school-year schedule (I tura
  18–31 Jan, II tura 1–14 Feb, III tura 15–28 Feb). OpenHolidays disagrees: it swaps śląskie and
  świętokrzyskie and leaves out lubuskie. The mismatch is recorded in
  `meta.ferie_crosscheck_vs_openholidays`, and the MEN schedule wins.
- **Attractions**: these come from Wikidata, not OSM Overpass or OpenTripMap. Overpass mirrors
  timed out from our network, OSM has no popularity signal, and OpenTripMap needs a key and is
  itself built on OSM + Wikidata. Popularity means the number of Wikipedia language editions,
  not visitor numbers. Attribution: Wikidata (CC0), Wikipedia (CC BY-SA 4.0), Commons images
  (licence per file).
- City tag weights and `direct_from` are editorial priors. Prices and routes come from the
  connectors.
