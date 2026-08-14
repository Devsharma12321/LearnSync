/* ============================================================
   LearnSync — Code Room JS (Redesigned 3-Panel)
   ============================================================ */

// ── Backend base URL (Render deployment) ──
const API_BASE = 'https://learnsync-9nyy.onrender.com';

// ── Starter code per language ──
const STARTER = {
  python:     `# Start coding here\ndef solution():\n    pass\n`,
  cpp:        `#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    // Start coding here\n    return 0;\n}\n`,
  java:       `public class Solution {\n    public static void main(String[] args) {\n        // Start coding here\n    }\n}\n`,
  javascript: `// Start coding here\nfunction solution() {\n\n}\n`,
  c:          `#include <stdio.h>\n\nint main() {\n    // Start coding here\n    return 0;\n}\n`,
};
const FILE_NAMES = { python:'solution.py', cpp:'solution.cpp', java:'Solution.java', javascript:'solution.js', c:'solution.c' };

// Dynamic peer data tracking
const remoteUsers = new Map(); // socketId -> { name, shareMode, micActive, micBlocked }

// ── State ──
let lang       = 'python';
let myEditor   = null;
let peerEditor = null;
let shareMode  = 'off';   // 'off' | 'view' | 'rw'
let wbMode     = 'rw';    // 'rw'  | 'ro'
let selectedPeer = null;
let isCreator  = true;    // treat self as creator (no backend yet)

// ── Panel state ──
let hiddenPanels   = new Set();
let expandedPanel  = null;

// ── Sync Flags ──
// isApplyingRemoteCode: guards peerEditor.onDidChangeModelContent from
// re-emitting peer-code-edit when WE are the ones applying a remote delta.
let isApplyingRemoteCode = false;
// isApplyingPeerEdit: guards myEditor.onDidChangeModelContent from
// re-broadcasting a delta that originated from a peer (prevents echo loop).
let isApplyingPeerEdit = false;

// ── Per-Peer Monaco Models (Step B: Delta Sync) ──
// Instead of a single peerEditor document, each remote user gets their own
// Monaco ITextModel. Deltas are applied to the correct model regardless of
// which peer is currently visible. When the user switches the peer panel,
// we simply call peerEditor.setModel(peerModels.get(socketId)).
const peerModels = new Map(); // socketId -> monaco.editor.ITextModel

/**
 * Returns (or lazily creates) the Monaco ITextModel for a given peer.
 * Must only be called after Monaco is loaded.
 */
function getOrCreatePeerModel(socketId, initialCode = '', language = 'python') {
  if (!peerModels.has(socketId)) {
    const model = monaco.editor.createModel(initialCode, language);
    peerModels.set(socketId, model);
  }
  return peerModels.get(socketId);
}

/**
 * Safely apply a changes array (from Monaco onDidChangeModelContent or
 * a remote delta payload) to any ITextModel without touching the editor.
 * Returns the model so callers can chain.
 */
function applyDeltaToModel(model, changes) {
  const edits = changes.map(c => ({
    range: new monaco.Range(
      c.range.startLineNumber, c.range.startColumn,
      c.range.endLineNumber,   c.range.endColumn
    ),
    text: c.text,
    forceMoveMarkers: true,
  }));
  model.applyEdits(edits);
  return model;
}

// ============================================================
// MIC / VOICE STATE
// ============================================================
let localMicStream  = null;       // MediaStream (audio only)
let micActive       = false;      // my mic is on?
let micBlocked      = false;      // admin has blocked my mic?
const remoteAudios  = {};         // socketId -> HTMLAudioElement
const locallyMuted  = new Set();  // socketIds locally muted by me
const speakingUsers = new Set();  // socketIds currently speaking
let   localAudioCtx = null;       // AudioContext for local speaking detection
let   localAnalyser = null;       // AnalyserNode for local stream
let   speakingCheckInterval = null;

// ============================================================
// MONACO SETUP
// ============================================================
require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' } });
require(['vs/editor/editor.main'], () => {

  // Shared theme
  monaco.editor.defineTheme('ls', {
    base: 'vs-dark', inherit: true,
    rules: [
      { token: 'keyword',  foreground: 'c792ea', fontStyle: 'bold' },
      { token: 'string',   foreground: 'c3e88d' },
      { token: 'number',   foreground: 'f78c6c' },
      { token: 'comment',  foreground: '637777', fontStyle: 'italic' },
      { token: 'type',     foreground: 'ffcb6b' },
      { token: 'function', foreground: '82aaff' },
    ],
    colors: {
      'editor.background':            '#0d0e14',
      'editor.foreground':            '#d4d4d4',
      'editorLineNumber.foreground':  '#3a4255',
      'editor.lineHighlightBackground': '#ffffff08',
      'editorCursor.foreground':      '#8b5cf6',
      'editor.selectionBackground':   '#8b5cf640',
      'editorGutter.background':      '#0d0e14',
    }
  });

  const commonOpts = {
    theme:              'ls',
    fontSize:           14,
    fontFamily:         "'JetBrains Mono','Fira Code',monospace",
    fontLigatures:      true,
    minimap:            { enabled: false },
    lineNumbers:        'on',
    automaticLayout:    true,
    scrollBeyondLastLine: false,
    padding:            { top: 14, bottom: 14 },
    cursorBlinking:     'smooth',
    smoothScrolling:    true,
    tabSize:            4,
    wordWrap:           'off',
    bracketPairColorization: { enabled: true },
    renderLineHighlight: 'line',
  };

  // My editor
  myEditor = monaco.editor.create(
    document.getElementById('monaco-mine'),
    { ...commonOpts, value: STARTER[lang], language: lang, readOnly: false }
  );

  // Broadcast only the specific changes (delta) that fired this event.
  // Avoids sending the entire document on every keystroke.
  myEditor.onDidChangeModelContent((event) => {
    // If this change was injected by an incoming peer-code-edit, don't
    // re-broadcast it (that would echo the peer's own edit back to them).
    if (isApplyingPeerEdit) return;
    if (shareMode === 'off' || !socket || !currentRoom) return;

    const changes = event.changes.map(c => ({
      range: {
        startLineNumber: c.range.startLineNumber,
        startColumn:     c.range.startColumn,
        endLineNumber:   c.range.endLineNumber,
        endColumn:       c.range.endColumn,
      },
      text:        c.text,
      rangeLength: c.rangeLength,
    }));

    socket.emit('code-update', {
      roomId:  currentRoom,
      changes: changes,   // delta — NOT the full document string
      lang:    lang,
    });
  });

  // Peer editor (always created, shown/hidden by JS)
  peerEditor = monaco.editor.create(
    document.getElementById('monaco-peer'),
    { ...commonOpts, value: '', language: 'python', readOnly: true }
  );

  // Send only the delta changes back to the peer when we edit in RW mode.
  peerEditor.onDidChangeModelContent((event) => {
    if (isApplyingRemoteCode) return; // Prevent loop from incoming remote deltas
    if (!selectedPeer || !socket || !currentRoom) return;

    const changes = event.changes.map(c => ({
      range: {
        startLineNumber: c.range.startLineNumber,
        startColumn:     c.range.startColumn,
        endLineNumber:   c.range.endLineNumber,
        endColumn:       c.range.endColumn,
      },
      text:        c.text,
      rangeLength: c.rangeLength,
    }));

    socket.emit('peer-code-edit', {
      target:  selectedPeer,
      changes: changes,   // delta — NOT the full document string
    });
  });

  toast('Editor ready ✓', 'success');
});

// ============================================================
// LANGUAGE SWITCH
// ============================================================
document.getElementById('lang-select').addEventListener('change', e => {
  lang = e.target.value;
  document.getElementById('tab-filename').textContent = FILE_NAMES[lang];
  if (!myEditor) return;
  monaco.editor.setModelLanguage(myEditor.getModel(), lang);
  myEditor.setValue(STARTER[lang]);
  myEditor.setScrollTop(0);

  if (shareMode !== 'off' && socket && currentRoom) {
      socket.emit('code-update', {
          roomId: currentRoom,
          code: myEditor.getValue(),
          lang: lang
      });
  }
});

// ============================================================
// MY EDITOR — COPY & CLEAR
// ============================================================
document.getElementById('copy-mine-btn').addEventListener('click', () => {
  const code = myEditor?.getValue() || '';
  navigator.clipboard.writeText(code).then(() => toast('Code copied!', 'success'));
});

let clearPending = false;
document.getElementById('clear-mine-btn').addEventListener('click', () => {
  if (!myEditor) { toast('Editor not ready yet', 'error'); return; }

  if (!clearPending) {
    // First click: warn the user
    clearPending = true;
    const btn = document.getElementById('clear-mine-btn');
    const origTitle = btn.title;
    btn.title = 'Click again to confirm clear';
    btn.style.color = '#f87171';
    toast('Click clear again to confirm', 'error');
    setTimeout(() => {
      clearPending = false;
      btn.title = origTitle;
      btn.style.color = '';
    }, 2500);
    return;
  }

  // Second click: actually clear
  clearPending = false;
  const btn = document.getElementById('clear-mine-btn');
  btn.style.color = '';
  myEditor.setValue(STARTER[lang] || '');
  myEditor.setScrollTop(0);
  myEditor.focus();
  toast('Editor cleared ✓', 'success');

  // Broadcast cleared code to room if sharing
  if (shareMode !== 'off' && socket && currentRoom) {
    socket.emit('code-update', {
      roomId: currentRoom,
      code: myEditor.getValue(),
      lang: lang
    });
  }
});

