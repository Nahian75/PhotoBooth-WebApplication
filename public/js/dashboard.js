// ── PhotoBooth Dashboard JS ───────────────────────────────────────────────────

const socket = io();

const ANGLES = ['front', 'right', 'left', 'up', 'down'];
const ANGLE_LABELS = { front:'Front', right:'Right', left:'Left', up:'Up', down:'Down' };
const ANGLE_INSTR  = {
  front:  'Look straight ahead at the camera',
  right:  'Turn head to the right',
  left:   'Turn head to the left',
  up:     'Tilt head slightly upward',
  down:   'Tilt head slightly downward'
};
const ARROW_CONFIG = {
  front:  { t:'',  top:'50%', left:'50%' },
  right:  { t:'→', top:'50%', left:'78%' },
  left:   { t:'←', top:'50%', left:'18%' },
  up:     { t:'↑', top:'12%', left:'50%' },
  down:   { t:'↓', top:'82%', left:'50%' }
};
const BLUR_THRESHOLD = 80;

// ── State ──────────────────────────────────────────────────────────────────────
let allStudents = [], filteredStudents = [], selectedStudentId = null;
let currentFilter = 'all', searchQuery = '';
let currentAngleIdx = 0;
let webcamStream = null, webcamDevices = [];
let phoneConnected = false, webcamActive = false, phoneStreaming = false;
let isCapturing = false, qualityTimer = null;

const $ = id => document.getElementById(id);
const mediaDevices = navigator.mediaDevices || null;

// ── Init ───────────────────────────────────────────────────────────────────────
async function init() {
  // Loading students must never stop the rest of the page from starting,
  // or a stalled request leaves the whole dashboard dead.
  try { await loadStudents(); } catch (e) { console.error('loadStudents failed:', e); }
  setupListeners();   // Always runs — no dependency on camera APIs
  initWebcam();       // Best-effort, errors are caught internally
}

// ── Students ───────────────────────────────────────────────────────────────────
async function loadStudents() {
  try {
    // A request that never answers would otherwise leave "Loading..." on
    // screen forever and stop the rest of the page from starting.
    const res = await fetch('/api/students', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    allStudents = await res.json();
    applyFilter();
    updateProgress();
  } catch {
    // Leaving "Loading..." on screen reads as still working, when in fact the
    // server is gone — usually because its window was closed.
    $('studentList').innerHTML =
      '<div class="no-results">Cannot reach the server.<br/><br/>' +
      'It may have been closed. Start it again with START.bat,<br/>then reload this page.</div>';
    $('progressText').textContent = 'Server not running';
    showToast('Cannot reach the server', 'error');
  }
}

function applyFilter() {
  const q = searchQuery.toLowerCase().trim();
  filteredStudents = allStudents.filter(s => {
    const mQ = !q || s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q) || (s.department||'').toLowerCase().includes(q);
    const mF = currentFilter==='all' || (currentFilter==='completed'&&s.completed) || (currentFilter==='pending'&&!s.completed);
    return mQ && mF;
  });
  renderList();
  const c = filteredStudents.filter(s=>s.completed).length;
  const p = filteredStudents.filter(s=>!s.completed).length;
  $('listMeta').textContent = `${filteredStudents.length} students — ${c} done, ${p} pending`;
}

function updateProgress() {
  const total = allStudents.length, done = allStudents.filter(s=>s.completed).length;
  const pct = total>0 ? Math.round((done/total)*100) : 0;
  $('progressText').textContent = `${done} / ${total} completed`;
  $('progressFill').style.width = `${pct}%`;
  $('progressPct').textContent  = `${pct}%`;
}

function renderList() {
  const list = $('studentList');
  if (!filteredStudents.length) { list.innerHTML = '<div class="no-results">No students found.</div>'; return; }
  list.innerHTML = '';
  filteredStudents.forEach(s => {
    const el = document.createElement('div');
    el.className = `student-item${s.id===selectedStudentId?' active':''}`;
    el.dataset.id = s.id;
    const ini = s.name.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
    const dots = ANGLES.map(a=>`<span class="item-dot${(s.capturedAngles||[]).includes(a)?' done':''}"></span>`).join('');
    el.innerHTML = `
      <div class="item-avatar${s.completed?' done':''}">${ini}</div>
      <div class="item-info">
        <div class="item-name">${esc(s.name)}</div>
        <div class="item-sub">${esc(s.id)} &middot; ${esc(s.department||'')}</div>
        <div class="item-dots">${dots}</div>
      </div>
      <span class="item-badge ${s.completed?'completed':'pending'}">${s.completed?'Done':'Pending'}</span>
    `;
    el.addEventListener('click', () => selectStudent(s.id));
    list.appendChild(el);
  });
}

