"use client";

import { BellOff, BellRing, Loader2, MoonStar, Plus, ShieldCheck, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppShell, PageTitle } from "@/components/shell";
import { formatTimestamp } from "@/lib/format";
import { NOTIFY_AVAILABLE, currentSubscription, disablePush, enablePush, notifyApi, pushSupported } from "@/lib/notify";
import type { NotificationPrefs } from "@/lib/notify-types";
import { useTrip } from "@/lib/store";
import { cn } from "@/lib/utils";

const FREQ = [
  { n: 1, label: "1 / week" },
  { n: 3, label: "3 / week" },
  { n: 7, label: "Daily" },
];
const SNOOZE = [
  { days: 1, label: "1 day" },
  { days: 7, label: "1 week" },
  { days: 30, label: "1 month" },
];

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

  useEffect(() => {
    if (!NOTIFY_AVAILABLE) return;
    notifyApi.prefs().then(setPrefs, (e: Error) => setError(e.message));
    currentSubscription().then((s) => setSubscribed(!!s), () => {});
  }, []);

  const save = async (patch: Parameters<typeof notifyApi.savePrefs>[0]) => {
    setError(null);
    try {
      setPrefs(await notifyApi.savePrefs(patch));
    } catch (e) {
      setError((e as Error).message);
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
      setError((e as Error).message);
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
    <AppShell back="/inbox" title="Inbox">
      <PageTitle eyebrow="Notifications" title="You set the volume.">
        The inbox is always here. Push to your phone only happens if you switch it on, and never more often than you allow.
      </PageTitle>

      {!NOTIFY_AVAILABLE && <p className="rounded-xl bg-paper-deep p-4 text-sm text-ink-soft">Settings need the live backend.</p>}
      {error && <p className="mb-2 rounded-xl bg-clay-soft p-3 text-sm text-clay">{error}</p>}

      {prefs && (
        <>
          <div className="flex items-center gap-3 rounded-2xl border border-line bg-card p-4">
            <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", pushOn ? "bg-pine text-paper" : "bg-paper-deep text-ink-soft")}>
              {pushOn ? <BellRing className="size-5" aria-hidden /> : <BellOff className="size-5" aria-hidden />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-ink">Push notifications</p>
              <p className="text-xs text-muted-foreground">
                {pushOn ? "On for this device." : pushSupported() ? "Off. Your browser will ask for permission when you switch this on." : "Not supported here. On iPhone, add TripAI to the Home Screen first."}
              </p>
            </div>
            <Toggle on={pushOn} busy={busy} onClick={togglePush} label="Push notifications" />
          </div>

          <Section title="How often, at most" hint="Price drops on trips you watch go first, then long weekends, then a new #1.">
            <div className="grid grid-cols-3 gap-2">
              {FREQ.map((f) => (
                <button
                  key={f.n}
                  onClick={() => save({ max_per_week: f.n })}
                  className={cn(
                    "rounded-xl border px-3 py-2.5 text-sm font-medium",
                    prefs.max_per_week === f.n ? "border-pine bg-pine-soft text-pine-deep" : "border-line bg-card text-ink-soft",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </Section>

          <Section title="Muted cities" hint="We still rank them; we just won't ping you about them.">
            <div className="flex flex-wrap gap-2">
              {prefs.muted_cities.map((c) => (
                <button
                  key={c}
                  onClick={() => save({ muted_cities: prefs.muted_cities.filter((x) => x !== c) })}
                  className="inline-flex items-center gap-1 rounded-full bg-ink px-3 py-1 text-sm text-paper"
                  aria-label={`Unmute ${c}`}
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
                placeholder="City or airport code"
                className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-card px-3 text-sm outline-none focus:border-pine"
              />
              <button className="h-10 rounded-xl bg-paper-deep px-4 text-sm font-medium text-ink">Mute</button>
            </form>
          </Section>

          <Section title="Snooze" hint={snoozed ? `Quiet until ${formatTimestamp(prefs.snooze_until!)}. Scans keep running; nothing is sent.` : undefined}>
            <div className="flex flex-wrap gap-2">
              {SNOOZE.map((s) => (
                <button
                  key={s.days}
                  onClick={() => save({ snooze_until: new Date(Date.now() + s.days * 86_400_000).toISOString() })}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-card px-3 py-2 text-sm text-ink-soft"
                >
                  <MoonStar className="size-4" aria-hidden /> {s.label}
                </button>
              ))}
              {snoozed && (
                <button onClick={() => save({ snooze_until: "" })} className="rounded-xl px-3 py-2 text-sm font-medium text-pine">
                  Wake up now
                </button>
              )}
            </div>
          </Section>

          <p className="mt-8 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            A notification is only sent when the deterministic score (or the fit check) says the trip is good for you, and its
            numbers are copied from cited sources. If you turned personalisation off, scans use neutral weights.
          </p>
        </>
      )}
    </AppShell>
  );
}
