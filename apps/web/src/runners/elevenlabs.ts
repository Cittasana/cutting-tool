import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

export interface SynthesizeOpts {
  apiKey: string;
  voiceId: string;
  text: string;
  modelId?: string;
}

/**
 * Synthesize a voiceover into an mp3 Buffer. Runs server-side in a Vercel
 * Function step (NOT inside Sandbox) — the audio buffer is then handed off
 * to the Sandbox via writeFiles for ffmpeg muxing.
 */
export async function synthesizeVoiceover(opts: SynthesizeOpts): Promise<Buffer> {
  const client = new ElevenLabsClient({ apiKey: opts.apiKey });
  const audio = await client.textToSpeech.convert(opts.voiceId, {
    text: opts.text,
    modelId: opts.modelId ?? "eleven_multilingual_v2",
    outputFormat: "mp3_44100_192",
  });

  const reader = (audio as ReadableStream<Uint8Array>).getReader();
  const chunks: Buffer[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}
