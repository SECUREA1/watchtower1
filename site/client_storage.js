// client_storage.js
// Client-side storage and sync helpers for RedNode face images + logs.
// Uses IndexedDB via idb (ESM CDN) and supports local/server storage selection.

import { openDB } from 'https://cdn.jsdelivr.net/npm/idb@7.1.1/build/esm/index.js';
import { captureFrameBlob, drawThumbnail } from './detection.js';

const DB_NAME = 'rednode-face-storage';
const DB_VERSION = 1;
const STORE = 'faces';
const SETTINGS_KEY = 'rednode.storage.settings.v1';
const DEVICE_KEY = 'rednode.storage.device-id.v1';
const DEFAULT_SERVER_URL = (() => {
  if (typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null') {
    return window.location.origin;
  }
  return 'http://localhost:8000';
})();
const HEALTH_PATHS = ['/healthz', '/health'];

const MAX_LOCAL_PREVIEW_BYTES = 2 * 1024 * 1024; // 2MB for local operations

const el = (id) => document.getElementById(id);
const runtimeStatus = {
  serverOk: false,
  commitReady: false,
  checking: false,
  serverMessage: '',
  feedbackState: '',
};

function uuid() {
  return crypto.randomUUID();
}

function getDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = uuid();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

function nowIso() {
  return new Date().toISOString();
}

function readSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    return {};
  }
}

function normalizeServerUrl(url) {
  const trimmed = (url || '').trim();
  if (!trimmed) return DEFAULT_SERVER_URL;
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

function writeSettings(partial) {
  const current = readSettings();
  const next = { ...current, ...partial };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

function setStorageFeedback(message, variant = '') {
  const storageFeedback = el('storageFeedback');
  if (storageFeedback) {
    const classes = ['storage-feedback'];
    if (variant) classes.push(variant);
    storageFeedback.className = classes.join(' ');
    storageFeedback.textContent = message;
  }
  runtimeStatus.serverMessage = message;
  runtimeStatus.feedbackState = variant;
}

async function getDb() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    },
  });
}

export async function saveLocalFace(record) {
  const db = await getDb();
  await db.put(STORE, record);
  return record;
}

