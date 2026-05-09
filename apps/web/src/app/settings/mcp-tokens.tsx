"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ExistingToken {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  last_used_at: string | null;
  created_at: string;
}

export function McpTokensPanel({ tokens }: { tokens: ExistingToken[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<{ id: string; plaintext: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/mcp/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setRevealed({ id: data.id, plaintext: data.plaintext });
      setName("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm("Diesen Token widerrufen? MCP-Client verliert sofort den Zugriff.")) return;
    await fetch(`/api/mcp/tokens/${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div>
      {revealed && (
        <div className="mb-4 rounded-md border border-amber-300/50 bg-amber-50 p-4 text-sm dark:border-amber-700/50 dark:bg-amber-950/30">
          <p className="mb-2 font-medium text-amber-900 dark:text-amber-200">
            Token nur EINMAL sichtbar — kopiere ihn jetzt:
          </p>
          <code className="block break-all rounded bg-white p-2 font-mono text-xs dark:bg-zinc-950">
            {revealed.plaintext}
          </code>
          <button
            onClick={() => setRevealed(null)}
            className="mt-2 text-xs text-amber-900 underline dark:text-amber-200"
          >
            Habe ich kopiert
          </button>
        </div>
      )}

      <form onSubmit={create} className="mb-6 flex gap-2">
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="z.B. Claude Desktop, Cursor, AIOS"
          className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          disabled={creating || !name}
          className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
        >
          {creating ? "Erstelle…" : "Token erstellen"}
        </button>
      </form>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {tokens.length === 0 ? (
        <p className="text-sm text-zinc-500">Noch keine Tokens.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {tokens.map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-3 rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
            >
              <span className="flex-1">
                <span className="font-medium">{t.name}</span>{" "}
                <span className="font-mono text-xs text-zinc-500">{t.prefix}…</span>
              </span>
              <span className="text-xs text-zinc-500">
                {t.last_used_at
                  ? `zuletzt ${new Date(t.last_used_at).toLocaleDateString("de-DE")}`
                  : "nie"}
              </span>
              <button
                onClick={() => revoke(t.id)}
                className="text-xs text-red-600 hover:underline dark:text-red-400"
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
