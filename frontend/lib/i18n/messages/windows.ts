import type { Shape } from "../types";

// Namespace "windows": fill in during the i18n pass. EN is the source of truth; PL must match its shape exactly.
export const en = {} as const;

export const pl: Shape<typeof en> = {};
