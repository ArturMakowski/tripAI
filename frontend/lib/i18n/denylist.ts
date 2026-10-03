// Shared by the "no implementation details in the UI" tests.
/** Internal tech / vendor / framework terms that must never reach a screen. */
export const DENYLIST: RegExp[] = [
  /\bjev\b/i,
  /\bgpt\b|gpt-\d/i,
  /openai/i,
  /\bllm\b/i,
  /pydantic/i,
  /\bdbos\b/i,
  /\bworkflow\b/i,
  /sha-?256/i,
  /\bscorer\b/i,
  /scoring version|scorer version|wersj[ai] kalkulatora/i,
  /supabase/i,
  /\bvapid\b/i,
  /\bfixtures?\b/i,
  /serpapi/i,
  /\bserper\b/i,
  /travelpayouts/i,
  /liteapi/i,
  /typesafe/i,
  /\bbackend\b/i,
  /\bP\(worth|P\(warto/,
  /\bosrm\b/i,
  /\bcache[ds]?\b/i,
];

