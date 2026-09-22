// PhotoBooth — Phone Camera JS
const socket = io();

const ANGLES = ['front','right','left','up','down'];
const ANGLE_LABELS = {front:'Front',right:'Right',left:'Left',up:'Up',down:'Down'};
const ANGLE_INSTR  = {front:'Look straight ahead at the camera',right:'Turn head to the right',left:'Turn head to the left',up:'Tilt head slightly upward',down:'Tilt head slightly downward'};
const ARROWS = {front:{t:'',top:'50%',left:'50%'},right:{t:'→',top:'50%',left:'78%'},left:{t:'←',top:'50%',left:'18%'},up:{t:'↑',top:'12%',left:'50%'},down:{t:'↓',top:'82%',left:'50%'}};
const BLUR_THRESHOLD = 80;

const $ = id => document.getElementById(id);

let currentStudent=null, capturedAngles=[], currentAngleIdx=0;
let videoStream=null, isCapturing=false, qualityTimer=null;

// ── Camera ────────────────────────────────────────────────────
async function startCamera() {
  try {
    videoStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        // No hard cap — "ideal" asks for the sensor's max and the browser
        // gives back whatever the camera actually supports, never higher.
        width:  { ideal: 7680 },
        height: { ideal: 4320 }
      },
      audio: false
    });
    $('videoFeed').srcObject = videoStream;
    await $('videoFeed').play();
    startQualityCheck();
    announceReady();
  } catch(e) {
    console.error('Camera error:', e);
    $('instructionText').textContent = 'Camera permission denied. Please allow camera access.';
  }
}

function announceReady() {
  socket.emit('camera-ready');
  syncPreview();
}

// Only stream while the camera screen is actually on-screen. A hidden video
// element draws as a black frame, which would show the dashboard a black feed.
function syncPreview() {
  if (videoStream && currentStudent) startPreviewStream();
  else stopPreviewStream();
}

// ── Live preview to the PC dashboard ──────────────────────────
// Downscaled JPEG frames over the existing socket. Deliberately NOT WebRTC:
// peer-to-peer needs a direct UDP path that a phone<->PC LAN often blocks,
// while this rides the socket connection that is already known to work.
const PREVIEW_FPS = 5, PREVIEW_WIDTH = 480;
let previewTimer = null;
const previewCanvas = document.createElement('canvas');

function startPreviewStream() {
  stopPreviewStream();
  previewTimer = setInterval(sendPreviewFrame, 1000 / PREVIEW_FPS);
}
function stopPreviewStream() {
  if (previewTimer) { clearInterval(previewTimer); previewTimer = null; }
}
function sendPreviewFrame() {
  const v = $('videoFeed');
  if (!videoStream || v.readyState < 2 || !v.videoWidth) return;
  const w = PREVIEW_WIDTH, h = Math.round(v.videoHeight / v.videoWidth * w);
  previewCanvas.width = w; previewCanvas.height = h;
  previewCanvas.getContext('2d').drawImage(v, 0, 0, w, h);
  socket.emit('preview-frame', previewCanvas.toDataURL('image/jpeg', 0.5));
}

// ── Screens ───────────────────────────────────────────────────
function showCamera() {
  $('idleScreen').classList.add('hidden');
  $('cameraScreen').classList.remove('hidden');
  if(!videoStream) startCamera();
  else syncPreview();
}
function showIdle() {
  $('idleScreen').classList.remove('hidden');
  $('cameraScreen').classList.add('hidden');
  currentStudent=null; capturedAngles=[]; currentAngleIdx=0;
  syncPreview();
}

// ── Load student ──────────────────────────────────────────────
async function loadStudent(id) {
  try {
    const res=await fetch(`/api/students/${encodeURIComponent(id)}`);
    if(!res.ok) throw new Error();
    currentStudent=await res.json();
    capturedAngles=currentStudent.capturedAngles||[];
    const first=ANGLES.findIndex(a=>!capturedAngles.includes(a));
    currentAngleIdx=first>=0?first:0;
    $('chipStudentId').textContent=currentStudent.id;
    $('chipStudentName').textContent=currentStudent.name;
    renderPills(); renderDots(); setAngle(currentAngleIdx);
    showCamera();
  } catch { showIdle(); }
}

// ── Angle UI ──────────────────────────────────────────────────
function setAngle(idx) {
  currentAngleIdx=Math.max(0,Math.min(ANGLES.length-1,idx));
  const angle=ANGLES[currentAngleIdx], cfg=ARROWS[angle];
  $('angleTag').textContent=ANGLE_LABELS[angle].toUpperCase();
  $('instructionText').textContent=ANGLE_INSTR[angle];
  const arrow=$('directionIndicator');
  arrow.textContent=cfg.t;
  arrow.style.top=cfg.top; arrow.style.left=cfg.left;
  $('ovalRing')?.setAttribute('stroke', capturedAngles.includes(angle)?'#4ade80':'white');
  renderPills(); renderDots(); highlightPill();
}

function renderPills() {
  $('anglePills').innerHTML='';
  ANGLES.forEach((a,i)=>{
    const p=document.createElement('button');
    const done=capturedAngles.includes(a);
    p.className=`angle-pill${done?' done':''}${i===currentAngleIdx?' active':''}`;
    p.textContent=ANGLE_LABELS[a];
    p.addEventListener('click',()=>setAngle(i));
    $('anglePills').appendChild(p);
  });
}
function highlightPill() {
  document.querySelectorAll('.angle-pill').forEach((p,i)=>p.classList.toggle('active',i===currentAngleIdx));
}

