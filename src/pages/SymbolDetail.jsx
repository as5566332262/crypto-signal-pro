import { useState } from "react"

export default function SymbolDetail() {

const data = {
symbol:"SOL",
price:82.28,
trend:"偏空",
signal:"反彈壓力空",
rsi:46.96,
ma20:82.36,
ma50:83.21,

support:80.26,
resistance:84.13,

longProb:34,
shortProb:66,

entry:"82.28 - 84.13",
stop:"85.39",
tp:"80.26",

shortSupport:"82.81 ~ 83.31",
shortResistance:"83.19 ~ 83.69",
structureSupport:"82.41 ~ 82.91",
structureResistance:"83.83 ~ 84.33",

atr:0.71,
range:"82.18 ~ 83.29",

longScore:5,
shortScore:1,

volume:"37,422"
}

return (

<div style={{padding:20}}>

<div style={{
display:"grid",
gridTemplateColumns:"2fr 1fr",
gap:20
}}

>

{/* LEFT SIDE */}

<div>

{/* TRADE PLAN */}

<div style={card}>

<h3>交易建議</h3>

<div style={grid3}>

<box title="建議方式" value="等回踩"/>
<box title="止損" value="82.41"/>
<box title="止盈" value="84.08 / 84.55"/>

</div>

<p style={{marginTop:15,fontSize:14,color:"#555"}}>

• V2 已加入日線，並修正週期切換會重新載入資料。  
• 偏多：優先等回踩支撐再突破確認，不建議 RSI 過熱追價。  
• 偏空：優先等反彈壓力或跌破確認，不建議 RSI 過低時追空。  

</p>

</div>

{/* ENTRY PLAN */}

<div style={{...card,marginTop:20}}>

<div style={grid2}>

<box title="建議進場區" value="82.41 ~ 82.91"/>
<box title="失效位" value="82.20"/>

<box title="目標一" value="84.08"/>
<box title="目標二" value="84.55"/>

</div>

</div>


{/* MARKET SUMMARY (圖一搬過來) */}

<div style={{...card,marginTop:20}}>

<h3>即時資料摘要</h3>

<div style={grid2}>

<box title="短線支撐區" value={data.shortSupport}/>
<box title="短線壓力區" value={data.shortResistance}/>

<box title="結構支撐區" value={data.structureSupport}/>
<box title="結構壓力區" value={data.structureResistance}/>

<box title="ATR波動" value={data.atr}/>
<box title="最近K線區間" value={data.range}/>

</div>

</div>

<div style={{...card,marginTop:20}}>

<h3>AI 訊號細節</h3>

<p>多方分數：{data.longScore}</p>
<p>空方分數：{data.shortScore}</p>
<p>成交量：{data.volume}</p>

<p style={{marginTop:10,fontSize:14,color:"#555"}}>
V2 勝率偏向：結構、突破、量能、流動性與高週期共振的綜合評分
</p>

</div>

</div>


{/* RIGHT SIDE */}

<div>

<div style={card}>

<h3>本次結論</h3>

<h2>{data.signal}</h2>

<p>趨勢：{data.trend}</p>

<p>多頭勝率：{data.longProb}%</p>
<p>空頭勝率：{data.shortProb}%</p>

</div>

<div style={{...card,marginTop:20}}>

<h3>AI綜合判斷</h3>

<p>

目前偏向空，結構為下降結構  
當前價格接近壓力區  
空頭勝率約66%  

策略：反彈做空

</p>

</div>

</div>

</div>

</div>

)

}

function box({title,value}){

return(

<div style={{
border:"1px solid #eee",
borderRadius:10,
padding:15,
marginTop:10
}}>

<div style={{fontSize:13,color:"#666"}}>{title}</div>
<div style={{fontSize:18,fontWeight:600}}>{value}</div>

</div>

)

}

const card={
background:"white",
padding:20,
borderRadius:14,
boxShadow:"0 0 10px rgba(0,0,0,0.05)"
}

const grid2={
display:"grid",
gridTemplateColumns:"1fr 1fr",
gap:15
}

const grid3={
display:"grid",
gridTemplateColumns:"1fr 1fr 1fr",
gap:15
}