function selectStudent(id) {
  selectedStudentId = id;
  document.querySelectorAll('.student-item').forEach(el => el.classList.toggle('active', el.dataset.id===id));
  const s = allStudents.find(s=>s.id===id);
  if (!s) return;
  $('emptyState').classList.add('hidden');
  $('studentDetail').classList.remove('hidden');
  renderDetail(s);
  const firstPending = ANGLES.findIndex(a=>!(s.capturedAngles||[]).includes(a));
  currentAngleIdx = firstPending>=0 ? firstPending : 0;
  renderPills(); setAngle(currentAngleIdx);
  renderSource();
  socket.emit('select-student', { studentId: id });
}

function renderDetail(s) {
  const ini = s.name.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
  $('detailAvatar').textContent  = ini;
  $('detailName').textContent    = s.name;
  $('detailId').textContent      = s.id;
  $('detailDept').textContent    = s.department || '';
  $('detailYear').textContent    = s.year ? `Year ${s.year}` : '';
  $('detailDob').textContent     = s.dob   || '';
  $('detailEmail').textContent   = s.email || '';
  $('detailPhone').textContent   = s.phone || '';
  $('detailStatusBadge').className = `status-badge ${s.completed?'completed':'pending'}`;
  $('detailStatusText').textContent = s.completed ? 'COMPLETED' : 'PENDING';
  renderAngles(s);
  updateActionBar(s);
}

// ── Angles ─────────────────────────────────────────────────────────────────────
function renderAngles(s) {
  const captured = s.capturedAngles || [];
  $('anglesGrid').innerHTML = '';
  ANGLES.forEach((angle, idx) => {
    const done = captured.includes(angle);
    const card = document.createElement('div');
    card.className = `angle-card${done?' captured':''}${idx===currentAngleIdx?' active-angle':''}`;
    card.id = `angle-card-${angle}`;
    card.innerHTML = `
      <div class="angle-preview" id="angle-preview-${angle}">
        ${done ? `<img src="/api/photos/${encodeURIComponent(s.id)}/${angle}?t=${Date.now()}" alt="${angle}"/>` : `<div class="angle-placeholder">${miniSVG(angle)}</div>`}
        <div class="check-mark">&#10003;</div>
        ${done ? `<button class="retake-btn" data-angle="${angle}">Retake</button>` : ''}
      </div>
      <div class="angle-footer">
        <span class="angle-name">${ANGLE_LABELS[angle]}</span>
        <span class="angle-status">${done?'Captured':''}</span>
      </div>
    `;
    card.addEventListener('click', () => { currentAngleIdx=idx; setAngle(idx); renderPills(); highlightActiveAngle(); });
    card.querySelector('.retake-btn')?.addEventListener('click', e => { e.stopPropagation(); retake(s.id, angle); });
    $('anglesGrid').appendChild(card);
  });
  const n = captured.length;
  $('angleCount').textContent = `${n} / ${ANGLES.length}`;
  $('angleBarFill').style.width = `${(n/ANGLES.length)*100}%`;
}

function highlightActiveAngle() {
  ANGLES.forEach((a,i) => $(`angle-card-${a}`)?.classList.toggle('active-angle', i===currentAngleIdx));
}

function renderPills() {
  const s = selectedStudentId ? allStudents.find(s=>s.id===selectedStudentId) : null;
  const captured = s?.capturedAngles || [];
  $('anglePillsRow').innerHTML = '';
  ANGLES.forEach((angle, idx) => {
    const done = captured.includes(angle);
    const pill = document.createElement('button');
    pill.className = `a-pill${done?' done':''}${idx===currentAngleIdx?' active':''}`;
    pill.textContent = ANGLE_LABELS[angle];
    pill.addEventListener('click', () => { currentAngleIdx=idx; setAngle(idx); renderPills(); highlightActiveAngle(); });
    $('anglePillsRow').appendChild(pill);
  });
}

