"""Runs a guest's Python in a throwaway Modal sandbox (never on the bot's machine) and hands back what it saved.

The bot pipes one JSON job on stdin: {"code": str, "inputs": [{"name": str, "path": str}], "timeout": int}.
`inputs` are files the bot already checked (the guest's own attachments). The sandbox has no network and
no secrets; it is terminated after the run. Prints one JSON result: exit code, clipped stdout/stderr and
the files left in /work/out (base64), within the limits below. Build/warm the image: `python guest_files.py --warm`.
"""
import base64
import json
import sys

import modal

MAX_FILES = 5
MAX_FILE = 8 << 20
CLIP = 20_000
image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("libreoffice-writer-nogui", "libreoffice-calc-nogui", "fonts-dejavu", "fonts-liberation", "fonts-noto-core")
    .pip_install(
        "pandas", "numpy", "scipy", "statsmodels", "pingouin", "pyreadstat", "python-docx", "openpyxl",
        "xlsxwriter", "matplotlib", "seaborn", "reportlab", "fpdf2", "tabulate",
    )
)


def clip(text: str) -> str:
    return text if len(text) <= CLIP else text[:CLIP] + f"\n…(cut, {len(text) - CLIP} more characters)"


def bounded(stream) -> str:
    """Drains a process stream but keeps only the start: a print loop cannot fill the bot's memory."""
    kept, size = [], 0
    for chunk in stream:
        if size < CLIP * 2:
            kept.append(chunk)
            size += len(chunk)
    return "".join(kept)


def run(job: dict) -> dict:
    app = modal.App.lookup("agent-guest-files", create_if_missing=True)
    timeout = max(10, min(int(job.get("timeout", 120)), 300))
    sb = modal.Sandbox.create(app=app, image=image, timeout=timeout + 120, cpu=1.0, memory=2048, block_network=True, workdir="/work")
    try:
        sb.exec("mkdir", "-p", "/work/in", "/work/out").wait()
        for item in job.get("inputs", []):
            with open(item["path"], "rb") as src:
                sb.filesystem.write_bytes(src.read(), f"/work/in/{item['name']}")
        sb.filesystem.write_text(job["code"], "/work/job.py")
        proc = sb.exec("python", "/work/job.py", timeout=timeout)
        stdout, stderr = bounded(proc.stdout), bounded(proc.stderr)
        code = proc.wait()
        files, skipped = [], []
        # Plain files directly in /work/out only, sizes from Modal's own listing, checked again after reading.
        for info in sorted(sb.filesystem.list_files("/work/out"), key=lambda i: i.name)[:50]:
            name = info.name.rsplit("/", 1)[-1]
            if not info.is_file() or info.symlink_target or name in ("", ".", ".."):
                continue
            if len(files) >= MAX_FILES:
                skipped.append(f"{name} (over {MAX_FILES} files)")
            elif info.size > MAX_FILE:
                skipped.append(f"{name} ({info.size // 1048576} MB, over {MAX_FILE >> 20} MB)")
            else:
                data = sb.filesystem.read_bytes(f"/work/out/{name}")
                if len(data) > MAX_FILE:
                    skipped.append(f"{name} (over {MAX_FILE >> 20} MB)")
                    continue
                files.append({"name": name, "b64": base64.b64encode(data).decode()})
        return {"ok": True, "exit_code": code, "stdout": clip(stdout), "stderr": clip(stderr), "files": files, "skipped": skipped}
    finally:
        sb.terminate()


if __name__ == "__main__":
    if "--warm" in sys.argv:
        print(json.dumps(run({"code": "import pyreadstat, docx, openpyxl, matplotlib; print('ready')", "inputs": []})))
        sys.exit(0)
    try:
        print(json.dumps(run(json.load(sys.stdin))))
    except Exception as err:  # the bot shows this to the agent as the tool's error
        print(json.dumps({"ok": False, "error": f"{type(err).__name__}: {err}"[:2000]}))
