// --- 參數設定 ---
const DURATION = 30; // 秒
const RATE = 50;     // Hz
const TOTAL_POINTS = DURATION * RATE;

// --- 測站與物理資料 (由 stations.json 驅動) ---
// 這裡我們直接寫入 JS 方便你測試，也可以讀取外部 json
const stationsData = [
    { code: "TW.HUAL", dist: 25, p_time: 4.5, s_time: 7.8, noise: 0.05, lat: 23.98, lon: 121.60 },
    { code: "TW.NACB", dist: 68, p_time: 11.2, s_time: 19.5, noise: 0.08, lat: 24.45, lon: 121.75 },
    { code: "TW.SSLB", dist: 85, p_time: 14.8, s_time: 25.2, noise: 0.06, lat: 23.90, lon: 120.95 }
];

// --- 1. 初始化地圖 ---
const map = L.map('map', {zoomControl: false}).setView([24.1, 121.4], 8);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 10, opacity: 0.9
}).addTo(map);

// 標示測站
const stationIcon = L.divIcon({
    className: 'custom-icon',
    html: '<svg width="20" height="20" viewBox="0 0 40 40"><polygon points="20,5 35,35 5,35" fill="#0aff0a" stroke="#fff" stroke-width="2"/></svg>',
    iconSize: [20, 20],
    iconAnchor: [10, 10]
});
const epiIcon = L.icon({
    iconUrl: 'assets/marker.svg',
    iconSize: [50, 50],
    iconAnchor: [25, 25]
});

stationsData.forEach(st => {
    L.marker([st.lat, st.lon], {icon: stationIcon}).addTo(map)
     .bindTooltip(st.code, {permanent: true, direction: 'right', offset: [10,0], opacity: 0.7});
});

// --- 2. 初始化 Chart.js (3個圖表) ---
const charts = [];
// 迴圈建立 chart-0, chart-1, chart-2
for (let i = 0; i < 3; i++) {
    const ctx = document.getElementById(`chart-${i}`).getContext('2d');
    charts[i] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: Array.from({length: TOTAL_POINTS}, (_, k) => k),
            datasets: [{
                data: [], 
                borderColor: '#66fcf1',
                borderWidth: 1.5,
                pointRadius: 0,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false, // 關閉動畫以提高效能
            scales: {
                x: { display: false, min: 0, max: TOTAL_POINTS },
                y: { display: false, min: -1.5, max: 1.5 }
            },
            plugins: { legend: { display: false } }
        }
    });
}

// --- 3. 物理波形產生器 ---
function generateWaveform(st) {
    const data = [];
    for (let i = 0; i < TOTAL_POINTS; i++) {
        const t = i / RATE; // 當前時間(秒)
        let amp = (Math.random() - 0.5) * st.noise; // 背景雜訊

        // P波到達
        if (t >= st.p_time) {
            let dt = t - st.p_time;
            // 模擬 P 波初動
            amp += Math.sin(2 * Math.PI * 6 * dt) * Math.exp(-dt*0.8) * 0.4;
        }

        // S波到達 (振幅更大)
        if (t >= st.s_time) {
            let dt = t - st.s_time;
            // 模擬 S 波劇烈晃動
            amp += Math.sin(2 * Math.PI * 3 * dt) * Math.exp(-dt*0.3) * 1.0;
        }
        
        // 截斷過大數值
        if(amp > 1.5) amp = 1.5;
        if(amp < -1.5) amp = -1.5;

        data.push(amp);
    }
    return data;
}

// 預先生成波形數據
const waveforms = stationsData.map(st => generateWaveform(st));

// --- 介面互動邏輯 ---
const btnLoad = document.getElementById('btn-load');
const btnPick = document.getElementById('btn-pick');
const btnLocate = document.getElementById('btn-locate');
const logBox = document.getElementById('log-output');

function log(msg, color='#fff') {
    logBox.innerHTML += `<div style="color:${color}">> ${msg}</div>`;
    logBox.scrollTop = logBox.scrollHeight;
}

// Step 1: 觸發波形
btnLoad.addEventListener('click', () => {
    btnLoad.disabled = true;
    log("Triggering network acquisition...", "#00f3ff");
    
    // 啟動掃描線動畫
    document.querySelectorAll('.scanning-bar').forEach(bar => bar.classList.add('scanning-active'));

    let currentIndex = 0;
    // 使用 setInterval 模擬資料流進入
    const timer = setInterval(() => {
        if (currentIndex >= TOTAL_POINTS) {
            clearInterval(timer);
            log("Data buffer full. Ready for AI.", "#0aff0a");
            btnPick.disabled = false;
            return;
        }

        // 同時更新三個圖表
        for (let i = 0; i < 3; i++) {
            // 每次塞入 10 個點 (加速顯示)
            const chunk = waveforms[i].slice(0, currentIndex);
            charts[i].data.datasets[0].data = chunk;
            charts[i].update('none'); // 'none' mode 極大提升效能
        }
        currentIndex += 10;
    }, 20);
});

// Step 2: AI 拾取
btnPick.addEventListener('click', () => {
    btnPick.disabled = true;
    log("Running RED-PAN inference on GPU...", "#ff2a2a");

    setTimeout(() => {
        // 模擬三個測站分別抓到 P/S 波
        stationsData.forEach((st, i) => {
            log(`[${st.code}] P:${st.p_time}s / S:${st.s_time}s (Conf: 0.98)`, "#0aff0a");
            // 變色表示已選取
            charts[i].data.datasets[0].borderColor = '#0aff0a'; 
            charts[i].update();
        });
        
        btnLocate.disabled = false;
    }, 1500);
});

// Step 3: 定位
btnLocate.addEventListener('click', () => {
    btnLocate.disabled = true;
    log("Calculating NonLinLoc solution...", "#00f3ff");

    setTimeout(() => {
        const epicenter = [24.05, 121.62]; // 花蓮外海
        
        // 1. 畫出三角測量線
        stationsData.forEach(st => {
            L.polyline([[st.lat, st.lon], epicenter], {
                color: '#ff2a2a', dashArray: '5,5', weight: 1, opacity: 0.8
            }).addTo(map);
        });

        // 2. 顯示震央
        L.marker(epicenter, {icon: epiIcon}).addTo(map)
         .bindPopup("<b>EPICENTER</b><br>M 5.9").openPopup();
        
        map.flyTo(epicenter, 9, {duration: 1.5});

        // 3. 更新數據顯示
        document.getElementById('val-time').innerText = "10:15:34.20";
        document.getElementById('val-depth').innerText = "12.4 km";
        document.getElementById('val-loc').innerText = "24.05°N, 121.62°E";
        document.getElementById('val-mag').innerText = "M 5.9";

        log("EVENT LOCATED: M5.9 Hualien Offshore", "#ff2a2a");
    }, 1000);
});