import { Resvg } from "@resvg/resvg-js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import type { TextOverlay } from "@cutting-tool/core";

const FONT_SIZE_BY_STYLE = {
  headline: 88,
  subtitle: 56,
  caption: 40,
} as const;

const REEL_WIDTH = 1080;

let cachedFontPath: string | null = null;
let cachedFontHash: string | null = null;

/**
 * Resvg-js (v2.x) accepts only on-disk font paths. We persist the font
 * Buffer to /tmp once per cold function invocation and reuse the path.
 */
async function ensureFontOnDisk(fontBuffer: Buffer): Promise<string> {
  const hash = createHash("sha1").update(fontBuffer).digest("hex").slice(0, 16);
  if (cachedFontPath && cachedFontHash === hash) return cachedFontPath;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ct-font-"));
  const file = path.join(dir, `${hash}.ttf`);
  await fs.writeFile(file, fontBuffer);
  cachedFontPath = file;
  cachedFontHash = hash;
  return file;
}

/**
 * Render a text overlay to a PNG buffer using a project's font.
 * Output is white text + black stroke on transparent background.
 */
export async function renderTextOverlayPng(opts: {
  overlay: TextOverlay;
  fontBuffer: Buffer;
  maxWidthPx?: number;
}): Promise<Buffer> {
  const { overlay, fontBuffer } = opts;
  const fontPath = await ensureFontOnDisk(fontBuffer);
  const fontsize =
    FONT_SIZE_BY_STYLE[overlay.style as keyof typeof FONT_SIZE_BY_STYLE] ??
    FONT_SIZE_BY_STYLE.subtitle;
  const maxWidth = opts.maxWidthPx ?? Math.round(REEL_WIDTH * 0.86);

  const escaped = escapeXml(overlay.value);
  const lineHeight = Math.round(fontsize * 1.2);
  const padX = Math.round(fontsize * 0.6);
  const padY = Math.round(fontsize * 0.4);
  const svgWidth = maxWidth + padX * 2;
  const svgHeight = lineHeight * 4 + padY * 2;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}">
  <text x="${svgWidth / 2}" y="${lineHeight / 2 + padY}"
        font-family="CT, sans-serif" font-size="${fontsize}"
        fill="white" stroke="rgba(0,0,0,0.85)" stroke-width="6"
        paint-order="stroke fill" text-anchor="middle" dominant-baseline="middle">${escaped}</text>
</svg>`;

  const resvg = new Resvg(svg, {
    background: "rgba(0,0,0,0)",
    fitTo: { mode: "width", value: svgWidth },
    font: {
      loadSystemFonts: false,
      fontFiles: [fontPath],
      defaultFontFamily: "CT",
    },
  });
  return Buffer.from(resvg.render().asPng());
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
