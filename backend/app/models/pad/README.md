# CNN Anti-Spoofing Model Weights

The backend expects the following ONNX files here before it can run the
CNN-based Presentation Attack Detector (`pad_cnn.py`):

```
2.7_80x80_MiniFASNetV2.onnx
4_0_0_80x80_MiniFASNetV1SE.onnx
```

Both are derived from the Apache-2.0 licensed
[Silent-Face-Anti-Spoofing](https://github.com/minivision-ai/Silent-Face-Anti-Spoofing)
project by MiniVision.

## One-time setup

From the repo root:

```bash
pip install "torch==2.1.*" --index-url https://download.pytorch.org/whl/cpu
python scripts/convert_pad_models.py
```

The script downloads the public `.pth` weights + architecture code from
MiniVision, converts both models to ONNX, drops them in this directory, then
cleans up. PyTorch is needed only for the conversion — runtime inference uses
`onnxruntime`.

If these files are missing at backend startup you'll see this in the logs:

```
No CNN PAD models loaded — anti-spoofing DISABLED.
```

Attendance keeps working in that mode, just without spoof protection.
