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
// a smooth "quake" wavelet (teaching-friendly)
function wavelet(dt, f=0.18){
  return Math.sin(2*Math.PI*f*dt) * Math.exp(-0.06*dt);
}
// probability bump
function probBump(t, t0, w=7){
  const x = (t-t0)/w;
  return Math.exp(-0.5*x*x);
}
function firstCross(arr, thr){
  for(let i=0;i<arr.length;i++) if(arr[i]>=thr) return i;
  return -1;
}

// =====================================================
// UI helpers: Event log
// =====================================================
const eventLog = document.getElementById('eventLog');
function logLine(text, cls=""){
  const div = document.createElement('div');
  div.className = `line ${cls}`;
  div.textContent = text;
  eventLog.appendChild(div);
  eventLog.scrollTop = eventLog.scrollHeight;
}
function clearLog(){ eventLog.innerHTML = ""; }

// =====================================================
// Map setup
// =====================================================
const map = L.map('map', {zoomControl:false}).setView([24.2, 121.6], 9);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  maxZoom: 12, opacity: 0.9
}).addTo(map);

// Stations (you can replace codes/coords later)
const stations = [
  { id:0, code:"HUAL", lat:23.98, lon:121.60 },
  { id:1, code:"NACB", lat:24.45, lon:121.75 },
  { id:2, code:"SSLB", lat:23.90, lon:120.95 }
];

// Marker icons
const stMarkers = [];
stations.forEach(st=>{
  const icon = L.divIcon({ className:'station-marker', html:'▲', iconSize:[20,20], iconAnchor:[10,10] });
  const m = L.marker([st.lat, st.lon], {icon}).addTo(map);
  stMarkers.push(m);
});

// Layers
let epiTrueMarker = null;   // hidden during moveout, show later
let epiSolveMarker = null;
let pCircle = null, sCircle = null;
let lines = [];
let errCircle = null;

