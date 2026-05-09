import Link from "next/link";
import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export default async function ProjectsPage() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: tenants } = await supabase
    .from("tenants")
    .select("id, name, slug")
    .is("deleted_at", null)
    .order("created_at");

  if (!tenants || tenants.length === 0) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold">Willkommen</h1>
        <p className="mt-2 text-sm text-zinc-500">Lege erst einen Tenant an.</p>
        <Link
          href="/onboarding"
          className="mt-6 inline-block rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-zinc-900"
        >
          Tenant erstellen
        </Link>
      </main>
    );
  }

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, slug, language, tenant_id")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Projekte</h1>
        <Link
          href="/projects/new"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-zinc-900"
        >
          + Neues Projekt
        </Link>
      </header>

      {!projects || projects.length === 0 ? (
        <p className="text-sm text-zinc-500">Noch keine Projekte.</p>
      ) : (
        <ul className="grid gap-3">
          {projects.map((p) => (
            <li key={p.id}>
              <Link
                href={`/projects/${p.id}`}
                className="block rounded-lg border border-zinc-200 p-4 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-xs text-zinc-500">{p.language.toUpperCase()}</span>
                </div>
                <p className="mt-1 text-xs text-zinc-500">{p.slug}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