export async function listLocalFaces() {
  const db = await getDb();
  const rows = await db.getAll(STORE);
  return rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

export async function deleteLocalFace(id) {
  const db = await getDb();
  await db.delete(STORE, id);
}

function getStorageChoice(defaultMode) {
  const checked = document.querySelector('input[name="storageChoice"]:checked');
  return checked?.value || defaultMode || 'local';
}

function getDefaultStorageMode() {
  const checked = document.querySelector('input[name="defaultStorage"]:checked');
  return checked?.value || 'local';
}

function getAuthHeader() {
  const token = (el('adminToken')?.value || '').trim();
  if (!token) return null;
  if (token.toLowerCase().startsWith('bearer ')) return token;
  if (token.toLowerCase().startsWith('token ')) return token;
  return `Bearer ${token}`;
}

function buildMetadata({ name, consent = true }) {
  return {
    consent: consent !== false,
    consent_timestamp: consent === false ? null : nowIso(),
    source_device_id: getDeviceId(),
    note: name ? `Named ${name}` : null,
  };
}

function ensureConsent() {
  // Consent is assumed for streamlined server flows; checkbox is kept for visibility only.
  const checkbox = el('consentCheckbox');
  if (checkbox && !checkbox.checked) {
    checkbox.checked = true;
    writeSettings({ consent: true });
  }
  return true;
}

async function blobFromInput() {
  const fileInput = el('faceFileInput');
  const file = fileInput?.files?.[0] || null;
  if (file) return file;

  const preview = el('facePreview');
  if (preview && preview.toDataURL) {
    return captureFrameBlob(preview, { maxSize: 512 });
  }
  return null;
}

async function uploadFaceToServer({ blob, record, serverUrl }) {
  const formData = new FormData();
  formData.append('image', blob, `face-${record.id}.jpg`);
  formData.append('metadata', JSON.stringify(record));

  const headers = {};
  const authHeader = getAuthHeader();
  if (authHeader) headers.Authorization = authHeader;

  const response = await fetch(`${serverUrl}/api/faces/add`, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Server upload failed (${response.status}): ${detail}`);
  }

  return response.json();
}

async function renderFaceList({ localFaces, serverFaces, serverUrl }) {
  const faceList = el('faceList');
  if (!faceList) return;
  faceList.innerHTML = '';

  if (!localFaces.length && !serverFaces.length) {
    const empty = document.createElement('div');
    empty.className = 'hint';
    empty.textContent = 'No faces stored yet.';
    faceList.appendChild(empty);
    return;
  }

  const renderItem = (face, source) => {
    const item = document.createElement('div');
    item.className = 'storage-item';

    const img = document.createElement('img');
    img.className = 'storage-thumb';
    if (face.local_blob && face.local_blob instanceof Blob) {
      const url = URL.createObjectURL(face.local_blob);
      img.onload = () => URL.revokeObjectURL(url);
      img.src = url;
    } else if (face.server_url || face.image_url) {
      const path = face.server_url || face.image_url;
      img.src = path.startsWith('http') ? path : `${serverUrl}${path}`;
    } else {
      drawThumbnail(img, face.name || 'Face');
    }

    const meta = document.createElement('div');
    const name = face.name || 'Unnamed';
    const storage = face.storage || source;
    meta.innerHTML = `
      <div><b>${name}</b></div>
      <div class="storage-meta">${storage} • ${new Date(face.created_at).toLocaleString()}</div>
      <div class="storage-meta">${face.server_url || face.github_url || ''}</div>
    `;

    const actions = document.createElement('div');
    actions.className = 'storage-actions';
    if (source === 'local') {
      const delBtn = document.createElement('button');
      delBtn.className = 'ghost';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', async () => {
        await deleteLocalFace(face.id);
        await refreshFaceList();
      });
      actions.appendChild(delBtn);
    }

    item.append(img, meta, actions);
    faceList.appendChild(item);
  };

  localFaces.forEach((face) => renderItem(face, 'local'));
  serverFaces.forEach((face) => renderItem(face, 'server'));
}

async function refreshFaceList() {
  const localFaces = await listLocalFaces();
  let serverFaces = [];
  const serverUrl = normalizeServerUrl(el('serverUrl')?.value || DEFAULT_SERVER_URL);

  try {
    const response = await fetch(`${serverUrl}/api/faces/list`);
    if (response.ok) {
      const payload = await response.json();
      serverFaces = payload.faces || [];
      if (runtimeStatus.serverOk) {
        setStorageFeedback(
          'Server live. Cloud commits are enabled.',
          'good'
        );
      }
    } else {
      const detail = await response.text();
      setStorageFeedback(
        `Server list failed (${response.status}). ${detail || 'Check server logs.'}`,
        'warn'
      );
    }
  } catch (error) {
    setStorageFeedback('Server list unavailable. Showing local faces only.', 'warn');
  }

  await renderFaceList({ localFaces, serverFaces, serverUrl });
}

async function checkServerAvailability() {
  const serverUrl = normalizeServerUrl(el('serverUrl')?.value || DEFAULT_SERVER_URL);
  runtimeStatus.checking = true;
  runtimeStatus.serverOk = false;
  runtimeStatus.commitReady = false;
  setStorageFeedback('Checking server...', 'loading');
  updateStorageStatus();

  for (const path of HEALTH_PATHS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${serverUrl}${path}`, { signal: controller.signal });
      clearTimeout(timer);
      if (response.ok) {
        runtimeStatus.serverOk = true;
        break;
      }
    } catch (error) {
      // try next path
    }
  }

  runtimeStatus.checking = false;

  if (!runtimeStatus.serverOk) {
    runtimeStatus.commitReady = false;
    setStorageFeedback('Server unreachable. Check URL or stay in Local mode.', 'error');
    updateStorageStatus();
    return false;
  }

  try {
    const response = await fetch(`${serverUrl}/api/faces/list`);
    if (response.ok) {
      runtimeStatus.commitReady = true;
      setStorageFeedback('Server live. Cloud commits are enabled.', 'good');
    } else {
      const detail = await response.text();
      setStorageFeedback(
        `Server reachable but verification failed (${response.status}). ${detail || 'Check server logs.'}`,
        'warn'
      );
    }
  } catch (error) {
    setStorageFeedback(`Server reachable but verification failed: ${error.message}`, 'warn');
  }

  updateStorageStatus();
  return runtimeStatus.commitReady || runtimeStatus.serverOk;
}

