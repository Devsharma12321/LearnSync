// Dashboard JS — real data only
document.addEventListener('DOMContentLoaded', async () => {
  // ── 1. Load user from storage for fast render, then verify with server ──
  let user = JSON.parse(sessionStorage.getItem('ls_user') || '{"name":"Learner","email":""}');

  const updateUI = (u) => {
    const nameEl   = document.getElementById('greeting-name');
    const navName  = document.getElementById('user-name-nav');
    const avatarEl = document.getElementById('user-avatar');
    if (nameEl)   nameEl.textContent   = u.name.split(' ')[0];
    if (navName)  navName.textContent  = u.name;
    if (avatarEl) avatarEl.textContent = u.name[0].toUpperCase();
  };
  updateUI(user);

  // ── 2. Verify session and sync with server ──
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) {
      sessionStorage.removeItem('ls_user');
      window.location.href = 'login.html';
      return;
    }
    const data = await res.json();
    const name = data.user.lastName
      ? `${data.user.firstName} ${data.user.lastName}`
      : data.user.firstName;
    user = { email: data.user.email, name };
    sessionStorage.setItem('ls_user', JSON.stringify(user));
    updateUI(user);
  } catch (err) {
    console.error('Session verification failed:', err);
  }

  // ── 3. Time of day greeting ──
  const hour = new Date().getHours();
  const greet = document.getElementById('time-of-day');
  if (greet) greet.textContent = hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening';

  // ── 4. Logout ──
  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch (e) {}
    sessionStorage.removeItem('ls_user');
    window.location.href = 'login.html';
  });

  // ── 5. Join room button ──
  document.getElementById('join-room-btn')?.addEventListener('click', () => {
    const code = document.getElementById('room-code-input').value.trim();
    if (code) window.location.href = `editor.html?room=${code.toUpperCase()}`;
    else {
      const input = document.getElementById('room-code-input');
      input.style.borderColor = '#ef4444';
      input.focus();
      setTimeout(() => input.style.borderColor = '', 2000);
    }
  });
  document.getElementById('room-code-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('join-room-btn').click();
  });

  // ── 6. Fetch real rooms from DB ──
  await loadRooms();
});

async function loadRooms() {
  const roomsList   = document.getElementById('rooms-list');
  const roomsCount  = document.getElementById('stat-rooms-count');
  const activeCount = document.getElementById('stat-active-count');

  try {
    const res  = await fetch('/api/rooms/mine');
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Failed to load rooms');

    const rooms = data.rooms || [];

    // Update stat counts
    if (roomsCount)  roomsCount.textContent  = rooms.length;
    const liveCount = rooms.filter(r => r.activeMembers > 0).length;
    if (activeCount) activeCount.textContent = liveCount;

    // Render rooms
    if (!roomsList) return;
    roomsList.innerHTML = '';

    if (rooms.length === 0) {
      roomsList.innerHTML = `
        <div style="padding:28px 0;text-align:center;">
          <div style="font-size:2rem;margin-bottom:8px">🚀</div>
          <div style="color:var(--text-muted);font-size:0.875rem;line-height:1.6">
            No rooms yet.<br>Create one from the Code Room.
          </div>
        </div>`;
      return;
    }

    const LANG_ICON = { python: '🐍', cpp: '⚙️', java: '☕', javascript: '🟨', c: '📄' };

    rooms.forEach(room => {
      const isLive = room.activeMembers > 0;
      const lastActive = room.lastActiveAt
        ? timeAgo(new Date(room.lastActiveAt))
        : '';
      const card = document.createElement('div');
      card.className = 'room-card';
      card.innerHTML = `
        <div class="room-info">
          <div class="room-name">${escDash(room.name)}</div>
          <div class="room-meta">
            ${isLive
              ? `<span class="badge badge-green" style="font-size:0.65rem">● Live · ${room.activeMembers} online</span>`
              : `<span class="badge" style="font-size:0.65rem;background:rgba(255,255,255,0.05);color:var(--text-muted)">● Empty</span>`
            }
            <span style="font-size:0.72rem;color:var(--text-muted);font-family:var(--font-mono)">${room.code}</span>
            <span style="font-size:0.72rem;color:var(--text-muted)">${LANG_ICON[room.language] || ''} ${room.language}</span>
          </div>
          ${lastActive ? `<div style="font-size:0.7rem;color:var(--text-muted);margin-top:2px">${lastActive}</div>` : ''}
        </div>
        <a href="editor.html?room=${room.code}" class="btn btn-secondary btn-sm">
          ${isLive ? 'Join' : 'Rejoin'}
        </a>`;
      roomsList.appendChild(card);
    });

  } catch (err) {
    console.error('Rooms load error:', err);
    if (roomsList) {
      roomsList.innerHTML = `<div style="padding:16px;color:var(--text-muted);font-size:0.85rem">Could not load rooms. <a href="#" onclick="loadRooms();return false;" style="color:var(--accent)">Retry</a></div>`;
    }
  }
}

function timeAgo(date) {
  const secs = Math.floor((Date.now() - date) / 1000);
  if (secs < 60)   return 'just now';
  if (secs < 3600) return `${Math.floor(secs/60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs/3600)}h ago`;
  return `${Math.floor(secs/86400)}d ago`;
}

function escDash(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
