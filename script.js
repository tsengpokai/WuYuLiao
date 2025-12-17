// =====================================================
// Smooth stepper jump
// =====================================================
document.querySelectorAll('.step[data-jump]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const sel = btn.getAttribute('data-jump');
    const el = document.querySelector(sel);
    if(el) el.scrollIntoView({behavior:'smooth', block:'start'});
  });
});

// =====================================================
// Utilities
// =====================================================
function clamp(x, a, b){ return Math.max(a, Math.min(b, x)); }
function gaussianNoise(mean, stdev){
  const u = 1 - Math.random();
  const v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return z * stdev + mean;
}
function toRad(d){ return d*Math.PI/180; }
function havKm(lat1, lon1, lat2, lon2){
  const R = 6371;
  const dLat = toRad(lat2-lat1);
  const dLon = toRad(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}
function wavelet(dt, f=0.18){
  return Math.sin(2*Math.PI*f*dt) * Math.exp(-0.06*dt);
}
function probBump(t, t0, w=7){
  const x = (t-t0)/w;
  return Math.exp(-0.5*x*x);
}

// =====================================================
// PART 01: Python Code Simulation (like screenshot)
// =====================================================
const simCanvas = document.getElementById('chart-sim');
let simChart = null;

function makeSimWave(isQuake){
  const N = 220;
  const data = [];
  const t0 = isQuake ? 85 + Math.floor(Math.random()*25) : -1;

  for(let i=0;i<N;i++){
    let x = gaussianNoise(0, 0.10);
    if(isQuake && i >= t0){
      const dt = i - t0;
      x += 1.25 * Math.sin(0.55*dt) * Math.exp(-0.04*dt);
      if(dt > 10) x += 0.55 * Math.sin(0.18*dt) * Math.exp(-0.02*dt);
    }
    // normalize/clamp
    x = clamp(x, -1.4, 1.4);
    data.push(x);
  }
  return data;
}

function initSimChart(){
  if(!simCanvas) return;
  const ctx = simCanvas.getContext('2d');
  simChart = new Chart(ctx, {
    type:'line',
    data:{
      labels: Array.from({length: 220}, (_,i)=>i),
      datasets:[{
        data: Array(220).fill(0),
        borderColor: 'rgba(255,42,42,0.85)',
        borderWidth: 2.2,
        pointRadius: 0,
        tension: 0.25
      }]
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      animation:false,
      scales:{ x:{display:false}, y:{display:false, min:-1.6, max:1.6} },
      plugins:{ legend:{display:false}, tooltip:{enabled:false} }
    }
  });
}
initSimChart();

const btnSim = document.getElementById('btn-sim');
const simPred = document.getElementById('sim-pred');

if(btnSim){
  btnSim.addEventListener('click', ()=>{
    const truthIsQuake = Math.random() > 0.5;
    const wave = makeSimWave(truthIsQuake);

    // "model" prediction (teaching): quake tends to high prob, noise low prob
    const prob = truthIsQuake ? (0.88 + Math.random()*0.10) : (0.01 + Math.random()*0.12);
    const predIsQuake = prob > 0.5;

    // color logic like screenshot: quake=green, noise=red waveform
    simChart.data.datasets[0].data = wave;
    simChart.data.datasets[0].borderColor = truthIsQuake ? 'rgba(10,255,10,0.85)' : 'rgba(255,42,42,0.85)';
    simChart.update('none');

    const correct = (predIsQuake === truthIsQuake);
    const predLabel = predIsQuake ? "EARTHQUAKE" : "NOISE";
    const color = correct ? "#0aff0a" : "#ff2a2a";

    simPred.innerHTML = `AI PRED: <span style="color:${color}">${predLabel} (${(prob*100).toFixed(1)}%)</span>`;
  });
}

// =====================================================
// Event Log helpers
// =====================================================
const eventLog = document.getElementById('eventLog');
function logLine(text, cls=""){
  if(!eventLog) return;
  const div = document.createElement('div');
  div.className = `line ${cls}`;
  div.textContent = text;
  eventLog.appendChild(div);
  eventLog.scrollTop = eventLog.scrollHeight;
}
function clearLog(){ if(eventLog) eventLog.innerHTML = ""; }

// =====================================================
// Map setup
// =====================================================
const map = L.map('map', {zoomControl:false}).setView([24.2, 121.6], 9);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  maxZoom: 12, opacity: 0.9
}).addTo(map);

