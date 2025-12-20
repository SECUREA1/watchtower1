# RedNode Object Detection - Debug & Testing Checklist

## Mobile/WebView Console Checks
- Confirm TFJS backend selection:
  - `await tf.ready(); console.log(tf.getBackend());`
- Look for WebGL errors (unsupported GPU, context lost).
- Look for wasm load errors (404 or CORS) for `tf-backend-wasm.wasm`.
- Confirm COCO-SSD model loaded (log: `COCO-SSD model loaded successfully`).

## Model/Inference Health
- Check per-frame logs and timings; confirm detections return objects.
- If inference is slow, reduce FPS or downscale max size.

## Server API Test
```bash
curl -X POST http://localhost:8000/detect \
  -F "image=@/path/to/image.jpg"
```

## Common Failures
- CORS blocked: ensure server allows origin or use local proxy.
- wasm 404: ensure wasm files are hosted and path is correct.
- WebGL unsupported: fallback should show backend as wasm/cpu.
