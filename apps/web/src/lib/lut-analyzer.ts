/**
 * Pure-JS .cube 3D LUT analyzer.
 *
 * Parses Iridas/Resolve `.cube` text format, samples the LUT at known
 * "natural scene" RGB points (skin tone, sky, foliage, shadow, highlight),
 * and emits a brand-style fingerprint:
 *   - palette_hex: 5 representative hex colors after the LUT is applied
 *   - shadow_tint / midtone_tint / highlight_tint: hue word ("warm cyan", ...)
 *   - contrast_profile: low / medium / high (from min-max spread)
 *   - saturation_profile: muted / natural / vivid
 *   - style_description: a Higgsfield-prompt-friendly sentence
 */

interface LUT3D {
  size: number;
  // Flat array, indexing: r + g*size + b*size*size, each entry is [r,g,b] in [0,1].
  table: Array<[number, number, number]>;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
}

export interface LutAnalysis {
  palette_hex: string[];
  shadow_tint: string;
  midtone_tint: string;
  highlight_tint: string;
  contrast_profile: "low" | "medium" | "high";
  saturation_profile: "muted" | "natural" | "vivid";
  style_description: string;
}

export function parseCubeLut(text: string): LUT3D {
  let size = 0;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  const table: Array<[number, number, number]> = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("TITLE")) continue;
    if (line.startsWith("LUT_3D_SIZE")) {
      size = parseInt(line.split(/\s+/)[1] ?? "0", 10);
      continue;
    }
    if (line.startsWith("LUT_1D_SIZE")) {
      throw new Error("1D LUTs are not supported — upload a 3D LUT (.cube)");
    }
    if (line.startsWith("DOMAIN_MIN")) {
      const p = line.split(/\s+/).slice(1).map(Number);
      if (p.length === 3) domainMin = [p[0]!, p[1]!, p[2]!];
      continue;
    }
    if (line.startsWith("DOMAIN_MAX")) {
      const p = line.split(/\s+/).slice(1).map(Number);
      if (p.length === 3) domainMax = [p[0]!, p[1]!, p[2]!];
      continue;
    }
    const parts = line.split(/\s+/).map(Number);
    if (parts.length === 3 && parts.every((n) => !Number.isNaN(n))) {
      table.push([parts[0]!, parts[1]!, parts[2]!]);
    }
  }

  if (size < 2 || size > 65) {
    throw new Error(`Invalid LUT_3D_SIZE: ${size}`);
  }
  if (table.length !== size ** 3) {
    throw new Error(`Expected ${size ** 3} LUT entries, got ${table.length}`);
  }
  return { size, table, domainMin, domainMax };
}

/**
 * Sample the LUT at a (normalized) RGB point with trilinear interpolation.
 * Input + output channels both in [0,1].
 */
export function sampleLut(lut: LUT3D, r: number, g: number, b: number): [number, number, number] {
  // Normalize input to LUT domain
  const nr = (clamp01(r) - lut.domainMin[0]) / (lut.domainMax[0] - lut.domainMin[0]);
  const ng = (clamp01(g) - lut.domainMin[1]) / (lut.domainMax[1] - lut.domainMin[1]);
  const nb = (clamp01(b) - lut.domainMin[2]) / (lut.domainMax[2] - lut.domainMin[2]);

  const s = lut.size - 1;
  const xr = nr * s, xg = ng * s, xb = nb * s;
  const r0 = Math.floor(xr), g0 = Math.floor(xg), b0 = Math.floor(xb);
  const r1 = Math.min(r0 + 1, s), g1 = Math.min(g0 + 1, s), b1 = Math.min(b0 + 1, s);
  const fr = xr - r0, fg = xg - g0, fb = xb - b0;

  const idx = (ri: number, gi: number, bi: number) => ri + gi * lut.size + bi * lut.size * lut.size;

  const c000 = lut.table[idx(r0, g0, b0)]!;
  const c100 = lut.table[idx(r1, g0, b0)]!;
  const c010 = lut.table[idx(r0, g1, b0)]!;
  const c110 = lut.table[idx(r1, g1, b0)]!;
  const c001 = lut.table[idx(r0, g0, b1)]!;
  const c101 = lut.table[idx(r1, g0, b1)]!;
  const c011 = lut.table[idx(r0, g1, b1)]!;
  const c111 = lut.table[idx(r1, g1, b1)]!;

  // Trilinear interpolation per channel
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const c00 = lerp(c000[c], c100[c], fr);
    const c01 = lerp(c001[c], c101[c], fr);
    const c10 = lerp(c010[c], c110[c], fr);
    const c11 = lerp(c011[c], c111[c], fr);
    const c0 = lerp(c00, c10, fg);
    const c1 = lerp(c01, c11, fg);
    out[c] = lerp(c0, c1, fb);
  }
  return out;
}

