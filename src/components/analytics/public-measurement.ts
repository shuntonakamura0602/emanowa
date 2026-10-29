"use client";

export const PUBLIC_MEASUREMENT_EVENT = "emanowa:measurement";

type CommonMeasurement = {
  worldSlug: string;
};

export type PublicMeasurement =
  | (CommonMeasurement & { name: "ema_created" })
  | (CommonMeasurement & { name: "share_opened" })
  | (CommonMeasurement & {
      name: "share_clicked";
      channel: "x" | "line";
      linkKind: "public" | "invite";
    })
  | (CommonMeasurement & {
      name: "link_copied";
      linkKind: "public" | "invite";
    })
  | (CommonMeasurement & { name: "share_image_downloaded" })
  | (CommonMeasurement & { name: "invite_landed" })
  | (CommonMeasurement & { name: "invite_ema_created" });

function allowListedMeasurement(
  measurement: PublicMeasurement,
): PublicMeasurement {
  if (!/^\d{4}$/u.test(measurement.worldSlug)) {
    throw new TypeError("measurement worldSlug must be a four-digit year");
  }
  const common = { worldSlug: measurement.worldSlug };
  switch (measurement.name) {
    case "share_clicked":
      if (
        (measurement.channel !== "x" && measurement.channel !== "line") ||
        (measurement.linkKind !== "public" && measurement.linkKind !== "invite")
      ) {
        throw new TypeError("invalid sharing measurement dimension");
      }
      return {
        ...common,
        name: measurement.name,
        channel: measurement.channel,
        linkKind: measurement.linkKind,
      };
    case "link_copied":
      if (
        measurement.linkKind !== "public" &&
        measurement.linkKind !== "invite"
      ) {
        throw new TypeError("invalid link measurement dimension");
      }
      return {
        ...common,
        name: measurement.name,
        linkKind: measurement.linkKind,
      };
    case "ema_created":
    case "share_opened":
    case "share_image_downloaded":
    case "invite_landed":
    case "invite_ema_created":
      return { ...common, name: measurement.name };
  }
}

/**
 * A privacy-minimal, provider-neutral measurement boundary. Consumers may
 * attach a listener during app bootstrap; URLs, public IDs, wish text,
 * nicknames, email addresses and authentication data cannot be supplied by
 * this contract.
 */
export function dispatchPublicMeasurement(
  target: EventTarget,
  measurement: PublicMeasurement,
): boolean {
  const detail = allowListedMeasurement(measurement);
  return target.dispatchEvent(
    new CustomEvent<PublicMeasurement>(PUBLIC_MEASUREMENT_EVENT, {
      detail,
    }),
  );
}

export function measurePublicEvent(measurement: PublicMeasurement): void {
  if (typeof window === "undefined") return;
  try {
    dispatchPublicMeasurement(window, measurement);
  } catch {
    // Measurement must never block sharing or posting.
  }
}