// ============================================================
// SHARE TOGGLE — what others can do to MY editor
// ============================================================
document.querySelectorAll('.share-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.share-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    shareMode = btn.dataset.share;

    const labels = { off: '🔒 Not sharing', view: '👁 Sharing (view)', rw: '✏️ Sharing (R/W)' };
    toast(labels[shareMode], 'success');
    
    if (socket && currentRoom) {
        socket.emit('share-mode-change', { roomId: currentRoom, mode: shareMode });
        if (shareMode !== 'off' && myEditor) {
            socket.emit('code-update', {
                roomId: currentRoom,
                code: myEditor.getValue(),
                lang: lang
            });
        }
    }
  });
});

// ============================================================
// PEER SELECTOR & DYNAMIC UI UPDATES
// ============================================================
document.getElementById('peer-select').addEventListener('change', e => {
  const val = e.target.value;
  selectedPeer = val || null;
  renderPeerPanel();
});

function renderPeerPanel() {
  const emptyEl       = document.getElementById('peer-empty');
  const notSharing    = document.getElementById('peer-not-sharing');
  const peerMono      = document.getElementById('monaco-peer');
  const permBadge     = document.getElementById('peer-perm-badge');
  const notSharingMsg = document.getElementById('peer-not-sharing-name');
  const speakerBtn    = document.getElementById('peer-speaker-btn');

  if (!selectedPeer || !remoteUsers.has(selectedPeer)) {
    emptyEl.style.display    = 'flex';
    notSharing.style.display = 'none';
    peerMono.style.display   = 'none';
    permBadge.textContent    = 'View only';
    permBadge.className      = 'peer-perm-badge badge perm-off';
    speakerBtn.style.display = 'none';
    return;
  }

  const peer = remoteUsers.get(selectedPeer);

  // Update speaker button
  renderPeerSpeakerBtn(selectedPeer, peer);

  if (peer.shareMode === 'off') {
    emptyEl.style.display    = 'none';
    notSharing.style.display = 'flex';
    peerMono.style.display   = 'none';
    notSharingMsg.textContent = `${peer.name} isn't sharing their editor`;
    permBadge.textContent    = 'Not sharing';
    permBadge.className      = 'peer-perm-badge badge perm-off';
    return;
  }

  emptyEl.style.display    = 'none';
  notSharing.style.display = 'none';
  peerMono.style.display   = 'block';

  if (peerEditor) {
    // Switch the editor to display this peer's dedicated Monaco model.
    // The model is kept up-to-date with deltas even while another peer
    // is selected, so no setValue/full-reload is needed here.
    const model = getOrCreatePeerModel(selectedPeer, peer.code || '', peer.lang || 'python');
    isApplyingRemoteCode = true;
    peerEditor.setModel(model);
    peerEditor.updateOptions({ readOnly: peer.shareMode !== 'rw' });
    isApplyingRemoteCode = false;
    setTimeout(() => peerEditor.layout(), 50);
  }

  if (peer.shareMode === 'rw') {
    permBadge.textContent = '✏️ R/W';
    permBadge.className   = 'peer-perm-badge badge perm-rw';
  } else {
    permBadge.textContent = '👁 View only';
    permBadge.className   = 'peer-perm-badge badge perm-view';
  }
}

function renderPeerSpeakerBtn(socketId, peer) {
  const speakerBtn = document.getElementById('peer-speaker-btn');
  if (!peer.micActive || peer.micBlocked) {
    speakerBtn.style.display = 'none';
    return;
  }
  const isMuted = locallyMuted.has(socketId);
  speakerBtn.style.display = 'flex';
  speakerBtn.className     = isMuted ? 'muted' : 'active';
  speakerBtn.innerHTML     = isMuted
    ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg> Muted`
    : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg> Speaker`;
  // Re-attach listener (remove old one by replacing)
  const fresh = speakerBtn.cloneNode(true);
  speakerBtn.parentNode.replaceChild(fresh, speakerBtn);
  fresh.addEventListener('click', () => toggleLocalMute(socketId));
}

function updateUsersUI() {
  // Update Dropdown
  const select = document.getElementById('peer-select');
  select.innerHTML = '<option value="">— Select peer —</option>';
  
  // Update Avatars
  const usersContainer = document.getElementById('online-users');
  usersContainer.innerHTML = `
    <div class="user-bubble" title="You (host)">
      <div class="avatar avatar-sm" style="background:var(--grad-main)">Y</div>
      <span class="mic-status-dot ${micActive ? 'on' : 'off'}" id="my-mic-dot"></span>
    </div>`;

  remoteUsers.forEach((peer, socketId) => {
    // Add to dropdown
    const opt = document.createElement('option');
    opt.value = socketId;
    opt.textContent = peer.name;
    if (selectedPeer === socketId) opt.selected = true;
    select.appendChild(opt);

    // Build bubble classes
    const bubbleClasses = [
      'user-bubble',
      peer.micBlocked ? 'mic-blocked' : '',
      speakingUsers.has(socketId) ? 'speaking' : '',
      locallyMuted.has(socketId) ? 'user-muted' : ''
    ].filter(Boolean).join(' ');

    const initial = peer.name.charAt(0).toUpperCase();
    const isMuted = locallyMuted.has(socketId);
    const isBlocked = peer.micBlocked;

    // Speaker icon SVG (unmuted) and muted SVG
    const speakerSVG = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
    </svg>`;
    const mutedSVG = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
      <line x1="23" y1="9" x2="17" y2="15"/>
      <line x1="17" y1="9" x2="23" y2="15"/>
    </svg>`;

    // Admin block button (only for creator, shown on hover)
    const adminBtn = isCreator ? `
      <button class="admin-block-btn ${isBlocked ? 'is-blocked' : ''}"
              data-peer="${socketId}"
              title="${isBlocked ? 'Unblock mic' : 'Block mic'}"
              aria-label="${isBlocked ? 'Unblock mic' : 'Block mic'}">
        ${isBlocked ? '\u2713' : '\uD83D\uDEAB'}
      </button>` : '';

    const avHtml = `
      <div class="${bubbleClasses}" title="${peer.name}" id="avatar-${socketId}">
        <div class="avatar avatar-sm" style="background:linear-gradient(135deg,#3b82f6,#06b6d4)">${initial}</div>
        <span class="mic-status-dot ${peer.micActive && !isBlocked ? 'on' : 'off'}"></span>
        <div class="mute-overlay" data-peer="${socketId}" title="${isMuted ? 'Unmute' : 'Mute'} locally">
          ${isMuted ? mutedSVG : speakerSVG}
        </div>
        <span class="bubble-name">${peer.name}</span>
        ${adminBtn}
      </div>`;
    usersContainer.insertAdjacentHTML('beforeend', avHtml);
  });

  // Attach mute-overlay click listeners
  usersContainer.querySelectorAll('.mute-overlay[data-peer]').forEach(overlay => {
    overlay.addEventListener('click', e => {
      e.stopPropagation();
      const id = overlay.dataset.peer;
      toggleLocalMute(id);
    });
  });

  // Attach admin block button listeners
  if (isCreator) {
    usersContainer.querySelectorAll('.admin-block-btn[data-peer]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const id = btn.dataset.peer;
        const peer = remoteUsers.get(id);
        if (!peer) return;
        if (peer.micBlocked) {
          adminUnblockMic(id);
        } else {
          adminBlockMic(id);
        }
      });
    });
  }
  
  // If selected peer left, reset
  if (selectedPeer && !remoteUsers.has(selectedPeer)) {
      selectedPeer = null;
      renderPeerPanel();
  }
}

// ============================================================
// WHITEBOARD MODE (creator controls)
// ============================================================
document.querySelectorAll('.wb-mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!isCreator) { toast('Only the room creator can change whiteboard mode', 'error'); return; }
    document.querySelectorAll('.wb-mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    wbMode = btn.dataset.wbmode;
    applyWbMode();
    if (socket && currentRoom) {
      socket.emit('wb-mode-change', { roomId: currentRoom, mode: wbMode });
    }
    toast(wbMode === 'rw' ? '🎨 Whiteboard unlocked for everyone' : '🔒 Whiteboard set to read-only', 'success');
  });
});

