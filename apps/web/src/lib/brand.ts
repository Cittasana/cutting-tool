import { put } from "@vercel/blob";
import { getSupabaseAdminClient } from "./supabase/admin";
import { analyzeLut, parseCubeLut } from "./lut-analyzer";

export type BrandAssetKind =
  | "lut"
  | "logo"
  | "logo_dark"
  | "wordmark"
  | "font"
  | "reference"
  | "music";

export interface BrandPresetUpsert {
  projectId: string;
  name?: string;
  lut_storage_path?: string | null;
  logo_storage_path?: string | null;
  logo_dark_storage_path?: string | null;
  wordmark_storage_path?: string | null;
  font_storage_path?: string | null;
  music_storage_path?: string | null;
  font_family?: string | null;
  reference_frames?: Array<{ url: string; role: string }> | null;
  default_aspect_ratio?: string;
  tone_descriptors?: string[];
  palette_hex?: string[] | null;
  shadow_tint?: string | null;
  midtone_tint?: string | null;
  highlight_tint?: string | null;
  contrast_profile?: "low" | "medium" | "high" | null;
  saturation_profile?: string | null;
  style_description?: string | null;
}

export async function uploadBrandAsset(
  projectId: string,
  kind: BrandAssetKind,
  file: File,
): Promise<string> {
  const ext = guessExtension(file.name, file.type, kind);
  const path = `brand-presets/${projectId}/${kind}-${Date.now()}${ext}`;
  const result = await put(path, file, {
    access: "public",
    contentType: file.type || mimeFor(ext),
    addRandomSuffix: false,
  });
  return result.url;
}

/**
 * Read a freshly-uploaded LUT, parse, sample, and persist the analysis
 * onto the active brand preset. No-op when LUT parse fails.
 */
export async function analyzeAndSaveLut(projectId: string, lutText: string): Promise<void> {
  let analysis;
  try {
    const lut = parseCubeLut(lutText);
    analysis = analyzeLut(lut);
  } catch (e) {
    // Parse failure shouldn't crash upload — preset just won't have style fingerprint.
    return;
  }
  await upsertBrandPreset({
    projectId,
    palette_hex: analysis.palette_hex,
    shadow_tint: analysis.shadow_tint,
    midtone_tint: analysis.midtone_tint,
    highlight_tint: analysis.highlight_tint,
    contrast_profile: analysis.contrast_profile,
    saturation_profile: analysis.saturation_profile,
    style_description: analysis.style_description,
  } as BrandPresetUpsert);
}

export async function getActiveBrandPreset(projectId: string) {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin
    .from("brand_presets")
    .select("*")
    .eq("project_id", projectId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error(`getActiveBrandPreset: ${error.message}`);
  return data;
}

export async function upsertBrandPreset(input: BrandPresetUpsert): Promise<void> {
  const admin = getSupabaseAdminClient();
  const existing = await getActiveBrandPreset(input.projectId);

  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (k === "projectId") continue;
    if (v !== undefined) patch[k] = v;
  }

  if (existing) {
    const { error } = await admin
      .from("brand_presets")
      .update(patch)
      .eq("id", existing.id);
    if (error) throw new Error(`update brand_preset: ${error.message}`);
  } else {
    const { error } = await admin.from("brand_presets").insert({
      project_id: input.projectId,
      version: 1,
      is_active: true,
      name: input.name ?? "Default",
      ...patch,
    });
    if (error) throw new Error(`insert brand_preset: ${error.message}`);
  }
}

function guessExtension(filename: string, mime: string, kind: BrandAssetKind): string {
  const m = filename.match(/(\.[^.]+)$/);
  if (m) return m[1].toLowerCase();
  if (kind === "lut") return ".cube";
  if (kind === "font") return mime.includes("otf") ? ".otf" : ".ttf";
  if (mime.startsWith("image/png")) return ".png";
  if (mime.startsWith("image/jpeg")) return ".jpg";
  if (mime.startsWith("image/webp")) return ".webp";
  if (mime.startsWith("image/svg")) return ".svg";
  return "";
}

function mimeFor(ext: string): string {
  switch (ext) {
    case ".cube":
    case ".3dl":
      return "text/plain";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    case ".ttf":
      return "font/ttf";
    case ".otf":
      return "font/otf";
    default:
      return "application/octet-stream";
  }
}
