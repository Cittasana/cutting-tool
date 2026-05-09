import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  analyzeAndSaveLut,
  getActiveBrandPreset,
  uploadBrandAsset,
  upsertBrandPreset,
  type BrandAssetKind,
} from "@/lib/brand";

const ASSET_KINDS: Array<{
  kind: BrandAssetKind;
  label: string;
  hint: string;
  accept: string;
}> = [
  {
    kind: "lut",
    label: "LUT (.cube)",
    hint: "3D LUT, Größe 33 empfohlen. Wird auf alle Clips + Higgsfield-Output angewendet.",
    accept: ".cube,.3dl,text/plain",
  },
  {
    kind: "logo",
    label: "Logo",
    hint: "PNG mit transparentem Hintergrund. Erscheint als Watermark in Reels.",
    accept: "image/png,image/svg+xml",
  },
  {
    kind: "logo_dark",
    label: "Logo (dark)",
    hint: "Variante für helle Hintergründe.",
    accept: "image/png,image/svg+xml",
  },
  {
    kind: "wordmark",
    label: "Wordmark",
    hint: "Text-only Logo (z.B. Schriftzug).",
    accept: "image/png,image/svg+xml",
  },
  {
    kind: "font",
    label: "Custom Font",
    hint: "TTF oder OTF. Wird für Captions + Lower-Thirds genutzt.",
    accept: ".ttf,.otf,font/ttf,font/otf",
  },
  {
    kind: "reference",
    label: "Reference Frame",
    hint: "1–3 Bilder die den Brand-Look definieren. Wird zu Color-Match + Higgsfield Style-Reference.",
    accept: "image/png,image/jpeg,image/webp",
  },
  {
    kind: "music",
    label: "Background Music",
    hint: "MP3/WAV/M4A. Wird unter Voice-Over geduckt mit sidechain compressor.",
    accept: "audio/mpeg,audio/wav,audio/mp4,audio/m4a,audio/x-m4a",
  },
];

const COLUMN_BY_KIND: Record<Exclude<BrandAssetKind, "reference">, string> = {
  lut: "lut_storage_path",
  logo: "logo_storage_path",
  logo_dark: "logo_dark_storage_path",
  wordmark: "wordmark_storage_path",
  font: "font_storage_path",
  music: "music_storage_path",
};

async function uploadAssetAction(formData: FormData) {
  "use server";
  const projectId = String(formData.get("project_id") ?? "");
  const kind = String(formData.get("kind") ?? "") as BrandAssetKind;
  const file = formData.get("file");
  if (!projectId || !file || !(file instanceof File)) return;
  if (!ASSET_KINDS.some((k) => k.kind === kind)) return;

  // Authorize via user-context check before doing service-role writes.
  const supabase = await getSupabaseServerClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .is("deleted_at", null)
    .single();
  if (!project) return;

  const url = await uploadBrandAsset(projectId, kind, file);

  if (kind === "lut") {
    const lutText = await file.text();
    await upsertBrandPreset({ projectId, lut_storage_path: url });
    await analyzeAndSaveLut(projectId, lutText);
    revalidatePath(`/projects/${projectId}/brand`);
    return;
  }

  if (kind === "reference") {
    const existing = await getActiveBrandPreset(projectId);
    const frames =
      (existing?.reference_frames as Array<{ url: string; role: string }> | null | undefined) ??
      [];
    const next = [...frames, { url, role: "mood" }].slice(-3);
    await upsertBrandPreset({ projectId, reference_frames: next });
  } else {
    const col = COLUMN_BY_KIND[kind];
    await upsertBrandPreset({ projectId, [col]: url });
  }
  revalidatePath(`/projects/${projectId}/brand`);
}

async function clearAssetAction(formData: FormData) {
  "use server";
  const projectId = String(formData.get("project_id") ?? "");
  const kind = String(formData.get("kind") ?? "") as BrandAssetKind;
  if (!projectId) return;

  if (kind === "reference") {
    await upsertBrandPreset({ projectId, reference_frames: [] });
  } else if (kind in COLUMN_BY_KIND) {
    await upsertBrandPreset({
      projectId,
      [COLUMN_BY_KIND[kind as Exclude<BrandAssetKind, "reference">]]: null,
    });
  }
  revalidatePath(`/projects/${projectId}/brand`);
}

