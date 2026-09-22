"""
Unit tests specifically verifying GPU detection and automatic CPU fallback logic in RMBG.
"""

import os
import sys
import unittest
from unittest.mock import patch, MagicMock
from PIL import Image

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "backend")))
try:
    import app_python
    sys.modules["app"] = app_python
except ImportError:
    pass
from app.rmbg import remover

class TestRmbgGpuFallback(unittest.TestCase):

    def test_gpu_preference_and_fallback(self):
        """Kiểm tra: Nếu CUDAExecutionProvider không có, engine tự động fallback về CPU mà không crash."""
        mock_ort = MagicMock()
        mock_ort.get_available_providers.return_value = ["CPUExecutionProvider"]
        with patch.dict("sys.modules", {"onnxruntime": mock_ort}):
            engine = remover.BiRefNetOpenVINOEngine(model_path="dummy_path.onnx")
            # Khi CUDA không khả dụng, device phải là cpu hoặc none (do model giả)
            self.assertIn(engine.device, ["cpu", "none"])

    def test_metadata_includes_device(self):
        """Kiểm tra: remove_background luôn trả về trường 'device' trong metadata."""
        img = Image.new("RGB", (100, 100), (255, 255, 255))
        out_img, metadata = remover.remove_background(img)
        self.assertIn("device", metadata)
        self.assertIn(metadata["device"], ["gpu", "cpu"])
        self.assertIn("backend", metadata)

if __name__ == "__main__":
    unittest.main()