function setAngle(idx) {
  currentAngleIdx = Math.max(0, Math.min(ANGLES.length-1, idx));
  const angle = ANGLES[currentAngleIdx];
  const cfg   = ARROW_CONFIG[angle];
  $('angleTagOverlay').textContent  = ANGLE_LABELS[angle].toUpperCase();
  $('captureInstruction').textContent = ANGLE_INSTR[angle];
  const arrow = $('angleArrow');
  arrow.textContent  = cfg.t;
  arrow.style.top    = cfg.top;
  arrow.style.left   = cfg.left;
  arrow.style.transform = 'translate(-50%,-50%)';
  const s = selectedStudentId ? allStudents.find(s=>s.id===selectedStudentId) : null;
  const captured = s?.capturedAngles || [];
  const ring = $('ovalRingEl');
  if (ring) ring.setAttribute('stroke', captured.includes(angle) ? '#4ade80' : 'white');
}

function miniSVG(angle) {
  const a = { front:'', right:'<path d="M55 40 L65 40" stroke="#e5e7eb" stroke-width="2"/>', left:'<path d="M45 40 L35 40" stroke="#e5e7eb" stroke-width="2"/>', up:'<path d="M50 18 L50 6" stroke="#e5e7eb" stroke-width="2"/>', down:'<path d="M50 62 L50 74" stroke="#e5e7eb" stroke-width="2"/>' };
  return `<svg width="50" height="65" viewBox="0 0 100 120" fill="none"><ellipse cx="50" cy="44" rx="24" ry="30" stroke="#e5e7eb" stroke-width="2"/>${a[angle]}</svg>`;
}

// Completion is derived from the photos on disk, so there is nothing to mark
// by hand — this just reports where the student stands.
function updateActionBar(s) {
  const n = (s.capturedAngles||[]).length;
  const left = ANGLES.length - n;
  if (left <= 0) {
    $('actionText').textContent = `All ${ANGLES.length} photos captured. Student is completed.`;
  } else if (webcamActive || phoneStreaming) {
    $('actionText').textContent = `${left} angle${left>1?'s':''} remaining.`;
  } else {
    $('actionText').textContent = 'Connect a webcam or phone camera to begin.';
  }
}

async function retake(studentId, angle) {
  if (!confirm(`Delete the ${angle} photo and retake?`)) return;
  try {
    const res = await fetch(`/api/photos/${encodeURIComponent(studentId)}/${angle}`, { method:'DELETE' });
    const data = await res.json();
    if (data.success) { updateState(studentId, data.capturedAngles); showToast(`${ANGLE_LABELS[angle]} photo deleted`, 'info'); }
    else showToast(data.error||'Could not delete photo', 'error');
  } catch { showToast('Network error — photo not deleted', 'error'); }
}

async function deleteStudent(id) {
  const s = allStudents.find(s=>s.id===id);
  if (!s) return;
  if (!confirm(`Delete ${s.name} (${s.id})? This also removes all their captured photos. This cannot be undone.`)) return;
  try {
    const res = await fetch(`/api/students/${encodeURIComponent(id)}`, { method:'DELETE' });
    const data = await res.json();
    if (!data.success) { showToast(data.error||'Could not delete student', 'error'); return; }
    removeStudentFromView(id);
    showToast(`${s.name} deleted`, 'info');
  } catch { showToast('Network error — student not deleted', 'error'); }
}

function removeStudentFromView(id) {
  allStudents = allStudents.filter(s=>s.id!==id);
  if (selectedStudentId===id) {
    selectedStudentId = null;
    $('studentDetail').classList.add('hidden');
    $('emptyState').classList.remove('hidden');
  }
  applyFilter(); updateProgress();
}

function updateState(id, capturedAngles) {
  const idx = allStudents.findIndex(s=>s.id===id);
  if (idx<0) return;
  allStudents[idx].capturedAngles = capturedAngles;
  allStudents[idx].completed = capturedAngles.length===ANGLES.length;
  if (selectedStudentId===id) { renderDetail(allStudents[idx]); renderPills(); }
  applyFilter(); updateProgress();
}

