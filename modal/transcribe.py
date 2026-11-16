"""OPTIONAL speech-to-text backend on a Modal GPU for the Discord agent's voice notes.

You do not need this: any HTTP service that follows the contract below works, and
AGENT_WHISPER_PYTHON (scripts/whisper_local.py) transcribes on the bot's own machine instead.
It needs a Modal account (https://modal.com) and costs GPU time while it runs.

Owners send Discord voice messages and phone recordings. On a small CPU faster-whisper `small`
is slow and weak outside English; here `large-v3-turbo` (CTranslate2, fp16) does a minute of
speech in about a second on a T4.

Cost is the design constraint: one T4, no warm pool, a 30 s scaledown window (two notes sent back
to back share a container). In our runs a cold start took 8-10 s (2.5 s of it loading the model)
and a warm round trip ~1 s for a short note; check your own bill.

No GPU memory snapshot, on purpose: restoring one took ~10 s, no faster than a
plain cold start, and Modal rebuilt it (~40 s) per GPU type and per deploy.

Contract:
  POST <endpoint>/transcribe[?language=xx][&vad=0][&prompt=...]
        vad=0 keeps sung vocals (lyrics); prompt = names to spell right (TRANSCRIBE_VOCABULARY)
  Authorization: Bearer <TRANSCRIBE_TOKEN>   (Modal secret agent-transcribe-auth)
  body  the audio file as-is (ogg/opus, m4a, mp3, wav, ...)
  ->    {"text", "language", "language_probability", "duration", "segments":
         [{"start", "end", "text"}], "model", "timings": {...}}

Deploy:
  pip install modal && modal setup
  modal secret create agent-transcribe-auth TRANSCRIBE_TOKEN=<a long random string>
  modal deploy modal/transcribe.py
Then put the printed web URL in TRANSCRIBE_URL and the same string in TRANSCRIBE_TOKEN in the bot's .env.
"""

import os
import time

import modal

app = modal.App("agent-transcribe")

MODEL_REPO = "mobiuslabsgmbh/faster-whisper-large-v3-turbo"
MODEL_DIR = "/model"
SITE = "/usr/local/lib/python3.12/site-packages/nvidia"


def _download() -> None:
    from huggingface_hub import snapshot_download

    snapshot_download(MODEL_REPO, local_dir=MODEL_DIR)


# CTranslate2 links against cuBLAS 12 / cuDNN 9; the pip wheels carry them,
# they only have to be on the loader path before the process starts.
image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "faster-whisper==1.2.1",
        "av==14.2.0",  # newer releases dropped the open(metadata_errors=) faster-whisper passes
        "nvidia-cublas-cu12==12.9.2.10",
        "nvidia-cudnn-cu12==9.27.0.42",
        "fastapi[standard]",
        "huggingface_hub",
    )
    .env({"LD_LIBRARY_PATH": f"{SITE}/cublas/lib:{SITE}/cudnn/lib", "HF_HUB_DISABLE_TELEMETRY": "1"})
    .run_function(_download)
)

auth = modal.Secret.from_name("agent-transcribe-auth")


@app.cls(
    image=image,
    gpu="T4",
    secrets=[auth],
    # Voice notes come minutes apart: idling longer only burns credit.
    scaledown_window=30,
    max_containers=1,
    timeout=600,
)
@modal.concurrent(max_inputs=4)
class Transcriber:
    @modal.enter()
    def load(self) -> None:
        from faster_whisper import BatchedInferencePipeline, WhisperModel

        t = time.time()
        self.model = WhisperModel(MODEL_DIR, device="cuda", compute_type="float16")
        self.batched = BatchedInferencePipeline(self.model)
        # A first decode (with the VAD) allocates the CUDA cache before a real request needs it.
        import numpy as np

        list(self.model.transcribe(np.zeros(16000, dtype=np.float32), beam_size=1, language="en", vad_filter=True)[0])
        import subprocess

        self.gpu = subprocess.run(["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"], capture_output=True, text=True).stdout.strip()
        print(f"model ready on {self.gpu} in {time.time() - t:.1f}s")

    def run(self, audio: bytes, language: str | None, vad: bool, prompt: str | None) -> dict:
        import io

        from faster_whisper import decode_audio

        t0 = time.time()
        samples = decode_audio(io.BytesIO(audio), sampling_rate=16000)
        t1 = time.time()
        duration = len(samples) / 16000
        opts = dict(language=language or None, beam_size=1, vad_filter=vad, condition_on_previous_text=False,
                    hotwords=prompt or None)  # unlike initial_prompt, applied to every 30 s window
        if duration > 60 and vad:  # the batched pipeline chunks on VAD
            segments, info = self.batched.transcribe(samples, batch_size=16, **opts)
        else:
            segments, info = self.model.transcribe(samples, **opts)
        segs = [{"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()} for s in segments]
        t2 = time.time()
        return {
            "text": " ".join(s["text"] for s in segs).strip(),
            "language": info.language,
            "language_probability": round(info.language_probability, 3),
            "duration": round(duration, 2),
            "segments": segs,
            "model": "large-v3-turbo",
            "gpu": self.gpu,
            "timings": {"decode": round(t1 - t0, 3), "transcribe": round(t2 - t1, 3)},
        }

    @modal.asgi_app()
    def web(self):
        import hmac

        from fastapi import FastAPI, HTTPException, Request
        from fastapi.concurrency import run_in_threadpool

        api = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
        token = os.environ["TRANSCRIBE_TOKEN"]

        @api.post("/transcribe")
        async def transcribe(request: Request, language: str | None = None, vad: int = 1, prompt: str | None = None):
            given = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
            if not hmac.compare_digest(given.encode(), token.encode()):
                raise HTTPException(401, "bad token")
            audio = await request.body()
            if not audio:
                raise HTTPException(400, "empty body")
            if len(audio) > 100 << 20:
                raise HTTPException(413, "over 100 MB")
            try:
                return await run_in_threadpool(self.run, audio, language, bool(vad), (prompt or "")[:500])
            except Exception as err:  # undecodable audio and the like
                raise HTTPException(422, f"{type(err).__name__}: {err}")

        @api.get("/health")
        async def health():
            return {"ok": True}

        return api
