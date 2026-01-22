from __future__ import annotations

import json

from camera.discovery import discover_cameras


def main() -> None:
    cameras = discover_cameras()
    payload = [
        {
            "id": cam.camera_id,
            "type": cam.camera_type,
            "device": cam.device_path,
            "sensor_id": cam.sensor_id,
            "label": cam.label,
            "by_id": cam.by_id,
            "by_path": cam.by_path,
        }
        for cam in cameras
    ]
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