function handlePhotoSaved({ studentId, angle, capturedAngles }) {
  updateState(studentId, capturedAngles);   // re-renders the grid, count and bar
  if (studentId===selectedStudentId) {
    isCapturing = false;
    renderSource();
    // Auto-advance to the next uncaptured angle
    const next = ANGLES.findIndex((a,i) => i>currentAngleIdx && !capturedAngles.includes(a));
    const target = next>=0 ? next : ANGLES.findIndex(a=>!capturedAngles.includes(a));
    if (target>=0) { currentAngleIdx=target; setAngle(target); renderPills(); highlightActiveAngle(); }
  }
  const name = allStudents.find(s=>s.id===studentId)?.name || studentId;
  showToast(`${ANGLE_LABELS[angle]} saved — ${name}`, 'success');
}

// ── Webcam: Plug-and-Play ──────────────────────────────────────────────────────
function initWebcam() {
  if (!mediaDevices) return;   // phone feed still works; it needs no local camera
  try {
    mediaDevices.addEventListener('devicechange', () => onDeviceChange());
  } catch(e) { console.warn('devicechange listener failed:', e); }
  onDeviceChange();
}

async function onDeviceChange() {
  if (!mediaDevices) return;
  try {
    const devices = await mediaDevices.enumerateDevices();
    webcamDevices = devices.filter(d => d.kind==='videoinput');
    populateCameraSelect();
    if (webcamDevices.length>0) {
      if (!webcamStream) await startWebcam();
    } else {
      stopWebcam();
    }
  } catch(e) { console.warn('enumerateDevices failed:', e); }
}

function populateCameraSelect() {
  const sel = $('cameraSelect');
  const prev = sel.value;
  sel.innerHTML = '';
  
  const offOpt = document.createElement('option');
  offOpt.value = 'none';
  offOpt.textContent = ' Turn off PC Webcam';
  sel.appendChild(offOpt);

  if (!webcamDevices.length) {
    const opt = document.createElement('option');
    opt.textContent = 'No camera found';
    opt.disabled = true;
    sel.appendChild(opt);
    return;
  }
  
  webcamDevices.forEach((d,i) => {
    const opt = document.createElement('option');
    opt.value = d.deviceId;
    opt.textContent = d.label || `Camera ${i+1}`;
    sel.appendChild(opt);
  });
  if (prev && (prev === 'none' || webcamDevices.find(d=>d.deviceId===prev))) sel.value = prev;
}

async function startWebcam(deviceId) {
  if (!mediaDevices) { showToast('Camera API not available. Use HTTPS or localhost.', 'warn'); return; }
  try {
    if (webcamStream) { webcamStream.getTracks().forEach(t=>t.stop()); webcamStream=null; }
    const constraints = {
      video: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        // No hard cap — "ideal" asks for the sensor's max and the browser
        // gives back whatever the camera actually supports, never higher.
        width:  { ideal: 7680 },
        height: { ideal: 4320 }
      },
      audio: false
    };
    webcamStream = await mediaDevices.getUserMedia(constraints);
    const video = $('webcamFeed');
    video.srcObject = webcamStream;
    await video.play();
    // Re-enumerate to get labels after permission granted
    const devices = await mediaDevices.enumerateDevices();
    webcamDevices = devices.filter(d=>d.kind==='videoinput');
    populateCameraSelect();
    webcamActive = true;
    renderSource();
    if (selectedStudentId) { const s=allStudents.find(s=>s.id===selectedStudentId); if(s) updateActionBar(s); }
    showToast('Webcam connected', 'success');
  } catch(e) {
    console.warn('Webcam start failed:', e);
    const msg = e.name==='NotAllowedError' ? 'Camera permission denied' : e.name==='NotFoundError' ? 'No camera found' : 'Could not start webcam';
    showToast(msg, 'warn');
    stopWebcam();
  }
}

function stopWebcam() {
  if (webcamStream) { webcamStream.getTracks().forEach(t=>t.stop()); webcamStream=null; }
  webcamActive = false;
  renderSource();
  if (selectedStudentId) { const s=allStudents.find(s=>s.id===selectedStudentId); if(s) updateActionBar(s); }
}

