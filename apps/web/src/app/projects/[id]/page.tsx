import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
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
        <span className="border-b-2 border-zinc-900 px-3 py-2 text-sm font-medium dark:border-zinc-100">Reels</span>
        <span className="px-3 py-2 text-sm text-zinc-400">Brand (Phase 2)</span>
        <span className="px-3 py-2 text-sm text-zinc-400">Assets (Phase 3)</span>
        <span className="px-3 py-2 text-sm text-zinc-400">Auto-Post (Phase 4)</span>
        <Link href={`/projects/${id}/keys`} className="px-3 py-2 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
          Keys
        </Link>
      </nav>

      <section className="rounded-lg border border-zinc-200 p-6 dark:border-zinc-800">
        <h2 className="mb-1 text-lg font-medium">Reel aus URL (Smoketest)</h2>
        <p className="mb-4 text-xs text-zinc-500">
          Phase 1, Etappe 1: Brief + Storyboard. Render-Pipeline (Higgsfield, ffmpeg) folgt.
        </p>
        <TestBriefForm projectId={id} />
      </section>
    </main>
  );
}
