// ==========================================
// Part 1: Python 程式碼邏輯還原 (教學演示區)
// ==========================================

// 1. 高斯雜訊產生器 (模擬 np.random.normal)
function gaussianNoise(mean, stdev) {
    const u = 1 - Math.random(); 
    const v = Math.random();
    const z = Math.sqrt( -2.0 * Math.log( u ) ) * Math.cos( 2.0 * Math.PI * v );
    return z * stdev + mean;
}

// 2. 數據生成函數 (模擬 generate_synthetic_data)
function generateWaveform(isEarthquake, length = 100) {
    const data = [];
    const pTime = isEarthquake ? Math.floor(length * 0.3) : -1;
    
    for (let t = 0; t < length; t++) {
        // 背景雜訊
        let amp = gaussianNoise(0, 0.1);

        // 如果是地震，加入類似 Ricker wavelet 的訊號
        if (isEarthquake && t >= pTime) {
            const dt = t - pTime;
            // 數學公式: Sin * Exp decay (模擬 Python 程式碼中的訊號)
            const signal = Math.sin(0.5 * dt) * Math.exp(-0.05 * dt) * 1.5;
            amp += signal;
        }

        // 正規化 (模擬 Normalization) - 簡單截斷
        if (amp > 1) amp = 1;
        if (amp < -1) amp = -1;
        
        data.push(amp);
    }
    return data;
}

// 3. 圖表繪製 (Teaching Demo)
const ctxSample = document.getElementById('chart-sample').getContext('2d');
let sampleChart = new Chart(ctxSample, {
    type: 'line',
    data: {
        labels: Array.from({length: 100}, (_, i) => i),
        datasets: [{
            label: 'Waveform Amplitude',
            data: Array(100).fill(0),
            borderColor: '#555',
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.4
        }]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { min: -1.2, max: 1.2, display: false }, x: { display: false } },
        plugins: { legend: { display: false } }
    }
});

const btnGenSample = document.getElementById('btn-gen-sample');
const predResult = document.getElementById('prediction-result');

btnGenSample.addEventListener('click', () => {
    // 隨機決定產生地震波(1) 或 雜訊(0)
    const isQuake = Math.random() > 0.5;
    const waveData = generateWaveform(isQuake);
    
    // 更新圖表
    sampleChart.data.datasets[0].data = waveData;
    sampleChart.data.datasets[0].borderColor = isQuake ? '#ff0055' : '#555'; // 紅色代表有地震，灰色雜訊
    sampleChart.update();

    // 模擬 AI 預測結果 (Visualizing plot_results)
    // 這裡我們直接根據真實標籤給出高信心度，模擬訓練好的模型
    let prob = isQuake ? (0.95 + Math.random()*0.04) : (0.01 + Math.random()*0.1);
    let labelText = prob > 0.5 ? "EARTHQUAKE" : "NOISE";
    let color = (isQuake && prob > 0.5) || (!isQuake && prob <= 0.5) ? '#0aff0a' : 'red'; // 預測正確為綠色

    predResult.innerHTML = `AI Prediction: <span style="color:${color}">${labelText} (${(prob*100).toFixed(2)}%)</span>`;
});


// ==========================================
// Part 2: 多測站實戰模擬 (Leaflet + Moveout)
// ==========================================

// 1. 初始化地圖
const map = L.map('map').setView([24.2, 121.5], 9);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 12, attribution: '&copy; OpenStreetMap'
}).addTo(map);

// 2. 定義測站
const stations = [
    { code: 'HUAL', lat: 23.98, lon: 121.60, dist: 25 }, // 近
    { code: 'NACB', lat: 24.45, lon: 121.75, dist: 68 }, // 中
    { code: 'SSLB', lat: 23.90, lon: 120.95, dist: 85 }  // 遠
];

// 在地圖上畫測站
stations.forEach(st => {
    L.marker([st.lat, st.lon], {
        icon: L.divIcon({
            className: 'custom-icon',
            html: `<div style="color:#0aff0a; font-size:20px;">▲</div>`,
            iconSize: [20, 20], iconAnchor: [10, 10]
        })
    }).addTo(map).bindTooltip(st.code, {permanent: true, direction: 'right', offset:[10,0]});
});