function applyWbMode() {
  const overlay = document.getElementById('wb-readonly-overlay');
  const badge   = document.getElementById('wb-mode-badge');
  const tools   = document.getElementById('wb-tools');
  
  // Sync the UI toggle buttons with current mode
  document.querySelectorAll('.wb-mode-btn').forEach(b => b.classList.remove('active'));
  const activeBtn = document.querySelector(`.wb-mode-btn[data-wbmode="${wbMode}"]`);
  if (activeBtn) activeBtn.classList.add('active');

  if (wbMode === 'ro') {
    if (!isCreator) overlay.style.display = 'flex';
    badge.textContent     = 'Public · Read-only';
    badge.style.background = 'rgba(245,158,11,0.12)';
    badge.style.color      = '#fcd34d';
    badge.style.border     = '1px solid rgba(245,158,11,0.3)';
    if (!isCreator && tools) tools.style.pointerEvents = 'none';
  } else {
    overlay.style.display = 'none';
    badge.textContent     = 'Public · R/W';
    badge.style.background = 'rgba(16,185,129,0.12)';
    badge.style.color      = '#6ee7b7';
    badge.style.border     = '1px solid rgba(16,185,129,0.3)';
    if (tools) tools.style.pointerEvents = 'auto';
  }
}

// ============================================================
// PANEL — EXPAND / HIDE / RESTORE
// ============================================================
document.querySelectorAll('.expand-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const targetId = btn.dataset.target;
    if (expandedPanel === targetId) {
      // Collapse back
      collapseAll();
    } else {
      expandPanel(targetId);
    }
  });
});

document.querySelectorAll('.hide-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const targetId = btn.dataset.target;
    hidePanel(targetId);
  });
});

document.getElementById('show-all-btn').addEventListener('click', restoreAll);

function expandPanel(id) {
  expandedPanel = id;
  ['panel-mine', 'panel-wb', 'panel-peer'].forEach(pid => {
    const el = document.getElementById(pid);
    if (pid === id) {
      el.classList.remove('panel-hidden');
      el.classList.add('panel-expanded');
      // Mark expand btn
      el.querySelector('.expand-btn')?.classList.add('expanded');
    } else {
      el.classList.remove('panel-expanded');
      el.classList.add('panel-hidden');
    }
  });
  // Hide resizers
  document.querySelectorAll('.resizer').forEach(r => r.style.display = 'none');
  document.getElementById('show-all-btn').style.display = 'flex';
  relayoutEditors();

  // Esc to restore
  document.addEventListener('keydown', escRestore);
}

function hidePanel(id) {
  if (expandedPanel) return; // don't hide when one is already expanded
  const el = document.getElementById(id);
  el.classList.add('panel-hidden');
  hiddenPanels.add(id);
  // If all 3 hidden, restore
  if (hiddenPanels.size >= 3) { restoreAll(); return; }
  document.getElementById('show-all-btn').style.display = 'flex';
  relayoutEditors();
}

function collapseAll() {
  expandedPanel = null;
  ['panel-mine', 'panel-wb', 'panel-peer'].forEach(pid => {
    const el = document.getElementById(pid);
    el.classList.remove('panel-expanded', 'panel-hidden');
    el.querySelector('.expand-btn')?.classList.remove('expanded');
  });
  document.querySelectorAll('.resizer').forEach(r => r.style.display = '');
  document.getElementById('show-all-btn').style.display = 'none';
  hiddenPanels.clear();
  relayoutEditors();
  // Extra delayed call to ensure whiteboard reinits AFTER CSS layout fully repaints
  setTimeout(initWbCanvas, 550);
  document.removeEventListener('keydown', escRestore);
}

function restoreAll() {
  collapseAll();
}

function escRestore(e) { if (e.key === 'Escape') collapseAll(); }

function relayoutEditors() {
  setTimeout(() => {
    myEditor?.layout();
    peerEditor?.layout();
    initWbCanvas();
  }, 350);
}

// ============================================================
// ROOMS
// ============================================================
const MAX_ROOM_USERS = 4; // max users per room (WebRTC perf limit)

function setRoomActive(code, name) {
  currentRoom = code.toUpperCase();
  document.getElementById('room-label').textContent = name;
  document.getElementById('room-code-display').textContent = code.toUpperCase();
  document.getElementById('room-code-display').style.display = 'inline';
  document.getElementById('room-dot').classList.add('live');

  // Swap buttons: hide Create/Join, show Leave
  document.getElementById('create-room-btn').style.display = 'none';
  document.getElementById('join-room-btn').style.display   = 'none';
  document.getElementById('leave-room-btn').style.display  = 'inline-flex';

  // Join socket room
  if (socket) joinWebRTCRoom(currentRoom);
}

function leaveRoom() {
  if (!currentRoom) return;
  // Disconnect socket — server handles cleanup
  socket?.disconnect();
  // Reload page to reset all state cleanly
  window.location.href = 'editor.html';
}

document.getElementById('leave-room-btn').addEventListener('click', () => {
  if (confirm('Leave this room?')) leaveRoom();
});

// Create a new room — saves to DB
document.getElementById('create-room-btn').addEventListener('click', () => openModal('create-modal'));
document.getElementById('join-room-btn').addEventListener('click',   () => openModal('join-modal'));
document.getElementById('close-create-modal').addEventListener('click', () => closeModal('create-modal'));
document.getElementById('close-join-modal').addEventListener('click',   () => closeModal('join-modal'));

document.getElementById('confirm-create-btn').addEventListener('click', async () => {
  const nameInput = document.getElementById('new-room-name');
  const name = nameInput.value.trim() || 'My Room';
  const btn = document.getElementById('confirm-create-btn');
  btn.disabled = true;
  btn.textContent = 'Creating…';
  try {
    const res = await fetch(`${API_BASE}/api/rooms/create`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, language: lang }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create room');
    isCreator = true;
    setRoomActive(data.room.code, data.room.name);
    closeModal('create-modal');
    toast(`Room "${data.room.name}" — Code: ${data.room.code}`, 'success');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Room';
  }
});

document.getElementById('confirm-join-btn').addEventListener('click', async () => {
  const code = document.getElementById('join-code-input').value.trim().toUpperCase();
  if (!code) { toast('Enter a room code!', 'error'); return; }
  const btn = document.getElementById('confirm-join-btn');
  btn.disabled = true;
  btn.textContent = 'Joining…';
  try {
    const res = await fetch(`${API_BASE}/api/rooms/${code}`, { credentials: 'include' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Room not found');
    isCreator = false;
    setRoomActive(data.room.code, data.room.name);
    closeModal('join-modal');
    toast(`Joined room "${data.room.name}"`, 'success');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Join Room';
  }
});

// Check URL param — auto-join if ?room=CODE
const urlRoom = new URLSearchParams(location.search).get('room');
if (urlRoom) {
  // Attempt to lookup from DB; fall back gracefully
  fetch(`${API_BASE}/api/rooms/${urlRoom}`, { credentials: 'include' })
    .then(r => r.json())
    .then(data => {
      const roomName = data?.room?.name || 'Joined Room';
      isCreator = false;
      setRoomActive(urlRoom, roomName);
    })
    .catch(() => { isCreator = false; setRoomActive(urlRoom, 'Joined Room'); });
}

document.querySelectorAll('[data-privacy]').forEach(b => {
  b.addEventListener('click', () => {
    b.closest('.tabs').querySelectorAll('.tab-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
  });
});

function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.modal-overlay').forEach(o =>
  o.addEventListener('click', e => { if (e.target === o) o.classList.remove('open'); })
);

// ============================================================
// AI HINT (stub — ready for API wiring)
// ============================================================
const HINTS = [
  'Think about the data structure that gives O(1) lookup. Store what you\'ve seen so far and check if the complement exists.',
  'A single pass with a hash map is all you need. For each element, compute the complement and check if it\'s already stored.',
  'Consider what information you need to carry forward as you iterate. The complement of each element is the key insight.',
];

document.getElementById('hint-ai-btn').addEventListener('click', () => {
  openModal('ai-hint-modal');
  document.getElementById('ai-hint-content').innerHTML =
    `<div style="display:flex;align-items:center;justify-content:center;gap:12px;min-height:90px">
       <div class="spinner"></div>
       <p style="color:var(--text-muted);font-size:.875rem">Analysing your code…</p>
     </div>`;
  setTimeout(() => {
    const hint = HINTS[Math.floor(Math.random() * HINTS.length)];
    document.getElementById('ai-hint-content').innerHTML =
      `<div class="hint-box"><p>💡 ${hint}</p></div>
       <p style="font-size:.78rem;color:var(--text-muted)">Click Hint again for a different suggestion.</p>`;
  }, 900);
});
document.getElementById('close-hint-modal').addEventListener('click', () => closeModal('ai-hint-modal'));

// ============================================================
// TOAST
// ============================================================
function toast(msg, type = 'success') {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  const icon = type === 'success' ? '✅' : '❌';
  t.innerHTML = `<span>${icon}</span> ${msg}`;
  c.appendChild(t);
  setTimeout(() => { t.style.opacity='0'; t.style.transform='translateX(110%)'; t.style.transition='.3s'; }, 2700);
  setTimeout(() => t.remove(), 3100);
}

// ============================================================
// RUN CODE (Piston API)
// ============================================================
const outputDrawer  = document.getElementById('output-drawer');
const outputContent = document.getElementById('output-content');
const outputStatus  = document.getElementById('output-status');
const runBtn        = document.getElementById('run-code-btn');
const runBtnLabel   = document.getElementById('run-btn-label');

document.getElementById('close-output-btn').addEventListener('click', () => {
  outputDrawer.classList.remove('open');
});

async function runCode() {
  const code = myEditor?.getValue();
  if (!code || !code.trim()) { toast('Nothing to run!', 'error'); return; }

  // Show drawer, set loading state
  outputDrawer.classList.add('open');
  outputContent.innerHTML = '<span style="color:var(--text-muted)">⏳ Running…</span>';
  outputStatus.textContent = '';
  outputStatus.className = 'output-status';
  runBtn.classList.add('running');
  runBtnLabel.textContent = 'Running…';

  try {
    const res = await fetch(`${API_BASE}/api/execute`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, language: lang }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Execution failed');

    const run = data.run;
    const compile = data.compile;

    // Build output display
    let html = '';
    if (compile && compile.stderr) {
      html += `<span class="stderr">── Compile Error ──\n${escapeHtml(compile.stderr)}\n</span>`;
    }
    if (run.stdout) {
      html += escapeHtml(run.stdout);
    }
    if (run.stderr) {
      html += `<span class="stderr">${escapeHtml(run.stderr)}</span>`;
    }
    if (!run.stdout && !run.stderr && !(compile?.stderr)) {
      html = '<span style="color:var(--text-muted)">(no output)</span>';
    }

    outputContent.innerHTML = html;

    const exitOk = run.code === 0 || run.code === null;
    outputStatus.textContent = exitOk ? '✓ Exited 0' : `✗ Exit ${run.code ?? run.signal}`;
    outputStatus.className = `output-status ${exitOk ? 'ok' : 'err'}`;

  } catch (err) {
    outputContent.innerHTML = `<span class="stderr">Error: ${escapeHtml(err.message)}</span>`;
    outputStatus.textContent = '✗ Error';
    outputStatus.className = 'output-status err';
  } finally {
    runBtn.classList.remove('running');
    runBtnLabel.textContent = 'Run';
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

runBtn.addEventListener('click', runCode);

// Ctrl+Enter to run
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    runCode();
  }
});

// ============================================================
// CHAT
// ============================================================
const chatPanel     = document.getElementById('chat-panel');
const chatMessages  = document.getElementById('chat-messages');
const chatInput     = document.getElementById('chat-input');
const chatUnread    = document.getElementById('chat-unread-badge');
let chatOpen        = false;
let unreadCount     = 0;

function toggleChat(open) {
  chatOpen = open !== undefined ? open : !chatOpen;
  chatPanel.classList.toggle('open', chatOpen);
  if (chatOpen) {
    unreadCount = 0;
    chatUnread.style.display = 'none';
    chatInput.focus();
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

document.getElementById('chat-toggle-btn').addEventListener('click', () => toggleChat());
document.getElementById('close-chat-btn').addEventListener('click', () => toggleChat(false));

// Ctrl+K to toggle chat
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    toggleChat();
  }
});

