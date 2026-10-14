"""Frame-by-frame "is someone talking?" for the playing gate, using Silero VAD.

Why a speech model rather than a frequency test: the gate used to call a frame speech when it had
energy at 60-180 Hz (where a male voice's fundamental sits and the violin has nothing). Measured on
a real lesson recording (the same room the app is used in), that test threw away 39% of the
violin frames -- quiet G-string playing over room rumble -- while still passing 11-47% of female
speech. Silero VAD (https://github.com/snakers4/silero-vad, MIT; the ONNX file and its licence are
in models/) on the same clips: 0.0% of violin frames called speech at any threshold, 83% of loud
speech caught, 2.7 ms of CPU per second of audio. FireRedVAD, whose documentation says
instrumental music scores low, called 28% of the same violin speech, so it was not used.

The model wants 16 kHz audio in 512-sample (32 ms) chunks with a recurrent state, so this class
resamples whatever rate the browser streams at (an IIR anti-alias filter whose state carries
across chunks, then linear interpolation -- exact decimation at 48 kHz) and batches the result
into model chunks. ``push`` takes one hop of audio at the native rate and returns the highest
speech probability among the model chunks that completed during it, or the previous value when
none did (a 33 ms hop at 30 fps completes about one 32 ms chunk).
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from scipy.signal import butter, sosfilt, sosfilt_zi

MODEL_PATH = Path(__file__).resolve().parent / "models" / "silero_vad.onnx"
MODEL_SAMPLE_RATE = 16000
MODEL_CHUNK = 512
MODEL_CONTEXT = 64  # v5 models see the last 64 samples of the previous chunk again


class SpeechDetector:
    def __init__(self, sample_rate: int) -> None:
        import onnxruntime as ort  # imported here so the OMR-only server path never needs it

        options = ort.SessionOptions()
        options.intra_op_num_threads = 1  # 2.7 ms per second of audio: one thread is plenty
        options.inter_op_num_threads = 1
        self._session = ort.InferenceSession(str(MODEL_PATH), options, providers=["CPUExecutionProvider"])
        self._state = np.zeros((2, 1, 128), dtype=np.float32)
        self._context = np.zeros(MODEL_CONTEXT, dtype=np.float32)
        self._pending = np.zeros(0, dtype=np.float32)  # 16 kHz samples not yet a full chunk
        self.probability = 0.0
        self.chunks = 0

        self._native_rate = int(sample_rate)
        self._ratio = self._native_rate / MODEL_SAMPLE_RATE
        if self._native_rate == MODEL_SAMPLE_RATE:
            self._sos = None
        else:
            # Anti-alias below the model's Nyquist; the filter state carries across chunks so the
            # resampled stream is continuous.
            self._sos = butter(8, 0.9 * MODEL_SAMPLE_RATE / 2, btype="low", fs=self._native_rate, output="sos")
            self._zi = sosfilt_zi(self._sos) * 0.0
            self._tail = np.zeros(1, dtype=np.float32)  # last native sample, for interpolation
            self._phase = 1.0  # position of the next output sample, in native samples past _tail[-1]

    def _resample(self, chunk: np.ndarray) -> np.ndarray:
        if self._sos is None:
            return chunk.astype(np.float32, copy=False)
        filtered, self._zi = sosfilt(self._sos, chunk.astype(np.float64), zi=self._zi)
        signal = np.concatenate((self._tail, filtered))
        positions = np.arange(self._phase, len(signal) - 1 + 1e-9, self._ratio)
        out = np.interp(positions, np.arange(len(signal)), signal).astype(np.float32)
        consumed = positions[-1] + self._ratio if positions.size else self._phase
        self._tail = signal[-1:]
        self._phase = consumed - (len(signal) - 1)
        return out

    def push(self, chunk: np.ndarray) -> float:
        """Feed one hop of native-rate audio; return the speech probability for it (0..1)."""
        self._pending = np.concatenate((self._pending, self._resample(np.asarray(chunk, dtype=np.float32))))
        best = None
        while self._pending.size >= MODEL_CHUNK:
            frame, self._pending = self._pending[:MODEL_CHUNK], self._pending[MODEL_CHUNK:]
            x = np.concatenate((self._context, frame))[None, :]
            prob, self._state = self._session.run(
                None, {"input": x, "state": self._state, "sr": np.array(MODEL_SAMPLE_RATE, dtype=np.int64)}
            )
            self._context = frame[-MODEL_CONTEXT:]
            self.chunks += 1
            value = float(np.asarray(prob).reshape(-1)[0])
            best = value if best is None else max(best, value)
        if best is not None:
            self.probability = best
        return self.probability
