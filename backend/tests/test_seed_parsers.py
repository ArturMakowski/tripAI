"""Pure parsing/normalisation logic of the seed scripts, on tiny inline payloads (offline)."""

import httpx

from tripai.seed import attractions, crowds, holidays


def _jsonstat(ids, cats, values):
    return {
        "id": ids,
        "size": [len(c) for c in cats],
        "dimension": {
            d: {"category": {"index": {code: i for i, code in enumerate(c)}}}
            for d, c in zip(ids, cats, strict=True)
        },
        "value": {str(k): v for k, v in values.items()},
    }


def test_regional_layout_year_plus_month_dimension():
    months = ["TOTAL"] + [f"M{m:02d}" for m in range(1, 13)]
    doc = _jsonstat(
        ["unit", "month", "geo", "time"],
        [["NR"], months, ["XX01"], ["2024"]],
        {i: (999 if i == 0 else i * 10) for i in range(13)},  # flat index == month index
    )
    series = crowds.monthly_series(crowds.parse_jsonstat(doc))
    assert series["XX01"][(2024, 1)] == 10 and (2024, 0) not in series["XX01"]
    p = crowds.profile(series["XX01"])
    assert p["years"] == [2024]
    assert p["score"][0] == 0 and p["score"][11] == 1
    assert p["peak_ratio"][5] == 0.5


def test_national_layout_yyyy_mm_and_incomplete_years_dropped():
    times = [f"2024-{m:02d}" for m in range(1, 13)] + ["2025-01"]
    doc = _jsonstat(["geo", "time"], [["IS"], times], {i: 100 + i for i in range(13)})
    p = crowds.profile(crowds.monthly_series(crowds.parse_jsonstat(doc))["IS"])
    assert p["years"] == [2024] and p["nights"][0] == 100


def test_proxy_profile_is_mean_of_regions():
    london = {"id": "london", "iata": "STN", "nuts2": "UKI"}
    assert crowds.build([london], {}, {}) == []  # no proxy inputs → city skipped, not invented
    series = {(2024, m): float(m) for m in range(1, 13)}
    regional = {g: series for g in crowds.PROXIES["UKI"]}
    lagging = crowds.PROXIES["UKI"][-1]
    regional[lagging] = {**series, **{(2023, m): 1.0 for m in range(1, 13)}}
    regional[crowds.PROXIES["UKI"][0]] = {(2025, m): 1.0 + m for m in range(1, 13)} | series
    [row] = crowds.build([london], regional, {})
    assert row["geo_level"] == "proxy" and row["nights"] is None
    assert row["score"][0] == 0 and row["score"][11] == 1
    assert row["years"] == [2024]  # only years every proxy region has


def test_classify_attraction_types():
    assert attractions.classify(["Roman amphitheatre", "archaeological site"]) == ["history"]
    assert attractions.classify(["comune of Italy"]) is None
    assert attractions.classify(["statue", "archaeological artefact"]) is None
    assert attractions.classify(["square"]) == []  # generic attraction, no tag
    assert "nature" in attractions.classify(["stratovolcano"])
    assert attractions.classify(["market town"]) is None


def test_parse_bindings_skips_destination_itself_and_ranks():
    def b(qid, name, sl, types):
        return {
            "item": {"value": f"http://www.wikidata.org/entity/{qid}"},
            "itemLabel": {"value": name},
            "lat": {"value": "1"},
            "lon": {"value": "2"},
            "sl": {"value": str(sl)},
            "types": {"value": "|".join(types)},
        }

    city = {"name": "Valletta (Malta)", "country_name": "Malta"}
    rows = attractions.parse(
        [
            b("Q1", "Malta", 300, ["island"]),
            b("Q2", "Grand Harbour", 50, ["harbour"]),
            b("Q3", "St. John's Co-Cathedral", 80, ["cathedral"]),
            b("Q3", "St. John's Co-Cathedral", 80, ["cathedral"]),
        ],
        city,
    )
    assert [r["wikidata"] for r in rows] == ["Q3", "Q2"]
    assert rows[1]["url"] == "https://www.wikidata.org/wiki/Q2"


def test_men_ferie_cover_all_voivodeships_and_crosscheck():
    breaks = holidays.pl_school_breaks()
    assert sum(b["kind"] == "ferie" for b in breaks) == 3
    oh = [{"start": s, "end": e, "regions": list(rs)} for s, e, rs in holidays.FERIE_2027]
    assert holidays.ferie_mismatches(oh) == []
    oh[1]["regions"] = ["PL-08", "PL-14", "PL-22", "PL-26"]  # lubuskie instead of lubelskie
    [issue] = holidays.ferie_mismatches(oh)
    assert "adds [lubuskie], lacks [lubelskie]" in issue


def test_openholidays_codes_translated_to_iso():
    """OpenHolidays' PL-SK is śląskie (ISO PL-24), not świętokrzyskie: never compare raw codes."""
    subdivisions = [
        {"code": "PL-SK", "isoCode": "PL-24", "children": []},
        {"code": "FR-ZC", "isoCode": None, "children": [{"code": "X-1", "isoCode": "X-01"}]},
    ]
    transport = httpx.MockTransport(lambda req: httpx.Response(200, json=subdivisions))
    with httpx.Client(transport=transport) as http:
        iso = holidays.openholidays_iso_codes(http, "PL")
    assert iso == {"PL-SK": "PL-24", "FR-ZC": "FR-ZC", "X-1": "X-01"}
