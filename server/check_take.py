"""Check an archived take's grading against an independent pitch tracker (pYIN).

    python check_take.py tmp/takes/<take dir> [--cents 25]

For a Matchmaker take, each note's time span comes from path.json (the post-take alignment);
for a metronome take, from the tempo (bpm) and the first sound. pYIN (librosa) tracks the pitch
over the span's middle part; the median is compared with the written pitch, and the result with
the app's own verdict for that note. Prints a per-note table for the notes the app graded, then
how often the two agree. Disagreement on many notes means the app's measurement is off;
agreement with many "out of tune" means the playing really was off.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf


def cents(f: float, ref: float) -> float:
    return 1200 * math.log2(f / ref)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("take", type=Path)
    parser.add_argument("--cents", type=float, default=15.0, help="in-tune band to compare with (default: the app's 15)")
    args = parser.parse_args()
    folder = args.take
    take = json.loads((folder / "take.json").read_text(encoding="utf-8"))
    audio, sr = sf.read(folder / "take.wav", dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    mode = take.get("mode", "matchmaker")
    history = {int(r["noteId"]) if "noteId" in r else i: r for i, r in enumerate(take.get("history", []))}
    print(f"{folder.name}: {mode} take, {len(audio) / sr:.1f} s, {take.get('scoreTitle', '?')}, score {take.get('scoringSource')}")

    # Note spans: (stepIndex, written Hz, t0, t1)
    spans: list[tuple[int, float, float, float]] = []
    notes = take.get("notes") or []
    if mode == "matchmaker" and notes:
        path = json.loads((folder / "path.json").read_text(encoding="utf-8")) if (folder / "path.json").exists() else take.get("path", [])
        if not path:
            print("no alignment path; cannot place notes"); return 1
        times = np.array([p[0] for p in path]); quarters = np.array([p[1] for p in path])
        qindex = take.get("quarterIndex") or []
        starts = {int(e["stepIndex"]): float(e["quarter"]) for e in qindex}
        order = sorted(starts.items(), key=lambda kv: kv[1])
        for k, (step, q0) in enumerate(order):
            q1 = order[k + 1][1] if k + 1 < len(order) else quarters.max()
            if q0 < quarters.min() or q0 > quarters.max():
                continue
            t0 = float(np.interp(q0, quarters, times)); t1 = float(np.interp(q1, quarters, times))
            note = next((n for n in notes if int(n["stepIndex"]) == step), None)
            if note and note.get("primaryFrequencyHz") and t1 - t0 > 0.05:
                spans.append((step, float(note["primaryFrequencyHz"]), t0, t1))
    else:
        print("metronome take: note placement is by tempo, so only the overall pitch track is reported")

    f0, voiced, prob = librosa.pyin(audio, fmin=180, fmax=1400, sr=sr, frame_length=2048, hop_length=256)
    t = librosa.frames_to_time(np.arange(len(f0)), sr=sr, hop_length=256)
    if not spans:
        v = f0[voiced & (prob > 0.5)]
        print(f"pYIN: {np.mean(voiced):.0%} of frames voiced; pitch range {np.nanmin(v):.0f}-{np.nanmax(v):.0f} Hz" if v.size else "pYIN found no pitched frames")
        return 0

    rows = []
    for step, hz, t0, t1 in spans:
        rec = history.get(step)
        verdict = rec.get("verdict") if rec else None
        app_cents = rec.get("averageCentsOff") if rec else None
        mid0, mid1 = t0 + 0.25 * (t1 - t0), t1 - 0.15 * (t1 - t0)
        sel = (t >= mid0) & (t <= mid1) & voiced & (prob > 0.5)
        if sel.sum() >= 2:
            pyin = float(np.median([cents(f, hz) for f in f0[sel]]))
            pyin_verdict = "in_tune" if abs(pyin) <= args.cents else ("close" if abs(pyin) <= 2 * args.cents else "out_of_tune")
        else:
            pyin, pyin_verdict = None, "unclear"
        rows.append((step, t0, verdict, app_cents, pyin, pyin_verdict))

    graded = [r for r in rows if r[2] in ("in_tune", "out_of_tune", "close")]
    print(f"{'note':>5} {'at s':>6} {'app':>12} {'app ¢':>7} {'pYIN ¢':>7} {'pYIN':>12}")
    for step, t0, verdict, app_cents, pyin, pv in rows:
        if verdict in ("in_tune", "out_of_tune", "close") or pv != "unclear":
            print(f"{step:>5} {t0:>6.1f} {str(verdict):>12} {('%.0f' % app_cents) if app_cents is not None else '-':>7} {('%.0f' % pyin) if pyin is not None else '-':>7} {pv:>12}")
    both = [r for r in graded if r[4] is not None]
    agree = sum(1 for r in both if (abs(r[4]) <= args.cents) == (r[2] == "in_tune"))
    diffs = [abs(r[3] - r[4]) for r in both if r[3] is not None]
    print(f"\nnotes the app graded: {len(graded)}; pYIN could measure {len(both)} of them; verdict agreement {agree}/{len(both)}"
          + (f"; median |app − pYIN| {np.median(diffs):.1f}¢" if diffs else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