export default async function BrandPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, slug")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (!project) notFound();

  const preset = await getActiveBrandPreset(id);
  const referenceFrames =
    (preset?.reference_frames as Array<{ url: string; role: string }> | null | undefined) ?? [];

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-6">
        <Link href={`/projects/${id}`} className="text-sm text-zinc-500 hover:underline">
          ← {project.name}
        </Link>
        <h1 className="mt-3 text-2xl font-semibold">Brand Preset</h1>
        <p className="mt-1 text-xs text-zinc-500">
          Pro Projekt eine versionierte Identität: LUT, Logo, Font, Voice. Wird auf jeden generierten Reel angewendet.
        </p>
      </header>

      <div className="mb-6 flex items-center justify-between">
        {preset ? (
          <p className="text-xs text-zinc-500">
            Aktive Version: <span className="font-mono">v{preset.version}</span> · {preset.name}
          </p>
        ) : (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Noch kein Preset — wird beim ersten Upload automatisch v1 erstellt.
          </p>
        )}
        <Link
          href={`/projects/${id}/brand/library`}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          Brand Library →
        </Link>
      </div>

      <div className="grid gap-4">
        {ASSET_KINDS.map((meta) => {
          const currentUrl =
            meta.kind === "reference"
              ? null
              : (preset?.[COLUMN_BY_KIND[meta.kind as Exclude<BrandAssetKind, "reference">]] as string | null | undefined) ?? null;
          return (
            <div
              key={meta.kind}
              className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="font-medium">{meta.label}</span>
                {meta.kind === "reference" ? (
                  <span className="text-xs text-zinc-500">{referenceFrames.length}/3</span>
                ) : (
                  <span
                    className={
                      currentUrl
                        ? "text-xs font-medium text-green-700 dark:text-green-400"
                        : "text-xs text-zinc-400"
                    }
                  >
                    {currentUrl ? "✓ gesetzt" : "leer"}
                  </span>
                )}
              </div>
              <p className="mb-3 text-xs text-zinc-500">{meta.hint}</p>

              {meta.kind === "reference" && referenceFrames.length > 0 && (
                <div className="mb-3 flex gap-2">
                  {referenceFrames.map((f, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={i}
                      src={f.url}
                      alt={`reference ${i + 1}`}
                      className="h-16 w-16 rounded object-cover"
                    />
                  ))}
                </div>
              )}

              {meta.kind !== "reference" && currentUrl && meta.kind === "lut" && (
                <p className="mb-3 break-all font-mono text-xs text-zinc-500">{currentUrl}</p>
              )}

              {meta.kind !== "reference" && currentUrl && (meta.kind === "logo" || meta.kind === "logo_dark" || meta.kind === "wordmark") && (
                <div className="mb-3 inline-block rounded bg-zinc-100 p-2 dark:bg-zinc-900">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={currentUrl} alt={meta.label} className="h-12 max-w-[160px] object-contain" />
                </div>
              )}

              <form action={uploadAssetAction} className="flex items-center gap-2">
                <input type="hidden" name="project_id" value={id} />
                <input type="hidden" name="kind" value={meta.kind} />
                <input
                  type="file"
                  name="file"
                  accept={meta.accept}
                  required
                  className="flex-1 text-xs"
                />
                <button
                  type="submit"
                  className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-white dark:text-zinc-900"
                >
                  {meta.kind === "reference" ? "Hinzufügen" : currentUrl ? "Ersetzen" : "Hochladen"}
                </button>
              </form>
              {(meta.kind === "reference" ? referenceFrames.length > 0 : !!currentUrl) && (
                <form action={clearAssetAction} className="mt-2">
                  <input type="hidden" name="project_id" value={id} />
                  <input type="hidden" name="kind" value={meta.kind} />
                  <button
                    type="submit"
                    className="text-xs text-red-600 hover:underline dark:text-red-400"
                  >
                    {meta.kind === "reference" ? "Alle löschen" : "Entfernen"}
                  </button>
                </form>
              )}
            </div>
          );
        })}
      </div>

      {preset?.style_description && (
        <section className="mt-8 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h3 className="mb-2 text-sm font-medium uppercase tracking-wide text-zinc-500">
            Auto-Generierte Style-Description
          </h3>
          <p className="text-sm">{preset.style_description}</p>
          {preset.palette_hex && (preset.palette_hex as string[]).length > 0 && (
            <div className="mt-3 flex gap-2">
              {(preset.palette_hex as string[]).map((hex) => (
                <span
                  key={hex}
                  className="rounded border border-zinc-300 px-2 py-1 font-mono text-xs dark:border-zinc-700"
                  style={{ backgroundColor: hex, color: pickContrastColor(hex) }}
                >
                  {hex}
                </span>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}

function pickContrastColor(hex: string): string {
  const m = hex.match(/^#?([0-9a-f]{6})$/i);
  if (!m) return "#000";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luma > 0.55 ? "#000" : "#fff";
}
