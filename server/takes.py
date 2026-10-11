"""Archive of recent practice takes, so a session can be checked after the fact.

Each take is a directory under TAKES_DIR named <UTC time>-<id>: take.wav (16-bit PCM, the audio
the browser actually sent -- gated-out silence isn't in it), path.json (the post-take alignment,
Matchmaker takes only) and take.json (the browser's SavedTake: score, note list, detector setup,
final per-note history). Only the newest TAKES_KEEP are kept. A Matchmaker take's audio comes
straight from the alignment session (the server already holds it); a metronome take's audio is
uploaded in parts by the browser. Nothing here is served to the public: the app is LAN-only.
"""
from __future__ import annotations

import json
import logging
import os
import re
import shutil
import threading
import time
import wave
from pathlib import Path

import numpy as np

logger = logging.getLogger("takes")
BASE_DIR = Path(__file__).resolve().parent
TAKES_DIR = Path(os.environ.get("TAKES_DIR", str(BASE_DIR / "tmp" / "takes")))
TAKES_KEEP = int(os.environ.get("TAKES_KEEP", "20"))
_lock = threading.Lock()
_ID = re.compile(r"^[0-9a-f-]{8,36}$")


def _dir_for(take_id: str, create: bool) -> Path | None:
    if not _ID.match(take_id):
        return None
    TAKES_DIR.mkdir(parents=True, exist_ok=True)
    for entry in TAKES_DIR.iterdir():
        if entry.is_dir() and entry.name.endswith("-" + take_id[:8]):
            return entry
    if not create:
        return None
    path = TAKES_DIR / f"{time.strftime('%Y%m%d-%H%M%S', time.gmtime())}-{take_id[:8]}"
    path.mkdir(parents=True, exist_ok=True)
    return path


def write_wav(path: Path, audio: np.ndarray, sample_rate: int) -> None:
    pcm = np.clip(np.asarray(audio, dtype=np.float32), -1.0, 1.0)
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(int(sample_rate))
        out.writeframes((pcm * 32767).astype("<i2").tobytes())


def prune() -> None:
    with _lock:
        dirs = sorted(entry for entry in TAKES_DIR.iterdir() if entry.is_dir())
        for old in dirs[:-TAKES_KEEP] if len(dirs) > TAKES_KEEP else []:
            shutil.rmtree(old, ignore_errors=True)
            logger.info("Pruned take %s", old.name)


def save_session_audio(session_id: str, audio: np.ndarray, sample_rate: int, path: list[tuple[float, float]]) -> Path | None:
    """Called at the end of an alignment session with the audio it received."""
    if audio.size < sample_rate:  # under a second: nothing worth keeping
        return None
    folder = _dir_for(session_id, create=True)
    if folder is None:
        return None
    write_wav(folder / "take.wav", audio, sample_rate)
    (folder / "path.json").write_text(json.dumps([[round(t, 4), round(q, 4)] for t, q in path]), encoding="utf-8")
    prune()
    logger.info("Saved take %s (%.1f s)", folder.name, audio.size / sample_rate)
    return folder


def append_audio_part(take_id: str, part: bytes) -> bool:
    """Metronome takes: the browser uploads raw little-endian int16 PCM in parts."""
    folder = _dir_for(take_id, create=True)
    if folder is None:
        return False
    with open(folder / "take.pcm", "ab") as out:
        out.write(part)
    return True


def finish_take(take_id: str, result: dict) -> Path | None:
    """Store the browser's SavedTake (results); turn uploaded PCM parts into take.wav."""
    folder = _dir_for(take_id, create=True)
    if folder is None:
        return None
    pcm_path = folder / "take.pcm"
    if pcm_path.exists():
        raw = np.frombuffer(pcm_path.read_bytes(), dtype="<i2").astype(np.float32) / 32768.0
        write_wav(folder / "take.wav", raw, int(result.get("sampleRate") or 48000))
        pcm_path.unlink()
    (folder / "take.json").write_text(json.dumps(result), encoding="utf-8")
    prune()
    return folder


def _summary(folder: Path) -> dict:
    info: dict = {"id": folder.name, "files": sorted(p.name for p in folder.iterdir())}
    wav = folder / "take.wav"
    if wav.exists():
        try:
            with wave.open(str(wav), "rb") as src:
                info["seconds"] = round(src.getnframes() / src.getframerate(), 1)
        except wave.Error:
            pass
    take = folder / "take.json"
    if take.exists():
        try:
            data = json.loads(take.read_text(encoding="utf-8"))
            counts: dict[str, int] = {}
            for record in data.get("history", []):
                verdict = str(record.get("verdict"))
                counts[verdict] = counts.get(verdict, 0) + 1
            info.update(
                savedAt=data.get("savedAt"),
                mode=data.get("mode", "matchmaker"),
                bpm=data.get("bpm"),
                score=data.get("scoreTitle"),
                notes=len(data.get("history", [])),
                verdicts=counts,
            )
        except (ValueError, OSError):
            pass
    return info


def list_takes() -> list[dict]:
    TAKES_DIR.mkdir(parents=True, exist_ok=True)
    return [_summary(folder) for folder in sorted((e for e in TAKES_DIR.iterdir() if e.is_dir()), reverse=True)]


def take_file(take_id: str, name: str) -> Path | None:
    if name not in {"take.wav", "take.json", "path.json"}:
        return None
    folder = TAKES_DIR / take_id if (TAKES_DIR / take_id).is_dir() else _dir_for(take_id, create=False)
    if folder is None:
        return None
    path = folder / name
    return path if path.exists() else None
