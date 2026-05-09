import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";

async function createTenant(formData: FormData) {
  "use server";
  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  if (!name || !slug.match(/^[a-z0-9-]+$/)) return;

  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("tenants")
    .insert({ owner_user_id: user.id, name, slug });
  if (error) throw new Error(error.message);

  revalidatePath("/projects");
  redirect("/projects");
}

export default async function OnboardingPage() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: existing } = await supabase
    .from("tenants")
    .select("id")
    .is("deleted_at", null)
    .limit(1);
  if (existing && existing.length > 0) redirect("/projects");

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-2xl font-semibold">Tenant einrichten</h1>
      <p className="mt-2 text-sm text-zinc-500">
        Tenants gruppieren deine Projekte. Du kannst später mehrere haben (z.B. eines pro Agentur-Mandat).
      </p>
      <form action={createTenant} className="mt-8 flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Name
          <input
            name="name"
            required
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
            placeholder="Cittasana"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Slug
          <input
            name="slug"
            required
            pattern="[a-z0-9-]+"
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900"
            placeholder="cittasana"
          />
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
