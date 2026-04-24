"""One-time conversion of MiniFASNet (Silent-Face-Anti-Spoofing) weights to ONNX.

Run this ONCE after checking out the repo, before starting the backend:

    python scripts/convert_pad_models.py

What it does:
  1. Downloads the Silent-Face-Anti-Spoofing source + pretrained .pth weights
     from MiniVision's GitHub (Apache-2.0 licensed, public).
  2. Loads MiniFASNetV2 (2.7_80x80) and MiniFASNetV1SE (4_0_0_80x80).
  3. Exports both to ONNX into backend/app/models/pad/.
  4. Cleans up the download.

Requirements:
  pip install "torch==2.1.*" --index-url https://download.pytorch.org/whl/cpu

The CPU wheel is enough (~200 MB) — inference uses onnxruntime, not torch.
After conversion you can uninstall torch if you don't want it lying around.
"""

from __future__ import annotations

import io
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

REPO_ZIP_URL = (
    "https://codeload.github.com/minivision-ai/Silent-Face-Anti-Spoofing/zip/refs/heads/master"
)

# (pth_relative_path, model_class_name, out_onnx_filename)
TARGETS = [
    (
        "resources/anti_spoof_models/2.7_80x80_MiniFASNetV2.pth",
        "MiniFASNetV2",
        "2.7_80x80_MiniFASNetV2.onnx",
    ),
    (
        "resources/anti_spoof_models/4_0_0_80x80_MiniFASNetV1SE.pth",
        "MiniFASNetV1SE",
        "4_0_0_80x80_MiniFASNetV1SE.onnx",
    ),
]

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent
OUT_DIR = REPO_ROOT / "backend" / "app" / "models" / "pad"
TMP_DIR = OUT_DIR / "_tmp_minivision"


def _require_torch():
    try:
        import torch  # noqa: F401
        return
    except ImportError:
        print("ERROR: PyTorch is required for this one-time conversion.")
        print("Install the CPU wheel (~200 MB):")
        print('  pip install "torch==2.1.*" --index-url https://download.pytorch.org/whl/cpu')
        print("Then re-run:  python scripts/convert_pad_models.py")
        sys.exit(1)


def _download_repo() -> Path:
    TMP_DIR.mkdir(parents=True, exist_ok=True)
    zip_path = TMP_DIR / "repo.zip"
    if not zip_path.exists():
        print(f"Downloading {REPO_ZIP_URL} ...")
        with urllib.request.urlopen(REPO_ZIP_URL) as resp:
            data = resp.read()
        zip_path.write_bytes(data)
        print(f"  {len(data) / 1024 / 1024:.1f} MB downloaded")

    extracted = TMP_DIR / "extracted"
    if not extracted.exists():
        extracted.mkdir(parents=True, exist_ok=True)
        print("Extracting ...")
        with zipfile.ZipFile(zip_path) as z:
            z.extractall(extracted)

    # Top-level dir is something like Silent-Face-Anti-Spoofing-master
    children = [p for p in extracted.iterdir() if p.is_dir()]
    if not children:
        raise RuntimeError(f"Unexpected archive layout in {extracted}")
    return children[0]


def _convert(repo_src: Path) -> None:
    import torch

    # MiniFASNet expects to be imported from its own src/ package.
    sys.path.insert(0, str(repo_src))
    from src.model_lib.MiniFASNet import MiniFASNetV1SE, MiniFASNetV2  # noqa: E402

    class_map = {
        "MiniFASNetV1SE": MiniFASNetV1SE,
        "MiniFASNetV2": MiniFASNetV2,
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    for pth_rel, class_name, out_name in TARGETS:
        pth_path = repo_src / pth_rel
        if not pth_path.exists():
            print(f"SKIP: {pth_path} not found in downloaded archive.")
            continue

        out_path = OUT_DIR / out_name
        if out_path.exists():
            print(f"OK: {out_path} already exists — skipping.")
            continue

        print(f"Converting {pth_rel} -> {out_name}")
        model_cls = class_map[class_name]
        model = model_cls(
            embedding_size=128,
            conv6_kernel=(5, 5),
            drop_p=0.0,
            num_classes=3,
            img_channel=3,
        )

        state = torch.load(pth_path, map_location="cpu")
        # MiniVision's checkpoints wrap state_dict in DataParallel; strip "module."
        if isinstance(state, dict) and "state_dict" in state:
            state = state["state_dict"]
        cleaned = {k.replace("module.", ""): v for k, v in state.items()}
        missing, unexpected = model.load_state_dict(cleaned, strict=False)
        if missing:
            print(f"  WARN: missing keys: {missing[:5]}{'...' if len(missing) > 5 else ''}")
        if unexpected:
            print(f"  WARN: unexpected keys: {unexpected[:5]}{'...' if len(unexpected) > 5 else ''}")

        model.eval()
        dummy = torch.zeros(1, 3, 80, 80, dtype=torch.float32)
        torch.onnx.export(
            model,
            dummy,
            str(out_path),
            input_names=["input"],
            output_names=["logits"],
            opset_version=13,
            do_constant_folding=True,
            dynamic_axes=None,
        )
        size_kb = out_path.stat().st_size / 1024
        print(f"  -> {out_path} ({size_kb:.0f} KB)")


def main() -> int:
    _require_torch()
    try:
        repo_src = _download_repo()
        _convert(repo_src)
    finally:
        if TMP_DIR.exists():
            shutil.rmtree(TMP_DIR, ignore_errors=True)

    print()
    print("Done. Generated files:")
    for pth_rel, _, out_name in TARGETS:
        out_path = OUT_DIR / out_name
        print(f"  {out_path} ({'present' if out_path.exists() else 'MISSING'})")
    print()
    print("Restart the backend to pick up the new PAD weights.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
