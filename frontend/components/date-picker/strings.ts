/**
 * The date picker's copy now lives in the app-wide i18n (lib/i18n/messages/calendar.ts), so it
 * follows the global PL/EN setting. This module only keeps the type the components import.
 */
import type { Messages } from "@/lib/i18n";

export type DatePickerStrings = Messages["calendar"];
