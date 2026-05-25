/* Conductor QR Code Creator — client-side QR generator (animated / video / 3D).
   Renders to a <canvas> and exports PNG, WebM and GIF. No backend. */
'use strict';
const $ = id => document.getElementById(id);
const cv = $('cv'), ctx = cv.getContext('2d');
const vid = $('vid');

const state = {
  payload: $('payload').value,
  mode: 'A',
  anim: 'wave',         // mode A animation style: wave | ripple | twinkle | swirl
  size: 512,
  ecl: 'H',
  speed: 1.0,
  clip: 5,              // desired export length in seconds (snapped to whole loops)
  darken: 0.45,
  rainbow: true,
  darkColor: '#0b0d12',
  lightColor: '#ffffff',
  topColor: '#0b0d12',  // mode D: top face of each block (the scannable code)
  sideColor: '#b9c0cf', // mode D: block side walls (right face; bottom is derived darker)
  heightFrac: 0.6,      // mode D: block rise as a fraction of module size
  lightAngle: 135,      // mode D: shadow direction in degrees
  matrix: null,       // {n, dark:[[bool]], finder:[[bool]], ecl}
  videoReady: false,
};

/* ---------- QR matrix ---------- */
function buildMatrix(text, ecl){
  // Try requested EC level, fall back to lower levels if data is too long.
  const levels = ['H','Q','M','L'];
  const order = levels.slice(levels.indexOf(ecl));
  for(const lv of order){
    try{
      const qr = qrcode(0, lv);     // typeNumber 0 = auto-fit
      qr.addData(text);
      qr.make();
      const n = qr.getModuleCount();
      const dark = [], finder = [];
      for(let r=0;r<n;r++){
        dark[r]=[]; finder[r]=[];
        for(let c=0;c<n;c++){
          dark[r][c] = qr.isDark(r,c);
          finder[r][c] = isFinderOrTiming(r,c,n);
        }
      }
      return {n, dark, finder, ecl:lv};
    }catch(e){ /* data too long for this level — try a lower one */ }
  }
  return null;
}
// Finder patterns (3 corners, 7x7) + the two timing lines stay solid so
// scanners reliably lock onto the code even while data modules animate.
function isFinderOrTiming(r,c,n){
  const inBox = (r0,c0)=> r>=r0 && r<r0+7 && c>=c0 && c<c0+7;
  if(inBox(0,0)||inBox(0,n-7)||inBox(n-7,0)) return true;
  if(r===6 || c===6) return true;
  return false;
}

function regenerate(){
  state.matrix = buildMatrix(state.payload || ' ', state.ecl);
  updateHint();
}

/* ---------- helpers ---------- */
function hslToRgb(h,s,l){
  s/=100; l/=100;
  const k=n=>(n+h/30)%12, a=s*Math.min(l,1-l);
  const f=n=>l-a*Math.max(-1,Math.min(k(n)-3,Math.min(9-k(n),1)));
  return [Math.round(255*f(0)),Math.round(255*f(8)),Math.round(255*f(4))];
}
// shade a #rrggbb hex toward black (amt<0) or white (amt>0), amt in -1..1
function shade(hex, amt){
  const h=hex.replace('#',''); const n=parseInt(h,16);
  let r=(n>>16)&255, g=(n>>8)&255, b=n&255;
  const f=v => amt<0 ? v*(1+amt) : v+(255-v)*amt;
  const to=v => Math.max(0,Math.min(255,Math.round(f(v)))).toString(16).padStart(2,'0');
  return '#'+to(r)+to(g)+to(b);
}
function roundRect(c,x,y,w,h,r){
  r=Math.min(r,w/2,h/2);
  c.beginPath();
  c.moveTo(x+r,y); c.arcTo(x+w,y,x+w,y+h,r); c.arcTo(x+w,y+h,x,y+h,r);
  c.arcTo(x,y+h,x,y,r); c.arcTo(x,y,x+w,y,r); c.closePath();
}
// same rounded rect, but appended to a Path2D so many can be filled in one call
function addRoundRect(p,x,y,w,h,r){
  r=Math.min(r,w/2,h/2);
  p.moveTo(x+r,y); p.arcTo(x+w,y,x+w,y+h,r); p.arcTo(x+w,y+h,x,y+h,r);
  p.arcTo(x,y+h,x,y,r); p.arcTo(x,y,x+w,y,r); p.closePath();
}
// Build (and cache on the matrix) the module geometry as Path2D objects so the
// video modes can repaint the whole code with a single clip()/fill() per frame
// instead of one path op per module. That per-module loop is what starved the
// frame budget and made the background video stutter.
function getModulePaths(m, px){
  if(m._paths && m._paths.px===px) return m._paths;
  const quiet=4, total=m.n+quiet*2, ms=px/total, off=quiet*ms;
  const rects=new Path2D();     // plain squares — clip region for mode B
  const rounded=new Path2D();   // rounded squares — white modules for mode C
  for(let r=0;r<m.n;r++)for(let c=0;c<m.n;c++){
    if(!m.dark[r][c]) continue;
    const x=off+c*ms, y=off+r*ms;
    rects.rect(x,y,ms+0.6,ms+0.6);
    addRoundRect(rounded, x+ms*0.06, y+ms*0.06, ms*0.88, ms*0.88, ms*0.22);
  }
  m._paths={px, rects, rounded};
  return m._paths;
}
const isVideoMode = m => (m==='B'||m==='C');
const clamp01 = v => Math.max(0, Math.min(1, v));
// iterate dark modules, calling fn(r,c,x,y) with top-left pixel coords
function forEachDark(m, off, ms, fn){
  for(let r=0;r<m.n;r++)for(let c=0;c<m.n;c++){
    if(m.dark[r][c]) fn(r, c, off+c*ms, off+r*ms);
  }
}
// draw the video "cover"-fitted into a w×h box
function drawVideoCover(c,w,h){
  if(!state.videoReady) return false;
  const vw=vid.videoWidth, vh=vid.videoHeight;
  if(!vw||!vh) return false;
  const scale=Math.max(w/vw,h/vh);
  const dw=vw*scale, dh=vh*scale;
  c.drawImage(vid,(w-dw)/2,(h-dh)/2,dw,dh);
  return true;
}

