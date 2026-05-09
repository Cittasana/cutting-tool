import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { JobLive } from "./live";

export default async function JobPage({
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

  const { data: job } = await supabase
    .from("jobs")
    .select(
      "id, project_id, status, progress, current_step, brief, storyboard, error, created_at, started_at, finished_at",
    )
    .eq("id", id)
    .single();
  if (!job) notFound();

  const { data: events } = await supabase
    .from("job_events")
    .select("id, ts, type, payload")
    .eq("job_id", id)
    .order("id");

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-6">
        <Link
          href={`/projects/${job.project_id}`}
          className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          ← Projekt
        </Link>
        <h1 className="mt-3 font-mono text-sm text-zinc-500">Job {job.id.slice(0, 8)}…</h1>
      </header>

      <JobLive jobId={job.id} initialJob={job} initialEvents={events ?? []} />
    </main>
  );
}
