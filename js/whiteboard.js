/* ===========================
   Whiteboard JS — Canvas Engine
   =========================== */

const canvas  = document.getElementById('whiteboard-canvas');
const ctx     = canvas.getContext('2d');
const area    = document.getElementById('wb-canvas-area');

// ---- State ----
let tool      = 'pen';
let color     = '#f1f5f9';
let strokeW   = 4;
let opacity   = 1;
let fillMode  = false;
let drawing   = false;
let startX    = 0, startY = 0;
let snapshot  = null; // for shape preview
const history = [];
const redoStack = [];

// ---- Resize Canvas ----
function resizeCanvas() {
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  canvas.width  = area.clientWidth;
  canvas.height = area.clientHeight;
  ctx.putImageData(imageData, 0, 0);
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// ---- Helpers ----
function saveSnapshot() { snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height); }
function pushHistory()  {
  history.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
  if (history.length > 60) history.shift();
  redoStack.length = 0;
}
function undo() {
  if (!history.length) return;
  redoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
  ctx.putImageData(history.pop(), 0, 0);
}
function redo() {
  if (!redoStack.length) return;
  history.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
  ctx.putImageData(redoStack.pop(), 0, 0);
}

function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  const src  = e.touches ? e.touches[0] : e;
  return { x: src.clientX - rect.left, y: src.clientY - rect.top };
}

function applyStyle() {
  ctx.strokeStyle = color;
  ctx.fillStyle   = color;
  ctx.lineWidth   = strokeW;
  ctx.globalAlpha = opacity;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
}

// ---- Pointer Events ----
canvas.addEventListener('pointerdown', (e) => {
  if (tool === 'text') { handleTextTool(e); return; }
  e.preventDefault();
  drawing = true;
  const {x, y} = getPos(e);
  startX = x; startY = y;
  pushHistory();
  saveSnapshot();
  applyStyle();
  if (tool === 'pen' || tool === 'eraser') {
    ctx.beginPath();
    ctx.moveTo(x, y);
  }
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
  if (!drawing) return;
  e.preventDefault();
  const {x, y} = getPos(e);
  applyStyle();

  if (tool === 'pen') {
    ctx.lineTo(x, y);
    ctx.stroke();
  } else if (tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineWidth = strokeW * 4;
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  } else {
    // Shape preview
    ctx.putImageData(snapshot, 0, 0);
    applyStyle();
    drawShape(tool, startX, startY, x, y);
  }
});

canvas.addEventListener('pointerup', (e) => {
  if (!drawing) return;
  drawing = false;
  const {x, y} = getPos(e);
  if (tool !== 'pen' && tool !== 'eraser') {
    ctx.putImageData(snapshot, 0, 0);
    applyStyle();
    drawShape(tool, startX, startY, x, y);
  }
  snapshot = null;
});

canvas.addEventListener('pointerleave', () => { drawing = false; });

// ---- Shape Drawing ----
function drawShape(t, x1, y1, x2, y2) {
  ctx.beginPath();
  switch(t) {
    case 'line':
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      ctx.stroke(); break;
    case 'rect':
      if (fillMode) ctx.fillRect(x1, y1, x2-x1, y2-y1);
      ctx.strokeRect(x1, y1, x2-x1, y2-y1); break;
    case 'circle': {
      const rx = Math.abs(x2-x1)/2, ry = Math.abs(y2-y1)/2;
      const cx = x1 + (x2-x1)/2, cy = y1 + (y2-y1)/2;
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI*2);
      if (fillMode) ctx.fill();
      ctx.stroke(); break;
    }
    case 'arrow': {
      const angle = Math.atan2(y2-y1, x2-x1);
      const len   = 14;
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      ctx.lineTo(x2 - len*Math.cos(angle-0.4), y2 - len*Math.sin(angle-0.4));
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - len*Math.cos(angle+0.4), y2 - len*Math.sin(angle+0.4));
      ctx.stroke(); break;
    }
  }
}

