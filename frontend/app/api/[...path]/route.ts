/** Same-origin API: the browser calls /api/*, this forwards to the private backend (lib/proxy.ts). */
import { proxy } from "@/lib/proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const handler = (req: Request) => proxy(req);
export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE, handler as OPTIONS };