function sendChatMessage() {
  const text = chatInput.value.trim();
  if (!text || !socket || !currentRoom) {
    if (!currentRoom) toast('Join a room first to use chat!', 'error');
    return;
  }
  socket.emit('chat-message', { roomId: currentRoom, text });
  chatInput.value = '';
}

document.getElementById('chat-send-btn').addEventListener('click', sendChatMessage);
chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
});

function renderChatMessage(payload) {
  const isMine = socket && payload.senderId === socket.id;
  const time = new Date(payload.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  const div = document.createElement('div');
  div.className = `chat-msg${isMine ? ' mine' : ''}`;
  div.innerHTML = `
    <div class="chat-msg-meta">
      <span class="chat-msg-name${isMine ? ' me' : ''}">${escapeHtml(payload.senderName)}</span>
      <span class="chat-msg-time">${time}</span>
    </div>
    <div class="chat-msg-text">${escapeHtml(payload.text)}</div>`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  // Show unread badge if panel is closed
  if (!chatOpen && !isMine) {
    unreadCount++;
    chatUnread.textContent = unreadCount > 9 ? '9+' : unreadCount;
    chatUnread.style.display = 'inline-block';
  }
}

// ============================================================
// RESIZABLE PANELS (drag dividers)
// ============================================================
document.querySelectorAll('.resizer').forEach(resizer => {
  let startX, startLeft, startRight;
  let panelL, panelR;

  resizer.addEventListener('pointerdown', e => {
    e.preventDefault();
    resizer.classList.add('dragging');
    resizer.setPointerCapture(e.pointerId);
    startX = e.clientX;

    if (resizer.id === 'resizer-1') {
      panelL = document.getElementById('panel-mine');
      panelR = document.getElementById('panel-wb');
    } else {
      panelL = document.getElementById('panel-wb');
      panelR = document.getElementById('panel-peer');
    }
    startLeft  = panelL.getBoundingClientRect().width;
    startRight = panelR.getBoundingClientRect().width;
  });

  resizer.addEventListener('pointermove', e => {
    if (!resizer.classList.contains('dragging')) return;
    const dx = e.clientX - startX;
    const newLeft  = Math.max(180, startLeft  + dx);
    const newRight = Math.max(180, startRight - dx);
    panelL.style.flex = `0 0 ${newLeft}px`;
    panelR.style.flex = `0 0 ${newRight}px`;
    myEditor?.layout();
    peerEditor?.layout();
  });

  resizer.addEventListener('pointerup', () => {
    resizer.classList.remove('dragging');
    myEditor?.layout();
    peerEditor?.layout();
    initWbCanvas();
  });
});

// ============================================================
// WHITEBOARD CANVAS
// ============================================================
let wbTool = 'pen', wbColor = '#a78bfa', wbSize = 3;
let wbDrawing = false, wbSnap = null, wbSx = 0, wbSy = 0;
const wbHistory = [], wbRedo = [];
let wbCtx = null, wbCanvas = null;

function initWbCanvas() {
  wbCanvas = document.getElementById('wb-canvas');
  const wrap = document.getElementById('wb-canvas-wrap');
  if (!wbCanvas || !wrap) return;
  // If the panel is hidden (display:none), wrap dimensions are 0.
  // Skip the resize — resizing to 0×0 destroys the canvas content and breaks drawing.
  if (wrap.clientWidth === 0 || wrap.clientHeight === 0) return;
  const saved = wbCtx && wbCanvas.width > 0 && wbCanvas.height > 0
    ? wbCtx.getImageData(0, 0, wbCanvas.width, wbCanvas.height)
    : null;
  wbCanvas.width  = wrap.clientWidth;
  wbCanvas.height = wrap.clientHeight;
  wbCtx = wbCanvas.getContext('2d');
  if (saved && saved.width > 0 && saved.height > 0) wbCtx.putImageData(saved, 0, 0);
}
window.addEventListener('resize', initWbCanvas);
document.addEventListener('DOMContentLoaded', () => { setTimeout(initWbCanvas, 100); });

function wbPos(e) {
  const r = wbCanvas.getBoundingClientRect();
  const s = e.touches ? e.touches[0] : e;
  return { x: s.clientX - r.left, y: s.clientY - r.top };
}
function wbApply() {
  wbCtx.strokeStyle = wbColor; wbCtx.fillStyle = wbColor;
  wbCtx.lineWidth   = wbSize;  wbCtx.globalAlpha = 1;
  wbCtx.lineCap = 'round';     wbCtx.lineJoin = 'round';
}
function wbDrawShape(t, x1, y1, x2, y2) {
  wbCtx.beginPath();
  if (t === 'rect') {
    wbCtx.strokeRect(x1, y1, x2-x1, y2-y1);
  } else if (t === 'circle') {
    const cx=(x1+x2)/2, cy=(y1+y2)/2, rx=Math.abs(x2-x1)/2, ry=Math.abs(y2-y1)/2;
    wbCtx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI*2); wbCtx.stroke();
  } else if (t === 'arrow') {
    const a = Math.atan2(y2-y1, x2-x1), L = 13;
    wbCtx.moveTo(x1,y1); wbCtx.lineTo(x2,y2);
    wbCtx.lineTo(x2-L*Math.cos(a-.4), y2-L*Math.sin(a-.4));
    wbCtx.moveTo(x2,y2);
    wbCtx.lineTo(x2-L*Math.cos(a+.4), y2-L*Math.sin(a+.4));
    wbCtx.stroke();
  }
}

// Tool buttons
document.querySelectorAll('.wb-tool-btn').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.wb-tool-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    wbTool = b.dataset.tool;
    if (wbCanvas) wbCanvas.style.cursor = wbTool === 'eraser' ? 'cell' : wbTool === 'text' ? 'text' : 'crosshair';
  });
});

document.getElementById('wb-tools-toggle')?.addEventListener('click', () => {
  const tools = document.getElementById('wb-tools');
  tools.style.display = tools.style.display === 'none' ? 'flex' : 'none';
});

document.querySelectorAll('.color-swatch').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.color-swatch').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    wbColor = btn.dataset.color;
  });
});

document.getElementById('wb-size')?.addEventListener('input', e => wbSize = parseInt(e.target.value, 10));

