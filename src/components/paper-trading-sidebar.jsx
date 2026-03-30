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
    TP1: "TP1",
    TP2: "TP2",
    TP3: "TP3",
    STOP_LOSS: "止損",
    INVALIDATION: "失效",
    TRAP_EXIT: "陷阱退出",
    MANUAL_CLOSE: "手動平倉",
  };
  return reasonMap[reason] || reason || "-";
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
  const tabItems = [
    { key: "positions", label: "持有倉位", count: openPositions.length },
    { key: "pending", label: "當前委託", count: pendingOrders.length },
    { key: "closed", label: "已平倉", count: closedTrades.length },
    { key: "cancelled", label: "已取消", count: cancelledOrders.length },
  ];

  const takeProfitDetailLabel = (item) =>
    [
      item.takeProfit1 ? `TP1 ${formatNumber(item.takeProfit1, paperDigits)}` : null,
      item.takeProfit2 ? `TP2 ${formatNumber(item.takeProfit2, paperDigits)}` : null,
      item.takeProfit3 ? `TP3 ${formatNumber(item.takeProfit3, paperDigits)}` : null,
    ].filter(Boolean).join(" / ") || "-";

  const formatDate = (value) => (value ? new Date(value).toLocaleString() : "-");

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
            <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
              {openPositions.map((position) => {
                const pnlPositive = Number(position.unrealizedPnl || 0) >= 0;
                const positionValue = Number(position.currentPrice || 0) * Number(position.quantity || 0);
                return (
                  <div key={position.id} className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="mb-2.5 flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-slate-800">{position.symbol}</div>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${position.side === "SHORT" ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>
                        {sideLabel(position.side)}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                      <InfoItem label="進場價" value={formatNumber(position.entryPrice, paperDigits)} />
                      <InfoItem label="現價" value={formatNumber(position.currentPrice, paperDigits)} />
                      <InfoItem label="數量" value={formatNumber(position.quantity, 2)} />
                      <InfoItem label="倉位價值" value={`${formatNumber(positionValue, 2)} USDT`} />
                      <InfoItem
                        label="未實現損益"
                        value={`${pnlPositive ? "+" : ""}${formatNumber(position.unrealizedPnl, 2)} USDT`}
                        valueClassName={pnlPositive ? "text-emerald-600" : "text-rose-600"}
                      />
                      <InfoItem label="止損" value={formatNumber(position.stopLoss, paperDigits)} />
                      <InfoItem label="止盈（TP1 / TP2 / TP3）" value={takeProfitDetailLabel(position)} className="col-span-2" />
                      <InfoItem label="開倉時間" value={formatDate(position.openedAt)} className="col-span-2" />
                    </div>
                    <div className="mt-3 border-t border-slate-100 pt-2.5">
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
                  <div className="mb-2.5 flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-slate-800">{order.symbol}</div>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${order.side === "SHORT" ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>
                      {sideLabel(order.side)}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                    <InfoItem label="觸發價" value={formatNumber(order.triggerPrice, paperDigits)} />
                    <InfoItem label="數量" value={formatNumber(order.quantity, 2)} />
                    <InfoItem label="止損" value={formatNumber(order.stopLoss, paperDigits)} />
                    <InfoItem label="失效價" value={formatNumber(order.invalidationPrice, paperDigits)} />
                    <InfoItem label="止盈（TP1 / TP2 / TP3）" value={takeProfitDetailLabel(order)} className="col-span-2" />
                    <InfoItem label="建立時間" value={formatDate(order.createdAt)} className="col-span-2" />
                  </div>
                  <div className="mt-3 border-t border-slate-100 pt-2.5">
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
          closedTrades.length ? (
            <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
              {closedTrades.map((trade) => {
                const pnlPositive = Number(trade.realizedPnl || 0) >= 0;
                return (
                  <div key={trade.id} className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-slate-800">{trade.symbol}</div>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${trade.side === "SHORT" ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>
                        {sideLabel(trade.side)}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                      <InfoItem label="進場價" value={formatNumber(trade.entryPrice, paperDigits)} />
                      <InfoItem label="出場價" value={formatNumber(trade.exitPrice, paperDigits)} />
                      <InfoItem label="數量" value={formatNumber(trade.quantity, 2)} />
                      <InfoItem
                        label="已實現損益"
                        value={`${pnlPositive ? "+" : ""}${formatNumber(trade.realizedPnl, 2)} USDT`}
                        valueClassName={pnlPositive ? "text-emerald-600" : "text-rose-600"}
                      />
                      <InfoItem label="平倉原因" value={reasonLabel(trade.closeReason)} className="col-span-2" />
                      <InfoItem label="時間" value={formatDate(trade.closedAt)} className="col-span-2" />
                    </div>
                  </div>
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
    <div className={`rounded-lg bg-slate-50 p-2 ${className}`}>
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`mt-1 break-all font-semibold text-slate-800 ${valueClassName}`}>{value || "-"}</div>
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
  onClosePosition,
  onCancelPendingOrder,
  formatNumber,
  simulationOrderConfig,
  onSimulationQuantityChange,
  simulationExecutionStatus,
  simulationButtonState,
}) {
  const sidebarWidthClass = sidebarOpen ? "w-full lg:w-[320px]" : "w-full lg:w-[76px]";

  return (
    <aside className={`shrink-0 border-b border-slate-200 bg-slate-50/70 p-3 transition-all duration-200 lg:border-b-0 lg:border-r ${sidebarWidthClass}`}>
      <div className="flex items-center justify-between gap-2">
        {sidebarOpen ? <div className="text-sm font-semibold text-slate-700">模擬交易</div> : <Wallet className="mx-auto h-5 w-5 text-slate-600" />}
        <Button variant="ghost" size="icon" onClick={onToggleSidebar}>
          {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
        </Button>
      </div>

      {sidebarOpen ? (
        <div className="mt-4 space-y-3">
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

          <div className="grid grid-cols-1 gap-2">
            <Button
              className="rounded-2xl bg-slate-900 text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={onExecuteSimulation}
              disabled={simulationButtonState?.disabled}
              title={simulationButtonState?.disabledReason || ""}
            >
              執行模擬
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
                <div>時間：{simulationExecutionStatus?.timestamp ? new Date(simulationExecutionStatus.timestamp).toLocaleString() : "-"}</div>
              </CardContent>
            </Card>
            <Button variant="ghost" className="rounded-2xl text-rose-600 hover:bg-rose-50 hover:text-rose-700" onClick={onResetPaperAccount}>重置模擬</Button>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