// ── Phone camera: live preview frames over the socket ───────────────────────────
// Frames stop arriving if the phone sleeps or drops off, so treat a gap as
// "phone feed gone" rather than leaving a frozen image on screen.
const PREVIEW_TIMEOUT_MS = 4000;
let previewWatchdog = null;

function onPreviewFrame(frame) {
  $('phoneFeed').src = frame;
  phoneStreaming = true;
  renderSource();
  clearTimeout(previewWatchdog);
  previewWatchdog = setTimeout(hidePhoneFeed, PREVIEW_TIMEOUT_MS);
}

function hidePhoneFeed() {
  phoneStreaming = false;
  clearTimeout(previewWatchdog);
  $('phoneFeed').removeAttribute('src');
  renderSource();
}

// The phone deliberately outranks the PC webcam: if someone connected a phone,
// that is the camera actually pointed at the student.
function activeSource() {
  if (phoneStreaming) return 'phone';
  if (webcamActive)   return 'webcam';
  return null;
}

function activeVideoEl() {
  const src = activeSource();
  return src==='phone' ? $('phoneFeed') : src==='webcam' ? $('webcamFeed') : null;
}

// Single place that decides what the viewfinder shows. Safe to call repeatedly
// (it runs on every incoming preview frame).
function renderSource() {
  const src = activeSource();
  $('phoneFeed').classList.toggle('hidden', src!=='phone');
  $('phoneSourceTag').classList.toggle('hidden', src!=='phone');
  $('webcamFeed').classList.toggle('hidden', src!=='webcam');
  $('noWebcam').classList.toggle('hidden', src!==null);
  $('ovalOverlay').classList.toggle('hidden', src===null);
  $('btnCapture').disabled = !(src && selectedStudentId);
  // Only score the webcam. The phone preview is a compressed thumbnail, so a
  // blur score off it would be meaningless — the phone gates its own shots.
  if (src==='webcam') { if (!qualityTimer) startQualityCheck(); }
  else {
    stopQualityCheck();
    $('qualityDot').className = 'quality-dot';
    $('qualityLabel').textContent = src==='phone' ? 'Phone' : 'Ready';
  }
}

// ── Quality check ──────────────────────────────────────────────────────────────
function startQualityCheck() { stopQualityCheck(); qualityTimer=setInterval(checkQuality, 700); }
function stopQualityCheck()  { if(qualityTimer){clearInterval(qualityTimer); qualityTimer=null;} }

function checkQuality() {
  const v = activeVideoEl();
  if (!v) return;
  const ready = v.tagName==='VIDEO' ? v.readyState>=2 : (v.complete && v.naturalWidth>0);
  if (!ready) return;
  const good = laplacianScore(v, 128) > BLUR_THRESHOLD;
  $('qualityDot').className      = `quality-dot ${good?'good':'bad'}`;
  $('qualityLabel').textContent  = good ? 'Sharp' : 'Blurry';
}

function laplacianScore(video, size) {
  try {
    const c=document.createElement('canvas'); c.width=size; c.height=size;
    const ctx=c.getContext('2d'); ctx.drawImage(video,0,0,size,size);
    const d=ctx.getImageData(0,0,size,size).data;
    const g=new Float32Array(size*size);
    for(let i=0;i<size*size;i++) g[i]=0.299*d[i*4]+0.587*d[i*4+1]+0.114*d[i*4+2];
    let s=0,s2=0,n=0;
    for(let y=1;y<size-1;y++) for(let x=1;x<size-1;x++){
      const l=-g[(y-1)*size+x]-g[(y+1)*size+x]-g[y*size+(x-1)]-g[y*size+(x+1)]+4*g[y*size+x];
      s+=l; s2+=l*l; n++;
    }
    return n>0 ? (s2/n)-(s/n)*(s/n) : 0;
  } catch { return 999; }
}

// ── Capture ────────────────────────────────────────────────────────────────────
function handleCapture() {
  const src = activeSource();
  if (src==='phone') requestPhoneCapture();
  else if (src==='webcam') captureFromWebcam();
}