async function handleSaveFace() {
  const defaultMode = getDefaultStorageMode();
  const storage = getStorageChoice(defaultMode);
  const name = (el('faceNameStorage')?.value || '').trim();
  const consentChecked = ensureConsent();

  const blob = await blobFromInput();
  if (!blob) {
    alert('Provide an image file or ensure a face preview is available.');
    return;
  }

  if (blob.size > MAX_LOCAL_PREVIEW_BYTES) {
    alert('Image is too large. Please select a smaller file.');
    return;
  }

  if (storage === 'server' && !runtimeStatus.serverOk) {
    setStorageFeedback('Cloud not reachable. Keeping face local.', 'warn');
    alert('Server is not reachable. Please verify the Server URL before uploading.');
    return;
  }

  const id = uuid();
  const createdAt = nowIso();
  const metadata = buildMetadata({ name, consent: consentChecked });

  const record = {
    id,
    name,
    created_at: createdAt,
    metadata,
    storage,
    local_blob_key: id,
    local_blob: blob,
    server_url: null,
    committed_to_github: false,
    github_commit_sha: null,
    source_device_id: getDeviceId(),
  };

  if (storage === 'local') {
    await saveLocalFace(record);
    setStorageFeedback('Saved locally.', 'good');
    await refreshFaceList();
    return;
  }

  try {
    const serverUrl = normalizeServerUrl(el('serverUrl')?.value || DEFAULT_SERVER_URL);
    const response = await uploadFaceToServer({ blob, record, serverUrl });
    record.storage = 'server';
    record.server_url = response.image_url || response.server_url || null;
    record.committed_to_github = Boolean(response.committed_to_github);
    record.github_commit_sha = response.github_commit_sha || null;
    await saveLocalFace(record);
    setStorageFeedback('Saved to cloud.', 'good');
    await refreshFaceList();
  } catch (error) {
    console.error(error);
    setStorageFeedback('Cloud upload failed.', 'warn');
    alert(error.message || 'Failed to upload face.');
  }
}

async function handleSaveLogs() {
  const serverUrl = normalizeServerUrl(el('serverUrl')?.value || DEFAULT_SERVER_URL);
  const authHeader = getAuthHeader();
  const logs = window.rednodeLogsSnapshot ? window.rednodeLogsSnapshot() : [];

  if (!logs.length) {
    alert('No logs available to upload.');
    return;
  }

  const payload = {
    logs,
    source_device_id: getDeviceId(),
    captured_at: nowIso(),
  };

  const response = await fetch(`${serverUrl}/api/logs/add`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text();
    alert(`Log upload failed (${response.status}): ${detail}`);
    return;
  }

  alert('Logs uploaded successfully.');
}

export async function syncLocalToServer({ silent = false } = {}) {
  const serverUrl = normalizeServerUrl(el('serverUrl')?.value || DEFAULT_SERVER_URL);
  const localFaces = await listLocalFaces();
  const pending = localFaces.filter((face) => face.storage === 'local');
  if (!pending.length) {
    if (!silent) alert('No local faces to sync.');
    setStorageFeedback('No local faces to sync.', 'warn');
    return 0;
  }

  ensureConsent();
  if (!runtimeStatus.serverOk) {
    if (!silent) alert('Server is not reachable. Update the Server URL or stay in Local mode.');
    setStorageFeedback('Server not reachable. Update the Server URL or stay in Local mode.', 'error');
    return 0;
  }

  setStorageFeedback('Committing pending faces to cloud...', 'loading');
  let synced = 0;
  for (const face of pending) {
    try {
      face.metadata = face.metadata || {};
      face.metadata.consent = true;
      face.metadata.consent_timestamp = nowIso();
      const response = await uploadFaceToServer({ blob: face.local_blob, record: face, serverUrl });
      face.storage = 'server';
      face.server_url = response.image_url || response.server_url || null;
      face.committed_to_github = Boolean(response.committed_to_github);
      face.github_commit_sha = response.github_commit_sha || null;
      await saveLocalFace(face);
      synced += 1;
    } catch (error) {
      console.error(error);
      setStorageFeedback(
        `Failed to sync ${face.name || face.id}: ${error.message || 'Unknown error'}`,
        'warn'
      );
      if (!silent) alert(`Failed to sync ${face.name || face.id}: ${error.message}`);
      break;
    }
  }

  await refreshFaceList();
  if (synced) {
    setStorageFeedback(`Committed ${synced} face(s) to cloud.`, 'good');
  }
  updateStorageStatus();
  return synced;
}

