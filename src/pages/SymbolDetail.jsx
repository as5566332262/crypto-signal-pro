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

const CARD_STYLE = {
  background: "white",
  border: "1px solid #e2e8f0",
  borderRadius: 18,
  padding: 20,
  boxShadow: "0 1px 3px rgba(15,23,42,0.06)",
}

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

  let trend = "中性"
  let signal = "等待確認"
  let longProb = 50
  let shortProb = 50

  if (ma20 && ma50 && currentPrice > ma20 && ma20 > ma50 && rsi > 50 && rsi < 70) {
    trend = "偏多"
    signal = "支撐做多"
    longProb = 68
    shortProb = 32
  } else if (ma20 && ma50 && currentPrice < ma20 && ma20 < ma50 && rsi < 50 && rsi > 30) {
    trend = "偏空"
    signal = "反彈壓力空"
    longProb = 34
    shortProb = 66
  } else if (rsi >= 70) {
    trend = "過熱"
    signal = "等待回踩"
    longProb = 40
    shortProb = 60
  } else if (rsi <= 30) {
    trend = "過冷"
    signal = "等待反彈"
    longProb = 60
    shortProb = 40
  }

  const entry =
    trend === "偏多"
      ? `${formatNumber(sr.support)} - ${formatNumber(currentPrice)}`
      : trend === "偏空"
      ? `${formatNumber(currentPrice)} - ${formatNumber(sr.resistance)}`
      : "Wait"

  const stop =
    trend === "偏多"
      ? formatNumber(sr.support * 0.985)
      : trend === "偏空"
      ? formatNumber(sr.resistance * 1.015)
      : "-"

  const tp =
    trend === "偏多"
      ? formatNumber(sr.resistance)
      : trend === "偏空"
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
    <div style={{ padding: 24 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.3fr 0.7fr",
          gap: 16,
          alignItems: "stretch",
        }}
      >
        <div style={CARD_STYLE}>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{symbolLabel} Analysis Pro</div>
          <div style={{ color: "#64748b", marginTop: 8 }}>單幣 AI 深度分析</div>
          <div style={{ color: "#64748b", marginTop: 6 }}>
            最後更新：{lastUpdated || "-"}
          </div>

          <div
            style={{
              display: "flex",
              gap: 16,
              marginTop: 18,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div style={{ marginBottom: 8, fontSize: 14, color: "#64748b" }}>幣種</div>
              <select
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                style={selectStyle}
              >
                {SYMBOL_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div style={{ marginBottom: 8, fontSize: 14, color: "#64748b" }}>週期</div>
              <select
                value={interval}
                onChange={(e) => setIntervalValue(e.target.value)}
                style={selectStyle}
              >
                {INTERVAL_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div style={CARD_STYLE}>
          <div style={{ fontSize: 14, color: "#64748b" }}>本次結論</div>
          <div style={{ marginTop: 12, fontSize: 28, fontWeight: 700 }}>
            {analysis?.signal || "-"}
          </div>
          <div style={{ marginTop: 10, color: "#64748b" }}>
            趨勢：{analysis?.trend || "-"}
          </div>
          <div style={{ marginTop: 6, color: "#64748b" }}>
            多頭勝率：{analysis?.longProb ?? "-"}%
          </div>
          <div style={{ marginTop: 6, color: "#64748b" }}>
            空頭勝率：{analysis?.shortProb ?? "-"}%
          </div>
        </div>
      </div>

      {loading || !analysis ? (
        <div style={{ marginTop: 20 }}>載入中...</div>
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4,1fr)",
              gap: 16,
              marginTop: 18,
            }}
          >
            <MetricCard label="Price" value={`$${formatNumber(analysis.currentPrice)}`} />
            <MetricCard label="Trend" value={analysis.trend} />
            <MetricCard label="Signal" value={analysis.signal} />
            <MetricCard label="RSI" value={formatNumber(analysis.rsi)} />
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4,1fr)",
              gap: 16,
              marginTop: 16,
            }}
          >
            <MetricCard label="MA20" value={formatNumber(analysis.ma20)} />
            <MetricCard label="MA50" value={formatNumber(analysis.ma50)} />
            <MetricCard label="Support" value={formatNumber(analysis.support)} />
            <MetricCard label="Resistance" value={formatNumber(analysis.resistance)} />
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2,1fr)",
              gap: 16,
              marginTop: 16,
            }}
          >
            <MetricCard label="Long Probability" value={`${analysis.longProb}%`} />
            <MetricCard label="Short Probability" value={`${analysis.shortProb}%`} />
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3,1fr)",
              gap: 16,
              marginTop: 16,
            }}
          >
            <MetricCard label="Entry" value={analysis.entry} />
            <MetricCard label="Stop" value={analysis.stop} />
            <MetricCard label="TP" value={analysis.tp} />
          </div>

          <div style={{ ...CARD_STYLE, marginTop: 18 }}>
            <div style={{ fontSize: 20, fontWeight: 700 }}>AI Summary</div>
            <div style={{ marginTop: 14, lineHeight: 1.9, color: "#334155" }}>
              {symbolLabel} 目前在 {interval} 週期下屬於 <strong>{analysis.trend}</strong> 結構，
              AI 訊號為 <strong>{analysis.signal}</strong>。多頭勝率約{" "}
              <strong>{analysis.longProb}%</strong>，空頭勝率約{" "}
              <strong>{analysis.shortProb}%</strong>。目前支撐位在{" "}
              <strong>{formatNumber(analysis.support)}</strong>，壓力位在{" "}
              <strong>{formatNumber(analysis.resistance)}</strong>，建議依照進場區、
              止損與目標位搭配風控操作。
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function MetricCard({ label, value }) {
  return (
    <div style={CARD_STYLE}>
      <div style={{ fontSize: 14, color: "#64748b" }}>{label}</div>
      <div style={{ marginTop: 10, fontSize: 22, fontWeight: 700 }}>{value}</div>
    </div>
  )
}

const selectStyle = {
  padding: 10,
  minWidth: 160,
  borderRadius: 10,
  border: "1px solid #cbd5e1",
  background: "white",
  fontSize: 15,
}
