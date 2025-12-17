// ==========================================
// PART 1: Python 邏輯模擬 (Section 1)
// ==========================================

// 1. 高斯雜訊 (模擬 np.random.normal)
function gaussianNoise(mean, stdev) {
    const u = 1 - Math.random(); 
    const v = Math.random();
    const z = Math.sqrt( -2.0 * Math.log( u ) ) * Math.cos( 2.0 * Math.PI * v );
    return z * stdev + mean;
}

// 2. 模擬 Python: generate_synthetic_data
// 包含: Ricker Wavelet 訊號 + 高斯雜訊 + 正規化
function getPythonWaveform(isEarthquake) {
    const length = 100;
    const data = [];
    const pTime = isEarthquake ? 30 : -1; // 假設在 index 30 訊號到達

    for(let t=0; t<length; t++) {
        // 背景雜訊
        let amp = gaussianNoise(0, 0.1);

        // 加入訊號
        if (isEarthquake && t >= pTime) {
            let dt = t - pTime;
            // Ricker-like 數學公式: (1 - 2*pi^2*f^2*t^2) * exp(...)
            // 這裡用簡化的 sin * exp 衰減波模擬
            let signal = Math.sin(0.6 * dt) * Math.exp(-0.1 * dt) * 1.5;
            amp += signal;
        }

        // 正規化 (Normalization): Clip between -1 and 1
        if(amp > 1) amp = 1;
        if(amp < -1) amp = -1;
        
        data.push(amp);
    }
    return data;
}

// 3. 圖表初始化
const ctxPython = document.getElementById('chart-python').getContext('2d');
const chartPython = new Chart(ctxPython, {
    type: 'line',
    data: {
        labels: Array.from({length: 100}, (_,i)=>i),
        datasets: [{
            data: Array(100).fill(0),
            borderColor: '#555',
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.4
        }]
    },
    options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        scales: { x: {display:false}, y: {display:false, min:-1.5, max:1.5} },
        plugins: { legend: {display:false} }
    }
});

// 4. 按鈕事件
const btnGen = document.getElementById('btn-gen-sample');
const resDisplay = document.getElementById('pred-result');

btnGen.addEventListener('click', () => {
    // 隨機決定是否有地震
    const isQuake = Math.random() > 0.5;
    const waveform = getPythonWaveform(isQuake);

    // 更新圖表
    chartPython.data.datasets[0].data = waveform;
    chartPython.data.datasets[0].borderColor = isQuake ? '#0aff0a' : '#ff2a2a'; // 綠色是有地震(波型明顯)，紅色是雜訊
    chartPython.update();

    // 模擬 AI 預測文字 (plot_results)
    // 如果是地震，給出高機率 (>0.9)，如果是雜訊，給低機率
    let prob = isQuake ? (0.9 + Math.random()*0.09) : (0.01 + Math.random()*0.1);
    let label = prob > 0.5 ? "EARTHQUAKE" : "NOISE";
    let color = (isQuake && prob > 0.5) || (!isQuake && prob <= 0.5) ? "#0aff0a" : "red";
    
    resDisplay.innerHTML = `AI PRED: <span style="color:${color}">${label} (${(prob*100).toFixed(1)}%)</span>`;
});


// ==========================================
// PART 2: 實戰模擬 (Section 3 - 核心互動)
// ==========================================

// 1. 地圖設定
const map = L.map('map', {zoomControl: false}).setView([24.2, 121.6], 9);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 12, opacity: 0.8
}).addTo(map);

// 2. 定義測站
const stations = [
    { id: 0, code: "HUAL", lat: 23.98, lon: 121.60, dist: 25 },
    { id: 1, code: "NACB", lat: 24.45, lon: 121.75, dist: 68 },
    { id: 2, code: "SSLB", lat: 23.90, lon: 120.95, dist: 85 }
];
const stMarkers = [];

// 在地圖畫測站
stations.forEach(st => {
    const icon = L.divIcon({
        className: 'station-marker',
        html: '▲',
        iconSize: [20, 20], iconAnchor: [10, 10]
    });
    const m = L.marker([st.lat, st.lon], {icon: icon}).addTo(map);
    stMarkers.push(m);
});

// 3. 初始化三個波形圖
const waveCharts = [];
for(let i=0; i<3; i++) {
    const ctx = document.getElementById(`chart-${i}`).getContext('2d');
    waveCharts[i] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: Array.from({length: 100}, (_,k)=>k),
            datasets: [{
                data: Array(100).fill(0),
                borderColor: '#444',
                borderWidth: 1,
                pointRadius: 0
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, animation: false,
            scales: { x:{display:false}, y:{display:false, min:-2, max:2} },
            plugins: { legend: {display:false} }
        }
    });
}