function broadcastWbState() {
  if (socket && currentRoom && wbCanvas) {
    socket.emit('wb-draw', { roomId: currentRoom, isState: true, state: wbCanvas.toDataURL() });
  }
}

function emitWbDraw(action, tool, x, y, sx, sy, ex, ey, color, size, textVal) {
  if (socket && currentRoom && wbCanvas) {
    socket.emit('wb-draw', {
      roomId: currentRoom,
      action, tool, color, size, textVal,
      x: x !== undefined ? x / wbCanvas.width : undefined,
      y: y !== undefined ? y / wbCanvas.height : undefined,
      sx: sx !== undefined ? sx / wbCanvas.width : undefined,
      sy: sy !== undefined ? sy / wbCanvas.height : undefined,
      ex: ex !== undefined ? ex / wbCanvas.width : undefined,
      ey: ey !== undefined ? ey / wbCanvas.height : undefined
    });
  }
}

document.getElementById('wb-undo').addEventListener('click', () => {
  if (!wbCtx || !wbHistory.length) return;
  wbRedo.push(wbCtx.getImageData(0, 0, wbCanvas.width, wbCanvas.height));
  wbCtx.putImageData(wbHistory.pop(), 0, 0);
  broadcastWbState();
});

document.getElementById('wb-clear').addEventListener('click', () => {
  if (!wbCtx || !confirm('Clear whiteboard?')) return;
  wbHistory.push(wbCtx.getImageData(0, 0, wbCanvas.width, wbCanvas.height));
  wbCtx.clearRect(0, 0, wbCanvas.width, wbCanvas.height);
  if (socket && currentRoom) socket.emit('wb-clear', { roomId: currentRoom });
});

document.getElementById('wb-export').addEventListener('click', () => {
  if (!wbCanvas) return;
  const tmp = document.createElement('canvas');
  tmp.width = wbCanvas.width; tmp.height = wbCanvas.height;
  const tx = tmp.getContext('2d');
  tx.fillStyle = '#111218'; tx.fillRect(0, 0, tmp.width, tmp.height);
  tx.drawImage(wbCanvas, 0, 0);
  const a = document.createElement('a'); a.download = 'whiteboard.png'; a.href = tmp.toDataURL(); a.click();
});

// Canvas pointer events
const wbWrap = document.getElementById('wb-canvas-wrap');

wbWrap.addEventListener('pointerdown', e => {
  if (!wbCtx || e.target !== wbCanvas) return;
  if (wbMode === 'ro' && !isCreator) return; // locked for non-creators
  if (wbTool === 'text') { handleWbText(e); return; }
  wbDrawing = true;
  const p = wbPos(e); wbSx = p.x; wbSy = p.y;
  wbHistory.push(wbCtx.getImageData(0, 0, wbCanvas.width, wbCanvas.height));
  if (wbHistory.length > 60) wbHistory.shift();
  wbRedo.length = 0;
  wbSnap = wbCtx.getImageData(0, 0, wbCanvas.width, wbCanvas.height);
  wbApply();
  if (wbTool === 'pen' || wbTool === 'eraser') {
    wbCtx.beginPath(); wbCtx.moveTo(p.x, p.y);
    emitWbDraw('start', wbTool, p.x, p.y, undefined, undefined, undefined, undefined, wbColor, wbSize);
  }
  wbCanvas.setPointerCapture(e.pointerId);
});

wbWrap.addEventListener('pointermove', e => {
  if (!wbDrawing || !wbCtx) return;
  const p = wbPos(e); wbApply();
  if (wbTool === 'pen') {
    wbCtx.lineTo(p.x, p.y); wbCtx.stroke();
    emitWbDraw('draw', 'pen', p.x, p.y, undefined, undefined, undefined, undefined, wbColor, wbSize);
  } else if (wbTool === 'eraser') {
    wbCtx.globalCompositeOperation = 'destination-out';
    wbCtx.lineWidth = wbSize * 5;
    wbCtx.lineTo(p.x, p.y); wbCtx.stroke();
    wbCtx.globalCompositeOperation = 'source-over';
    emitWbDraw('draw', 'eraser', p.x, p.y, undefined, undefined, undefined, undefined, wbColor, wbSize);
  } else {
    wbCtx.putImageData(wbSnap, 0, 0); wbApply(); wbDrawShape(wbTool, wbSx, wbSy, p.x, p.y);
  }
});

wbWrap.addEventListener('pointerup', e => {
  if (!wbDrawing) return; wbDrawing = false;
  const p = wbPos(e);
  if (wbTool !== 'pen' && wbTool !== 'eraser') {
    wbCtx.putImageData(wbSnap, 0, 0); wbApply(); wbDrawShape(wbTool, wbSx, wbSy, p.x, p.y);
    emitWbDraw('shape', wbTool, undefined, undefined, wbSx, wbSy, p.x, p.y, wbColor, wbSize);
  } else {
    emitWbDraw('end', wbTool, p.x, p.y, undefined, undefined, undefined, undefined, wbColor, wbSize);
  }
  wbSnap = null;
});

function handleWbText(e) {
  if (!wbCanvas || !wbCtx) return;
  const { x, y } = wbPos(e);
  const inp = document.getElementById('wb-text-input');
  inp.style.cssText = `display:block;left:${x}px;top:${y}px;color:${wbColor};font-size:15px;`;
  inp.value = ''; inp.focus();
  const commit = () => {
    const t = inp.value.trim();
    if (t) { 
        wbCtx.font = '15px Inter,sans-serif'; wbCtx.fillStyle = wbColor; wbCtx.fillText(t, x, y+15); 
        emitWbDraw('text', x, y, x, y, wbColor, wbSize, t);
    }
    inp.style.display = 'none'; inp.removeEventListener('blur', commit);
  };
  inp.addEventListener('blur', commit);
}

// Init wb mode badge on load
applyWbMode();

// ============================================================
// WEBRTC SCREEN SHARING & SIGNALING (SOCKET.IO)
// ============================================================
let socket = null;
let currentRoom = null;
let localStream = null;
let peerConnections = {}; // targetSocketId -> RTCPeerConnection

// ─────────────────────────────────────────────────────────────────────────────
// WebRTC ICE Server Configuration — Dynamic Backend Fetching
//
// WHY NO HARDCODED CREDENTIALS HERE:
//   The master Metered API key lives only in backend/.env (never shipped to
//   the browser). Our Express server calls Metered server-to-server and returns
//   short-lived TURN credentials to THIS code via /api/rtc-credentials.
//
// HOW RTCPeerConnection USES THE ICE SERVER LIST:
//   1. When new RTCPeerConnection(config) is called, the browser's ICE agent
//      contacts EVERY server in config.iceServers IN PARALLEL.
//   2. STUN entries → browser learns its own public IP:port
//      ("server-reflexive candidate"). If both peers share a reachable path,
//      a direct P2P connection is made — no relay, zero bandwidth cost.
//   3. TURN entries → if no direct path succeeds (symmetric NAT / firewall),
//      all audio/video/screen-share data is relayed THROUGH the TURN server.
//      The username + credential authenticate us to Metered's relay.
//   4. ICE automatically picks the BEST working candidate:
//        host → server-reflexive (STUN) → TURN-UDP → TURN-TCP → TURNS-TLS
// ─────────────────────────────────────────────────────────────────────────────

// Module-level cache: store fetched config so we don't hit the backend on
// every single peer connection (reuse for up to 55 seconds).
let _cachedRtcConfig = null;
let _rtcConfigFetchedAt = 0;
const RTC_CONFIG_TTL_MS = 55 * 1000; // 55 s — slightly under the server's Cache-Control: 60s

/**
 * Fetches a fresh ICE server list (including temporary Metered TURN credentials)
 * from our own Express backend. Falls back to Google STUN only if the request
 * fails, so WebRTC still works on most networks even if the backend is down.
 *
 * Caches the result for RTC_CONFIG_TTL_MS so rapid peer-connection creation
 * (e.g. 3 users joining at once) reuses the same credential set.
 */
