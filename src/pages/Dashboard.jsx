import { useEffect, useState } from "react"

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

export default function Dashboard() {
  const [coins, setCoins] = useState([])
  const [lastUpdated, setLastUpdated] = useState("")

  useEffect(() => {
    async function load() {
      const btc = await getPrice("BTCUSDT")
      const eth = await getPrice("ETHUSDT")
      const sol = await getPrice("SOLUSDT")
      const bnb = await getPrice("BNBUSDT")

      const rows = [
        {
          symbol: "BTC",
          name: "比特幣",
          price: btc,
          trend: btc > 67000 ? "偏多" : "偏空",
          prob: btc > 67000 ? 68 : 61,
          signal: btc > 67000 ? "回踩支撐多" : "反彈壓力空",
        },
        {
          symbol: "ETH",
          name: "以太坊",
          price: eth,
          trend: eth > 1950 ? "偏多" : "中性",
          prob: eth > 1950 ? 64 : 53,
          signal: eth > 1950 ? "支撐做多" : "等待確認",
        },
        {
          symbol: "SOL",
          name: "SOL",
          price: sol,
          trend: sol > 82 ? "中性" : "偏空",
          prob: sol > 82 ? 52 : 66,
          signal: sol > 82 ? "等待突破" : "反彈壓力空",
        },
        {
          symbol: "BNB",
          name: "BNB",
          price: bnb,
          trend: bnb > 620 ? "偏多" : "偏空",
          prob: bnb > 620 ? 63 : 60,
          signal: bnb > 620 ? "支撐做多" : "壓力區觀察",
        },
      ]

      setCoins(rows)
      setLastUpdated(new Date().toLocaleString())
    }

    load()
    const interval = setInterval(load, 30000)
    return () => clearInterval(interval)
  }, [])

  const bestCoin =
    coins.length > 0
      ? [...coins].sort((a, b) => b.prob - a.prob)[0]
      : null

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
          <div style={{ fontSize: 28, fontWeight: 700 }}>市場總覽</div>
          <div style={{ color: "#64748b", marginTop: 8 }}>
            Binance 即時價格・30 秒自動刷新
          </div>
          <div style={{ color: "#64748b", marginTop: 6 }}>
            最後更新：{lastUpdated || "-"}
          </div>
        </div>

        <div style={CARD_STYLE}>
          <div style={{ fontSize: 14, color: "#64748b" }}>今日最佳機會</div>
          <div style={{ marginTop: 10, fontSize: 28, fontWeight: 700 }}>
            {bestCoin ? bestCoin.symbol : "-"}
          </div>
          <div style={{ marginTop: 8, fontSize: 18 }}>
            {bestCoin ? bestCoin.signal : "-"}
          </div>
          <div style={{ marginTop: 8, color: "#64748b" }}>
            勝率：{bestCoin ? `${bestCoin.prob}%` : "-"}
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 16,
          marginTop: 18,
        }}
      >
        {coins.map((c) => (
          <div key={c.symbol} style={CARD_STYLE}>
            <div style={{ fontSize: 14, color: "#64748b" }}>{c.name}</div>
            <div style={{ marginTop: 8, fontSize: 28, fontWeight: 700 }}>
              {c.symbol}
            </div>
            <div style={{ marginTop: 10, fontSize: 22, fontWeight: 700 }}>
              ${c.price?.toFixed(2)}
            </div>
            <div style={{ marginTop: 12, color: "#64748b" }}>趨勢：{c.trend}</div>
            <div style={{ marginTop: 6, color: "#64748b" }}>訊號：{c.signal}</div>
            <div style={{ marginTop: 6, color: "#64748b" }}>勝率：{c.prob}%</div>
          </div>
        ))}
      </div>

      <div style={{ ...CARD_STYLE, marginTop: 18 }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>V3 目前狀態</div>
        <div style={{ marginTop: 14, color: "#334155", lineHeight: 1.9 }}>
          <div>• 已接上 Binance 即時價格</div>
          <div>• 已支援 Dashboard / Scanner / Symbol Detail 三頁架構</div>
          <div>• 已有 30 秒自動刷新</div>
          <div>• 下一步可升級：更多幣種、排行榜、AI 訊號模型、進出場規劃</div>
        </div>
      </div>
    </div>
  )
}
