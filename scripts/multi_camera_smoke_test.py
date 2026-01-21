from __future__ import annotations

import argparse
import time

from camera.manager import CameraManager


def main() -> None:
    parser = argparse.ArgumentParser(description="Multi-camera smoke test")
    parser.add_argument("--config", default="config/cameras.yaml")
    parser.add_argument("--duration", type=int, default=30)
    args = parser.parse_args()

    manager = CameraManager.from_config_path(args.config)
    manager.start()
    print(f"Running smoke test for {args.duration}s...")

    start = time.time()
    try:
        while time.time() - start < args.duration:
            status = manager.status()
            for cam in status:
                stats = cam["stats"]
                print(
                    f"{cam['id']} ({cam['type']}) {cam['resolution']} "
                    f"fps={stats['fps']:.1f} frames={stats['frames']} dropped={stats['dropped']}"
                )
            time.sleep(5)
    finally:
        manager.stop()


if __name__ == "__main__":
    main()
