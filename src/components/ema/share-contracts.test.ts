import { describe, expect, it } from "vitest";

import {
  absoluteShareUrl,
  buildEmaShareLinks,
  emaCanonicalPath,
  emaInvitePath,
  inviteShareText,
  lineShareUrl,
  normalShareText,
  shareImageFilename,
  xIntentUrl,
} from "./share-contracts";

const PUBLIC_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("段階Eの共有URL契約", () => {
  it("作品URLと招待URLを固定pathだけから組み立てる", () => {
    expect(emaCanonicalPath("2027", PUBLIC_ID)).toBe(`/w/2027/e/${PUBLIC_ID}`);
    expect(emaInvitePath("2027", PUBLIC_ID)).toBe(
      `/w/2027/new?near=${PUBLIC_ID}`,
    );

    const links = buildEmaShareLinks(
      "https://user:secret@example.com/current?token=leak#fragment",
      "2027",
      PUBLIC_ID,
    );
    expect(links.publicUrl).toBe(`https://example.com/w/2027/e/${PUBLIC_ID}`);
    expect(links.inviteUrl).toBe(
      `https://example.com/w/2027/new?near=${PUBLIC_ID}`,
    );
    expect(JSON.stringify(links)).not.toMatch(/secret|token|current|fragment/u);
  });

  it("同一originの絶対path以外を共有URLにしない", () => {
    expect(absoluteShareUrl("https://example.com/base", "/w/2027")).toBe(
      "https://example.com/w/2027",
    );
    expect(() => absoluteShareUrl("javascript:alert(1)", "/w/2027")).toThrow(
      TypeError,
    );
    expect(() =>
      absoluteShareUrl("https://example.com", "https://evil.example/path"),
    ).toThrow(TypeError);
    expect(() =>
      absoluteShareUrl("https://example.com", "//evil.example/path"),
    ).toThrow(TypeError);
    expect(() =>
      absoluteShareUrl("https://example.com", "/\\evil.example/path"),
    ).toThrow(TypeError);
  });

  it("願い本文を自動挿入せず、仕様どおりの通常文と招待文を作る", () => {
    const publicUrl = `https://example.com/w/2027/e/${PUBLIC_ID}`;
    const inviteUrl = `https://example.com/w/2027/new?near=${PUBLIC_ID}`;
    const secret = "共有してはいけない固有の願い🎍";

    expect(normalShareText("2027", publicUrl)).toBe(
      `えまのわに、2027年の願いを掛けました。\n${publicUrl}\n#えまのわ`,
    );
    expect(inviteShareText(inviteUrl)).toBe(
      `えまのわに願いを掛けました。よかったら、近くにあなたの願いも掛けてね。\n${inviteUrl}`,
    );
    expect(normalShareText("2027", publicUrl)).not.toContain(secret);
    expect(inviteShareText(inviteUrl)).not.toContain(secret);
  });

  it("XとLINEへ日本語・改行・絵文字をUTF-8で往復できる", () => {
    const url = `https://example.com/w/2027/e/${PUBLIC_ID}`;
    const text = `日本語の共有\n願い🎍✨\n${url}`;
    const x = new URL(xIntentUrl(text));
    const line = new URL(lineShareUrl(url, text));

    expect(x.origin + x.pathname).toBe("https://x.com/intent/tweet");
    expect(x.searchParams.get("text")).toBe(text);
    expect(line.origin + line.pathname).toBe(
      "https://social-plugins.line.me/lineit/share",
    );
    expect(line.searchParams.get("url")).toBe(url);
    expect(line.searchParams.get("text")).toBe(text);
  });

  it("保存ファイル名へpathやqueryを持ち込まない", () => {
    expect(shareImageFilename("2027", PUBLIC_ID)).toBe(
      `emanowa-2027-${PUBLIC_ID}.png`,
    );
    expect(shareImageFilename("../", "../../?token=secret")).toBe(
      "emanowa-world-eece.png",
    );
  });
});