async function fetchRtcConfig() {
  const now = Date.now();
  // Return cached config if it is still fresh
  if (_cachedRtcConfig && (now - _rtcConfigFetchedAt) < RTC_CONFIG_TTL_MS) {
    return _cachedRtcConfig;
  }

  try {
    const resp = await fetch(`${API_BASE}/api/rtc-credentials`, {
      // Credentials: 'include' ensures the httpOnly JWT cookie is sent,
      // so requireAuthAPI on the server can verify the user's session.
      credentials: 'include'
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    // data.iceServers is the array returned by our Express route, which
    // already contains Google STUN + all Metered TURN/TURNS entries.
    _cachedRtcConfig = { iceServers: data.iceServers };
    _rtcConfigFetchedAt = now;
    console.log('[RTC] Fetched ICE config from backend:', data.iceServers.length, 'servers');
  } catch (err) {
    console.warn('[RTC] Could not fetch TURN credentials, falling back to STUN-only:', err.message);
    // Fallback keeps WebRTC functional even if /api/rtc-credentials is unreachable.
    _cachedRtcConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };
  }

  return _cachedRtcConfig;
}

const shareScreenBtn = document.getElementById('share-screen-btn');
const remoteScreenContainer = document.getElementById('remote-screen-container');
const remoteScreenVideo = document.getElementById('remote-screen-video');
const closeRemoteScreenBtn = document.getElementById('close-remote-screen');
const screenLabel = document.getElementById('screen-label');

// Initialize Socket.io connection (if backend is running)
try {
  socket = io('https://learnsync-9nyy.onrender.com');
  
  socket.on('connect', () => {
    console.log('Connected to signaling server:', socket.id);
    if (urlRoom) joinWebRTCRoom(urlRoom);
  });

  // Room is at capacity — server rejected us
  socket.on('room-full', (payload) => {
    toast(`Room is full (max ${payload.max} users)`, 'error');
    // Revert UI — show create/join buttons again, clear room label
    currentRoom = null;
    document.getElementById('create-room-btn').style.display = 'inline-flex';
    document.getElementById('join-room-btn').style.display   = 'inline-flex';
    document.getElementById('leave-room-btn').style.display  = 'none';
    document.getElementById('room-label').textContent = 'No Room';
    document.getElementById('room-code-display').style.display = 'none';
    document.getElementById('room-dot').classList.remove('live');
  });

  socket.on('room-users', (users) => {
    users.forEach(u => {
      const id = u.id;
      const name = u.name;
      if (id !== socket.id) {
         remoteUsers.set(id, { name: name, shareMode: 'off', micActive: false, micBlocked: false });
      }
    });
    updateUsersUI();
  });

  socket.on('user-joined', (payload) => {
    const id = payload.id;
    const name = payload.name;
    console.log('User joined:', id);
    remoteUsers.set(id, { name: name, shareMode: 'off', micActive: false, micBlocked: false });
    updateUsersUI();
    toast(`${name} joined the room`, 'success');

    // Broadcast our current editor state to the new user if we are sharing
    if (shareMode !== 'off' && myEditor) {
        socket.emit('share-mode-change', { roomId: currentRoom, mode: shareMode });
        socket.emit('code-update', {
            roomId: currentRoom,
            code: myEditor.getValue(),
            lang: lang
        });
    }

    // Always establish a peer connection with the new user so mic/screen work.
    // If we have media to send (mic or screen), be the initiator.
    // Otherwise create a passive connection to receive their tracks.
    const hasMedia = !!(localMicStream || localStream);
    createOrGetPC(targetId, hasMedia);

    // Also broadcast our current mic state so the joiner knows if we're live
    if (micActive && socket && currentRoom) {
      socket.emit('mic-status', { roomId: currentRoom, active: true });
    }
  });

  socket.on('user-left', (targetId) => {
    if (peerConnections[targetId]) {
      peerConnections[targetId].close();
      delete peerConnections[targetId];
    }
    // Clean up remote audio element
    if (remoteAudios[targetId]) {
      remoteAudios[targetId].srcObject = null;
      remoteAudios[targetId].remove();
      delete remoteAudios[targetId];
    }
    // Dispose the dedicated Monaco model for this peer to free memory.
    if (peerModels.has(targetId)) {
      peerModels.get(targetId).dispose();
      peerModels.delete(targetId);
    }
    speakingUsers.delete(targetId);
    locallyMuted.delete(targetId);
    remoteUsers.delete(targetId);
    updateUsersUI();
    toast('A user left the room', 'success');

    // Simple logic: if the person we were watching left, hide the video container
    remoteScreenContainer.style.display = 'none';
    remoteScreenVideo.srcObject = null;
  });

  // --- EDITOR SYNC HANDLERS ---
  
  socket.on('share-mode-change', (payload) => {
    const peer = remoteUsers.get(payload.caller);
    if (peer) {
        peer.shareMode = payload.mode;
        if (selectedPeer === payload.caller) {
            renderPeerPanel();
        }
    }
  });

  socket.on('code-update', (payload) => {
    const peer = remoteUsers.get(payload.caller);
    if (!peer) return;

    if (payload.lang) peer.lang = payload.lang;

    if (payload.changes) {
      // ── DELTA PATH (normal keystrokes) ────────────────────────────────
      // Apply the delta to this peer's dedicated Monaco model.
      // The model exists even when the peer panel is not visible, so
      // every keystroke is tracked without losing state on panel switch.
      const model = getOrCreatePeerModel(
        payload.caller,
        peer.code || '',
        peer.lang  || 'python',
      );
      isApplyingRemoteCode = true;
      applyDeltaToModel(model, payload.changes);
      isApplyingRemoteCode = false;
      // Keep the cached snapshot in sync for renderPeerPanel.
      peer.code = model.getValue();

      // If this peer is currently displayed, ensure the language tag is live.
      if (selectedPeer === payload.caller && payload.lang) {
        monaco.editor.setModelLanguage(model, payload.lang);
      }

    } else if (payload.code !== undefined) {
      // ── FULL-DOCUMENT PATH (initial join sync / language change / clear) ─
      // Replace the model's content wholesale and update the language.
      peer.code = payload.code;
      const model = getOrCreatePeerModel(
        payload.caller,
        payload.code,
        peer.lang || 'python',
      );
      isApplyingRemoteCode = true;
      model.setValue(payload.code);
      if (payload.lang) monaco.editor.setModelLanguage(model, payload.lang);
      isApplyingRemoteCode = false;

      // If this peer is currently displayed, refresh the editor's model ref.
      if (selectedPeer === payload.caller && peerEditor) {
        peerEditor.setModel(model);
        peerEditor.updateOptions({ readOnly: peer.shareMode !== 'rw' });
      }
    }
  });

  socket.on('peer-code-edit', (payload) => {
    // A peer is editing MY code in R/W mode.
    if (!(shareMode === 'rw' && myEditor)) return;

    if (payload.changes) {
      // ── DELTA PATH — cursor is fully preserved ────────────────────────
      // executeEdits applies the exact ranges provided, so the local
      // cursor stays exactly where it is (unlike setValue which resets it).
      isApplyingPeerEdit = true;
      const edits = payload.changes.map(c => ({
        range: new monaco.Range(
          c.range.startLineNumber, c.range.startColumn,
          c.range.endLineNumber,   c.range.endColumn,
        ),
        text: c.text,
        forceMoveMarkers: true,
      }));
      myEditor.executeEdits('peer-delta', edits);
      isApplyingPeerEdit = false;

    } else if (payload.code !== undefined) {
      // ── FULL-DOCUMENT FALLBACK (legacy clients) ──────────────────────
      if (myEditor.getValue() !== payload.code) {
        const position = myEditor.getPosition();
        myEditor.setValue(payload.code);
        if (position) myEditor.setPosition(position);
      }
    }
  });

  // --- WEBRTC HANDLERS ---

  socket.on('offer', async (payload) => {
    console.log('Received offer from', payload.caller);
    // IMPORTANT: Reuse the existing PC if one already exists (renegotiation).
    // Creating a new PC every time destroys the old connection and loses tracks.
    let pc = peerConnections[payload.caller];
    if (!pc) {
      pc = createPeerConnection(payload.caller, false);
    }
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('answer', {
        target: payload.caller,
        sdp: pc.localDescription
      });
      if (pc.iceQueue) {
        for (const candidate of pc.iceQueue) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.error(e));
        }
        pc.iceQueue = [];
      }
    } catch (err) {
      console.error('Error handling offer:', err);
    }
  });

  socket.on('answer', async (payload) => {
    console.log('Received answer from', payload.caller);
    const pc = peerConnections[payload.caller];
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      if (pc.iceQueue) {
        for (const candidate of pc.iceQueue) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.error(e));
        }
        pc.iceQueue = [];
      }
    }
  });

  socket.on('ice-candidate', async (payload) => {
    const pc = peerConnections[payload.caller];
    if (pc && payload.candidate) {
      if (pc.remoteDescription && pc.remoteDescription.type) {
        await pc.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(e => console.error(e));
      } else {
        pc.iceQueue.push(payload.candidate);
      }
    }
  });

  socket.on('screen-share-status', (payload) => {
    if (!payload.isSharing) {
        if (peerConnections[payload.caller]) {
           remoteScreenContainer.style.display = 'none';
           remoteScreenVideo.srcObject = null;
        }
    }
  });

  // --- WHITEBOARD LISTENERS ---
  
  socket.on('wb-mode-change', (payload) => {
    wbMode = payload.mode;
    applyWbMode();
  });

  socket.on('wb-draw', (data) => {
    if (!wbCtx || !wbCanvas) return;
    if (data.isState) {
        const img = new Image();
        img.onload = () => {
            wbHistory.push(wbCtx.getImageData(0, 0, wbCanvas.width, wbCanvas.height));
            wbCtx.clearRect(0, 0, wbCanvas.width, wbCanvas.height);
            wbCtx.drawImage(img, 0, 0, wbCanvas.width, wbCanvas.height);
        };
        img.src = data.state;
        return;
    }

    const sx = data.sx !== undefined ? data.sx * wbCanvas.width : undefined;
    const sy = data.sy !== undefined ? data.sy * wbCanvas.height : undefined;
    const ex = data.ex !== undefined ? data.ex * wbCanvas.width : undefined;
    const ey = data.ey !== undefined ? data.ey * wbCanvas.height : undefined;

    wbCtx.save();
    wbCtx.strokeStyle = data.color;
    wbCtx.fillStyle = data.color;
    wbCtx.lineWidth = data.size;
    wbCtx.globalAlpha = 1;
    wbCtx.lineCap = 'round';
    wbCtx.lineJoin = 'round';

    if (data.tool === 'pen' || data.tool === 'eraser') {
      if (data.tool === 'eraser') {
          wbCtx.globalCompositeOperation = 'destination-out';
          wbCtx.lineWidth = data.size * 5;
      }
      
      if (data.x !== undefined && data.y !== undefined) {
        const px = data.x * wbCanvas.width;
        const py = data.y * wbCanvas.height;
        
        if (data.action === 'start') {
            wbCtx.beginPath();
            wbCtx.moveTo(px, py);
        } else if (data.action === 'draw') {
            wbCtx.lineTo(px, py);
            wbCtx.stroke();
        }
      }
    } else if (data.tool === 'text') {
      wbCtx.font = '15px Inter,sans-serif';
      wbCtx.fillText(data.textVal, sx, sy + 15);
    } else {
      wbCtx.beginPath();
      if (data.tool === 'rect') {
        wbCtx.strokeRect(sx, sy, ex-sx, ey-sy);
      } else if (data.tool === 'circle') {
        const cx=(sx+ex)/2, cy=(sy+ey)/2, rx=Math.abs(ex-sx)/2, ry=Math.abs(ey-sy)/2;
        wbCtx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI*2); wbCtx.stroke();
      } else if (data.tool === 'arrow') {
        const a = Math.atan2(ey-sy, ex-sx), L = 13;
        wbCtx.moveTo(sx,sy); wbCtx.lineTo(ex,ey);
        wbCtx.lineTo(ex-L*Math.cos(a-.4), ey-L*Math.sin(a-.4));
        wbCtx.moveTo(ex,ey);
        wbCtx.lineTo(ex-L*Math.cos(a+.4), ey-L*Math.sin(a+.4));
        wbCtx.stroke();
      }
    }
    wbCtx.restore();
  });

  socket.on('wb-clear', () => {
    if (wbCtx && wbCanvas) {
        wbHistory.push(wbCtx.getImageData(0, 0, wbCanvas.width, wbCanvas.height));
        wbCtx.clearRect(0, 0, wbCanvas.width, wbCanvas.height);
    }
  });

  socket.on('request-wb-state', (payload) => {
    if (wbCanvas && socket) {
        socket.emit('wb-state', { 
            requester: payload.requester, 
            state: wbCanvas.toDataURL(),
            mode: wbMode
        });
    }
  });

  socket.on('wb-state', (payload) => {
    if (payload.mode && payload.mode !== wbMode) {
        wbMode = payload.mode;
        applyWbMode();
    }
    if (wbCtx && wbCanvas && payload.state) {
        const img = new Image();
        img.onload = () => {
            wbCtx.clearRect(0, 0, wbCanvas.width, wbCanvas.height);
            wbCtx.drawImage(img, 0, 0, wbCanvas.width, wbCanvas.height);
        };
        img.src = payload.state;
    }
  });

  // --- CHAT LISTENER ---
  socket.on('chat-message', (payload) => {
    renderChatMessage(payload);
  });

  // --- MIC / VOICE LISTENERS ---

  // A peer toggled their mic on or off
  socket.on('mic-status', (payload) => {
    const peer = remoteUsers.get(payload.caller);
    if (!peer) return;
    peer.micActive = payload.active;
    updateUsersUI();
    if (selectedPeer === payload.caller) renderPeerPanel();
    // If mic just turned off, clear speaking state
    if (!payload.active) {
      speakingUsers.delete(payload.caller);
    }
  });

  // Admin blocked MY mic
  socket.on('mic-blocked', () => {
    if (micActive) stopMic();
    micBlocked = true;
    const btn = document.getElementById('mic-btn');
    btn.classList.remove('active');
    btn.classList.add('muted');
    document.getElementById('mic-label').textContent = 'Blocked';
    toast('\uD83D\uDEAB Your mic was blocked by the host', 'error');
  });

  // Admin unblocked MY mic
  socket.on('mic-unblocked', () => {
    micBlocked = false;
    const btn = document.getElementById('mic-btn');
    btn.classList.remove('muted');
    document.getElementById('mic-label').textContent = 'Mic Off';
    toast('\u2705 Your mic has been unblocked', 'success');
  });

  // Room-wide announcement: someone's mic was blocked/unblocked
  socket.on('mic-block-announce', (payload) => {
    const peer = remoteUsers.get(payload.targetId);
    if (peer) {
      peer.micActive  = false;
      peer.micBlocked = true;
      speakingUsers.delete(payload.targetId);
      updateUsersUI();
      if (selectedPeer === payload.targetId) renderPeerPanel();
    }
  });

  socket.on('mic-unblock-announce', (payload) => {
    const peer = remoteUsers.get(payload.targetId);
    if (peer) {
      peer.micBlocked = false;
      updateUsersUI();
      if (selectedPeer === payload.targetId) renderPeerPanel();
    }
  });

} catch (e) {
  console.log('Socket.io not available or server not running.', e);
}

