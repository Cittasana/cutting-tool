/**
 * Resolve where to fetch a font / icon / etc from for a given project.
 *
 * Order of precedence:
 *  1. Project's own brand asset (Blob URL stored on brand_preset)
 *  2. Platform default (https://<APP_URL>/brand-defaults/...)
 */

const DEFAULT_ICONS = ["arrow", "checkmark", "email", "play", "star"] as const;
const PUBLIC_BASE = process.env.APP_URL ?? "https://cutting-tool.vercel.app";

export function resolveFontUrl(projectFontUrl: string | null | undefined): string {
  if (projectFontUrl) return projectFontUrl;
  return `${PUBLIC_BASE}/brand-defaults/fonts/Inter-Regular.ttf`;
}

export function resolveIconUrl(name: string, sizePx: 96 | 144 | 192 = 144): string | null {
  const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!DEFAULT_ICONS.includes(slug as (typeof DEFAULT_ICONS)[number])) return null;
  return `${PUBLIC_BASE}/brand-defaults/icons/${slug}@${sizePx}.png`;
}

export function pickIconSizePx(reelHeight: number, sizePct: number): 96 | 144 | 192 {
  const targetPx = (reelHeight * sizePct) / 100;
  if (targetPx <= 110) return 96;
  if (targetPx <= 165) return 144;
  return 192;
}
