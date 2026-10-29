import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { NewEmaFlow } from "@/components/ema/new-ema-flow";
import {
  initialSlotNumberFromLocationQuery,
  type InviteContext,
} from "@/components/ema/ui-contracts";
import { PageIntro, WorldBreadcrumb } from "@/components/site-shell";
import { getWorldConfig } from "@/config/worlds";
import { publicIdSchema } from "@/domain";
import { getPublicRuntimeConfig } from "@/server/config";
import {
  getNearbySlots,
  getPublicEma,
  getPublicWorld,
} from "@/server/ema/repository";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const query = await searchParams;
  return query.near === undefined
    ? { title: "願いを書く" }
    : {
        title: "近くに願いを書く",
        robots: {
          index: false,
          follow: false,
          noarchive: true,
          noimageindex: true,
        },
      };
}

export default async function NewEmaPage({
  params,
  searchParams,
}: {
  params: Promise<{ worldSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { worldSlug } = await params;
  if (!getWorldConfig(worldSlug)) {
    notFound();
  }
  const query = await searchParams;
  const runtimeConfig = getPublicRuntimeConfig();
  const inviteContext =
    query.near === undefined
      ? null
      : await resolveInviteContext(
          worldSlug,
          query.near,
          runtimeConfig.services.persistenceConfigured,
        );
  const initialSlotNumber = initialSlotNumberFromLocationQuery(query);
  const flowKey = [
    worldSlug,
    typeof query.near === "string" ? query.near : "direct",
    inviteContext?.status ?? "direct",
    inviteContext?.candidates
      .map((candidate) => candidate.slotNumber)
      .join(",") ?? "",
  ].join(":");

  return (
    <section className="container page-section">
      <WorldBreadcrumb worldSlug={worldSlug} current="絵馬を書く" />
      <PageIntro eyebrow="新しい絵馬" title="願いを書く">
        <p>
          願いと公開範囲、掛ける場所を選び、公開時の見え方を確認してから保存します。
        </p>
      </PageIntro>
      <NewEmaFlow
        key={flowKey}
        worldSlug={worldSlug}
        captchaSiteKey={runtimeConfig.captchaSiteKey}
        captchaRequired={runtimeConfig.captchaRequired}
        initialSlotNumber={initialSlotNumber}
        inviteContext={inviteContext}
      />
    </section>
  );
}

async function resolveInviteContext(
  worldSlug: string,
  rawNear: string | string[],
  persistenceConfigured: boolean,
): Promise<InviteContext> {
  const parsedNear = publicIdSchema.safeParse(rawNear);
  if (!parsedNear.success || !persistenceConfigured) {
    return unavailableInvite(parsedNear.success ? parsedNear.data : null);
  }

  try {
    const [source, nearby, world] = await Promise.all([
      getPublicEma(worldSlug, parsedNear.data),
      getNearbySlots(worldSlug, { near: parsedNear.data }),
      getPublicWorld(worldSlug),
    ]);
    if (!source || !nearby || !world) {
      return unavailableInvite(parsedNear.data);
    }

    const status: InviteContext["status"] =
      world.stats.occupiedCount >= world.world.width * world.world.height
        ? "world_full"
        : !world.world.acceptingPosts
          ? "not_accepting"
          : nearby.candidates.length === 0
            ? "no_candidates"
            : "ready";
    return {
      nearPublicId: parsedNear.data,
      source,
      origin: nearby.origin,
      candidates: nearby.candidates,
      searchedRadius: nearby.searchedRadius,
      status,
    };
  } catch {
    return unavailableInvite(parsedNear.data);
  }
}

function unavailableInvite(nearPublicId: string | null): InviteContext {
  return {
    nearPublicId,
    source: null,
    origin: null,
    candidates: [],
    searchedRadius: null,
    status: "unavailable",
  };
}
