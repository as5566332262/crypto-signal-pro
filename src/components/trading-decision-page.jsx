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
      <div>Open: {formatNumber(row.open, digits)}</div>
      <div>High: {formatNumber(row.high, digits)}</div>
      <div>Low: {formatNumber(row.low, digits)}</div>
      <div>Close: {formatNumber(row.close, digits)}</div>
      <div>MA20: {formatNumber(row.ma20, digits)}</div>
      <div>MA50: {formatNumber(row.ma50, digits)}</div>
      <div>Volume: {formatNumber(row.volume, 2)}</div>
    </div>
  );
}

export function DecisionHeader({ symbolLabel, currentPrice, regime, actionLabel, confidenceLabel, lastUpdated, digits, formatNumber }) {
  return (
    <Card className="rounded-3xl border-0 shadow-md">
      <CardHeader className="pb-3">
        <CardTitle className="text-xl">Trading Decision Panel</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-2xl bg-slate-100 p-3">
          <div className="text-xs text-slate-500">Symbol / Price</div>
          <div className="mt-1 text-lg font-semibold">{symbolLabel} · {formatNumber(currentPrice, digits)}</div>
        </div>
        <div className="rounded-2xl bg-slate-100 p-3">
          <div className="text-xs text-slate-500">Market Regime</div>
          <div className="mt-1 text-lg font-semibold">{regime || "-"}</div>
        </div>
        <div className="rounded-2xl bg-slate-100 p-3">
          <div className="text-xs text-slate-500">AI Action / Confidence</div>
          <div className="mt-1 flex items-center gap-2 text-lg font-semibold">
            <Badge className={`rounded-full ${valueTone(actionLabel)}`}>{actionLabel || "-"}</Badge>
            <span>{confidenceLabel || "-"}</span>
          </div>
        </div>
        <div className="rounded-2xl bg-slate-100 p-3 sm:col-span-2 xl:col-span-3">
          <div className="text-xs text-slate-500">Last Updated</div>
          <div className="mt-1 font-medium">{lastUpdated || "-"}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export function DecisionCard({ analysis }) {
  return (
    <Card className="rounded-3xl shadow-sm">
      <CardHeader><CardTitle>Decision</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center justify-between rounded-xl bg-slate-100 p-3">
          <span>Final action</span>
          <Badge className={`rounded-full ${valueTone(analysis?.bias)}`}>{analysis?.finalDecisionLabel || "-"}</Badge>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-slate-50 p-3"><div className="text-slate-500">Confidence</div><div className="font-semibold">{analysis?.confidenceLevelLabel || "-"}</div></div>
          <div className="rounded-xl bg-slate-50 p-3"><div className="text-slate-500">Risk</div><div className="font-semibold">{analysis?.riskLevel || "-"}</div></div>
          <div className="rounded-xl bg-slate-50 p-3"><div className="text-slate-500">MTF Alignment</div><div className="font-semibold">{analysis?.confluence || "-"}</div></div>
          <div className="rounded-xl bg-slate-50 p-3"><div className="text-slate-500">Primary Trigger</div><div className="font-semibold">{analysis?.triggerEngine?.confirmationLabel || "-"}</div></div>
        </div>
        <div className="rounded-xl border border-slate-200 p-3 text-slate-600">{analysis?.explanation || "-"}</div>
      </CardContent>
    </Card>
  );
}

export function TradePlanCard({ analysis, digits, formatNumber }) {
  const isHold = analysis?.finalDecision === "WAIT" || analysis?.finalDecision === "NO_TRADE";
  return (
    <Card className="rounded-3xl shadow-sm">
      <CardHeader><CardTitle>Trade Plan</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        {isHold ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-800">
            <div className="font-semibold">Wait Conditions</div>
            <div className="mt-1">{analysis?.triggerEngine?.waitConditionSentence || analysis?.noEntryReason || "等待結構與動能同步"}</div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-slate-50 p-3"><div className="text-slate-500">Entry Zone</div><div className="font-semibold">{analysis?.tradePlan?.entryZone || "-"}</div></div>
              <div className="rounded-xl bg-slate-50 p-3"><div className="text-slate-500">Stop Loss</div><div className="font-semibold">{formatNumber(analysis?.stopLoss, digits)}</div></div>
              <div className="rounded-xl bg-slate-50 p-3"><div className="text-slate-500">TP1 / TP2 / TP3</div><div className="font-semibold">{formatNumber(analysis?.takeProfit1, digits)} / {formatNumber(analysis?.takeProfit2, digits)} / -</div></div>
              <div className="rounded-xl bg-slate-50 p-3"><div className="text-slate-500">Risk-Reward</div><div className="font-semibold">{formatNumber(analysis?.tradePlan?.rr1, 2)} / {formatNumber(analysis?.tradePlan?.rr2, 2)}</div></div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3"><div className="text-slate-500">Invalidation</div><div className="font-semibold">{analysis?.tradePlan?.invalidation || "-"}</div></div>
          </>
        )}
        <div className="rounded-xl border border-slate-200 p-3">
          <div className="text-slate-500">Position / Leverage</div>
          <div className="font-semibold">1x simulated unit · no leverage</div>
        </div>
      </CardContent>
    </Card>
  );
}

export function ChartPanel({ chartData, analysis, symbol, timeframeLabel, formatNumber }) {
  return (
    <Card className="rounded-3xl shadow-sm">
      <CardHeader><CardTitle>Chart</CardTitle></CardHeader>
      <CardContent>
        <div className="h-[360px] w-full rounded-2xl bg-slate-100 p-2">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 12, right: 12, left: 4, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1" />
              <XAxis dataKey="time" minTickGap={24} tick={{ fontSize: 12 }} />
              <YAxis yAxisId="left" domain={["auto", "auto"]} tick={{ fontSize: 12 }} width={70} />
              <YAxis yAxisId="right" orientation="right" tick={false} hide />
              <Tooltip content={<CustomTooltip symbol={symbol} formatNumber={formatNumber} />} />

              <ReferenceArea yAxisId="left" y1={analysis?.levels?.structureSupportZone?.low} y2={analysis?.levels?.structureSupportZone?.high} fill="#16a34a" fillOpacity={0.08} />
              <ReferenceArea yAxisId="left" y1={analysis?.levels?.structureResistanceZone?.low} y2={analysis?.levels?.structureResistanceZone?.high} fill="#dc2626" fillOpacity={0.08} />

              <ReferenceLine yAxisId="left" y={analysis?.price} stroke="#0f172a" strokeDasharray="4 4" label="Now" />
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
        <div className="mt-2 text-xs text-slate-500">{timeframeLabel} · clean view with execution overlays.</div>
      </CardContent>
    </Card>
  );
}

export function MarketContextCard({ analysis, currentCandle, digits, formatNumber }) {
  return (
    <Card className="rounded-3xl shadow-sm">
      <CardHeader><CardTitle>Market Context</CardTitle></CardHeader>
      <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-xl bg-slate-50 p-3"><div className="text-slate-500">Structure</div><div className="font-semibold">{analysis?.structure || "-"}</div></div>
        <div className="rounded-xl bg-slate-50 p-3"><div className="text-slate-500">Breakout State</div><div className="font-semibold">{analysis?.breakoutState || "-"}</div></div>
        <div className="rounded-xl bg-slate-50 p-3"><div className="text-slate-500">Volume State</div><div className="font-semibold">{analysis?.volumeState || "-"}</div></div>
        <div className="rounded-xl bg-slate-50 p-3"><div className="text-slate-500">Fake Breakout Risk</div><div className="font-semibold">{analysis?.fakeBreakout?.risk || "-"}</div></div>
        <div className="rounded-xl bg-slate-50 p-3"><div className="text-slate-500">ATR</div><div className="font-semibold">{formatNumber(analysis?.atr, digits)}</div></div>
        <div className="rounded-xl bg-slate-50 p-3"><div className="text-slate-500">Current Candle</div><div className="font-semibold">{formatNumber(currentCandle?.low, digits)} ~ {formatNumber(currentCandle?.high, digits)}</div></div>
      </CardContent>
    </Card>
  );
}

export function AIAnalysisAccordion({ analysis }) {
  return (
    <Card className="rounded-3xl shadow-sm">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between px-6 py-4">
          <div className="text-lg font-semibold">AI Analysis</div>
          <ChevronDown className="h-4 w-4 transition group-open:rotate-180" />
        </summary>
        <CardContent className="space-y-3 pt-0 text-sm">
          <div><span className="font-semibold">Multi-timeframe:</span> {(analysis?.higherBiases || []).map((item) => `${item.interval}:${item.bias}`).join(" · ") || "-"}</div>
          <div><span className="font-semibold">Indicator summary:</span> RSI {analysis?.rsi?.toFixed?.(2) || "-"}, MACD {analysis?.macd?.histogram?.toFixed?.(4) || "-"}</div>
          <div><span className="font-semibold">Market structure:</span> {analysis?.structure || "-"} / {analysis?.breakoutState || "-"}</div>
          <div><span className="font-semibold">Risk warnings:</span> {(analysis?.waitReasons || []).join("、") || "無"}</div>
          <pre className="whitespace-pre-wrap rounded-xl bg-slate-900 p-3 text-xs text-slate-100">{analysis?.aiSummary || "-"}</pre>
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
    <div className="mx-auto max-w-7xl space-y-6">
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
            <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />Refresh
          </Button>
          <Button variant={autoRefresh ? "default" : "outline"} className="rounded-2xl" onClick={() => setAutoRefresh((v) => !v)}>
            Auto Refresh: {autoRefresh ? "On" : "Off"}
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

      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-4">
          <DecisionCard analysis={analysis} />
          <TradePlanCard analysis={analysis} digits={digits} formatNumber={formatNumber} />
          <AIAnalysisAccordion analysis={analysis} />
        </div>
        <div className="space-y-4">
          <ChartPanel chartData={chartData} analysis={analysis} symbol={symbol} timeframeLabel={timeframeLabel} formatNumber={formatNumber} />
          <MarketContextCard analysis={analysis} currentCandle={currentCandle} digits={digits} formatNumber={formatNumber} />
        </div>
      </div>
    </div>
  );
}
