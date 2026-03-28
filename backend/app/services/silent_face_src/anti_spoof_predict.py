"""Simplified AntiSpoofPredict — no Caffe face detector, accepts pre-cropped patches."""
from __future__ import annotations

import os
from collections import OrderedDict

import numpy as np
import torch
import torch.nn.functional as F

from .model_lib.MiniFASNet import MiniFASNetV1, MiniFASNetV2, MiniFASNetV1SE, MiniFASNetV2SE
from .utility import get_kernel, parse_model_name

MODEL_MAPPING = {
    'MiniFASNetV1': MiniFASNetV1,
    'MiniFASNetV2': MiniFASNetV2,
    'MiniFASNetV1SE': MiniFASNetV1SE,
    'MiniFASNetV2SE': MiniFASNetV2SE,
}


class AntiSpoofPredict:
    """Loads a MiniFASNet model and runs liveness prediction on a pre-cropped face patch."""

    def __init__(self, device_id: int = 0) -> None:
        self.device = torch.device(
            f"cuda:{device_id}" if torch.cuda.is_available() else "cpu"
        )

    def _load_model(self, model_path: str) -> torch.nn.Module:
        model_name = os.path.basename(model_path)
        h_input, w_input, model_type, _ = parse_model_name(model_name)
        kernel_size = get_kernel(h_input, w_input)

        model = MODEL_MAPPING[model_type](conv6_kernel=kernel_size).to(self.device)

        state_dict = torch.load(model_path, map_location=self.device, weights_only=False)
        first_key = next(iter(state_dict))
        if first_key.startswith('module.'):
            new_state = OrderedDict()
            for k, v in state_dict.items():
                new_state[k[7:]] = v
            state_dict = new_state

        model.load_state_dict(state_dict)
        return model

    def predict(self, img: np.ndarray, model_path: str) -> np.ndarray:
        """Run liveness prediction on a cropped face patch (H×W×3 BGR uint8).

        Returns softmax probabilities array of shape (1, num_classes).
        Index 1 = real face probability.
        """
        # Convert BGR uint8 HWC → float32 CHW in [0, 1]
        img_rgb = img[:, :, ::-1].copy()  # BGR → RGB
        img_float = img_rgb.astype(np.float32) / 255.0
        tensor = torch.from_numpy(img_float.transpose(2, 0, 1)).unsqueeze(0).to(self.device)

        model = self._load_model(model_path)
        model.eval()
        with torch.no_grad():
            result = model(tensor)
            result = F.softmax(result, dim=1).cpu().numpy()
        return result
