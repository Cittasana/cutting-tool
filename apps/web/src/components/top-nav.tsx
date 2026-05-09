import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { LogoutButton } from "./logout-button";

export async function TopNav() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  return (
    <nav className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center gap-6">
        <Link href="/projects" className="font-semibold">
          Cutting Tool
        </Link>
        <Link href="/projects" className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
          Projekte
        </Link>
        <Link href="/settings" className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
          Einstellungen
        </Link>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-zinc-500">{user.email}</span>
        <LogoutButton />
      </div>
    </nav>
  );
}
