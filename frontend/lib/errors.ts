import type { Messages } from "./i18n";
import { PushError } from "./notify";

/**
 * A user-facing error message in the UI language. Client-side failures (push support,
 * permissions, network, timeouts) are translated; a server's own `detail` is shown as sent, but
 * never a raw request line ("POST /notifications/scan -> 500 {...}"): that reads as the generic error.
 */
export function errorText(e: unknown, t: Messages): string {
  if (e instanceof PushError) return t.inbox.settings.pushErrors[e.code];
  if (e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError")) return t.common.offline;
  if (e instanceof TypeError) return t.common.offline; // fetch() network failure
  const msg = e instanceof Error ? e.message : "";
  if (!msg || /^(GET|POST|PUT|PATCH|DELETE)\s+\/|->\s*\d{3}/.test(msg)) return t.common.errorGeneric;
  return msg;
}