/* ---------- render one frame at time t (seconds) ---------- */
function drawFrame(t, target=ctx, dim=state.size){
  const m = state.matrix;
  const px = dim;
  // Only resize the live canvas when the size actually changes (avoids a
  // costly per-frame reallocation and keeps captureStream resolution stable).
  if(target===ctx && cv.width!==px){ cv.width=px; cv.height=px; }
  if(!m){ target.fillStyle=state.lightColor; target.fillRect(0,0,px,px); return; }

  const quiet = 4;                       // quiet zone in modules
  const total = m.n + quiet*2;
  const ms = px/total;                   // module size in px
  const off = quiet*ms;

  target.fillStyle = state.lightColor;
  target.fillRect(0,0,px,px);

  const phase = t*state.speed;

  if(state.mode==='B'){
    // video shows only inside the dark modules (clip to cached module path)
    target.save();
    target.clip(getModulePaths(m, px).rects);
    if(!drawVideoCover(target,px,px)){ target.fillStyle=state.darkColor; target.fillRect(0,0,px,px); }
    target.fillStyle = `rgba(0,0,0,${state.darken})`;   // keep the code dark enough
    target.fillRect(0,0,px,px);
    target.restore();
    return;
  }

  if(state.mode==='C'){
    // video as full background + dark scrim, white code modules on top
    if(!drawVideoCover(target,px,px)){ target.fillStyle=state.darkColor; target.fillRect(0,0,px,px); }
    target.fillStyle = `rgba(0,0,0,${state.darken})`;
    target.fillRect(0,0,px,px);
    target.fillStyle = state.lightColor;
    target.fill(getModulePaths(m, px).rounded);   // whole code in one fill
    return;
  }

  if(state.mode==='D'){
    // Static 3D: each dark module is a block standing off the board, casting a
    // soft ground shadow. Light angle = shadow direction, strength = shadow
    // darkness, height = rise & shadow length. Tops stay solid so it scans.
    const rise = state.heightFrac*ms*1.7;
    const ox = rise*0.5, oy = rise*0.9;            // oblique projection of the rise
    const ang = state.lightAngle*Math.PI/180;
    // shadow falls OPPOSITE the light, from each block's base on the board
    const slen = rise*1.0;
    const sx = -Math.cos(ang)*slen, sy = -Math.sin(ang)*slen;
    const sAlpha = 0.6;
    const blur = Math.min(6, rise*0.22);

    // pass 1 — soft cast shadow (one filled path so overlaps don't stack darker)
    target.save();
    if(blur>0.3) target.filter = `blur(${blur}px)`;
    target.globalAlpha = sAlpha;
    target.fillStyle = '#000';
    target.beginPath();
    forEachDark(m, off, ms, (r,c,x,y)=> target.rect(x+ox+sx, y+oy+sy, ms, ms));
    target.fill();
    target.restore();

    // pass 2 — the blocks. Right wall = chosen side color, bottom wall a touch
    // darker so the form still reads.
    const RIGHT_WALL=state.sideColor, BOTTOM_WALL=shade(state.sideColor,-0.14);
    forEachDark(m, off, ms, (r,c,x,y)=>{
      if(rise>0.5){
        target.fillStyle=BOTTOM_WALL;
        target.beginPath();
        target.moveTo(x,y+ms); target.lineTo(x+ms,y+ms);
        target.lineTo(x+ms+ox,y+ms+oy); target.lineTo(x+ox,y+ms+oy);
        target.closePath(); target.fill();
        target.fillStyle=RIGHT_WALL;
        target.beginPath();
        target.moveTo(x+ms,y); target.lineTo(x+ms,y+ms);
        target.lineTo(x+ms+ox,y+ms+oy); target.lineTo(x+ms+ox,y+oy);
        target.closePath(); target.fill();
      }
      // solid top = scannable QR module
      target.fillStyle=state.topColor;
      target.fillRect(x,y,ms,ms);
    });
    return;
  }

  // ---- Mode A: animated squares. Four patterns share the same scale/colour
  //      mapping; only the per-module value `u` (0..1) differs. All are
  //      periodic over one phase unit, so exported clips still loop cleanly. ----
  const dc = state.darkColor;
  const TWO = Math.PI*2;
  const cr=(m.n-1)/2, cc=(m.n-1)/2;       // grid center for the radial pattern
  const animU = (r,c)=>{
    switch(state.anim){
      case 'ripple':  { const d=Math.hypot(r-cr,c-cc); return 0.5+0.5*Math.sin(d*0.55 - phase*TWO); }
      case 'twinkle': { const h=Math.sin(r*12.9898+c*78.233)*43758.5453; const o=(h-Math.floor(h))*TWO;
                        return 0.5+0.5*Math.sin(phase*TWO + o); }
      case 'swirl':   { const a=Math.atan2(r-cr,c-cc), d=Math.hypot(r-cr,c-cc);
                        return 0.5+0.5*Math.sin(a*3 + d*0.5 - phase*TWO); }   // spinning spiral arms
      case 'wave':
      default:        return 0.5+0.5*Math.sin((r+c)*0.45 - phase*TWO);
    }
  };
  forEachDark(m, off, ms, (r,c,x,y)=>{
    const cx=x+ms/2, cy=y+ms/2;
    let scale=1, color=dc;
    if(!m.finder[r][c]){
      const u = animU(r,c);
      scale = 0.62 + 0.38*u;             // never below 0.62 so centers stay readable
      if(state.rainbow){
        const hue = ((r+c)*7 + phase*120) % 360;
        const rgb = hslToRgb(hue,72, 20+10*u);   // lightness 20–30% → stays dark on white
        color = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
      }
    }
    const s = ms*scale;
    target.fillStyle = color;
    roundRect(target, cx-s/2, cy-s/2, s, s, s*0.22);
    target.fill();
  });
}

