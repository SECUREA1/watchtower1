from __future__ import annotations

import logging
from typing import Dict, List, Optional

from camera.capture_worker import CaptureWorker
from camera.config import load_camera_configs
from camera.discovery import discover_cameras
from camera.types import CameraConfig, CameraStats

logger = logging.getLogger("rednode.camera")


class CameraManager:
    def __init__(self, configs: List[CameraConfig]) -> None:
        self.configs = configs
        self.workers: Dict[str, CaptureWorker] = {}

    @classmethod
    def from_config_path(cls, path) -> "CameraManager":
        return cls(load_camera_configs(path))

    def start(self) -> None:
        for config in self.configs:
            if config.camera_id in self.workers:
                continue
            worker = CaptureWorker(config)
            self.workers[config.camera_id] = worker
            worker.start()
        logger.info("Started %s camera workers", len(self.workers))

    def stop(self) -> None:
        for worker in self.workers.values():
            worker.stop()
        self.workers.clear()

    def latest_frame(self, camera_id: str):
        worker = self.workers.get(camera_id)
        if not worker:
            return None
        return worker.latest_frame()

    def status(self) -> List[dict]:
        payload = []
        for config in self.configs:
            stats: Optional[CameraStats] = None
            worker = self.workers.get(config.camera_id)
            if worker:
                stats = worker.stats
            payload.append(
                {
                    "id": config.camera_id,
                    "type": config.camera_type,
                    "device": config.device_path,
                    "sensor_id": config.sensor_id,
                    "resolution": f"{config.width}x{config.height}",
                    "fps_target": config.fps,
                    "flip": config.flip_method,
                    "stats": {
                        "fps": stats.fps if stats else 0.0,
                        "frames": stats.frames if stats else 0,
                        "dropped": stats.dropped if stats else 0,
                        "last_frame_ts": stats.last_frame_ts if stats else 0.0,
                        "last_error": stats.last_error if stats else None,
                    },
                }
            )
        return payload


__all__ = ["CameraManager", "discover_cameras"]
