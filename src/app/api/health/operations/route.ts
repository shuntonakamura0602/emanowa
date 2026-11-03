import { jsonResponse } from "@/server/api/response";
import { probeAdminDatabase } from "@/server/admin/pool";
import { getServerRuntimeConfig } from "@/server/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function notReady(): Response {
  return jsonResponse({ status: "not_ready" }, { status: 503 });
}

export async function GET(): Promise<Response> {
  if (!getServerRuntimeConfig().adminOperationsAvailable) return notReady();

  try {
    await probeAdminDatabase();
    return jsonResponse({ status: "ready" });
  } catch {
    console.error("[emanowa:health] operations dependency check failed.");
    return notReady();
  }
}