/* ---------- live preview loop ---------- */
let start = performance.now();
function loop(now){
  drawFrame((now-start)/1000);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

/* ---------- scannability hint ---------- */
function updateHint(){
  const h = $('hint');
  if(state.mode==='C'){
    h.className='hint warn';
    h.textContent='Experiment with the different settings and ensure your QR code scans before you save it.';
  }else if(state.mode==='B'){
    h.className='hint warn';
    h.textContent='Tip: if it won’t scan, raise "Darken" so the video inside the squares stays dark, and keep error correction at H.';
  }else if(state.mode==='D'){
    h.className='hint ok';
    h.textContent='Experiment with the different settings and ensure your QR code scans before you save it.';
  }else{
    h.className='hint ok';
    h.textContent='✓ Scan-safe: finder corners stay solid and squares stay dark on white. Test with your phone camera.';
  }
}

/* ---------- default sample video (loaded lazily, only when needed) ---------- */
let triedDefault=false;
function ensureDefaultVideo(){
  if(state.videoReady || triedDefault || location.protocol==='file:') return;
  triedDefault=true;
  fetch('conductord-id.mp4',{method:'HEAD'}).then(r=>{
    if(!r.ok) return;
    vid.src='conductord-id.mp4'; vid.play().catch(()=>{});
    $('filebox').classList.add('has');
    $('filebox').textContent='🎬 conductord-id.mp4 (sample — tap to replace)';
  }).catch(()=>{});
}

/* ---------- wire up controls ---------- */
$('payload').addEventListener('input', e=>{ state.payload=e.target.value; regenerate(); });
$('modes').addEventListener('change', e=>{
  if(e.target.name!=='mode') return;
  state.mode=e.target.value;
  document.querySelectorAll('.mode').forEach(el=>el.classList.toggle('active', el.querySelector('input').checked));
  $('videoControls').style.display = isVideoMode(state.mode)?'block':'none';
  $('threedControls').style.display = (state.mode==='D')?'block':'none';
  $('animControls').style.display = (state.mode==='A')?'block':'none';
  // Rainbow only colours the mode-A animation
  $('rainbowWrap').style.display = (state.mode==='A')?'':'none';
  // 3D has its own color set (tops / sides / board), so hide the generic pair
  $('colorGrid').style.display = (state.mode==='D')?'none':'';
  // Both video modes only need one picker: the video fills the code, so the
  // dark "Code color" is unused. Hide it. In Video the remaining picker is the
  // background; in Video BG it's the code modules drawn over the video.
  const isB = state.mode==='B', isC = state.mode==='C';
  $('darkColorWrap').style.display = (isB||isC) ? 'none' : '';
  $('lightColorLabel').textContent = isC ? 'Code color' : 'Background';
  // Speed only drives the animation; meaningless for the static 3D style
  $('speedWrap').style.display = (state.mode==='D')?'none':'';
  // 3D is a still image — PNG only, no clip/WebM/GIF
  const still = state.mode==='D';
  $('clipWrap').style.display = still?'none':'';
  $('dlWebm').style.display = still?'none':'';
  $('dlGif').style.display = still?'none':'';
  if(isVideoMode(state.mode)) ensureDefaultVideo();
  updateHint();
  updateClipNote();
});
$('animType').addEventListener('change',e=>state.anim=e.target.value);
$('darkColor').addEventListener('input',e=>state.darkColor=e.target.value);
$('lightColor').addEventListener('input',e=>{state.lightColor=e.target.value;$('lightColorD').value=e.target.value;});
$('topColor').addEventListener('input',e=>state.topColor=e.target.value);
$('sideColor').addEventListener('input',e=>state.sideColor=e.target.value);
$('lightColorD').addEventListener('input',e=>{state.lightColor=e.target.value;$('lightColor').value=e.target.value;});
$('rainbow').addEventListener('change',e=>{state.rainbow=e.target.checked;updateClipNote();});
$('darken').addEventListener('input',e=>{state.darken=e.target.value/100;$('darkenVal').textContent=e.target.value+'%';});
$('speed').addEventListener('input',e=>{state.speed=e.target.value/100;$('speedVal').textContent=(state.speed).toFixed(1)+'×';updateClipNote();});
$('size').addEventListener('input',e=>{state.size=+e.target.value;$('sizeVal').textContent=e.target.value+' px';});
$('clip').addEventListener('input',e=>{state.clip=+e.target.value;$('clipVal').textContent=(+e.target.value).toFixed(1)+' s';updateClipNote();});
$('ecl').addEventListener('change',e=>{state.ecl=e.target.value;regenerate();});
$('height').addEventListener('input',e=>{state.heightFrac=e.target.value/100;$('heightVal').textContent=e.target.value+'%';});
$('lightAngle').addEventListener('input',e=>{state.lightAngle=+e.target.value;$('lightAngleVal').textContent=e.target.value+'°';});

/* video file picker */
$('filebox').addEventListener('click',()=>$('videoFile').click());
$('videoFile').addEventListener('change',e=>{
  const f=e.target.files[0]; if(!f) return;
  if(!f.type.startsWith('video/')){ alert('Please choose a video file.'); return; }
  vid.src=URL.createObjectURL(f);
  vid.play().catch(()=>{});
  $('filebox').classList.add('has');
  $('filebox').textContent='🎬 '+f.name;
});
vid.addEventListener('loadeddata',()=>{ state.videoReady=true; updateClipNote(); });
vid.addEventListener('error',()=>{ state.videoReady=false; updateClipNote(); });

/* ---------- seamless clip length ----------
   We snap the length the user picks to a whole number of loop cycles, so the
   saved clip ends exactly where it began and loops with no mid-stream cut.
   - Video modes: a whole multiple of the source video's duration.
   - Animated (A): a whole number of animation cycles (wave + hue).
   - Static (D) / fallback: the requested length as-is. */
function animationPeriod(){
  // seconds for one full mode-A cycle: hue repeats every 3 phase units, the
  // wave every 1; rainbow on → period 3, off → 1. phase advances at `speed`.
  return (state.rainbow ? 3 : 1) / state.speed;
}
function loopDuration(){
  const want = Math.max(1, state.clip);
  if(isVideoMode(state.mode) && state.videoReady && vid.duration){
    return Math.max(1, Math.round(want / vid.duration)) * vid.duration;
  }
  if(state.mode==='A'){
    const period = animationPeriod();
    return Math.max(1, Math.round(want / period)) * period;
  }
  return want;
}
function updateClipNote(){
  const el=$('clipNote'); if(!el) return;
  el.textContent='Clip length up to 30 seconds.';
}

/* ---------- exports ---------- */
function download(blob,name){
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download=name; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),2000);
}
// Block the page while a save (WebM/GIF) is running so the user can't change
// settings mid-render or accidentally navigate away. Both exports go through
// setProgress, so locking here covers them all.
function beforeUnloadGuard(e){ e.preventDefault(); e.returnValue=''; return ''; }
// 2-minute safety net: if a save makes no progress for 2 minutes (e.g. a GIF
// worker that never fires 'finished'), force-cancel it so the page can't stay
// stuck behind the saving overlay. The active export registers how to abort
// itself via `cancelSave`; the timer is reset on every progress tick, so it
// only fires on a genuine stall — not on a slow-but-advancing render.
let saveWatchdog=null, cancelSave=null;
function saveTimedOut(){
  saveWatchdog=null;
  const c=cancelSave; cancelSave=null;
  try{ if(c) c(); }catch(_){}
  setProgress(null);
  alert('Saving timed out after 2 minutes. Try a shorter clip or a smaller size.');
}
function setProgress(p){
  const bar=$('progress'); bar.style.display = p==null?'none':'block';
  if(p!=null) bar.firstElementChild.style.width=Math.round(p*100)+'%';
  const saving = p!=null;
  $('saveLock').style.display = saving ? 'flex' : 'none';
  if(saving) window.addEventListener('beforeunload', beforeUnloadGuard);
  else window.removeEventListener('beforeunload', beforeUnloadGuard);
  if(saveWatchdog){ clearTimeout(saveWatchdog); saveWatchdog=null; }
  if(saving) saveWatchdog=setTimeout(saveTimedOut, 120000);
  else cancelSave=null;
}

