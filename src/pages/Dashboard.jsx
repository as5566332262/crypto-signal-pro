import { useEffect, useState } from "react"

async function getPrice(symbol) {
  const res = await fetch(
    `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`
  )

  const data = await res.json()
  return parseFloat(data.price)
}

export default function Dashboard() {
  const [coins, setCoins] = useState([])

  useEffect(() => {
    async function load() {
      const btc = await getPrice("BTCUSDT")
      const eth = await getPrice("ETHUSDT")
      const sol = await getPrice("SOLUSDT")

      setCoins([
        { symbol: "BTC", name: "比特幣", price: btc },
        { symbol: "ETH", name: "以太坊", price: eth },
        { symbol: "SOL", name: "SOL", price: sol },
      ])
    }

    load()

    const interval = setInterval(load, 30000)

    return () => clearInterval(interval)
  }, [])

  return (
    <div style={{ padding: 40 }}>
      <h1>加密訊號專業版 V3</h1>
      <h3>市場概覽</h3>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3,1fr)",
          gap: 20,
          marginTop: 20,
        }}
      >
        {coins.map((c) => (
          <div
            key={c.symbol}
            style={{
              border: "1px solid #ddd",
              padding: 20,
              borderRadius: 10,
              background: "white",
            }}
          >
            <h2 style={{ marginBottom: 10 }}>{c.name}</h2>
            <p style={{ fontSize: 18, fontWeight: "bold" }}>
              價格：{c.price?.toFixed(2)}美元
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
