/* Conductor QR Code Creator — client-side QR generator (animated / video / 3D).
   Renders to a <canvas> and exports PNG, WebM and GIF. No backend. */
'use strict';
const $ = id => document.getElementById(id);
const cv = $('cv'), ctx = cv.getContext('2d');
const vid = $('vid');

const state = {
  payload: $('payload').value,
  mode: 'A',
  size: 512,
  ecl: 'H',
  speed: 1.0,
  darken: 0.45,
  rainbow: true,
  darkColor: '#0b0d12',
  lightColor: '#ffffff',
  heightFrac: 0.6,      // mode D: block rise as a fraction of module size
  lightAngle: 135,      // mode D: light direction in degrees
  lightStrength: 0.8,   // mode D: diffuse strength
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
function roundRect(c,x,y,w,h,r){
  r=Math.min(r,w/2,h/2);
  c.beginPath();
  c.moveTo(x+r,y); c.arcTo(x+w,y,x+w,y+h,r); c.arcTo(x+w,y+h,x,y+h,r);
  c.arcTo(x,y+h,x,y,r); c.arcTo(x,y,x+w,y,r); c.closePath();
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
    // video shows only inside the dark modules
    target.save();
    target.beginPath();
    forEachDark(m, off, ms, (r,c,x,y)=> target.rect(x,y,ms+0.6,ms+0.6));
    target.clip();
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
    forEachDark(m, off, ms, (r,c,x,y)=>{
      roundRect(target,x+ms*0.06,y+ms*0.06,ms*0.88,ms*0.88,ms*0.22);
      target.fill();
    });
    return;
  }

  if(state.mode==='D'){
    // Static 3D: each dark module is a block standing off a white board,
    // casting a soft ground shadow. Tops stay solid dark so it scans.
    // Light angle = shadow direction, strength = shadow darkness,
    // height = rise & shadow length.
    const rise = state.heightFrac*ms*1.7;
    const ox = rise*0.5, oy = rise*0.9;            // oblique projection of the rise
    const ang = state.lightAngle*Math.PI/180;
    const str = state.lightStrength;
    // shadow falls OPPOSITE the light, from each block's base on the board
    const slen = rise*1.0;
    const sx = -Math.cos(ang)*slen, sy = -Math.sin(ang)*slen;
    const sAlpha = clamp01(0.05 + str*0.55);
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

    // pass 2 — the blocks (fixed neutral walls give consistent 3D form)
    const BOTTOM_WALL='#454c5e', RIGHT_WALL='#6b7488';
    forEachDark(m, off, ms, (r,c,x,y)=>{
      if(rise>0.5){
        // bottom wall (slightly darker for form)
        target.fillStyle=BOTTOM_WALL;
        target.beginPath();
        target.moveTo(x,y+ms); target.lineTo(x+ms,y+ms);
        target.lineTo(x+ms+ox,y+ms+oy); target.lineTo(x+ox,y+ms+oy);
        target.closePath(); target.fill();
        // right wall (slightly lighter)
        target.fillStyle=RIGHT_WALL;
        target.beginPath();
        target.moveTo(x+ms,y); target.lineTo(x+ms,y+ms);
        target.lineTo(x+ms+ox,y+ms+oy); target.lineTo(x+ms+ox,y+oy);
        target.closePath(); target.fill();
      }
      // solid top = scannable QR module
      target.fillStyle=state.darkColor;
      target.fillRect(x,y,ms,ms);
    });
    return;
  }

  // ---- Mode A: animated squares (wave pulse + optional hue sweep) ----
  const dc = state.darkColor;
  forEachDark(m, off, ms, (r,c,x,y)=>{
    const cx=x+ms/2, cy=y+ms/2;
    let scale=1, color=dc;
    if(!m.finder[r][c]){
      const wave = Math.sin((r+c)*0.45 - phase*Math.PI*2);
      const u = 0.5+0.5*wave;            // 0..1
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
    h.textContent='⚠ Inverted code (white on video). Many phones read this, but some don’t — keep "Darken" high and always test-scan before printing.';
  }else if(state.mode==='B'){
    h.className='hint warn';
    h.textContent='Tip: if it won’t scan, raise "Darken" so the video inside the squares stays dark, and keep error correction at H.';
  }else if(state.mode==='D'){
    h.className='hint ok';
    h.textContent='Blocks stand off the board and cast a shadow on the ground. Light angle = shadow direction, strength = shadow darkness, height = rise & shadow length. Tops stay solid so it scans.';
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
  if(isVideoMode(state.mode)) ensureDefaultVideo();
  updateHint();
});
$('darkColor').addEventListener('input',e=>state.darkColor=e.target.value);
$('lightColor').addEventListener('input',e=>state.lightColor=e.target.value);
$('rainbow').addEventListener('change',e=>state.rainbow=e.target.checked);
$('darken').addEventListener('input',e=>{state.darken=e.target.value/100;$('darkenVal').textContent=e.target.value+'%';});
$('speed').addEventListener('input',e=>{state.speed=e.target.value/100;$('speedVal').textContent=(state.speed).toFixed(1)+'×';});
$('size').addEventListener('input',e=>{state.size=+e.target.value;$('sizeVal').textContent=e.target.value+' px';});
$('ecl').addEventListener('change',e=>{state.ecl=e.target.value;regenerate();});
$('height').addEventListener('input',e=>{state.heightFrac=e.target.value/100;$('heightVal').textContent=e.target.value+'%';});
$('lightAngle').addEventListener('input',e=>{state.lightAngle=+e.target.value;$('lightAngleVal').textContent=e.target.value+'°';});
$('lightStrength').addEventListener('input',e=>{state.lightStrength=e.target.value/100;$('lightStrengthVal').textContent=e.target.value+'%';});

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
vid.addEventListener('loadeddata',()=>{ state.videoReady=true; });
vid.addEventListener('error',()=>{ state.videoReady=false; });

/* ---------- exports ---------- */
function download(blob,name){
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download=name; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),2000);
}
function setProgress(p){
  const bar=$('progress'); bar.style.display = p==null?'none':'block';
  if(p!=null) bar.firstElementChild.style.width=Math.round(p*100)+'%';
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
  const dur = isVideoMode(state.mode)
            ? (state.videoReady && vid.duration ? vid.duration : 4)
            : Math.max(2, 2/state.speed);
  const types=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm','video/mp4'];
  const mime=types.find(t=>MediaRecorder.isTypeSupported(t));
  if(!mime){ alert('Your browser can’t record video. Try Chrome, or export a GIF.'); return; }
  recording=true; setProgress(0);
  if(isVideoMode(state.mode) && state.videoReady){ vid.currentTime=0; vid.play().catch(()=>{}); }
  let stream;
  try{ stream=cv.captureStream(30); }
  catch(err){ alert('Could not capture the canvas in this browser. Use the GIF export instead.'); recording=false; setProgress(null); return; }
  const chunks=[]; const rec=new MediaRecorder(stream,{mimeType:mime});
  rec.ondataavailable=e=>{ if(e.data.size) chunks.push(e.data); };
  rec.onstop=()=>{ download(new Blob(chunks,{type:mime}), 'qr.'+(mime.includes('mp4')?'mp4':'webm'));
                   recording=false; setProgress(null); };
  const t0=performance.now();
  (function tick(){
    const p=(performance.now()-t0)/1000/dur; setProgress(Math.min(1,p));
    if(p>=1){ rec.stop(); return; } requestAnimationFrame(tick);
  })();
  rec.start();
});

