import type { Messages } from "./i18n";
import { PushError } from "./notify";

/**
 * A user-facing error message in the UI language. Client-side failures (push support,
 * permissions, network, timeouts) are translated; a server's own `detail` is shown as sent.
 */
export function errorText(e: unknown, t: Messages): string {
  if (e instanceof PushError) return t.inbox.settings.pushErrors[e.code];
  if (e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError")) return t.common.offline;
  if (e instanceof TypeError) return t.common.offline; // fetch() network failure
  return e instanceof Error && e.message ? e.message : t.common.errorGeneric;
}
