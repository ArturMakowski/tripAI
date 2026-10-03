/**
 * Mirror of backend/src/tripai/notify/models.py (T5b proactive scan + notifications)
 * and the bodies in backend/src/tripai/api/notify.py. Dates are ISO strings on the wire.
 */
import type { Evidence, RankedRecommendation, ScoreBreakdown } from "./types";

export type NotificationKind = "new_top" | "price_drop" | "long_weekend" | "target_price";

export interface FitPoint {
  text: string;
  dna: string[];
  evidence: number[];
}

export interface AppNotification {
  id: string;
  user_id: string;
  kind: NotificationKind;
  title: string;
  body: string; // every number comes from `recommendation` / `evidence`
  recommendation_id: string;
  inputs_hash: string;
  scoring_version: string;
  why: string;
  evidence: Evidence[];
  score: ScoreBreakdown;
  fit_label: string | null;
  fit_summary: string | null;
  concerns: FitPoint[];
  recommendation: RankedRecommendation;
  url: string; // "/trips/{id}"
  dedupe_key: string;
  scan_run_id: string | null;
  created_at: string;
  read_at: string | null;
  pushed_at: string | null;
  push_status: string | null; // "sent:N" | "inbox_only" (Jev gate) | "not_opted_in" | ...
  interrupt_p: number | null; // Jev: P(worth interrupting); push only if interrupt_ok (p >= 0.8)
  interrupt_ok: boolean | null;
  interrupt_source: string | null; // "jev" | "rules"
}

export interface Inbox {
  items: AppNotification[];
  unread: number;
}

export interface NotificationPrefs {
  user_id: string;
  push_opt_in: boolean;
  max_per_week: number;
  muted_cities: string[];
  snooze_until: string | null;
  updated_at: string;
}

export interface Decision {
  kind: NotificationKind;
  recommendation_id: string | null;
  notify: boolean;
  reason: string;
}

export interface ScanRun {
  id: string;
  user_id: string;
  mode: "dbos" | "sync";
  workflow_id: string | null;
  today: string;
  started_at: string;
  finished_at: string | null;
  personalized: boolean;
  windows: number;
  candidates: number;
  top_id: string | null;
  top_city: string | null;
  top_score: number | null;
  inputs_hash: string | null;
  prices: Record<string, number>;
  decisions: Decision[];
  notification_ids: string[];
  error: string | null;
}

export interface ScanResult {
  run: ScanRun;
  notifications: AppNotification[];
}
