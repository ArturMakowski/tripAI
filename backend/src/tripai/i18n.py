"""User-facing language (pl | en) for every text the backend writes.

The API resolves the language per request (`lang` body field, else `Accept-Language`, else en)
and sets it in a ContextVar, so deep helpers (scoring texts, templates, LLM prompts) follow it
without threading a parameter through every call. Every public text producer also takes an
explicit `lang=` that wins over the context (tests and background jobs use that).

Numbers are formatted the way each language writes them; the grounding guards accept both
(`1 098 zł`, `18,5 °C`, `1098 PLN`, `18.5 °C`).
"""

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import date
from typing import Literal

Lang = Literal["en", "pl"]
LANGS: tuple[Lang, ...] = ("en", "pl")
DEFAULT_LANG: Lang = "en"

_current: ContextVar[Lang] = ContextVar("tripai_lang", default=DEFAULT_LANG)


def normalise(value: str | None) -> Lang | None:
    """'pl', 'pl-PL', 'PL_pl' -> 'pl'; unknown -> None."""
    if not value:
        return None
    code = value.strip().lower().replace("_", "-").split("-")[0]
    return code if code in LANGS else None  # type: ignore[return-value]


def from_accept_language(header: str | None) -> Lang | None:
    """Best supported language from an Accept-Language header (q-values respected)."""
    if not header:
        return None
    best: tuple[float, int, Lang] | None = None
    for i, part in enumerate(header.split(",")):
        bits = part.strip().split(";")
        lang = normalise(bits[0])
        if lang is None:
            continue
        q = 1.0
        for b in bits[1:]:
            k, _, v = b.strip().partition("=")
            if k == "q":
                try:
                    q = float(v)
                except ValueError:
                    q = 0.0
        if q > 0 and (best is None or (q, -i) > (best[0], best[1])):
            best = (q, -i, lang)
    return best[2] if best else None


def resolve(explicit: str | None, accept_language: str | None = None) -> Lang:
    """Body `lang` wins, then Accept-Language, then English."""
    return normalise(explicit) or from_accept_language(accept_language) or DEFAULT_LANG


def current() -> Lang:
    return _current.get()


def pick(lang: str | None) -> Lang:
    """Explicit language if valid, else the request's."""
    return normalise(lang) or current()


def set_current(lang: Lang) -> None:
    _current.set(lang)


@contextmanager
def using(lang: Lang) -> Iterator[None]:
    token = _current.set(lang)
    try:
        yield
    finally:
        _current.reset(token)


# ---------------------------------------------------------------- formatting

MONTHS = {
    "en": ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    "pl": ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paź", "lis", "gru"],
}
MONTHS_LONG = {
    "en": ["January", "February", "March", "April", "May", "June", "July", "August",
           "September", "October", "November", "December"],
    "pl": ["styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec", "lipiec", "sierpień",
           "wrzesień", "październik", "listopad", "grudzień"],
}  # fmt: skip
# "in <month>" (Polish locative: "w lipcu"); English keeps the short name ("in Jul")
MONTHS_IN = {
    "en": MONTHS["en"],
    "pl": ["styczniu", "lutym", "marcu", "kwietniu", "maju", "czerwcu", "lipcu", "sierpniu",
           "wrześniu", "październiku", "listopadzie", "grudniu"],
}  # fmt: skip
DAYS = {
    "en": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    "pl": ["pon", "wt", "śr", "czw", "pt", "sob", "niedz"],
}
NBSP = " "


def month(m: int, lang: str | None = None) -> str:
    return MONTHS[pick(lang)][m - 1]


def month_in(m: int, lang: str | None = None) -> str:
    """Month after 'in': 'Jul' / 'lipcu' (as in 'w lipcu')."""
    return MONTHS_IN[pick(lang)][m - 1]


def month_long(m: int, lang: str | None = None) -> str:
    return MONTHS_LONG[pick(lang)][m - 1]


def fmt_int(v: float, lang: str | None = None) -> str:
    """1098 -> '1098' (en) / '1 098' (pl, non-breaking space)."""
    n = round(v)
    if pick(lang) == "pl" and abs(n) >= 1000:
        return f"{n:,}".replace(",", NBSP)
    return str(n)


