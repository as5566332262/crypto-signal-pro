import React from "react";
import { PanelLeftClose, PanelLeftOpen, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";

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
  return reasonMap[reason] || reason || "-";
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

export function PaperAccountCard({ accountSnapshot, formatNumber }) {
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
    console.log("[TradingStateTerminal] closedTrades.length =", closedTrades.length);
    return closedTrades.filter((trade, index) => {
      const valid = trade && typeof trade === "object";
      if (!valid) {
        console.error("[TradingStateTerminal] Invalid closed trade item filtered out:", { index, trade });
      }
      return valid;
    });
  }, [closedTrades]);
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
            <div className="max-h-[420px] space-y-2.5 overflow-y-auto pr-1">
              {openPositions.map((position) => {
                const pnlPositive = Number(position.unrealizedPnl || 0) >= 0;
                return (
                  <div key={position.id} className="rounded-xl border border-slate-200 bg-white p-3">
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
                    <div className="space-y-2.5">
                      <div className="whitespace-nowrap text-sm font-semibold text-slate-800">
                        {formatNumber(position.entryPrice, paperDigits)} <span className="px-1 text-slate-400">→</span> {formatNumber(position.currentPrice, paperDigits)}
                      </div>
                      <InfoSingleRow
                        label="數量"
                        value={`${formatNumber(position.quantity, 2)} ${position.symbol.replace("USDT", "")}`}
                      />
                      <div className="flex flex-col gap-1.5">
                        <InlineLabelValue label="止損" value={formatNumber(position.stopLoss, paperDigits)} />
                        <InlineLabelValue
                          label="止盈1"
                          value={position.takeProfit1 ? formatNumber(position.takeProfit1, paperDigits) : "-"}
                        />
                      </div>
                      <div className="whitespace-nowrap text-[13px] font-medium text-slate-700">
                        開倉：<span className="font-semibold text-slate-800">{formatDate(position.openedAt)}</span>
                      </div>
                    </div>
                    <div className="mt-3 pt-1">
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
            <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
              {pendingOrders.map((order) => (
                <div key={order.id} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="truncate text-sm font-semibold text-slate-800">{order.symbol}</div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${order.side === "SHORT" ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>
                      {sideLabel(order.side)}
                    </span>
                  </div>
                  <div className="space-y-2.5">
                    <InfoPairRow
                      leftLabel="觸發價"
                      leftValue={formatNumber(order.triggerPrice, paperDigits)}
                      rightLabel="數量"
                      rightValue={`${formatNumber(order.quantity, 2)} ${order.symbol.replace("USDT", "")}`}
                    />
                    <InfoPairRow
                      leftLabel="止損"
                      leftValue={formatNumber(order.stopLoss, paperDigits)}
                      rightLabel="失效價"
                      rightValue={formatNumber(order.invalidationPrice, paperDigits)}
                    />
                    <InfoSingleRow label="止盈1 / 止盈2 / 止盈3" value={takeProfitDetailLabel(order)} />
                    <InfoSingleRow label="建立時間" value={formatDate(order.createdAt)} />
                  </div>
                  <div className="mt-3 pt-1">
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
                try {
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

                  return (
                    <div key={trade.id || `${trade.symbol || "unknown"}-${index}`} className="rounded-xl border border-slate-200 bg-white p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-slate-800">{trade.symbol || "-"}</div>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${trade.side === "SHORT" ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>
                          {sideLabel(trade.side)}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                        <InfoItem label="進場價" value={safeFormatNumber(trade.entryPrice, paperDigits)} />
                        <InfoItem label="出場價" value={safeFormatNumber(trade.exitPrice, paperDigits)} />
                        <InfoItem label="數量" value={safeFormatNumber(trade.quantity, 2)} />
                        <InfoItem
                          label="已實現損益"
                          value={hasRealizedPnl ? `${pnlPositive ? "+" : ""}${safeFormatNumber(realizedPnlNumber, 2)} USDT` : "-"}
                          valueClassName={hasRealizedPnl ? (pnlPositive ? "text-emerald-600" : "text-rose-600") : ""}
                        />
                        <InfoItem label="平倉原因" value={reasonLabel(closeReasonRaw)} className="col-span-2" />
                        <InfoItem label="decisionType" value={trade.decisionType ?? "-"} className="col-span-2" />
                        <InfoItem label="pendingType" value={trade.pendingType ?? "-"} className="col-span-2" />
                        <InfoItem label="scoreGrade / totalScore" value={`${trade.scoreGrade ?? "-"} / ${trade.totalScore ?? "-"}`} className="col-span-2" />
                        <InfoItem label="regime / confirmation" value={`${trade.regime ?? "-"} / ${trade.confirmationState ?? "-"}`} className="col-span-2" />
                        <InfoItem label="進場理由" value={trade.entryReasonDetail ?? trade.entryReason ?? "-"} className="col-span-2" />
                        <InfoItem label="最大浮盈 / 最大浮虧" value={`${safeFormatNumber(maxRunupRaw, 2)} / ${safeFormatNumber(maxDrawdownRaw, 2)}`} className="col-span-2" />
                        <InfoItem label="建立/進場/出場" value={`${formatDate(createdAt)} / ${formatDate(enteredAt)} / ${formatDate(closedAt)}`} className="col-span-2" />
                      </div>
                    </div>
                  );
                } catch (error) {
                  console.error("[TradingStateTerminal] Failed to render closed trade card:", { index, trade, error });
                  return null;
                }
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
                    <InfoItem label="取消原因" value={order.cancelReason || "-"} className="col-span-2" />
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
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`mt-0.5 min-w-0 whitespace-nowrap font-semibold text-slate-800 ${valueClassName}`}>{value ?? "-"}</div>
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
  return (
    <div className="flex items-center gap-1.5 text-[13px] font-medium text-slate-700">
      <span className="text-slate-500">{label}：</span>
      <span className={`font-semibold text-slate-800 ${valueClassName}`}>{value || "-"}</span>
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
}) {
  const [runtimeNow, setRuntimeNow] = React.useState(Date.now());
  React.useEffect(() => {
    if (simulationLifecycle !== "running") return undefined;
    const timer = window.setInterval(() => setRuntimeNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [simulationLifecycle]);
  const simulationStartedAtTs = toTimestamp(simulationStartedAt);
  const runtimeSec = simulationStartedAtTs ? Math.max(0, Math.floor((runtimeNow - simulationStartedAtTs) / 1000)) : 0;
  const runtimeLabel = `${Math.floor(runtimeSec / 3600)}h ${Math.floor((runtimeSec % 3600) / 60)}m ${runtimeSec % 60}s`;

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
          <TradingStateTerminal
            openPositions={accountSnapshot.openPositions || []}
            pendingOrders={accountSnapshot.pendingOrders || []}
            closedTrades={accountSnapshot.closedTrades || []}
            cancelledOrders={accountSnapshot.cancelledOrders || []}
            paperDigits={paperDigits}
            formatNumber={formatNumber}
            onClosePosition={onClosePosition}
            onCancelPendingOrder={onCancelPendingOrder}
          />
          <DebugStateCard accountSnapshot={accountSnapshot} />
          <Card className="rounded-2xl border-slate-200">
            <CardHeader className="pb-2"><CardTitle className="text-sm">模擬績效統計</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
              <InfoItem label="總交易數" value={accountSnapshot.simulationStats?.totalTrades} />
              <InfoItem label="勝率" value={`${formatNumber(accountSnapshot.simulationStats?.winRate, 1)}%`} />
              <InfoItem label="總損益" value={formatNumber(accountSnapshot.simulationStats?.totalPnl, 2)} />
              <InfoItem label="已實現損益" value={formatNumber(accountSnapshot.simulationStats?.realizedPnl, 2)} />
              <InfoItem label="未實現損益" value={formatNumber(accountSnapshot.simulationStats?.unrealizedPnl, 2)} />
              <InfoItem label="平均盈虧比" value={formatNumber(accountSnapshot.simulationStats?.avgRR, 2)} />
              <InfoItem label="最大連勝" value={accountSnapshot.simulationStats?.maxWinStreak} />
              <InfoItem label="最大連敗" value={accountSnapshot.simulationStats?.maxLossStreak} />
              <InfoItem label="最大回撤" value={formatNumber(accountSnapshot.simulationStats?.maxDrawdown, 2)} />
              <InfoItem label="多單勝率" value={`${formatNumber(accountSnapshot.simulationStats?.longWinRate, 1)}%`} />
              <InfoItem label="空單勝率" value={`${formatNumber(accountSnapshot.simulationStats?.shortWinRate, 1)}%`} />
              </div>
              <div>
                <div className="mb-1 text-slate-500">各 decisionType 勝率</div>
                <ul className="list-disc pl-4">
                  {Object.entries(accountSnapshot.simulationStats?.decisionTypeWinRate || {}).map(([key, value]) => (
                    <li key={key}>{key}: {formatNumber(value, 1)}%</li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="mb-1 text-slate-500">各 pendingType 勝率</div>
                <ul className="list-disc pl-4">
                  {Object.entries(accountSnapshot.simulationStats?.pendingTypeWinRate || {}).map(([key, value]) => (
                    <li key={key}>{key}: {formatNumber(value, 1)}%</li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>
          <Card className="rounded-2xl border-slate-200">
            <CardHeader className="pb-2"><CardTitle className="text-sm">Review / Diagnostics</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-xs">
              <div className="text-slate-500">低勝率 setup</div>
              <ul className="list-disc space-y-1 pl-4">
                {(accountSnapshot.diagnostics?.reviewLines || []).map((line) => <li key={line}>{line}</li>)}
              </ul>
              <div className="text-slate-500">Suggested Adjustments</div>
              <ul className="list-disc space-y-1 pl-4">
                {(accountSnapshot.diagnostics?.suggestions || []).map((line) => <li key={line}>{line}</li>)}
              </ul>
            </CardContent>
          </Card>

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
                {simulationExecutionStatus?.scoring ? (
                  <div className="rounded-lg border border-violet-200 bg-violet-50 p-2 text-slate-700 space-y-1">
                    <div className="font-semibold text-violet-800">Scoring 引擎</div>
                    <div>總分：{simulationExecutionStatus.scoring.totalScore ?? "-"}</div>
                    <div>等級：{simulationExecutionStatus.scoring.scoreGrade || "-"}</div>
                    <div>信心：{simulationExecutionStatus.scoring.confidenceLevel || "-"}</div>
                    {simulationExecutionStatus.scoring.keyPositiveFactors?.length ? (
                      <div>
                        <div className="text-[11px] text-violet-700">關鍵加分</div>
                        <ul className="list-disc pl-4">
                          {simulationExecutionStatus.scoring.keyPositiveFactors.map((item) => (
                            <li key={`plus-${item.label}`}>{item.label}（+{item.impact}）</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {simulationExecutionStatus.scoring.keyNegativeFactors?.length ? (
                      <div>
                        <div className="text-[11px] text-rose-700">關鍵扣分</div>
                        <ul className="list-disc pl-4">
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
                    <div>hasKlineConfirmation：{simulationExecutionStatus.hasKlineConfirmation ? "true" : "false"}</div>
                    <div>lastTradeDirection：{simulationExecutionStatus.cooldownDebug.lastTradeDirection || "-"}</div>
                    <div>consecutiveLossCount：{simulationExecutionStatus.cooldownDebug.consecutiveLossCount ?? "-"}</div>
                    <div>cooldownActive：{simulationExecutionStatus.cooldownDebug.cooldownActive ? "true" : "false"}</div>
                    <div>cooldownBarsLeft：{simulationExecutionStatus.cooldownDebug.cooldownBarsLeft ?? "-"}</div>
                  </div>
                ) : null}
                <div>時間：{formatDate(simulationExecutionStatus?.timestamp)}</div>
              </CardContent>
            </Card>
            <Button variant="ghost" className="rounded-2xl text-rose-600 hover:bg-rose-50 hover:text-rose-700" onClick={onResetPaperAccount}>重置模擬</Button>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