// PNG — single frame
$('dlPng').addEventListener('click',()=>{
  const tmp=document.createElement('canvas'); tmp.width=tmp.height=state.size;
  drawFrame((performance.now()-start)/1000, tmp.getContext('2d'), state.size);
  tmp.toBlob(b=>download(b,'qr.png'),'image/png');
});

// WebM — capture the live canvas (best for video modes)
let recording=false;
$('dlWebm').addEventListener('click',()=>{
  if(recording) return;
  if(typeof cv.captureStream!=='function' || typeof window.MediaRecorder==='undefined'){
    alert('Animated video recording isn’t supported in this browser (common on iPhone Safari). Use the GIF export instead.');
    return;
  }
  const dur = loopDuration();
  const types=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm','video/mp4'];
  const mime=types.find(t=>MediaRecorder.isTypeSupported(t));
  if(!mime){ alert('Your browser can’t record video. Try Chrome, or export a GIF.'); return; }
  recording=true; setProgress(0);
  if(isVideoMode(state.mode) && state.videoReady){ vid.currentTime=0; vid.play().catch(()=>{}); }

  // Capture ONLY the frames we explicitly push: captureStream(0) + requestFrame.
  // A timed captureStream(30) samples the canvas on its own clock, and a
  // backgrounded/occluded canvas can briefly expose unrelated screen content —
  // pushing frames ourselves guarantees the output is exactly what we draw.
  let stream, track, manual=false;
  try{
    stream=cv.captureStream(0);
    track=stream.getVideoTracks()[0];
    manual = typeof track.requestFrame === 'function';
    if(!manual){ stream.getTracks().forEach(t=>t.stop()); stream=cv.captureStream(30); }
  }catch(err){
    alert('Could not capture the canvas in this browser. Use the GIF export instead.');
    recording=false; setProgress(null); return;
  }
  const chunks=[]; const rec=new MediaRecorder(stream,{mimeType:mime});
  let aborted=false;
  rec.ondataavailable=e=>{ if(e.data.size) chunks.push(e.data); };
  rec.onstop=()=>{ if(!aborted) download(new Blob(chunks,{type:mime}), 'qr.'+(mime.includes('mp4')?'mp4':'webm'));
                   recording=false; setProgress(null); };
  // Never leave the page locked if recording fails or stalls partway through.
  rec.onerror=()=>{ recording=false; setProgress(null); };
  cancelSave=()=>{ aborted=true; recording=false; try{ rec.stop(); }catch(_){} };
  try{ rec.start(); }
  catch(err){ recording=false; setProgress(null); alert('Recording could not start. Use the GIF export instead.'); return; }

  // Drive frames from elapsed ACTIVE time. dt is capped so that if the tab is
  // hidden (rAF + video both pause) we neither fast-forward the animation nor
  // push frames while away — the clip simply pauses and resumes, never leaking.
  let last=performance.now(), acc=0;
  (function tick(){
    if(!recording) return;
    const now=performance.now(); acc += Math.min((now-last)/1000, 1/15); last=now;
    drawFrame(acc, ctx, state.size);          // render the exact frame…
    if(manual) track.requestFrame();          // …then hand it to the recorder
    setProgress(Math.min(1, acc/dur));
    if(acc>=dur){ rec.stop(); return; }
    requestAnimationFrame(tick);
  })();
});

