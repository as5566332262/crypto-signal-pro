import { useEffect, useMemo, useState } from "react"

const SYMBOL_OPTIONS = [
  { label: "BTC", value: "BTCUSDT" },
  { label: "ETH", value: "ETHUSDT" },
  { label: "SOL", value: "SOLUSDT" },
  { label: "BNB", value: "BNBUSDT" },
]

const INTERVAL_OPTIONS = [
  { label: "15m", value: "15m" },
  { label: "1h", value: "1h" },
  { label: "4h", value: "4h" },
  { label: "1d", value: "1d" },
]

function sma(values, period) {
  return values.map((_, index) => {
    if (index + 1 < period) return null
    const slice = values.slice(index - period + 1, index + 1)
    return slice.reduce((a, b) => a + b, 0) / period
  })
}

function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return null

  let gains = 0
  let losses = 0

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff >= 0) gains += diff
    else losses += Math.abs(diff)
  }

  let avgGain = gains / period
  let avgLoss = losses / period

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    const gain = diff > 0 ? diff : 0
    const loss = diff < 0 ? Math.abs(diff) : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
  }

  if (avgLoss === 0) return 100

  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

function detectSupportResistance(klines) {
  const recent = klines.slice(-30)
  const lows = recent.map((k) => k.low)
  const highs = recent.map((k) => k.high)

  return {
    support: Math.min(...lows),
    resistance: Math.max(...highs),
  }
}

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-"
  return Number(value).toFixed(digits)
}

