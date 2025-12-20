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
const DEFAULT_SERVER_URL = 'http://localhost:8000';

const MAX_LOCAL_PREVIEW_BYTES = 2 * 1024 * 1024; // 2MB for local operations

const el = (id) => document.getElementById(id);

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
  const trimmed = url.trim();
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

function writeSettings(partial) {
  const current = readSettings();
  const next = { ...current, ...partial };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  return next;
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

function buildMetadata({ name, consent }) {
  return {
    consent: Boolean(consent),
    consent_timestamp: consent ? nowIso() : null,
    source_device_id: getDeviceId(),
    note: name ? `Named ${name}` : null,
  };
}

function ensureConsent(consentChecked) {
  if (consentChecked) return true;
  const confirmed = window.confirm(
    'You are about to upload face images to the server/GitHub. Do you have consent?'
  );
  if (confirmed) {
    el('consentCheckbox').checked = true;
  }
  return confirmed;
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
  const authHeader = getAuthHeader();

  try {
    const response = await fetch(`${serverUrl}/api/faces/list`, {
      headers: authHeader ? { Authorization: authHeader } : undefined,
    });
    if (response.ok) {
      const payload = await response.json();
      serverFaces = payload.faces || [];
    }
  } catch (error) {
    // Ignore server list failures; local list is still useful.
  }

  await renderFaceList({ localFaces, serverFaces, serverUrl });
}

async function handleSaveFace() {
  const storageFeedback = el('storageFeedback');
  const defaultMode = getDefaultStorageMode();
  const storage = getStorageChoice(defaultMode);
  const name = (el('faceNameStorage')?.value || '').trim();
  let consentChecked = Boolean(el('consentCheckbox')?.checked);

  const blob = await blobFromInput();
  if (!blob) {
    alert('Provide an image file or ensure a face preview is available.');
    return;
  }

  if (blob.size > MAX_LOCAL_PREVIEW_BYTES) {
    alert('Image is too large. Please select a smaller file.');
    return;
  }

  if (storage === 'server' && !ensureConsent(consentChecked)) {
    return;
  }
  consentChecked = Boolean(el('consentCheckbox')?.checked);

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
    if (storageFeedback) {
      storageFeedback.textContent = 'Saved locally.';
      storageFeedback.className = 'storage-feedback good';
    }
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
    if (storageFeedback) {
      storageFeedback.textContent = 'Saved to cloud.';
      storageFeedback.className = 'storage-feedback good';
    }
    await refreshFaceList();
  } catch (error) {
    console.error(error);
    if (storageFeedback) {
      storageFeedback.textContent = 'Cloud upload failed.';
      storageFeedback.className = 'storage-feedback warn';
    }
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

export async function syncLocalToServer() {
  const serverUrl = normalizeServerUrl(el('serverUrl')?.value || DEFAULT_SERVER_URL);
  const localFaces = await listLocalFaces();
  const pending = localFaces.filter((face) => face.storage === 'local');
  if (!pending.length) {
    alert('No local faces to sync.');
    return;
  }

  const consentChecked = Boolean(el('consentCheckbox')?.checked);
  if (!ensureConsent(consentChecked)) return;

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
    } catch (error) {
      console.error(error);
      alert(`Failed to sync ${face.name || face.id}: ${error.message}`);
      break;
    }
  }

  await refreshFaceList();
}

function updateStorageStatus() {
  const status = el('storageStatus');
  const statusText = status?.querySelector('.status-text');
  const storageAlert = el('storageAlert');
  if (!status) return;
  const mode = getDefaultStorageMode();
  status.classList.toggle('cloud', mode === 'server');
  status.classList.toggle('local', mode !== 'server');
  if (statusText) {
    statusText.textContent = mode === 'server' ? 'Cloud active' : 'Local active';
  }
  if (storageAlert) {
    const consentChecked = Boolean(el('consentCheckbox')?.checked);
    storageAlert.textContent =
      mode === 'server' && !consentChecked
        ? 'Consent is required before server uploads.'
        : '';
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
  el('consentCheckbox').checked = Boolean(settings.consent);
  updateStorageStatus();
}

function wireUi() {
  el('btnSaveFaceStorage')?.addEventListener('click', handleSaveFace);
  el('btnSaveLogs')?.addEventListener('click', handleSaveLogs);
  el('btnListFaces')?.addEventListener('click', refreshFaceList);
  el('btnSyncFaces')?.addEventListener('click', syncLocalToServer);

  document.querySelectorAll('input[name="defaultStorage"]').forEach((input) => {
    input.addEventListener('change', (event) => {
      writeSettings({ defaultMode: event.target.value, useServer: event.target.value === 'server' });
      updateStorageStatus();
    });
  });

  el('consentCheckbox')?.addEventListener('change', (event) => {
    writeSettings({ consent: event.target.checked });
    updateStorageStatus();
  });

  el('serverUrl')?.addEventListener('change', (event) => {
    writeSettings({ serverUrl: normalizeServerUrl(event.target.value) });
  });

  el('adminToken')?.addEventListener('change', (event) => {
    writeSettings({ adminToken: event.target.value.trim() });
  });
}

async function init() {
  loadInitialUiState();
  wireUi();
  await refreshFaceList();
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
