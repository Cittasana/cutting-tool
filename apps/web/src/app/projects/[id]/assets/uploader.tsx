"use client";

import { useState, useCallback } from "react";
import { upload } from "@vercel/blob/client";
import { useRouter } from "next/navigation";

interface UploadProgress {
  file: string;
  pct: number;
  state: "uploading" | "done" | "error";
  message?: string;
}

export function AssetUploader({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [items, setItems] = useState<UploadProgress[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = useCallback(
    async (files: File[]) => {
      const next: UploadProgress[] = files.map((f) => ({
        file: f.name,
        pct: 0,
        state: "uploading",
      }));
      setItems((prev) => [...prev, ...next]);
      const startIdx = items.length;

      await Promise.all(
        files.map(async (file, i) => {
          const idx = startIdx + i;
          try {
            await upload(`projects/${projectId}/uploads/${file.name}`, file, {
              access: "public",
              handleUploadUrl: `/api/projects/${projectId}/uploads/token`,
              multipart: true,
              onUploadProgress: (event) => {
                setItems((prev) => {
                  const copy = [...prev];
                  if (copy[idx]) copy[idx] = { ...copy[idx], pct: Math.round(event.percentage) };
                  return copy;
                });
              },
            });
            setItems((prev) => {
              const copy = [...prev];
              if (copy[idx]) copy[idx] = { ...copy[idx], pct: 100, state: "done" };
              return copy;
            });
          } catch (e) {
            setItems((prev) => {
              const copy = [...prev];
              if (copy[idx])
                copy[idx] = {
                  ...copy[idx],
                  state: "error",
                  message: e instanceof Error ? e.message : String(e),
                };
              return copy;
            });
          }
        }),
      );

      router.refresh();
    },
    [items.length, projectId, router],
  );

  return (
    <div>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const dropped = Array.from(e.dataTransfer.files);
          if (dropped.length > 0) void handleFiles(dropped);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
          dragOver
            ? "border-zinc-900 bg-zinc-100 dark:border-zinc-100 dark:bg-zinc-900"
            : "border-zinc-300 hover:border-zinc-500 dark:border-zinc-700 dark:hover:border-zinc-500"
        }`}
      >
        <input
          type="file"
          multiple
          accept="video/*,image/*"
          className="hidden"
          onChange={(e) => {
            const picked = e.target.files ? Array.from(e.target.files) : [];
            if (picked.length > 0) void handleFiles(picked);
            e.target.value = "";
          }}
        />
        <p className="font-medium">Videos oder Fotos hier hin ziehen</p>
        <p className="mt-1 text-xs text-zinc-500">
          oder klicken zum Auswählen · max 5 GB pro File · Multipart-Upload aktiv
        </p>
      </label>

      {items.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {items.map((it, i) => (
            <li
              key={i}
              className="flex items-center gap-3 rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
            >
              <span
                className={
                  it.state === "error"
                    ? "h-2 w-2 rounded-full bg-red-500"
                    : it.state === "done"
                      ? "h-2 w-2 rounded-full bg-green-500"
                      : "h-2 w-2 animate-pulse rounded-full bg-blue-500"
                }
              />
              <span className="flex-1 truncate font-mono text-xs">{it.file}</span>
              <span className="font-mono text-xs tabular-nums">
                {it.state === "error" ? "ERR" : `${it.pct}%`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
