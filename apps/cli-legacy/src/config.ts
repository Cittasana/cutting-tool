import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = path.resolve(__dirname, "..");
export const ASSETS_DIR = path.join(PROJECT_ROOT, "assets");
export const FONTS_DIR = path.join(ASSETS_DIR, "fonts");
export const ICONS_DIR = path.join(ASSETS_DIR, "icons");
export const OUTPUT_DIR = path.join(PROJECT_ROOT, "output");

export const HIGGSFIELD_BIN =
  process.env.HIGGSFIELD_BIN ?? "/Users/cosmograef/.npm-global/bin/higgsfield";
export const FFMPEG_BIN =
  process.env.FFMPEG_BIN ?? "/opt/homebrew/bin/ffmpeg";
export const FFPROBE_BIN =
  process.env.FFPROBE_BIN ?? "/opt/homebrew/bin/ffprobe";

export const getAnthropicApiKey = () => required("ANTHROPIC_API_KEY");
export const getElevenLabsApiKey = () => required("ELEVENLABS_API_KEY");

export const VOICE_IDS = {
  get de_female() {
    return process.env.ELEVENLABS_VOICE_ID_DE_FEMALE ?? "";
  },
  get de_male() {
    return process.env.ELEVENLABS_VOICE_ID_DE_MALE ?? "";
  },
  get en_female() {
    return process.env.ELEVENLABS_VOICE_ID_EN_FEMALE ?? "";
  },
  get en_male() {
    return process.env.ELEVENLABS_VOICE_ID_EN_MALE ?? "";
  },
};

export const ANTHROPIC_MODEL = "claude-sonnet-4-6";

export const REEL_WIDTH = 1080;
export const REEL_HEIGHT = 1920;
export const REEL_FPS = 30;
export const REEL_VIDEO_BITRATE = "8M";
export const REEL_AUDIO_BITRATE = "192k";

export const FONT_SIZE_BY_STYLE = {
  headline: 88,
  subtitle: 56,
  caption: 40,
} as const;

export const MAX_SCENE_RETRIES_PER_RUN = 4;
export const MAX_RETRIES_PER_SCENE = 2;
export const SCENE_EVAL_PASS_THRESHOLD = 7;
export const OVERLAY_EVAL_PASS_THRESHOLD = 8;
export const FINAL_EVAL_PASS_THRESHOLD = 7;

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return v;
}