// ---- Text Tool ----
function handleTextTool(e) {
  const {x, y} = getPos(e);
  const input = document.getElementById('wb-text-input');
  input.style.display = 'block';
  input.style.left    = `${x}px`;
  input.style.top     = `${y}px`;
  input.style.color   = color;
  input.style.fontSize = `${Math.max(14, strokeW * 4)}px`;
  input.value = '';
  input.focus();

  function commit() {
    const text = input.value.trim();
    if (text) {
      pushHistory();
      applyStyle();
      ctx.font = `${Math.max(14, strokeW*4)}px Inter, sans-serif`;
      ctx.fillText(text, x, y + parseInt(input.style.fontSize));
    }
    input.style.display = 'none';
    input.removeEventListener('blur', commit);
    input.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') { input.style.display='none'; } }
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', onKey);
}

// ---- Tool Selection ----
document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    tool = btn.dataset.tool;
    canvas.style.cursor = tool === 'eraser' ? 'cell' : tool === 'text' ? 'text' : 'crosshair';
  });
});

// ---- Color Selection ----
document.querySelectorAll('.color-swatch').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.color-swatch').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    color = btn.dataset.color;
    document.getElementById('custom-color').value = color;
  });
});

document.getElementById('custom-color')?.addEventListener('input', (e) => {
  color = e.target.value;
  document.querySelectorAll('.color-swatch').forEach(b => b.classList.remove('active'));
});

// ---- Stroke / Opacity sliders ----
document.getElementById('stroke-size')?.addEventListener('input', (e) => {
  strokeW = parseInt(e.target.value);
  document.getElementById('stroke-display').textContent = `${strokeW}px`;
});

document.getElementById('opacity-slider')?.addEventListener('input', (e) => {
  opacity = parseInt(e.target.value) / 100;
  document.getElementById('opacity-display').textContent = `${e.target.value}%`;
});

// ---- Fill ----
document.querySelectorAll('[data-fill]').forEach(btn => {
  btn.addEventListener('click', () => {
    btn.closest('.tabs').querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    fillMode = btn.dataset.fill === 'fill';
  });
});

// ---- Undo / Redo ----
document.getElementById('wb-undo-btn')?.addEventListener('click', undo);
document.getElementById('wb-redo-btn')?.addEventListener('click', redo);
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redo(); }
});

// ---- Clear ----
document.getElementById('wb-clear-btn')?.addEventListener('click', () => {
  if (confirm('Clear the entire whiteboard?')) {
    pushHistory();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
});

// ---- Export ----
document.getElementById('wb-export-btn')?.addEventListener('click', () => {
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width  = canvas.width;
  exportCanvas.height = canvas.height;
  const expCtx = exportCanvas.getContext('2d');
  expCtx.fillStyle = '#0d0e14';
  expCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
  expCtx.drawImage(canvas, 0, 0);
  const link = document.createElement('a');
  link.download = `learnsync-whiteboard-${Date.now()}.png`;
  link.href = exportCanvas.toDataURL('image/png');
  link.click();
});

// ---- Touch Support ----
canvas.addEventListener('touchstart',  e => { e.preventDefault(); }, { passive:false });
canvas.addEventListener('touchmove',   e => { e.preventDefault(); }, { passive:false });
canvas.addEventListener('touchend',    e => { e.preventDefault(); }, { passive:false });

// ---- Mock users joining ----
setTimeout(() => {
  const users = document.getElementById('wb-online');
  ['A','R'].forEach((init, i) => {
    setTimeout(() => {
      const grads = ['linear-gradient(135deg,#8b5cf6,#ec4899)','linear-gradient(135deg,#3b82f6,#06b6d4)'];
      const av = document.createElement('div');
      av.className = 'avatar avatar-sm';
      av.style.background = grads[i];
      av.textContent = init;
      av.title = init;
      av.style.marginLeft = '-8px';
      av.style.border = '2px solid var(--bg-primary)';
      users.appendChild(av);
    }, i * 2000);
  });
}, 1500);
