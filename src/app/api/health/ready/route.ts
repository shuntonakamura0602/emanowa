import { jsonResponse } from "@/server/api/response";
import { getServerRuntimeConfig } from "@/server/config";
import { getPublicWorld } from "@/server/ema/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function notReady(): Response {
  return jsonResponse({ status: "not_ready" }, { status: 503 });
}

export async function GET(): Promise<Response> {
  const config = getServerRuntimeConfig();
  if (!config.publicationReady) return notReady();

  try {
    const world = await getPublicWorld(config.featuredWorld.slug);
    if (!world) return notReady();
    return jsonResponse({ status: "ready" });
  } catch {
    console.error("[emanowa:health] readiness dependency check failed.");
    return notReady();
  }
}
