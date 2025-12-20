# RedNode Object Detection Server (FastAPI + YOLOv8)

This server provides a `/detect` endpoint that accepts an image and returns YOLOv8 detections.

## Setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### Download the YOLOv8 model

Ultralytics will automatically download `yolov8n.pt` the first time you run the server.
If you want to pre-download, run:

```bash
python -c "from ultralytics import YOLO; YOLO('yolov8n.pt')"
```

## Run

```bash
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

## Example request

```bash
curl -X POST http://localhost:8000/detect \
  -F "image=@/path/to/image.jpg"
```

## Example response

```json
{
  "image_width": 1280,
  "image_height": 720,
  "detections": [
    {
      "x1": 125.2,
      "y1": 210.5,
      "x2": 310.8,
      "y2": 512.9,
      "class_id": 0,
      "class_name": "person",
      "confidence": 0.87
    }
  ]
}
```
