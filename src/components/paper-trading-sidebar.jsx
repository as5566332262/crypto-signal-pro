import React from "react";
import { PanelLeftClose, PanelLeftOpen, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { DEFAULT_PERFORMANCE_DEBUG_STATE } from "@/lib/paper-trading-engine";

function sideLabel(side) {
  return side === "SHORT" ? "空單" : "多單";
}

function reasonLabel(reason) {
  const reasonMap = {
    TP1: "止盈1",
    TP2: "止盈2",
    TP3: "止盈3",
    STOP_LOSS: "止損",
    INVALIDATION: "失效",
    TRAP_EXIT: "陷阱退出",
    MANUAL_CLOSE: "手動平倉",
  };
  const normalizedReason = toPrimitiveText(reason, { fallback: "-" });
  return reasonMap[normalizedReason] || normalizedReason || "-";
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "-";
}

function toTimestamp(value) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isRenderablePrimitive(value) {
  return ["string", "number", "boolean"].includes(typeof value);
}

function toPrimitiveText(value, { fallback = "-", complexFallback = "[complex data hidden]" } = {}) {
  if (value == null) return fallback;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : fallback;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value.trim() ? value : fallback;
  if (Array.isArray(value)) {
    const item = value.find((entry) => isRenderablePrimitive(entry));
    return item == null ? complexFallback : toPrimitiveText(item, { fallback, complexFallback });
  }
  if (typeof value === "object") {
    const candidateKeys = ["label", "type", "reason", "name", "message", "code", "value"];
    for (const key of candidateKeys) {
      if (isRenderablePrimitive(value[key])) {
        return toPrimitiveText(value[key], { fallback, complexFallback });
      }
    }
    return complexFallback;
  }
  return fallback;
}

function toSafeNumberText(value, formatter, digits = 2) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? formatter(parsed, digits) : "-";
}

function formatCompactNumber(value, maximumFractionDigits = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "-";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits,
  }).format(parsed);
}

function toPctText(numerator, denominator, formatNumber, digits = 1) {
  const num = Number(numerator || 0);
  const den = Number(denominator || 0);
  const ratio = den > 0 ? (num / den) * 100 : 0;
  return `${formatNumber(ratio, digits)}%`;
}

function waitingReasonLabel(reason) {
  const reasonMap = {
    blockedByKlineConfirmation: "K線未確認",
    waitingForBreakout: "等待突破",
  };
  const normalizedReason = toPrimitiveText(reason, { fallback: "-" });
  return reasonMap[normalizedReason] || normalizedReason || "-";
}

function cancelReasonLabel(reason) {
  const reasonMap = {
    STRUCTURE_CHANGED: "結構破壞",
    MOMENTUM_WEAKENED: "動能明顯轉弱",
    SETUP_INVALIDATED: "失效區被擊穿",
    INVALID_EXECUTION_PLAN_BLOCKED: "交易計畫異常，已阻止下單",
    PRICE_DRIFTED: "價格漂移",
    PENDING_TIMEOUT_REEVALUATED: "等待逾時重評估",
    EXPIRED: "掛單過期",
  };
  const normalizedReason = toPrimitiveText(reason, { fallback: "-" });
  return reasonMap[normalizedReason] || normalizedReason || "-";
}

function simulationPhaseLabel(phase) {
  const phaseMap = {
    initializing: "初始化中",
    waiting_market_data: "等待市場資料",
    waiting_new_candle: "等待新 K 線",
    analyzing_strategy: "策略分析中",
    condition_checking: "條件檢查中",
    waiting_fill_conditions: "等待成交條件",
    pending_order_created: "已建立委託單",
    position_managing: "持倉管理中",
    cooldown: "cooldown 中",
    stopped: "已停止",
    idle: "已停止",
  };
  return phaseMap[phase] || "條件檢查中";
}

function executionModeLabel(mode) {
  const normalized = String(mode || "").toUpperCase();
  if (normalized === "PULLBACK") return "Pullback";
  if (normalized === "BREAKOUT") return "Breakout";
  return "-";
}

function yesNoLabel(value) {
  return value ? "是" : "否";
}

function formatEventTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString();
}

function normalizeClosedTrade(trade, index, formatNumber, paperDigits) {
  if (!trade || typeof trade !== "object") return null;
  const realizedPnlRaw = trade.realizedPnl ?? trade.pnl;
  const realizedPnlNumber = Number(realizedPnlRaw);
  const hasRealizedPnl = Number.isFinite(realizedPnlNumber);
  const pnlPositive = hasRealizedPnl ? realizedPnlNumber >= 0 : true;
  const maxRunupRaw = trade.maxRunup ?? trade.maxFavorableExcursion;
  const maxDrawdownRaw = trade.maxDrawdown ?? trade.maxAdverseExcursion;
  const closeReasonRaw = trade.closeReason ?? trade.exitReason ?? trade.reason;
  const createdAt = trade.createdAt ?? trade.entryTime;
  const enteredAt = trade.enteredAt ?? trade.entryTime;
  const closedAt = trade.closedAt ?? trade.exitTime;
  return {
    id: trade.id || `${toPrimitiveText(trade.symbol, { fallback: "unknown" })}-${index}`,
    symbol: toPrimitiveText(trade.symbol),
    side: trade.side === "SHORT" ? "SHORT" : "LONG",
    entryPrice: toSafeNumberText(trade.entryPrice, formatNumber, paperDigits),
    exitPrice: toSafeNumberText(trade.exitPrice, formatNumber, paperDigits),
    quantity: toSafeNumberText(trade.quantity, formatNumber, 2),
    realizedPnlText: hasRealizedPnl ? `${pnlPositive ? "+" : ""}${toSafeNumberText(realizedPnlNumber, formatNumber, 2)} USDT` : "-",
    pnlPositive,
    hasRealizedPnl,
    closeReason: reasonLabel(closeReasonRaw),
    decisionType: toPrimitiveText(trade.decisionType),
    pendingType: toPrimitiveText(trade.pendingType),
    scoreSummary: `${toPrimitiveText(trade.scoreGrade)} / ${toPrimitiveText(trade.totalScore)}`,
    regimeSummary: `${toPrimitiveText(trade.regime)} / ${toPrimitiveText(trade.confirmationState)}`,
    entryReason: toPrimitiveText(trade.entryReasonDetail ?? trade.entryReason),
    reentrySummary:
      trade.isReentryAttempt || trade.reentryCount || trade.reentryReason || trade.reentryAdjustedEntry
        ? `${trade.isReentryAttempt ? "true" : "false"} / ${Number.isFinite(Number(trade.reentryCount)) ? Number(trade.reentryCount) : 0}`
        : null,
    reentryReasonSummary:
      trade.reentryReason || trade.reentryAdjustedEntry
        ? `${toPrimitiveText(trade.reentryReason)} / ${trade.reentryAdjustedEntry ? "true" : "false"}`
        : null,
    maxRunupDrawdown: `${toSafeNumberText(maxRunupRaw, formatNumber, 2)} / ${toSafeNumberText(maxDrawdownRaw, formatNumber, 2)}`,
    timeSummary: `${formatDate(createdAt)} / ${formatDate(enteredAt)} / ${formatDate(closedAt)}`,
  };
}

class CardRenderErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error) {
    console.error("[TradingStateTerminal] Card render failed:", error);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
          此筆資料顯示失敗
        </div>
      );
    }
    return this.props.children;
  }
}

export function PaperAccountCard({ accountSnapshot, formatNumber }) {
  const metricKeys = ["equity", "realizedPnl", "unrealizedPnl"];
  const hasAbnormalMetric = metricKeys.some((key) => {
    const value = Number(accountSnapshot?.[key]);
    return !Number.isFinite(value) || Math.abs(value) > 1_000_000;
  });
  return (
    <Card className="rounded-2xl border-slate-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">模擬帳戶</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2 text-xs text-slate-600">
        <div className="rounded-lg bg-slate-50 p-2"><div className="text-[11px] text-slate-500">餘額</div><div className="mt-0.5 font-semibold text-slate-800">{formatNumber(accountSnapshot.balance, 2)} USDT</div></div>
        <div className="rounded-lg bg-slate-50 p-2"><div className="text-[11px] text-slate-500">淨值</div><div className="mt-0.5 font-semibold text-slate-800">{formatNumber(accountSnapshot.equity, 2)} USDT</div></div>
        <div className="rounded-lg bg-slate-50 p-2"><div className="text-[11px] text-slate-500">已用保證金</div><div className="mt-0.5 font-semibold text-slate-800">{formatNumber(accountSnapshot.usedMargin || 0, 2)} USDT</div></div>
        <div className="rounded-lg bg-slate-50 p-2"><div className="text-[11px] text-slate-500">已實現損益</div><div className="mt-0.5 font-semibold text-slate-800">{formatNumber(accountSnapshot.realizedPnl, 2)} USDT</div></div>
        <div className="col-span-2 rounded-lg bg-slate-50 p-2"><div className="text-[11px] text-slate-500">未實現損益</div><div className="mt-0.5 font-semibold text-slate-800">{formatNumber(accountSnapshot.unrealizedPnl, 2)} USDT</div></div>
        {hasAbnormalMetric ? (
          <div className="col-span-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-800">
            ⚠️ 偵測到異常帳戶數值，已記錄 trace，請先確認 account trace/error trace。
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SimulationOrderConfigCard({ simulationOrderConfig, onSimulationQuantityChange }) {
  const quantity = Number(simulationOrderConfig?.quantity) > 0 ? Number(simulationOrderConfig.quantity) : 50;

  return (
    <Card className="rounded-2xl border-slate-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">模擬倉位大小</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 p-3 text-xs">
        <div className="text-[11px] text-slate-500">數量</div>
        <div className="grid grid-cols-4 gap-1.5">
          {[10, 50, 100].map((value) => (
            <Button
              key={value}
              type="button"
              variant={quantity === value ? "default" : "outline"}
              className="rounded-xl px-2 py-1 text-xs"
              onClick={() => onSimulationQuantityChange(value)}
            >
              {value}
            </Button>
          ))}
          <div className="flex items-center rounded-xl border border-slate-200 px-2">
            <Input
              type="number"
              min={1}
              step={1}
              value={quantity}
              onChange={(event) => onSimulationQuantityChange(event.target.value)}
              className="h-8 border-0 px-0 text-xs shadow-none focus-visible:ring-0"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TradingStateTerminal({
  openPositions,
  pendingOrders,
  closedTrades,
  cancelledOrders,
  paperDigits,
  formatNumber,
  onClosePosition,
  onCancelPendingOrder,
}) {
  const [activeTab, setActiveTab] = React.useState("positions");
  const normalizedClosedTrades = React.useMemo(() => {
    if (!Array.isArray(closedTrades)) {
      console.error("[TradingStateTerminal] closedTrades is not an array:", closedTrades);
      return [];
    }
    return closedTrades
      .map((trade, index) => {
        const normalized = normalizeClosedTrade(trade, index, formatNumber, paperDigits);
        if (!normalized) {
          console.error("[TradingStateTerminal] Invalid closed trade item filtered out:", { index, trade });
        }
        return normalized;
      })
      .filter(Boolean);
  }, [closedTrades, formatNumber, paperDigits]);
  const tabItems = [
    { key: "positions", label: "持有倉位", count: openPositions.length },
    { key: "pending", label: "當前委託", count: pendingOrders.length },
    { key: "closed", label: "已平倉", count: normalizedClosedTrades.length },
    { key: "cancelled", label: "已取消", count: cancelledOrders.length },
  ];

  const takeProfitDetailLabel = (item) =>
    [
      item.takeProfit1 ? `止盈1 ${formatNumber(item.takeProfit1, paperDigits)}` : null,
      item.takeProfit2 ? `止盈2 ${formatNumber(item.takeProfit2, paperDigits)}` : null,
      item.takeProfit3 ? `止盈3 ${formatNumber(item.takeProfit3, paperDigits)}` : null,
    ].filter(Boolean).join(" / ") || "-";

  const safeFormatNumber = (value, digits = 2) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? formatNumber(parsed, digits) : "-";
  };

  const showCloseAll = activeTab === "positions" && openPositions.length > 1;
  const showCancelAll = activeTab === "pending" && pendingOrders.length > 1;

  return (
    <Card className="rounded-2xl border-slate-200">
      <CardHeader className="space-y-3 pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm">交易狀態面板</CardTitle>
          <div className="flex items-center gap-1.5">
            {showCloseAll ? (
              <Button variant="outline" size="sm" className="h-7 rounded-lg px-2 text-xs" onClick={() => openPositions.forEach((position) => onClosePosition?.(position.id))}>
                全部平倉
              </Button>
            ) : null}
            {showCancelAll ? (
              <Button variant="outline" size="sm" className="h-7 rounded-lg border-rose-200 px-2 text-xs text-rose-700 hover:bg-rose-50 hover:text-rose-800" onClick={() => pendingOrders.forEach((order) => onCancelPendingOrder?.(order.id))}>
                全部取消
              </Button>
            ) : null}
          </div>
        </div>
        <div className="flex gap-1 overflow-x-auto pb-1">
          {tabItems.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                activeTab === tab.key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {tab.label} ({tab.count})
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0 text-xs text-slate-600">
        {activeTab === "positions" ? (
          openPositions.length ? (
            <div className="h-[360px] space-y-2.5 overflow-x-hidden overflow-y-auto pr-1">
              {openPositions.map((position) => {
                const pnlPositive = Number(position.unrealizedPnl || 0) >= 0;
                return (
                  <div key={position.id} className="flex min-h-[220px] flex-col rounded-xl border border-slate-200 bg-white p-3">
                    <div className="mb-3 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <div className="truncate text-sm font-semibold text-slate-800">{position.symbol}</div>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${position.side === "SHORT" ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>
                          {sideLabel(position.side)}
                        </span>
                      </div>
                      <div className={`whitespace-nowrap text-base font-extrabold tracking-wide ${pnlPositive ? "text-emerald-600" : "text-rose-600"}`}>
                        {pnlPositive ? "+" : ""}
                        {formatNumber(position.unrealizedPnl, 2)} USDT
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div className="space-y-2 rounded-lg bg-slate-50 p-2.5">
                        <div className="text-[11px] font-semibold text-slate-500">基本資訊</div>
                        <div className="whitespace-nowrap text-sm font-semibold text-slate-800">
                          {formatNumber(position.entryPrice, paperDigits)} <span className="px-1 text-slate-400">→</span> {formatNumber(position.currentPrice, paperDigits)}
                        </div>
                        <InfoSingleRow
                          label="數量"
                          value={`${formatNumber(position.quantity, 2)} ${position.symbol.replace("USDT", "")}`}
                        />
                      </div>
                      <div className="space-y-2 rounded-lg bg-slate-50 p-2.5">
                        <div className="text-[11px] font-semibold text-slate-500">風控</div>
                        <div className="flex flex-col gap-1.5">
                          <InlineLabelValue label="止損" value={formatNumber(position.stopLoss, paperDigits)} />
                          <InlineLabelValue
                            label="止盈1"
                            value={position.takeProfit1 ? formatNumber(position.takeProfit1, paperDigits) : "-"}
                          />
                        </div>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-2.5">
                        <div className="text-[11px] font-semibold text-slate-500">狀態</div>
                        <div className="mt-1 whitespace-nowrap text-[13px] font-medium text-slate-700">
                          開倉：<span className="font-semibold text-slate-800">{formatDate(position.openedAt)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="mt-auto pt-3">
                      <Button variant="outline" size="sm" className="h-7 w-full rounded-lg px-2" onClick={() => onClosePosition?.(position.id)}>
                        平倉
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : <div className="rounded-lg bg-slate-50 px-3 py-2 text-slate-500">目前無持倉</div>
        ) : null}

        {activeTab === "pending" ? (
          pendingOrders.length ? (
            <div className="h-[360px] space-y-2.5 overflow-x-hidden overflow-y-auto pr-1">
              {pendingOrders.map((order) => (
                <div key={order.id} className="flex min-h-[260px] flex-col rounded-xl border border-slate-200 bg-white p-3">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="truncate text-sm font-semibold text-slate-800">{order.symbol}</div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${order.side === "SHORT" ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>
                      {sideLabel(order.side)}
                    </span>
                  </div>
                  <div className="space-y-3">
                    <div className="space-y-2 rounded-lg bg-slate-50 p-2.5">
                      <div className="text-[11px] font-semibold text-slate-500">基本資訊</div>
                      <InfoPairRow
                        leftLabel="觸發價"
                        leftValue={formatNumber(order.triggerPrice, paperDigits)}
                        rightLabel="數量"
                        rightValue={`${formatNumber(order.quantity, 2)} ${order.symbol.replace("USDT", "")}`}
                      />
                      <InfoSingleRow label="建立時間" value={formatDate(order.createdAt)} />
                    </div>
                    <div className="space-y-2 rounded-lg bg-slate-50 p-2.5">
                      <div className="text-[11px] font-semibold text-slate-500">風控</div>
                      <InfoPairRow
                        leftLabel="止損"
                        leftValue={formatNumber(order.stopLoss, paperDigits)}
                        rightLabel="失效價"
                        rightValue={formatNumber(order.invalidationPrice, paperDigits)}
                      />
                      <InfoSingleRow label="止盈1 / 止盈2 / 止盈3" value={takeProfitDetailLabel(order)} />
                    </div>
                    <div className="space-y-2 rounded-lg bg-slate-50 p-2.5">
                      <div className="text-[11px] font-semibold text-slate-500">狀態</div>
                      <InfoSingleRow
                        label="等待原因"
                        value={(() => {
                          const reasons = Array.isArray(order.waitingReasons) && order.waitingReasons.length
                            ? order.waitingReasons
                            : [order.waitReason];
                          return reasons
                            .filter(Boolean)
                            .map((reason) => waitingReasonLabel(reason))
                            .join(" / ") || "-";
                        })()}
                      />
                      <InfoSingleRow label="isReentryAttempt" value={order.isReentryAttempt ? "true" : "false"} />
                      <InfoSingleRow label="已等待K數" value={formatCompactNumber(order.waitedBars, 1)} />
                      {order.distanceFromPricePct != null ? (
                        <InfoSingleRow label="距現價%" value={`${safeFormatNumber(order.distanceFromPricePct, 2)}%`} />
                      ) : null}
                      <InfoPairRow
                        leftLabel="reentryCount"
                        leftValue={safeFormatNumber(order.reentryCount, 0)}
                        rightLabel="reentryReason"
                        rightValue={order.reentryReason || "-"}
                      />
                      <InfoSingleRow label="reentryAdjustedEntry" value={order.reentryAdjustedEntry ? "true" : "false"} />
                      <InfoSingleRow label="價格漂移取消" value={order.canceledByPriceDrift ? "是" : "否"} />
                      {order.conditionalPending?.enabled ? (
                        <>
                          <InfoSingleRow label="已預掛單" value="是（條件式預掛單）" />
                          <InfoSingleRow
                            label="為何可預掛"
                            value={(order.conditionalPending?.whyEligible || []).join(" / ") || "-"}
                          />
                          <InfoSingleRow
                            label="哪些情況會撤單"
                            value={(order.conditionalPending?.autoCancelConditions || []).join(" / ") || "-"}
                          />
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-auto pt-3">
                    <Button variant="outline" size="sm" className="h-7 w-full rounded-lg border-rose-200 px-2 text-rose-700 hover:bg-rose-50 hover:text-rose-800" onClick={() => onCancelPendingOrder?.(order.id)}>
                      取消掛單
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : <div className="rounded-lg bg-slate-50 px-3 py-2 text-slate-500">無待觸發掛單</div>
        ) : null}

        {activeTab === "closed" ? (
          normalizedClosedTrades.length ? (
            <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
              {normalizedClosedTrades.map((trade, index) => {
                return (
                  <CardRenderErrorBoundary key={trade.id || `${trade.symbol || "unknown"}-${index}`}>
                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-slate-800">{trade.symbol}</div>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${trade.side === "SHORT" ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>
                          {sideLabel(trade.side)}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                        <InfoItem label="進場價" value={trade.entryPrice} />
                        <InfoItem label="出場價" value={trade.exitPrice} />
                        <InfoItem label="數量" value={trade.quantity} />
                        <InfoItem
                          label="已實現損益"
                          value={trade.realizedPnlText}
                          valueClassName={trade.hasRealizedPnl ? (trade.pnlPositive ? "text-emerald-600" : "text-rose-600") : ""}
                        />
                        <InfoItem label="平倉原因" value={trade.closeReason} className="col-span-2" />
                        <InfoItem label="decisionType" value={trade.decisionType} className="col-span-2" />
                        <InfoItem label="pendingType" value={trade.pendingType} className="col-span-2" />
                        <InfoItem label="scoreGrade / totalScore" value={trade.scoreSummary} className="col-span-2" />
                        <InfoItem label="regime / confirmation" value={trade.regimeSummary} className="col-span-2" />
                        <InfoItem label="進場理由" value={trade.entryReason} className="col-span-2" />
                        {trade.reentrySummary ? <InfoItem label="isReentryAttempt / reentryCount" value={trade.reentrySummary} className="col-span-2" /> : null}
                        {trade.reentryReasonSummary ? <InfoItem label="reentryReason / reentryAdjustedEntry" value={trade.reentryReasonSummary} className="col-span-2" /> : null}
                        <InfoItem label="最大浮盈 / 最大浮虧" value={trade.maxRunupDrawdown} className="col-span-2" />
                        <InfoItem label="建立/進場/出場" value={trade.timeSummary} className="col-span-2" />
                      </div>
                    </div>
                  </CardRenderErrorBoundary>
                );
              })}
            </div>
          ) : <div className="rounded-lg bg-slate-50 px-3 py-2 text-slate-500">無交易紀錄</div>
        ) : null}

        {activeTab === "cancelled" ? (
          cancelledOrders.length ? (
            <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
              {cancelledOrders.map((order) => (
                <div key={`${order.id}-${order.cancelledAt || order.createdAt}`} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-slate-800">{order.symbol}</div>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${order.side === "SHORT" ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>
                      {sideLabel(order.side)}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                    <InfoItem label="觸發價" value={formatNumber(order.triggerPrice, paperDigits)} />
                    <InfoItem label="數量" value={formatNumber(order.quantity, 2)} />
                    <InfoItem label="取消原因" value={toPrimitiveText(order.cancelReason)} className="col-span-2" />
                    <InfoItem label="取消原因（中文）" value={cancelReasonLabel(order.cancelReason)} className="col-span-2" />
                    {order.isReentryAttempt ? (
                      <InfoItem label="Re-entry" value={`第 ${order.reentryCount ?? 0} 次`} className="col-span-2" />
                    ) : null}
                    {order.reentryReason ? (
                      <InfoItem label="Re-entry 原因" value={toPrimitiveText(order.reentryReason)} className="col-span-2" />
                    ) : null}
                    {order.reentryAdjustedEntry ? (
                      <InfoItem label="進場調整" value="已調整進場價" className="col-span-2" />
                    ) : null}
                    <InfoItem label="建立時間" value={formatDate(order.createdAt)} className="col-span-2" />
                    <InfoItem label="取消時間" value={formatDate(order.cancelledAt)} className="col-span-2" />
                  </div>
                </div>
              ))}
            </div>
          ) : <div className="rounded-lg bg-slate-50 px-3 py-2 text-slate-500">無取消掛單紀錄</div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function InfoItem({ label, value, className = "", valueClassName = "" }) {
  const safeValue = toPrimitiveText(value);
  return (
    <div className={`min-w-0 w-full ${className}`}>
      <div className="text-[11px] leading-5 text-slate-500">{label}</div>
      <div className={`mt-0.5 min-w-0 whitespace-pre-wrap break-words font-semibold leading-relaxed text-slate-800 [overflow-wrap:anywhere] ${valueClassName}`}>{safeValue}</div>
    </div>
  );
}

function InlineLabelValue({ label, value, valueClassName = "" }) {
  return (
    <div className="min-w-0 whitespace-nowrap text-[13px] font-medium text-slate-700">
      <span className="text-slate-500">{label}：</span>
      <span className={`font-semibold text-slate-800 ${valueClassName}`}>{value ?? "-"}</span>
    </div>
  );
}

function InfoPairRow({ leftLabel, leftValue, rightLabel, rightValue }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-1.5">
      <InlineLabelValue label={leftLabel} value={leftValue} />
      <InlineLabelValue label={rightLabel} value={rightValue} />
    </div>
  );
}

function InfoSingleRow({ label, value, valueClassName = "" }) {
  const safeValue = toPrimitiveText(value);
  return (
    <div className="flex items-center gap-1.5 text-[13px] font-medium text-slate-700">
      <span className="text-slate-500">{label}：</span>
      <span className={`font-semibold text-slate-800 ${valueClassName}`}>{safeValue}</span>
    </div>
  );
}

function DebugField({ label, value, valueClassName = "" }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <div className="text-[11px] font-medium text-slate-500">{label}</div>
      <div className={`min-w-0 text-xs font-semibold text-slate-800 break-all whitespace-pre-wrap [overflow-wrap:anywhere] ${valueClassName}`}>
        {value ?? "-"}
      </div>
    </div>
  );
}

function DebugStateCard({ accountSnapshot }) {
  return (
    <details className="rounded-2xl border border-slate-200 bg-white p-3 text-xs" open={false}>
      <summary className="cursor-pointer font-semibold text-slate-700">開發者模式：模擬狀態</summary>
      <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-900 p-2 text-[11px] text-slate-100">
        {JSON.stringify({
          account: {
            balance: accountSnapshot.balance,
            equity: accountSnapshot.equity,
            usedMargin: accountSnapshot.usedMargin,
            realizedPnl: accountSnapshot.realizedPnl,
            unrealizedPnl: accountSnapshot.unrealizedPnl,
          },
          simulationOrderConfig: accountSnapshot.simulationOrderConfig,
          pendingOrders: accountSnapshot.pendingOrders,
          cancelledOrders: accountSnapshot.cancelledOrders,
          openPositions: accountSnapshot.openPositions,
          closedTrades: accountSnapshot.closedTrades,
        }, null, 2)}
      </pre>
    </details>
  );
}

export default function PaperTradingSidebar({
  sidebarOpen,
  onToggleSidebar,
  paperSymbol,
  setPaperSymbol,
  supportedSymbols,
  accountSnapshot,
  paperDigits,
  onResetPaperAccount,
  onExecuteSimulation,
  onStartSimulation,
  onPauseSimulation,
  onStopSimulation,
  onClosePosition,
  onCancelPendingOrder,
  formatNumber,
  simulationOrderConfig,
  onSimulationQuantityChange,
  simulationExecutionStatus,
  simulationButtonState,
  simulationLifecycle,
  simulationStartedAt,
  lastDecisionAt,
  simulationRestoreInfo,
  currentSimulationStatus,
}) {
  const [showAnalysisPanel, setShowAnalysisPanel] = React.useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("paperTrading.showAnalysisPanel") === "true";
  });
  const [runtimeNow, setRuntimeNow] = React.useState(Date.now());
  const [showSimulationStatusPanel, setShowSimulationStatusPanel] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("paperTrading.showAnalysisPanel", showAnalysisPanel ? "true" : "false");
  }, [showAnalysisPanel]);

  React.useEffect(() => {
    if (simulationLifecycle !== "running") return undefined;
    const timer = window.setInterval(() => setRuntimeNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [simulationLifecycle]);
  const simulationStartedAtTs = toTimestamp(simulationStartedAt);
  const runtimeSec = simulationStartedAtTs ? Math.max(0, Math.floor((runtimeNow - simulationStartedAtTs) / 1000)) : 0;
  const runtimeLabel = `${Math.floor(runtimeSec / 3600)}h ${Math.floor((runtimeSec % 3600) / 60)}m ${runtimeSec % 60}s`;
  const performanceDebug = {
    ...DEFAULT_PERFORMANCE_DEBUG_STATE,
    ...(simulationExecutionStatus || {}),
  };
  const simulationStats = accountSnapshot?.simulationStats || {};
  const funnel = simulationStats?.funnel || {};
  const setupQualityRecords = Array.isArray(simulationStats?.setupQualityRecords) ? simulationStats.setupQualityRecords : [];
  const blockedReasonTopK = Array.isArray(simulationStats?.blockedReasonTopK) ? simulationStats.blockedReasonTopK : [];
  const funnelByDimension = Array.isArray(simulationStats?.funnelByDimension) ? simulationStats.funnelByDimension : [];
  const timeEfficiency = simulationStats?.timeEfficiency || {};
  const orderQuality = simulationStats?.orderQuality || {};
  const decisionOutcomeDistribution = Array.isArray(simulationStats?.decisionOutcomeDistribution) ? simulationStats.decisionOutcomeDistribution : [];
  const setupTypePerformance = Array.isArray(simulationStats?.setupTypePerformance) ? simulationStats.setupTypePerformance : [];
  const distributionBy = (key) => {
    const bucket = {};
    setupQualityRecords.forEach((item) => {
      const label = toPrimitiveText(item?.[key], { fallback: "UNKNOWN" });
      bucket[label] = (bucket[label] || 0) + 1;
    });
    return Object.entries(bucket).sort((a, b) => b[1] - a[1]).slice(0, 8);
  };
  const setupTypeDist = distributionBy("setupType");
  const symbolDist = distributionBy("symbol");
  const sideDist = distributionBy("side");
  const regimeDist = distributionBy("marketRegime");
  const closedRecords = setupQualityRecords.filter((item) => item.tradeResult != null);
  const avgClosedResult = closedRecords.length
    ? closedRecords.reduce((sum, item) => sum + Number(item.tradeResult || 0), 0) / closedRecords.length
    : 0;
  const blockedReasonSampleTotal = blockedReasonTopK.reduce((sum, item) => sum + Number(item?.total_block_count || 0), 0);

  const sidebarWidthClass = sidebarOpen ? "w-full lg:w-[360px]" : "w-full lg:w-[76px]";

  return (
    <aside className={`shrink-0 border-b border-slate-200 bg-slate-50/70 p-4 transition-all duration-200 lg:border-b-0 lg:border-r ${sidebarWidthClass}`}>
      <div className="flex items-center justify-between gap-2">
        {sidebarOpen ? <div className="text-sm font-semibold text-slate-700">模擬交易</div> : <Wallet className="mx-auto h-5 w-5 text-slate-600" />}
        <Button variant="ghost" size="icon" onClick={onToggleSidebar}>
          {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
        </Button>
      </div>

      {sidebarOpen ? (
        <div className="mt-4 space-y-4">
          <Card className="rounded-2xl border-slate-200">
            <CardContent className="space-y-2 p-3">
              <div className="text-xs font-medium text-slate-500">幣種</div>
              <Select value={paperSymbol} onValueChange={setPaperSymbol}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {supportedSymbols.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <SimulationOrderConfigCard
            simulationOrderConfig={simulationOrderConfig || accountSnapshot.simulationOrderConfig}
            onSimulationQuantityChange={onSimulationQuantityChange}
          />
          <PaperAccountCard accountSnapshot={accountSnapshot} formatNumber={formatNumber} />
          <Card className="rounded-2xl border-slate-200">
            <CardHeader className="pb-2"><CardTitle className="text-sm">模擬生命週期</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-xs">
              {simulationRestoreInfo?.restored ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-2 text-emerald-800">
                  <div className="font-semibold">已從本地狀態恢復模擬</div>
                  <div>已恢復模擬狀態</div>
                  <div>上次運行狀態：<span className="font-semibold uppercase">{simulationRestoreInfo.restoredLifecycle || "-"}</span></div>
                  <div>上次決策時間：<span className="font-semibold">{formatDate(simulationRestoreInfo.lastDecisionTime)}</span></div>
                </div>
              ) : null}
              <div>目前狀態：<span className="font-semibold uppercase">{simulationLifecycle || "idle"}</span></div>
              <div>是否模擬中：<span className="font-semibold">{simulationLifecycle === "running" ? "是" : "否"}</span></div>
              <div>已運行：<span className="font-semibold">{simulationStartedAt ? runtimeLabel : "-"}</span></div>
              <div>最近決策：<span className="font-semibold">{formatDate(lastDecisionAt)}</span></div>
              <div className="grid grid-cols-3 gap-2 pt-1">
                <Button className="rounded-xl text-xs" onClick={onStartSimulation}>開始</Button>
                <Button variant="outline" className="rounded-xl text-xs" onClick={onPauseSimulation}>暫停</Button>
                <Button variant="outline" className="rounded-xl text-xs" onClick={onStopSimulation}>停止</Button>
              </div>
            </CardContent>
          </Card>
          <Card className="rounded-2xl border-slate-200">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm">模擬狀態</CardTitle>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 rounded-lg px-2 text-xs"
                  onClick={() => setShowSimulationStatusPanel((prev) => !prev)}
                >
                  {showSimulationStatusPanel ? "隱藏模擬狀態" : "顯示模擬狀態"}
                </Button>
              </div>
            </CardHeader>
            {showSimulationStatusPanel ? (
              <CardContent className="space-y-3 text-xs text-slate-700">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <InfoItem label="isSimulating" value={yesNoLabel(currentSimulationStatus?.isSimulating)} />
                  <InfoItem label="elapsed" value={simulationStartedAt ? runtimeLabel : "-"} />
                  <InfoItem label="phase" value={simulationPhaseLabel(currentSimulationStatus?.currentPhase)} />
                  <InfoItem label="模式" value={executionModeLabel(currentSimulationStatus?.executionMode)} />
                  <InfoItem
                    label="waiting reason"
                    value={currentSimulationStatus?.waitingReason || "等待下一根 K 線確認"}
                    className="col-span-2"
                    valueClassName="whitespace-normal leading-relaxed"
                  />
                  {String(currentSimulationStatus?.executionMode || "").toUpperCase() === "BREAKOUT" ? (
                    <>
                      <InfoItem label="triggerPrice" value={formatNumber(currentSimulationStatus?.breakoutTriggerPrice, paperDigits)} />
                      <InfoItem label="breakout style" value={currentSimulationStatus?.breakoutStyle || "Conservative"} />
                      <InfoItem label="breakout status" value={currentSimulationStatus?.breakoutStatusText || "尚未突破"} />
                      <div className="col-span-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-2">
                        <div className="mb-1 text-slate-500">confirmation checklist</div>
                        <ul className="list-disc pl-4 space-y-1">
                          {(currentSimulationStatus?.breakoutChecklist || []).map((item) => <li key={item}>{item}</li>)}
                        </ul>
                      </div>
                    </>
                  ) : null}
                </div>
              </CardContent>
            ) : null}
          </Card>
          <TradingStateTerminal
            openPositions={accountSnapshot.currentSymbolOpenPositions || []}
            pendingOrders={accountSnapshot.currentSymbolPendingOrders || []}
            closedTrades={accountSnapshot.currentSymbolClosedTrades || []}
            cancelledOrders={accountSnapshot.currentSymbolCancelledOrders || []}
            paperDigits={paperDigits}
            formatNumber={formatNumber}
            onClosePosition={onClosePosition}
            onCancelPendingOrder={onCancelPendingOrder}
          />
          <DebugStateCard accountSnapshot={accountSnapshot} />
          <Card className="rounded-2xl border-slate-200">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm">分析面板</CardTitle>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 rounded-lg px-2 text-xs"
                  onClick={() => setShowAnalysisPanel((prev) => !prev)}
                >
                  {showAnalysisPanel ? "隱藏分析面板" : "顯示分析面板"}
                </Button>
              </div>
            </CardHeader>
          </Card>

          {showAnalysisPanel ? (
            <>
              <Card className="rounded-2xl border-slate-200">
                <CardHeader className="pb-2"><CardTitle className="text-sm">1) 執行漏斗</CardTitle></CardHeader>
                <CardContent className="space-y-3 text-xs">
                  {[
                    ["signal", funnel?.signals_total],
                    ["setup_created", funnel?.setup_created_total ?? funnel?.setup_candidate_total],
                    ["entry_zone_hit", funnel?.entry_zone_hit_total],
                    ["pending_created", funnel?.pending_created_total],
                    ["pending_price_reached", funnel?.pending_price_reached_total],
                    ["fill_confirmed", funnel?.fill_confirmed_total ?? funnel?.filled_total],
                    ["position_opened", funnel?.position_opened_total ?? funnel?.filled_total],
                    ["tp/sl", funnel?.tp_sl_total ?? funnel?.closed_total],
                  ].map(([label, value], index, rows) => {
                    const previous = index > 0 ? Number(rows[index - 1][1] || 0) : Number(value || 0);
                    const ratio = previous > 0 ? (Number(value || 0) / previous) * 100 : 0;
                    return (
                      <div key={label} className="space-y-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-semibold uppercase text-slate-700">{label}</span>
                          <span className="text-slate-500">{Number(value || 0)}（{formatNumber(ratio, 1)}%）</span>
                        </div>
                        <div className="h-2 rounded bg-slate-100">
                          <div className="h-2 rounded bg-slate-800" style={{ width: `${Math.max(2, Math.min(100, ratio))}%` }} />
                        </div>
                      </div>
                    );
                  })}
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                    <div>setup 是否太少：{Number((funnel?.setup_created_total ?? funnel?.setup_candidate_total) || 0) < Number(funnel?.signals_total || 0) * 0.3 ? "是（setup gate 偏嚴）" : "否"}</div>
                    <div>zone hit 但不掛單：{Number(funnel?.pending_blocked_total || 0) > Number(funnel?.pending_created_total || 0) ? "是（pending gate 需檢查）" : "否"}</div>
                    <div>掛單到價但不成交：{Number(funnel?.fill_confirmed_total || 0) < Number(funnel?.pending_price_reached_total || 0) * 0.4 ? "是（fill confirmation 過嚴）" : "否"}</div>
                    <div>成交後績效差：{closedRecords.length >= 3 && avgClosedResult < 0 ? "是（出場或風控需優化）" : "否"}</div>
                  </div>
                </CardContent>
              </Card>
              <Card className="rounded-2xl border-slate-200">
                <CardHeader className="pb-2"><CardTitle className="text-sm">2) 阻擋原因排名（Top K）</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-xs">
                  {(blockedReasonTopK || []).slice(0, 10).map((row) => (
                    <div key={row.reason} className="rounded-lg border border-slate-200 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-semibold text-slate-700">#{row.rank} {row.reason}</div>
                        <div className="text-[11px] text-slate-600">{formatNumber(row.ratio_pct, 1)}%</div>
                      </div>
                      <div className="mt-1 grid grid-cols-4 gap-2 text-[11px] text-slate-600">
                        <div>total: {row.total_block_count}</div>
                        <div>setup: {row.setup_block_count}</div>
                        <div>pending: {row.pending_block_count}</div>
                        <div>fill: {row.fill_block_count}</div>
                      </div>
                    </div>
                  ))}
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-600">
                    sample: {blockedReasonSampleTotal}（百分比以 blocked sample 為分母）
                  </div>
                </CardContent>
              </Card>
              <Card className="rounded-2xl border-slate-200">
                <CardHeader className="pb-2"><CardTitle className="text-sm">3) setup 分布（type / symbol / side / regime）</CardTitle></CardHeader>
                <CardContent className="space-y-3 text-xs">
                  <div className="grid grid-cols-2 gap-2">
                    <InfoItem label="setupType" value={setupTypeDist.map(([k, v]) => `${k}:${v}`).join(" / ")} />
                    <InfoItem label="symbol" value={symbolDist.map(([k, v]) => `${k}:${v}`).join(" / ")} />
                    <InfoItem label="side" value={sideDist.map(([k, v]) => `${k}:${v}`).join(" / ")} />
                    <InfoItem label="regime" value={regimeDist.map(([k, v]) => `${k}:${v}`).join(" / ")} />
                  </div>
                  <div>
                    <div className="mb-1 text-slate-500">symbol / timeframe 熱度（前 8）</div>
                    <ul className="list-disc pl-4">
                      {funnelByDimension.slice(0, 8).map((row, index) => (
                        <li key={`${row.symbol}-${row.timeframe}-${index}`}>
                          {row.symbol} {row.timeframe}: signal {row.signals_total} / fill {row.filled_total} / close {row.closed_total}
                        </li>
                      ))}
                    </ul>
                  </div>
                </CardContent>
              </Card>
              <Card className="rounded-2xl border-slate-200">
                <CardHeader className="pb-2"><CardTitle className="text-sm">4) 掛單品質</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-xs">
                  <div className="grid grid-cols-2 gap-2">
                    <InfoItem label="avg_distance_to_entry (%)" value={`${formatNumber(orderQuality?.avg_distance_to_entry_pct, 2)}%`} />
                    <InfoItem label="avg_fill_efficiency (%)" value={`${formatNumber(orderQuality?.avg_fill_efficiency_pct, 2)}%`} />
                    <InfoItem label="missed_fill_count" value={orderQuality?.missed_fill_count ?? 0} />
                    <InfoItem label="missed_fill_ratio" value={toPctText(orderQuality?.missed_fill_count, funnel?.pending_created_total, formatNumber)} />
                  </div>
                </CardContent>
              </Card>
              <Card className="rounded-2xl border-slate-200">
                <CardHeader className="pb-2"><CardTitle className="text-sm">5) 決策 vs 結果（LONG / SHORT / NO_TRADE）</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-xs">
                  {decisionOutcomeDistribution.map((row) => (
                    <div key={row.decision} className="rounded-lg border border-slate-200 p-2">
                      <div className="mb-1 font-semibold text-slate-700">{row.decision}（sample: {row.sampleCount}）</div>
                      <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600">
                        {Object.entries(row.outcomes || {}).map(([label, count]) => (
                          <div key={label}>
                            {label}: {count}（{formatNumber(row?.outcomeRatios?.[label] || 0, 1)}%）
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card className="rounded-2xl border-slate-200">
                <CardHeader className="pb-2"><CardTitle className="text-sm">6) setup 類型績效</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-xs">
                  {(setupTypePerformance || []).slice(0, 10).map((row) => (
                    <div key={row.setupType} className="rounded-lg border border-slate-200 p-2 text-[11px]">
                      <div className="font-semibold text-slate-700">{row.setupType}</div>
                      <div className="mt-1 grid grid-cols-3 gap-2 text-slate-600">
                        <div>count: {row.count}</div>
                        <div>winRate: {formatNumber(row.winRate, 1)}%</div>
                        <div>avgRR: {formatNumber(row.avgRR, 2)}</div>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card className="rounded-2xl border-slate-200">
                <CardHeader className="pb-2"><CardTitle className="text-sm">7) 時間維度</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-xs">
                  <div className="grid grid-cols-1 gap-2">
                    <InfoItem label="signal→zone" value={`${formatNumber(timeEfficiency?.signal_to_zone_hit_avg, 2)} bars（sample ${timeEfficiency?.signal_to_zone_sample_count || 0}）`} />
                    <InfoItem label="pending→fill" value={`${formatNumber(timeEfficiency?.pending_to_fill_avg, 2)} bars（sample ${timeEfficiency?.pending_to_fill_sample_count || 0}）`} />
                    <InfoItem label="fill→tp/sl" value={`${formatNumber(timeEfficiency?.fill_to_close_avg, 2)} min（sample ${timeEfficiency?.fill_to_close_sample_count || 0}）`} />
                  </div>
                </CardContent>
              </Card>
              <Card className="rounded-2xl border-slate-200">
                <CardHeader className="pb-2"><CardTitle className="text-sm">8) 實驗觀察摘要</CardTitle></CardHeader>
                <CardContent className="space-y-1 text-xs text-slate-700">
                  <div>・signals: {funnel?.signals_total || 0}，setup: {(funnel?.setup_created_total ?? funnel?.setup_candidate_total) || 0}，pending_price_reached: {funnel?.pending_price_reached_total || 0}，tp/sl: {(funnel?.tp_sl_total ?? funnel?.closed_total) || 0}</div>
                  <div>・最常 setup block：{blockedReasonTopK?.[0]?.reason || "-"}</div>
                  <div>・最常 pending/fill block：{(blockedReasonTopK || []).find((item) => item.pending_block_count > 0 || item.fill_block_count > 0)?.reason || "-"}</div>
                  <div>・最值得優化 setup 維度：{funnelByDimension?.[0] ? `${funnelByDimension[0].symbol}/${funnelByDimension[0].timeframe}/${funnelByDimension[0].setupType}` : "-"}</div>
                </CardContent>
              </Card>
            </>
          ) : null}

          <div className="grid grid-cols-1 gap-2">
            <Button
              className="rounded-2xl bg-slate-900 text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={onExecuteSimulation}
              disabled={simulationButtonState?.disabled}
              title={simulationButtonState?.disabledReason || ""}
            >
              單次執行模擬
            </Button>
            {simulationButtonState?.disabledReason ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {simulationButtonState.disabledReason}
              </div>
            ) : null}

            {showAnalysisPanel ? (
              <Card className="rounded-2xl border-slate-200">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">最近一次執行結果</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs text-slate-600">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500">狀態</span>
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 font-semibold text-slate-800">
                      {simulationExecutionStatus?.statusLabel || "-"}
                    </span>
                  </div>
                  <div className="text-slate-700">原因：{simulationExecutionStatus?.reason || "-"}</div>
                  {accountSnapshot?.currentSymbolSetup || accountSnapshot?.lastReleasedSetup ? (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-slate-700 space-y-1">
                      {(() => {
                        const setup = accountSnapshot?.currentSymbolSetup || accountSnapshot?.lastReleasedSetup;
                        const statusMap = {
                          ACTIVE: "ACTIVE",
                          TRIGGERED: "TRIGGERED",
                          INVALIDATED: "INVALIDATED",
                          EXPIRED: "EXPIRED",
                        };
                        const invalidationReasonMap = {
                          STRUCTURE_INVALIDATED: "結構失效",
                          MOMENTUM_INVALIDATED: "動能失效",
                          TIMEOUT_INVALIDATED: "等待逾時",
                        };
                        const livedMs = setup?.setupCreatedAt ? (Date.now() - new Date(setup.setupCreatedAt).getTime()) : null;
                        const livedMinutes = Number.isFinite(livedMs) ? Math.max(0, Math.floor(livedMs / 60000)) : null;
                        return (
                          <>
                            <div className="font-semibold text-emerald-800">Setup 狀態：{statusMap[setup?.status] || setup?.status || "-"}</div>
                            <div>Locked Entry Zone：{formatNumber(setup?.entryZoneLow, paperDigits)} – {formatNumber(setup?.entryZoneHigh, paperDigits)}</div>
                            <div>Setup 建立時間：{formatDate(setup?.setupCreatedAt)}</div>
                            <div>Setup 存活：{livedMinutes == null ? "-" : `${livedMinutes} 分鐘`}</div>
                            <div>失效原因：{invalidationReasonMap[setup?.invalidationReason] || "-"}</div>
                          </>
                        );
                      })()}
                    </div>
                  ) : null}
                  {simulationExecutionStatus?.scoring ? (
                    <div className="rounded-lg border border-violet-200 bg-violet-50 p-2 text-slate-700 space-y-1">
                      <div className="font-semibold text-violet-800">Scoring 引擎</div>
                      <DebugField label="總分" value={simulationExecutionStatus.scoring.totalScore ?? "-"} />
                      <DebugField label="等級" value={simulationExecutionStatus.scoring.scoreGrade || "-"} />
                      <DebugField label="信心" value={simulationExecutionStatus.scoring.confidenceLevel || "-"} />
                      {simulationExecutionStatus.scoring.keyPositiveFactors?.length ? (
                        <div>
                          <div className="text-[11px] text-violet-700">關鍵加分</div>
                          <ul className="list-disc pl-4 [overflow-wrap:anywhere] break-words">
                            {simulationExecutionStatus.scoring.keyPositiveFactors.map((item) => (
                              <li key={`plus-${item.label}`}>{item.label}（+{item.impact}）</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {simulationExecutionStatus.scoring.keyNegativeFactors?.length ? (
                        <div>
                          <div className="text-[11px] text-rose-700">關鍵扣分</div>
                          <ul className="list-disc pl-4 [overflow-wrap:anywhere] break-words">
                            {simulationExecutionStatus.scoring.keyNegativeFactors.map((item) => (
                              <li key={`minus-${item.label}`}>{item.label}（{item.impact}）</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {simulationExecutionStatus?.pendingOrder ? (
                    <div className="rounded-lg border border-sky-200 bg-sky-50 p-2 text-slate-700">
                      <div>掛單方向：{sideLabel(simulationExecutionStatus.pendingOrder.side)}</div>
                      <div>觸發價格：{formatNumber(simulationExecutionStatus.pendingOrder.triggerPrice, paperDigits)}</div>
                      <div>失效價格：{formatNumber(simulationExecutionStatus.pendingOrder.invalidationPrice, paperDigits)}</div>
                      {simulationExecutionStatus.pendingOrder?.conditionalPending?.enabled ? (
                        <>
                          <div>已預掛單：是（條件式預掛單）</div>
                          <div>為何可預掛：{(simulationExecutionStatus.pendingOrder.conditionalPending.whyEligible || []).join(" / ") || "-"}</div>
                          <div>撤單條件：{(simulationExecutionStatus.pendingOrder.conditionalPending.autoCancelConditions || []).join(" / ") || "-"}</div>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                  {simulationExecutionStatus?.unmetConditions?.length ? (
                    <div>
                      <div className="mb-1 text-slate-500">未成立條件</div>
                      <ul className="list-disc space-y-0.5 pl-4 text-slate-700">
                        {simulationExecutionStatus.unmetConditions.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {simulationExecutionStatus?.distances?.length ? (
                    <div>
                      <div className="mb-1 text-slate-500">距離觸發</div>
                      <ul className="list-disc space-y-0.5 pl-4 text-slate-700">
                        {simulationExecutionStatus.distances.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {simulationExecutionStatus?.cooldownDebug ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-slate-700 space-y-1">
                      <div className="font-semibold text-amber-800">Cooldown Debug</div>
                      <DebugField label="hasKlineConfirmation" value={simulationExecutionStatus.hasKlineConfirmation ? "true" : "false"} />
                      <DebugField label="isTrendRelaxed" value={simulationExecutionStatus.isTrendRelaxed ? "true" : "false"} />
                      <DebugField label="forcedTradeRelaxation" value={simulationExecutionStatus.forcedTradeRelaxation ? "true" : "false"} />
                      <DebugField
                        label="relaxationLevel"
                        value={simulationExecutionStatus.relaxationLevel
                          ? [
                            simulationExecutionStatus.relaxationLevel.rr ? "RR" : null,
                            simulationExecutionStatus.relaxationLevel.kline ? "Kline" : null,
                            simulationExecutionStatus.relaxationLevel.location ? "Location" : null,
                          ].filter(Boolean).join(" / ") || "-"
                          : "-"}
                      />
                      <DebugField label="lastTradeDirection" value={simulationExecutionStatus.cooldownDebug.lastTradeDirection || "-"} />
                      <DebugField label="longLossStreak" value={simulationExecutionStatus.cooldownDebug.longLossStreak ?? "-"} />
                      <DebugField label="shortLossStreak" value={simulationExecutionStatus.cooldownDebug.shortLossStreak ?? "-"} />
                      <DebugField label="consecutiveLossCount" value={simulationExecutionStatus.cooldownDebug.consecutiveLossCount ?? "-"} />
                      <DebugField label="cooldownActive" value={simulationExecutionStatus.cooldownDebug.cooldownActive ? "true" : "false"} />
                      <DebugField label="cooldownBarsLeft" value={simulationExecutionStatus.cooldownDebug.cooldownBarsLeft ?? "-"} />
                    </div>
                  ) : null}
                  <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-2 text-slate-700 space-y-1">
                    <div className="font-semibold text-indigo-800">Performance Filter Debug</div>
                    <DebugField label="totalOpenPositionsAllSymbols" value={accountSnapshot.totalOpenPositionsAllSymbols ?? 0} />
                    <DebugField label="totalPendingOrdersAllSymbols" value={accountSnapshot.totalPendingOrdersAllSymbols ?? 0} />
                    <DebugField label="currentSymbolOpenPositions" value={accountSnapshot.currentSymbolOpenPositionsCount ?? 0} />
                    <DebugField label="currentSymbolPendingOrders" value={accountSnapshot.currentSymbolPendingOrdersCount ?? 0} />
                    <DebugField label="currentFullSetupKey" value={performanceDebug.currentFullSetupKey || performanceDebug.currentSetupKey || "-"} />
                    <DebugField label="currentCoarseSetupKey" value={performanceDebug.currentCoarseSetupKey || "-"} />
                    <DebugField label="performanceSource" value={performanceDebug.performanceSource || "-"} />
                    <DebugField label="performanceSampleSize" value={performanceDebug.performanceSampleSize ?? performanceDebug.currentSetupSampleSize ?? 0} />
                    <DebugField label="performanceWinRate" value={performanceDebug.performanceWinRate == null ? "-" : `${formatNumber(performanceDebug.performanceWinRate, 1)}%`} />
                    <DebugField label="performanceAvgPnl" value={performanceDebug.performanceAvgPnl == null ? "-" : formatNumber(performanceDebug.performanceAvgPnl, 2)} />
                    <DebugField label="blockedByPerformanceFilter" value={performanceDebug.blockedByPerformanceFilter ? "true" : "false"} />
                  </div>
                  <div>時間：{formatDate(simulationExecutionStatus?.timestamp)}</div>
                </CardContent>
              </Card>
            ) : null}
            <Button variant="ghost" className="rounded-2xl text-rose-600 hover:bg-rose-50 hover:text-rose-700" onClick={onResetPaperAccount}>重置模擬</Button>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
