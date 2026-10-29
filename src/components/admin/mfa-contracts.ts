export function normalizeTotpCode(value: string): string | null {
  const normalized = value.replace(/[\s-]/gu, "");
  return /^\d{6}$/u.test(normalized) ? normalized : null;
}

export function totpQrDataUrl(svgOrDataUrl: string): string {
  if (svgOrDataUrl.startsWith("data:image/")) return svgOrDataUrl;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgOrDataUrl)}`;
}

export function firstVerifiedTotpFactorId(
  factors: readonly { id: string; factor_type: string; status: string }[],
): string | null {
  return (
    factors.find(
      (factor) => factor.factor_type === "totp" && factor.status === "verified",
    )?.id ?? null
  );
}