function renderDots() {
  $('progressLabel').textContent=`${capturedAngles.length} / ${ANGLES.length}`;
  $('progressDots').innerHTML='';
  ANGLES.forEach((a,i)=>{
    const d=document.createElement('div');
    const done=capturedAngles.includes(a);
    d.className=`p-dot${done?' done':''}${i===currentAngleIdx&&!done?' cur':''}`;
    $('progressDots').appendChild(d);
  });
}

// ── Quality check ─────────────────────────────────────────────
function startQualityCheck(){ stopQualityCheck(); qualityTimer=setInterval(checkQ,700); }
function stopQualityCheck(){ if(qualityTimer){clearInterval(qualityTimer);qualityTimer=null;} }

function checkQ() {
  const v=$('videoFeed');
  if(!videoStream||v.readyState<2) return;
  const s=laplacian(v,128);
  const good=s>BLUR_THRESHOLD;
  $('qualityDot').className=`quality-dot ${good?'good':'bad'}`;
  $('qualityLabel').textContent=good?'Sharp':'Blurry';
}
function laplacian(video,size){
  const c=document.createElement('canvas');c.width=size;c.height=size;
  const ctx=c.getContext('2d');ctx.drawImage(video,0,0,size,size);
  const d=ctx.getImageData(0,0,size,size).data;
  const g=new Float32Array(size*size);
  for(let i=0;i<size*size;i++)g[i]=0.299*d[i*4]+0.587*d[i*4+1]+0.114*d[i*4+2];
  let s=0,s2=0,n=0;
  for(let y=1;y<size-1;y++)for(let x=1;x<size-1;x++){
    const l=-g[(y-1)*size+x]-g[(y+1)*size+x]-g[y*size+(x-1)]-g[y*size+(x+1)]+4*g[y*size+x];
    s+=l;s2+=l*l;n++;
  }
  return n>0?(s2/n)-(s/n)*(s/n):0;
}

// ── Capture ───────────────────────────────────────────────────
async function capture(angleOverride) {
  if(isCapturing||!videoStream||!currentStudent) return;
  const video=$('videoFeed');
  if(video.readyState<2) return;
  const angle=angleOverride||ANGLES[currentAngleIdx];

  // Blur gate
  if(laplacian(video,256)<BLUR_THRESHOLD){
    $('blurBar').classList.remove('hidden');
    socket.emit('capture-failed',{angle,reason:'Too blurry — hold the phone steady'});
    return;
  }

  isCapturing=true; $('captureBtn').disabled=true;

  // Flash
  const flash=$('flash'); flash.classList.add('on');
  setTimeout(()=>flash.classList.remove('on'),150);

  // Full-res canvas capture
  const canvas=$('captureCanvas');
  canvas.width=video.videoWidth; canvas.height=video.videoHeight;
  canvas.getContext('2d').drawImage(video,0,0,video.videoWidth,video.videoHeight);

  canvas.toBlob(async blob=>{
    if(!blob){ isCapturing=false; $('captureBtn').disabled=false; return; }
    showStatus('Saving...');
    const form=new FormData();
    form.append('studentId',currentStudent.id);
    form.append('angle',angle);
    form.append('photo',blob,`${angle}.jpg`);
    try {
      const res=await fetch('/api/photo',{method:'POST',body:form});
      const data=await res.json();
      if(data.success){
        capturedAngles=data.capturedAngles;
        showStatus('Saved',1200);
        $('ovalRing')?.setAttribute('stroke','#4ade80');
        renderPills(); renderDots();
        // Auto advance
        setTimeout(()=>{
          const next=ANGLES.findIndex((a,i)=>i>currentAngleIdx&&!capturedAngles.includes(a));
          if(next>=0) setAngle(next);
          else{ const first=ANGLES.findIndex(a=>!capturedAngles.includes(a));
            if(first>=0) setAngle(first);
            else showStatus(`All ${ANGLES.length} photos captured`,2500); }
        },1300);
      } else { showStatus('Error: '+data.error,2000); }
    } catch { showStatus('Network error',2000); }
    finally { isCapturing=false; $('captureBtn').disabled=false; }
  },'image/jpeg',1.0);
}

// ── Status overlay ────────────────────────────────────────────
let statusTimer=null;
function showStatus(msg,ms=null){
  if(statusTimer){clearTimeout(statusTimer);statusTimer=null;}
  $('statusMsg').textContent=msg;
  $('statusOverlay').classList.remove('hidden');
  if(ms) statusTimer=setTimeout(()=>$('statusOverlay').classList.add('hidden'),ms);
}

// ── Event listeners ───────────────────────────────────────────
$('captureBtn').addEventListener('click',()=>capture());
$('btnPrev').addEventListener('click',()=>setAngle(currentAngleIdx-1));
$('btnNext').addEventListener('click',()=>setAngle(currentAngleIdx+1));
$('blurDismiss').addEventListener('click',()=>$('blurBar').classList.add('hidden'));
document.addEventListener('keydown',e=>{ if(e.code==='Space'){e.preventDefault();capture();} });
document.addEventListener('contextmenu',e=>e.preventDefault());

// ── Socket ────────────────────────────────────────────────────
socket.on('connect',()=>announceReady());
socket.on('student-selected',({studentId})=>loadStudent(studentId));
socket.on('capture-request',({angle})=>{
  if(!ANGLES.includes(angle)) return;
  const idx=ANGLES.indexOf(angle);
  if(idx!==currentAngleIdx) setAngle(idx);
  capture(angle);
});

// ── Init ──────────────────────────────────────────────────────
(async()=>{ await startCamera(); })();
