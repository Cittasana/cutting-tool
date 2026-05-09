import fs from "node:fs";
import path from "node:path";
import { FONTS_DIR, ICONS_DIR } from "./config.js";
import type { Language } from "./schemas.js";

export interface FontEntry {
  name: string;
  language: Language;
  path: string;
}

export interface IconEntry {
  name: string;
  paths: { 96: string; 144: string; 192: string };
}

const FONT_DEFAULTS: Record<Language, string> = {
  de: "Inter-Regular",
  en: "Inter-Regular",
};

let fontCache: Map<string, FontEntry> | null = null;
let iconCache: Map<string, IconEntry> | null = null;

export function loadFontRegistry(): Map<string, FontEntry> {
  if (fontCache) return fontCache;
  const map = new Map<string, FontEntry>();
  for (const lang of ["de", "en"] as const) {
    const dir = path.join(FONTS_DIR, lang);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!/\.(ttf|otf)$/i.test(file)) continue;
      const name = file.replace(/\.(ttf|otf)$/i, "");
      map.set(`${lang}:${name}`, {
        name,
        language: lang,
        path: path.join(dir, file),
      });
    }
  }
  fontCache = map;
  return map;
}

export function resolveFont(language: Language, requested?: string): FontEntry {
  const reg = loadFontRegistry();
  const wanted = requested ?? FONT_DEFAULTS[language];
  const direct = reg.get(`${language}:${wanted}`);
  if (direct) return direct;
  for (const [key, entry] of reg) {
    if (entry.language === language && entry.name.toLowerCase() === wanted.toLowerCase()) {
      return entry;
    }
    if (key.split(":")[1]?.toLowerCase() === wanted.toLowerCase()) return entry;
  }
  throw new Error(
    `Font not found: requested "${wanted}" for language "${language}". ` +
      `Available: ${[...reg.keys()].join(", ") || "(none — run `pnpm build:assets` and check assets/fonts/)"}`,
  );
}

export function loadIconRegistry(): Map<string, IconEntry> {
  if (iconCache) return iconCache;
  const map = new Map<string, IconEntry>();
  if (!fs.existsSync(ICONS_DIR)) {
    iconCache = map;
    return map;
  }
  const grouped = new Map<string, Partial<IconEntry["paths"]>>();
  for (const file of fs.readdirSync(ICONS_DIR)) {
    const m = file.match(/^([a-z0-9-]+)@(96|144|192)\.png$/i);
    if (!m) continue;
    const [, name, sizeStr] = m;
    const size = Number(sizeStr) as 96 | 144 | 192;
    const partial = grouped.get(name!) ?? {};
    partial[size] = path.join(ICONS_DIR, file);
    grouped.set(name!, partial);
  }
  for (const [name, partial] of grouped) {
    if (partial[96] && partial[144] && partial[192]) {
      map.set(name, {
        name,
        paths: partial as IconEntry["paths"],
      });
    }
  }
  iconCache = map;
  return map;
}

export function resolveIcon(name: string): IconEntry {
  const reg = loadIconRegistry();
  const entry = reg.get(name);
  if (!entry) {
    throw new Error(
      `Icon not found: "${name}". Available: ${[...reg.keys()].join(", ") || "(none — run `pnpm build:assets`)"}`,
    );
  }
  return entry;
}

export function pickIconSizePx(reelHeight: number, sizePct: number): 96 | 144 | 192 {
  const targetPx = (reelHeight * sizePct) / 100;
  if (targetPx <= 110) return 96;
  if (targetPx <= 165) return 144;
  return 192;
}

export function validateAssetsForStoryboard(
  language: Language,
  fontDe: string | undefined,
  fontEn: string | undefined,
  iconNames: Iterable<string>,
): void {
  resolveFont("de", fontDe ?? FONT_DEFAULTS.de);
  resolveFont("en", fontEn ?? FONT_DEFAULTS.en);
  resolveFont(language, language === "de" ? fontDe : fontEn);
  for (const n of iconNames) resolveIcon(n);
}
