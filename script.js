// --- 物理常數 ---
const P_WAVE_VELOCITY = 6.0; // km/s (稍微調慢一點以便視覺觀察)
const S_WAVE_VELOCITY = 3.5; // km/s
const TIME_SCALE = 2.0;      // 時間加速倍率 (1秒模擬 = X秒真實)

// --- 測站資料 (經緯度) ---
// Hualien, Yilan, Nantou
const stations = [
    { id: 0, code: "TW.HUAL", lat: 23.98, lon: 121.60, triggered: false },
    { id: 1, code: "TW.NACB", lat: 24.45, lon: 121.75, triggered: false },
    { id: 2, code: "TW.SSLB", lat: 23.90, lon: 120.95, triggered: false }
];

// 震央 (花蓮外海)
const epicenter = { lat: 24.15, lon: 121.90 };

// --- 初始化地圖 ---
const map = L.map('map', {
    zoomControl: false, 
    attributionControl: false,
    scrollWheelZoom: false,
    doubleClickZoom: false
}).setView([24.1, 121.6], 9);

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 12, opacity: 0.8
}).addTo(map);

// 建立測站 Marker (初始為灰色)
const stationMarkers = [];
const stationIconHtml = `<svg width="30" height="30" viewBox="0 0 40 40"><polygon points="20,5 35,35 5,35" fill="#0aff0a" stroke="#fff" stroke-width="2"/></svg>`;

stations.forEach((st, index) => {
    const icon = L.divIcon({
        className: 'station-icon-normal', // CSS Class 控制顏色
        html: stationIconHtml,
        iconSize: [30, 30],
        iconAnchor: [15, 15]
    });
    const marker = L.marker([st.lat, st.lon], {icon: icon}).addTo(map);
    stationMarkers[index] = marker; // 存起來之後改樣式
});

// --- 初始化 Chart.js ---
const charts = [];
const waveBuffers = [[], [], []]; // 每個測站的波形數據緩存

for (let i = 0; i < 3; i++) {
    const ctx = document.getElementById(`chart-${i}`).getContext('2d');
    charts[i] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: Array.from({length: 200}, (_,k)=>k), // 固定視窗寬度
            datasets: [{
                data: Array(200).fill(0), // 初始全平
                borderColor: '#444', // 未觸發時顏色暗淡
                borderWidth: 1,
                pointRadius: 0,
                tension: 0.4
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, animation: false,
            scales: { x: {display: false}, y: {display: false, min: -2, max: 2} },
            plugins: { legend: {display: false} }
        }
    });
}

// --- 輔助：物理波形生成器 ---
function getSeismicValue(timeSinceTrigger, distance) {
    // 簡單的合成波：S波到達後振幅變大
    const pTime = distance / P_WAVE_VELOCITY;
    const sTime = distance / S_WAVE_VELOCITY;
    
    let amp = (Math.random()-0.5) * 0.1; // 背景雜訊
    
    if (timeSinceTrigger > pTime) {
        // P波段
        amp += Math.sin((timeSinceTrigger-pTime)*15) * 0.5 * Math.exp(-(timeSinceTrigger-pTime)*0.5);
    }
    if (timeSinceTrigger > sTime) {
        // S波段 (大振幅)
        amp += Math.sin((timeSinceTrigger-sTime)*8) * 1.5 * Math.exp(-(timeSinceTrigger-sTime)*0.2);
    }
    return amp;
}

// --- 核心：動畫控制變數 ---
let simulationTime = 0;
let isRunning = false;
let pWaveCircle = null;
let sWaveCircle = null;
let epicenterMarker = null;
let animationFrameId = null;
const startTime = Date.now();

// --- 介面元素 ---
const btnSimulate = document.getElementById('btn-simulate');
const logBox = document.getElementById('log-output');
const feedStatus = document.getElementById('feed-status');

function log(msg) {
    logBox.innerHTML += `<div>> ${msg}</div>`;
    logBox.scrollTop = logBox.scrollHeight;
}

