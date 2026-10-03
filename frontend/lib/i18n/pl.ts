/** Polish UI copy. Shape is enforced to match en.ts exactly (see lib/i18n/messages/* and i18n.test.ts). */
import * as common from "./messages/common";
import * as home from "./messages/home";
import * as onboarding from "./messages/onboarding";
import * as profile from "./messages/profile";
import * as windows from "./messages/windows";
import * as trips from "./messages/trips";
import * as receipt from "./messages/receipt";
import * as confirm from "./messages/confirm";
import * as survey from "./messages/survey";
import * as inbox from "./messages/inbox";
import type { Messages } from "./en";

export const pl: Messages = {
  common: common.pl,
  home: home.pl,
  onboarding: onboarding.pl,
  profile: profile.pl,
  windows: windows.pl,
  trips: trips.pl,
  receipt: receipt.pl,
  confirm: confirm.pl,
  survey: survey.pl,
  inbox: inbox.pl,
};
