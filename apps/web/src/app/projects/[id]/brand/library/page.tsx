import Link from "next/link";
import fs from "node:fs/promises";
import path from "node:path";
import { redirect, notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { put } from "@vercel/blob";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { analyzeAndSaveLut, upsertBrandPreset } from "@/lib/brand";

interface ManifestLut {
  id: string;
  name: string;
  description: string;
  tags: string[];
  url: string;
  palette_hex: string[];
}

interface ManifestSource {
  name: string;
  url: string;
  license: string;
  use_for: string;
}

interface Manifest {
  schema_version: number;
  generated_at: string;
  luts: ManifestLut[];
  music_sources: ManifestSource[];
  reference_frame_sources: ManifestSource[];
}

async function loadManifest(): Promise<Manifest> {
  const file = path.join(process.cwd(), "public/brand-library/manifest.json");
  const text = await fs.readFile(file, "utf8");
  return JSON.parse(text);
}

async function applyLibraryLut(formData: FormData) {
  "use server";
  const projectId = String(formData.get("project_id") ?? "");
  const lutId = String(formData.get("lut_id") ?? "");
  if (!projectId || !lutId) return;

  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .is("deleted_at", null)
    .single();
  if (!project) return;

  const manifest = await loadManifest();
  const entry = manifest.luts.find((l) => l.id === lutId);
  if (!entry) return;

  // Read the .cube file off disk (it lives in /public, served as static).
  const localPath = path.join(process.cwd(), "public", entry.url);
  const lutText = await fs.readFile(localPath, "utf8");

  // Copy into the project's Blob so the brand preset URL is project-owned
  // (mutating the library file later won't retroactively change projects).
  const blobPath = `brand-presets/${projectId}/lut-library-${entry.id}-${Date.now()}.cube`;
  const result = await put(blobPath, lutText, {
    access: "public",
    contentType: "text/plain",
    addRandomSuffix: false,
  });

  await upsertBrandPreset({ projectId, lut_storage_path: result.url });
  await analyzeAndSaveLut(projectId, lutText);
  revalidatePath(`/projects/${projectId}/brand`);
  redirect(`/projects/${projectId}/brand`);
}

export default async function LibraryPage({
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
    .select("id, name")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (!project) notFound();

  const manifest = await loadManifest();

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <header className="mb-6">
        <Link
          href={`/projects/${id}/brand`}
          className="text-sm text-zinc-500 hover:underline"
        >
          ← Brand
        </Link>
        <h1 className="mt-3 text-2xl font-semibold">Brand Library</h1>
        <p className="mt-1 text-xs text-zinc-500">
          {manifest.luts.length} LUTs · industry-inspired · mathematisch generiert,
          lizenzfrei. Klick auf "In dieses Projekt übernehmen" kopiert den LUT in
          deinen Project-Blob + läuft Auto-Analyse.
        </p>
      </header>

      <section className="mb-10">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-zinc-500">
          Color Looks
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          {manifest.luts.map((lut) => (
            <div
              key={lut.id}
              className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
            >
              <div>
                <div className="flex items-center justify-between">
                  <h3 className="font-medium">{lut.name}</h3>
                  <span className="font-mono text-[10px] text-zinc-400">{lut.id}</span>
                </div>
                <p className="mt-1 text-xs text-zinc-500">{lut.description}</p>
              </div>

              <div className="flex gap-1">
                {lut.palette_hex.map((hex) => (
                  <span
                    key={hex}
                    className="h-8 flex-1 rounded border border-zinc-200/40"
                    style={{ backgroundColor: hex }}
                    title={hex}
                  />
                ))}
              </div>
              <div className="flex gap-1 font-mono text-[10px] text-zinc-500">
                {lut.palette_hex.map((hex) => (
                  <span key={hex} className="flex-1 text-center">
                    {hex}
                  </span>
                ))}
              </div>

              <div className="flex flex-wrap gap-1">
                {lut.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                  >
                    {t}
                  </span>
                ))}
              </div>

              <div className="mt-1 flex items-center gap-2">
                <a
                  href={lut.url}
                  download={`${lut.id}.cube`}
                  className="text-xs text-zinc-500 hover:underline"
                >
                  Download .cube
                </a>
                <form action={applyLibraryLut} className="ml-auto">
                  <input type="hidden" name="project_id" value={id} />
                  <input type="hidden" name="lut_id" value={lut.id} />
                  <button
                    type="submit"
                    className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-white dark:text-zinc-900"
                  >
                    In dieses Projekt übernehmen
                  </button>
                </form>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
          Royalty-free Music Sources
        </h2>
        <p className="mb-4 text-xs text-zinc-500">
          BGM lizenztechnisch sauber holen, dann unter <code>/brand → Background Music</code> hochladen.
        </p>
        <ul className="grid gap-2">
          {manifest.music_sources.map((s) => (
            <li
              key={s.url}
              className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800"
            >
              <div className="flex items-center justify-between">
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium hover:underline"
                >
                  {s.name} ↗
                </a>
                <span className="font-mono text-[10px] text-zinc-400">{s.url}</span>
              </div>
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{s.license}</p>
              <p className="mt-1 text-xs text-zinc-500">{s.use_for}</p>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
          Reference Frame Sources
        </h2>
        <p className="mb-4 text-xs text-zinc-500">
          Für Color-Match + Higgsfield Style-Reference. Hochladen unter{" "}
          <code>/brand → Reference Frame</code>.
        </p>
        <ul className="grid gap-2">
          {manifest.reference_frame_sources.map((s) => (
            <li
              key={s.url}
              className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800"
            >
              <div className="flex items-center justify-between">
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium hover:underline"
                >
                  {s.name} ↗
                </a>
                <span className="font-mono text-[10px] text-zinc-400">{s.url}</span>
              </div>
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{s.license}</p>
              <p className="mt-1 text-xs text-zinc-500">{s.use_for}</p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
