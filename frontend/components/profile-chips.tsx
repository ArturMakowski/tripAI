"use client";

import { AnimatePresence, motion } from "motion/react";
import { Plane, Plus, ThermometerSun, Wallet, X, CalendarRange, BedDouble } from "lucide-react";
import { useState } from "react";
import { InfoTip } from "@/components/declutter";
import { Slider } from "@/components/ui/slider";
import { partySize } from "@/lib/money";
import { useT } from "@/lib/i18n";
import { nameOf } from "@/lib/i18n/messages/profile";
import type { LuxuryLevel, TasteProfile } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AirportPicker } from "@/components/airport-picker";
import { expandToCity, formatOrigins } from "@/lib/airports";

const LEVELS = [
  { at: 0.35, key: "little" },
  { at: 0.65, key: "lot" },
  { at: 0.9, key: "love" },
] as const;

function levelOf(w: number) {
  return w >= 0.8 ? 3 : w >= 0.5 ? 2 : 1;
}

const ALL_TAGS = ["food", "history", "art", "architecture", "walking", "beach", "nightlife", "nature", "music", "shopping", "wine", "design"];
const ALL_DISLIKES = ["crowds", "heat", "cold", "rain", "long layovers", "early flights", "long transfers"];
const LUXURY: LuxuryLevel[] = ["budget", "standard", "comfort", "luxury"];

function Dots({ n }: { n: number }) {
  return (
    <span className="flex gap-0.5" aria-hidden>
      {[1, 2, 3].map((i) => (
        <span key={i} className={cn("size-1.5 rounded-full", i <= n ? "bg-current" : "bg-current opacity-20")} />
      ))}
    </span>
  );
}

function Row({ icon: Icon, label, children }: { icon: typeof Plane; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <span className="flex items-center gap-2.5 text-sm text-ink-soft">
        <Icon className="size-4 text-pine" aria-hidden />
        {label}
      </span>
      <span className="text-sm font-medium text-ink">{children}</span>
    </div>
  );
}

/**
 * Taste profile as chips. `compact` is read-only (chat summary); otherwise each
 * chip is editable: tap an interest to cycle its strength, x to remove.
 */
