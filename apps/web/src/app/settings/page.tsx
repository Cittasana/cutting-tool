import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { setTenantSecret, tenantSecretExists } from "@/lib/secrets";

async function saveAnthropic(formData: FormData) {
  "use server";
  const tenantId = String(formData.get("tenant_id") ?? "");
  const value = String(formData.get("anthropic_key") ?? "").trim();
  if (!tenantId || !value) return;
  if (!value.startsWith("sk-ant-")) {
    throw new Error("Anthropic-Key beginnt mit sk-ant-...");
  }
  await setTenantSecret(tenantId, "anthropic", value);
  revalidatePath("/settings");
}

export default async function SettingsPage() {
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

  if (!tenants || tenants.length === 0) redirect("/onboarding");

  const tenantStatuses = await Promise.all(
    tenants.map(async (t) => ({
      ...t,
      anthropicSet: await tenantSecretExists(t.id, "anthropic"),
    })),
  );

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Einstellungen</h1>
        <Link href="/projects" className="text-sm text-zinc-500 hover:underline">
          ← Projekte
        </Link>
      </header>

      <section className="mb-8">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Account</h2>
        <p className="mt-2 text-sm">{user.email}</p>
      </section>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Anthropic API Keys</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Pro Tenant ein Key. Wird verschlüsselt in Supabase Vault gespeichert.
        </p>

        <div className="mt-4 flex flex-col gap-4">
          {tenantStatuses.map((t) => (
            <div
              key={t.id}
              className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="font-medium">{t.name}</span>
                <span
                  className={
                    t.anthropicSet
                      ? "text-xs font-medium text-green-700 dark:text-green-400"
                      : "text-xs text-zinc-400"
                  }
                >
                  {t.anthropicSet ? "✓ gesetzt" : "nicht gesetzt"}
                </span>
              </div>
              <form action={saveAnthropic} className="flex gap-2">
                <input type="hidden" name="tenant_id" value={t.id} />
                <input
                  type="password"
                  name="anthropic_key"
                  placeholder={t.anthropicSet ? "•••••••• (rotieren)" : "sk-ant-..."}
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
          ))}
        </div>
      </section>
    </main>
  );
}
