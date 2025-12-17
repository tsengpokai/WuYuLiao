// --- 初始化地圖 ---
const map = L.map('map').setView([23.97565, 120.9738819], 7); // 預設台灣中心
// 使用深色地圖底圖 (CartoDB Dark Matter)
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 19
}).addTo(map);

// --- 初始化 Chart.js ---
const ctx = document.getElementById('seismicChart').getContext('2d');
const seismicChart = new Chart(ctx, {
    type: 'line',
    data: {
        labels: [],
        datasets: [{
            label: 'Amplitude (Z)',
            data: [],
            borderColor: '#66fcf1',
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.1,
            fill: false
        }]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false, // 關閉預設動畫以獲得高效能即時感
        scales: {
            x: { display: false }, // 隱藏 X 軸
            y: { 
                grid: { color: '#333' },
                ticks: { color: '#888' }
            }
        },
        plugins: {
            legend: { display: false }
        }
    }
});

// --- 全域變數 ---
let fullWaveformData = []; // 儲存下載的完整波形
let pPickIndex = -1;
let sPickIndex = -1;

// --- 介面元素 ---
const btnLoad = document.getElementById('btn-load');
const btnPick = document.getElementById('btn-pick');
const btnLocate = document.getElementById('btn-locate');
const logBox = document.getElementById('log-output');

// --- 輔助函式: 寫入 Log ---
function log(msg) {
    const time = new Date().toLocaleTimeString('en-US', {hour12: false});
    logBox.innerHTML += `<div>[${time}] ${msg}</div>`;
    logBox.scrollTop = logBox.scrollHeight;
}

// --- STEP 1: 載入波形 ---
btnLoad.addEventListener('click', () => {
    btnLoad.disabled = true;
    log("Connecting to data server...");
    
    fetch('./data/waveform.json')
        .then(response => response.json())
        .then(jsonData => {
            log(`Station ${jsonData.station_code} connected.`);
            fullWaveformData = jsonData.data;
            pPickIndex = jsonData.annotations.p_arrival_index;
            sPickIndex = jsonData.annotations.s_arrival_index;
            
            // 重置圖表
            seismicChart.data.labels = fullWaveformData.map((_, i) => i);
            seismicChart.data.datasets[0].data = [];
            
            // 模擬即時串流效果 (動畫)
            let i = 0;
            const streamInterval = setInterval(() => {
                // 每次增加 5 點，加快顯示速度
                for(let j=0; j<5; j++) {
                    if(i < fullWaveformData.length) {
                        seismicChart.data.datasets[0].data.push(fullWaveformData[i]);
                        i++;
                    }
                }
                seismicChart.update();
                
                if (i >= fullWaveformData.length) {
                    clearInterval(streamInterval);
                    log("Waveform packet received completely.");
                    btnPick.disabled = false; // 開啟下一步
                    btnPick.classList.add('pulse-anim'); // 視覺提示
                }
            }, 10); // 更新頻率
        })
        .catch(err => {
            log("Error loading data: " + err);
            btnLoad.disabled = false;
        });
});

// --- STEP 2: AI 拾取 (RED-PAN) ---
btnPick.addEventListener('click', () => {
    btnPick.disabled = true;
    log("Running RED-PAN model inference...");
    
    setTimeout(() => {
        // 畫出 P 波線 (紅色)
        log(`P-phase detected at index ${pPickIndex} (Conf: 0.98)`);
        // 這裡我們直接修改圖表，加上垂直線標註 (利用 Annotation 概念，這裡用最簡單的方式：畫點)
        
        // 為了簡單展示，我們用 Plugin 畫線太複雜，我們直接在地圖下方 Log 顯示
        // 但為了視覺，我們可以改變該點的顏色 (Chart.js 進階技巧)，或是簡單的：
        // 這裡我們不改圖，直接進入下一步
        log(`S-phase detected at index ${sPickIndex} (Conf: 0.94)`);
        log("Phase association completed (GaMMA).");
        
        btnLocate.disabled = false;
    }, 800);
});

// --- STEP 3: 定位 (NonLinLoc) ---
btnLocate.addEventListener('click', () => {
    btnLocate.disabled = true;
    log("Executing NonLinLoc-SSST...");
    
    fetch('./data/events.json')
        .then(res => res.json())
        .then(events => {
            const evt = events[0]; // 拿第一筆示範
            
            setTimeout(() => {
                // 1. 更新數據面板
                document.getElementById('val-mag').innerText = evt.magnitude;
                document.getElementById('val-depth').innerText = evt.depth + " km";
                document.getElementById('val-conf').innerText = "98%";
                document.getElementById('val-phase').innerText = "12";
                document.getElementById('val-loc').innerText = `Lat: ${evt.lat}, Lon: ${evt.lon}`;
                
                // 2. 地圖飛到震央
                const epicenter = [evt.lat, evt.lon];
                map.flyTo(epicenter, 10, { duration: 2 });
                
                // 3. 加入震央 Icon
                const customIcon = L.icon({
                    iconUrl: 'assets/marker.svg',
                    iconSize: [40, 40],
                    iconAnchor: [20, 20],
                    popupAnchor: [0, -20]
                });
                
                L.marker(epicenter, {icon: customIcon})
                 .addTo(map)
                 .bindPopup(`<b>${evt.description}</b><br>M ${evt.magnitude}<br>Depth: ${evt.depth}km`)
                 .openPopup();
                 
                 log(`Event located: M${evt.magnitude} at ${evt.description}`);
            }, 1000);
        });
});