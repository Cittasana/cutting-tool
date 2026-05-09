import { put } from "@vercel/blob";

export async function uploadReelToBlob(opts: {
  jobId: string;
  buffer: Buffer;
}): Promise<string> {
  const path = `reels/${opts.jobId}/${Date.now()}.mp4`;
  const result = await put(path, opts.buffer, {
    access: "public",
    contentType: "video/mp4",
  });
  return result.url;
}
