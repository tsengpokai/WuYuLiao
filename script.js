// =====================================================
// Utilities
// =====================================================
function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
function gaussianNoise(mean, stdev) {
  const u = 1 - Math.random();
  const v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return z * stdev + mean;
}

// Haversine distance (km)
function havKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Create a smooth "event" wavelet (Ricker-like demo)
function eventWave(dt, f=0.18) {
  // simple damped sinusoid (front-loaded)
  return Math.sin(2*Math.PI*f*dt) * Math.exp(-0.07*dt);
}

// Probability bump around pick
function probBump(t, t0, w=6) {
  const x = (t - t0) / w;
  return Math.exp(-0.5 * x * x);
}

// First index above threshold
function firstCross(prob, thr) {
  for (let i=0;i<prob.length;i++) if (prob[i] >= thr) return i;
  return -1;
}

// =====================================================
// PART 01: Data Lab (synthetic + augmentation controls)
// =====================================================
const ctxData = document.getElementById('chart-data').getContext('2d');
const chartData = new Chart(ctxData, {
  type: 'line',
  data: {
    labels: Array.from({length: 200}, (_,i)=>i),
    datasets: [{
      data: Array(200).fill(0),
      borderColor: '#555',
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.35
    }]
  },
  options: {
    responsive: true, maintainAspectRatio: false, animation: false,
    scales: { x: {display:false}, y: {display:false, min:-1.6, max:1.6} },
    plugins: { legend: {display:false} }
  }
});

const noiseSigma = document.getElementById('noiseSigma');
const vNoise = document.getElementById('v-noise');
const augSuper = document.getElementById('augSuper');
const augShift = document.getElementById('augShift');
const augClip = document.getElementById('augClip');
const btnGen = document.getElementById('btn-gen');
const dataBadge = document.getElementById('data-badge');

noiseSigma.addEventListener('input', ()=> vNoise.textContent = (+noiseSigma.value).toFixed(2));

function genSynthetic(length=200, sigma=0.10, hasEvent=true, t0=70) {
  const x = [];
  for (let t=0;t<length;t++) {
    let a = gaussianNoise(0, sigma);
    if (hasEvent && t>=t0) a += 1.2*eventWave(t-t0);
    x.push(a);
  }
  // normalize to [-1, 1]
  const maxAbs = Math.max(...x.map(v=>Math.abs(v))) || 1;
  return x.map(v => clamp(v / maxAbs, -1, 1));
}

function applyAugmentation(x) {
  let y = [...x];

  // time shift
  if (augShift.checked) {
    const shift = Math.floor((Math.random()*2 - 1) * 25); // [-25, 25]
    const tmp = Array(y.length).fill(0);
    for (let i=0;i<y.length;i++) {
      const j = i + shift;
      if (j>=0 && j<y.length) tmp[j] = y[i];
    }
    y = tmp;
  }

  // time clip (simulate missing window)
  if (augClip.checked) {
    const start = Math.floor(30 + Math.random()*80);
    const w = Math.floor(20 + Math.random()*30);
    for (let i=start;i<Math.min(y.length, start+w);i++) y[i] *= 0.05;
  }

  // superimpose another event
  if (augSuper.checked) {
    const has2 = Math.random() > 0.45;
    if (has2) {
      const t1 = Math.floor(40 + Math.random()*120);
      for (let t=0;t<y.length;t++) {
        if (t>=t1) y[t] += 0.55*eventWave(t-t1, 0.22);
      }
      const maxAbs = Math.max(...y.map(v=>Math.abs(v))) || 1;
      y = y.map(v => clamp(v / maxAbs, -1, 1));
    }
  }

  return y;
}

btnGen.addEventListener('click', () => {
  const sigma = +noiseSigma.value;
  const hasEvent = Math.random() > 0.45;
  const t0 = Math.floor(55 + Math.random()*50);
  let x = genSynthetic(200, sigma, hasEvent, t0);
  x = applyAugmentation(x);

  chartData.data.datasets[0].data = x;
  chartData.data.datasets[0].borderColor = hasEvent ? '#0aff0a' : '#ff2a2a';
  chartData.update();

  dataBadge.innerHTML = hasEvent
    ? `LABEL: <span style="color:#0aff0a">EVENT</span>`
    : `LABEL: <span style="color:#ff2a2a">NOISE</span>`;
});

// =====================================================
// PART 03: Live Pipeline (Picker → Association → Location → Magnitude)
// =====================================================

// Map
const map = L.map('map', {zoomControl: false}).setView([24.2, 121.6], 9);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  maxZoom: 12, opacity: 0.8
}).addTo(map);