// Stations (keep three stations)
const stations = [
  { id:0, code:"HUAL", lat:23.98, lon:121.60 },
  { id:1, code:"NACB", lat:24.45, lon:121.75 },
  { id:2, code:"SSLB", lat:23.90, lon:120.95 }
];

const stMarkers = [];
stations.forEach(st=>{
  const icon = L.divIcon({ className:'station-marker', html:'▲', iconSize:[20,20], iconAnchor:[10,10] });
  const m = L.marker([st.lat, st.lon], {icon}).addTo(map);
  stMarkers.push(m);
});

let pCircle=null, sCircle=null, epiSolveMarker=null, errCircle=null, lines=[];

// =====================================================
// Charts for MONITOR
// =====================================================
function mkWaveChart(canvasId){
  const ctx = document.getElementById(canvasId).getContext('2d');
  return new Chart(ctx, {
    type:'line',
    data:{
      labels: Array.from({length: 260}, (_,i)=>i),
      datasets:[{
        data: Array(260).fill(0),
        borderColor: 'rgba(255,255,255,0.22)',
        borderWidth: 1.6,
        pointRadius: 0,
        tension: 0.25
      }]
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      animation:false,
      scales:{ x:{display:false}, y:{display:false, min:-1.8, max:1.8} },
      plugins:{ legend:{display:false}, tooltip:{enabled:false} }
    }
  });
}
const charts = [ mkWaveChart('chart-0'), mkWaveChart('chart-1'), mkWaveChart('chart-2') ];

// =====================================================
// Monitoring controls
// =====================================================
const btnTrigger = document.getElementById('btn-trigger');
const sysStatus = document.getElementById('sys-status');
const mvStatus = document.getElementById('mv-status');

const pThresh = document.getElementById('pThresh');
const sThresh = document.getElementById('sThresh');
const thrP = document.getElementById('thrP');
const thrS = document.getElementById('thrS');

pThresh.addEventListener('input', ()=> thrP.textContent = (+pThresh.value).toFixed(2));
sThresh.addEventListener('input', ()=> thrS.textContent = (+sThresh.value).toFixed(2));

function setBadgeState(i, state){
  const badge = document.getElementById(`badge-${i}`);
  badge.classList.remove('active','fired');
  if(state==="fired") badge.classList.add('fired');
  if(state==="active") badge.classList.add('active');
}

function resetAll(){
  sysStatus.className = "ok mono";
  sysStatus.textContent = "ONLINE";
  mvStatus.textContent = "READY";

  for(let i=0;i<3;i++){
    setBadgeState(i, "");
    stMarkers[i].getElement().classList.remove('hot');
    document.getElementById(`dist-${i}`).textContent = "R=-- km";
    document.getElementById(`pick-${i}`).textContent = "P=-- | S=--";
  }

  charts.forEach(c=>{
    c.data.datasets[0].data = Array(260).fill(0);
    c.data.datasets[0].borderColor = 'rgba(255,255,255,0.22)';
    c.update('none');
  });

  clearLog();
  document.getElementById('loc-result').style.display = 'none';

  if(pCircle){ map.removeLayer(pCircle); pCircle=null; }
  if(sCircle){ map.removeLayer(sCircle); sCircle=null; }
  if(epiSolveMarker){ map.removeLayer(epiSolveMarker); epiSolveMarker=null; }
  if(errCircle){ map.removeLayer(errCircle); errCircle=null; }
  lines.forEach(l=> map.removeLayer(l));
  lines = [];
}

function mkStarIcon(){
  return L.divIcon({ className:'quake-star', html:'★', iconSize:[44,44], iconAnchor:[22,22] });
}

// =====================================================
// Location solver (grid-search) using ABSOLUTE pick times (fixed)
// =====================================================
function locateByGrid_PicksAbs(stSim, dt, vp){
  const picks = stSim
    .filter(s=>s.pPickAbsTick >= 0)
    .map(s=>({st:s.st, tPick: s.pPickAbsTick * dt}));

  if(picks.length < 2) return null;

  const box = { latMin: 23.6, latMax: 24.8, lonMin: 120.7, lonMax: 122.4 };
  let best = {misfit: Infinity, lat:null, lon:null, t0:null};

  for(let lat=box.latMin; lat<=box.latMax; lat+=0.01){
    for(let lon=box.lonMin; lon<=box.lonMax; lon+=0.01){
      const t0s = picks.map(p=>{
        const R = havKm(p.st.lat, p.st.lon, lat, lon);
        return p.tPick - (R/vp);
      });
      const t0 = t0s.reduce((a,b)=>a+b,0)/t0s.length;

      let ss = 0;
      for(const p of picks){
        const R = havKm(p.st.lat, p.st.lon, lat, lon);
        const pred = t0 + (R/vp);
        const r = (p.tPick - pred);
        ss += r*r;
      }
      if(ss < best.misfit) best = {misfit:ss, lat, lon, t0};
    }
  }
  return best;
}

