import { useEffect, useState } from "react"

export default function Dashboard() {

  const [coins,setCoins] = useState([])

  useEffect(()=>{

    const mock = [
      {symbol:"BTC",trend:"Bullish",prob:72,signal:"Breakout Long"},
      {symbol:"ETH",trend:"Neutral",prob:55,signal:"Wait"},
      {symbol:"SOL",trend:"Bearish",prob:63,signal:"Resistance Short"}
    ]

    setCoins(mock)

  },[])

  return (

    <div style={{padding:40}}>

      <h1>Crypto Signal Pro V3</h1>
      <h3>Market Overview</h3>

      <div style={{
        display:"grid",
        gridTemplateColumns:"repeat(3,1fr)",
        gap:20,
        marginTop:20
      }}>

        {coins.map(c=>(
          <div key={c.symbol}
          style={{
            border:"1px solid #ddd",
            padding:20,
            borderRadius:10
          }}>

            <h2>{c.symbol}</h2>
            <p>Trend: {c.trend}</p>
            <p>Win Probability: {c.prob}%</p>
            <p>Signal: {c.signal}</p>

          </div>
        ))}

      </div>

    </div>

  )
}