// --- 開始模擬 ---
btnSimulate.addEventListener('click', () => {
    if(isRunning) return;
    isRunning = true;
    btnSimulate.disabled = true;
    
    log("EARTHQUAKE DETECTED!", "#ff2a2a");
    feedStatus.innerHTML = "<span style='color:#ff2a2a; animation:blink 0.5s infinite'>CRITICAL</span>";
    document.querySelector('.map-hud').style.display = 'block';

    // 1. 繪製震央 (Star)
    const starIcon = L.divIcon({
        className: 'epicenter-pulse',
        html: '<svg width="50" height="50" viewBox="0 0 50 50"><path d="M25 2 L32 18 L50 18 L36 29 L41 46 L25 36 L9 46 L14 29 L0 18 L18 18 Z" fill="#ff2a2a" stroke="#fff" stroke-width="2"/></svg>',
        iconSize: [50, 50],
        iconAnchor: [25, 25]
    });
    epicenterMarker = L.marker([epicenter.lat, epicenter.lon], {icon: starIcon}).addTo(map);

    // 2. 初始化波前圓圈 (半徑 0)
    // P波 (藍色/綠色, 快)
    pWaveCircle = L.circle([epicenter.lat, epicenter.lon], {
        radius: 0,
        className: 'p-wave-circle', // 用 CSS 設定樣式
        color: '#00f3ff', fillColor: '#00f3ff', fillOpacity: 0.1, weight: 1
    }).addTo(map);

    // S波 (紅色, 慢, 破壞力強)
    sWaveCircle = L.circle([epicenter.lat, epicenter.lon], {
        radius: 0,
        className: 's-wave-circle',
        color: '#ff2a2a', fillColor: '#ff2a2a', fillOpacity: 0.2, weight: 2
    }).addTo(map);

    // 3. 啟動 Game Loop
    let lastTime = Date.now();
    
    function loop() {
        const now = Date.now();
        const dt = (now - lastTime) / 1000; // 經過秒數
        lastTime = now;
        simulationTime += dt * TIME_SCALE; // 加速模擬

        // A. 更新圓圈半徑 (km -> meters)
        const pRadiusKm = simulationTime * P_WAVE_VELOCITY;
        const sRadiusKm = simulationTime * S_WAVE_VELOCITY;
        
        pWaveCircle.setRadius(pRadiusKm * 1000);
        sWaveCircle.setRadius(sRadiusKm * 1000);

        // 更新左側面板數值
        document.getElementById('feed-p-rad').innerText = pRadiusKm.toFixed(1) + " km";
        document.getElementById('feed-s-rad').innerText = sRadiusKm.toFixed(1) + " km";

        // B. 碰撞檢測 (Collision Detection)
        stations.forEach((st, idx) => {
            // 計算震央到測站距離 (Leaflet 自帶 distance 方法，單位 meters)
            const distMeters = map.distance([epicenter.lat, epicenter.lon], [st.lat, st.lon]);
            
            // 判斷 P 波是否到達
            if (!st.triggered && (pRadiusKm * 1000) >= distMeters) {
                st.triggered = true;
                triggerStation(idx, st.code, distMeters/1000);
            }

            // 如果已觸發，持續更新波形圖
            if (st.triggered) {
                updateChart(idx, simulationTime, distMeters/1000);
            }
        });

        // 停止條件 (譬如跑了 30秒)
        if (simulationTime < 30) {
            animationFrameId = requestAnimationFrame(loop);
        } else {
            log("Simulation sequence ended.");
            btnSimulate.disabled = false;
        }
    }
    
    loop();
});

// --- 當波前掃到測站時觸發 ---
function triggerStation(index, code, distKm) {
    log(`Wavefront hit ${code} (Dist: ${distKm.toFixed(1)}km)`);
    
    // 1. 改變地圖圖示 (變亮)
    const marker = stationMarkers[index];
    const el = marker.getElement();
    if(el) {
        el.classList.remove('station-icon-normal');
        el.classList.add('station-icon-triggered'); // CSS 放大變亮
    }

    // 2. 改變側邊欄 Badge
    document.getElementById(`badge-${index}`).classList.add('station-active');

    // 3. 改變圖表顏色 (變亮)
    charts[index].data.datasets[0].borderColor = '#0aff0a'; // 變成螢光綠
    charts[index].data.datasets[0].borderWidth = 2;
}

// --- 更新圖表 (Shift Buffer) ---
function updateChart(index, time, distKm) {
    const chart = charts[index];
    // 計算當前振幅
    const amp = getSeismicValue(time, distKm);
    
    // 移除最舊的數據，加入新的
    const data = chart.data.datasets[0].data;
    data.shift();
    data.push(amp);
    
    chart.update('none'); // 高效能更新
}