// magnitude (teaching regression)
function estimateML(stSim, lat, lon){
  const vals = stSim.map(s=>{
    const R = Math.max(1, havKm(s.st.lat, s.st.lon, lat, lon));
    const A = Math.max(1e-3, s.amax);
    return Math.log10(A) + 1.10*Math.log10(R) + 0.003*R + 2.0;
  });
  return vals.reduce((a,b)=>a+b,0)/vals.length;
}

function showSolution(sol, stSim){
  epiSolveMarker = L.marker([sol.lat, sol.lon], {icon: mkStarIcon()}).addTo(map);

  const errKm = clamp(Math.sqrt(sol.misfit)*25, 2, 35);
  errCircle = L.circle([sol.lat, sol.lon], {radius: errKm*1000, color:'#ff2a2a', fillOpacity:0.08, weight:1}).addTo(map);

  stSim.forEach(s=>{
    const line = L.polyline([[s.st.lat, s.st.lon],[sol.lat, sol.lon]], {color:'#ff2a2a', dashArray:'6,6', weight:1}).addTo(map);
    lines.push(line);
  });

  const ml = estimateML(stSim, sol.lat, sol.lon);

  document.getElementById('loc-result').style.display = 'block';
  document.getElementById('res-loc').textContent = `${sol.lat.toFixed(2)}°N, ${sol.lon.toFixed(2)}°E`;
  document.getElementById('res-dep').textContent = `~12 km (demo)`;
  document.getElementById('res-mag').textContent = `M ${ml.toFixed(1)} (ML demo)`;

  logLine("ASSOCIATION: linked 3 stations into 1 event.", "good");
  logLine("LOCATION: epicenter solved using absolute P picks (fixed).", "good");
  logLine("MAG: estimated via regression (demo).", "good");

  map.setView([sol.lat, sol.lon], 9);
}

// =====================================================
// TRIGGER EQ (with corrected epicenter + corrected picks)
// =====================================================
let running = false;

