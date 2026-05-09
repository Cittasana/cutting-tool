import fs from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";
import { FONT_SIZE_BY_STYLE, REEL_WIDTH } from "../config.js";
import type { FontEntry } from "../assets-registry.js";
import type { TextOverlay } from "../schemas.js";

interface RenderOpts {
  overlay: TextOverlay;
  font: FontEntry;
  output: string;
  maxWidthPx?: number;
}

export async function renderTextPng(opts: RenderOpts): Promise<{ width: number; height: number }> {
  const { overlay, font, output } = opts;
  const fontsize = FONT_SIZE_BY_STYLE[overlay.style as keyof typeof FONT_SIZE_BY_STYLE];
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
      fontFiles: [font.path],
      defaultFontFamily: "CT",
    },
  });
  const png = resvg.render().asPng();
  const { width, height } = trimTransparent(resvg);
  await fs.writeFile(output, png);
  return { width: width ?? svgWidth, height: height ?? lineHeight };
}

function trimTransparent(resvg: Resvg): { width?: number; height?: number } {
  const bbox = resvg.getBBox();
  if (!bbox) return {};
  return { width: Math.ceil(bbox.width), height: Math.ceil(bbox.height) };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
