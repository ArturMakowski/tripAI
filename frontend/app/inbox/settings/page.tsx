"use client";

import { BellOff, BellRing, Loader2, MoonStar, Plus, ShieldCheck, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppShell, PageTitle } from "@/components/shell";
import { errorText } from "@/lib/errors";
import { useT } from "@/lib/i18n";
import { NOTIFY_AVAILABLE, currentSubscription, disablePush, enablePush, notifyApi, pushSupported } from "@/lib/notify";
import type { NotificationPrefs } from "@/lib/notify-types";
import { useTrip } from "@/lib/store";
import { cn } from "@/lib/utils";

const FREQ = [1, 3, 7];
const SNOOZE = [1, 7, 30];

function Toggle({ on, busy, onClick, label }: { on: boolean; busy?: boolean; onClick: () => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={busy}
      onClick={onClick}
      className={cn(
        "relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-60",
        on ? "bg-pine" : "bg-line",
      )}
    >
      <span className={cn("absolute top-0.5 left-0.5 grid size-6 place-items-center rounded-full bg-paper shadow transition-transform", on && "translate-x-5")}>
        {busy && <Loader2 className="size-3.5 animate-spin text-pine" aria-hidden />}
      </span>
    </button>
  );
}

function Section({ title, children, hint }: { title: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-xs font-semibold tracking-[0.14em] text-clay uppercase">{title}</h2>
      {children}
      {hint && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{hint}</p>}
    </section>
  );
}

export default function NotificationSettingsPage() {
  const recs = useTrip((s) => s.recs);
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [city, setCity] = useState("");
  const { t, fmt } = useT();
  const st = t.inbox.settings;

  useEffect(() => {
    if (!NOTIFY_AVAILABLE) return;
    notifyApi.prefs().then(setPrefs, (e: unknown) => setError(errorText(e, t)));
    currentSubscription().then((s) => setSubscribed(!!s), () => {});
  }, [t]);

  const save = async (patch: Parameters<typeof notifyApi.savePrefs>[0]) => {
    setError(null);
    try {
      setPrefs(await notifyApi.savePrefs(patch));
    } catch (e) {
      setError(errorText(e, t));
    }
  };

  // Only ever called from the toggle's onClick: the browser prompt appears on a user tap, never on load.
  const togglePush = async () => {
    setBusy(true);
    setError(null);
    try {
      if (prefs?.push_opt_in && subscribed) {
        setPrefs(await disablePush());
        setSubscribed(false);
      } else {
        setPrefs(await enablePush());
        setSubscribed(true);
      }
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setBusy(false);
    }
  };

  const suggestions = useMemo(() => {
    const muted = new Set(prefs?.muted_cities.map((c) => c.toLowerCase()) ?? []);
    return [...new Set(recs.map((r) => r.city))].filter((c) => !muted.has(c.toLowerCase())).slice(0, 6);
  }, [recs, prefs]);

  const snoozed = prefs?.snooze_until && new Date(prefs.snooze_until) > new Date();
  const pushOn = !!prefs?.push_opt_in && subscribed;

  return (
    <AppShell back="/inbox" title={t.inbox.title}>
      <PageTitle eyebrow={st.eyebrow} title={st.heading}>
        {st.intro}
      </PageTitle>

      {!NOTIFY_AVAILABLE && <p className="rounded-xl bg-paper-deep p-4 text-sm text-ink-soft">{st.needsLive}</p>}
      {error && <p className="mb-2 rounded-xl bg-clay-soft p-3 text-sm text-clay">{error}</p>}

      {prefs && (
        <>
          <div className="flex items-center gap-3 rounded-2xl border border-line bg-card p-4">
            <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", pushOn ? "bg-pine text-paper" : "bg-paper-deep text-ink-soft")}>
              {pushOn ? <BellRing className="size-5" aria-hidden /> : <BellOff className="size-5" aria-hidden />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-ink">{st.push}</p>
              <p className="text-xs text-muted-foreground">{pushOn ? st.pushOn : pushSupported() ? st.pushOff : st.pushUnsupported}</p>
            </div>
            <Toggle on={pushOn} busy={busy} onClick={togglePush} label={st.push} />
          </div>

          <Section title={st.oftenTitle} hint={st.oftenHint}>
            <div className="grid grid-cols-3 gap-2">
              {FREQ.map((n) => (
                <button
                  key={n}
                  onClick={() => save({ max_per_week: n })}
                  className={cn(
                    "rounded-xl border px-3 py-2.5 text-sm font-medium",
                    prefs.max_per_week === n ? "border-pine bg-pine-soft text-pine-deep" : "border-line bg-card text-ink-soft",
                  )}
                >
                  {st.perWeek(n)}
                </button>
              ))}
            </div>
          </Section>

          <Section title={st.mutedTitle} hint={st.mutedHint}>
            <div className="flex flex-wrap gap-2">
              {prefs.muted_cities.map((c) => (
                <button
                  key={c}
                  onClick={() => save({ muted_cities: prefs.muted_cities.filter((x) => x !== c) })}
                  className="inline-flex items-center gap-1 rounded-full bg-ink px-3 py-1 text-sm text-paper"
                  aria-label={st.unmute(c)}
                >
                  {c} <X className="size-3.5" aria-hidden />
                </button>
              ))}
              {suggestions.map((c) => (
                <button
                  key={c}
                  onClick={() => save({ muted_cities: [...prefs.muted_cities, c] })}
                  className="inline-flex items-center gap-1 rounded-full border border-line bg-card px-3 py-1 text-sm text-ink-soft"
                >
                  <Plus className="size-3.5" aria-hidden /> {c}
                </button>
              ))}
            </div>
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (city.trim()) save({ muted_cities: [...prefs.muted_cities, city.trim()] });
                setCity("");
              }}
            >
              <input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder={st.cityPlaceholder}
                className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-card px-3 text-sm outline-none focus:border-pine"
              />
              <button className="h-10 rounded-xl bg-paper-deep px-4 text-sm font-medium text-ink">{st.mute}</button>
            </form>
          </Section>

          <Section title={st.snoozeTitle} hint={snoozed ? st.snoozedUntil(fmt.timestamp(prefs.snooze_until!)) : undefined}>
            <div className="flex flex-wrap gap-2">
              {SNOOZE.map((days) => (
                <button
                  key={days}
                  onClick={() => save({ snooze_until: new Date(Date.now() + days * 86_400_000).toISOString() })}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-card px-3 py-2 text-sm text-ink-soft"
                >
                  <MoonStar className="size-4" aria-hidden /> {st.snoozeFor(days)}
                </button>
              ))}
              {snoozed && (
                <button onClick={() => save({ snooze_until: "" })} className="rounded-xl px-3 py-2 text-sm font-medium text-pine">
                  {st.wakeUp}
                </button>
              )}
            </div>
          </Section>

          <p className="mt-8 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {st.footer}
          </p>
        </>
      )}
    </AppShell>
  );
}
