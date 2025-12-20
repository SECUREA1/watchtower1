// detection.js
// Robust TFJS + COCO-SSD loader for mobile browser/WebView with backend fallbacks.

const DEFAULT_TFJS_VERSION = '3.21.0';
const DEFAULT_COCO_VERSION = '2.2.2';

export function createLogger(element) {
  const log = (level, message, error) => {
    const timestamp = new Date().toISOString();
    const suffix = error ? `\n${error.stack || error.message || error}` : '';
    const line = `[${timestamp}] [${level}] ${message}${suffix}`;
    if (element) {
      element.textContent += `${line}\n`;
      element.scrollTop = element.scrollHeight;
    }
    if (level === 'ERROR') {
      // eslint-disable-next-line no-console
      console.error(line);
    } else {
      // eslint-disable-next-line no-console
      console.log(line);
    }
  };

  return {
    info: (message) => log('INFO', message),
    warn: (message) => log('WARN', message),
    error: (message, error) => log('ERROR', message, error),
  };
}

async function loadTfjs(version = DEFAULT_TFJS_VERSION) {
  // Load TFJS core bundle via CDN.
  return import(`https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@${version}/dist/tf.es2017.min.js`);
}

async function loadWasmBackend(version = DEFAULT_TFJS_VERSION) {
  // Load wasm backend for TFJS and return module.
  return import(`https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@${version}/dist/tf-backend-wasm.es2017.js`);
}

async function loadCocoSsd(version = DEFAULT_COCO_VERSION) {
  return import(`https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@${version}/dist/coco-ssd.esm.js`);
}

async function selectBackend(tf, logger, options) {
  const backends = ['webgl', 'wasm', 'cpu'];
  const { wasmPath } = options;

  for (const backend of backends) {
    try {
      if (backend === 'wasm') {
        await loadWasmBackend(options.tfjsVersion);
        if (tf.wasm?.setWasmPaths) {
          // CDN example; for local hosting, serve wasm files and set to '/tfjs/' etc.
          // Example local: tf.wasm.setWasmPaths('/static/tfjs-wasm/');
          const wasmPathValue = wasmPath
            || `https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@${options.tfjsVersion || DEFAULT_TFJS_VERSION}/dist/`;
          tf.wasm.setWasmPaths(wasmPathValue);
          logger.info(`Set TFJS wasm paths to ${wasmPathValue}`);
        } else {
          logger.warn('tf.wasm.setWasmPaths not available; wasm path may not be configured.');
        }
      }

      await tf.setBackend(backend);
      await tf.ready();
      logger.info(`TFJS backend set to ${tf.getBackend()}`);
      return tf.getBackend();
    } catch (error) {
      logger.warn(`Failed to set backend: ${backend}. Trying next backend. Error: ${error}`);
    }
  }

  logger.warn('Falling back to default backend (cpu).');
  await tf.setBackend('cpu');
  await tf.ready();
  return tf.getBackend();
}

export async function initDetection(options = {}) {
  const logger = options.logger || createLogger();
  const tfjsVersion = options.tfjsVersion || DEFAULT_TFJS_VERSION;
  const cocoVersion = options.cocoVersion || DEFAULT_COCO_VERSION;

  let tf = null;
  let model = null;
  let usingServerFallback = false;

  try {
    logger.info('Loading TFJS...');
    tf = await loadTfjs(tfjsVersion);
    logger.info('TFJS loaded. Selecting backend...');
    const backend = await selectBackend(tf, logger, { ...options, tfjsVersion });
    logger.info(`Backend ready: ${backend}`);

    logger.info('Loading COCO-SSD model...');
    const cocoModule = await loadCocoSsd(cocoVersion);
    model = await cocoModule.load();
    logger.info('COCO-SSD model loaded successfully.');
  } catch (error) {
    usingServerFallback = true;
    logger.error('COCO-SSD failed to load. Falling back to server detection.', error);
  }

  return { tf, model, usingServerFallback };
}

function downscaleToCanvas(videoElement, maxSize = 640) {
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

async function detectWithServer(videoElement, options) {
  const canvas = downscaleToCanvas(videoElement, options.maxSize);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.7));
  const formData = new FormData();
  formData.append('image', blob, 'frame.jpg');

  const response = await fetch(options.serverUrl, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Server detection failed with status ${response.status}`);
  }

  return response.json();
}

export function detectLoop(videoElement, onResult, options = {}) {
  const logger = options.logger || createLogger();
  const fps = options.fps || 8;
  const maxSize = options.maxSize || 640;
  const intervalMs = 1000 / fps;
  let stopped = false;
  let lastTime = 0;
  let inFlight = false;

  const loop = async (time) => {
    if (stopped) return;
    requestAnimationFrame(loop);

    if (inFlight || time - lastTime < intervalMs) return;
    if (videoElement.readyState < 2) return;

    lastTime = time;
    inFlight = true;

    try {
      if (options.model && !options.usingServerFallback) {
        const canvas = downscaleToCanvas(videoElement, maxSize);
        const predictions = await options.model.detect(canvas);
        onResult({
          predictions,
          source: 'local',
          imageWidth: canvas.width,
          imageHeight: canvas.height,
        });
      } else {
        const serverResult = await detectWithServer(videoElement, {
          serverUrl: options.serverUrl,
          maxSize,
        });
        onResult({
          predictions: serverResult.detections,
          source: 'server',
          imageWidth: serverResult.image_width,
          imageHeight: serverResult.image_height,
        });
      }
    } catch (error) {
      logger.error('Detection loop error', error);
    } finally {
      inFlight = false;
    }
  };

  requestAnimationFrame(loop);

  return () => {
    stopped = true;
  };
}

export function drawDetections(canvas, video, result) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const width = video.clientWidth;
  const height = video.clientHeight;

  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  const scaleX = width / (result.imageWidth || width);
  const scaleY = height / (result.imageHeight || height);

  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 2;
  ctx.font = '14px ui-sans-serif';
  ctx.fillStyle = '#38bdf8';

  for (const det of result.predictions || []) {
    const box = det.bbox || [det.x1, det.y1, det.x2 - det.x1, det.y2 - det.y1];
    const [x, y, w, h] = box;
    const label = det.class || det.class_name || 'object';
    const score = det.score || det.confidence || 0;

    const drawX = x * scaleX;
    const drawY = y * scaleY;
    const drawW = w * scaleX;
    const drawH = h * scaleY;

    ctx.strokeRect(drawX, drawY, drawW, drawH);
    ctx.fillText(`${label} ${(score * 100).toFixed(1)}%`, drawX, Math.max(12, drawY - 4));
  }
}
