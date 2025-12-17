# SEISYNC: AI-Driven Earthquake Monitoring Interface
### 全自動化地震監測系統前端展示

![Project Status](https://img.shields.io/badge/Status-Live_Demo-success)
![AI Model](https://img.shields.io/badge/AI_Model-RED--PAN-blue)
![License](https://img.shields.io/badge/License-MIT-lightgrey)

**SEISYNC** (Seismic Synchronization) 是一個整合深度學習與即時地震學的監測儀表板。本專案展示了從波形訊號輸入到震源參數解算的視覺化流程。

## 🚀 線上展示 (Live Demo)
👉 **[點擊這裡進入 SEISYNC 儀表板](https://你的帳號.github.io/seisync-live/)**

## 核心功能 (Core Modules)

本系統視覺化了以下四個自動化處理步驟 (Based on Liao et al.)：

1.  **Phase Picking (相位拾取)**: 
    - 使用 **RED-PAN** 模型自動偵測 P 波與 S 波到時。
    - 即時計算信心水準 (Confidence Level)。
2.  **Phase Association (相位關聯)**:
    - 整合 **GaMMA** 算法，將不同測站的訊號關聯至同一事件。
3.  **Source Location (震源定位)**:
    - 透過 **NonLinLoc-SSST** 進行高精度 3D 定位。
4.  **Magnitude Estimation (規模估計)**:
    - 快速計算 $M_L$ 規模與預估震度。

## 技術架構 (Tech Stack)

* **Frontend**: HTML5, CSS3 (Cyberpunk UI), JavaScript (ES6+)
* **Visualization**: 
    * `Chart.js`: 即時波形繪製與動態掃描。
    * `Leaflet.js`: 震央地圖視覺化。
* **Data Simulation**: JSON (模擬後端 API 回傳的地震波形與事件目錄)。

## 如何使用 (Usage)

1.  點擊 **"1. 載入波形數據"** 模擬從測站接收 SAC/MSEED 封包。
2.  觀察波形動態載入完畢後，點擊 **"2. AI 相位拾取"** 執行 RED-PAN 模擬。
3.  點擊 **"3. 震源定位"** 查看地圖上的震央位置與詳細參數。

---
*Based on the research "AI encounters Seismology" by Dr. Wu-Yu Liao, NCKU.*