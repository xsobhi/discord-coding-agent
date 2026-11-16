"""Local CPU transcription for src/discord/transcribe.ts (AGENT_WHISPER_PYTHON).

Set AGENT_WHISPER_PYTHON to a Python that has faster-whisper and numpy installed
(for example a venv: `python3 -m venv ~/whisper-venv && ~/whisper-venv/bin/pip install faster-whisper numpy`),
and have ffmpeg on PATH. Manual run: python -I scripts/whisper_local.py <file> [--lyrics]
Prints {"text", "language", "duration"} as JSON. Decodes with system ffmpeg,
because that venv's PyAV rejects faster-whisper's own av.open() arguments.
"""

import json
import subprocess
import sys

import numpy as np
from faster_whisper import WhisperModel

raw = subprocess.run(
    ["ffmpeg", "-loglevel", "error", "-i", sys.argv[1], "-f", "s16le", "-ac", "1", "-ar", "16000", "-"],
    check=True, capture_output=True,
).stdout
audio = np.frombuffer(raw, np.int16).astype(np.float32) / 32768.0
model = WhisperModel("small", device="cpu", compute_type="int8")
vad = "--lyrics" not in sys.argv  # the voice filter drops singing
segments, info = model.transcribe(audio, beam_size=1, vad_filter=vad, condition_on_previous_text=False)
text = " ".join(s.text.strip() for s in segments).strip()
print(json.dumps({"text": text, "language": info.language, "duration": round(info.duration, 2)}))
