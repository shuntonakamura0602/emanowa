const X_INTENT_ORIGIN = "https://x.com";
const LINE_SHARE_ORIGIN = "https://social-plugins.line.me";

function encodedSegment(value: string): string {
  return encodeURIComponent(value);
}

function shareOrigin(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TypeError("共有URLのoriginはhttpまたはhttpsで指定してください");
  }
  return parsed.origin;
}

export function emaCanonicalPath(worldSlug: string, publicId: string): string {
  return `/w/${encodedSegment(worldSlug)}/e/${encodedSegment(publicId)}`;
}

export function emaInvitePath(worldSlug: string, publicId: string): string {
  const path = `/w/${encodedSegment(worldSlug)}/new`;
  const query = new URLSearchParams({ near: publicId });
  return `${path}?${query.toString()}`;
}

export function emaSquareImagePath(
  worldSlug: string,
  publicId: string,
): string {
  const path = `/api/v1/worlds/${encodedSegment(worldSlug)}/emas/${encodedSegment(publicId)}/image`;
  return `${path}?variant=square`;
}

export function absoluteShareUrl(origin: string, path: string): string {
  if (!path.startsWith("/")) {
    throw new TypeError("共有先は同一originの絶対パスで指定してください");
  }
  const baseOrigin = shareOrigin(origin);
  const target = new URL(path, baseOrigin);
  if (target.origin !== baseOrigin) {
    throw new TypeError("共有先は同一originの絶対パスで指定してください");
  }
  return target.toString();
}

export function normalShareText(worldYear: string, publicUrl: string): string {
  return `えまのわに、${worldYear}年の願いを掛けました。\n${publicUrl}\n#えまのわ`;
}

export function inviteShareText(inviteUrl: string): string {
  return `えまのわに願いを掛けました。よかったら、近くにあなたの願いも掛けてね。\n${inviteUrl}`;
}

export function xIntentUrl(text: string): string {
  const target = new URL("/intent/tweet", X_INTENT_ORIGIN);
  target.searchParams.set("text", text);
  return target.toString();
}

export function lineShareUrl(url: string, text: string): string {
  const target = new URL("/lineit/share", LINE_SHARE_ORIGIN);
  target.searchParams.set("url", url);
  target.searchParams.set("text", text);
  return target.toString();
}

export function shareImageFilename(
  worldSlug: string,
  publicId: string,
): string {
  const safeWorld = worldSlug.replace(/[^0-9]/gu, "");
  const safeId = publicId.toLowerCase().replace(/[^0-9a-f-]/gu, "");
  return `emanowa-${safeWorld || "world"}-${safeId || "ema"}.png`;
}

export type EmaShareLinks = {
  publicUrl: string;
  inviteUrl: string;
  imageUrl: string;
  normalText: string;
  inviteText: string;
  xUrl: string;
  lineUrl: string;
  inviteLineUrl: string;
};

export function buildEmaShareLinks(
  origin: string,
  worldSlug: string,
  publicId: string,
): EmaShareLinks {
  const publicUrl = absoluteShareUrl(
    origin,
    emaCanonicalPath(worldSlug, publicId),
  );
  const inviteUrl = absoluteShareUrl(
    origin,
    emaInvitePath(worldSlug, publicId),
  );
  const imageUrl = absoluteShareUrl(
    origin,
    emaSquareImagePath(worldSlug, publicId),
  );
  const normalText = normalShareText(worldSlug, publicUrl);
  const inviteText = inviteShareText(inviteUrl);
  return {
    publicUrl,
    inviteUrl,
    imageUrl,
    normalText,
    inviteText,
    xUrl: xIntentUrl(normalText),
    lineUrl: lineShareUrl(publicUrl, normalText),
    inviteLineUrl: lineShareUrl(inviteUrl, inviteText),
  };
}