def fmt_dec(v: float, lang: str | None = None, digits: int = 1) -> str:
    """18.5 -> '18.5' / '18,5'; 18.0 -> '18'."""
    s = f"{round(v, digits):g}"
    return s.replace(".", ",") if pick(lang) == "pl" else s


def fmt_pln(v: float, lang: str | None = None) -> str:
    return f"{fmt_int(v, lang)} zł" if pick(lang) == "pl" else f"{round(v)} PLN"


def fmt_temp(v: float, lang: str | None = None) -> str:
    return f"{fmt_dec(v, lang)} °C"


def fmt_day(d: date, lang: str | None = None) -> str:
    """'Fri 28 May' / 'pt 28 maj'."""
    lg = pick(lang)
    return f"{DAYS[lg][d.weekday()]} {d.day} {MONTHS[lg][d.month - 1]}"


def fmt_dates(start: date, end: date, lang: str | None = None) -> str:
    """'1–3 Jan', '30 Dec–2 Jan', '1 Jan' (pl: '1–3 sty')."""
    lg = pick(lang)
    s_m, e_m = MONTHS[lg][start.month - 1], MONTHS[lg][end.month - 1]
    if start == end:
        return f"{start.day} {s_m}"
    if (start.year, start.month) == (end.year, end.month):
        return f"{start.day}–{end.day} {s_m}"
    return f"{start.day} {s_m}–{end.day} {e_m}"


def plural_pl(n: int, one: str, few: str, many: str) -> str:
    """Polish plural: 1 dzień, 2-4 dni, 5+ dni (with 12-14 as 'many')."""
    if n == 1:
        return one
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return few
    return many


# ---------------------------------------------------------------- messages


def t(key: str, lang: str | None = None, /, **kw: object) -> str:
    """Message `key` in the given/current language, formatted with `kw`."""
    lg = pick(lang)
    table = MESSAGES[key]
    return table.get(lg, table["en"]).format(**kw)


def llm_language_rule(lang: str | None = None) -> str:
    """Appended to LLM prompts: which language to write the user-facing text in."""
    if pick(lang) == "pl":
        return (
            "LANGUAGE: write every user-facing sentence in Polish (natural, informal 'ty' form). "
            "Write prices as in the evidence display strings (e.g. '1 098 zł'), decimals with a "
            "comma (18,5 °C)."
        )
    return "LANGUAGE: write every user-facing sentence in English."


