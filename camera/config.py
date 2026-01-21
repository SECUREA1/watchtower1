from __future__ import annotations

import json
from pathlib import Path
from typing import List

import yaml

from camera.types import CameraConfig


class ConfigError(RuntimeError):
    pass


def _load_data(path: Path) -> dict:
    if not path.exists():
        raise ConfigError(f"Config file not found: {path}")
    if path.suffix.lower() in {".yaml", ".yml"}:
        return yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if path.suffix.lower() == ".json":
        return json.loads(path.read_text(encoding="utf-8"))
    raise ConfigError("Config must be YAML or JSON.")


def load_camera_configs(path: Path) -> List[CameraConfig]:
    data = _load_data(path)
    cameras = data.get("cameras") or []
    configs: List[CameraConfig] = []
    for entry in cameras:
        configs.append(
            CameraConfig(
                camera_id=str(entry.get("id") or entry.get("camera_id")),
                camera_type=str(entry.get("type") or entry.get("camera_type") or "usb"),
                device_path=entry.get("device"),
                sensor_id=entry.get("sensor_id"),
                width=int(entry.get("width", 1280)),
                height=int(entry.get("height", 720)),
                fps=int(entry.get("fps", 30)),
                flip_method=int(entry.get("flip", 0)),
                enable_inference=bool(entry.get("inference", {}).get("enabled", False)),
                model_path=entry.get("inference", {}).get("model_path"),
                extra_caps=tuple(entry.get("extra_caps", [])),
            )
        )
    return configs
