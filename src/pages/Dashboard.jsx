import { useEffect, useState } from "react"

async function getPrice(symbol){

  const res = await fetch(
    `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`
  )

  const data = await res.json()

  return parseFloat(data.price)

}

export default function Dashboard() {

  const [coins,setCoins] = useState([])

  useEffect(()=>{

    async function load(){

      const btc = await getPrice("BTCUSDT")
      const eth = await getPrice("ETHUSDT")
      const sol = await getPrice("SOLUSDT")

      setCoins([
        {symbol:"BTC",price:btc},
        {symbol:"ETH",price:eth},
        {symbol:"SOL",price:sol}
      ])

    }

    load()

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
        }}
        >

        <h2>{c.symbol}</h2>
        <p>Price: ${c.price}</p>

        </div>
      ))}

      </div>

    </div>

  )

}