btnTrigger.addEventListener('click', ()=>{
  if(running) return;
  running = true;
  btnTrigger.disabled = true;

  resetAll();

  sysStatus.className = "mono";
  sysStatus.innerHTML = "<span style='color:#ff2a2a; animation:blink .6s infinite'>DETECTING...</span>";
  mvStatus.textContent = "RUNNING";

  // FIXED epicenter (your original design): offshore Hualien
  const epiTrue = { lat: 24.15, lon: 121.90 };

  // wavefront circles
  pCircle = L.circle([epiTrue.lat, epiTrue.lon], {radius:0, color:'#00f3ff', fillOpacity:0.06, weight:1}).addTo(map);
  sCircle = L.circle([epiTrue.lat, epiTrue.lon], {radius:0, color:'#ff2a2a', fillOpacity:0.04, weight:1}).addTo(map);

  logLine("INIT: Event injected at 24.15N, 121.90E. Simulating moveout…", "warn");

  const vp = 6.0, vs = 3.5;
  const dt = 0.05; // sec per tick
  const bufferN = 260;

  const stSim = stations.map((st, idx)=>{
    const R = havKm(st.lat, st.lon, epiTrue.lat, epiTrue.lon);
    const tP = R/vp;
    const tS = R/vs;
    const pTick = Math.floor(tP/dt);
    const sTick = Math.floor(tS/dt);

    document.getElementById(`dist-${idx}`).textContent = `R=${R.toFixed(1)} km`;
    return {
      st, idx, R,
      pTick, sTick,
      tick: 0,
      series: Array(bufferN).fill(0),
      amax: 0,
      fired:false,
      done:false,

      // IMPORTANT FIX: store absolute pick ticks (not buffer index)
      pPickAbsTick: -1,
      sPickAbsTick: -1
    };
  });

  const order = [...stSim].sort((a,b)=>a.pTick-b.pTick).map(x=>`${x.st.code}(P@${x.pTick})`).join(" → ");
  logLine(`MOVEOUT ORDER: ${order}`, "warn");

  function pushSample(sim, val){
    sim.series.shift();
    sim.series.push(val);
  }

  function updateWavefront(tSec){
    pCircle.setRadius((tSec*vp)*1000);
    sCircle.setRadius((tSec*vs)*1000);
  }

  function pickingComplete(){
    return stSim.every(s => s.pPickAbsTick >= 0);
  }

  let globalTick = 0;
  const maxTicks = Math.max(...stSim.map(x=>x.sTick)) + 220;

  const interval = setInterval(()=>{
    globalTick += 1;
    const tSec = globalTick * dt;
    updateWavefront(tSec);

    stSim.forEach(sim=>{
      sim.tick += 1;

      // base noise
      let x = gaussianNoise(0, 0.08);

      // moveout arrivals
      if(sim.tick >= sim.pTick){
        if(!sim.fired){
          sim.fired = true;
          setBadgeState(sim.idx, "fired");
          stMarkers[sim.idx].getElement().classList.add('hot');
          logLine(`P ARRIVAL: ${sim.st.code} reached (tick=${sim.tick})`, "warn");
        }
        x += 0.75 * wavelet(sim.tick - sim.pTick, 0.22);
      }
      if(sim.tick >= sim.sTick){
        x += 1.05 * wavelet(sim.tick - sim.sTick, 0.16);
      }

      sim.amax = Math.max(sim.amax, Math.abs(x));
      x = clamp(x, -1.6, 1.6);
      pushSample(sim, x);

      // probability at current tick (teaching)
      const pProb = clamp(0.04 + 0.96*probBump(sim.tick, sim.pTick, 7) + gaussianNoise(0,0.02), 0, 1);
      const sProb = clamp(0.04 + 0.96*probBump(sim.tick, sim.sTick, 9) + gaussianNoise(0,0.02), 0, 1);

      // IMPORTANT FIX: pick is the first time current probability crosses threshold
      if(sim.pPickAbsTick < 0 && pProb >= (+pThresh.value)){
        sim.pPickAbsTick = sim.tick;
      }
      if(sim.sPickAbsTick < 0 && sProb >= (+sThresh.value)){
        sim.sPickAbsTick = sim.tick;
      }

      // station done when P picked
      if(sim.pPickAbsTick >= 0 && !sim.done){
        sim.done = true;
        setBadgeState(sim.idx, "active");
        charts[sim.idx].data.datasets[0].borderColor = 'rgba(10,255,10,.85)';
        charts[sim.idx].update('none');
        logLine(`PICKING: ${sim.st.code} Phase Picking success (P@${sim.pPickAbsTick}).`, "good");
      }

      // display picks in seconds (more meaningful for beginners)
      const pStr = sim.pPickAbsTick>=0 ? `P=${(sim.pPickAbsTick*dt).toFixed(2)}s` : "P=--";
      const sStr = sim.sPickAbsTick>=0 ? `S=${(sim.sPickAbsTick*dt).toFixed(2)}s` : "S=--";
      document.getElementById(`pick-${sim.idx}`).textContent = `${pStr} | ${sStr}`;

      // update chart
      const c = charts[sim.idx];
      c.data.datasets[0].data = sim.series;
      c.update('none');
    });

    // finish after picking complete + some trailing frames
    if(pickingComplete() && globalTick > Math.min(maxTicks, 320)){
      clearInterval(interval);

      mvStatus.textContent = "DONE";
      sysStatus.className = "ok mono";
      sysStatus.textContent = "MONITORING";

      logLine("PIPELINE: picking complete. Running association + location…", "warn");

      // Location using absolute picks (fixed)
      const sol = locateByGrid_PicksAbs(stSim, dt, vp);
      if(sol){
        showSolution(sol, stSim);
      }else{
        logLine("LOCATION FAILED: insufficient picks.", "bad");
      }

      // remove circles after reveal
      setTimeout(()=>{
        if(pCircle){ map.removeLayer(pCircle); pCircle=null; }
        if(sCircle){ map.removeLayer(sCircle); sCircle=null; }
      }, 900);

      btnTrigger.disabled = false;
      running = false;
      return;
    }

    if(globalTick >= maxTicks){
      clearInterval(interval);
      btnTrigger.disabled = false;
      running = false;
      sysStatus.className = "bad mono";
      sysStatus.textContent = "TIMEOUT";
      mvStatus.textContent = "STOP";
      logLine("TIMEOUT: simulation ended.", "bad");
    }
  }, 30);

});
