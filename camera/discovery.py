from __future__ import annotations

import logging
from pathlib import Path
from typing import Dict, List, Optional

from camera.types import CameraInfo

logger = logging.getLogger("rednode.camera")


def _read_text(path: Path) -> Optional[str]:
    try:
        return path.read_text(encoding="utf-8").strip()
    except Exception:
        return None


def _map_symlinks(root: Path) -> Dict[str, str]:
    mapping: Dict[str, str] = {}
    if not root.exists():
        return mapping
    for entry in root.iterdir():
        try:
            target = entry.resolve()
        except Exception:
            continue
        mapping[str(target)] = entry.name
    return mapping


def list_video_devices() -> List[CameraInfo]:
    by_id = _map_symlinks(Path("/dev/v4l/by-id"))
    by_path = _map_symlinks(Path("/dev/v4l/by-path"))
    devices: List[CameraInfo] = []
    for node in sorted(Path("/dev").glob("video*")):
        sys_dir = Path("/sys/class/video4linux") / node.name
        if not sys_dir.exists():
            continue
        label = _read_text(sys_dir / "name")
        device_syspath = None
        try:
            device_syspath = (sys_dir / "device").resolve()
        except Exception:
            device_syspath = None
        is_usb = device_syspath and "usb" in str(device_syspath)
        camera_type = "usb" if is_usb else "v4l2"
        stable_id = by_id.get(str(node.resolve())) or by_path.get(str(node.resolve())) or node.name
        devices.append(
            CameraInfo(
                camera_id=stable_id,
                camera_type=camera_type,
                device_path=str(node),
                label=label,
                by_id=by_id.get(str(node.resolve())),
                by_path=by_path.get(str(node.resolve())),
            )
        )
    return devices


def list_csi_sensors() -> List[CameraInfo]:
    sensors: List[CameraInfo] = []
    modules_dir = Path("/proc/device-tree/tegra-camera-platform/modules")
    if not modules_dir.exists():
        return sensors
    for module in sorted(modules_dir.glob("module*")):
        badge = _read_text(module / "badge")
        try:
            sensor_id = int(module.name.replace("module", ""))
        except ValueError:
            sensor_id = None
        if sensor_id is None:
            continue
        camera_id = f"csi-{sensor_id}"
        sensors.append(
            CameraInfo(
                camera_id=camera_id,
                camera_type="csi",
                sensor_id=sensor_id,
                label=badge,
            )
        )
    return sensors


def discover_cameras() -> List[CameraInfo]:
    cameras = list_csi_sensors()
    cameras.extend(list_video_devices())
    logger.info("Discovered %s cameras", len(cameras))
    return cameras
