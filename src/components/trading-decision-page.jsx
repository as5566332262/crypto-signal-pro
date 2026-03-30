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

export function DecisionHeader({ symbolLabel, currentPrice, regime, actionLabel, confidenceLabel, lastUpdated, digits, formatNumber }) {
  const blocks = [
    { label: "幣種", value: symbolLabel },
    { label: "價格", value: formatNumber(currentPrice, digits) },
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

export function DecisionCard({ analysis }) {
  const tone = decisionTone(analysis?.bias);
  const summaryLine = analysis?.triggerEngine?.statusLine || analysis?.triggerEngine?.waitConditionSentence || analysis?.noEntryReason || "等待結構與訊號同步";
  const metricSignals = [
    { label: "信心", value: analysis?.confidenceLevelLabel || "-", tone: "bg-violet-100 text-violet-700 ring-violet-200" },
    { label: "風險", value: analysis?.riskLevel || "-", tone: "bg-amber-100 text-amber-700 ring-amber-200" },
    { label: "觸發", value: analysis?.triggerEngine?.confirmationLabel || "-", tone: "bg-sky-100 text-sky-700 ring-sky-200" },
    { label: "MTF 一致", value: analysis?.confluence || "-", tone: "bg-emerald-100 text-emerald-700 ring-emerald-200" },
  ];

  return (
    <Card className="rounded-3xl border-2 border-slate-900 shadow-[0_12px_30px_-18px_rgba(15,23,42,0.55)]">
      <CardHeader className="px-5 pt-5 pb-3 sm:px-6">
        <CardTitle className="text-2xl tracking-tight">決策中心</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 px-5 pb-6 text-sm sm:px-6">
        <div className={`rounded-2xl border bg-gradient-to-r p-5 ${tone.glow}`}>
          <div className="text-xs font-semibold tracking-[0.16em] text-slate-600">FINAL DECISION</div>
          <div className="mt-3 flex items-center justify-between gap-4">
            <Badge className={`rounded-full px-5 py-2.5 text-2xl font-extrabold tracking-[0.08em] ${tone.pill}`}>
              {analysis?.finalDecisionLabel || "-"}
            </Badge>
            <div className="text-xs font-medium text-slate-500">請優先依此執行</div>
          </div>
          <div className="mt-3 rounded-xl bg-white/70 px-3 py-2 text-sm text-slate-700">{summaryLine}</div>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {metricSignals.map((metric) => (
            <div key={metric.label} className="rounded-xl border border-slate-200 bg-white p-2.5">
              <div className="text-[11px] tracking-[0.12em] text-slate-500">{metric.label}</div>
              <div className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-sm font-semibold ring-1 ${metric.tone}`}>{metric.value}</div>
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-slate-600">{analysis?.explanation || "-"}</div>
      </CardContent>
    </Card>
  );
}

export function TradePlanCard({ analysis, digits, formatNumber }) {
  const isHold = analysis?.finalDecision === "WAIT" || analysis?.finalDecision === "NO_TRADE";
  const checklistItems = [
    { label: "目前動作", value: "觀望，暫不進場" },
    { label: "等待條件", value: analysis?.triggerEngine?.waitConditionSentence || "結構明確轉強或轉弱" },
    { label: "下一步確認", value: "價格有效突破關鍵區間 + 多週期方向一致" },
    { label: "失效條件", value: analysis?.noEntryReason || "動能與結構再次背離時取消計畫" },
  ];

  return (
    <Card className="rounded-3xl shadow-sm">
      <CardHeader className="px-5 pt-5 pb-3 sm:px-6"><CardTitle>執行計畫</CardTitle></CardHeader>
      <CardContent className="space-y-4 px-5 pb-5 text-sm sm:px-6">
        {isHold ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-3.5 text-amber-900">
            <div className="text-xs font-semibold tracking-[0.16em] text-amber-700">EXECUTION CHECKLIST</div>
            <div className="mt-3 space-y-2.5">
              {checklistItems.map((item) => (
                <div key={item.label} className="flex items-start gap-2.5 rounded-lg border border-amber-200/90 bg-white/60 px-2.5 py-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-500" />
                  <div>
                    <div className="text-xs font-semibold text-amber-700">{item.label}</div>
                    <div className="text-sm leading-snug text-amber-900">{item.value}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-slate-50 p-3"><div className="text-slate-500">進場區</div><div className="font-semibold">{analysis?.tradePlan?.entryZone || "-"}</div></div>
              <div className="rounded-xl bg-slate-50 p-3"><div className="text-slate-500">止損</div><div className="font-semibold">{formatNumber(analysis?.stopLoss, digits)}</div></div>
              <div className="rounded-xl bg-slate-50 p-3"><div className="text-slate-500">目標1 / 目標2 / 目標3</div><div className="font-semibold">{formatNumber(analysis?.takeProfit1, digits)} / {formatNumber(analysis?.takeProfit2, digits)} / -</div></div>
              <div className="rounded-xl bg-slate-50 p-3"><div className="text-slate-500">風險報酬比</div><div className="font-semibold">{formatNumber(analysis?.tradePlan?.rr1, 2)} / {formatNumber(analysis?.tradePlan?.rr2, 2)}</div></div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3"><div className="text-slate-500">失效條件</div><div className="font-semibold">{analysis?.tradePlan?.invalidation || "-"}</div></div>
          </>
        )}
        <div className="rounded-xl border border-slate-200 p-3">
          <div className="text-slate-500">倉位 / 槓桿</div>
          <div className="font-semibold">1x 模擬單位 · 無槓桿</div>
        </div>
      </CardContent>
    </Card>
  );
}

export function ChartPanel({ chartData, analysis, symbol, timeframeLabel, formatNumber }) {
  const overlays = [
    { label: "Entry", tone: "bg-slate-100 text-slate-700" },
    { label: "Stop Loss", tone: "bg-rose-100 text-rose-700" },
    { label: "Take Profit", tone: "bg-emerald-100 text-emerald-700" },
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

              <ReferenceLine yAxisId="left" y={analysis?.price} stroke="#0f172a" strokeDasharray="4 4" label="現價" />
              <ReferenceLine yAxisId="left" y={analysis?.stopLoss} stroke="#ef4444" strokeDasharray="3 3" label="SL" />
              <ReferenceLine yAxisId="left" y={analysis?.takeProfit1} stroke="#22c55e" strokeDasharray="3 3" label="TP1" />
              <ReferenceLine yAxisId="left" y={analysis?.takeProfit2} stroke="#16a34a" strokeDasharray="3 3" label="TP2" />

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
      </CardContent>
    </Card>
  );
}

export function AIAnalysisAccordion({ analysis }) {
  const oneLineSummary = `AI分析：${analysis?.marketRegimeLabel || "市場狀態未定"} + ${analysis?.confluence || "多週期分歧"}，${analysis?.noEntryReason || "暫無有效 setup"}`;
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
          <div><span className="font-semibold">多週期：</span>{(analysis?.higherBiases || []).map((item) => `${item.interval}:${item.bias}`).join(" · ") || "-"}</div>
          <div><span className="font-semibold">指標摘要：</span>RSI {analysis?.rsi?.toFixed?.(2) || "-"}, MACD {analysis?.macd?.histogram?.toFixed?.(4) || "-"}</div>
          <div><span className="font-semibold">市場結構：</span>{analysis?.structure || "-"} / {analysis?.breakoutState || "-"}</div>
          <div><span className="font-semibold">風險警示：</span>{(analysis?.waitReasons || []).join("、") || "無"}</div>
          <pre className="whitespace-pre-wrap rounded-xl bg-slate-800 p-3 text-xs text-slate-100">{analysis?.aiSummary || "-"}</pre>
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
}) {
  const symbolLabel = symbolOptions.find((item) => item.value === symbol)?.label || symbol;

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
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="min-w-0 space-y-6">
          <DecisionCard analysis={analysis} />
          <TradePlanCard analysis={analysis} digits={digits} formatNumber={formatNumber} />
          <AIAnalysisAccordion analysis={analysis} />
        </div>
        <div className="min-w-0 space-y-6">
          <ChartPanel chartData={chartData} analysis={analysis} symbol={symbol} timeframeLabel={timeframeLabel} formatNumber={formatNumber} />
          <MarketContextCard analysis={analysis} currentCandle={currentCandle} digits={digits} formatNumber={formatNumber} />
        </div>
      </div>
    </div>
  );
}