// GIF — frame-sampled (seeks the video for B/C so frames are exact)
let renderingGif=false;
$('dlGif').addEventListener('click',async ()=>{
  if(renderingGif) return;
  renderingGif=true;
  const fps=12;
  const dur=isVideoMode(state.mode)
           ?(state.videoReady&&vid.duration?Math.min(vid.duration,6):3)
           :Math.max(2,2/state.speed);
  const frames=Math.round(fps*dur);
  const gif=new GIF({workers:2,quality:8,width:state.size,height:state.size,
                     workerScript:'gif.worker.js'});
  const tmp=document.createElement('canvas'); tmp.width=tmp.height=state.size;
  const tctx=tmp.getContext('2d',{willReadFrequently:true});
  setProgress(0);
  const wasPlaying=!vid.paused; vid.pause();
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
  gif.on('finished',blob=>{ download(blob,'qr.gif'); setProgress(null); renderingGif=false; if(wasPlaying)vid.play().catch(()=>{}); });
  gif.render();
});

/* ---------- init ---------- */
regenerate();
$('darkColor').value=state.darkColor;

// Optional URL params for sharing/automation, e.g.
// ?mode=D&lightAngle=135&lightStrength=80&height=70&payload=https://...
(function applyQuery(){
  const q=new URLSearchParams(location.search);
  if(q.get('payload')){ state.payload=q.get('payload'); $('payload').value=state.payload; }
  const m=q.get('mode');
  if(m && /^[A-D]$/.test(m)){
    const radio=document.querySelector('input[name=mode][value="'+m+'"]');
    if(radio){ radio.checked=true; radio.dispatchEvent(new Event('change',{bubbles:true})); }
  }
  const setRange=(id,v)=>{ const el=$(id); if(el && v!=null && v!==''){ el.value=v; el.dispatchEvent(new Event('input',{bubbles:true})); } };
  setRange('height',q.get('height'));
  setRange('lightAngle',q.get('lightAngle'));
  setRange('lightStrength',q.get('lightStrength'));
  regenerate();
})();
