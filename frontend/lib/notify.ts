"use client";

/**
 * T5b client: inbox, prefs, scan-now and web push (backend/src/tripai/api/notify.py).
 * Needs the live backend (NEXT_PUBLIC_API_URL); in fixture mode the inbox explains that instead.
 */
import { create } from "zustand";
import { API_URL, FORCE_MOCK, USER_ID, api } from "./api";
import { DEMO_PROFILE } from "./mock/fixtures";
import type { AppNotification, Inbox, NotificationPrefs, ScanResult } from "./notify-types";
import { useTrip } from "./store";
import type { RankedRecommendation, TasteProfile, Weights } from "./types";

export const NOTIFY_AVAILABLE = !FORCE_MOCK;

async function http<T>(path: string, init?: RequestInit, timeoutMs = 20_000): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const detail = await res.json().then((j) => j?.detail, () => null);
    throw new Error(typeof detail === "string" ? detail : `${init?.method ?? "GET"} ${path} -> ${res.status}`);
  }
  return (await res.json()) as T;
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });
const uid = `user_id=${encodeURIComponent(USER_ID)}`;

export const notifyApi = {
  inbox: () => http<Inbox>(`/notifications?${uid}`),
  markRead: (id: string) => http<AppNotification>(`/notifications/${encodeURIComponent(id)}/read?${uid}`, { method: "POST" }),
  prefs: () => http<NotificationPrefs>(`/notifications/prefs?${uid}`),
  savePrefs: (p: Partial<Omit<NotificationPrefs, "snooze_until">> & { snooze_until?: string }) =>
    http<NotificationPrefs>("/notifications/prefs", json("PUT", { user_id: USER_ID, ...p })),
  runScan: (profile: TasteProfile | null, weights: Weights | null, today?: string) =>
    http<ScanResult>(
      "/scan/run",
      json("POST", { user_id: USER_ID, ...(profile ? { profile: { ...profile, user_id: USER_ID } } : {}), ...(weights ? { weights } : {}), ...(today ? { today } : {}) }),
      90_000,
    ),
  vapidKey: () => http<{ enabled: boolean; public_key: string | null }>("/push/vapid-public-key"),
  subscribe: (sub: PushSubscriptionJSON) => http<NotificationPrefs>("/push/subscribe", json("POST", { user_id: USER_ID, subscription: sub })),
  unsubscribe: (endpoint: string) => http<NotificationPrefs>("/push/subscribe", json("DELETE", { user_id: USER_ID, endpoint })),
  watch: (recommendationId: string) => http<unknown>("/picks", json("POST", { user_id: USER_ID, recommendation_id: recommendationId })),
};

// ------------------------------------------------------------------ unread badge

interface InboxState {
  unread: number;
  setUnread: (n: number) => void;
}
export const useInbox = create<InboxState>()((set) => ({ unread: 0, setUnread: (unread) => set({ unread }) }));

export async function refreshUnread(): Promise<void> {
  if (!NOTIFY_AVAILABLE) return;
  try {
    useInbox.getState().setUnread((await notifyApi.inbox()).unread);
  } catch {
    /* backend asleep: keep the last count */
  }
}

// ------------------------------------------------------------------ open a notification

/** Put the notification's card into the trip store so /trips/[id] can render it. */
export function mergeRec(recs: RankedRecommendation[], rec: RankedRecommendation): RankedRecommendation[] {
  return recs.some((r) => r.id === rec.id) ? recs : [...recs, rec];
}

export async function openNotification(n: AppNotification): Promise<string> {
  const s = useTrip.getState();
  let base = s.recs;
  let mode = s.modes.recs ?? "live";
  if (!base.length) {
    // nothing cached yet: load the normal ranking first so the trips list isn't just this one card
    const { data, mode: m } = await api.recommendations({ profile: s.profile ?? DEMO_PROFILE, weights: s.weights });
    base = data;
    mode = m;
  }
  s.setRecs(mergeRec(base, n.recommendation), { profile: s.profile, weights: s.weights, mode, merge: true });
  if (!n.read_at) {
    notifyApi.markRead(n.id).then(refreshUnread, () => {});
  }
  return n.url;
}

// ------------------------------------------------------------------ web push

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  } catch (err) {
    console.warn("[tripai] service worker registration failed:", err);
    return null;
  }
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/**
 * Must run inside a user tap: asks the browser for permission (the only place we ever do),
 * subscribes with the backend's VAPID key and registers the subscription = explicit opt-in.
 */
export async function enablePush(): Promise<NotificationPrefs> {
  if (!pushSupported()) throw new Error("This browser doesn't support web push (on iPhone: add TripAI to the Home Screen first).");
  const key = await notifyApi.vapidKey();
  if (!key.enabled || !key.public_key) throw new Error("Push isn't configured on the server yet (VAPID keys missing).");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications are blocked for this site in your browser settings.");
  const reg = (await registerServiceWorker()) ?? (await navigator.serviceWorker.ready);
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key.public_key) }));
  return notifyApi.subscribe(sub.toJSON());
}

export async function disablePush(): Promise<NotificationPrefs> {
  const sub = await currentSubscription();
  if (sub) {
    const endpoint = sub.endpoint;
    await sub.unsubscribe().catch(() => false);
    return notifyApi.unsubscribe(endpoint);
  }
  return notifyApi.savePrefs({ push_opt_in: false });
}
