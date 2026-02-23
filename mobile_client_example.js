// mobile_client_example.js
// Example: capture a low-res frame from camera video, POST to /detect, draw overlays.

const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const serverUrl = 'http://localhost:8000/detect';

const uploadFps = 2; // throttle uploads
const retryDelayMs = 1000;
let lastUpload = 0;
let inFlight = false;

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment' },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
}

function downscaleFrame(videoElement, maxSize = 640) {
  const { videoWidth, videoHeight } = videoElement;
  const longSide = Math.max(videoWidth, videoHeight);
  const scale = longSide > maxSize ? maxSize / longSide : 1;
  const width = Math.round(videoWidth * scale);
  const height = Math.round(videoHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(videoElement, 0, 0, width, height);
  return canvas;
}

async function postFrame() {
  const canvas = downscaleFrame(video, 640);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.7));
  const formData = new FormData();
  formData.append('image', blob, 'frame.jpg');

  const response = await fetch(serverUrl, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Server error: ${response.status}`);
  }

  return response.json();
}

function drawDetections(result) {
  const ctx = overlay.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const width = video.clientWidth;
  const height = video.clientHeight;

  overlay.width = width * dpr;
  overlay.height = height * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  const scaleX = width / result.image_width;
  const scaleY = height / result.image_height;

  ctx.strokeStyle = '#22c55e';
  ctx.lineWidth = 2;
  ctx.font = '14px ui-sans-serif';
  ctx.fillStyle = '#22c55e';

  for (const det of result.detections) {
    const x = det.x1 * scaleX;
    const y = det.y1 * scaleY;
    const w = (det.x2 - det.x1) * scaleX;
    const h = (det.y2 - det.y1) * scaleY;
    ctx.strokeRect(x, y, w, h);
    ctx.fillText(`${det.class_name} ${(det.confidence * 100).toFixed(1)}%`, x, Math.max(12, y - 4));
  }
}

async function loop(time) {
  requestAnimationFrame(loop);
  if (inFlight || time - lastUpload < 1000 / uploadFps) return;
  if (video.readyState < 2) return;

  lastUpload = time;
  inFlight = true;

  try {
    const result = await postFrame();
    drawDetections(result);
  } catch (error) {
    console.warn('Upload failed, retrying...', error);
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  } finally {
    inFlight = false;
  }
}

startCamera().then(() => requestAnimationFrame(loop));
