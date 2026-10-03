"use client";

import { AnimatePresence, motion } from "motion/react";
import { Plane, Plus, ThermometerSun, Wallet, X, CalendarRange, BedDouble } from "lucide-react";
import { useState } from "react";
import { Slider } from "@/components/ui/slider";
import { formatPLN } from "@/lib/format";
import type { LuxuryLevel, TasteProfile } from "@/lib/types";
import { cn } from "@/lib/utils";

const LEVELS = [
  { at: 0.35, label: "a little" },
  { at: 0.65, label: "a lot" },
  { at: 0.9, label: "love it" },
];

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
  const editable = !!onChange && !compact;
  const interests = Object.entries(profile.interests).sort((a, b) => b[1] - a[1]);
  const update = (patch: Partial<TasteProfile>) => onChange?.({ ...profile, ...patch });

  const cycle = (tag: string, w: number) => {
    const lvl = levelOf(w);
    update({ interests: { ...profile.interests, [tag]: LEVELS[lvl % 3].at } });
  };
  const removeTag = (tag: string) => {
    const rest = { ...profile.interests };
    delete rest[tag];
    update({ interests: rest });
  };

  return (
    <div className="space-y-5">
      <section>
        {!compact && <h3 className="mb-2.5 text-sm font-semibold text-ink">You love</h3>}
        <motion.ul layout className="flex flex-wrap gap-2">
          <AnimatePresence initial={false}>
            {interests.map(([tag, w]) => (
              <motion.li
                key={tag}
                layout
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className={cn(
                  "flex items-center gap-2 rounded-full border text-sm capitalize",
                  w >= 0.8 ? "border-pine bg-pine text-primary-foreground" : w >= 0.5 ? "border-pine/30 bg-pine-soft text-pine-deep" : "border-line bg-card text-ink-soft",
                )}
              >
                <button
                  disabled={!editable}
                  onClick={() => cycle(tag, w)}
                  className="flex items-center gap-2 py-1.5 pl-3.5 disabled:cursor-default"
                  aria-label={`${tag}: ${LEVELS[levelOf(w) - 1].label}${editable ? ", tap to change" : ""}`}
                >
                  {tag}
                  <Dots n={levelOf(w)} />
                </button>
                {editable ? (
                  <button onClick={() => removeTag(tag)} className="-ml-1 rounded-full p-1.5 pr-2.5 opacity-60 hover:opacity-100" aria-label={`Remove ${tag}`}>
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
                <Plus className="size-3.5" /> Add
              </button>
            </li>
          )}
        </motion.ul>
        <AnimatePresence>
          {adding && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <div className="flex flex-wrap gap-2 pt-3">
                {ALL_TAGS.filter((t) => !(t in profile.interests)).map((t) => (
                  <button
                    key={t}
                    onClick={() => update({ interests: { ...profile.interests, [t]: 0.65 } })}
                    className="rounded-full bg-paper-deep px-3 py-1 text-sm text-ink-soft capitalize hover:bg-pine-soft hover:text-pine-deep"
                  >
                    + {t}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {editable && <p className="mt-2 text-xs text-muted-foreground">Tap an interest to change how much it counts.</p>}
      </section>

      <section>
        {!compact && <h3 className="mb-2.5 text-sm font-semibold text-ink">You avoid</h3>}
        <ul className="flex flex-wrap gap-2">
          {(editable ? ALL_DISLIKES : profile.dislikes).map((d) => {
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
                  {d}
                </button>
              </li>
            );
          })}
          {!editable && profile.dislikes.length === 0 && <li className="text-sm text-muted-foreground">Nothing in particular</li>}
        </ul>
      </section>

      {compact ? (
        <div className="divide-y divide-line border-t border-line">
          <Row icon={Plane} label="From">{profile.origin_airports.join(", ")}</Row>
          <Row icon={Wallet} label="Budget">{profile.budget_pln ? `${formatPLN(profile.budget_pln)} pp` : "Flexible"}</Row>
          <Row icon={BedDouble} label="Stay">
            <span className="capitalize">{profile.luxury}</span>
          </Row>
        </div>
      ) : (
        <section className="space-y-6 rounded-3xl border border-line bg-card p-4 shadow-soft">
          <div>
            <div className="mb-3 flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 font-semibold text-ink">
                <Wallet className="size-4 text-pine" /> Budget per person
              </span>
              <span className="tabular font-mono text-ink">{profile.budget_pln ? formatPLN(profile.budget_pln) : "Flexible"}</span>
            </div>
            <Slider
              min={600}
              max={5000}
              step={100}
              value={[profile.budget_pln ?? 5000]}
              onValueChange={([v]) => update({ budget_pln: v >= 5000 ? null : v })}
              aria-label="Budget per person"
            />
          </div>

          <div>
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
              <BedDouble className="size-4 text-pine" /> Stay
            </div>
            <div className="grid grid-cols-4 gap-1 rounded-2xl bg-paper-deep p-1">
              {LUXURY.map((l) => (
                <button
                  key={l}
                  onClick={() => update({ luxury: l })}
                  className={cn(
                    "relative rounded-xl py-2 text-xs font-medium capitalize",
                    profile.luxury === l ? "text-ink" : "text-muted-foreground",
                  )}
                >
                  {profile.luxury === l && (
                    <motion.span layoutId="lux" className="absolute inset-0 rounded-xl bg-card shadow-soft" transition={{ type: "spring", stiffness: 300, damping: 30 }} />
                  )}
                  <span className="relative">{l}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 font-semibold text-ink">
                <ThermometerSun className="size-4 text-pine" /> Comfortable temperature
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
              aria-label="Preferred temperature range"
            />
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 font-semibold text-ink">
                <CalendarRange className="size-4 text-pine" /> Trip length
              </span>
              <span className="tabular font-mono text-ink">
                {profile.trip_length_days[0]}–{profile.trip_length_days[1]} days
              </span>
            </div>
            <Slider
              min={2}
              max={14}
              step={1}
              value={profile.trip_length_days}
              onValueChange={([a, b]) => update({ trip_length_days: [a, b] })}
              aria-label="Trip length in days"
            />
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 font-semibold text-ink">
              <Plane className="size-4 text-pine" /> Flying from
            </span>
            <div className="flex gap-1">
              {["KRK", "KTW", "WAW"].map((a) => {
                const on = profile.origin_airports.includes(a);
                return (
                  <button
                    key={a}
                    onClick={() => {
                      const next = on ? profile.origin_airports.filter((x) => x !== a) : [...profile.origin_airports, a];
                      if (next.length) update({ origin_airports: next });
                    }}
                    className={cn(
                      "rounded-lg border px-2.5 py-1 font-mono text-xs",
                      on ? "border-pine bg-pine text-primary-foreground" : "border-line text-muted-foreground",
                    )}
                  >
                    {a}
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
