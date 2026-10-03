"use client";

/**
 * Money shown the same way everywhere (docs/BUDGET.md). Cards, the receipt hero and confirm
 * all render <TripPrice>, which reads moneyOf(); so the totals can't drift apart, and the
 * fast → full refresh updates every screen at once (they all read the same store recs).
 */
import { Info, Sparkles, TrendingUp, Users } from "lucide-react";
import { useState, type ReactNode } from "react";
import { InfoTip } from "@/components/declutter";
import { SourceTag } from "@/components/source-tag";
import { useT, type Fmt, type Messages } from "@/lib/i18n";
import { DEMO_PROFILE } from "@/lib/mock/fixtures";
import { moneyOf, partySize } from "@/lib/money";
import { useTrip } from "@/lib/store";
import type { Evidence, Recommendation } from "@/lib/types";
import { cn } from "@/lib/utils";

type Priced = Pick<
  Recommendation,
  "flight_cost_pln" | "hotel_cost_pln" | "total_cost_pln" | "evidence" | "travelers" | "party_total_pln" | "per_person_pln" | "price_status"
> &
  Partial<Pick<Recommendation, "hotel">>;

/**
 * The headline price. Exact: "1 442 zł" (+ party line). Estimate: muted "~1 718 zł · szacunek" + "Brak jeszcze ceny na dokładnie te daty",
 * never styled like a real price. `data-testid="trip-total"` is what the consistency test reads.
 */
export function TripPrice({
  rec,
  className,
  size = "lg",
  tone = "default",
  showParty = true,
}: {
  rec: Priced;
  className?: string;
  size?: "md" | "lg";
  tone?: "default" | "light";
  showParty?: boolean;
}) {
  const { t, fmt } = useT();
  const m = moneyOf(rec);
  const light = tone === "light";
  if (m.status === "estimate") {
    return (
      <span className={cn("block", className)} title={t.money.estimateTip}>
        <span
          data-testid="trip-total"
          data-amount={m.perPerson}
          className={cn("tabular text-sm italic", light ? "text-white/75" : "text-muted-foreground")}
        >
          {m.travelers > 1 ? t.money.fromEstimateParty(fmt.pln(m.partyTotal), fmt.pln(m.perPerson)) : t.money.fromEstimate(fmt.pln(m.perPerson))}
        </span>
        <EstimateNote light={light} />
      </span>
    );
  }
  return (
    <span className={cn("block", className)}>
      <span
        data-testid="trip-total"
        data-amount={m.perPerson}
        className={cn("tabular font-display leading-tight font-semibold", size === "lg" ? "text-2xl" : "text-lg", light ? "text-white" : "text-ink")}
      >
        {fmt.pln(m.perPerson)}
      </span>
      {showParty && m.travelers > 1 && (
        <span className={cn("mt-0.5 block text-xs", light ? "text-white/80" : "text-muted-foreground")}>
          {t.money.party(m.travelers, fmt.pln(m.partyTotal), fmt.pln(m.perPerson))}
        </span>
      )}
    </span>
  );
}

/**
 * The headline price as plain text, for places that can't render <TripPrice> (aria labels, the
 * calendar file, push copy): "852 zł/os.", "1 442 zł", or "~1 718 zł · szacunek".
 */
export function priceText(rec: Priced, t: Messages, fmt: Fmt): string {
  const m = moneyOf(rec);
  if (m.status === "estimate")
    return m.travelers > 1 ? t.money.fromEstimateParty(fmt.pln(m.partyTotal), fmt.pln(m.perPerson)) : t.money.fromEstimate(fmt.pln(m.perPerson));
  return m.travelers > 1 ? t.money.partyShort(fmt.pln(m.partyTotal), fmt.pln(m.perPerson)) : fmt.pln(m.perPerson);
}

/** Inline headline price (receipt hero, swipe cards): same number as the card, estimates muted. */
export function PriceInline({ rec, tone = "default", className }: { rec: Priced; tone?: "default" | "light"; className?: string }) {
  const { t, fmt } = useT();
  const m = moneyOf(rec);
  const est = m.status === "estimate";
  return (
    <span
      data-testid="trip-total"
      data-amount={m.perPerson}
      title={est ? t.money.estimateTip : undefined}
      className={cn("tabular", est && "italic", est && (tone === "light" ? "text-white/75" : "text-muted-foreground"), className)}
    >
      {priceText(rec, t, fmt)}
    </span>
  );
}

/** "Brak jeszcze ceny na dokładnie te daty": one short line under an estimate (card, trip hero). */
export function EstimateNote({ light = false, className }: { light?: boolean; className?: string }) {
  const { t } = useT();
  return <span className={cn("mt-0.5 block text-xs", light ? "text-white/80" : "text-muted-foreground", className)}>{t.money.noLivePrice}</span>;
}

