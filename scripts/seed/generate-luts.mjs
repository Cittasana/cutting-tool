#!/usr/bin/env node
/**
 * Generate a starter library of 33×33×33 3D LUTs (.cube format).
 *
 * No third-party LUT files are bundled — every grade is computed from a
 * Lift/Gamma/Gain + Saturation + Contrast model + per-luma tint blends.
 * That keeps licensing clean and the looks reproducible.
 *
 * Output:
 *   apps/web/public/brand-library/luts/<id>.cube
 *   apps/web/public/brand-library/manifest.json (palette swatches for UI)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../../apps/web/public/brand-library/luts");
const MANIFEST = path.resolve(__dirname, "../../apps/web/public/brand-library/manifest.json");

const SIZE = 33;

function clamp01(x) {
  return Math.min(1, Math.max(0, x));
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}
function rgbToHex(r, g, b) {
  const f = (c) => Math.round(clamp01(c) * 255).toString(16).padStart(2, "0");
  return `#${f(r)}${f(g)}${f(b)}`;
}
function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Apply Lift/Gamma/Gain per channel + saturation + contrast S-curve +
 * shadow/highlight color tinting.
 */
function applyGrade(rgb, look) {
  let [r, g, b] = rgb;

  // 1. Lift / Gamma / Gain (per channel)
  const lgg = (v, lift, gamma, gain) =>
    Math.pow(clamp01(v * gain + lift), 1 / Math.max(0.01, gamma));
  r = lgg(r, look.lift[0], look.gamma[0], look.gain[0]);
  g = lgg(g, look.lift[1], look.gamma[1], look.gain[1]);
  b = lgg(b, look.lift[2], look.gamma[2], look.gain[2]);

  // 2. Saturation around per-pixel luma
  const Y = luma(r, g, b);
  r = Y + (r - Y) * look.sat;
  g = Y + (g - Y) * look.sat;
  b = Y + (b - Y) * look.sat;

  // 3. Contrast S-curve around 0.5
  if (look.contrast !== 1) {
    const c = look.contrast;
    const sc = (v) => clamp01(0.5 + (v - 0.5) * c);
    r = sc(r);
    g = sc(g);
    b = sc(b);
  }

  // 4. Shadow / highlight tint (blend toward target colors weighted by luma)
  if (look.shadowTint || look.highlightTint) {
    const Y2 = luma(r, g, b);
    if (look.shadowTint) {
      const w = (1 - Y2) * look.shadowStrength;
      const [tr, tg, tb] = hexToRgb(look.shadowTint);
      r = lerp(r, (r + tr) / 2, w);
      g = lerp(g, (g + tg) / 2, w);
      b = lerp(b, (b + tb) / 2, w);
    }
    if (look.highlightTint) {
      const w = Y2 * look.highlightStrength;
      const [tr, tg, tb] = hexToRgb(look.highlightTint);
      r = lerp(r, (r + tr) / 2, w);
      g = lerp(g, (g + tg) / 2, w);
      b = lerp(b, (b + tb) / 2, w);
    }
  }

  return [clamp01(r), clamp01(g), clamp01(b)];
}

function writeCube(filename, title, look) {
  const lines = [
    `TITLE "${title}"`,
    `LUT_3D_SIZE ${SIZE}`,
    "DOMAIN_MIN 0.0 0.0 0.0",
    "DOMAIN_MAX 1.0 1.0 1.0",
    "",
  ];
  // Iteration order per .cube spec: blue varies fastest, then green, then red.
  for (let bIdx = 0; bIdx < SIZE; bIdx++) {
    for (let gIdx = 0; gIdx < SIZE; gIdx++) {
      for (let rIdx = 0; rIdx < SIZE; rIdx++) {
        const r = rIdx / (SIZE - 1);
        const g = gIdx / (SIZE - 1);
        const b = bIdx / (SIZE - 1);
        const [or, og, ob] = applyGrade([r, g, b], look);
        lines.push(`${or.toFixed(6)} ${og.toFixed(6)} ${ob.toFixed(6)}`);
      }
    }
  }
  fs.writeFileSync(filename, lines.join("\n") + "\n");
}

// Sample 5 natural-scene RGB points through the grade for palette display.
const NATURAL_POINTS = [
  [0.85, 0.65, 0.55], // skin warm
  [0.5, 0.7, 0.92],   // sky
  [0.3, 0.55, 0.3],   // foliage
  [0.55, 0.55, 0.55], // concrete
  [0.1, 0.1, 0.12],   // shadow
];

function paletteFor(look) {
  return NATURAL_POINTS.map(([r, g, b]) => {
    const [or, og, ob] = applyGrade([r, g, b], look);
    return rgbToHex(or, og, ob);
  });
}