function requestPhoneCapture() {
  if (isCapturing || !selectedStudentId) return;
  const angle = ANGLES[currentAngleIdx];
  isCapturing = true;
  $('btnCapture').disabled = true;
  const flash = $('captureFlash');
  flash.classList.add('flash');
  setTimeout(()=>flash.classList.remove('flash'), 150);
  socket.emit('capture-request', { angle });
  showToast('Capturing on phone…', 'info', 1500);
  // photo-saved (or a timeout) re-enables the button
  setTimeout(() => { isCapturing = false; renderSource(); }, 3000);
}

async function captureFromWebcam() {
  if (isCapturing || !webcamStream || !selectedStudentId) return;
  const video = $('webcamFeed');
  if (video.readyState<2) { showToast('Camera not ready yet', 'warn'); return; }
  const angle = ANGLES[currentAngleIdx];
  if (laplacianScore(video, 256) < BLUR_THRESHOLD) {
    showToast('Image is blurry — hold steady and try again', 'warn'); return;
  }
  isCapturing = true;
  $('btnCapture').disabled = true;
  const flash = $('captureFlash');
  flash.classList.add('flash');
  setTimeout(()=>flash.classList.remove('flash'), 150);
  const vw=video.videoWidth, vh=video.videoHeight;
  const canvas=$('captureCanvas');
  canvas.width=vw; canvas.height=vh;
  canvas.getContext('2d').drawImage(video,0,0,vw,vh);
  canvas.toBlob(async blob => {
    if (!blob) { isCapturing=false; renderSource(); showToast('Capture failed','error'); return; }
    const form=new FormData();
    form.append('studentId', selectedStudentId);
    form.append('angle', angle);
    form.append('photo', blob, `${angle}.jpg`);
    try {
      const res  = await fetch('/api/photo',{method:'POST',body:form});
      const data = await res.json();
      if (!data.success) showToast(data.error||'Upload failed','error');
    } catch { showToast('Network error — photo not saved','error'); }
    finally { isCapturing=false; renderSource(); }
  }, 'image/jpeg', 1.0);
}

// ── Event Listeners ────────────────────────────────────────────────────────────
function setupListeners() {

  // Search
  $('searchInput').addEventListener('input', e => {
    searchQuery = e.target.value;
    $('searchClear').classList.toggle('visible', searchQuery.length>0);
    applyFilter();
  });
  $('searchClear').addEventListener('click', () => {
    $('searchInput').value=''; searchQuery='';
    $('searchClear').classList.remove('visible');
    applyFilter(); $('searchInput').focus();
  });

  // Filters
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      applyFilter();
    });
  });

  // QR / Connect Phone button
  $('btnQR').addEventListener('click', () => openQRModal());
  $('qrClose').addEventListener('click', () => closeQRModal());
  $('qrModal').addEventListener('click', e => { if(e.target===$('qrModal')) closeQRModal(); });

  // Add Student
  $('btnAddStudent').addEventListener('click', () => openAddStudentModal());
  $('addStudentClose').addEventListener('click', () => closeAddStudentModal());
  $('addStudentModal').addEventListener('click', e => { if(e.target===$('addStudentModal')) closeAddStudentModal(); });
  $('addStudentForm').addEventListener('submit', handleAddStudent);

  // Webcam camera select
  $('cameraSelect').addEventListener('change', e => {
    if (e.target.value === 'none') {
      stopWebcam();
    } else if (e.target.value) {
      startWebcam(e.target.value);
    }
  });

  // Webcam connect (click on the no-webcam area)
  $('noWebcam').addEventListener('click', () => startWebcam());

  // Capture button
  $('btnCapture').addEventListener('click', () => handleCapture());

  // Space bar = capture
  document.addEventListener('keydown', e => {
    if (e.code==='Space' && !e.target.matches('input,select,button,textarea')) {
      e.preventDefault();
      handleCapture();
    }
  });

  // Delete student
  $('btnDeleteStudent').addEventListener('click', () => {
    if (selectedStudentId) deleteStudent(selectedStudentId);
  });

  // Socket events
  socket.on('photo-saved',    handlePhotoSaved);
  socket.on('photo-deleted',  ({studentId,capturedAngles})=>updateState(studentId,capturedAngles));
  socket.on('student-updated', ({studentId, capturedAngles, student}) => {
    const exists = allStudents.some(s=>s.id===studentId);
    if (!exists && student) {
      allStudents.push({ ...student, capturedAngles: capturedAngles||[], completed: false });
      applyFilter(); updateProgress();
      if (pendingNewStudentId===studentId) { pendingNewStudentId=null; selectStudent(studentId); }
    } else {
      updateState(studentId, capturedAngles);
    }
  });
  socket.on('student-deleted',({studentId})=>removeStudentFromView(studentId));
  socket.on('camera-ready', () => {
    phoneConnected = true;
    $('phoneDot').className       = 'device-dot on';
    $('phoneStatusText').textContent = 'Phone Connected';
    showToast('Phone camera connected', 'success');
    closeQRModal();
    if (selectedStudentId) { const s=allStudents.find(s=>s.id===selectedStudentId); if(s) updateActionBar(s); }
  });
  socket.on('camera-disconnected', () => {
    phoneConnected = false;
    $('phoneDot').className       = 'device-dot';
    $('phoneStatusText').textContent = 'Connect Phone';
    hidePhoneFeed();
  });

  // Live preview frames from the phone
  socket.on('preview-frame', onPreviewFrame);

  // Phone rejected the shot — without this the operator just sees nothing happen
  socket.on('capture-failed', ({reason}) => {
    isCapturing = false;
    renderSource();
    showToast(reason || 'Phone could not capture', 'warn');
  });

  socket.on('connect', () => {
    if (selectedStudentId) socket.emit('select-student',{studentId:selectedStudentId});
  });
}

