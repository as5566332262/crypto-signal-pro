import React from "react";
import { RefreshCw, AlertTriangle, ChevronDown, TrendingUp, TrendingDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  ResponsiveContainer,
  ComposedChart,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Line,
  Bar,
  ReferenceArea,
  ReferenceLine,
  ReferenceDot,
  Cell,
} from "recharts";

function valueTone(value) {
  if (value === "BUY" || value === "LONG" || value === "偏多") return "bg-emerald-100 text-emerald-700";
  if (value === "SELL" || value === "SHORT" || value === "偏空") return "bg-rose-100 text-rose-700";
  return "bg-slate-100 text-slate-700";
}

function decisionTone(decision) {
  if (decision === "BUY" || decision === "LONG") {
    return {
      pill: "bg-emerald-500/15 text-emerald-700 ring-1 ring-emerald-300",
      glow: "from-emerald-100 to-emerald-50 border-emerald-200",
    };
  }
  if (decision === "SELL" || decision === "SHORT") {
    return {
      pill: "bg-rose-500/15 text-rose-700 ring-1 ring-rose-300",
      glow: "from-rose-100 to-rose-50 border-rose-200",
    };
  }
  return {
    pill: "bg-amber-500/15 text-amber-700 ring-1 ring-amber-300",
    glow: "from-amber-100 to-amber-50 border-amber-200",
  };
}

function trapSignalText(signal) {
  if (signal === "BULL_TRAP") return "誘多";
  if (signal === "BEAR_TRAP") return "誘空";
  return "無明顯陷阱訊號";
}

function resolveZoneBounds(analysis) {
  const zoneLow = Number(
    analysis?.zoneLow
    ?? analysis?.levels?.zoneLow
    ?? analysis?.levels?.structureSupportZone?.low
    ?? analysis?.levels?.structureSupportZone?.high
  );
  const zoneHigh = Number(
    analysis?.zoneHigh
    ?? analysis?.levels?.zoneHigh
    ?? analysis?.levels?.structureResistanceZone?.high
    ?? analysis?.levels?.structureResistanceZone?.low
  );
  const hasZone = Number.isFinite(zoneLow) && Number.isFinite(zoneHigh) && zoneHigh > zoneLow;
  return { zoneLow, zoneHigh, hasZone };
}

function getZonePosition(currentPrice, zoneLow, zoneHigh) {
  if (!Number.isFinite(currentPrice) || !Number.isFinite(zoneLow) || !Number.isFinite(zoneHigh) || zoneHigh <= zoneLow) return "-";
  if (currentPrice <= zoneLow) return "下半段";
  if (currentPrice >= zoneHigh) return "上半段";
  const ratio = (currentPrice - zoneLow) / (zoneHigh - zoneLow);
  if (ratio >= 2 / 3) return "上半段";
  if (ratio <= 1 / 3) return "下半段";
  return "中段";
}

function getDistanceHint(distance) {
  if (!Number.isFinite(distance)) return "-";
  if (distance < 15) return "接近";
  if (distance <= 40) return "中等";
  return "尚遠";
}

function CandlestickBody(props) {
  const { x, width, payload } = props;
  if (!payload) return null;
  const bullish = payload.close >= payload.open;

  return (
    <g>
      <line
        x1={x + width / 2}
        x2={x + width / 2}
        y1={payload.highY}
        y2={payload.lowY}
        stroke={bullish ? "#16a34a" : "#dc2626"}
        strokeWidth={1.5}
      />
      <rect
        x={x + width * 0.2}
        y={Math.min(payload.openY, payload.closeY)}
        width={width * 0.6}
        height={Math.max(2, Math.abs(payload.closeY - payload.openY))}
        fill={bullish ? "#16a34a" : "#dc2626"}
        rx={1}
      />
    </g>
  );
}