MESSAGES: dict[str, dict[str, str]] = {
    # ---- scoring: counterfactuals, flip, interest filter
    "cf.cheaper": {"en": "{amount} ({pct}%) cheaper", "pl": "{amount} ({pct}%) taniej"},
    "cf.pricier": {"en": "{amount} ({pct}%) more expensive", "pl": "{amount} ({pct}%) drożej"},
    "cf.line": {
        "en": "{cost} than {label}; score {pts} pts",
        "pl": "{cost} niż {label}; wynik {pts} pkt",
    },
    "cf.peak": {
        "en": "same trip in {month} (peak season)",
        "pl": "ten sam wyjazd w {month} (szczyt sezonu)",
    },
    "cf.next_window": {"en": "next-best window {dates}", "pl": "następny najlepszy termin {dates}"},
    "cf.runner_up": {"en": "runner-up {city} {dates}", "pl": "drugie miejsce: {city} {dates}"},
    "flip.weight": {"en": "{factor} weight {a} -> {b}", "pl": "waga „{factor}” {a} -> {b}"},
    "flip.price": {"en": "{city} costing {amount} more", "pl": "{city} droższe o {amount}"},
    "flip.or": {"en": " or ", "pl": " albo "},
    "flip.text": {
        "en": "{lo} would overtake {hi} with: {parts}",
        "pl": "{lo} wyprzedziłoby {hi}, gdyby: {parts}",
    },
    "flip.none": {
        "en": "No single weight or price change makes {lo} overtake {hi}",
        "pl": "Żadna pojedyncza zmiana wagi ani ceny nie sprawi, że {lo} wyprzedzi {hi}",
    },
    "factor.price": {"en": "price", "pl": "cena"},
    "factor.weather": {"en": "weather", "pl": "pogoda"},
    "factor.crowds": {"en": "crowds", "pl": "tłumy"},
    "factor.taste": {"en": "taste", "pl": "gust"},
    "filter.none_set": {
        "en": "Personalisation is off and no interests are set, so nothing was filtered.",
        "pl": "Personalizacja jest wyłączona i nie masz zainteresowań, więc nic nie odfiltrowano.",
    },
    "filter.applied": {
        "en": "Personalisation is off: showing only cities matching your interests ({liked}); "
        "filtered out: {dropped}.",
        "pl": "Personalizacja jest wyłączona: pokazujemy tylko miasta pasujące do Twoich "
        "zainteresowań ({liked}); odfiltrowane: {dropped}.",
    },
    "filter.no_match": {
        "en": "Personalisation is off: no city matches your interests ({liked}), so none were "
        "filtered.",
        "pl": "Personalizacja jest wyłączona: żadne miasto nie pasuje do Twoich zainteresowań "
        "({liked}), więc nic nie odfiltrowano.",
    },
    "filter.all_match": {
        "en": "Personalisation is off: every city matches your interests ({liked}).",
        "pl": "Personalizacja jest wyłączona: każde miasto pasuje do Twoich zainteresowań ({liked}).",
    },
    # ---- długi weekend radar
    "radar.leave": {
        "en": "Take {n} day{s} off ({days}) -> {total} days: {start} - {end} ({names})",
        "pl": "Weź {n} {dni_wolnego} ({days}) → {total} dni: {start} – {end} ({names})",
    },
    "radar.free": {
        "en": "{total} days off with no leave: {start} - {end} ({names})",
        "pl": "{total} dni wolnego bez urlopu: {start} – {end} ({names})",
    },
    # ---- explain template
    "why.cost": {
        "en": "{city}, {dates}: about {total} in total (flight {flight}, hotel {hotel}).",
        "pl": "{city}, {dates}: ok. {total} łącznie (lot {flight}, hotel {hotel}).",
    },
    "why.peak": {
        "en": "That is {amount} cheaper than the same trip in peak season.",
        "pl": "To {amount} taniej niż ten sam wyjazd w szczycie sezonu.",
    },
    "why.expect": {"en": "Expect {parts}.", "pl": "Spodziewaj się: {parts}."},
    "why.temp": {"en": "around {temp}", "pl": "ok. {temp}"},
    "why.crowds": {"en": "crowds at {crowds}", "pl": "tłumy na poziomie {crowds}"},
    "why.with": {"en": ", with ", "pl": ", "},
    "why.matches": {"en": "Matches your love of {tags}.", "pl": "Pasuje do Twoich pasji: {tags}."},
    "why.highlights": {"en": "Highlights: {items}.", "pl": "Warto zobaczyć: {items}."},
    "disp.crowd": {"en": "{pct}% of peak", "pl": "{pct}% szczytu"},
    "disp.rain": {"en": "{pct}% of days", "pl": "{pct}% dni"},
    # ---- fit verdict
    "fit.neutral_prefix": {
        "en": "Neutral check (personalisation off): ",
        "pl": "Neutralna ocena (personalizacja wyłączona): ",
    },
    "fit.unsure_prefix": {
        "en": "We're not sure about this one; here's why: ",
        "pl": "Nie jesteśmy tu pewni; oto dlaczego: ",
    },
    "fit.label.great_fit": {"en": "A great fit for you", "pl": "Świetnie do Ciebie pasuje"},
    "fit.label.good_fit": {"en": "A good fit for you", "pl": "Dobrze do Ciebie pasuje"},
    "fit.label.mixed": {"en": "A mixed fit for you", "pl": "Pasuje tylko częściowo"},
    "fit.label.poor_fit": {"en": "Probably not your style", "pl": "Raczej nie w Twoim stylu"},
    "fit.watch_out": {"en": "watch out", "pl": "uwaga"},
    "fit.r.crowds_bad": {
        "en": "Peak tourist crowds, and you prefer to avoid them",
        "pl": "Szczyt turystycznych tłumów, a wolisz ich unikać",
    },
    "fit.r.crowds_good": {
        "en": "Quiet season, away from the crowds you avoid",
        "pl": "Spokojny sezon, z dala od tłumów, których unikasz",
    },
    "fit.r.party": {
        "en": "Known for {tags}, but you travel to rest",
        "pl": "Słynie z: {tags}, a Ty podróżujesz, żeby odpocząć",
    },
    "fit.r.rest": {"en": "Good for rest: {tags}", "pl": "Dobre na odpoczynek: {tags}"},
    "fit.r.hot": {"en": "Hotter than you like", "pl": "Cieplej, niż lubisz"},
    "fit.r.weather_far": {
        "en": "Weather well outside your comfort range",
        "pl": "Pogoda daleko poza Twoim zakresem komfortu",
    },
    "fit.r.weather_ok": {
        "en": "Weather in your comfort range",
        "pl": "Pogoda w Twoim zakresie komfortu",
    },
    "fit.r.cheap_bad_weather": {
        "en": "Cheap partly because the weather is poor then",
        "pl": "Tanio m.in. dlatego, że pogoda jest wtedy słaba",
    },
    "fit.r.expensive": {
        "en": "Expensive for someone price-driven",
        "pl": "Drogo jak na kogoś, dla kogo liczy się cena",
    },
    "fit.r.good_price": {
        "en": "A genuinely good price, which matters to you",
        "pl": "Naprawdę dobra cena, a to dla Ciebie ważne",
    },
    "fit.r.culture": {
        "en": "Strong local food and culture",
        "pl": "Świetna lokalna kuchnia i kultura",
    },
    "fit.r.no_culture": {
        "en": "Not much of a food and culture destination",
        "pl": "Niezbyt kulinarny ani kulturalny kierunek",
    },
    "fit.r.active": {
        "en": "Plenty to do actively outdoors",
        "pl": "Dużo aktywności na świeżym powietrzu",
    },
    "fit.r.novelty": {
        "en": "Enough sights for something new each day",
        "pl": "Dość atrakcji, by każdego dnia odkryć coś nowego",
    },
    "fit.c.crowd_conflict": {
        "en": "Busy tourist period, and you prefer to avoid crowds",
        "pl": "Gorący okres turystyczny, a wolisz unikać tłumów",
    },
    "fit.c.relax_conflict": {
        "en": "Known more for buzz than for rest, and you travel to unwind",
        "pl": "Bardziej gwarno niż spokojnie, a jedziesz odpocząć",
    },
    "fit.c.budget_conflict": {
        "en": "Pricey for someone price-driven",
        "pl": "Drogo jak na kogoś, dla kogo liczy się cena",
    },
    "fit.c.weather_conflict": {
        "en": "Weather outside your comfort range",
        "pl": "Pogoda poza Twoim zakresem komfortu",
    },
    "fit.c.pace_conflict": {
        "en": "Few concrete sights to plan your days around",
        "pl": "Mało konkretnych atrakcji, wokół których da się zaplanować dni",
    },
    "fit.c.culture_match": {
        "en": "Strong local food and culture",
        "pl": "Świetna lokalna kuchnia i kultura",
    },
    "fit.c.active_match": {
        "en": "Plenty to do actively outdoors",
        "pl": "Dużo aktywności na świeżym powietrzu",
    },
    "fit.c.novelty_match": {
        "en": "Enough sights for something new each day",
        "pl": "Dość atrakcji, by każdego dnia odkryć coś nowego",
    },
    # ---- feedback
    "fb.off": {
        "en": "Personalisation is off (your choice in Travel DNA), so feedback does not change "
        "your profile or weights.",
        "pl": "Personalizacja jest wyłączona (Twój wybór w DNA Podróżnika), więc opinia nie "
        "zmienia Twojego profilu ani wag.",
    },
    "fb.loved": {"en": "you loved {tag} on {trip}", "pl": "{tag} bardzo Ci się podobało w: {trip}"},
    "fb.disliked": {"en": "you disliked {tag}", "pl": "nie spodobało Ci się: {tag}"},
    "fb.rated": {"en": "{what} rated {r}/5 on {trip}", "pl": "{what}: ocena {r}/5 w: {trip}"},
    "fb.crowds_one": {"en": "crowds rated 1/5", "pl": "tłumy oceniono na 1/5"},
    "fb.weather_narrow": {
        "en": "weather rated {r}/5 at {temp}",
        "pl": "pogodę oceniono na {r}/5 przy {temp}",
    },
    "fb.renorm": {
        "en": "re-normalised after another weight changed",
        "pl": "przeliczona po zmianie innej wagi",
    },
    "fb.this_trip": {"en": "this trip", "pl": "tym wyjeździe"},
    # ---- notifications
    "n.cost": {
        "en": "{total} total (flight {flight} + hotel {hotel}), score {pts}/100",
        "pl": "{total} łącznie (lot {flight} + hotel {hotel}), wynik {pts}/100",
    },
    "n.new_top.title": {"en": "New #1: {city}, {dates}", "pl": "Nowe #1: {city}, {dates}"},
    "n.new_top.prev": {"en": " Previous #1: {city}.", "pl": " Poprzednie #1: {city}."},
    "n.drop.title": {
        "en": "Price drop: {city} {dates} -{pct}%",
        "pl": "Spadek ceny: {city} {dates} -{pct}%",
    },
    "n.drop.body": {
        "en": "Now {now}, was {was} when you saved it (flight {flight} + hotel {hotel}).",
        "pl": "Teraz {now}, przy zapisaniu było {was} (lot {flight} + hotel {hotel}).",
    },
    "n.lw.title": {"en": "Długi weekend: {city}, {dates}", "pl": "Długi weekend: {city}, {dates}"},
    "lux.budget": {"en": "budget", "pl": "budżetowy"},
    "lux.standard": {"en": "standard", "pl": "standardowy"},
    "lux.comfort": {"en": "comfort", "pl": "komfortowy"},
    "lux.luxury": {"en": "luxury", "pl": "luksusowy"},
    # ---- Travel DNA reasons
    "dna.gesture.1": {"en": "Not me", "pl": "Nie ja"},
    "dna.gesture.2": {"en": "Rather not", "pl": "Raczej nie"},
    "dna.gesture.3": {"en": "Depends", "pl": "Zależy"},
    "dna.gesture.4": {"en": "That's me", "pl": "To ja"},
    "dna.gesture.5": {"en": "So me", "pl": "Bardzo ja!"},
    "dna.swiped": {"en": "{gesture} on {card}", "pl": "„{gesture}” przy {card}"},
    "dna.no_answer": {
        "en": "no answer on {card} (counted as Depends)",
        "pl": "brak odpowiedzi przy {card} (liczone jako „Zależy”)",
    },
    "dna.weight": {
        "en": "{factor} weight {v} because you swiped {sw}",
        "pl": "waga „{factor}” {v}, bo Twoje odpowiedzi: {sw}",
    },
    "dna.weight_neutral": {
        "en": "{factor} weight {v}: neutral default, because you chose not to tailor "
        "recommendations to your style",
        "pl": "waga „{factor}” {v}: neutralna domyślna, bo nie chcesz dopasowywać rekomendacji "
        "do swojego stylu",
    },
    "dna.filter_role": {
        "en": " (used only as a filter, not for ranking)",
        "pl": " (tylko jako filtr, nie do rankingu)",
    },
    "dna.interest": {
        "en": "{tag} {v}{role} because you swiped {sw}",
        "pl": "{tag} {v}{role}, bo Twoje odpowiedzi: {sw}",
    },
    "dna.crowds": {
        "en": "avoiding crowds because you swiped {sw}",
        "pl": "unikasz tłumów, bo Twoje odpowiedzi: {sw}",
    },
    "dna.luxury": {
        "en": "{level} comfort level because you swiped {sw}",
        "pl": "poziom komfortu {level}, bo Twoje odpowiedzi: {sw}",
    },
    "dna.pace.structured": {"en": "structured", "pl": "zaplanowane"},
    "dna.pace.spontaneous": {"en": "spontaneous", "pl": "spontaniczne"},
    "dna.pace.balanced": {"en": "balanced", "pl": "zrównoważone"},
    "dna.pace": {
        "en": "{label} pace because you swiped {sw}",
        "pl": "tempo {label}, bo Twoje odpowiedzi: {sw}",
    },
    "dna.novelty": {
        "en": "novelty {v} because you swiped {sw}",
        "pl": "chęć nowości {v}, bo Twoje odpowiedzi: {sw}",
    },
    "dna.daily_yes": {
        "en": "a new attraction every day because you answered Yes on y1",
        "pl": "codziennie nowa atrakcja, bo przy y1 odpowiedź: Tak",
    },
    "dna.daily_no": {
        "en": "no need for something new every day because you answered No on y1",
        "pl": "nie musisz co dzień odkrywać czegoś nowego, bo przy y1 odpowiedź: Nie",
    },
    "dna.personalize_on": {
        "en": "recommendations tailored to your style; post-trip feedback updates your profile",
        "pl": "rekomendacje dopasowane do Twojego stylu; opinie po podróży aktualizują profil",
    },
    "dna.personalize_off": {
        "en": "neutral ranking; post-trip feedback will not change your profile (your choice on "
        "y2)",
        "pl": "neutralny ranking; opinie po podróży nie zmienią Twojego profilu (Twój wybór przy "
        "y2)",
    },
    # ---- Travel DNA cards (docs/TRAVEL_DNA.md) + chat follow-ups
    "card.q1": {
        "en": "I love discovering places I don't know yet.",
        "pl": "Lubię odkrywać miejsca, których jeszcze nie znam.",
    },
    "card.q2": {
        "en": "I prefer every travel day to be planned.",
        "pl": "Podczas podróży wolę mieć zaplanowany każdy dzień.",
    },
    "card.q3": {
        "en": "I like changing plans spontaneously.",
        "pl": "Lubię spontanicznie zmieniać plany podczas podróży.",
    },
    "card.q4": {
        "en": "Experiences matter more to me than comfort.",
        "pl": "Ważniejsze są dla mnie doświadczenia niż komfort.",
    },
    "card.q5": {
        "en": "I'm keen on local food and culture.",
        "pl": "Chętnie poznaję lokalną kuchnię i kulturę.",
    },
    "card.q6": {
        "en": "Above all I look for rest and relaxation.",
        "pl": "Szukam przede wszystkim odpoczynku i relaksu.",
    },
    "card.q7": {
        "en": "I like being active (hiking, cycling, water).",
        "pl": "Lubię aktywnie spędzać czas (pieszo, rower, woda).",
    },
    "card.q8": {
        "en": "I often pick less touristy places.",
        "pl": "Często wybieram miejsca mniej turystyczne.",
    },
    "card.q9": {
        "en": "Price strongly drives where I go and what I do.",
        "pl": "Cena ma duży wpływ na wybór kierunku i atrakcji.",
    },
    "card.q10": {
        "en": "I'll pay more for a unique experience.",
        "pl": "Jestem skłonny zapłacić więcej za wyjątkowe doświadczenie.",
    },
    "card.q11": {
        "en": "I like travelling away from crowds.",
        "pl": "Lubię podróżować z dala od tłumów.",
    },
    "card.q12": {
        "en": "I happily return to places I know.",
        "pl": "Chętnie wracam do miejsc, które już znam.",
    },
    "card.y1": {
        "en": "Do you want to discover new places every day?",
        "pl": "Czy chcesz odkrywać nowe miejsca każdego dnia?",
    },
    "card.y2": {
        "en": "Should the app tailor recommendations to your style?",
        "pl": "Czy aplikacja ma dopasowywać rekomendacje do Twojego stylu?",
    },
    "chat.opener": {
        "en": "Tell me how you like to travel: what do you love doing, how much does price "
        "matter, and do you plan every day or go with the flow?",
        "pl": "Opowiedz, jak lubisz podróżować: co lubisz robić, jak bardzo liczy się cena i czy "
        "planujesz każdy dzień, czy raczej idziesz na żywioł?",
    },
    "chat.ask_y1": {
        "en": "Quick one: {card} (yes / no)",
        "pl": "Szybkie pytanie: {card} (tak / nie)",
    },
    "chat.ask_card": {
        "en": "One more: is this you? “{card}” (not me / depends / that's me / so me)",
        "pl": "Jeszcze jedno: czy to Ty? „{card}” (nie ja / zależy / to ja / bardzo ja)",
    },
    "chat.done": {
        "en": "Thanks, that's your Travel DNA. Have a look and adjust anything I got wrong.",
        "pl": "Dzięki, oto Twoje DNA Podróżnika. Zerknij i popraw, jeśli coś źle odczytałem.",
    },
    "guard.injection": {
        "en": "I can only help plan your trips. Tell me how you like to travel?",
        "pl": "Mogę pomóc tylko w planowaniu podróży. Opowiesz, jak lubisz podróżować?",
    },
    "guard.off_topic": {
        "en": "Let's stick to travel: what do you love doing on a trip?",
        "pl": "Zostańmy przy podróżach: co lubisz robić na wyjeździe?",
    },
    # ---- interview (scripted fallback)
    "iv.q1": {
        "en": "Hi! What do you love doing on a trip - food, history, beaches, nature, nightlife, art?",
        "pl": "Cześć! Co lubisz robić w podróży - jedzenie, historia, plaże, natura, życie nocne, "
        "sztuka?",
    },
    "iv.q2": {
        "en": "Nice. What's your budget per person in PLN, and how comfy should it be "
        "(budget / standard / comfort / luxury)?",
        "pl": "Super. Jaki masz budżet na osobę w złotych i jak wygodnie ma być "
        "(budget / standard / comfort / luxury)?",
    },
    "iv.q3": {
        "en": "Last one: what temperature feels ideal, and is there anything you avoid "
        "(crowds, heat, cold)?",
        "pl": "Ostatnie: jaka temperatura jest dla Ciebie idealna i czego unikasz "
        "(tłumy, upał, zimno)?",
    },
    "iv.summary": {
        "en": "Got it: {interests}; {budget}{luxury} level, {lo}-{hi} °C{avoid}. "
        "Let me find your trips!",
        "pl": "Jasne: {interests}; {budget}poziom {luxury}, {lo}-{hi} °C{avoid}. "
        "Szukam dla Ciebie wyjazdów!",
    },
    "iv.budget": {"en": "budget {amount}, ", "pl": "budżet {amount}, "},
    "iv.avoid": {"en": ", avoiding {items}", "pl": ", bez: {items}"},
}

TAGS_PL = {
    "food": "jedzenie", "history": "historia", "art": "sztuka", "museums": "muzea",
    "architecture": "architektura", "city": "miasto", "beach": "plaże", "sun": "słońce",
    "nightlife": "życie nocne", "nature": "natura", "hiking": "wędrówki", "diving": "nurkowanie",
    "surf": "surfing", "viewpoints": "punkty widokowe", "design": "design", "cycling": "rower",
    "romance": "romantyzm", "festivals": "festiwale", "whisky": "whisky", "pizza": "pizza",
    "culture": "kultura", "wellness": "wellness", "offbeat": "mniej turystyczne miejsca",
    "discovery": "odkrywanie", "walking": "spacery", "ski": "narty", "wine": "wino",
    "crowds": "tłumy", "heat": "upał", "cold": "zimno",
}  # fmt: skip


def tag(name: str, lang: str | None = None) -> str:
    """Interest/dislike tag in the user's language (unknown tags stay as they are)."""
    return TAGS_PL.get(name, name) if pick(lang) == "pl" else name


def tags(names: "list[str] | tuple[str, ...]", lang: str | None = None) -> str:
    return ", ".join(tag(n, lang) for n in names)