// =====================================================
// Charts: streaming waveforms (moveout animation)
// =====================================================
function mkWaveChart(canvasId){
  const ctx = document.getElementById(canvasId).getContext('2d');
  return new Chart(ctx, {
    type: 'line',
    data: {
      labels: Array.from({length: 260}, (_,i)=>i),
      datasets: [{
        data: Array(260).fill(0),
        borderColor: 'rgba(255,255,255,0.22)',
        borderWidth: 1.6,
        pointRadius: 0,
        tension: 0.25
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      scales: {
        x: {display:false},
        y: {display:false, min:-1.8, max:1.8}
      },
      plugins: { legend: {display:false}, tooltip: {enabled:false} }
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

// Wave UI
function setBadgeState(i, state){
  const badge = document.getElementById(`badge-${i}`);
  badge.classList.remove('active','fired');
  if(state==="fired") badge.classList.add('fired');
  if(state==="active") badge.classList.add('active');
}

// Reset everything
function resetAll(){
  // UI status
  sysStatus.className = "ok mono";
  sysStatus.textContent = "ONLINE";
  mvStatus.textContent = "READY";

  // badges & marker effects
  for(let i=0;i<3;i++){
    setBadgeState(i, "");
    stMarkers[i].getElement().classList.remove('hot');
    document.getElementById(`dist-${i}`).textContent = "R=-- km";
    document.getElementById(`pick-${i}`).textContent = "P=-- | S=--";
  }

  // clear charts
  charts.forEach(c=>{
    c.data.datasets[0].data = Array(260).fill(0);
    c.data.datasets[0].borderColor = 'rgba(255,255,255,0.22)';
    c.update('none');
  });

  // clear log + result panel
  clearLog();
  document.getElementById('loc-result').style.display = 'none';

  // clear map layers
  if(epiTrueMarker){ map.removeLayer(epiTrueMarker); epiTrueMarker=null; }
  if(epiSolveMarker){ map.removeLayer(epiSolveMarker); epiSolveMarker=null; }
  if(pCircle){ map.removeLayer(pCircle); pCircle=null; }
  if(sCircle){ map.removeLayer(sCircle); sCircle=null; }
  if(errCircle){ map.removeLayer(errCircle); errCircle=null; }
  lines.forEach(l=> map.removeLayer(l));
  lines = [];
}

// Star icon
function mkStarIcon(){
  return L.divIcon({ className:'quake-star', html:'★', iconSize:[44,44], iconAnchor:[22,22] });
}

// =====================================================
// Core simulation: TRIGGER EQ
// =====================================================
// We simulate a true epicenter; hide it during moveout;
// after picking is done, solve epicenter (grid-search demo) and show star + lines.
let running = false;

btnTrigger.addEventListener('click', ()=>{
  if(running) return;
  running = true;
  btnTrigger.disabled = true;

  resetAll();

  sysStatus.className = "mono";
  sysStatus.innerHTML = "<span style='color:#ff2a2a; animation:blink .6s infinite'>DETECTING...</span>";
  mvStatus.textContent = "RUNNING";

  // Choose a true epicenter near east Taiwan (random, but stable region)
  const epiTrue = {
    lat: 24.06 + (Math.random()*0.28 - 0.14),
    lon: 121.88 + (Math.random()*0.28 - 0.12)
  };

  // Wavefront circles (start immediately)
  if(pCircle) map.removeLayer(pCircle);
  if(sCircle) map.removeLayer(sCircle);
  pCircle = L.circle([epiTrue.lat, epiTrue.lon], {radius:0, color:'#00f3ff', fillOpacity:0.06, weight:1}).addTo(map);
  sCircle = L.circle([epiTrue.lat, epiTrue.lon], {radius:0, color:'#ff2a2a', fillOpacity:0.04, weight:1}).addTo(map);

  logLine("INIT: Event injected. Simulating wave propagation…", "warn");

  // Travel time model (teaching version)
  const vp = 6.0;  // km/s
  const vs = 3.5;  // km/s
  const dt = 0.05; // sec per tick
  const bufferN = 260;

  // Per station parameters
  const stSim = stations.map((st, idx)=>{
    const R = havKm(st.lat, st.lon, epiTrue.lat, epiTrue.lon);
    const tP = R / vp; // sec
    const tS = R / vs; // sec
    // convert to ticks
    const pTick = Math.floor(tP / dt);
    const sTick = Math.floor(tS / dt);

    document.getElementById(`dist-${idx}`).textContent = `R=${R.toFixed(1)} km`;
    return {
      st, idx, R,
      pTick, sTick,
      tick: 0,
      pickedP: -1,
      pickedS: -1,
      pProb: Array(bufferN).fill(0),
      sProb: Array(bufferN).fill(0),
      amax: 0,
      fired:false,
      done:false,
      series: Array(bufferN).fill(0)
    };
  });

  // show sorted moveout order in log
  const order = [...stSim].sort((a,b)=>a.pTick-b.pTick).map(x=>`${x.st.code}(P@${x.pTick})`).join(" → ");
  logLine(`MOVEOUT ORDER: ${order}`, "warn");

  // animation counters
  let globalTick = 0;
  const maxTicks = Math.max(...stSim.map(x=>x.sTick)) + 160; // after S arrivals settle

  // small helper for "streaming" trace
  function pushSample(sim, val){
    sim.series.shift();
    sim.series.push(val);
  }

  // Compute simplified pick using threshold crossing of probability
  function updatePicks(sim){
    const pT = +pThresh.value;
    const sT = +sThresh.value;
    if(sim.pickedP < 0){
      const idx = firstCross(sim.pProb, pT);
      if(idx >= 0){
        sim.pickedP = idx;
      }
    }
    if(sim.pickedS < 0){
      const idx = firstCross(sim.sProb, sT);
      if(idx >= 0){
        sim.pickedS = idx;
      }
    }
  }

  // render station UI
  function renderStation(sim){
    const c = charts[sim.idx];
    c.data.datasets[0].data = sim.series;
    c.update('none');

    const pickEl = document.getElementById(`pick-${sim.idx}`);
    const pStr = sim.pickedP>=0 ? `P=${sim.pickedP}` : "P=--";
    const sStr = sim.pickedS>=0 ? `S=${sim.pickedS}` : "S=--";
    pickEl.textContent = `${pStr} | ${sStr}`;
  }

  // map wavefront animation
  function updateWavefront(tSec){
    const pRadKm = tSec * vp;
    const sRadKm = tSec * vs;
    pCircle.setRadius(pRadKm*1000);
    sCircle.setRadius(sRadKm*1000);
  }

  // phase picking “success” definition: got P pick for all 3 stations
  function pickingComplete(){
    return stSim.every(s => s.pickedP >= 0);
  }

  // Association: in this demo, if we have P picks for all 3, we associate into 1 event
  function associationComplete(){
    return pickingComplete();
  }

  // Location: grid-search demo using P picks (relative)
  function locateByGrid(stSim){
    // We locate using P pick times, assuming tPick = t0 + R/vp
    // Our pick index is in ticks; convert to seconds:
    const picks = stSim.map(s=>({st:s.st, tPick: s.pickedP*dt})).filter(p=>p.tPick>=0);
    if(picks.length < 2) return null;

    // grid box around Taiwan (focus east)
    const box = { latMin: 23.6, latMax: 24.8, lonMin: 120.7, lonMax: 122.4 };
    let best = {misfit: Infinity, lat:null, lon:null, t0:null};

    for(let lat=box.latMin; lat<=box.latMax; lat+=0.02){
      for(let lon=box.lonMin; lon<=box.lonMax; lon+=0.02){
        // estimate t0 from average
        const t0s = picks.map(p=>{
          const R = havKm(p.st.lat, p.st.lon, lat, lon);
          return p.tPick - (R/vp);
        });
        const t0 = t0s.reduce((a,b)=>a+b,0)/t0s.length;

        // misfit SSE
        let ss = 0;
        for(const p of picks){
          const R = havKm(p.st.lat, p.st.lon, lat, lon);
          const pred = t0 + (R/vp);
          const r = (p.tPick - pred);
          ss += r*r;
        }
        if(ss < best.misfit){
          best = {misfit:ss, lat, lon, t0};
        }
      }
    }
    return best;
  }

  // Magnitude: demo regression on Amax + distance
  function estimateML(stSim, lat, lon){
    // toy formula (teaching): ML ≈ log10(A) + 1.1*log10(R) + 0.003*R + 2.0
    const vals = stSim.map(s=>{
      const R = Math.max(1, havKm(s.st.lat, s.st.lon, lat, lon));
      const A = Math.max(1e-3, s.amax);
      return Math.log10(A) + 1.10*Math.log10(R) + 0.003*R + 2.0;
    });
    return vals.reduce((a,b)=>a+b,0)/vals.length;
  }

  // Finalize: show star + association lines + solution panel
  function showSolution(sol){
    // Show solved star
    epiSolveMarker = L.marker([sol.lat, sol.lon], {icon: mkStarIcon()}).addTo(map);

    // Error circle (toy)
    const errKm = clamp(Math.sqrt(sol.misfit)*35, 4, 45);
    errCircle = L.circle([sol.lat, sol.lon], {radius: errKm*1000, color:'#ff2a2a', fillOpacity:0.08, weight:1}).addTo(map);

    // Lines
    stSim.forEach(s=>{
      const line = L.polyline([[s.st.lat, s.st.lon],[sol.lat, sol.lon]], {color:'#ff2a2a', dashArray:'6,6', weight:1}).addTo(map);
      lines.push(line);
    });

    // magnitude + panel
    const ml = estimateML(stSim, sol.lat, sol.lon);

    document.getElementById('loc-result').style.display = 'block';
    document.getElementById('res-loc').textContent = `${sol.lat.toFixed(2)}°N, ${sol.lon.toFixed(2)}°E`;
    document.getElementById('res-dep').textContent = `~12 km (demo)`;
    document.getElementById('res-mag').textContent = `M ${ml.toFixed(1)} (ML demo)`;

    logLine("ASSOCIATION: linked 3 stations into 1 event.", "good");
    logLine("LOCATION: epicenter solved (grid-search demo).", "good");
    logLine("MAG: estimated via local regression (demo).", "good");
  }

  // The animation loop (streaming traces)
  const interval = setInterval(()=>{
    globalTick += 1;
    const tSec = globalTick * dt;

    // update wavefront
    updateWavefront(tSec);

    // for each station, generate next sample
    stSim.forEach(sim=>{
      sim.tick += 1;

      // baseline noise
      let x = gaussianNoise(0, 0.08);

      // "moveout": event arrives at different ticks
      if(sim.tick >= sim.pTick){
        // when P arrives, station gets highlighted
        if(!sim.fired){
          sim.fired = true;
          setBadgeState(sim.idx, "fired");
          stMarkers[sim.idx].getElement().classList.add('hot');
          logLine(`P ARRIVAL: ${sim.st.code} reached (tick=${sim.tick})`, "warn");
        }

        // add P wavelet (smaller)
        x += 0.75 * wavelet(sim.tick - sim.pTick, 0.22);
      }
      if(sim.tick >= sim.sTick){
        // add S wavelet (bigger)
        x += 1.05 * wavelet(sim.tick - sim.sTick, 0.16);
      }

      // update amax for magnitude (after P)
      sim.amax = Math.max(sim.amax, Math.abs(x));

      // keep trace smooth & normalized-ish
      x = clamp(x, -1.6, 1.6);
      pushSample(sim, x);

      // build probability functions (teaching version)
      // P_prob peaks around pTick, S_prob peaks around sTick
      // We store for the same buffer length as trace for picking threshold
      sim.pProb.shift();
      sim.sProb.shift();
      const p = clamp(0.04 + 0.96*probBump(sim.tick, sim.pTick, 7) + gaussianNoise(0,0.02), 0, 1);
      const s = clamp(0.04 + 0.96*probBump(sim.tick, sim.sTick, 9) + gaussianNoise(0,0.02), 0, 1);
      sim.pProb.push(p);
      sim.sProb.push(s);

      // picking logic: threshold crossing inside the probability buffer
      updatePicks(sim);

      // if picked, turn station green
      if(sim.pickedP >= 0 && !sim.done){
        sim.done = true;
        setBadgeState(sim.idx, "active");

        // waveform line goes green (picking success)
        charts[sim.idx].data.datasets[0].borderColor = 'rgba(10,255,10,.85)';
        charts[sim.idx].update('none');

        logLine(`PICKING: ${sim.st.code} Phase Picking success.`, "good");
      }

      renderStation(sim);
    });

    // once all picked, we can finish moveout, associate + locate
    if(pickingComplete()){
      mvStatus.textContent = "DONE";
      sysStatus.className = "ok mono";
      sysStatus.textContent = "MONITORING";

      // stop streaming after some additional ticks for dramatic effect
      if(globalTick > Math.min(maxTicks, 260)){
        clearInterval(interval);

        logLine("PIPELINE: picking complete. Running association + location…", "warn");

        // association (demo always succeeds after picks)
        if(associationComplete()){
          // compute solution
          const sol = locateByGrid(stSim);
          if(sol){
            // show star + lines AFTER pipeline
            showSolution(sol);
            // camera focus
            map.setView([sol.lat, sol.lon], 9);

            // “Reveal” star timing: (already added), also remove circles after reveal for cleanliness
            setTimeout(()=>{
              if(pCircle) { map.removeLayer(pCircle); pCircle=null; }
              if(sCircle) { map.removeLayer(sCircle); sCircle=null; }
            }, 900);
          }else{
            logLine("LOCATION FAILED: insufficient picks.", "bad");
          }
        }

        btnTrigger.disabled = false;
        running = false;
      }
    }

    // hard stop safeguard
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