// ── QR Modal ───────────────────────────────────────────────────────────────────
async function openQRModal() {
  $('qrModal').classList.remove('hidden');
  $('qrContainer').innerHTML = '<div class="spinner"></div>';
  $('qrUrl').textContent = '';
  try {
    const res  = await fetch('/api/qrcode');
    const data = await res.json();
    $('qrContainer').innerHTML = `<img src="${data.qrDataUrl}" alt="QR Code" style="width:100%;max-width:220px"/>`;
    $('qrUrl').textContent = data.url;
  } catch {
    $('qrContainer').innerHTML = '<p style="color:#dc2626;font-size:13px">Failed to generate QR code.<br>Is the server running?</p>';
  }
}

function closeQRModal() {
  $('qrModal').classList.add('hidden');
}

// ── Add Student Modal ────────────────────────────────────────────────────────────
let pendingNewStudentId = null;

function openAddStudentModal() {
  $('addStudentForm').reset();
  $('addStudentError').classList.add('hidden');
  $('addStudentModal').classList.remove('hidden');
  $('newStudentId').focus();
}

function closeAddStudentModal() {
  $('addStudentModal').classList.add('hidden');
}

async function handleAddStudent(e) {
  e.preventDefault();
  const id         = $('newStudentId').value.trim();
  const name       = $('newStudentName').value.trim();
  const phone      = $('newStudentPhone').value.trim();
  const email      = $('newStudentEmail').value.trim();
  const department = $('newStudentDept').value.trim();
  const year       = $('newStudentYear').value.trim();
  const dob        = $('newStudentDob').value;
  if (!id || !name) return;

  $('addStudentSubmit').disabled = true;
  $('addStudentError').classList.add('hidden');
  try {
    const res  = await fetch('/api/students', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name, phone, email, department, year, dob })
    });
    const data = await res.json();
    if (!data.success) {
      $('addStudentError').textContent = data.error || 'Could not add student';
      $('addStudentError').classList.remove('hidden');
      return;
    }
    pendingNewStudentId = id; // picked up by the student-updated broadcast below
    closeAddStudentModal();
    showToast(`${name} added`, 'success');
  } catch {
    $('addStudentError').textContent = 'Network error — student not added';
    $('addStudentError').classList.remove('hidden');
  } finally {
    $('addStudentSubmit').disabled = false;
  }
}

// ── Toast ──────────────────────────────────────────────────────────────────────
function showToast(msg, type='info', ms=3200) {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  $('toastWrap').appendChild(t);
  setTimeout(()=>{ t.classList.add('toast-out'); setTimeout(()=>t.remove(), 220); }, ms);
}

function esc(s){ const d=document.createElement('div'); d.textContent=s||''; return d.innerHTML; }

// ── Start ──────────────────────────────────────────────────────────────────────
init();
