# Crypto Signal Pro PWA

這是可部署的 BTC / ETH / SOL AI 交易分析工具，支援：
- BTC / ETH / SOL
- 15m / 1h / 4h
- MA20 / MA50 / RSI / MACD / ATR
- 結構、突破、量能、流動性掃單、趨勢線
- 多週期共振
- 交易計畫（進場區、失效位、目標位）
- PWA，可安裝到手機主畫面

## 本機啟動
```bash
npm install
npm run dev
```

## 正式部署
建議用 Vercel：
1. 把整個資料夾上傳到 GitHub
2. 到 Vercel 匯入專案
3. Build Command: `npm run build`
4. Output Directory: `dist`

## 手機安裝
- Android Chrome：選單 → 安裝應用程式 / 加到主畫面
- iPhone Safari：分享 → 加入主畫面
