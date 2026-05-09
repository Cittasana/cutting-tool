import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { projectSecretExists, setProjectSecret, type ProjectSecretKind } from "@/lib/secrets";

async function saveProjectSecret(formData: FormData) {
  "use server";
  const projectId = String(formData.get("project_id") ?? "");
  const kind = String(formData.get("kind") ?? "") as ProjectSecretKind;
  const value = String(formData.get("value") ?? "").trim();
  if (!projectId || !value) return;
  if (!["anthropic", "elevenlabs", "higgsfield", "meta"].includes(kind)) return;
  await setProjectSecret(projectId, kind, value);
  revalidatePath(`/projects/${projectId}/keys`);
}

const KEY_LABELS: Record<ProjectSecretKind, { label: string; hint: string; placeholder: string }> = {
  anthropic: {
    label: "Anthropic (Override)",
    hint: "Optional. Überschreibt den Tenant-Key nur für dieses Projekt.",
    placeholder: "sk-ant-...",
  },
  elevenlabs: {
    label: "ElevenLabs",
    hint: "Pro Projekt — z.B. wenn der Kunde eine geklonte Stimme hat.",
    placeholder: "el_...",
  },
  higgsfield: {
    label: "Higgsfield",
    hint: "Optional. Für reine KI-Generierung. Direct HTTP API Token.",
    placeholder: "hf_...",
  },
  meta: {
    label: "Meta Long-Lived Token",
    hint: "Wird normalerweise per Facebook-Login gesetzt — manuelles Eintragen nur als Fallback.",
    placeholder: "EAAxxx... (60 Tage gültig)",
  },
};

export default async function ProjectKeysPage({
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

  const kinds: ProjectSecretKind[] = ["anthropic", "elevenlabs", "higgsfield", "meta"];
  const statuses = await Promise.all(
    kinds.map(async (k) => [k, await projectSecretExists(project.id, k)] as const),
  );

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <header className="mb-6">
        <Link href={`/projects/${id}`} className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
          ← {project.name}
        </Link>
        <h1 className="mt-3 text-2xl font-semibold">API Keys</h1>
        <p className="mt-1 text-xs text-zinc-500">
          Per-Projekt-Keys. Verschlüsselt in Supabase Vault.
        </p>
      </header>

      <div className="flex flex-col gap-4">
        {statuses.map(([kind, isSet]) => {
          const meta = KEY_LABELS[kind];
          return (
            <div
              key={kind}
              className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
            >
              <div className="mb-1 flex items-center justify-between">
                <span className="font-medium">{meta.label}</span>
                <span
                  className={
                    isSet
                      ? "text-xs font-medium text-green-700 dark:text-green-400"
                      : "text-xs text-zinc-400"
                  }
                >
                  {isSet ? "✓ gesetzt" : "nicht gesetzt"}
                </span>
              </div>
              <p className="mb-3 text-xs text-zinc-500">{meta.hint}</p>
              <form action={saveProjectSecret} className="flex gap-2">
                <input type="hidden" name="project_id" value={project.id} />
                <input type="hidden" name="kind" value={kind} />
                <input
                  type="password"
                  name="value"
                  placeholder={isSet ? "•••••••• (rotieren)" : meta.placeholder}
                  className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
                />
                <button
                  type="submit"
                  className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white dark:bg-white dark:text-zinc-900"
                >
                  Speichern
                </button>
              </form>
            </div>
          );
        })}
      </div>

      <div className="mt-8 rounded-md border border-amber-300/40 bg-amber-50 p-4 text-xs text-amber-900 dark:border-amber-700/40 dark:bg-amber-950/30 dark:text-amber-200">
        <strong>Hinweis:</strong> Meta-Token sollte später per Facebook-Login automatisch gesetzt werden — manuelles Eintragen ist nur ein Fallback.
      </div>
    </main>
  );
}