async function getKlines(symbol, interval = "1h", limit = 120) {
  const res = await fetch(
    `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
  )

  const data = await res.json()

  return data.map((row) => ({
    openTime: row[0],
    open: parseFloat(row[1]),
    high: parseFloat(row[2]),
    low: parseFloat(row[3]),
    close: parseFloat(row[4]),
    volume: parseFloat(row[5]),
  }))
}

function analyzeCoin(klines) {
  const closes = klines.map((k) => k.close)
  const currentPrice = closes[closes.length - 1]

  const ma20 = sma(closes, 20).at(-1)
  const ma50 = sma(closes, 50).at(-1)
  const rsi = calculateRSI(closes, 14)
  const sr = detectSupportResistance(klines)

  let trend = "Neutral"
  let signal = "Wait"
  let longProb = 50
  let shortProb = 50

  if (ma20 && ma50 && currentPrice > ma20 && ma20 > ma50 && rsi > 50 && rsi < 70) {
    trend = "Bullish"
    signal = "Support Long"
    longProb = 68
    shortProb = 32
  } else if (ma20 && ma50 && currentPrice < ma20 && ma20 < ma50 && rsi < 50 && rsi > 30) {
    trend = "Bearish"
    signal = "Resistance Short"
    longProb = 34
    shortProb = 66
  } else if (rsi >= 70) {
    trend = "Overbought"
    signal = "Watch Pullback"
    longProb = 40
    shortProb = 60
  } else if (rsi <= 30) {
    trend = "Oversold"
    signal = "Watch Bounce"
    longProb = 60
    shortProb = 40
  }

  const entry =
    trend === "Bullish"
      ? `${formatNumber(sr.support)} - ${formatNumber(currentPrice)}`
      : trend === "Bearish"
      ? `${formatNumber(currentPrice)} - ${formatNumber(sr.resistance)}`
      : "Wait"

  const stop =
    trend === "Bullish"
      ? formatNumber(sr.support * 0.985)
      : trend === "Bearish"
      ? formatNumber(sr.resistance * 1.015)
      : "-"

  const tp =
    trend === "Bullish"
      ? formatNumber(sr.resistance)
      : trend === "Bearish"
      ? formatNumber(sr.support)
      : "-"

  return {
    currentPrice,
    ma20,
    ma50,
    rsi,
    support: sr.support,
    resistance: sr.resistance,
    trend,
    signal,
    longProb,
    shortProb,
    entry,
    stop,
    tp,
  }
}

export default function SymbolDetail() {
  const [symbol, setSymbol] = useState("BTCUSDT")
  const [interval, setIntervalValue] = useState("1h")
  const [analysis, setAnalysis] = useState(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState("")

  useEffect(() => {
    async function load() {
      try {
        const klines = await getKlines(symbol, interval, interval === "1d" ? 180 : 120)
        const result = analyzeCoin(klines)
        setAnalysis(result)
        setLastUpdated(new Date().toLocaleString())
      } catch (error) {
        console.error("Symbol detail load error:", error)
      } finally {
        setLoading(false)
      }
    }

    load()
    const timer = setInterval(load, 30000)
    return () => clearInterval(timer)
  }, [symbol, interval])

  const symbolLabel = useMemo(() => {
    return SYMBOL_OPTIONS.find((item) => item.value === symbol)?.label || symbol
  }, [symbol])

  return (
    <div style={{ padding: 40 }}>
      <h1>{symbolLabel} Analysis Pro</h1>
      <p>單幣 AI 深度分析</p>
      <p style={{ color: "#666", marginTop: 8 }}>最後更新：{lastUpdated || "-"}</p>

      <div
        style={{
          display: "flex",
          gap: 16,
          marginTop: 20,
          marginBottom: 20,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ marginBottom: 8 }}>幣種</div>
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            style={{
              padding: 10,
              minWidth: 160,
              borderRadius: 8,
              border: "1px solid #ccc",
            }}
          >
            {SYMBOL_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div style={{ marginBottom: 8 }}>週期</div>
          <select
            value={interval}
            onChange={(e) => setIntervalValue(e.target.value)}
            style={{
              padding: 10,
              minWidth: 160,
              borderRadius: 8,
              border: "1px solid #ccc",
            }}
          >
            {INTERVAL_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading || !analysis ? (
        <p>載入中...</p>
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4,1fr)",
              gap: 20,
              marginTop: 20,
            }}
          >
            <div style={cardStyle}>
              <h3>Price</h3>
              <p style={valueStyle}>${formatNumber(analysis.currentPrice)}</p>
            </div>

            <div style={cardStyle}>
              <h3>Trend</h3>
              <p style={valueStyle}>{analysis.trend}</p>
            </div>

            <div style={cardStyle}>
              <h3>Signal</h3>
              <p style={valueStyle}>{analysis.signal}</p>
            </div>

            <div style={cardStyle}>
              <h3>RSI</h3>
              <p style={valueStyle}>{formatNumber(analysis.rsi)}</p>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4,1fr)",
              gap: 20,
              marginTop: 20,
            }}
          >
            <div style={cardStyle}>
              <h3>MA20</h3>
              <p style={valueStyle}>{formatNumber(analysis.ma20)}</p>
            </div>

            <div style={cardStyle}>
              <h3>MA50</h3>
              <p style={valueStyle}>{formatNumber(analysis.ma50)}</p>
            </div>

            <div style={cardStyle}>
              <h3>Support</h3>
              <p style={valueStyle}>{formatNumber(analysis.support)}</p>
            </div>

            <div style={cardStyle}>
              <h3>Resistance</h3>
              <p style={valueStyle}>{formatNumber(analysis.resistance)}</p>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2,1fr)",
              gap: 20,
              marginTop: 20,
            }}
          >
            <div style={cardStyle}>
              <h3>Long Probability</h3>
              <p style={valueStyle}>{analysis.longProb}%</p>
            </div>

            <div style={cardStyle}>
              <h3>Short Probability</h3>
              <p style={valueStyle}>{analysis.shortProb}%</p>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3,1fr)",
              gap: 20,
              marginTop: 20,
            }}
          >
            <div style={cardStyle}>
              <h3>Entry</h3>
              <p style={valueStyle}>{analysis.entry}</p>
            </div>

            <div style={cardStyle}>
              <h3>Stop</h3>
              <p style={valueStyle}>{analysis.stop}</p>
            </div>

            <div style={cardStyle}>
              <h3>TP</h3>
              <p style={valueStyle}>{analysis.tp}</p>
            </div>
          </div>

          <div
            style={{
              marginTop: 24,
              padding: 20,
              border: "1px solid #ddd",
              borderRadius: 10,
              background: "white",
            }}
          >
            <h3>AI Summary</h3>
            <p style={{ marginTop: 12, lineHeight: 1.8 }}>
              {symbolLabel} 目前在 {interval} 週期下屬於{" "}
              <strong>{analysis.trend}</strong> 結構，
              AI 訊號為 <strong>{analysis.signal}</strong>。
              多頭勝率約 <strong>{analysis.longProb}%</strong>，
              空頭勝率約 <strong>{analysis.shortProb}%</strong>。
              目前支撐位在 <strong>{formatNumber(analysis.support)}</strong>，
              壓力位在 <strong>{formatNumber(analysis.resistance)}</strong>，
              建議依照進場區、止損與目標位搭配風控操作。
            </p>
          </div>
        </>
      )}
    </div>
  )
}

const cardStyle = {
  border: "1px solid #ddd",
  padding: 20,
  borderRadius: 10,
  background: "white",
}

const valueStyle = {
  fontSize: 22,
  fontWeight: "bold",
  marginTop: 10,
}
