import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { EmaDetailLive } from "@/components/ema/ema-detail-live";
import { emaCanonicalPath } from "@/components/ema/share-contracts";
import { WorldBreadcrumb } from "@/components/site-shell";
import { getWorldConfig } from "@/config/worlds";
import { publicIdSchema } from "@/domain";
import {
  getPublicRuntimeConfig,
  getServerRuntimeConfig,
} from "@/server/config";
import { getPublicEma } from "@/server/ema/repository";

export const dynamic = "force-dynamic";

type PageParams = Promise<{ worldSlug: string; publicId: string }>;

const readPublicEma = cache(async (worldSlug: string, publicId: string) =>
  getPublicEma(worldSlug, publicId),
);

function imagePath(
  worldSlug: string,
  publicId: string,
  variant: "og" | "square",
): string {
  return `/api/v1/worlds/${encodeURIComponent(worldSlug)}/emas/${encodeURIComponent(publicId)}/image?variant=${variant}`;
}

function absoluteSiteUrl(path: string): URL {
  const origin = getServerRuntimeConfig().appOrigin ?? "http://localhost:3000";
  return new URL(path, origin);
}

async function resolveEma(params: PageParams) {
  const { worldSlug, publicId } = await params;
  if (
    !getWorldConfig(worldSlug) ||
    !publicIdSchema.safeParse(publicId).success
  ) {
    return null;
  }
  return readPublicEma(worldSlug, publicId);
}

export async function generateMetadata({
  params,
}: {
  params: PageParams;
}): Promise<Metadata> {
  const ema = await resolveEma(params);
  if (!ema) {
    return {
      title: "絵馬が見つかりません",
      robots: { index: false, follow: false, noarchive: true },
    };
  }

  const title = `${ema.nickname ?? "ななしさん"}の絵馬`;
  const description =
    ema.messageText === null
      ? `${ema.worldSlug}年のえまのわに掛けられた、本文をひみつにした絵馬です。`
      : ema.messageText;
  const canonicalUrl = absoluteSiteUrl(
    emaCanonicalPath(ema.worldSlug, ema.publicId),
  );
  const imageUrl = absoluteSiteUrl(
    imagePath(ema.worldSlug, ema.publicId, "og"),
  );

  return {
    title,
    description,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      type: "website",
      locale: "ja_JP",
      siteName: "えまのわ",
      title,
      description,
      url: canonicalUrl,
      images: [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: `${ema.worldSlug}年のえまのわの絵馬`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl],
    },
    ...(ema.visibility === "unlisted"
      ? {
          robots: {
            index: false,
            follow: false,
            noarchive: true,
            noimageindex: true,
          },
        }
      : {}),
  };
}

export default async function EmaDetailPage({
  params,
}: {
  params: PageParams;
}) {
  const { worldSlug, publicId } = await params;
  if (
    !getWorldConfig(worldSlug) ||
    !publicIdSchema.safeParse(publicId).success
  ) {
    notFound();
  }
  const ema = await readPublicEma(worldSlug, publicId);
  if (!ema) notFound();
  const runtimeConfig = getPublicRuntimeConfig();

  return (
    <section className="container page-section">
      <WorldBreadcrumb worldSlug={worldSlug} current="絵馬の詳細" />
      <EmaDetailLive
        initialEma={ema}
        configuredOrigin={runtimeConfig.appOrigin}
        captchaSiteKey={runtimeConfig.captchaSiteKey}
        captchaRequired={runtimeConfig.captchaRequired}
      />
    </section>
  );
}