function CustomTooltip({ active, payload, label, symbol, formatNumber }) {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0]?.payload || {};
  const digits = symbol === "BTCUSDT" ? 0 : 2;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 text-sm shadow-lg">
      <div className="mb-2 font-medium">{label}</div>
      <div>開盤: {formatNumber(row.open, digits)}</div>
      <div>最高: {formatNumber(row.high, digits)}</div>
      <div>最低: {formatNumber(row.low, digits)}</div>
      <div>收盤: {formatNumber(row.close, digits)}</div>
      <div>MA20: {formatNumber(row.ma20, digits)}</div>
      <div>MA50: {formatNumber(row.ma50, digits)}</div>
      <div>成交量: {formatNumber(row.volume, 2)}</div>
    </div>
  );
}

export function DecisionHeader({ symbolLabel, currentPrice, regime, actionLabel, confidenceLabel, lastUpdated, digits, formatNumber, marketPosition }) {
  const blocks = [
    { label: "幣種", value: symbolLabel },
    { label: "價格", value: formatNumber(currentPrice, digits), subValue: `位置：${marketPosition || "-"}` },
    { label: "市場狀態", value: regime || "-" },
    { label: "更新時間", value: lastUpdated || "-" },
  ];

  return (
    <Card className="rounded-3xl border border-slate-800/80 bg-slate-950 text-slate-100 shadow-[0_10px_40px_-20px_rgba(15,23,42,0.9)]">
      <CardHeader className="px-5 pt-5 pb-3 sm:px-6">
        <CardTitle className="text-base tracking-[0.18em] text-slate-300">交易終端狀態列</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-y-3 border-t border-slate-800 px-5 pt-4 pb-5 sm:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.35fr)] sm:px-6">
        {blocks.map((item, index) => (
          <div key={item.label} className={`pr-4 ${index < blocks.length - 1 ? "border-r border-slate-800/90" : ""}`}>
            <div className="text-[11px] tracking-[0.12em] text-slate-500">{item.label}</div>
            <div className="mt-1.5 text-sm font-semibold tracking-wide text-slate-100">{item.value}</div>
            {item.subValue ? <div className="mt-1 text-xs tracking-wide text-slate-400">{item.subValue}</div> : null}
          </div>
        ))}
        <div className="rounded-2xl border border-slate-700/80 bg-slate-900/80 px-3.5 py-2.5">
          <div className="text-[11px] tracking-[0.12em] text-slate-500">AI決策</div>
          <div className="mt-1.5 flex items-center justify-between gap-3">
            <Badge className={`rounded-full px-3 py-1 text-sm font-semibold tracking-wide ${valueTone(actionLabel)}`}>{actionLabel || "-"}</Badge>
            <span className="text-xs text-slate-300">信心等級 <span className="font-semibold text-slate-100">{confidenceLabel || "-"}</span></span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function DecisionCard({ analysis, formatNumber }) {
  const decisionData = analysis?.aiDecisionOutput || analysis;
  const tone = decisionTone(decisionData?.action === "LONG" ? "LONG" : decisionData?.action === "SHORT" ? "SHORT" : analysis?.bias);
  const { zoneLow, zoneHigh, hasZone } = resolveZoneBounds(analysis);
  const currentPrice = Number(analysis?.price);
  const triggerPrice = Number(
    analysis?.aiDecisionOutput?.executionPlan?.triggerPrice
    ?? analysis?.executionPlan?.triggerPrice
    ?? analysis?.aiDecisionOutput?.triggerPrice
    ?? analysis?.triggerPrice
  );
  const rawDistanceToEntry = Number(analysis?.distanceToEntry ?? analysis?.distanceToTriggerPrice ?? analysis?.distances?.entry);
  const distanceToEntry = Number.isFinite(rawDistanceToEntry)
    ? Math.abs(rawDistanceToEntry)
    : (Number.isFinite(currentPrice) && Number.isFinite(triggerPrice) ? Math.abs(currentPrice - triggerPrice) : Number.NaN);
  const distanceHint = getDistanceHint(distanceToEntry);
  const reasonTags = (analysis?.waitReasons || analysis?.waitForConditions || [])
    .filter(Boolean)
    .slice(0, 4);
  const defaultTags = ["價格在區間中段", "未觸及支撐", "RR 不佳"];
  const marketLocation = getZonePosition(currentPrice, zoneLow, zoneHigh);
  const isTradable = analysis?.finalDecision === "TRADE" || ["LONG", "SHORT", "BUY", "SELL"].includes(analysis?.finalDecision);
  const decisionLabel = isTradable ? "可交易" : "不交易";

  return (
    <Card className="rounded-3xl border-2 border-slate-900 shadow-[0_12px_30px_-18px_rgba(15,23,42,0.55)]">
      <CardHeader className="px-5 pt-5 pb-3 sm:px-6">
        <CardTitle className="text-2xl tracking-tight">交易員一眼決策版</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 px-5 pb-6 text-sm sm:px-6">
        <div className={`rounded-2xl border bg-gradient-to-r p-5 ${tone.glow}`}>
          <div className="text-xs font-semibold tracking-[0.16em] text-slate-600">DECISION</div>
          <div className="mt-2 text-4xl font-black tracking-wide text-slate-900">{decisionLabel}</div>
          <div className="mt-2 text-lg font-bold text-slate-800">
            距離進場：{Number.isFinite(distanceToEntry) ? `↓ ${formatNumber(distanceToEntry, 2)} USDT（${distanceHint}）` : "-"}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge className="rounded-full border border-slate-300 bg-white/85 px-2.5 py-0.5 text-xs text-slate-700">
              距離：{Number.isFinite(distanceToEntry) ? `↓ ${formatNumber(distanceToEntry, 2)} USDT` : "-"}
            </Badge>
            <Badge className="rounded-full border border-slate-300 bg-white/85 px-2.5 py-0.5 text-xs text-slate-700">
              距離判斷：{distanceHint}
            </Badge>
            <Badge className="rounded-full border border-slate-300 bg-white/85 px-2.5 py-0.5 text-xs text-slate-700">
              位置：{marketLocation}
            </Badge>
            {(reasonTags.length ? reasonTags : defaultTags).map((reason) => (
              <Badge key={reason} className="rounded-full border border-slate-300 bg-white/85 px-2.5 py-0.5 text-xs text-slate-700">
                {reason}
              </Badge>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-semibold tracking-[0.14em] text-slate-500">位置判斷</div>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <div className="rounded-lg bg-slate-50 p-2"><span className="text-xs text-slate-500">現價</span><div className="font-semibold">{formatNumber(currentPrice, 2)}</div></div>
            <div className="rounded-lg bg-slate-50 p-2"><span className="text-xs text-slate-500">支撐</span><div className="font-semibold">{formatNumber(zoneLow, 2)}</div></div>
            <div className="rounded-lg bg-slate-50 p-2"><span className="text-xs text-slate-500">壓力</span><div className="font-semibold">{formatNumber(zoneHigh, 2)}</div></div>
          </div>
          <div className="mt-2 text-sm font-semibold text-slate-700">區間位置：{marketLocation}</div>
          {!hasZone ? <div className="mt-1 text-xs text-slate-500">尚無有效區間資料</div> : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function TradePlanCard({ analysis, digits, formatNumber }) {
  const executionPlan = analysis?.aiDecisionOutput?.executionPlan || analysis?.executionPlan || {};
  const executionMode = String(executionPlan?.executionMode || "").toUpperCase();
  const executionModeLabel = executionMode === "BREAKOUT" ? "Breakout" : executionMode === "PULLBACK" ? "Pullback" : "-";
  const modeReasons = Array.isArray(executionPlan?.modeSelectionReasons) ? executionPlan.modeSelectionReasons : [];
  const entryValue = executionMode === "PULLBACK"
    ? [executionPlan?.entryLow, executionPlan?.entryHigh].every((value) => value != null)
      ? `${formatNumber(executionPlan?.entryLow, digits)} ~ ${formatNumber(executionPlan?.entryHigh, digits)}`
      : (executionPlan?.entryMid != null ? formatNumber(executionPlan?.entryMid, digits) : "-")
    : (executionPlan?.triggerPrice != null ? formatNumber(executionPlan?.triggerPrice, digits) : "-");
  const isHold = executionPlan?.action === "HOLD" || analysis?.finalDecision === "WAIT" || analysis?.finalDecision === "NO_TRADE";
  const topChecklist = [
    { label: "模式（Mode）", shortLabel: "Mode", value: executionModeLabel },
    { label: "進場（Entry）", shortLabel: "Entry", value: entryValue },
    { label: "止損（Stop）", shortLabel: "Stop", value: formatNumber(executionPlan?.stopLoss, digits) },
    { label: "止盈（TP）", shortLabel: "TP", value: [executionPlan?.takeProfit1, executionPlan?.takeProfit2, executionPlan?.takeProfit3].filter((v) => v != null).map((v) => formatNumber(v, digits)).join(" / ") || "-" },
  ];
  const pullbackChecklist = [
    ...(executionPlan?.retestConfirmationRules || []),
    ...(executionPlan?.momentumRecoveryRules || []),
  ];
  const breakoutChecklist = [
    ...(executionPlan?.breakoutConfirmationRules || []),
    ...(executionPlan?.retestConfirmationRules || []),
  ];
  const listBlock = (title, rows) => (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="text-xs font-semibold tracking-[0.12em] text-slate-500">{title}</div>
      <ul className="mt-2 list-disc space-y-1.5 pl-4 text-sm text-slate-700">
        {(rows || []).filter(Boolean).map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );

  return (
    <Card className="rounded-3xl shadow-sm">
      <CardHeader className="px-5 pt-5 pb-3 sm:px-6"><CardTitle>執行計畫</CardTitle></CardHeader>
      <CardContent className="space-y-4 px-5 pb-5 text-sm sm:px-6">
        <div className={`rounded-2xl border p-3.5 ${isHold ? "border-amber-200 bg-amber-50/80 text-amber-900" : "border-slate-200 bg-slate-50/70 text-slate-900"}`}>
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
            <span className="font-semibold">Summary：</span>
            {topChecklist[0].label} {topChecklist[0].value || "-"} / {topChecklist[1].label} {topChecklist[1].value || "-"} / {topChecklist[2].label} {topChecklist[2].value || "-"}
          </div>
          <div className="text-xs font-semibold tracking-[0.16em] text-slate-600">EXECUTION CHECKLIST</div>
          <div className="mt-3 grid gap-2.5 sm:grid-cols-4">
            {topChecklist.map((item) => (
              <div key={item.label} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2">
                <div className="text-xs font-semibold text-slate-500">{item.label}</div>
                <div className="text-sm leading-snug text-slate-900">{item.value || "-"}</div>
              </div>
            ))}
          </div>
          <details className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
            <summary className="cursor-pointer text-xs font-semibold tracking-[0.12em] text-slate-600">展開詳細條件</summary>
            <div className="mt-3 grid gap-2.5">
              {executionMode === "BREAKOUT" ? listBlock("為何採用 Breakout", modeReasons) : null}
              {executionMode === "PULLBACK" ? listBlock("回踩條件", pullbackChecklist) : null}
              {executionMode === "PULLBACK" ? listBlock("動能恢復", executionPlan?.momentumRecoveryRules) : null}
              {executionMode === "PULLBACK" ? listBlock("MTF", executionPlan?.mtfAlignmentRules) : null}
              {executionMode === "BREAKOUT" ? listBlock("突破條件", breakoutChecklist) : null}
              {executionMode === "BREAKOUT" ? listBlock("volume", executionPlan?.breakoutConfirmationRules?.filter((rule) => String(rule).includes("成交量"))) : null}
              {executionMode === "BREAKOUT" ? listBlock("確認狀態", executionPlan?.nextConfirmationRules) : null}
              {listBlock("失效條件", executionPlan?.invalidationRules)}
            </div>
          </details>
        </div>
        <div className="rounded-xl border border-slate-200 p-3">
          <div className="text-slate-500">倉位 / 槓桿</div>
          <div className="font-semibold">1x 模擬單位 · 無槓桿</div>
        </div>
      </CardContent>
    </Card>
  );
}

export function ChartPanel({ chartData, analysis, symbol, timeframeLabel, formatNumber, paperState, paperSymbol }) {
  const activePosition = (paperState?.openPositions || []).find((position) => position.symbol === paperSymbol);
  const activePendingOrder = (paperState?.pendingOrders || []).find((order) => order.symbol === paperSymbol);
  const entryPointLabel = activePosition?.entryCandleTime
    ? chartData.find((row) => Number(row.openTime) === Number(activePosition.entryCandleTime))?.time
    : null;
  const overlays = [
    { label: "Entry", tone: "bg-slate-100 text-slate-700" },
    { label: "Stop Loss", tone: "bg-rose-100 text-rose-700" },
    { label: "Take Profit", tone: "bg-emerald-100 text-emerald-700" },
    { label: "Trap Zone", tone: "bg-orange-100 text-orange-700" },
    { label: "Position", tone: "bg-indigo-100 text-indigo-700" },
  ];

  return (
    <Card className="rounded-3xl shadow-sm">
      <CardHeader className="px-5 pt-5 pb-3 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>價格圖表</CardTitle>
            <div className="mt-1 text-xs text-slate-500">Execution Workspace · {timeframeLabel}</div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5">
            {overlays.map((item) => (
              <Badge key={item.label} className={`rounded-full px-2 py-0.5 text-[11px] ${item.tone}`}>{item.label}</Badge>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5 sm:px-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-2.5 shadow-inner shadow-slate-100/60">
          <div className="h-[360px] w-full rounded-xl border border-slate-200 bg-slate-50 p-2">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 12, right: 12, left: 4, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1" />
              <XAxis dataKey="time" minTickGap={24} tick={{ fontSize: 12 }} />
              <YAxis yAxisId="left" domain={["auto", "auto"]} tick={{ fontSize: 12 }} width={70} />
              <YAxis yAxisId="right" orientation="right" tick={false} hide />
              <Tooltip content={<CustomTooltip symbol={symbol} formatNumber={formatNumber} />} />

              <ReferenceArea yAxisId="left" y1={analysis?.levels?.structureSupportZone?.low} y2={analysis?.levels?.structureSupportZone?.high} fill="#16a34a" fillOpacity={0.08} />
              <ReferenceArea yAxisId="left" y1={analysis?.levels?.structureResistanceZone?.low} y2={analysis?.levels?.structureResistanceZone?.high} fill="#dc2626" fillOpacity={0.08} />
              {analysis?.trapDetection?.trapSignal !== "NONE" ? (
                <ReferenceArea
                  yAxisId="left"
                  y1={analysis?.trapDetection?.trapZoneLow}
                  y2={analysis?.trapDetection?.trapZoneHigh}
                  fill="#f97316"
                  fillOpacity={0.12}
                />
              ) : null}

              <ReferenceLine yAxisId="left" y={analysis?.price} stroke="#0f172a" strokeDasharray="4 4" label="現價" />
              <ReferenceLine yAxisId="left" y={analysis?.stopLoss} stroke="#ef4444" strokeDasharray="3 3" label="SL" />
              <ReferenceLine yAxisId="left" y={analysis?.takeProfit1} stroke="#22c55e" strokeDasharray="3 3" label="TP1" />
              <ReferenceLine yAxisId="left" y={analysis?.takeProfit2} stroke="#16a34a" strokeDasharray="3 3" label="TP2" />
              {analysis?.executionPlan?.triggerPrice ? (
                <ReferenceLine yAxisId="left" y={analysis?.executionPlan?.triggerPrice} stroke="#0284c7" strokeDasharray="5 5" label="Trigger" />
              ) : null}
              {activePendingOrder?.triggerPrice ? (
                <ReferenceLine
                  yAxisId="left"
                  y={activePendingOrder.triggerPrice}
                  stroke="#0ea5e9"
                  strokeDasharray="2 6"
                  label={`Pending ${activePendingOrder.side === "SHORT" ? "SHORT" : "LONG"} x ${Number(activePendingOrder.quantity || 0)}`}
                />
              ) : null}
              {activePendingOrder?.invalidationPrice ? (
                <ReferenceLine yAxisId="left" y={activePendingOrder.invalidationPrice} stroke="#f97316" strokeDasharray="2 4" label="Inv" />
              ) : null}
              {activePosition?.entryPrice ? (
                <ReferenceLine
                  yAxisId="left"
                  y={activePosition.entryPrice}
                  stroke="#6366f1"
                  strokeDasharray="5 3"
                  label={`${activePosition.side === "SHORT" ? "SHORT" : "LONG"} Position x ${Number(activePosition.quantity || 0)}`}
                />
              ) : null}
              {activePosition?.stopLoss ? (
                <ReferenceLine yAxisId="left" y={activePosition.stopLoss} stroke="#ef4444" strokeDasharray="3 3" label="Pos SL" />
              ) : null}
              {activePosition?.takeProfit1 ? (
                <ReferenceLine yAxisId="left" y={activePosition.takeProfit1} stroke="#22c55e" strokeDasharray="3 3" label="Pos TP1" />
              ) : null}
              {activePosition?.takeProfit2 ? (
                <ReferenceLine yAxisId="left" y={activePosition.takeProfit2} stroke="#16a34a" strokeDasharray="3 3" label="Pos TP2" />
              ) : null}
              {activePosition?.takeProfit3 ? (
                <ReferenceLine yAxisId="left" y={activePosition.takeProfit3} stroke="#15803d" strokeDasharray="3 3" label="Pos TP3" />
              ) : null}
              {activePosition?.openedAt ? (
                <ReferenceDot
                  yAxisId="left"
                  x={entryPointLabel || chartData.at(-1)?.time}
                  y={activePosition.entryPrice}
                  r={4}
                  fill="#4f46e5"
                  stroke="none"
                />
              ) : null}

              <Bar yAxisId="right" dataKey="volume" opacity={0.22} radius={[3, 3, 0, 0]}>
                {chartData.map((entry, index) => <Cell key={`vol-${index}`} fill={entry.bullish ? "#16a34a" : "#dc2626"} />)}
              </Bar>
              <Bar yAxisId="left" dataKey="bodyValue" baseValue={(data) => data.bodyBase} shape={<CandlestickBody />} isAnimationActive={false}>
                {chartData.map((entry, index) => <Cell key={`candle-${index}`} fill={entry.bullish ? "#16a34a" : "#dc2626"} />)}
              </Bar>
              <Line yAxisId="left" type="monotone" dataKey="ma20" dot={false} strokeWidth={2} stroke="#a855f7" />
              <Line yAxisId="left" type="monotone" dataKey="ma50" dot={false} strokeWidth={2} stroke="#eab308" />
            </ComposedChart>
          </ResponsiveContainer>
          </div>
        </div>
        <div className="mt-2 text-xs text-slate-500">圖層對齊已優化，便於後續掛單與風險線疊加。</div>
      </CardContent>
    </Card>
  );
}

export function MarketContextCard({ analysis, currentCandle, digits, formatNumber }) {
  const trap = analysis?.trapDetection;
  const trapZone = trap?.trapZoneLow != null && trap?.trapZoneHigh != null
    ? `${formatNumber(trap?.trapZoneLow, digits)} ~ ${formatNumber(trap?.trapZoneHigh, digits)}`
    : "-";
  return (
    <Card className="rounded-3xl shadow-sm">
      <CardHeader className="px-5 pt-5 pb-3 sm:px-6"><CardTitle>市場結構</CardTitle></CardHeader>
      <CardContent className="grid gap-3 px-5 pb-5 text-sm sm:grid-cols-2 sm:px-6">
        <div className="rounded-xl bg-slate-50 p-3"><div className="text-slate-500">結構</div><div className="font-semibold">{analysis?.structure || "-"}</div></div>
        <div className="rounded-xl bg-slate-50 p-3"><div className="text-slate-500">突破狀態</div><div className="font-semibold">{analysis?.breakoutState || "-"}</div></div>
        <div className="rounded-xl bg-slate-50 p-3"><div className="text-slate-500">量能狀態</div><div className="font-semibold">{analysis?.volumeState || "-"}</div></div>
        <div className="rounded-xl bg-slate-50 p-3"><div className="text-slate-500">假突破風險</div><div className="font-semibold">{analysis?.fakeBreakout?.risk || "-"}</div></div>
        <div className="rounded-xl bg-slate-50 p-3"><div className="text-slate-500">ATR 波動</div><div className="font-semibold">{formatNumber(analysis?.atr, digits)}</div></div>
        <div className="rounded-xl bg-slate-50 p-3"><div className="text-slate-500">目前 K 線</div><div className="font-semibold">{formatNumber(currentCandle?.low, digits)} ~ {formatNumber(currentCandle?.high, digits)}</div></div>
        <div className="col-span-full rounded-xl border border-orange-200 bg-orange-50/80 p-3">
          <div className="text-xs font-semibold tracking-[0.12em] text-orange-700">陷阱訊號</div>
          <div className="mt-1 grid gap-1 text-sm text-orange-900 sm:grid-cols-2">
            <div>訊號：<span className="font-semibold">{trapSignalText(trap?.trapSignal)}</span></div>
            <div>信心：<span className="font-semibold">{trap?.trapConfidence || "-"}</span></div>
            <div>區間：<span className="font-semibold">{trapZone}</span></div>
            <div>原因：<span className="font-semibold">{trap?.trapReason || "-"}</span></div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function AIAnalysisAccordion({ analysis, showRawOutput = false }) {
  const formatMtfBias = (value) => {
    if (value === "bullish") return "bullish（偏多）";
    if (value === "bearish") return "bearish（偏空）";
    if (value === "neutral") return "neutral（中性）";
    return value || "-";
  };
  const trapText = analysis?.trapDetection?.trapSignal === "NONE"
    ? "無明顯陷阱"
    : `${trapSignalText(analysis?.trapDetection?.trapSignal)}風險（${analysis?.trapDetection?.trapConfidence || "-"})`;
  const oneLineSummary = `AI分析：${analysis?.marketRegimeLabel || "市場狀態未定"} + ${analysis?.confluence || "多週期分歧"}，${trapText}，${analysis?.noEntryReason || "暫無有效 setup"}`;
  return (
    <Card className="rounded-3xl border border-slate-200/80 bg-slate-50 shadow-sm">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between px-5 pt-5 pb-4 sm:px-6">
          <div>
            <div className="text-base font-semibold text-slate-800">AI 分析</div>
            <div className="mt-0.5 text-xs text-slate-500">{oneLineSummary}</div>
          </div>
          <ChevronDown className="h-4 w-4 text-slate-500 transition group-open:rotate-180" />
        </summary>
        <CardContent className="space-y-3 pt-0 text-sm">
          <div><span className="font-semibold">多週期：</span>{(analysis?.higherBiases || []).map((item) => `${item.interval}:${formatMtfBias(item.bias)}`).join(" · ") || "-"}</div>
          <div><span className="font-semibold">指標摘要：</span>RSI {analysis?.rsi?.toFixed?.(2) || "-"}, MACD {analysis?.macd?.histogram?.toFixed?.(4) || "-"}</div>
          <div><span className="font-semibold">市場結構：</span>{analysis?.structure || "-"} / {analysis?.breakoutState || "-"}</div>
          <div><span className="font-semibold">陷阱判讀：</span>{trapSignalText(analysis?.trapDetection?.trapSignal)}（{analysis?.trapDetection?.trapConfidence || "-"})</div>
          <div><span className="font-semibold">陷阱驗證：</span>{(analysis?.trapDetection?.trapValidationRules || []).join("、") || "-"}</div>
          <div><span className="font-semibold">陷阱失效：</span>{(analysis?.trapDetection?.trapInvalidationRules || []).join("、") || "-"}</div>
          <div><span className="font-semibold">風險警示：</span>{(analysis?.waitReasons || []).join("、") || "無"}</div>
          <pre className="whitespace-pre-wrap rounded-xl bg-slate-800 p-3 text-xs text-slate-100">{analysis?.aiSummary || "-"}</pre>
          {showRawOutput ? (
            <details className="rounded-xl border border-slate-200 bg-white p-3">
              <summary className="cursor-pointer text-xs font-semibold tracking-[0.12em] text-slate-600">開發者模式：AiDecisionOutput JSON</summary>
              <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-900 p-2.5 text-[11px] text-slate-100">
                {JSON.stringify(analysis?.aiDecisionOutput || {}, null, 2)}
              </pre>
            </details>
          ) : null}
        </CardContent>
      </details>
    </Card>
  );
}

export default function TradingDecisionPage({
  symbol,
  setSymbol,
  timeframe,
  setTimeframe,
  symbolOptions,
  intervalOptions,
  loadData,
  isLoading,
  autoRefresh,
  setAutoRefresh,
  error,
  analysis,
  timeframeLabel,
  lastUpdated,
  chartData,
  currentCandle,
  formatNumber,
  digits,
  showDevOutput = false,
  paperState,
  paperSymbol,
}) {
  const symbolLabel = symbolOptions.find((item) => item.value === symbol)?.label || symbol;
  const { zoneLow, zoneHigh } = resolveZoneBounds(analysis);
  const marketPosition = getZonePosition(Number(analysis?.price), zoneLow, zoneHigh);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-7 px-1 sm:px-2">
      <Card className="rounded-3xl border-0 shadow-md">
        <CardContent className="grid gap-3 p-4 md:grid-cols-4">
          <Select value={symbol} onValueChange={setSymbol}>
            <SelectTrigger className="rounded-2xl bg-white"><SelectValue /></SelectTrigger>
            <SelectContent>{symbolOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={timeframe} onValueChange={setTimeframe}>
            <SelectTrigger className="rounded-2xl bg-white"><SelectValue /></SelectTrigger>
            <SelectContent>{intervalOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
          </Select>
          <Button className="rounded-2xl" onClick={() => loadData(symbol, timeframe)} disabled={isLoading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />重新整理
          </Button>
          <Button variant={autoRefresh ? "default" : "outline"} className="rounded-2xl" onClick={() => setAutoRefresh((v) => !v)}>
            自動更新：{autoRefresh ? "開啟" : "關閉"}
          </Button>
        </CardContent>
      </Card>

      {error ? <Alert className="rounded-2xl border-rose-200 bg-rose-50 text-rose-700"><AlertTriangle className="h-4 w-4" /><AlertDescription>{error}</AlertDescription></Alert> : null}

      <DecisionHeader
        symbolLabel={symbolLabel}
        currentPrice={analysis?.price}
        regime={analysis?.marketRegimeLabel}
        actionLabel={analysis?.finalDecisionLabel}
        confidenceLabel={analysis?.confidenceLevelLabel}
        lastUpdated={lastUpdated}
        digits={digits}
        formatNumber={formatNumber}
        marketPosition={marketPosition}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="min-w-0 space-y-6">
          <DecisionCard analysis={analysis} formatNumber={formatNumber} />
          <TradePlanCard analysis={analysis} digits={digits} formatNumber={formatNumber} />
          <AIAnalysisAccordion analysis={analysis} showRawOutput={showDevOutput} />
        </div>
        <div className="min-w-0 space-y-6">
          <ChartPanel chartData={chartData} analysis={analysis} symbol={symbol} timeframeLabel={timeframeLabel} formatNumber={formatNumber} paperState={paperState} paperSymbol={paperSymbol} />
          <MarketContextCard analysis={analysis} currentCandle={currentCandle} digits={digits} formatNumber={formatNumber} />
        </div>
      </div>
    </div>
  );
}
