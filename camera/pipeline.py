from __future__ import annotations

from camera.types import CameraConfig


def build_gstreamer_pipeline(config: CameraConfig) -> str:
    common_caps = f"width={config.width},height={config.height},framerate={config.fps}/1"
    extra_caps = ",".join(config.extra_caps)
    if extra_caps:
        common_caps = f"{common_caps},{extra_caps}"

    if config.camera_type == "csi":
        if config.sensor_id is None:
            raise ValueError(f"CSI camera {config.camera_id} missing sensor_id")
        pipeline = (
            "nvarguscamerasrc sensor-id={sensor_id} ! "
            "video/x-raw(memory:NVMM),{caps} ! "
            "nvvidconv flip-method={flip} ! "
            "video/x-raw,format=BGRx ! "
            "videoconvert ! "
            "video/x-raw,format=BGR ! "
            "appsink drop=true max-buffers=1"
        )
        return pipeline.format(sensor_id=config.sensor_id, caps=common_caps, flip=config.flip_method)

    if not config.device_path:
        raise ValueError(f"Camera {config.camera_id} missing device path")

    pipeline = (
        "v4l2src device={device} ! "
        "video/x-raw,{caps} ! "
        "nvvidconv flip-method={flip} ! "
        "video/x-raw,format=BGRx ! "
        "videoconvert ! "
        "video/x-raw,format=BGR ! "
        "appsink drop=true max-buffers=1"
    )
    return pipeline.format(device=config.device_path, caps=common_caps, flip=config.flip_method)
