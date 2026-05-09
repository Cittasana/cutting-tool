import fs from "node:fs/promises";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { getElevenLabsApiKey, VOICE_IDS } from "../config.js";
import type { Language, MarketingBrief } from "../schemas.js";

let _client: ElevenLabsClient | undefined;
function getClient(): ElevenLabsClient {
  if (!_client) _client = new ElevenLabsClient({ apiKey: getElevenLabsApiKey() });
  return _client;
}

export function pickVoiceId(
  brief: MarketingBrief,
  override: string | undefined,
): string {
  if (override) return override;
  const tones = new Set(brief.tone);
  const isFemale = !tones.has("edgy") && !tones.has("urgent");
  const lang: Language = brief.language;
  const key = `${lang}_${isFemale ? "female" : "male"}` as keyof typeof VOICE_IDS;
  const id = VOICE_IDS[key];
  if (!id) {
    const fallback = Object.entries(VOICE_IDS).find(([k, v]) => k.startsWith(lang) && v);
    if (fallback) return fallback[1];
    const any = Object.values(VOICE_IDS).find((v) => v);
    if (!any) {
      throw new Error(
        "No ElevenLabs voice ID configured. Set ELEVENLABS_VOICE_ID_* in .env.",
      );
    }
    return any;
  }
  return id;
}

export async function synthesizeVoiceover(
  text: string,
  voiceId: string,
  outputMp3: string,
): Promise<void> {
  const audio = await getClient().textToSpeech.convert(voiceId, {
    text,
    modelId: "eleven_multilingual_v2",
    outputFormat: "mp3_44100_192",
  });

  const chunks: Buffer[] = [];
  for await (const chunk of audio as AsyncIterable<Buffer | Uint8Array>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  await fs.writeFile(outputMp3, Buffer.concat(chunks));
}
