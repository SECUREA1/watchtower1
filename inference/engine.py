from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger("rednode.inference")


@dataclass
class InferenceResult:
    ok: bool
    message: Optional[str] = None
    latency_ms: Optional[float] = None


class InferenceEngine:
    def __init__(self, model_path: Optional[str] = None) -> None:
        self.model_path = model_path

    def infer(self, frame) -> InferenceResult:
        return InferenceResult(ok=True, message="noop")


class TensorRTInference(InferenceEngine):
    def __init__(self, model_path: Optional[str] = None) -> None:
        super().__init__(model_path)
        self._enabled = False
        try:
            import tensorrt  # noqa: F401
            self._enabled = True
        except Exception as exc:
            logger.warning("TensorRT not available: %s", exc)

    def infer(self, frame) -> InferenceResult:
        if not self._enabled:
            return InferenceResult(ok=False, message="TensorRT not available")
        # Placeholder for real TensorRT integration.
        return InferenceResult(ok=True, message="TensorRT stub")
