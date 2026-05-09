#!/usr/bin/env python3
"""
Analyze a single asset (video or image) and emit a compact JSON manifest
for the Cutting Agent.

Usage:
  python3 analyze-asset.py <input_path> <output_json>

Pipeline (video):
  1. ffprobe → format, duration, resolution
  2. PySceneDetect AdaptiveDetector → scene boundaries
  3. ffmpeg silencedetect → speech/silence segments
  4. ffmpeg -vf select+thumbnail → keyframe extraction (1 per scene, max 6/clip)
  5. Compose JSON

For Phase 3.2 MVP: scenedetect + ffmpeg only. WhisperX, madmom, mediapipe
get layered in later when sandbox snapshots make their installation cost amortizable.
"""
import json
import re
import subprocess
import sys
from pathlib import Path


def ffprobe(path: str) -> dict:
    out = subprocess.check_output(
        [
            "ffprobe", "-v", "error",
            "-print_format", "json",
            "-show_format", "-show_streams",
            path,
        ],
        text=True,
    )
    return json.loads(out)


def detect_scenes(path: str) -> list[tuple[float, float]]:
    try:
        from scenedetect import detect, AdaptiveDetector
    except ImportError:
        # Fallback: single scene = whole clip
        return []
    scenes = detect(path, AdaptiveDetector())
    return [(s[0].get_seconds(), s[1].get_seconds()) for s in scenes]


def detect_silence(path: str, threshold_db: float = -30, min_duration: float = 0.4) -> list[tuple[float, float]]:
    out = subprocess.run(
        ["ffmpeg", "-hide_banner", "-i", path, "-af",
         f"silencedetect=n={threshold_db}dB:d={min_duration}", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    text = out.stderr
    segments: list[tuple[float, float]] = []
    starts = [float(m.group(1)) for m in re.finditer(r"silence_start: ([0-9.]+)", text)]
    ends = [float(m.group(1)) for m in re.finditer(r"silence_end: ([0-9.]+)", text)]
    for s, e in zip(starts, ends):
        segments.append((s, e))
    return segments


def extract_thumbnails(path: str, scenes: list[tuple[float, float]], outdir: Path, max_per_scene: int = 1) -> list[str]:
    outdir.mkdir(parents=True, exist_ok=True)
    paths: list[str] = []
    if not scenes:
        # Fallback: every 5s, max 6 frames
        info = ffprobe(path)
        dur = float(info.get("format", {}).get("duration", 0))
        n = min(6, max(1, int(dur // 5)))
        for i in range(n):
            t = max(0.5, dur * (i + 0.5) / n)
            outp = outdir / f"thumb-{i:03d}.jpg"
            subprocess.run(
                ["ffmpeg", "-y", "-ss", f"{t:.2f}", "-i", path, "-vframes", "1", "-q:v", "3", str(outp)],
                check=True, capture_output=True,
            )
            paths.append(str(outp))
        return paths
    for i, (s, e) in enumerate(scenes):
        mid = s + (e - s) / 2
        outp = outdir / f"scene-{i:03d}.jpg"
        subprocess.run(
            ["ffmpeg", "-y", "-ss", f"{mid:.2f}", "-i", path, "-vframes", "1", "-q:v", "3", str(outp)],
            check=True, capture_output=True,
        )
        paths.append(str(outp))
    return paths


def main(input_path: str, output_json: str) -> None:
    info = ffprobe(input_path)
    fmt = info.get("format", {})
    streams = info.get("streams", [])
    v = next((s for s in streams if s.get("codec_type") == "video"), {})
    a = next((s for s in streams if s.get("codec_type") == "audio"), None)

    is_video = v.get("codec_type") == "video" and float(fmt.get("duration", 0)) > 0
    duration = float(fmt.get("duration", 0))

    result: dict = {
        "kind": "video" if is_video else "image",
        "duration_s": duration,
        "width": int(v.get("width", 0) or 0),
        "height": int(v.get("height", 0) or 0),
        "fps": _eval_fps(v.get("r_frame_rate")),
        "has_audio": bool(a),
        "scenes": [],
        "silence_segments": [],
        "thumbnails": [],
    }

    if is_video:
        scenes = detect_scenes(input_path)
        result["scenes"] = [{"start": s, "end": e} for s, e in scenes]
        if a:
            result["silence_segments"] = [{"start": s, "end": e} for s, e in detect_silence(input_path)]
        thumbs = extract_thumbnails(input_path, scenes, Path(output_json).with_suffix(".thumbs"))
        result["thumbnails"] = thumbs

    Path(output_json).write_text(json.dumps(result, indent=2))
    print(f"analysis written: {output_json} ({len(result.get('scenes', []))} scenes, {duration:.1f}s)")


def _eval_fps(rate: str | None) -> float:
    if not rate or "/" not in rate:
        return 0.0
    a, b = rate.split("/")
    try:
        return float(a) / float(b)
    except (ValueError, ZeroDivisionError):
        return 0.0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("usage: analyze-asset.py <input> <output.json>", file=sys.stderr)
        sys.exit(2)
    main(sys.argv[1], sys.argv[2])
