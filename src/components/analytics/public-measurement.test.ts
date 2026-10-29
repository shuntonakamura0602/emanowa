import { describe, expect, it, vi } from "vitest";

import {
  PUBLIC_MEASUREMENT_EVENT,
  dispatchPublicMeasurement,
  type PublicMeasurement,
} from "./public-measurement";

describe("P0 public measurement boundary", () => {
  it("dispatches the allow-listed event without a URL or user content", () => {
    const target = new EventTarget();
    const listener = vi.fn();
    target.addEventListener(PUBLIC_MEASUREMENT_EVENT, listener);
    const measurement = {
      name: "share_clicked",
      worldSlug: "2027",
      channel: "line",
      linkKind: "invite",
      secret: "願い本文とtokenを混ぜない",
    } as PublicMeasurement & { secret: string };

    expect(dispatchPublicMeasurement(target, measurement)).toBe(true);
    expect(listener).toHaveBeenCalledOnce();
    const event = listener.mock.calls[0]?.[0] as CustomEvent;
    expect(event.detail).toEqual({
      name: "share_clicked",
      worldSlug: "2027",
      channel: "line",
      linkKind: "invite",
    });
    expect(event.detail).not.toHaveProperty("secret");
    expect(JSON.stringify(event.detail)).not.toMatch(
      /publicId|wish|nickname|email|token|cookie|https?:/iu,
    );
  });

  it("covers every P0 measurement point without a free-form payload", () => {
    const events: PublicMeasurement[] = [
      { name: "ema_created", worldSlug: "2027" },
      { name: "share_opened", worldSlug: "2027" },
      {
        name: "share_clicked",
        worldSlug: "2027",
        channel: "x",
        linkKind: "public",
      },
      {
        name: "link_copied",
        worldSlug: "2027",
        linkKind: "public",
      },
      { name: "share_image_downloaded", worldSlug: "2027" },
      { name: "invite_landed", worldSlug: "2027" },
      { name: "invite_ema_created", worldSlug: "2027" },
    ];

    expect(events.map(({ name }) => name)).toEqual([
      "ema_created",
      "share_opened",
      "share_clicked",
      "link_copied",
      "share_image_downloaded",
      "invite_landed",
      "invite_ema_created",
    ]);
  });
});
