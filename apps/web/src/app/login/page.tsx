import { Suspense } from "react";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="mb-2 text-2xl font-semibold">Cutting Tool</h1>
      <p className="mb-8 text-sm text-zinc-500">Magic-Link-Login.</p>
      <Suspense fallback={<div className="text-sm text-zinc-500">Lade…</div>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