/** "label …… value" money row; `sub` is the source chip line under it. */
function MoneyRow({ label, value, sub, strong, icon }: { label: ReactNode; value: ReactNode; sub?: ReactNode; strong?: boolean; icon?: ReactNode }) {
  return (
    <div className="py-1.5">
      <div className={cn("flex items-baseline gap-2 text-sm", strong && "font-semibold")}>
        {icon}
        <span className="text-ink">{label}</span>
        <span className="flex-1 translate-y-[-3px] border-b border-dotted border-ink/25" />
        <span className="tabular shrink-0 text-ink">{value}</span>
      </div>
      {sub && <div className={cn("mt-0.5 flex flex-wrap items-center gap-1", icon && "ml-6")}>{sub}</div>}
    </div>
  );
}

/**
 * Flight, stay and total lines for the receipt and confirm, from the same moneyOf() as the card:
 * "Loty × 2 …… 1 040 zł", "Nocleg, 4 noce × 1 pokój …… 1 440 zł", "Razem za 2 os. …… 2 480 zł",
 * "na osobę …… 1 240 zł". An estimated leg reads "≈ 480 zł szac." with the reason behind ⓘ.
 */
export function MoneyLines({
  rec,
  nights,
  flightLabel,
  icons,
  idFor,
  collapseSources = false,
}: {
  rec: Priced;
  /** "4 nights" */
  nights: string;
  /** confirm names the route ("KRK → FCO"); the receipt uses the generic label */
  flightLabel?: string;
  icons?: { flight: ReactNode; hotel: ReactNode };
  /** jump-target id for the line's evidence row (receipt only) */
  idFor?: (e: Evidence) => string;
  /** receipt (round 3): the lines' source chips sit behind one "ⓘ Źródła" toggle; confirm keeps them visible */
  collapseSources?: boolean;
}) {
  const { t, fmt } = useT();
  const [open, setShowSources] = useState(false);
  const showSources = !collapseSources || open;
  const m = moneyOf(rec);
  const flightEv = rec.evidence.find((e) => e.kind === "flight");
  const hotelEv = rec.evidence.find((e) => e.kind === "hotel");
  const estimate = m.status === "estimate";
  const rooms = m.travelers > 1 ? m.rooms : 1;
  const amount = (n: number, est: boolean) =>
    est ? (
      <span className="text-muted-foreground italic">
        ≈ {fmt.pln(n)} <span className="text-xs not-italic">{t.money.est}</span>
      </span>
    ) : (
      fmt.pln(n)
    );
  const legs = [
    {
      key: "flight",
      e: flightEv,
      icon: icons?.flight,
      label: flightLabel ? (m.travelers > 1 ? `${flightLabel} × ${m.travelers}` : flightLabel) : t.money.flight(m.travelers),
      value: m.flightLine,
      est: m.estimated.flight,
      leg: t.money.legFlight,
    },
    {
      key: "hotel",
      e: hotelEv,
      icon: icons?.hotel,
      // say whether this is a specific hotel or a city average (docs/USER_TESTING.md)
      label: m.estimated.hotel ? (
        <>
          {t.money.hotel(nights, rooms)} <span className="text-muted-foreground">· {t.money.cityAverage}</span>
        </>
      ) : rec.hotel?.name ? (
        t.money.hotelNamed(rec.hotel.name, nights, rooms)
      ) : (
        t.money.hotel(nights, rooms)
      ),
      value: m.hotelLine,
      est: m.estimated.hotel,
      leg: t.money.legHotel,
    },
  ];
  return (
    <div>
      {legs.map((l) => (
        // data-line / data-amount: stable hooks for the e2e price invariant (e2e/tests/10)
        <div key={l.key} id={l.e && idFor ? idFor(l.e) : undefined} data-line={l.key} data-amount={l.value} className="-mx-2 rounded-lg px-2">
          <MoneyRow
            icon={l.icon}
            label={l.label}
            value={amount(l.value, l.est)}
            sub={
              ((l.e && showSources) || (l.est && !estimate)) && (
                <>
                  {l.e && showSources && <SourceTag e={l.e} variant="chip" />}
                  {l.est && !estimate && <InfoTip label={t.money.estimateTitle}>{t.money.partialTip(l.leg)}</InfoTip>}
                </>
              )
            }
          />
        </div>
      ))}
      <div className="my-1.5 border-t border-dashed border-ink/25" />
      {/* Totals are the sum of the lines above (moneyOf), whatever the backend's own total fields say. */}
      {(() => {
        const cls = estimate ? "text-muted-foreground italic" : undefined;
        const amt = (n: number) => (estimate ? `~${fmt.pln(n)}` : fmt.pln(n));
        const note = estimate ? <InfoTip label={t.money.estimateTitle}>{t.money.estimateTip}</InfoTip> : undefined;
        return m.travelers > 1 ? (
          <>
            <MoneyRow
              label={estimate ? `${t.money.total(m.travelers)} (${t.money.otherDates})` : t.money.total(m.travelers)}
              value={
                <span data-testid="party-total" data-amount={m.partyTotal} className={cls}>
                  {amt(m.partyTotal)}
                </span>
              }
              sub={note}
              strong
            />
            <MoneyRow
              label={t.money.perPerson}
              value={
                <span data-testid="trip-total" data-amount={m.perPerson} className={cls}>
                  {amt(m.perPerson)}
                </span>
              }
            />
          </>
        ) : (
          <MoneyRow
            label={estimate ? `${t.money.total(1)} (${t.money.otherDates})` : t.money.total(1)}
            value={
              <span data-testid="trip-total" data-amount={m.perPerson} className={cls}>
                {amt(m.perPerson)}
              </span>
            }
            sub={note}
            strong
          />
        );
      })()}
      {/* One "ⓘ Źródła" toggle for the section instead of a chip under every line (round 3). */}
      {collapseSources && (flightEv || hotelEv) && (
        <button
          type="button"
          onClick={() => setShowSources((v) => !v)}
          aria-expanded={open}
          data-tour="source"
          className="mt-1 inline-flex min-h-11 items-center gap-1 font-sans text-xs text-muted-foreground hover:text-ink"
        >
          <Info className="size-3.5" aria-hidden /> {t.money.sources}
        </button>
      )}
    </div>
  );
}

