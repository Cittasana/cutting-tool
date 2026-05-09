import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";

async function createProject(formData: FormData) {
  "use server";
  const tenantId = String(formData.get("tenant_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  const language = String(formData.get("language") ?? "de");
  if (!tenantId || !name || !slug.match(/^[a-z0-9-]+$/)) return;
  if (language !== "de" && language !== "en") return;

  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from("projects")
    .insert({ tenant_id: tenantId, name, slug, language })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  revalidatePath("/projects");
  redirect(`/projects/${data.id}`);
}

export default async function NewProjectPage() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: tenants } = await supabase
    .from("tenants")
    .select("id, name")
    .is("deleted_at", null);
  if (!tenants || tenants.length === 0) redirect("/onboarding");

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-2xl font-semibold">Neues Projekt</h1>
      <form action={createProject} className="mt-8 flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Tenant
          <select
            name="tenant_id"
            required
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          >
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Name
          <input
            name="name"
            required
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
            placeholder="Kunde Müller GmbH"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Slug
          <input
            name="slug"
            required
            pattern="[a-z0-9-]+"
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono dark:border-zinc-700 dark:bg-zinc-900"
            placeholder="kunde-mueller"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Sprache
          <select
            name="language"
            defaultValue="de"
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="de">Deutsch</option>
            <option value="en">English</option>
          </select>
        </label>
        <button
          type="submit"
          className="mt-2 rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white dark:bg-white dark:text-zinc-900"
        >
          Erstellen
        </button>
      </form>
    </main>
  );
}