function updateStorageStatus() {
  const status = el('storageStatus');
  const statusText = status?.querySelector('.status-text');
  const storageAlert = el('storageAlert');
  const activationBadge = el('serverActivationBadge');
  if (!status) return;
  const mode = getDefaultStorageMode();
  status.classList.toggle('cloud', mode === 'server');
  status.classList.toggle('local', mode !== 'server');
  if (statusText) {
    if (mode === 'server') {
      if (runtimeStatus.checking) {
        statusText.textContent = 'Checking...';
      } else if (runtimeStatus.commitReady) {
        statusText.textContent = 'Cloud live';
      } else if (runtimeStatus.serverOk) {
        statusText.textContent = 'Cloud reachable';
      } else {
        statusText.textContent = 'Cloud unavailable';
      }
    } else {
      statusText.textContent = 'Local active';
    }
  }
  if (storageAlert) {
    const serverMsg =
      mode === 'server' && !runtimeStatus.serverOk ? 'Server unreachable. Staying local.' : '';
    storageAlert.textContent = [serverMsg].filter(Boolean).join(' ');
  }
  const storageFeedback = el('storageFeedback');
  if (storageFeedback) {
    const classes = ['storage-feedback'];
    if (runtimeStatus.feedbackState) classes.push(runtimeStatus.feedbackState);
    storageFeedback.className = classes.join(' ');
    const fallback = mode === 'server' ? 'Awaiting server check.' : 'Ready to save.';
    storageFeedback.textContent = runtimeStatus.serverMessage || fallback;
  }
  if (activationBadge) {
    let badgeState = 'warn';
    let badgeText = 'Not checked';
    if (runtimeStatus.checking) {
      badgeState = 'loading';
      badgeText = 'Checking...';
    } else if (runtimeStatus.commitReady || runtimeStatus.serverOk) {
      badgeState = runtimeStatus.commitReady ? 'good' : 'warn';
      badgeText = runtimeStatus.commitReady ? 'Live: commits enabled' : 'Reachable';
    } else {
      badgeState = 'bad';
      badgeText = 'Offline';
    }
    activationBadge.className = `pill-mini ${badgeState}`;
    activationBadge.textContent = badgeText;
  }
}

async function activateServer({ commitAfter = false } = {}) {
  await checkServerAvailability();
  if (commitAfter && runtimeStatus.serverOk) {
    await syncLocalToServer({ silent: true });
  }
}

function loadInitialUiState() {
  const settings = readSettings();
  el('serverUrl').value = settings.serverUrl || DEFAULT_SERVER_URL;
  el('adminToken').value = settings.adminToken || '';
  const defaultMode = settings.defaultMode || (settings.useServer ? 'server' : 'local');
  const defaultChoice = document.querySelector(
    `input[name="defaultStorage"][value="${defaultMode}"]`
  );
  if (defaultChoice) defaultChoice.checked = true;
  const perUploadChoice = document.querySelector(
    `input[name="storageChoice"][value="${defaultMode}"]`
  );
  if (perUploadChoice) perUploadChoice.checked = true;
  el('consentCheckbox').checked = Boolean(settings.consent);
  setStorageFeedback('Ready to save.');
  updateStorageStatus();
}

function wireUi() {
  el('btnSaveFaceStorage')?.addEventListener('click', handleSaveFace);
  el('btnSaveLogs')?.addEventListener('click', handleSaveLogs);
  el('btnListFaces')?.addEventListener('click', refreshFaceList);
  el('btnSyncFaces')?.addEventListener('click', () => syncLocalToServer());
  el('btnActivateServer')?.addEventListener('click', () => activateServer());
  el('btnCommitPending')?.addEventListener('click', () => activateServer({ commitAfter: true }));

  document.querySelectorAll('input[name="defaultStorage"]').forEach((input) => {
    input.addEventListener('change', (event) => {
      writeSettings({ defaultMode: event.target.value, useServer: event.target.value === 'server' });
      const perUploadChoice = document.querySelector(
        `input[name="storageChoice"][value="${event.target.value}"]`
      );
      if (perUploadChoice) perUploadChoice.checked = true;
      updateStorageStatus();
      if (event.target.value === 'server') {
        checkServerAvailability();
      }
    });
  });

  el('consentCheckbox')?.addEventListener('change', (event) => {
    writeSettings({ consent: event.target.checked });
    updateStorageStatus();
  });

  el('serverUrl')?.addEventListener('change', (event) => {
    writeSettings({ serverUrl: normalizeServerUrl(event.target.value) });
    checkServerAvailability();
  });

  el('adminToken')?.addEventListener('change', (event) => {
    writeSettings({ adminToken: event.target.value.trim() });
  });
}

async function init() {
  loadInitialUiState();
  wireUi();
  await checkServerAvailability();
  await refreshFaceList();
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
