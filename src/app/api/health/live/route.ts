import { jsonResponse } from "@/server/api/response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(): Response {
  return jsonResponse({ status: "live" });
}
