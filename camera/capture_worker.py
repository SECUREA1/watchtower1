from __future__ import annotations

import logging
import threading
import time
from collections import deque
from typing import Callable, Deque, Optional

import cv2

from camera.pipeline import build_gstreamer_pipeline
from camera.types import CameraConfig, CameraStats

logger = logging.getLogger("rednode.camera")

FrameHandler = Callable[[str, "cv2.Mat"], None]


def _calculate_fps(timestamps: Deque[float]) -> float:
    if len(timestamps) < 2:
        return 0.0
    duration = timestamps[-1] - timestamps[0]
    if duration <= 0:
        return 0.0
    return (len(timestamps) - 1) / duration


class CaptureWorker:
    def __init__(self, config: CameraConfig, handler: Optional[FrameHandler] = None) -> None:
        self.config = config
        self.handler = handler
        self.stats = CameraStats()
        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()
        self._frame_lock = threading.Lock()
        self._latest_frame = None
        self._timestamps: Deque[float] = deque(maxlen=60)
        self._cap: Optional[cv2.VideoCapture] = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2.0)
        if self._cap:
            self._cap.release()
            self._cap = None

    def latest_frame(self):
        with self._frame_lock:
            return self._latest_frame.copy() if self._latest_frame is not None else None

    def _open(self) -> bool:
        pipeline = build_gstreamer_pipeline(self.config)
        logger.info("Opening camera %s with pipeline: %s", self.config.camera_id, pipeline)
        cap = cv2.VideoCapture(pipeline, cv2.CAP_GSTREAMER)
        if not cap.isOpened():
            self.stats.last_error = "Failed to open capture"
            logger.error("Camera %s failed to open", self.config.camera_id)
            return False
        self._cap = cap
        return True

    def _run(self) -> None:
        backoff = 1.0
        while not self._stop.is_set():
            if self._cap is None:
                if not self._open():
                    time.sleep(min(backoff, 5.0))
                    backoff = min(backoff * 1.5, 10.0)
                    continue
                backoff = 1.0
            ret, frame = self._cap.read()
            if not ret or frame is None:
                self.stats.dropped += 1
                self.stats.last_error = "Frame capture failed"
                time.sleep(0.01)
                continue
            timestamp = time.time()
            with self._frame_lock:
                self._latest_frame = frame
            self._timestamps.append(timestamp)
            self.stats.frames += 1
            self.stats.last_frame_ts = timestamp
            self.stats.fps = _calculate_fps(self._timestamps)
            if self.handler:
                try:
                    self.handler(self.config.camera_id, frame)
                except Exception as exc:
                    logger.error("Frame handler error for %s: %s", self.config.camera_id, exc)
            time.sleep(0.0)