const NATURAL_SAMPLE_POINTS: Array<{ name: string; rgb: [number, number, number] }> = [
  { name: "skin (warm)",   rgb: [0.85, 0.65, 0.55] },
  { name: "skin (medium)", rgb: [0.65, 0.50, 0.42] },
  { name: "sky",           rgb: [0.50, 0.70, 0.92] },
  { name: "foliage",       rgb: [0.30, 0.55, 0.30] },
  { name: "concrete",      rgb: [0.55, 0.55, 0.55] },
  { name: "shadow",        rgb: [0.10, 0.10, 0.12] },
  { name: "highlight",     rgb: [0.90, 0.90, 0.92] },
];

export function analyzeLut(lut: LUT3D): LutAnalysis {
  // Sample LUT at natural scene points → palette
  const sampled = NATURAL_SAMPLE_POINTS.map(({ rgb }) => sampleLut(lut, ...rgb));
  const paletteHex = sampled.slice(0, 5).map(([r, g, b]) => rgbToHex(r, g, b));

  // Tint analysis from key tonal regions
  const shadowOut = sampleLut(lut, 0.1, 0.1, 0.1);
  const midOut = sampleLut(lut, 0.5, 0.5, 0.5);
  const highOut = sampleLut(lut, 0.9, 0.9, 0.9);

  const shadowTint = describeTint(shadowOut);
  const midtoneTint = describeTint(midOut);
  const highlightTint = describeTint(highOut);

  // Contrast: spread between dark and bright sample
  const lumaDark = luminance(shadowOut);
  const lumaBright = luminance(highOut);
  const contrastSpread = lumaBright - lumaDark;
  const contrast: LutAnalysis["contrast_profile"] =
    contrastSpread < 0.55 ? "low" : contrastSpread > 0.78 ? "high" : "medium";

  // Saturation: average chroma across natural samples
  const avgSat =
    sampled.reduce((acc, [r, g, b]) => acc + chroma(r, g, b), 0) / sampled.length;
  const sat: LutAnalysis["saturation_profile"] =
    avgSat < 0.12 ? "muted" : avgSat > 0.28 ? "vivid" : "natural";

  const style_description = composeStyleDescription({
    palette: paletteHex,
    shadowTint,
    midtoneTint,
    highlightTint,
    contrast,
    saturation: sat,
  });

  return {
    palette_hex: paletteHex,
    shadow_tint: shadowTint,
    midtone_tint: midtoneTint,
    highlight_tint: highlightTint,
    contrast_profile: contrast,
    saturation_profile: sat,
    style_description,
  };
}

// ============================================================
// Helpers
// ============================================================
function clamp01(x: number) {
  return Math.min(1, Math.max(0, x));
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
function rgbToHex(r: number, g: number, b: number): string {
  const f = (c: number) =>
    Math.round(clamp01(c) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${f(r)}${f(g)}${f(b)}`;
}
function luminance(rgb: [number, number, number]): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}
function chroma(r: number, g: number, b: number): number {
  return Math.max(r, g, b) - Math.min(r, g, b);
}
function describeTint(rgb: [number, number, number]): string {
  const [r, g, b] = rgb;
  const c = chroma(r, g, b);
  if (c < 0.04) return "neutral";

  // Classify dominant + secondary
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const isWarm = r > b;
  const tone = isWarm ? "warm" : "cool";
  let hue = "neutral";
  if (max === r) {
    hue = g > b ? (g - b > 0.05 ? "orange" : "amber") : r - b > 0.1 ? "magenta" : "red";
  } else if (max === g) {
    hue = r > b ? "yellow-green" : b - min > 0.05 ? "teal" : "green";
  } else {
    hue = r > g ? "violet" : g - min > 0.05 ? "cyan" : "blue";
  }
  return `${tone} ${hue}`;
}
function composeStyleDescription(opts: {
  palette: string[];
  shadowTint: string;
  midtoneTint: string;
  highlightTint: string;
  contrast: LutAnalysis["contrast_profile"];
  saturation: LutAnalysis["saturation_profile"];
}): string {
  const palette = opts.palette.slice(0, 5).join(", ");
  return [
    "cinematic color grade,",
    `${opts.contrast} contrast,`,
    `${opts.saturation} saturation,`,
    `shadows tinted ${opts.shadowTint},`,
    `midtones ${opts.midtoneTint},`,
    `highlights ${opts.highlightTint},`,
    `palette ${palette},`,
    "consistent natural skin tones, soft rolled-off highlights, slight halation",
  ].join(" ");
}