/** "Świetna cena" / "Warto dopłacić +300 zł"; the reason is one tap away. */
export function ValueBadge({ rec, className }: { rec: Pick<Recommendation, "value_badge" | "value_reason">; className?: string }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  if (!rec.value_badge) return null;
  const splurge = rec.value_badge === "worth_splurge";
  const extra = splurge ? (rec.value_reason?.match(/^\+[\d\s .,]+(?:zł|PLN)/)?.[0] ?? null) : null;
  const label = splurge ? t.money.valueSplurge(extra) : t.money.valueGreat;
  return (
    <span className={cn("inline-flex flex-col items-start", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`${label}. ${t.money.valueWhy}`}
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
          splurge ? "bg-sun-soft text-ink" : "bg-pine-soft text-pine-deep",
        )}
      >
        {splurge ? <TrendingUp className="size-3.5" aria-hidden /> : <Sparkles className="size-3.5" aria-hidden />}
        {label}
        <Info className="size-3 opacity-60" aria-hidden />
      </button>
      {open && rec.value_reason && <span className="mt-1 text-xs leading-snug text-muted-foreground">{rec.value_reason}</span>}
    </span>
  );
}

export const PARTY_MAX = 12;

/**
 * "Ile osób?  − 2 osoby +" (1–12; groups of 8–10 happen, docs/USER_TESTING.md). By default writes
 * adults to the profile (children stay as set) so the next /recommendations call prices the party;
 * onboarding passes value/onChange because the profile doesn't exist yet.
 */
export function PartyPicker({
  className,
  compact = false,
  value,
  onChange,
}: {
  className?: string;
  compact?: boolean;
  value?: number;
  onChange?: (n: number) => void;
}) {
  const { t } = useT();
  const profile = useTrip((s) => s.profile);
  const setProfile = useTrip((s) => s.setProfile);
  const n = Math.min(PARTY_MAX, value ?? partySize(profile));
  const pick = (k: number) => {
    const next = Math.max(1, Math.min(PARTY_MAX, k));
    if (onChange) return onChange(next);
    // no saved profile yet (demo): start from the demo profile so the tap is never a no-op
    const base = profile ?? DEMO_PROFILE;
    const children = Math.min(base.children ?? 0, next - 1);
    setProfile({ ...base, adults: next - children, children, rooms: null });
  };
  const btn = cn(
    compact ? "size-8" : "size-9",
    "grid shrink-0 place-items-center rounded-full border border-line bg-card text-lg font-semibold text-ink transition-colors hover:border-pine/40 disabled:opacity-35",
  );
  return (
    <div className={cn("flex items-center gap-2", className)} role="group" aria-label={t.money.people}>
      {compact ? <Users className="size-4 text-pine" aria-hidden /> : <span className="text-sm font-medium text-ink">{t.money.people}</span>}
      <button type="button" className={btn} onClick={() => pick(n - 1)} disabled={n <= 1} aria-label={t.money.fewer}>
        −
      </button>
      <output aria-live="polite" className={cn("tabular text-center text-sm font-semibold text-ink", compact ? "min-w-5" : "min-w-[4.5rem]")}>
        {compact ? (
          <>
            <span aria-hidden>{n}</span>
            <span className="sr-only">{t.money.peopleAria(n)}</span>
          </>
        ) : (
          t.money.peopleAria(n)
        )}
      </output>
      <button type="button" className={btn} onClick={() => pick(n + 1)} disabled={n >= PARTY_MAX} aria-label={t.money.more}>
        +
      </button>
    </div>
  );
}