// ============================================================
// Six market-inspired looks
// ============================================================
const LOOKS = [
  {
    id: "neutral-doc",
    name: "Neutral / Documentary",
    description:
      "Minimaler Lift in Schatten, leichte Skin-Wärme, kein dramatischer Color-Cast. Default für 'kenne-meine-Marke-noch-nicht'-Kunden.",
    tags: ["natural", "balanced", "documentary"],
    look: {
      lift: [0.005, 0, -0.005],
      gamma: [1.0, 1.0, 1.0],
      gain: [1.02, 1.0, 0.99],
      sat: 1.0,
      contrast: 1.05,
      shadowTint: null,
      highlightTint: null,
      shadowStrength: 0,
      highlightStrength: 0,
    },
  },
  {
    id: "warm-editorial",
    name: "Warm Editorial",
    description:
      "Warme Highlights, leicht entsättigte Greens, satte Skin-Tones. Lifestyle / Coaching / Solo-Brand.",
    tags: ["warm", "lifestyle", "skin-positive"],
    look: {
      lift: [0.02, 0.005, -0.01],
      gamma: [1.04, 1.0, 0.96],
      gain: [1.06, 1.0, 0.95],
      sat: 1.05,
      contrast: 1.08,
      shadowTint: "#3a2a1f",
      highlightTint: "#f0c896",
      shadowStrength: 0.25,
      highlightStrength: 0.35,
    },
  },
  {
    id: "cool-modern",
    name: "Cool Modern",
    description:
      "Kühle Schatten mit Cyan, neutrale Highlights, hoher Mikro-Kontrast. SaaS / Tech / B2B.",
    tags: ["cool", "tech", "high-contrast"],
    look: {
      lift: [-0.01, 0, 0.025],
      gamma: [0.97, 1.0, 1.04],
      gain: [0.97, 1.0, 1.05],
      sat: 0.95,
      contrast: 1.15,
      shadowTint: "#1f2a3a",
      highlightTint: "#dde6ee",
      shadowStrength: 0.3,
      highlightStrength: 0.2,
    },
  },
  {
    id: "filmic-teal-orange",
    name: "Filmic Teal-Orange",
    description:
      "Klassischer Hollywood-Look. Cyan in Shadows, Orange in Highlights, ausgeglichene Skin-Tones. Premium / Reise / High-End.",
    tags: ["cinematic", "premium", "teal-orange"],
    look: {
      lift: [-0.015, -0.005, 0.025],
      gamma: [0.93, 0.98, 1.04],
      gain: [1.04, 1.0, 0.93],
      sat: 1.05,
      contrast: 1.12,
      shadowTint: "#1c3845",
      highlightTint: "#e0a075",
      shadowStrength: 0.45,
      highlightStrength: 0.45,
    },
  },
  {
    id: "punchy-social",
    name: "Punchy Social",
    description:
      "Boost Saturation + Contrast für scroll-stopping Reels. Optimiert für TikTok / Instagram-Algorithmus.",
    tags: ["high-sat", "social", "punchy"],
    look: {
      lift: [0, 0, 0],
      gamma: [0.95, 0.95, 0.95],
      gain: [1.05, 1.05, 1.05],
      sat: 1.28,
      contrast: 1.22,
      shadowTint: null,
      highlightTint: null,
      shadowStrength: 0,
      highlightStrength: 0,
    },
  },
  {
    id: "vintage-faded",
    name: "Vintage Faded",
    description:
      "Milchige Schatten, gedämpfte Highlights, leichter Grün-Blau-Stich. Nostalgia / Storytelling / Throwback.",
    tags: ["vintage", "faded", "low-contrast"],
    look: {
      lift: [0.06, 0.06, 0.07],
      gamma: [1.05, 1.0, 0.98],
      gain: [0.92, 0.92, 0.94],
      sat: 0.78,
      contrast: 0.88,
      shadowTint: "#2e3a3e",
      highlightTint: "#d8d0b0",
      shadowStrength: 0.3,
      highlightStrength: 0.3,
    },
  },
];

// ============================================================
// Run
// ============================================================
fs.mkdirSync(OUT_DIR, { recursive: true });

const manifest = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  luts: LOOKS.map((entry) => {
    const cubePath = path.join(OUT_DIR, `${entry.id}.cube`);
    writeCube(cubePath, entry.name, entry.look);
    const palette = paletteFor(entry.look);
    return {
      id: entry.id,
      name: entry.name,
      description: entry.description,
      tags: entry.tags,
      url: `/brand-library/luts/${entry.id}.cube`,
      palette_hex: palette,
    };
  }),
  music_sources: [
    {
      name: "Pixabay Music",
      url: "https://pixabay.com/music/",
      license: "Pixabay Content License (royalty-free, kommerziell + ohne Attribution erlaubt)",
      use_for: "Background-Music in Reels — direkter Download als MP3, dann in /projects/[id]/brand → Background Music hochladen",
    },
    {
      name: "Mixkit",
      url: "https://mixkit.co/free-stock-music/",
      license: "Mixkit Free License (royalty-free für content creation, kommerziell ok, keine Attribution erforderlich)",
      use_for: "High-quality cinematic + electronic tracks, gut kuratiert nach Mood",
    },
    {
      name: "YouTube Audio Library",
      url: "https://studio.youtube.com/channel/UC/music",
      license: "Variiert (manche royalty-free, manche Attribution required) — pro Track prüfen",
      use_for: "Direkt aus YouTube Studio downloaden, gefiltert nach Mood + Tempo",
    },
    {
      name: "Uppbeat",
      url: "https://uppbeat.io/",
      license: "Free tier mit Attribution; Premium ohne Attribution",
      use_for: "Trend-aware Tracks, gut kuratiert für Reels/Shorts",
    },
  ],
  reference_frame_sources: [
    {
      name: "Unsplash",
      url: "https://unsplash.com/",
      license: "Unsplash License (free for commercial + personal, kein Attribution required, keine Re-Distribution als Stock)",
      use_for: "Brand-Reference-Frames hochladen für Color-Match. Suche nach 'cinematic <vibe>' oder '<aesthetic> photography'",
    },
    {
      name: "Pexels",
      url: "https://www.pexels.com/",
      license: "Pexels License (free, kommerziell, ohne Attribution)",
      use_for: "Brand-Reference + B-Roll-Inspiration",
    },
  ],
  fonts_bundled: [
    {
      name: "Inter",
      family: "Inter",
      url: "/brand-defaults/fonts/Inter-Regular.ttf",
      license: "SIL OFL 1.1 (open, kommerziell ok, embed + redistribute erlaubt)",
      designer: "Rasmus Andersson",
    },
  ],
};

fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Wrote ${LOOKS.length} LUTs to ${OUT_DIR}`);
console.log(`Manifest: ${MANIFEST}`);
