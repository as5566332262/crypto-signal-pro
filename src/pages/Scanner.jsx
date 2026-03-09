import { useEffect, useState } from "react"

const SYMBOLS = [
  { symbol: "BTCUSDT", name: "BTC" },
  { symbol: "ETHUSDT", name: "ETH" },
  { symbol: "SOLUSDT", name: "SOL" },
  { symbol: "BNBUSDT", name: "BNB" },
]

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

  let trend = "Neutral"
  let signal = "Wait"
  let prob = 50

  if (ma20 !== null && currentPrice > ma20 && rsi !== null && rsi < 70 && rsi > 50) {
    trend = "Bullish"
    signal = "Support Long"
    prob = 68
  } else if (ma20 !== null && currentPrice < ma20 && rsi !== null && rsi > 30 && rsi < 50) {
    trend = "Bearish"
    signal = "Resistance Short"
    prob = 64
  } else if (rsi !== null && rsi >= 70) {
    trend = "Overbought"
    signal = "Watch Pullback"
    prob = 58
  } else if (rsi !== null && rsi <= 30) {
    trend = "Oversold"
    signal = "Watch Bounce"
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

  return (
    <div style={{ padding: 40 }}>
      <h1>Market Scanner Pro</h1>
      <p>即時市場掃描器（1h 週期）</p>
      <p style={{ color: "#666", marginTop: 8 }}>
        最後更新：{lastUpdated || "-"}
      </p>

      {loading ? (
        <p style={{ marginTop: 20 }}>載入中...</p>
      ) : (
        <table
          style={{
            width: "100%",
            marginTop: 20,
            borderCollapse: "collapse",
            background: "white",
            border: "1px solid #ddd",
          }}
        >
          <thead>
            <tr style={{ background: "#111", color: "white" }}>
              <th style={{ padding: 12, textAlign: "left" }}>Symbol</th>
              <th style={{ padding: 12, textAlign: "left" }}>Price</th>
              <th style={{ padding: 12, textAlign: "left" }}>Trend</th>
              <th style={{ padding: 12, textAlign: "left" }}>Signal</th>
              <th style={{ padding: 12, textAlign: "left" }}>Win %</th>
              <th style={{ padding: 12, textAlign: "left" }}>MA20</th>
              <th style={{ padding: 12, textAlign: "left" }}>RSI</th>
            </tr>
          </thead>

          <tbody>
            {signals.map((s) => (
              <tr key={s.fullSymbol} style={{ borderTop: "1px solid #eee" }}>
                <td style={{ padding: 12 }}>{s.symbol}</td>
                <td style={{ padding: 12 }}>${s.price.toFixed(2)}</td>
                <td style={{ padding: 12 }}>{s.trend}</td>
                <td style={{ padding: 12 }}>{s.signal}</td>
                <td style={{ padding: 12 }}>{s.prob}%</td>
                <td style={{ padding: 12 }}>
                  {s.ma20 ? s.ma20.toFixed(2) : "-"}
                </td>
                <td style={{ padding: 12 }}>
                  {s.rsi ? s.rsi.toFixed(2) : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