function joinWebRTCRoom(roomId) {
  currentRoom = roomId;
  if (socket) {
    socket.emit('join-room', roomId);
    socket.emit('request-wb-state', { roomId: roomId });
  }
}

// Intercept room creation/joining to join WebRTC room
const originalConfirmCreate = document.getElementById('confirm-create-btn').onclick;
document.getElementById('confirm-create-btn').addEventListener('click', () => {
    if(currentRoom && socket) socket.emit('leave-room', currentRoom); // Cleanup old room if needed
    const code = document.getElementById('room-code-display').textContent;
    joinWebRTCRoom(code);
});

document.getElementById('confirm-join-btn').addEventListener('click', () => {
   const code = document.getElementById('join-code-input').value.trim().toUpperCase();
   if(code) joinWebRTCRoom(code);
});


/**
 * Returns an existing peer connection for targetId, or creates a new one.
 * Pass isInitiator=true when WE should send the offer.
 */
async function createOrGetPC(targetId, isInitiator) {
  if (peerConnections[targetId]) {
    return peerConnections[targetId];
  }
  return createPeerConnection(targetId, isInitiator);
}

async function createPeerConnection(targetId, isInitiator) {
  // Close any stale connection first
  if (peerConnections[targetId]) {
    try { peerConnections[targetId].close(); } catch(e) {}
  }

  // Await the backend-fetched ICE config (includes temporary TURN credentials).
  // This is the moment the RTCPeerConnection receives its server list.
  // The master Metered API key was NEVER in this file — only the backend holds it.
  const rtcConfig = await fetchRtcConfig();
  const pc = new RTCPeerConnection(rtcConfig);
  peerConnections[targetId] = pc;
  pc.iceQueue = [];

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', {
        target: targetId,
        candidate: event.candidate
      });
    }
  };

  // Route incoming tracks: audio -> hidden <audio>, video -> screen share
  pc.ontrack = (event) => {
    const track = event.track;
    if (track.kind === 'audio') {
      const stream = (event.streams && event.streams[0]) || new MediaStream([track]);

      let audioEl = remoteAudios[targetId];
      if (!audioEl) {
        audioEl = document.createElement('audio');
        audioEl.setAttribute('playsinline', '');
        document.getElementById('remote-audio-container').appendChild(audioEl);
        remoteAudios[targetId] = audioEl;
      }
      audioEl.srcObject = stream;
      audioEl.muted = locallyMuted.has(targetId);
      audioEl.play().catch(err => {
        console.warn('Audio autoplay blocked:', err);
        const resume = () => { audioEl.play().catch(() => {}); };
        document.addEventListener('click', resume, { once: true });
      });
      watchRemoteSpeaking(targetId, stream, track);
    } else if (track.kind === 'video') {
      remoteScreenVideo.srcObject = event.streams[0];
      remoteScreenContainer.style.display = 'flex';
    }
  };

  // Add local mic track if active
  if (localMicStream) {
    localMicStream.getAudioTracks().forEach(t => pc.addTrack(t, localMicStream));
  }

  // Add local screen stream if active
  if (localStream) {
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  }

  if (isInitiator) {
    pc.createOffer()
      .then(offer => pc.setLocalDescription(offer))
      .then(() => socket.emit('offer', { target: targetId, sdp: pc.localDescription }))
      .catch(err => console.error('createOffer error:', err));
  }

  return pc;
}

