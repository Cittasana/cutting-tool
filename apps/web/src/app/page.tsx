import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Cutting Tool</h1>
      <p className="mt-3 text-zinc-500">
        Multi-tenant Reels-Editor — Drag-Drop oder KI-Generierung, mit Brand-LUTs pro Projekt.
      </p>
      <div className="mt-8">
        <Link
          href="/login"
          className="inline-block rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-zinc-900"
        >
          Login
        </Link>
      </div>
    </main>
  );
}
