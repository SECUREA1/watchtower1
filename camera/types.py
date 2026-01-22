from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, Tuple


@dataclass(frozen=True)
class CameraInfo:
    camera_id: str
    camera_type: str
    device_path: Optional[str] = None
    sensor_id: Optional[int] = None
    label: Optional[str] = None
    by_id: Optional[str] = None
    by_path: Optional[str] = None


@dataclass
class CameraConfig:
    camera_id: str
    camera_type: str
    device_path: Optional[str] = None
    sensor_id: Optional[int] = None
    width: int = 1280
    height: int = 720
    fps: int = 30
    flip_method: int = 0
    enable_inference: bool = False
    model_path: Optional[str] = None
    extra_caps: Tuple[str, ...] = field(default_factory=tuple)


@dataclass
class CameraStats:
    fps: float = 0.0
    frames: int = 0
    dropped: int = 0
    last_frame_ts: float = 0.0
    last_error: Optional[str] = None