export function ProfileChips({
  profile,
  onChange,
  compact,
}: {
  profile: TasteProfile;
  onChange?: (p: TasteProfile) => void;
  compact?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [addingAvoid, setAddingAvoid] = useState(false);
  const { t: all, fmt, lang } = useT();
  const t = all.profile;
  const tm = all.money;
  const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
  const tag = (x: string) => cap(nameOf(t.tags, x));
  const dislike = (x: string) => nameOf(t.dislikes, x);
  const levelLabel = (w: number) => t.levels[LEVELS[levelOf(w) - 1].key];
  const editable = !!onChange && !compact;
  const interests = Object.entries(profile.interests).sort((a, b) => b[1] - a[1]);
  const update = (patch: Partial<TasteProfile>) => onChange?.({ ...profile, ...patch });

  const cycle = (key: string, w: number) => {
    const lvl = levelOf(w);
    update({ interests: { ...profile.interests, [key]: LEVELS[lvl % 3].at } });
  };
  const removeTag = (key: string) => {
    const rest = { ...profile.interests };
    delete rest[key];
    update({ interests: rest });
  };

  return (
    <div className="space-y-5">
      <section>
        {!compact && (
          <div className="mb-2.5">
            <h3 className="inline text-sm font-semibold text-ink">{t.youLove}</h3>
            {editable && (
              <>
                {" "}
                <InfoTip>{t.tapHint}</InfoTip>
              </>
            )}
          </div>
        )}
        <motion.ul layout className="flex flex-wrap gap-2">
          <AnimatePresence initial={false}>
            {interests.map(([key, w]) => (
              <motion.li
                key={key}
                layout
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className={cn(
                  "flex items-center gap-2 rounded-full border text-sm",
                  w >= 0.8 ? "border-pine bg-pine text-primary-foreground" : w >= 0.5 ? "border-pine/30 bg-pine-soft text-pine-deep" : "border-line bg-card text-ink-soft",
                )}
              >
                <button
                  disabled={!editable}
                  onClick={() => cycle(key, w)}
                  className="flex items-center gap-2 py-1.5 pl-3.5 disabled:cursor-default"
                  aria-label={t.chipAria(tag(key), levelLabel(w), editable)}
                >
                  {tag(key)}
                  <Dots n={levelOf(w)} />
                </button>
                {editable ? (
                  <button
                    onClick={() => removeTag(key)}
                    className="-ml-1 rounded-full p-1.5 pr-2.5 opacity-60 hover:opacity-100"
                    aria-label={t.removeAria(tag(key))}
                  >
                    <X className="size-3.5" />
                  </button>
                ) : (
                  <span className="w-1.5" />
                )}
              </motion.li>
            ))}
          </AnimatePresence>
          {editable && (
            <li>
              <button
                onClick={() => setAdding((a) => !a)}
                className="flex items-center gap-1 rounded-full border border-dashed border-ink/25 px-3.5 py-1.5 text-sm text-ink-soft hover:border-pine hover:text-pine"
              >
                <Plus className="size-3.5" /> {t.add}
              </button>
            </li>
          )}
        </motion.ul>
        <AnimatePresence>
          {adding && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <div className="flex flex-wrap gap-2 pt-3">
                {ALL_TAGS.filter((x) => !(x in profile.interests)).map((x) => (
                  <button
                    key={x}
                    onClick={() => update({ interests: { ...profile.interests, [x]: 0.65 } })}
                    className="rounded-full bg-paper-deep px-3 py-1 text-sm text-ink-soft hover:bg-pine-soft hover:text-pine-deep"
                  >
                    + {tag(x)}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      <section>
        {!compact && <h3 className="mb-2.5 text-sm font-semibold text-ink">{t.youAvoid}</h3>}
        <ul className="flex flex-wrap gap-2">
          {/* only what you avoid is on screen; the other options are one tap away ("+ Dodaj") */}
          {(editable && addingAvoid ? ALL_DISLIKES : profile.dislikes).map((d) => {
            const on = profile.dislikes.includes(d);
            return (
              <li key={d}>
                <button
                  disabled={!editable}
                  onClick={() => update({ dislikes: on ? profile.dislikes.filter((x) => x !== d) : [...profile.dislikes, d] })}
                  className={cn(
                    "rounded-full border px-3.5 py-1.5 text-sm transition-colors disabled:cursor-default",
                    on ? "border-clay/40 bg-clay-soft text-ink" : "border-line text-muted-foreground hover:border-clay/40",
                  )}
                >
                  {on && <span className="mr-1 text-clay">✕</span>}
                  {dislike(d)}
                </button>
              </li>
            );
          })}
          {(!editable || !addingAvoid) && profile.dislikes.length === 0 && <li className="py-1.5 text-sm text-muted-foreground">{t.nothingInParticular}</li>}
          {editable && !addingAvoid && (
            <li>
              <button
                onClick={() => setAddingAvoid(true)}
                className="flex items-center gap-1 rounded-full border border-dashed border-ink/25 px-3.5 py-1.5 text-sm text-ink-soft hover:border-pine hover:text-pine"
              >
                <Plus className="size-3.5" /> {t.add}
              </button>
            </li>
          )}
        </ul>
      </section>

      {compact ? (
        <div className="divide-y divide-line border-t border-line">
          <Row icon={Plane} label={t.from}>
            {formatOrigins(profile.origin_airports, lang)}
          </Row>
          <Row icon={Wallet} label={t.budget}>
            {profile.budget_pln ? t.perPerson(fmt.pln(profile.budget_pln)) : t.flexible}
          </Row>
          <Row icon={BedDouble} label={t.stay}>
            {cap(t.luxury[profile.luxury])}
          </Row>
        </div>
      ) : (
        <section className="space-y-6 rounded-3xl border border-line bg-card p-4 shadow-soft">
          {/* Optional hard limit, off by default (docs/BUDGET.md): without it we rank on value. */}
          <div>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span id="limit-title" className="flex items-center gap-2 font-semibold text-ink">
                <Wallet className="size-4 shrink-0 text-pine" /> {tm.limitTitle}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={profile.budget_pln != null}
                aria-labelledby="limit-title"
                onClick={() => update({ budget_pln: profile.budget_pln != null ? null : 2500 })}
                className={cn(
                  "relative h-7 w-12 shrink-0 rounded-full transition-colors",
                  profile.budget_pln != null ? "bg-pine" : "bg-line",
                )}
              >
                <span
                  className={cn(
                    "absolute top-1 left-1 size-5 rounded-full bg-white shadow-soft transition-transform",
                    profile.budget_pln != null && "translate-x-5",
                  )}
                />
              </button>
            </div>
            {profile.budget_pln != null ? (
              <div className="mt-3">
                {/* per person and per trip (docs/USER_TESTING.md) */}
                <p className="tabular mb-3 text-right font-mono text-sm text-ink">
                  {t.perPerson(fmt.pln(profile.budget_pln))}
                  {partySize(profile) > 1 && (
                    <span className="block text-xs text-muted-foreground">
                      {tm.limitPerTrip(fmt.pln(profile.budget_pln * partySize(profile)), partySize(profile))}
                    </span>
                  )}
                </p>
                <Slider
                  min={600}
                  max={5000}
                  step={100}
                  value={[profile.budget_pln]}
                  onValueChange={([v]) => update({ budget_pln: v })}
                  aria-label={tm.limitAria}
                />
              </div>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">{tm.limitHint}</p>
            )}
          </div>

          <div>
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
              <BedDouble className="size-4 text-pine" /> {t.stay}
            </div>
            <div className="grid grid-cols-4 gap-1 rounded-2xl bg-paper-deep p-1">
              {LUXURY.map((l) => (
                <button
                  key={l}
                  onClick={() => update({ luxury: l })}
                  className={cn(
                    "relative rounded-xl py-2 text-xs font-medium",
                    profile.luxury === l ? "text-ink" : "text-muted-foreground",
                  )}
                >
                  {profile.luxury === l && (
                    <motion.span layoutId="lux" className="absolute inset-0 rounded-xl bg-card shadow-soft" transition={{ type: "spring", stiffness: 300, damping: 30 }} />
                  )}
                  <span className="relative">{cap(t.luxury[l])}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 font-semibold text-ink">
                <ThermometerSun className="size-4 text-pine" /> {t.temperature}
              </span>
              <span className="tabular font-mono text-ink">
                {profile.preferred_temp_c[0]}–{profile.preferred_temp_c[1]} °C
              </span>
            </div>
            <Slider
              min={-5}
              max={38}
              step={1}
              value={profile.preferred_temp_c}
              onValueChange={([a, b]) => update({ preferred_temp_c: [a, b] })}
              aria-label={t.temperatureAria}
              thumbLabels={[`${t.temperatureAria} (min)`, `${t.temperatureAria} (max)`]}
            />
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 font-semibold text-ink">
                <CalendarRange className="size-4 text-pine" /> {t.tripLength}
              </span>
              <span className="tabular font-mono text-ink">{t.days(profile.trip_length_days[0], profile.trip_length_days[1])}</span>
            </div>
            <Slider
              min={2}
              max={14}
              step={1}
              value={profile.trip_length_days}
              onValueChange={([a, b]) => update({ trip_length_days: [a, b] })}
              aria-label={t.tripLengthAria}
              thumbLabels={[`${t.tripLengthAria} (min)`, `${t.tripLengthAria} (max)`]}
            />
          </div>

          <div className="text-sm">
            <span className="flex items-center gap-2 font-semibold text-ink">
              <Plane className="size-4 text-pine" /> {t.flyingFrom}
            </span>
            <AirportPicker
              className="mt-2"
              required
              value={profile.origin_airports}
              onChange={(next) => update({ origin_airports: expandToCity(next) })}
            />
          </div>
        </section>
      )}
    </div>
  );
}
