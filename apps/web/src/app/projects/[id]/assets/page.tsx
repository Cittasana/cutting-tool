import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { AssetUploader } from "./uploader";

async function triggerAnalyze(formData: FormData) {
  "use server";
  const projectId = String(formData.get("project_id") ?? "");
  const assetId = String(formData.get("asset_id") ?? "");
  if (!projectId || !assetId) return;
  const res = await fetch(
    `${process.env.APP_URL ?? "http://localhost:3000"}/api/projects/${projectId}/uploads/${assetId}/analyze`,
    { method: "POST" },
  );
  if (!res.ok) throw new Error(`analyze trigger ${res.status}`);
  revalidatePath(`/projects/${projectId}/assets`);
}

async function deleteAsset(formData: FormData) {
  "use server";
  const projectId = String(formData.get("project_id") ?? "");
  const assetId = String(formData.get("asset_id") ?? "");
  if (!projectId || !assetId) return;

  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  // Verify project ownership via user-context client (RLS).
  const { data: own } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .is("deleted_at", null)
    .single();
  if (!own) return;

  // Soft-delete via admin client.
  const admin = getSupabaseAdminClient();
  await admin
    .from("assets")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", assetId)
    .eq("project_id", projectId);
  revalidatePath(`/projects/${projectId}/assets`);
}

export default async function AssetsPage({
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

  const { data: assets } = await supabase
    .from("assets")
    .select("id, kind, blob_url, filename, mime_type, size_bytes, analysis, created_at")
    .eq("project_id", id)
    .eq("kind", "upload")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-6">
        <Link href={`/projects/${id}`} className="text-sm text-zinc-500 hover:underline">
          ← {project.name}
        </Link>
        <h1 className="mt-3 text-2xl font-semibold">Assets</h1>
        <p className="mt-1 text-xs text-zinc-500">
          Eigene Videos + Fotos als Schnitt-Material. Werden vom Cutting-Agent analysiert
          (Phase 3.2) und in Reels eingeschnitten.
        </p>
      </header>

      <section className="mb-8">
        <AssetUploader projectId={id} />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
          Hochgeladen
        </h2>
        {!assets || assets.length === 0 ? (
          <p className="text-sm text-zinc-500">Noch keine Uploads.</p>
        ) : (
          <ul className="grid gap-2">
            {assets.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-3 rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800"
              >
                {a.mime_type?.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={a.blob_url}
                    alt={a.filename ?? ""}
                    className="h-12 w-12 rounded object-cover"
                  />
                ) : (
                  <span className="flex h-12 w-12 items-center justify-center rounded bg-zinc-100 font-mono text-[10px] text-zinc-500 dark:bg-zinc-900">
                    {a.mime_type?.split("/")[1] ?? "?"}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-xs">{a.filename ?? a.id.slice(0, 8)}</p>
                  <p className="text-xs text-zinc-500">
                    {a.mime_type ?? "?"} · {formatBytes(a.size_bytes)}
                  </p>
                </div>
                <a
                  href={a.blob_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-zinc-500 hover:underline"
                >
                  Open
                </a>
                {a.analysis ? (
                  <span className="text-xs font-medium text-green-700 dark:text-green-400">
                    ✓ {Array.isArray((a.analysis as { scenes?: unknown[] }).scenes)
                      ? `${((a.analysis as { scenes?: unknown[] }).scenes ?? []).length} scenes`
                      : "analyzed"}
                  </span>
                ) : (
                  <form action={triggerAnalyze}>
                    <input type="hidden" name="project_id" value={id} />
                    <input type="hidden" name="asset_id" value={a.id} />
                    <button
                      type="submit"
                      className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                    >
                      Analyze
                    </button>
                  </form>
                )}
                <form action={deleteAsset}>
                  <input type="hidden" name="project_id" value={id} />
                  <input type="hidden" name="asset_id" value={a.id} />
                  <button
                    type="submit"
                    className="text-xs text-red-600 hover:underline dark:text-red-400"
                  >
                    Delete
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function formatBytes(n: number | null | undefined): string {
  if (!n) return "?";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let u = 0;
  while (v > 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(1)} ${units[u]}`;
}
