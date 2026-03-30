import React, { useEffect, useMemo, useState } from "react";
import { Activity, PanelRightClose, PanelRightOpen, RefreshCw } from "lucide-react";
import { ResponsiveContainer, ComposedChart, XAxis, YAxis, Tooltip, CartesianGrid, Line, Bar, ReferenceArea, ReferenceLine, Cell } from "recharts";
import { registerSW } from "virtual:pwa-register";

const SYMBOL_OPTIONS=[{label:"BTC",value:"BTCUSDT"},{label:"ETH",value:"ETHUSDT"},{label:"SOL",value:"SOLUSDT"}];
const INTERVAL_OPTIONS=[{label:"15m",value:"15m"},{label:"1h",value:"1h"},{label:"4h",value:"4h"}];
const HIGHER_INTERVAL_MAP={"15m":["1h","4h"],"1h":["4h"],"4h":["1d"]};

const fmt=(v,d=2)=>v==null||Number.isNaN(v)?"-":Number(v).toLocaleString(undefined,{minimumFractionDigits:d,maximumFractionDigits:d});
const fmtTime=(ts,i)=>{const d=new Date(ts);return i==="15m"||i==="1h"?`${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`:`${d.getMonth()+1}/${d.getDate()}`};
const sma=(a,p)=>a.map((_,i)=>i+1<p?null:a.slice(i-p+1,i+1).reduce((x,y)=>x+y,0)/p);
function ema(v,p){if(!v.length)return[];const k=2/(p+1),r=[v[0]];for(let i=1;i<v.length;i++)r.push(v[i]*k+r[i-1]*(1-k));return r}
function rsi(cl,p=14){if(cl.length<p+1)return null;let g=0,l=0;for(let i=1;i<=p;i++){const d=cl[i]-cl[i-1];if(d>=0)g+=d;else l+=Math.abs(d)}let ag=g/p,al=l/p;for(let i=p+1;i<cl.length;i++){const d=cl[i]-cl[i-1],gg=d>0?d:0,ll=d<0?Math.abs(d):0;ag=(ag*(p-1)+gg)/p;al=(al*(p-1)+ll)/p}if(al===0)return 100;const rs=ag/al;return 100-100/(1+rs)}
function macd(cl){if(cl.length<35)return null;const e12=ema(cl,12),e26=ema(cl,26),m=cl.map((_,i)=>e12[i]-e26[i]),s=ema(m,9);return{macd:m.at(-1),signal:s.at(-1),histogram:m.at(-1)-s.at(-1)}}
function atr(cs,p=14){if(cs.length<p+1)return null;const tr=[];for(let i=1;i<cs.length;i++){const c=cs[i],pc=cs[i-1].close;tr.push(Math.max(c.high-c.low,Math.abs(c.high-pc),Math.abs(c.low-pc)))}const r=tr.slice(-p);return r.reduce((a,b)=>a+b,0)/r.length}
function swings(cs,l=3,r=3){const sh=[],sl=[];for(let i=l;i<cs.length-r;i++){let ih=true,il=true;for(let j=i-l;j<=i+r;j++){if(j===i)continue;if(cs[j].high>=cs[i].high)ih=false;if(cs[j].low<=cs[i].low)il=false}if(ih)sh.push({price:cs[i].high});if(il)sl.push({price:cs[i].low})}return{sh,sl}}
function dedupe(arr,g){const o=[];for(const x of arr)if(!o.some(y=>Math.abs(y.price-x.price)<g))o.push(x);return o}
function zone(c,a){const w=Math.max((a||c*0.008)*0.35,c*0.0025);return{low:c-w,high:c+w}}
function pivots(cs,price,a){const {sh,sl}=swings(cs,3,3);const gap=Math.max((a||price*0.01)*0.6,price*0.004), floor=Math.max((a||price*0.01)*0.8,price*0.006);
const ss=dedupe(cs.map(c=>({price:c.low})).filter(x=>x.price<price&&price-x.price>=floor*.3).sort((a,b)=>b.price-a.price),gap).slice(0,2);
const sr=dedupe(cs.map(c=>({price:c.high})).filter(x=>x.price>price&&x.price-price>=floor*.3).sort((a,b)=>a.price-b.price),gap).slice(0,2);
const ls=dedupe(sl.filter(x=>x.price<price&&price-x.price>=floor).sort((a,b)=>b.price-a.price),gap).slice(0,2);
const lr=dedupe(sh.filter(x=>x.price>price&&x.price-price>=floor).sort((a,b)=>a.price-b.price),gap).slice(0,2);
const ns=ls[0]?.price??ss[0]?.price??price*.985,nr=lr[0]?.price??sr[0]?.price??price*1.015,ss2=ls[1]?.price??ss[1]?.price??price*.97,sr2=lr[1]?.price??sr[1]?.price??price*1.03;
const confidence=cs.length<60?"low":(ls.length+lr.length+ss.length+sr.length<4?"medium":"high");
return{nearestSupport:ns,secondSupport:ss2,nearestResistance:nr,secondResistance:sr2,shortSupportZone:zone(ss[0]?.price??ns,a),shortResistanceZone:zone(sr[0]?.price??nr,a),structureSupportZone:zone(ls[0]?.price??ns,a),structureResistanceZone:zone(lr[0]?.price??nr,a),confidence,insufficientData:confidence==="low"}}
function detectStructure(cs){const recent=cs.slice(-30),s=swings(recent,2,2),h=s.sh.slice(-3).map(x=>x.price),l=s.sl.slice(-3).map(x=>x.price);let structure="盤整";if(h.length>=2&&l.length>=2){if(h.at(-1)>h[0]&&l.at(-1)>l[0])structure="上升結構";else if(h.at(-1)<h[0]&&l.at(-1)<l[0])structure="下降結構"}return structure}
function volState(cs){if(cs.length<25)return"一般";const r=cs.slice(-20).map(c=>c.volume),avg=r.reduce((a,b)=>a+b,0)/r.length,last=cs.at(-1).volume;if(last>avg*1.6)return"放量";if(last<avg*.75)return"量縮";return"一般"}
function breakout(cs,lv,a){const last=cs.at(-1),prev=cs.at(-2),t=Math.max((a||last.close*.01)*.25,last.close*.0025);if(last.close>lv.structureResistanceZone.high+t&&prev.close<=lv.structureResistanceZone.high)return"向上突破";if(last.close<lv.structureSupportZone.low-t&&prev.close>=lv.structureSupportZone.low)return"向下跌破";if(last.low<=lv.structureSupportZone.high&&last.close>lv.structureSupportZone.high)return"回踩支撐中";if(last.high>=lv.structureResistanceZone.low&&last.close<lv.structureResistanceZone.low)return"反彈壓力中";return"區間內"}
function breakoutValidation(cs,lv,a,state){if(cs.length<5)return{validated:false,isFakeBreakout:false,penalty:.8,strength:.4,reasons:["資料不足，突破可信度偏低"],quality:"weak"};const last=cs.at(-1),prev=cs.at(-2),prev2=cs.at(-3),avgVol=cs.slice(-20).reduce((s,c)=>s+c.volume,0)/Math.min(20,cs.length),volRatio=avgVol?last.volume/avgVol:1;
const range=Math.max(last.high-last.low,1e-8),body=Math.abs(last.close-last.open),bodyRatio=body/range;
const closeNearHigh=(last.high-last.close)/range<.28,closeNearLow=(last.close-last.low)/range<.28;
const overRes=last.close-lv.structureResistanceZone.high,underSup=lv.structureSupportZone.low-last.close;
const holdAbove=last.close>lv.structureResistanceZone.high&&prev.close>lv.structureResistanceZone.high;
const holdBelow=last.close<lv.structureSupportZone.low&&prev.close<lv.structureSupportZone.low;
const fastReturnUp=prev.high>lv.structureResistanceZone.high&&last.close<lv.structureResistanceZone.high;
const fastReturnDown=prev.low<lv.structureSupportZone.low&&last.close>lv.structureSupportZone.low;
let validated=false,isFake=false,strength=.5,penalty=0,reasons=[],quality="neutral";
if(state==="向上突破"){validated=volRatio>1.1&&bodyRatio>.5&&closeNearHigh&&holdAbove&&overRes>Math.max((a||last.close*.01)*.15,last.close*.0015);isFake=!validated&&(fastReturnUp||volRatio<.95||bodyRatio<.35||!closeNearHigh);if(validated){strength=.9;quality="strong";reasons.push("突破有量能、實體與收盤站穩支撐。")}else{strength=.35;quality="weak";penalty=1.2;reasons.push("向上突破缺乏量能/實體/站穩，疑似假突破。")}}
if(state==="向下跌破"){validated=volRatio>1.1&&bodyRatio>.5&&closeNearLow&&holdBelow&&underSup>Math.max((a||last.close*.01)*.15,last.close*.0015);isFake=!validated&&(fastReturnDown||volRatio<.95||bodyRatio<.35||!closeNearLow);if(validated){strength=.9;quality="strong";reasons.push("跌破有量能、實體與收盤延續。")}else{strength=.35;quality="weak";penalty=1.2;reasons.push("向下跌破缺乏延續性，疑似假跌破。")}}
if(state==="區間內"||state==="回踩支撐中"||state==="反彈壓力中"){quality="neutral";strength=.5}
return{validated,isFakeBreakout:isFake,penalty,strength,reasons,quality,volumeSupport:volRatio,bodyStrength:bodyRatio,fastReturn:isFake&&(fastReturnUp||fastReturnDown)}}
function liqSweep(cs,lv,a){if(cs.length<3)return"無明顯掃流動性";const last=cs.at(-1),prev=cs.at(-2),b=Math.max((a||last.close*.01)*.2,last.close*.002);const sh=last.high>lv.structureResistanceZone.high+b&&last.close<lv.structureResistanceZone.high,sl=last.low<lv.structureSupportZone.low-b&&last.close>lv.structureSupportZone.low;if(sh&&last.close<prev.close)return"上方流動性掃單";if(sl&&last.close>prev.close)return"下方流動性掃單";return"無明顯掃流動性"}
function trendline(cs){if(cs.length<20)return"趨勢線資料不足";const cl=cs.slice(-20).map(c=>c.close),x=cl.map((_,i)=>i),xm=x.reduce((a,b)=>a+b,0)/x.length,ym=cl.reduce((a,b)=>a+b,0)/cl.length,num=x.reduce((s,xi,i)=>s+(xi-xm)*(cl[i]-ym),0),den=x.reduce((s,xi)=>s+(xi-xm)**2,0),slope=den?num/den:0;if(slope>0.15*(ym/100))return"上升趨勢線有效";if(slope<-0.15*(ym/100))return"下降趨勢線有效";return"趨勢線偏平"}
function biasFromCandles(cs){const cl=cs.map(c=>c.close),p=cl.at(-1),m20=sma(cl,20).at(-1),m50=sma(cl,50).at(-1),rr=rsi(cl,14),mc=macd(cl),sl=cl.at(-1)-cl.slice(-6)[0];let bull=0,bear=0;if(p>m20)bull++;else bear++;if(p>m50)bull++;else bear++;if(sl>0)bull++;else bear++;if(mc?.macd>mc?.signal&&mc?.histogram>0)bull++;if(mc?.macd<mc?.signal&&mc?.histogram<0)bear++;if(rr>=55&&rr<=70)bull++;if(rr<=45&&rr>=30)bear++;let bias="中性";if(bull-bear>=1.5)bias="偏多";if(bear-bull>=1.5)bias="偏空";return{bias,bull,bear}}
function rrCalc({entry,stop,target}){if([entry,stop,target].some(v=>v==null||!Number.isFinite(v)))return null;const risk=Math.abs(entry-stop),reward=Math.abs(target-entry);if(risk<=0)return null;return reward/risk}
function clamp(v,min,max){return Math.max(min,Math.min(max,v))}
function resolveEntryLocationQuality({price,bias,levels,atr,marketState,breakoutState}){
const support=levels?.shortSupportZone,resistance=levels?.shortResistanceZone;
if(!support||!resistance||!price)return{score:0.35,label:"low",state:"poor",reasons:["位置資料不足，先以保守模式處理。"]};
const range=Math.max(resistance.high-support.low,1e-8),mid=(support.high+resistance.low)/2,distToSupport=(price-support.high)/range,distToResistance=(resistance.low-price)/range,midDist=Math.abs(price-mid)/range;
let score=.55,reasons=[];
if(price>support.high&&price<resistance.low&&midDist<.12){score-=.28;reasons.push("價格位於區間中段，缺乏優勢進場位。")}
if(bias==="偏多"){
if(distToResistance<.08){score-=.32;reasons.push("偏多但接近壓力，不宜追多。")}
if(distToSupport<.08&&distToSupport>-0.08){score+=.2;reasons.push("偏多且靠近支撐，回踩位置較合理。")}
if(breakoutState==="向上突破"){score+=.08;reasons.push("突破後站穩有助於延續單。")}
}
if(bias==="偏空"){
if(distToSupport<.08){score-=.32;reasons.push("偏空但接近支撐，不宜追空。")}
if(distToResistance<.08&&distToResistance>-0.08){score+=.2;reasons.push("偏空且靠近壓力，反彈空位置較合理。")}
if(breakoutState==="向下跌破"){score+=.08;reasons.push("跌破後若延續，位置品質提高。")}
}
if(marketState==="ranging"){score-=.15;reasons.push("盤整市場位置優勢較難擴大。")}
if(marketState==="weak trend"){score-=.08;reasons.push("弱趨勢下需更挑剔進場點。")}
if((atr||0)/price>.03){score-=.08;reasons.push("波動偏大，進場容錯率下降。")}
const clamped=clamp(score,0,1),label=clamped>=.72?"high":clamped>=.5?"medium":"low",state=clamped>=.7?"good":clamped>=.45?"neutral":"poor";
if(!reasons.length)reasons.push("位置尚可，但仍需配合確認訊號。");
return{score:Number(clamped.toFixed(2)),label,state,reasons};
}
function resolveSetupType({bias,marketState,breakoutState,breakoutValidation,decision}){
if(decision==="WAIT")return"wait";
if(decision==="NO_TRADE")return"no-trade";
if(marketState==="ranging")return"range";
if((breakoutState==="向上突破"||breakoutState==="向下跌破")&&breakoutValidation?.validated)return"breakout";
if((breakoutState==="回踩支撐中"&&bias==="偏多")||(breakoutState==="反彈壓力中"&&bias==="偏空"))return"pullback";
if(breakoutValidation?.isFakeBreakout||bias==="中性")return"reversal";
return bias==="偏多"||bias==="偏空"?"pullback":"wait";
}
function resolveFinalDecision(ctx){
const{bias,confluence,marketState,momentumStrength,trendStrength,fakeBreakoutRisk,rrOk,entryScore,locationQuality}=ctx;
const weakConfluence=confluence==="多週期分歧",weakRegime=marketState==="ranging"||marketState==="weak trend",poorLocation=locationQuality.state==="poor";
const hardNoTradeReasons=[],waitReasons=[];
if(bias==="中性")hardNoTradeReasons.push("方向不明確（bias 中性）。");
if(fakeBreakoutRisk==="high")hardNoTradeReasons.push("假突破風險過高。");
if(!rrOk&&entryScore<4.6)hardNoTradeReasons.push("風險報酬與評分同時偏低。");
if(marketState==="high volatility"&&momentumStrength<.45)hardNoTradeReasons.push("高波動且動能不足。");
if(hardNoTradeReasons.length>=2)return{decision:"NO_TRADE",reasons:hardNoTradeReasons,waitFor:[]};
if(weakConfluence)waitReasons.push("多週期方向分歧，等待同步。");
if(weakRegime)waitReasons.push("市場趨勢不夠乾淨。");
if(momentumStrength<.48||trendStrength<.48)waitReasons.push("動能/趨勢強度不足。");
if(!rrOk)waitReasons.push("風險報酬不足。");
if(poorLocation)waitReasons.push("當前位置不具優勢，不適合追單。");
if(fakeBreakoutRisk==="medium")waitReasons.push("突破訊號仍需更多確認。");
if(waitReasons.length)return{decision:"WAIT",reasons:waitReasons,waitFor:["等待回踩/反彈到關鍵區再評估","等待突破後至少一根 K 線站穩確認","等待風險報酬提升至可接受區間"]};
if(bias==="偏多")return{decision:"BUY",reasons:["方向、位置與風險報酬均達標。"],waitFor:[]};
if(bias==="偏空")return{decision:"SELL",reasons:["空方條件完整，可規劃執行。"],waitFor:[]};
return{decision:"NO_TRADE",reasons:["缺乏有效方向訊號。"],waitFor:[]};
}
function analyze(cs,higher=[]){const cl=cs.map(c=>c.close),price=cl.at(-1),ma20=sma(cl,20).at(-1),ma50=sma(cl,50).at(-1),rr=rsi(cl,14),mc=macd(cl),aa=atr(cs,14),lv=pivots(cs.slice(-120),price,aa),st=detectStructure(cs),vs=volState(cs),bs=breakout(cs,lv,aa),ls=liqSweep(cs,lv,aa),ts=trendline(cs),slope=cl.at(-1)-cl.slice(-6)[0];let bull=0,bear=0;if(price>ma20)bull++;else bear++;if(price>ma50)bull++;else bear++;if(slope>0)bull++;else bear++;if(mc?.macd>mc?.signal&&mc?.histogram>0)bull++;if(mc?.macd<mc?.signal&&mc?.histogram<0)bear++;if(rr>=55&&rr<=70)bull++;if(rr<=45&&rr>=30)bear++;if(st==="上升結構")bull++;if(st==="下降結構")bear++;if(bs==="向上突破")bull++;if(bs==="向下跌破")bear++;if(vs==="放量"&&slope>0)bull+=.5;if(vs==="放量"&&slope<0)bear+=.5;let bias="中性";if(bull-bear>=1.5)bias="偏多";if(bear-bull>=1.5)bias="偏空";
const higherBiases=higher.map(({interval,candles})=>({interval,...biasFromCandles(candles)})),hb=higherBiases.filter(x=>x.bias==="偏多").length,hr=higherBiases.filter(x=>x.bias==="偏空").length,confluence=hb>hr?"多週期偏多":hr>hb?"多週期偏空":"多週期分歧";
const marketState=aa&&price?(aa/price>.028?"high volatility":(Math.abs(bull-bear)<1.2?"ranging":Math.abs(bull-bear)>2.2?"trend":"weak trend")):"weak trend";
const breakoutCheck=breakoutValidation(cs,lv,aa,bs);
if(breakoutCheck.isFakeBreakout&&bs==="向上突破")bull-=breakoutCheck.penalty;
if(breakoutCheck.isFakeBreakout&&bs==="向下跌破")bear-=breakoutCheck.penalty;
if(marketState==="ranging"){bull-=.4;bear-=.4}
if(marketState==="high volatility"){bull-=.3;bear-=.3}
if(breakoutCheck.isFakeBreakout&&bias!=="中性")bias="中性";
if(bias==="中性"){if(bull-bear>=1.5)bias="偏多";if(bear-bull>=1.5)bias="偏空"}
let entryScoreRaw=4.5+Math.abs(bull-bear)+(((bias==="偏多"&&hb>=1)||(bias==="偏空"&&hr>=1))?1:0)+(bs==="區間內"?-.5:0);
if(confluence==="多週期分歧")entryScoreRaw-=1.1;
if(breakoutCheck.isFakeBreakout)entryScoreRaw-=1.5;
if(marketState==="high volatility")entryScoreRaw-=.8;
if(marketState==="ranging")entryScoreRaw-=.6;
let entryScore=Number(clamp(entryScoreRaw,0,10).toFixed(1));
let entryAdvice="先觀望",setup="等待更明確訊號",stopLoss=null,tp1=null,tp2=null,explanation="目前多空訊號接近，建議等待突破或回踩確認。";
if(bias==="偏多"){if(rr>68||marketState==="high volatility"){entryAdvice="不建議追多";setup="等回踩";stopLoss=lv.structureSupportZone.low;tp1=lv.nearestResistance;tp2=lv.secondResistance;explanation="趨勢偏多，但動能/波動偏高，先等回踩確認可降低追價風險。"}else if(bs==="向上突破"&&breakoutCheck.validated){entryAdvice="可考慮突破跟隨";setup="等突破";stopLoss=lv.structureResistanceZone.low;tp1=lv.nearestResistance;tp2=lv.secondResistance;explanation="突破具備量能與實體，且收盤有站穩，可採小倉位順勢。"}else{entryAdvice="可考慮分批做多";setup="等回踩";stopLoss=lv.structureSupportZone.low;tp1=lv.nearestResistance;tp2=lv.secondResistance;explanation="均線、結構與動能偏多，優先等支撐區回踩而不是追價。"}} 
if(bias==="偏空"){if(rr<32||marketState==="high volatility"){entryAdvice="不建議追空";setup="等反彈";stopLoss=lv.structureResistanceZone.high;tp1=lv.nearestSupport;tp2=lv.secondSupport;explanation="趨勢偏空，但賣壓可能過度或波動過大，先等反彈壓力區較安全。"}else if(bs==="向下跌破"&&breakoutCheck.validated){entryAdvice="可考慮跌破跟隨";setup="等跌破";stopLoss=lv.structureSupportZone.high;tp1=lv.nearestSupport;tp2=lv.secondSupport;explanation="跌破具備量能與延續性，可小倉位順勢執行。"}else{entryAdvice="可考慮分批做空";setup="等反彈";stopLoss=lv.structureResistanceZone.high;tp1=lv.nearestSupport;tp2=lv.secondSupport;explanation="價格位於均線下方且結構偏弱，優先等反彈壓力區，不建議在低位追空。"}}
const riskLevel=aa&&price?(aa/price>.025?"高":aa/price>.015?"中":"低"):"中",buf=Math.max((aa||price*.01)*.3,price*.002);
let entryZone=null,entryMid=null,invalidation=null;
if(bias==="偏多"){entryZone=setup==="等突破"?{low:lv.structureResistanceZone.low,high:lv.structureResistanceZone.high+buf}:{low:lv.structureSupportZone.low,high:lv.structureSupportZone.high};entryMid=(entryZone.low+entryZone.high)/2;invalidation=lv.structureSupportZone.low-buf}
if(bias==="偏空"){entryZone=setup==="等跌破"?{low:lv.structureSupportZone.low-buf,high:lv.structureSupportZone.high}:{low:lv.structureResistanceZone.low,high:lv.structureResistanceZone.high};entryMid=(entryZone.low+entryZone.high)/2;invalidation=lv.structureResistanceZone.high+buf}
if(confluence==="多週期分歧"&&entryZone){const widen=(entryZone.high-entryZone.low)*.2;entryZone={low:entryZone.low+widen,high:entryZone.high-widen};entryMid=(entryZone.low+entryZone.high)/2}
const rr1=entryMid!=null?rrCalc({entry:entryMid,stop:invalidation,target:tp1}):null,rr2=entryMid!=null?rrCalc({entry:entryMid,stop:invalidation,target:tp2}):null;
const rrOk=(rr1??0)>=1.2||((rr2??0)>=1.6);
if(!rrOk&&bias!=="中性"){entryAdvice="風險報酬不足，建議等待";entryScore=Number(clamp(entryScore-1.4,0,10).toFixed(1));if(marketState==="ranging"||marketState==="high volatility"){setup="等待更明確訊號"}}
if(lv.insufficientData||confluence==="多週期分歧"&&marketState!=="trend"){entryZone=null;invalidation=null;if(bias!=="中性"){entryAdvice="資料保守，先觀望";setup="等待"}}
const locationQuality=resolveEntryLocationQuality({price,bias,levels:lv,atr:aa,marketState,breakoutState:bs});
const fakeBreakoutRisk=breakoutCheck.isFakeBreakout?"high":breakoutCheck.quality==="weak"?"medium":"low";
const trendStrength=Number(clamp(Math.abs(bull-bear)/4.5,0,1).toFixed(2));
const momentumStrength=Number(clamp((Math.abs(slope)/(aa||Math.abs(price*0.005)+1e-8))*0.45+Math.max((mc?.histogram||0),0)*2.2+(rr>=53&&rr<=67?0.18:0),0,1).toFixed(2));
let finalScore=entryScore*0.58+locationQuality.score*10*0.22+(rrOk?1.2:-1.2)+(fakeBreakoutRisk==="high"?-1.6:fakeBreakoutRisk==="medium"?-.8:0);
if(marketState==="ranging"||marketState==="weak trend")finalScore-=1;
const preliminary=resolveFinalDecision({bias,confluence,marketState,momentumStrength,trendStrength,fakeBreakoutRisk,rrOk,entryScore:finalScore,locationQuality});
const setupType=resolveSetupType({bias,marketState,breakoutState:bs,breakoutValidation:breakoutCheck,decision:preliminary.decision});
if(preliminary.decision==="WAIT")finalScore-=.8;
if(preliminary.decision==="NO_TRADE")finalScore-=1.5;
finalScore=Number(clamp(finalScore,0,10).toFixed(1));
const confidenceScore=clamp(finalScore/10*0.45+(confluence==="多週期分歧"?0:0.14)+(rrOk?0.12:-0.1)+(locationQuality.score-.5)*0.35+(fakeBreakoutRisk==="high"?-0.22:fakeBreakoutRisk==="medium"?-0.1:0)+(marketState==="trend"?0.1:marketState==="ranging"?-0.12:0),0,1);
let confidenceLevel=confidenceScore>=.74?"high":confidenceScore>=.5?"medium":"low";
if(preliminary.decision==="WAIT"&&confidenceLevel==="high")confidenceLevel="medium";
if(preliminary.decision==="NO_TRADE")confidenceLevel="low";
entryScore=Number(clamp(entryScore+(locationQuality.score-.5)*2+(fakeBreakoutRisk==="high"?-1.2:fakeBreakoutRisk==="medium"?-.5:0),0,10).toFixed(1));
if(preliminary.decision==="WAIT")entryAdvice="條件未成熟，建議等待";
if(preliminary.decision==="NO_TRADE")entryAdvice="不建議交易";
const tradePlan=entryZone?{entryZone:`${fmt(entryZone.low)} ~ ${fmt(entryZone.high)}`,invalidation:fmt(invalidation),target1:fmt(tp1),target2:fmt(tp2),riskReward:rr1&&rr2?`R1 ${rr1.toFixed(2)} / R2 ${rr2.toFixed(2)}`:rr1?`R1 ${rr1.toFixed(2)}`:"-"}:{entryZone:"等待突破或回踩確認",invalidation:"-",target1:tp1?fmt(tp1):"-",target2:tp2?fmt(tp2):"-",riskReward:"-"};
if(!entryZone||preliminary.decision==="WAIT"||preliminary.decision==="NO_TRADE"){stopLoss=null;tp1=null;tp2=null}
const breakoutNote=breakoutCheck.isFakeBreakout?"，突破驗證偏弱（疑似假突破）":"";
const decisionDetail=preliminary.decision==="WAIT"?`等待條件：${preliminary.waitFor.join("；")}。`:preliminary.decision==="NO_TRADE"?`不交易主因：${preliminary.reasons.join("；")}。`:"";
const aiSummary=`方向 ${bias}，市場狀態 ${marketState}，多週期 ${confluence}，結構 ${st}，突破狀態 ${bs}${breakoutNote}，RR ${rrOk?"達標":"不足"}，假突破風險 ${fakeBreakoutRisk}，位置品質 ${locationQuality.label}。最終決策 ${preliminary.decision}（setup: ${setupType}）。${decisionDetail}${vs!=="一般"?"量能"+vs+"。":""}${ls!=="無明顯掃流動性"?"流動性訊號："+ls+"。":""}${ts!=="趨勢線偏平"?"趨勢線："+ts+"。":""}`;
return{price,ma20,ma50,rsi:rr,macd:mc,atr:aa,bias,entryAdvice,setup,setupType,finalDecision:preliminary.decision,decisionReasons:preliminary.reasons,waitConditions:preliminary.waitFor,stopLoss,takeProfit1:tp1,takeProfit2:tp2,explanation,bullScore:bull,bearScore:bear,levels:lv,higherBiases,confluence,entryScore,finalScore,confidenceLevel,riskLevel,structure:st,breakoutState:bs,volumeState:vs,tradePlan,liquiditySweep:ls,trendlineState:ts,aiSummary,breakoutValidation:breakoutCheck,marketState,locationQuality,fakeBreakoutRisk,momentumStrength,trendStrength,rrOk}}
async function fetchK(symbol,interval,limit=200){const r=await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);if(!r.ok)throw new Error("無法取得價格資料，請稍後再試。");const d=await r.json();return d.map(row=>({openTime:row[0],open:+row[1],high:+row[2],low:+row[3],close:+row[4],volume:+row[5]}))}
function Kpi({title,value,helper}){return <div className="kpi"><div className="title">{title}</div><div className="value">{value}</div><small>{helper}</small></div>}
function Tip({active,payload,label,symbol}){if(!active||!payload?.length)return null;const row=payload[0].payload,d=symbol==="BTCUSDT"?0:2;return <div className="card" style={{padding:12,borderRadius:16}}><div style={{fontWeight:700,marginBottom:6}}>{label}</div><div>開盤：{fmt(row.open,d)}</div><div>最高：{fmt(row.high,d)}</div><div>最低：{fmt(row.low,d)}</div><div>收盤：{fmt(row.close,d)}</div><div>MA20：{fmt(row.ma20,d)}</div><div>MA50：{fmt(row.ma50,d)}</div><div>成交量：{fmt(row.volume,2)}</div></div>}
export default function App(){useEffect(()=>{try{registerSW({immediate:true})}catch{}},[]);const [symbol,setSymbol]=useState("SOLUSDT"),[interval,setInterval]=useState("15m"),[candles,setCandles]=useState([]),[analysis,setAnalysis]=useState(null),[loading,setLoading]=useState(false),[updated,setUpdated]=useState(""),[error,setError]=useState(""),[sidebarCollapsed,setSidebarCollapsed]=useState(false);
const loadData=async()=>{setLoading(true);setError("");try{const rows=await fetchK(symbol,interval,200);const higher=await Promise.all((HIGHER_INTERVAL_MAP[interval]||[]).map(async tf=>({interval:tf,candles:await fetchK(symbol,tf,200)})));setCandles(rows);setAnalysis(analyze(rows,higher));setUpdated(new Date().toLocaleString())}catch(e){setError(e.message||"讀取失敗")}finally{setLoading(false)}};
useEffect(()=>{loadData()},[symbol,interval]);useEffect(()=>{const t=setInterval(loadData,30000);return()=>clearInterval(t)},[symbol,interval]);
const chartData=useMemo(()=>{if(!candles.length)return[];const cl=candles.map(c=>c.close),m20=sma(cl,20),m50=sma(cl,50);return candles.slice(-60).map((c,idx,arr)=>{const oi=candles.length-arr.length+idx;return{time:fmtTime(c.openTime,interval),...c,ma20:m20[oi],ma50:m50[oi],bullish:c.close>=c.open}})},[candles,interval]); const d=symbol==="BTCUSDT"?0:2;
const badge=analysis?.bias==="偏多"?"bull":analysis?.bias==="偏空"?"bear":"flat";
return <div className="app">
<div className={`twocol ${sidebarCollapsed?"sidebar-collapsed":""}`}>
<div className="main-panel"><div className="card"><div style={{display:"flex",alignItems:"center",gap:10,fontSize:28,fontWeight:800,marginBottom:16}}><Activity size={28}/>Crypto Signal Pro</div>
<div className="controls"><div><div className="label">幣種</div><select className="select" value={symbol} onChange={e=>setSymbol(e.target.value)}>{SYMBOL_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></div><div><div className="label">週期</div><select className="select" value={interval} onChange={e=>setInterval(e.target.value)}>{INTERVAL_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></div><div><div className="label">操作</div><button className="button" onClick={loadData}><RefreshCw size={16} style={{verticalAlign:"text-bottom",marginRight:8}}/>{loading?"分析中":"重新分析"}</button></div></div>
<div className="note" style={{marginTop:14}}>自動抓 Binance 公開 K 線資料，整合 MA、RSI、MACD、ATR、結構、突破、量能、多週期共振與 AI 交易計畫。最後更新：{updated||"-"}</div>{error?<div className="note" style={{marginTop:12,background:"#fee2e2",color:"#991b1b"}}>{error}</div>:null}</div>
</div>
<div className="sidebar">
<div className="card sidebar-card">
<button className="sidebar-toggle" onClick={()=>setSidebarCollapsed(v=>!v)} aria-label={sidebarCollapsed?"展開側欄":"收合側欄"} title={sidebarCollapsed?"展開側欄":"收合側欄"}>
{sidebarCollapsed?<PanelRightOpen size={18}/>:<PanelRightClose size={18}/>}
</button>
{!sidebarCollapsed?<><div className="row" style={{justifyContent:"space-between",alignItems:"center"}}><div className="muted">本次結論</div><span className={`badge ${analysis?.finalDecision==="BUY"?"bull":analysis?.finalDecision==="SELL"?"bear":"flat"}`}>{analysis?.finalDecision||"讀取中"}</span></div>
<div className="zone" style={{marginTop:12}}><div className="label">趨勢偏向 / 信心等級</div><div style={{fontSize:22,fontWeight:800}}>{analysis?.bias||"-"} / {analysis?.confidenceLevel||"-"}</div></div>
<div className="zone" style={{marginTop:12}}><div className="label">是否適合進場</div><div style={{fontSize:26,fontWeight:800}}>{analysis?.entryAdvice||"-"}</div></div>
<div className="zone" style={{marginTop:12}}><div className="label">較佳策略 / Setup Type</div><div style={{fontSize:22,fontWeight:800}}>{analysis?.setup||"-"} / {analysis?.setupType||"-"}</div></div>
<div className="zone" style={{marginTop:12}}><div className="label">進場評分 / 最終評分 / 風險等級 / 共振</div><div style={{fontSize:20,fontWeight:800}}>{analysis?.entryScore||"-"} / 10 ・ {analysis?.finalScore||"-"} / 10 ・ {analysis?.riskLevel||"-"} ・ {analysis?.confluence||"-"}</div><div className="muted" style={{marginTop:6}}>市場狀態：{analysis?.marketState||"-"}；突破驗證：{analysis?.breakoutValidation?.quality||"-"}；位置品質：{analysis?.locationQuality?.label||"-"}</div></div>
<div className="ai" style={{marginTop:12}}><div style={{fontSize:12,textTransform:"uppercase",letterSpacing:1,color:"#cbd5e1",marginBottom:8}}>AI 綜合判斷</div><div>{analysis?.aiSummary||"等待資料中..."}</div></div></>:null}
</div></div>
</div>
<div className="kpis" style={{marginTop:16}}>
<Kpi title="現價" value={fmt(analysis?.price,d)} helper="即時收盤價"/><Kpi title="MA20" value={fmt(analysis?.ma20,d)} helper="20 均線"/><Kpi title="MA50" value={fmt(analysis?.ma50,d)} helper="50 均線"/><Kpi title="RSI" value={fmt(analysis?.rsi,2)} helper="14 週期"/><Kpi title="MACD 柱狀體" value={fmt(analysis?.macd?.histogram,4)} helper="正值偏強"/><Kpi title="結構" value={analysis?.structure||"-"} helper="上升 / 下降 / 盤整"/><Kpi title="突破狀態" value={analysis?.breakoutState||"-"} helper="突破 / 回踩 / 區間"/><Kpi title="突破驗證" value={analysis?.breakoutValidation?.quality||"-"} helper="strong / weak"/><Kpi title="量能狀態" value={analysis?.volumeState||"-"} helper="放量 / 量縮 / 一般"/><Kpi title="掃流動性" value={analysis?.liquiditySweep||"-"} helper="掃高 / 掃低"/><Kpi title="趨勢線" value={analysis?.trendlineState||"-"} helper="趨勢線狀態"/>
</div>
<div className="card" style={{marginTop:16}}><div style={{fontWeight:800,marginBottom:12}}>圖表、均線與支撐壓力</div><div style={{width:"100%",height:380,background:"#f1f5f9",borderRadius:18,padding:8}}>
<ResponsiveContainer width="100%" height="100%"><ComposedChart data={chartData} margin={{top:12,right:12,left:4,bottom:8}}><CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1"/><XAxis dataKey="time" minTickGap={24} tick={{fontSize:12}}/><YAxis yAxisId="left" domain={["auto","auto"]} tick={{fontSize:12}} width={70}/><YAxis yAxisId="right" orientation="right" tick={false} hide/><Tooltip content={<Tip symbol={symbol}/>}/><ReferenceArea yAxisId="left" y1={analysis?.levels?.structureSupportZone?.low} y2={analysis?.levels?.structureSupportZone?.high} fill="#16a34a" fillOpacity={0.08}/><ReferenceArea yAxisId="left" y1={analysis?.levels?.structureResistanceZone?.low} y2={analysis?.levels?.structureResistanceZone?.high} fill="#dc2626" fillOpacity={0.08}/><ReferenceLine yAxisId="left" y={analysis?.price} stroke="#0f172a" strokeDasharray="4 4"/><Bar yAxisId="right" dataKey="volume" opacity={0.22} radius={[3,3,0,0]}>{chartData.map((e,i)=><Cell key={i} fill={e.bullish?"#16a34a":"#dc2626"}/>)}</Bar><Bar yAxisId="left" dataKey="close" opacity={0.85}>{chartData.map((e,i)=><Cell key={i} fill={e.bullish?"#16a34a":"#dc2626"}/>)}</Bar><Line yAxisId="left" type="monotone" dataKey="ma20" dot={false} strokeWidth={2} stroke="#a855f7"/><Line yAxisId="left" type="monotone" dataKey="ma50" dot={false} strokeWidth={2} stroke="#eab308"/></ComposedChart></ResponsiveContainer></div><div className="muted" style={{marginTop:10}}>綠色區是結構支撐，紅色區是結構壓力，虛線是現價。這裡用色塊 K 線替代，可先直接用來看趨勢與區間。</div></div>
<div className="grid" style={{gridTemplateColumns:"repeat(auto-fit,minmax(320px,1fr))",marginTop:16}}>
<div className="card"><div style={{fontWeight:800,marginBottom:12}}>交易建議</div><div className="subgrid card-data-grid"><div className="zone"><div className="label">建議</div><div className="metric-value">{analysis?.setup||"-"}</div></div><div className="zone"><div className="label">決策</div><div className="metric-value">{analysis?.setupType||"-"} / {analysis?.finalDecision||"-"}</div></div><div className="zone"><div className="label">止損</div><div className="metric-value">{fmt(analysis?.stopLoss,d)}</div></div><div className="zone"><div className="label">止盈</div><div className="metric-value">{fmt(analysis?.takeProfit1,d)} / {fmt(analysis?.takeProfit2,d)}</div></div><div className="zone"><div className="label">區間</div><div className="metric-value">{fmt(candles.at(-1)?.low,d)} ~ {fmt(candles.at(-1)?.high,d)}</div></div></div><div className="note" style={{marginTop:12}}><div>• WAIT：條件未成熟，需等待回踩/反彈/有效突破確認。</div><div>• NO_TRADE：市場或位置明顯不佳，直接不交易。</div><div>• 假突破與位置品質會直接下修評分與信心等級。</div>{(analysis?.decisionReasons||[]).length?<div style={{marginTop:6}}>• 決策原因：{analysis.decisionReasons.join("；")}</div>:null}{(analysis?.waitConditions||[]).length?<div style={{marginTop:6}}>• 等待條件：{analysis.waitConditions.join("；")}</div>:null}</div><div className="subgrid card-data-grid" style={{marginTop:12}}><div className="zone"><div className="label">進場區</div><div className="metric-value">{analysis?.tradePlan?.entryZone||"-"}</div></div><div className="zone"><div className="label">失效位</div><div className="metric-value">{analysis?.tradePlan?.invalidation||"-"}</div></div><div className="zone"><div className="label">目標一</div><div className="metric-value">{analysis?.tradePlan?.target1||"-"}</div></div><div className="zone"><div className="label">目標二</div><div className="metric-value">{analysis?.tradePlan?.target2||"-"}</div></div><div className="zone"><div className="label">R/R</div><div className="metric-value">{analysis?.tradePlan?.riskReward||"-"}</div></div></div></div>
<div className="card"><div style={{fontWeight:800,marginBottom:12}}>即時資料摘要</div><div className="subgrid card-data-grid"><div className="zone"><div className="label">短撐區</div><div className="metric-value">{fmt(analysis?.levels?.shortSupportZone?.low,d)} ~ {fmt(analysis?.levels?.shortSupportZone?.high,d)}</div></div><div className="zone"><div className="label">短壓區</div><div className="metric-value">{fmt(analysis?.levels?.shortResistanceZone?.low,d)} ~ {fmt(analysis?.levels?.shortResistanceZone?.high,d)}</div></div><div className="zone"><div className="label">結構撐區</div><div className="metric-value">{fmt(analysis?.levels?.structureSupportZone?.low,d)} ~ {fmt(analysis?.levels?.structureSupportZone?.high,d)}</div></div><div className="zone"><div className="label">結構壓區</div><div className="metric-value">{fmt(analysis?.levels?.structureResistanceZone?.low,d)} ~ {fmt(analysis?.levels?.structureResistanceZone?.high,d)}</div></div><div className="zone"><div className="label">ATR</div><div className="metric-value">{fmt(analysis?.atr,d)}</div></div><div className="zone"><div className="label">位置 / 假突破</div><div className="metric-value">{analysis?.locationQuality?.label||"-"} / {analysis?.fakeBreakoutRisk||"-"}</div></div></div><div className="note" style={{marginTop:12}}><div style={{fontWeight:700,color:"#334155",marginBottom:6}}>AI 訊號細節</div><div>多方分數：{fmt(analysis?.bullScore,1)}</div><div>空方分數：{fmt(analysis?.bearScore,1)}</div><div>成交量：{fmt(candles.at(-1)?.volume,2)}</div><div>動能強度：{fmt(analysis?.momentumStrength,2)}；趨勢強度：{fmt(analysis?.trendStrength,2)}</div><div style={{marginTop:10,fontWeight:700,color:"#334155"}}>高週期同步</div>{(analysis?.higherBiases||[]).map(item=><div key={item.interval} style={{display:"flex",justifyContent:"space-between",background:"#f8fafc",padding:"10px 12px",borderRadius:12,marginTop:8}}><span>{item.interval}</span><span>{item.bias}</span></div>)}</div></div></div>
</div>}
