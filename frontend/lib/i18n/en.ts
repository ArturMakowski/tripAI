/** English UI copy, assembled from per-screen namespaces (lib/i18n/messages/*). */
import type { Shape } from "./types";
import * as calendar from "./messages/calendar";
import * as common from "./messages/common";
import * as home from "./messages/home";
import * as onboarding from "./messages/onboarding";
import * as profile from "./messages/profile";
import * as windows from "./messages/windows";
import * as trips from "./messages/trips";
import * as receipt from "./messages/receipt";
import * as confirm from "./messages/confirm";
import * as credits from "./messages/credits";
import * as survey from "./messages/survey";
import * as inbox from "./messages/inbox";

export const en = {
  common: common.en,
  calendar: calendar.en,
  home: home.en,
  onboarding: onboarding.en,
  profile: profile.en,
  windows: windows.en,
  trips: trips.en,
  receipt: receipt.en,
  confirm: confirm.en,
  credits: credits.en,
  survey: survey.en,
  inbox: inbox.en,
};

export type Messages = Shape<typeof en>;