// GIF — frame-sampled (seeks the video for B/C so frames are exact)
let renderingGif=false;
$('dlGif').addEventListener('click',async ()=>{
  if(renderingGif) return;
  renderingGif=true;
  let wasPlaying=false;
  const release=()=>{ setProgress(null); renderingGif=false; if(wasPlaying)vid.play().catch(()=>{}); };
  try{
    const fps=12;
    const dur=loopDuration();
    const frames=Math.round(fps*dur);
    const gif=new GIF({workers:2,quality:8,width:state.size,height:state.size,
                       workerScript:'gif.worker.js'});
    cancelSave=()=>{ renderingGif=false; if(wasPlaying)vid.play().catch(()=>{}); try{ gif.abort(); }catch(_){} };
    const tmp=document.createElement('canvas'); tmp.width=tmp.height=state.size;
    const tctx=tmp.getContext('2d',{willReadFrequently:true});
    setProgress(0);
    wasPlaying=!vid.paused; vid.pause();
    for(let i=0;i<frames;i++){
      const t=i/fps;
      if(isVideoMode(state.mode) && state.videoReady){
        vid.currentTime=t % (vid.duration||dur);
        await new Promise(res=>{ const h=()=>{vid.removeEventListener('seeked',h);res();}; vid.addEventListener('seeked',h); setTimeout(res,300); });
      }
      drawFrame(t,tctx,state.size);
      gif.addFrame(tctx,{copy:true,delay:1000/fps});
      setProgress(i/frames*0.6);
    }
    gif.on('progress',p=>setProgress(0.6+p*0.4));
    gif.on('finished',blob=>{ download(blob,'qr.gif'); release(); });
    gif.on('abort',release);
    gif.render();
  }catch(err){
    release();   // never leave the page locked if the render throws
    alert('Sorry — the GIF could not be generated. Try a shorter clip or a smaller size.');
  }
});

/* ---------- init ---------- */
regenerate();
$('darkColor').value=state.darkColor;
updateClipNote();

// Optional URL params for sharing/automation, e.g.
// ?mode=D&lightAngle=135&height=70&payload=https://...
(function applyQuery(){
  const q=new URLSearchParams(location.search);
  if(q.get('payload')){ state.payload=q.get('payload'); $('payload').value=state.payload; }
  const m=q.get('mode');
  if(m && /^[A-D]$/.test(m)){
    const radio=document.querySelector('input[name=mode][value="'+m+'"]');
    if(radio){ radio.checked=true; radio.dispatchEvent(new Event('change',{bubbles:true})); }
  }
  const setRange=(id,v)=>{ const el=$(id); if(el && v!=null && v!==''){ el.value=v; el.dispatchEvent(new Event('input',{bubbles:true})); } };
  const a=q.get('anim'); if(a){ const sel=$('animType'); if(sel){ sel.value=a; state.anim=a; } }
  setRange('height',q.get('height'));
  setRange('lightAngle',q.get('lightAngle'));
  regenerate();
})();
