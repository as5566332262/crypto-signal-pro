import { useEffect, useState } from "react"

const SYMBOLS = [
  { symbol: "BTCUSDT", name: "BTC" },
  { symbol: "ETHUSDT", name: "ETH" },
  { symbol: "SOLUSDT", name: "SOL" },
  { symbol: "BNBUSDT", name: "BNB" },
]

const CARD_STYLE = {
  background: "white",
  border: "1px solid #e2e8f0",
  borderRadius: 18,
  padding: 20,
  boxShadow: "0 1px 3px rgba(15,23,42,0.06)",
}

async function getPrice(symbol) {
  const res = await fetch(
    `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`
  )
  const data = await res.json()
  return parseFloat(data.price)
}

async function getKlines(symbol, interval = "1h", limit = 30) {
  const res = await fetch(
    `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
  )
  const data = await res.json()

  return data.map((row) => ({
    open: parseFloat(row[1]),
    high: parseFloat(row[2]),
    low: parseFloat(row[3]),
    close: parseFloat(row[4]),
    volume: parseFloat(row[5]),
  }))
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

function analyzeCoin(klines, currentPrice) {
  const closes = klines.map((k) => k.close)
  const ma20 = sma(closes, 20).at(-1)
  const rsi = calculateRSI(closes, 14)

  let trend = "中性"
  let signal = "等待確認"
  let prob = 50

  if (ma20 !== null && currentPrice > ma20 && rsi !== null && rsi < 70 && rsi > 50) {
    trend = "偏多"
    signal = "支撐做多"
    prob = 68
  } else if (ma20 !== null && currentPrice < ma20 && rsi !== null && rsi > 30 && rsi < 50) {
    trend = "偏空"
    signal = "反彈壓力空"
    prob = 64
  } else if (rsi !== null && rsi >= 70) {
    trend = "過熱"
    signal = "等待回踩"
    prob = 58
  } else if (rsi !== null && rsi <= 30) {
    trend = "過冷"
    signal = "等待反彈"
    prob = 58
  }

  return {
    trend,
    signal,
    prob,
    ma20,
    rsi,
  }
}

export default function Scanner() {
  const [signals, setSignals] = useState([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState("")

  useEffect(() => {
    async function load() {
      try {
        const results = await Promise.all(
          SYMBOLS.map(async (item) => {
            const price = await getPrice(item.symbol)
            const klines = await getKlines(item.symbol, "1h", 30)
            const analysis = analyzeCoin(klines, price)

            return {
              symbol: item.name,
              fullSymbol: item.symbol,
              price,
              ...analysis,
            }
          })
        )

        setSignals(results)
        setLastUpdated(new Date().toLocaleString())
      } catch (error) {
        console.error("Scanner load error:", error)
      } finally {
        setLoading(false)
      }
    }

    load()
    const interval = setInterval(load, 30000)
    return () => clearInterval(interval)
  }, [])

  const bestLong =
    signals.length > 0
      ? [...signals]
          .filter((s) => s.trend === "偏多")
          .sort((a, b) => b.prob - a.prob)[0]
      : null

  const bestShort =
    signals.length > 0
      ? [...signals]
          .filter((s) => s.trend === "偏空")
          .sort((a, b) => b.prob - a.prob)[0]
      : null

  return (
    <div style={{ padding: 24 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.2fr 0.8fr 0.8fr",
          gap: 16,
        }}
      >
        <div style={CARD_STYLE}>
          <div style={{ fontSize: 28, fontWeight: 700 }}>Market Scanner Pro</div>
          <div style={{ color: "#64748b", marginTop: 8 }}>
            即時市場掃描器（1h 週期）
          </div>
          <div style={{ color: "#64748b", marginTop: 6 }}>
            最後更新：{lastUpdated || "-"}
          </div>
        </div>

        <div style={CARD_STYLE}>
          <div style={{ fontSize: 14, color: "#64748b" }}>最佳做多機會</div>
          <div style={{ marginTop: 10, fontSize: 24, fontWeight: 700 }}>
            {bestLong ? bestLong.symbol : "-"}
          </div>
          <div style={{ marginTop: 8 }}>{bestLong ? bestLong.signal : "-"}</div>
          <div style={{ marginTop: 8, color: "#64748b" }}>
            {bestLong ? `${bestLong.prob}%` : "-"}
          </div>
        </div>

        <div style={CARD_STYLE}>
          <div style={{ fontSize: 14, color: "#64748b" }}>最佳做空機會</div>
          <div style={{ marginTop: 10, fontSize: 24, fontWeight: 700 }}>
            {bestShort ? bestShort.symbol : "-"}
          </div>
          <div style={{ marginTop: 8 }}>{bestShort ? bestShort.signal : "-"}</div>
          <div style={{ marginTop: 8, color: "#64748b" }}>
            {bestShort ? `${bestShort.prob}%` : "-"}
          </div>
        </div>
      </div>

      <div style={{ ...CARD_STYLE, marginTop: 18, padding: 0, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 20 }}>載入中...</div>
        ) : (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              background: "white",
            }}
          >
            <thead>
              <tr style={{ background: "#0f172a", color: "white" }}>
                <th style={thStyle}>Symbol</th>
                <th style={thStyle}>Price</th>
                <th style={thStyle}>Trend</th>
                <th style={thStyle}>Signal</th>
                <th style={thStyle}>Win %</th>
                <th style={thStyle}>MA20</th>
                <th style={thStyle}>RSI</th>
              </tr>
            </thead>

            <tbody>
              {signals.map((s) => (
                <tr key={s.fullSymbol} style={{ borderTop: "1px solid #e2e8f0" }}>
                  <td style={tdStyle}>{s.symbol}</td>
                  <td style={tdStyle}>${s.price.toFixed(2)}</td>
                  <td style={tdStyle}>{s.trend}</td>
                  <td style={tdStyle}>{s.signal}</td>
                  <td style={tdStyle}>{s.prob}%</td>
                  <td style={tdStyle}>{s.ma20 ? s.ma20.toFixed(2) : "-"}</td>
                  <td style={tdStyle}>{s.rsi ? s.rsi.toFixed(2) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

const thStyle = {
  padding: 14,
  textAlign: "left",
  fontSize: 15,
}

const tdStyle = {
  padding: 14,
  textAlign: "left",
  fontSize: 16,
}
