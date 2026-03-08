import { useEffect, useState } from "react"

export default function Scanner() {

  const [signals,setSignals] = useState([])

  useEffect(()=>{

    const mockSignals = [
      {symbol:"BTC",trend:"Bullish",prob:72,signal:"Breakout Long"},
      {symbol:"ETH",trend:"Neutral",prob:55,signal:"Wait"},
      {symbol:"SOL",trend:"Bearish",prob:63,signal:"Resistance Short"},
      {symbol:"BNB",trend:"Bullish",prob:68,signal:"Support Long"}
    ]

    setSignals(mockSignals)

  },[])

  return (

    <div style={{padding:40}}>

      <h1>Market Scanner</h1>

      <table style={{
        width:"100%",
        marginTop:20,
        borderCollapse:"collapse"
      }}>

        <thead>
          <tr>
            <th>Symbol</th>
            <th>Trend</th>
            <th>Win %</th>
            <th>Signal</th>
          </tr>
        </thead>

        <tbody>

        {signals.map(s=>(
          <tr key={s.symbol}>
            <td>{s.symbol}</td>
            <td>{s.trend}</td>
            <td>{s.prob}%</td>
            <td>{s.signal}</td>
          </tr>
        ))}

        </tbody>

      </table>

    </div>
  )
}
