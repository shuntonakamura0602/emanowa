import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

import type { PublicEma } from "@/domain";

import { createEmaImageModel, type EmaImageVariant } from "./ema-image-model";

const notoSansJp = readFile(
  join(process.cwd(), "assets/fonts/NotoSansJP-Regular.otf"),
).then(
  (font) =>
    font.buffer.slice(
      font.byteOffset,
      font.byteOffset + font.byteLength,
    ) as ArrayBuffer,
);

export async function renderEmaImage(
  ema: PublicEma,
  variant: EmaImageVariant,
): Promise<Uint8Array> {
  const model = createEmaImageModel(ema, variant);
  const font = await notoSansJp;
  const square = variant === "square";

  const response = new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: "#f7f1e5",
        color: "#3f2e28",
        padding: square ? "70px" : "48px 72px",
        fontFamily: "Noto Sans JP",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "18px",
            color: "#7a2e2e",
            fontSize: square ? 44 : 34,
            letterSpacing: "0.08em",
          }}
        >
          <div
            style={{
              width: square ? 66 : 52,
              height: square ? 66 : 52,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "4px solid #7a2e2e",
              borderRadius: "999px",
              fontSize: square ? 36 : 28,
            }}
          >
            わ
          </div>
          えまのわ
        </div>
        <div
          style={{
            display: "flex",
            gap: "18px",
            color: "#68554c",
            fontSize: square ? 28 : 24,
          }}
        >
          <span>{model.yearLabel}</span>
          <span>{model.slotLabel}</span>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          alignSelf: "center",
          width: 760,
          minHeight: square ? 690 : 390,
          padding: square ? "105px 78px 70px" : "78px 66px 50px",
          boxSizing: "border-box",
          border: "3px solid #a9793d",
          borderRadius: square ? "72px 72px 34px 34px" : "52px 52px 26px 26px",
          background: "#e9c98d",
          boxShadow: "0 24px 45px rgba(75, 55, 38, 0.16)",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: square ? 390 : 220,
            color: model.messageIsPrivate ? "#715d50" : "#382820",
            fontSize: square ? 34 : 28,
            lineHeight: 1.58,
            textAlign: "center",
          }}
        >
          {model.messageLines.map((line, index) => (
            <div key={`${index}:${line}`} style={{ display: "flex" }}>
              {line || "　"}
            </div>
          ))}
        </div>
        <div
          style={{
            display: "flex",
            marginTop: square ? 38 : 20,
            color: "#68554c",
            fontSize: square ? 27 : 22,
          }}
        >
          {model.nickname}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          color: "#76655c",
          fontSize: square ? 24 : 20,
        }}
      >
        <span>みんなの願いが集まる、オンライン絵馬</span>
        <span>{model.replacedEmoji ? "◇ は絵文字を表します" : "emanowa"}</span>
      </div>
    </div>,
    {
      width: model.width,
      height: model.height,
      fonts: [
        {
          name: "Noto Sans JP",
          data: font,
          style: "normal",
          weight: 400,
        },
      ],
    },
  );

  if (!response.ok) {
    throw new Error("ema image renderer returned an unsuccessful response");
  }
  return new Uint8Array(await response.arrayBuffer());
}
