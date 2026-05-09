import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { GenerateReelForm } from "./generate-reel-form";
import { TestBriefForm } from "./test-brief-form";

export default async function ProjectDetailPage({
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
    .select("id, name, slug, language, default_voice_id, auto_post_enabled, tenant_id")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (!project) notFound();

  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, status, progress, current_step, created_at, finished_at")
    .eq("project_id", id)
    .order("created_at", { ascending: false })
    .limit(10);

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <header className="mb-6">
        <Link href="/projects" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
          ← Projekte
        </Link>
        <h1 className="mt-3 text-2xl font-semibold">{project.name}</h1>
        <p className="mt-1 text-xs text-zinc-500">
          {project.slug} · {project.language.toUpperCase()}
        </p>
      </header>

      <nav className="mb-8 flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        <span className="border-b-2 border-zinc-900 px-3 py-2 text-sm font-medium dark:border-zinc-100">
          Reels
        </span>
        <Link
          href={`/projects/${id}/brand`}
          className="px-3 py-2 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          Brand
        </Link>
        <span className="px-3 py-2 text-sm text-zinc-400">Assets (Phase 3)</span>
        <span className="px-3 py-2 text-sm text-zinc-400">Auto-Post (Phase 4)</span>
        <Link
          href={`/projects/${id}/keys`}
          className="px-3 py-2 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          Keys
        </Link>
      </nav>

      <section className="mb-8 rounded-lg border border-zinc-200 p-6 dark:border-zinc-800">
        <h2 className="mb-1 text-lg font-medium">Reel generieren</h2>
        <p className="mb-4 text-xs text-zinc-500">
          Workflow: Brief → Storyboard (Phase 1, Etappe 2). Scene-Render + Stitch folgen in Etappe 3.
        </p>
        <GenerateReelForm projectId={id} defaultLanguage={project.language as "de" | "en"} />
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
          Letzte Jobs
        </h2>
        {!jobs || jobs.length === 0 ? (
          <p className="text-sm text-zinc-500">Noch keine Jobs.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {jobs.map((j) => (
              <li key={j.id}>
                <Link
                  href={`/jobs/${j.id}`}
                  className="flex items-center justify-between rounded-md border border-zinc-200 px-4 py-3 text-sm hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={
                        j.status === "failed"
                          ? "h-2 w-2 rounded-full bg-red-500"
                          : j.status === "done"
                            ? "h-2 w-2 rounded-full bg-green-500"
                            : "h-2 w-2 animate-pulse rounded-full bg-blue-500"
                      }
                    />
                    <span className="font-mono text-xs text-zinc-500">{j.id.slice(0, 8)}</span>
                    <span className="text-xs">{j.current_step ?? j.status}</span>
                  </div>
                  <span className="font-mono text-xs tabular-nums">{j.progress}%</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-dashed border-zinc-300 p-6 dark:border-zinc-700">
        <h3 className="mb-1 text-sm font-medium text-zinc-600 dark:text-zinc-400">
          Smoketest (ohne Workflow)
        </h3>
        <p className="mb-4 text-xs text-zinc-500">
          Direkter Brief+Storyboard-Call. Bypassed das Workflow-System für schnelles Iterieren.
        </p>
        <TestBriefForm projectId={id} />
      </section>
    </main>
  );
}