// 3. 初始化三個波形圖
const waveCharts = [];
stations.forEach((st, i) => {
    const ctx = document.getElementById(`wave-${i}`).getContext('2d');
    waveCharts[i] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: Array.from({length: 150}, (_, k) => k),
            datasets: [{
                data: Array(150).fill(0),
                borderColor: '#3a86ff',
                borderWidth: 1,
                pointRadius: 0
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, animation: false,
            scales: { x: {display: false}, y: {display: false, min: -1.5, max: 1.5} },
            plugins: { legend: {display: false}, annotation: { annotations: {} } } // 需要 chartjs-plugin-annotation (這裡簡化用純繪圖)
        }
    });
});

// 4. 模擬流程控制
const btnTrigger = document.getElementById('btn-trigger-eq');
const sysStatus = document.getElementById('sys-status');
const detCount = document.getElementById('det-count');
const finalLoc = document.getElementById('final-loc');

let simulationRunning = false;

btnTrigger.addEventListener('click', () => {
    if(simulationRunning) return;
    simulationRunning = true;
    sysStatus.innerText = "PROCESSING...";
    sysStatus.style.color = "#ff0055";
    detCount.innerText = "0";
    finalLoc.innerText = "CALCULATING...";

    // 震央 (假設在花蓮外海)
    const epiLat = 24.1, epiLon = 121.9;
    
    // 1. 產生波形數據 (含時間差)
    stations.forEach((st, i) => {
        // 距離越遠，P波到達越晚 (簡單物理模擬: t = d / v)
        const pArrivalIndex = Math.floor(st.dist * 0.8) + 20; 
        const waveData = [];
        
        for(let t=0; t<150; t++) {
            let amp = gaussianNoise(0, 0.05);
            if(t >= pArrivalIndex) {
                let dt = t - pArrivalIndex;
                amp += Math.sin(0.4 * dt) * Math.exp(-0.03 * dt) * 1.2; // S波
            }
            waveData.push(amp);
        }

        // 動畫：逐步顯示波形
        let currentIdx = 0;
        const interval = setInterval(() => {
            if(currentIdx >= 150) {
                clearInterval(interval);
                // Step 1: Phase Picking 完成
                pickPhase(i, pArrivalIndex); 
            }
            const chunk = waveData.slice(0, currentIdx);
            // 補齊長度
            const displayData = chunk.concat(Array(150 - chunk.length).fill(null));
            waveCharts[i].data.datasets[0].data = displayData;
            waveCharts[i].update('none');
            currentIdx += 2;
        }, 20); // 速度
    });

    // 最後顯示結果
    setTimeout(() => {
        showLocationResult(epiLat, epiLon);
        simulationRunning = false;
        sysStatus.innerText = "MONITORING";
        sysStatus.style.color = "#0aff0a";
    }, 4000);
});

// 模擬 Step 1 & 2: 標記相位 + 關聯
function pickPhase(stationIdx, arrivalIdx) {
    // 改變波形顏色代表 "Picked" (RED-PAN)
    waveCharts[stationIdx].data.datasets[0].borderColor = '#0aff0a'; 
    waveCharts[stationIdx].update();
    
    let currentCount = parseInt(detCount.innerText);
    detCount.innerText = currentCount + 1;
}

// 模擬 Step 3 & 4: 定位與規模 (NonLinLoc + Mag)
function showLocationResult(lat, lon) {
    // 在地圖上畫出震央
    L.marker([lat, lon], {
        icon: L.divIcon({
            className: 'quake-icon',
            html: `<div style="font-size:30px; color:#ff0055; text-shadow:0 0 10px red;">★</div>`,
            iconSize: [30, 30], iconAnchor: [15, 15]
        })
    }).addTo(map)
    .bindPopup(`<b>EVENT DETECTED</b><br>Mag: 5.9 $M_L$<br>Depth: 12km`)
    .openPopup();

    // 畫虛線連接測站 (Association Visualization)
    stations.forEach(st => {
        L.polyline([[st.lat, st.lon], [lat, lon]], {
            color: '#ff0055', dashArray: '5, 5', weight: 1
        }).addTo(map);
    });

    finalLoc.innerText = "24.1°N, 121.9°E (M5.9)";
    finalLoc.style.color = "#ff0055";
}