// Screen Share Toggle
shareScreenBtn.addEventListener('click', async () => {
  if (!socket) {
    toast('Cannot share screen: Not connected to server', 'error');
    return;
  }
  if (!currentRoom) {
     toast('Join or create a room first', 'error');
     return;
  }

  const isActive = shareScreenBtn.dataset.active === 'true';

  if (!isActive) {
    try {
      localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      
      shareScreenBtn.dataset.active = 'true';
      shareScreenBtn.classList.add('active');
      screenLabel.textContent = 'Stop Sharing';
      toast('Screen sharing started', 'success');

      // Create an offer for everyone currently in the room
      remoteUsers.forEach((_, targetId) => {
         createPeerConnection(targetId, true);
      });

      socket.emit('screen-share-status', { roomId: currentRoom, isSharing: true });

      // Handle user clicking "Stop sharing" on the browser native UI strip
      localStream.getVideoTracks()[0].onended = () => {
         stopScreenShare();
      };

    } catch (err) {
      console.error('Error starting screen share', err);
      toast('Could not start screen sharing', 'error');
    }
  } else {
    stopScreenShare();
  }
});

function stopScreenShare() {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  shareScreenBtn.dataset.active = 'false';
  shareScreenBtn.classList.remove('active');
  screenLabel.textContent = 'Share';
  toast('Screen sharing stopped', 'success');
  
  if (socket && currentRoom) {
      socket.emit('screen-share-status', { roomId: currentRoom, isSharing: false });
  }

  // Close existing connections
  Object.values(peerConnections).forEach(pc => pc.close());
  peerConnections = {};
}

closeRemoteScreenBtn.addEventListener('click', () => {
  remoteScreenContainer.style.display = 'none';
  remoteScreenVideo.srcObject = null;
});

const popoutRemoteScreenBtn = document.getElementById('popout-remote-screen');
if (popoutRemoteScreenBtn) {
  popoutRemoteScreenBtn.addEventListener('click', async () => {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture().catch(e => console.error(e));
    } else if (remoteScreenVideo.readyState >= 2) {
      await remoteScreenVideo.requestPictureInPicture().catch(e => console.error(e));
    }
  });
}

// ============================================================
// MIC — TOGGLE BUTTON
// ============================================================
const micBtn   = document.getElementById('mic-btn');
const micLabel = document.getElementById('mic-label');
const micIconOn  = document.getElementById('mic-icon-on');
const micIconOff = document.getElementById('mic-icon-off');
const voiceIndicator = document.getElementById('voice-indicator');

micBtn.addEventListener('click', async () => {
  if (micBlocked) {
    toast('\uD83D\uDEAB Your mic is blocked by the host', 'error');
    return;
  }
  if (!socket) {
    toast('Not connected to server', 'error');
    return;
  }
  if (!currentRoom) {
    toast('Join or create a room first', 'error');
    return;
  }

  if (!micActive) {
    // ── Turn mic ON ──
    try {
      localMicStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      micActive = true;

      // Update button UI
      micBtn.dataset.active = 'true';
      micBtn.classList.add('active');
      micIconOn.style.display  = 'block';
      micIconOff.style.display = 'none';
      micLabel.textContent     = 'Mic On';

      // Update own mic dot
      const myDot = document.getElementById('my-mic-dot');
      if (myDot) { myDot.className = 'mic-status-dot on'; }

      // Connect mic to ALL peers.
      // For peers with no connection yet: createOrGetPC creates one and sends the offer.
      // For peers with an existing connection: addTrack + explicit renegotiate.
      const audioTrack = localMicStream.getAudioTracks()[0];
      remoteUsers.forEach((_, peerId) => {
        const existing = peerConnections[peerId];
        if (!existing) {
          // No connection yet — createPeerConnection will add the mic track and send the offer
          createPeerConnection(peerId, true);
        } else {
          // Connection exists — add mic track then manually renegotiate
          try { existing.addTrack(audioTrack, localMicStream); } catch(e) { /* already added */ }
          existing.createOffer()
            .then(o => existing.setLocalDescription(o))
            .then(() => socket.emit('offer', { target: peerId, sdp: existing.localDescription }))
            .catch(err => console.warn('Mic renegotiation error:', err));
        }
      });

      // Broadcast mic-on to room
      socket.emit('mic-status', { roomId: currentRoom, active: true });

      // Start local speaking detection
      startSpeakingDetection();

      toast('\uD83C\uDFA4 Mic on', 'success');
    } catch (err) {
      console.error('Mic error:', err);
      toast('Could not access microphone', 'error');
    }
  } else {
    // ── Turn mic OFF ──
    stopMic();
    toast('\uD83D\uDD07 Mic off', 'success');
  }
});

// ============================================================
// MIC — HELPER FUNCTIONS
// ============================================================

/** Stop local mic and notify peers */
function stopMic() {
  if (localMicStream) {
    localMicStream.getTracks().forEach(t => t.stop());
    localMicStream = null;
  }
  micActive = false;

  micBtn.dataset.active = 'false';
  micBtn.classList.remove('active');
  micIconOn.style.display  = 'block';
  micIconOff.style.display = 'none';
  micLabel.textContent = 'Mic Off';

  // Update own mic dot
  const myDot = document.getElementById('my-mic-dot');
  if (myDot) { myDot.className = 'mic-status-dot off'; }

  // Hide speaking indicator
  voiceIndicator.style.display = 'none';

  // Stop speaking detection
  if (speakingCheckInterval) { clearInterval(speakingCheckInterval); speakingCheckInterval = null; }
  if (localAudioCtx) { localAudioCtx.close().catch(() => {}); localAudioCtx = null; localAnalyser = null; }

  // Notify room
  if (socket && currentRoom) {
    socket.emit('mic-status', { roomId: currentRoom, active: false });
  }
}

/** Toggle local (client-side only) mute for a specific peer */
function toggleLocalMute(socketId) {
  if (locallyMuted.has(socketId)) {
    locallyMuted.delete(socketId);
    if (remoteAudios[socketId]) remoteAudios[socketId].muted = false;
  } else {
    locallyMuted.add(socketId);
    if (remoteAudios[socketId]) remoteAudios[socketId].muted = true;
  }
  updateUsersUI();
  if (selectedPeer === socketId) renderPeerPanel();
}

/** Admin: block a peer's mic for the whole room */
function adminBlockMic(targetId) {
  if (!isCreator || !socket || !currentRoom) return;
  socket.emit('mic-block', { roomId: currentRoom, targetId });
  toast(`\uD83D\uDEAB Blocked ${remoteUsers.get(targetId)?.name || 'user'}'s mic`, 'success');
}

/** Admin: unblock a peer's mic */
function adminUnblockMic(targetId) {
  if (!isCreator || !socket || !currentRoom) return;
  socket.emit('mic-unblock', { roomId: currentRoom, targetId });
  toast(`\u2705 Unblocked ${remoteUsers.get(targetId)?.name || 'user'}'s mic`, 'success');
}

/** Detect whether local user is currently speaking via AudioContext analyser */
function startSpeakingDetection() {
  if (!localMicStream) return;
  try {
    localAudioCtx = new AudioContext();
    const source   = localAudioCtx.createMediaStreamSource(localMicStream);
    localAnalyser  = localAudioCtx.createAnalyser();
    localAnalyser.fftSize = 256;
    source.connect(localAnalyser);

    const data = new Uint8Array(localAnalyser.frequencyBinCount);
    const THRESHOLD = 20; // volume threshold (0-255)

    speakingCheckInterval = setInterval(() => {
      if (!localAnalyser) return;
      localAnalyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      const isSpeaking = avg > THRESHOLD;
      voiceIndicator.style.display = isSpeaking ? 'flex' : 'none';
    }, 100);
  } catch (e) {
    console.warn('AudioContext not available:', e);
  }
}

/** Watch a remote peer's audio stream and toggle .speaking class on their avatar.
 *  @param {string}           socketId
 *  @param {MediaStream}      stream  - stream attached to the <audio> element
 *  @param {MediaStreamTrack} [track] - individual audio track as fallback
 */
function watchRemoteSpeaking(socketId, stream, track) {
  try {
    // Make sure we have an active stream with at least one audio track
    let activeStream = stream;
    if (!activeStream || activeStream.getAudioTracks().length === 0) {
      activeStream = track ? new MediaStream([track]) : null;
    }
    if (!activeStream) {
      console.warn('watchRemoteSpeaking: no active audio for', socketId);
      return;
    }

    const ctx      = new AudioContext();
    const source   = ctx.createMediaStreamSource(activeStream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const data      = new Uint8Array(analyser.frequencyBinCount);
    const THRESHOLD = 15;

    const interval = setInterval(() => {
      // Stop if user left
      if (!remoteUsers.has(socketId)) {
        clearInterval(interval);
        ctx.close().catch(() => {});
        return;
      }
      analyser.getByteFrequencyData(data);
      const avg      = data.reduce((a, b) => a + b, 0) / data.length;
      const speaking = avg > THRESHOLD;
      const bubble   = document.getElementById(`avatar-${socketId}`);

      if (speaking && !speakingUsers.has(socketId)) {
        speakingUsers.add(socketId);
        if (bubble) bubble.classList.add('speaking');
      } else if (!speaking && speakingUsers.has(socketId)) {
        speakingUsers.delete(socketId);
        if (bubble) bubble.classList.remove('speaking');
      }
    }, 100);
  } catch (e) {
    console.warn('Remote speaking detection error:', e);
  }
}

