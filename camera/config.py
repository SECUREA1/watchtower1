from __future__ import annotations

import json
from pathlib import Path
from typing import List

import yaml

from camera.discovery import discover_cameras
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
    auto_discover_usb = bool(data.get("auto_discover_usb", False))
    usb_defaults = data.get("usb_defaults") or {}
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
    if auto_discover_usb:
        seen_ids = {config.camera_id for config in configs if config.camera_id}
        seen_devices = {config.device_path for config in configs if config.device_path}
        default_width = int(usb_defaults.get("width", 1280))
        default_height = int(usb_defaults.get("height", 720))
        default_fps = int(usb_defaults.get("fps", 30))
        default_flip = int(usb_defaults.get("flip", 0))
        default_extra_caps = tuple(usb_defaults.get("extra_caps", []))
        for cam in discover_cameras():
            if cam.camera_type != "usb":
                continue
            if cam.camera_id in seen_ids or cam.device_path in seen_devices:
                continue
            configs.append(
                CameraConfig(
                    camera_id=cam.camera_id,
                    camera_type="usb",
                    device_path=cam.device_path,
                    width=default_width,
                    height=default_height,
                    fps=default_fps,
                    flip_method=default_flip,
                    enable_inference=bool(usb_defaults.get("inference", {}).get("enabled", False)),
                    model_path=usb_defaults.get("inference", {}).get("model_path"),
                    extra_caps=default_extra_caps,
                )
            )
            seen_ids.add(cam.camera_id)
            if cam.device_path:
                seen_devices.add(cam.device_path)
    return configs