// 4. 動畫邏輯
const btnTrigger = document.getElementById('btn-trigger');
const waveRadDisplay = document.getElementById('wave-rad');
const sysStatus = document.getElementById('sys-status');
const locResultPanel = document.getElementById('loc-result');

// 圓圈圖層
let pCircle = null, sCircle = null, epiMarker = null, polyLines = [];
let isSimulating = false;

btnTrigger.addEventListener('click', () => {
    if(isSimulating) return;
    isSimulating = true;
    btnTrigger.disabled = true;
    
    // UI 重置
    sysStatus.innerHTML = "<span style='color:#ff2a2a; animation:blink 0.5s infinite'>DETECTING...</span>";
    locResultPanel.style.display = 'none';
    stMarkers.forEach(m => m.getElement().classList.remove('triggered'));
    document.querySelectorAll('.st-badge').forEach(b => b.classList.remove('active'));
    waveCharts.forEach(c => {
        c.data.datasets[0].data = Array(100).fill(0);
        c.data.datasets[0].borderColor = '#444';
        c.update();
    });

    // 震央 (花蓮外海)
    const epiLat = 24.15, epiLon = 121.90;
    
    // 1. 畫震央星號
    const starIcon = L.divIcon({
        className: 'quake-star', html: '★', iconSize:[40,40], iconAnchor:[20,20]
    });
    epiMarker = L.marker([epiLat, epiLon], {icon: starIcon}).addTo(map);

    // 2. 初始化圓圈
    if(pCircle) map.removeLayer(pCircle);
    if(sCircle) map.removeLayer(sCircle);
    polyLines.forEach(l => map.removeLayer(l));
    polyLines = [];

    pCircle = L.circle([epiLat, epiLon], {radius:0, color:'#00f3ff', fillOpacity:0.1}).addTo(map);
    sCircle = L.circle([epiLat, epiLon], {radius:0, color:'#ff2a2a', fillOpacity:0.1}).addTo(map);

    // 3. 動畫 Loop
    let time = 0;
    const speed = 5; // km per frame roughly
    const pSpeed = 6.0, sSpeed = 3.5;
    
    const interval = setInterval(() => {
        time += 0.1;
        const pRad = time * pSpeed * speed; // km
        const sRad = time * sSpeed * speed; // km
        
        // 更新 UI
        waveRadDisplay.innerText = pRad.toFixed(1) + " km";
        pCircle.setRadius(pRad * 1000);
        sCircle.setRadius(sRad * 1000);

        // 碰撞偵測 (Trigger)
        stations.forEach((st, idx) => {
            // 簡單距離判斷
            if (pRad >= st.dist && !st.triggered) {
                st.triggered = true;
                triggerStation(idx);
            }
        });

        // 結束條件
        if (time > 20) {
            clearInterval(interval);
            finishSimulation(epiLat, epiLon);
        }

    }, 30);
    
    // 重置觸發狀態供下次使用
    stations.forEach(st => st.triggered = false);
});

function triggerStation(idx) {
    // 1. 標記變亮
    stMarkers[idx].getElement().classList.add('triggered');
    document.getElementById(`badge-${idx}`).classList.add('active');

    // 2. 波形圖開始跳動 (模擬 Phase Picking)
    const chart = waveCharts[idx];
    chart.data.datasets[0].borderColor = '#0aff0a'; // 變綠
    
    // 產生一段震動數據
    const data = [];
    for(let i=0; i<100; i++) {
        let val = (Math.random()-0.5) * 0.2;
        if(i > 20) val += Math.sin((i-20)*0.5) * Math.exp(-(i-20)*0.05) * 1.5;
        data.push(val);
    }
    
    // 簡單動畫：慢慢畫出來
    let k = 0;
    const drawInt = setInterval(() => {
        if(k>=100) clearInterval(drawInt);
        chart.data.datasets[0].data[k] = data[k];
        chart.update('none');
        k++;
    }, 10);
}

function finishSimulation(lat, lon) {
    isSimulating = false;
    btnTrigger.disabled = false;
    sysStatus.innerHTML = "<span style='color:#0aff0a'>MONITORING</span>";
    
    // 顯示結果面板
    locResultPanel.style.display = 'block';
    document.getElementById('res-loc').innerText = "24.15°N, 121.90°E";
    document.getElementById('res-mag').innerText = "M 5.9";
    document.getElementById('res-dep').innerText = "12 km";

    // 畫連線 (Association)
    stations.forEach(st => {
        const line = L.polyline([[st.lat, st.lon], [lat, lon]], {
            color: '#ff2a2a', dashArray: '5,5', weight: 1
        }).addTo(map);
        polyLines.push(line);
    });
}