// Stations (demo geometry)
const stations = [
  { id: 0, code: "HUAL", lat: 23.98, lon: 121.60 },
  { id: 1, code: "NACB", lat: 24.45, lon: 121.75 },
  { id: 2, code: "SSLB", lat: 23.90, lon: 120.95 }
];

// Markers
const stMarkers = [];
stations.forEach(st => {
  const icon = L.divIcon({ className:'station-marker', html:'▲', iconSize:[20,20], iconAnchor:[10,10] });
  stMarkers.push(L.marker([st.lat, st.lon], {icon}).addTo(map));
});

// Charts: waveform + probabilities
function mkLineChart(canvasId, yMin=-2, yMax=2, lineColor='#444') {
  const ctx = document.getElementById(canvasId).getContext('2d');
  return new Chart(ctx, {
    type: 'line',
    data: {
      labels: Array.from({length: 220}, (_,k)=>k),
      datasets: [{
        data: Array(220).fill(0),
        borderColor: lineColor,
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0.25
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      scales: { x:{display:false}, y:{display:false, min:yMin, max:yMax} },
      plugins: { legend: {display:false } }
    }
  });
}

const waveCharts = [ mkLineChart('chart-0'), mkLineChart('chart-1'), mkLineChart('chart-2') ];
const probPCharts = [
  mkLineChart('probP-0', 0, 1, '#00f3ff'),
  mkLineChart('probP-1', 0, 1, '#00f3ff'),
  mkLineChart('probP-2', 0, 1, '#00f3ff')
];
const probSCharts = [
  mkLineChart('probS-0', 0, 1, '#ff2a2a'),
  mkLineChart('probS-1', 0, 1, '#ff2a2a'),
  mkLineChart('probS-2', 0, 1, '#ff2a2a')
];

probPCharts.forEach(c => c.options.scales.y.min = 0);
probSCharts.forEach(c => c.options.scales.y.min = 0);

const btnTrigger = document.getElementById('btn-trigger');
const sysStatus = document.getElementById('sys-status');
const locResultPanel = document.getElementById('loc-result');

const pThresh = document.getElementById('pThresh');
const sThresh = document.getElementById('sThresh');
const thrP = document.getElementById('thrP');
const thrS = document.getElementById('thrS');

pThresh.addEventListener('input', ()=> thrP.textContent = (+pThresh.value).toFixed(2));
sThresh.addEventListener('input', ()=> thrS.textContent = (+sThresh.value).toFixed(2));

// Layers
let epiMarker = null;
let pCircle = null, sCircle = null;
let polyLines = [];
let errCircle = null;
let isSimulating = false;

// Association table
const assocBody = document.getElementById('assocBody');

function resetUI() {
  // status
  sysStatus.className = '';
  sysStatus.innerHTML = 'ONLINE';
  sysStatus.classList.add('ok');

  // hide result
  locResultPanel.style.display = 'none';

  // clear markers effect
  stMarkers.forEach(m => m.getElement().classList.remove('triggered'));
  document.querySelectorAll('.st-badge').forEach(b => b.classList.remove('active'));

  // clear charts
  waveCharts.forEach(c => {
    c.data.datasets[0].data = Array(220).fill(0);
    c.data.datasets[0].borderColor = '#444';
    c.update('none');
  });
  [...probPCharts, ...probSCharts].forEach(c => {
    c.data.datasets[0].data = Array(220).fill(0);
    c.update('none');
  });

  // clear table
  assocBody.innerHTML = '';

  // clear map layers
  if (epiMarker) { map.removeLayer(epiMarker); epiMarker = null; }
  if (pCircle) { map.removeLayer(pCircle); pCircle = null; }
  if (sCircle) { map.removeLayer(sCircle); sCircle = null; }
  if (errCircle) { map.removeLayer(errCircle); errCircle = null; }
  polyLines.forEach(l => map.removeLayer(l));
  polyLines = [];
}

function setDetecting() {
  sysStatus.className = '';
  sysStatus.innerHTML = "<span style='color:#ff2a2a; animation:blink 0.6s infinite'>DETECTING...</span>";
}

function mkStar() {
  return L.divIcon({ className:'quake-star', html:'★', iconSize:[40,40], iconAnchor:[20,20] });
}

// Generate per-station wave + probabilities + picks based on travel time
function synthStationRecord(st, epi, t0, vp=6.0, vs=3.5) {
  // travel time in samples (assume dt=0.05 s, and use km/s)
  const distKm = havKm(st.lat, st.lon, epi.lat, epi.lon);
  const dt = 0.05; // sec/sample (demo)
  const tp = (distKm / vp) / dt; // samples
  const ts = (distKm / vs) / dt;

  const n = 220;
  const sigma = 0.08 + Math.random()*0.04;
  const wave = [];
  for (let i=0;i<n;i++) {
    let a = gaussianNoise(0, sigma);
    // P onset
    if (i >= Math.floor(t0 + tp)) a += 0.9*eventWave(i - (t0 + tp), 0.20);
    // S onset larger amplitude
    if (i >= Math.floor(t0 + ts)) a += 1.3*eventWave(i - (t0 + ts), 0.16);
    wave.push(a);
  }
  // normalize
  const maxAbs = Math.max(...wave.map(v=>Math.abs(v))) || 1;
  const w = wave.map(v => clamp(v/maxAbs, -1.4, 1.4));

  // probability functions (simplified: bumps around true tp/ts + noise)
  const pProb = Array(n).fill(0).map((_,i)=> clamp(
    0.05 + 0.95*probBump(i, t0+tp, 7) + gaussianNoise(0, 0.02), 0, 1
  ));
  const sProb = Array(n).fill(0).map((_,i)=> clamp(
    0.05 + 0.95*probBump(i, t0+ts, 9) + gaussianNoise(0, 0.02), 0, 1
  ));

  // picks by threshold crossing
  const pPick = firstCross(pProb, +pThresh.value);
  const sPick = firstCross(sProb, +sThresh.value);

  // peak amplitude after P (demo)
  const post = w.slice(Math.max(0, pPick), n);
  const amax = post.length ? Math.max(...post.map(v=>Math.abs(v))) : Math.max(...w.map(v=>Math.abs(v)));

  return { distKm, w, pProb, sProb, pPick, sPick, amax };
}

// Simple association rule: if it has a valid P pick, include
function assocDecision(rec) {
  return rec.pPick >= 0;
}

// Location via grid search using P picks only (demo)
function locateByGrid(stRecs, epiGuessBox) {
  // epiGuessBox: {latMin, latMax, lonMin, lonMax}
  const dt = 0.05;
  const vp = 6.0;

  const picks = stRecs.filter(r => r.use).map(r => ({st:r.st, pPick:r.pPick}));
  if (picks.length < 2) return null;

  let best = {misfit: Infinity, lat:null, lon:null, tOrigin:null};

  for (let lat=epiGuessBox.latMin; lat<=epiGuessBox.latMax; lat+=0.02) {
    for (let lon=epiGuessBox.lonMin; lon<=epiGuessBox.lonMax; lon+=0.02) {

      // estimate origin sample t0 by minimizing residuals
      // tPick ≈ t0 + dist/vp/dt  => t0 ≈ tPick - distTerm
      const t0Candidates = picks.map(p => {
        const d = havKm(p.st.lat, p.st.lon, lat, lon);
        const distTerm = (d / vp) / dt;
        return p.pPick - distTerm;
      });
      const t0 = t0Candidates.reduce((a,b)=>a+b,0) / t0Candidates.length;

      // misfit
      let ss = 0;
      for (const p of picks) {
        const d = havKm(p.st.lat, p.st.lon, lat, lon);
        const pred = t0 + (d / vp) / dt;
        const res = (p.pPick - pred);
        ss += res*res;
      }
      if (ss < best.misfit) best = {misfit:ss, lat, lon, tOrigin:t0};
    }
  }
  return best;
}

// Magnitude demo (very simplified)
function estimateML(stRecs, hypoLat, hypoLon) {
  // ML ≈ log10(Amax) + a*log10(R) + b*R + c  (toy numbers)
  const used = stRecs.filter(r => r.use);
  if (!used.length) return null;

  const vals = used.map(r => {
    const R = Math.max(1, havKm(r.st.lat, r.st.lon, hypoLat, hypoLon));
    const A = Math.max(1e-3, r.amax);
    return Math.log10(A) + 1.10*Math.log10(R) + 0.003*R + 2.0;
  });
  const ml = vals.reduce((a,b)=>a+b,0) / vals.length;
  return ml;
}

function drawRecToUI(idx, rec) {
  // station badge
  document.getElementById(`badge-${idx}`).classList.add('active');
  stMarkers[idx].getElement().classList.add('triggered');

  // waveform
  waveCharts[idx].data.datasets[0].data = rec.w;
  waveCharts[idx].data.datasets[0].borderColor = '#0aff0a';
  waveCharts[idx].update('none');

  // probs
  probPCharts[idx].data.datasets[0].data = rec.pProb;
  probSCharts[idx].data.datasets[0].data = rec.sProb;
  probPCharts[idx].update('none');
  probSCharts[idx].update('none');
}

function renderAssocTable(stRecs) {
  assocBody.innerHTML = stRecs.map(r => {
    const p = r.pPick >= 0 ? `<strong>${r.pPick}</strong>` : '--';
    const s = r.sPick >= 0 ? `<strong>${r.sPick}</strong>` : '--';
    const use = r.use ? `<span class="ok">YES</span>` : `<span class="bad">NO</span>`;
    return `
      <tr>
        <td>${r.st.code}</td>
        <td>${p}</td>
        <td>${s}</td>
        <td>${r.amax.toFixed(2)}</td>
        <td>${use}</td>
      </tr>
    `;
  }).join('');
}

function showSolution(sol, stRecs) {
  // link lines (association visualization)
  polyLines.forEach(l => map.removeLayer(l));
  polyLines = [];
  stRecs.filter(r=>r.use).forEach(r => {
    const line = L.polyline([[r.st.lat, r.st.lon], [sol.lat, sol.lon]], {
      color: '#ff2a2a', dashArray:'6,6', weight: 1
    }).addTo(map);
    polyLines.push(line);
  });

  // error circle (toy: based on misfit)
  const errKm = clamp(Math.sqrt(sol.misfit)*1.6, 3, 30);
  if (errCircle) map.removeLayer(errCircle);
  errCircle = L.circle([sol.lat, sol.lon], {radius: errKm*1000, color:'#ff2a2a', fillOpacity:0.08}).addTo(map);

  // magnitude
  const ml = estimateML(stRecs, sol.lat, sol.lon);

  // UI panel
  locResultPanel.style.display = 'block';
  document.getElementById('res-loc').innerText = `${sol.lat.toFixed(2)}°N, ${sol.lon.toFixed(2)}°E`;
  document.getElementById('res-dep').innerText = `~12 km (demo)`;
  document.getElementById('res-mag').innerText = ml ? `M ${ml.toFixed(1)} (ML demo)` : '--';
}

btnTrigger.addEventListener('click', () => {
  if (isSimulating) return;
  isSimulating = true;
  btnTrigger.disabled = true;

  resetUI();
  setDetecting();

  // Demo epicenter (randomized near east Taiwan)
  const epi = {
    lat: 24.05 + (Math.random()*0.25 - 0.12),
    lon: 121.80 + (Math.random()*0.25 - 0.10),
  };

  // star
  epiMarker = L.marker([epi.lat, epi.lon], {icon: mkStar()}).addTo(map);

  // circles
  pCircle = L.circle([epi.lat, epi.lon], {radius:0, color:'#00f3ff', fillOpacity:0.08}).addTo(map);
  sCircle = L.circle([epi.lat, epi.lon], {radius:0, color:'#ff2a2a', fillOpacity:0.06}).addTo(map);

  // FIXED BUG: triggered state should be reset BEFORE loop
  stations.forEach(st => st.triggered = false);

  // synth records (one shot, then animate wavefront)
  const t0 = 20; // origin baseline in samples
  const stRecs = stations.map((st, idx) => {
    const rec = synthStationRecord(st, epi, t0);
    rec.st = st;
    rec.use = assocDecision(rec);
    drawRecToUI(idx, rec);
    return rec;
  });

  renderAssocTable(stRecs);

  // Animate wavefront (visual only)
  let time = 0;
  const speed = 8; // km/frame scaling
  const pSpeed = 6.0, sSpeed = 3.5;

  const interval = setInterval(() => {
    time += 0.08;
    const pRad = time * pSpeed * speed;
    const sRad = time * sSpeed * speed;

    pCircle.setRadius(pRad * 1000);
    sCircle.setRadius(sRad * 1000);

    // highlight station when P wavefront reaches distance (for teaching)
    stRecs.forEach((r, idx) => {
      if (!stations[idx].triggered && pRad >= r.distKm) {
        stations[idx].triggered = true;
        document.getElementById(`badge-${idx}`).classList.add('active');
        stMarkers[idx].getElement().classList.add('triggered');
      }
    });

    if (time > 6.0) {
      clearInterval(interval);

      // Locate using P picks (simplified grid)
      const sol = locateByGrid(
        stRecs,
        { latMin: 23.6, latMax: 24.7, lonMin: 120.7, lonMax: 122.3 }
      );

      sysStatus.className = '';
      if (sol) {
        sysStatus.innerHTML = 'MONITORING';
        sysStatus.classList.add('ok');
        showSolution(sol, stRecs);
      } else {
        sysStatus.innerHTML = 'INSUFFICIENT PICKS';
        sysStatus.classList.add('bad');
      }

      isSimulating = false;
      btnTrigger.disabled = false;
    }
  }, 30);
});
