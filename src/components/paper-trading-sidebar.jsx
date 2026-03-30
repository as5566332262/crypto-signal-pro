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

function formatEntryReason(entryReason) {
  if (!entryReason) return ["-"];
  return [
    `Breakout/Breakdown：${entryReason.breakoutBreakdownCondition || "-"}`,
    `Timeframe：${entryReason.timeframeCondition || "-"}`,
    `Indicator：${entryReason.indicatorCondition || "-"}`,
  ];
}

function StatRow({ label, value, emphasize = false }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-slate-500">{label}</span>
      <span className={`text-right ${emphasize ? "font-semibold text-slate-900" : "text-slate-700"}`}>{value}</span>
    </div>
  );
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

export function OpenPositionsCard({ accountSnapshot, paperDigits, formatNumber }) {
  const positions = accountSnapshot.openPositions || [];

  return (
    <Card className="rounded-2xl border-slate-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">持倉中（Open Position）</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs text-slate-600">
        <div>目前持倉: {positions.length}</div>
        {positions.length ? (
          positions.slice(0, 3).map((position) => {
            const positionValue = Number(position.currentPrice || 0) * Number(position.quantity || 0);
            const pnlPositive = Number(position.unrealizedPnl || 0) >= 0;
            return (
              <div key={position.id} className="space-y-1.5 rounded-lg border border-indigo-100 bg-indigo-50/40 p-2">
                <div className="font-semibold text-indigo-700">狀態：持倉中</div>
                <div className="font-semibold text-slate-800">{position.symbol} {sideLabel(position.side)}</div>
                <StatRow label="進場價" value={formatNumber(position.entryPrice, paperDigits)} />
                <StatRow label="現價" value={formatNumber(position.currentPrice, paperDigits)} />
                <StatRow label="數量" value={`${formatNumber(position.quantity, 2)} ${position.symbol.replace("USDT", "")}`} />
                <StatRow label="倉位價值" value={`${formatNumber(positionValue, 2)} USDT`} />
                <StatRow
                  label="未實現損益"
                  value={`${pnlPositive ? "+" : ""}${formatNumber(position.unrealizedPnl, 2)} USDT`}
                  emphasize
                />
                <StatRow label="止損" value={formatNumber(position.stopLoss, paperDigits)} />
                <StatRow label="TP1" value={formatNumber(position.takeProfit1, paperDigits)} />
                <StatRow label="TP2" value={formatNumber(position.takeProfit2, paperDigits)} />
                <StatRow label="TP3" value={formatNumber(position.takeProfit3, paperDigits)} />
                <div className="space-y-1">
                  <div className="text-slate-500">進場依據</div>
                  {formatEntryReason(position.entryReason).map((line) => (
                    <div key={line} className="text-slate-700">{line}</div>
                  ))}
                </div>
                <StatRow label="開倉時間" value={new Date(position.openedAt).toLocaleString()} />
              </div>
            );
          })
        ) : (
          <div>目前無持倉</div>
        )}
      </CardContent>
    </Card>
  );
}

export function PendingOrdersCard({ pendingOrders, paperDigits, formatNumber }) {
  return (
    <Card className="rounded-2xl border-slate-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">掛單中（Pending）</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        {pendingOrders.length ? (
          pendingOrders.slice(0, 6).map((order) => (
            <div key={order.id} className="space-y-1.5 rounded-lg border border-sky-100 bg-sky-50/40 p-2 text-slate-600">
              <div className="font-semibold text-sky-700">狀態：掛單中</div>
              <div className="font-semibold text-slate-800">{order.symbol} {sideLabel(order.side)}</div>
              <StatRow label="觸發價" value={formatNumber(order.triggerPrice, paperDigits)} />
              <StatRow label="數量" value={`${formatNumber(order.quantity, 2)} ${order.symbol.replace("USDT", "")}`} />
              <StatRow label="止損" value={formatNumber(order.stopLoss, paperDigits)} />
              <StatRow label="TP1" value={formatNumber(order.takeProfit1, paperDigits)} />
              <StatRow label="TP2" value={formatNumber(order.takeProfit2, paperDigits)} />
              <StatRow label="TP3" value={formatNumber(order.takeProfit3, paperDigits)} />
              <StatRow label="失效價格" value={formatNumber(order.invalidationPrice, paperDigits)} />
              <div className="space-y-1">
                <div className="text-slate-500">進場依據</div>
                {formatEntryReason(order.entryReason).map((line) => (
                  <div key={line} className="text-slate-700">{line}</div>
                ))}
              </div>
              <StatRow label="建立時間" value={new Date(order.createdAt).toLocaleString()} />
            </div>
          ))
        ) : (
          <div className="text-slate-500">無待觸發掛單</div>
        )}
      </CardContent>
    </Card>
  );
}

export function CancelledOrdersCard({ cancelledOrders, paperDigits, formatNumber }) {
  return (
    <Card className="rounded-2xl border-slate-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">已取消掛單</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        {cancelledOrders.length ? (
          cancelledOrders.slice(0, 6).map((order) => (
            <div key={`${order.id}-${order.cancelledAt || order.createdAt}`} className="rounded-lg bg-slate-50 p-2 text-slate-600">
              <div className="font-medium text-slate-700">{order.symbol} · {sideLabel(order.side)}</div>
              <div>觸發價: {formatNumber(order.triggerPrice, paperDigits)}</div>
              <div>失效價: {formatNumber(order.invalidationPrice, paperDigits)}</div>
              <div>原因: {order.cancelReason || "-"}</div>
              <div>取消: {order.cancelledAt ? new Date(order.cancelledAt).toLocaleString() : "-"}</div>
            </div>
          ))
        ) : (
          <div className="text-slate-500">無取消掛單紀錄</div>
        )}
      </CardContent>
    </Card>
  );
}

export function TradeHistoryDrawer({ closedTrades, paperDigits, formatNumber }) {
  return (
    <Card className="rounded-2xl border-slate-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">已平倉（History）</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        {closedTrades.length ? (
          closedTrades.slice(0, 6).map((trade) => {
            const pnlPositive = Number(trade.realizedPnl || 0) >= 0;
            return (
              <div key={trade.id} className="space-y-1.5 rounded-lg bg-slate-50 p-2 text-slate-600">
                <div className="font-medium text-slate-700">{trade.symbol} {sideLabel(trade.side)}</div>
                <StatRow label="數量" value={formatNumber(trade.quantity, 2)} />
                <StatRow label="進場價" value={formatNumber(trade.entryPrice, paperDigits)} />
                <StatRow label="出場價" value={formatNumber(trade.exitPrice, paperDigits)} />
                <StatRow label="已實現損益" value={`${pnlPositive ? "+" : ""}${formatNumber(trade.realizedPnl, 2)} USDT`} emphasize />
                <StatRow label="平倉原因" value={reasonLabel(trade.closeReason)} />
                <div className="space-y-1">
                  <div className="text-slate-500">進場依據</div>
                  {formatEntryReason(trade.entryReason).map((line) => (
                    <div key={line} className="text-slate-700">{line}</div>
                  ))}
                </div>
                <StatRow label="開倉時間" value={new Date(trade.openedAt).toLocaleString()} />
                <StatRow label="平倉時間" value={new Date(trade.closedAt).toLocaleString()} />
              </div>
            );
          })
        ) : (
          <div className="text-slate-500">無交易紀錄</div>
        )}
      </CardContent>
    </Card>
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
  formatNumber,
  simulationOrderConfig,
  onSimulationQuantityChange,
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
          <PendingOrdersCard pendingOrders={accountSnapshot.pendingOrders || []} paperDigits={paperDigits} formatNumber={formatNumber} />
          <OpenPositionsCard accountSnapshot={accountSnapshot} paperDigits={paperDigits} formatNumber={formatNumber} />
          <CancelledOrdersCard cancelledOrders={accountSnapshot.cancelledOrders || []} paperDigits={paperDigits} formatNumber={formatNumber} />
          <TradeHistoryDrawer closedTrades={accountSnapshot.closedTrades || []} paperDigits={paperDigits} formatNumber={formatNumber} />
          <DebugStateCard accountSnapshot={accountSnapshot} />

          <div className="grid grid-cols-1 gap-2">
            <Button className="rounded-2xl bg-slate-900 text-white hover:bg-slate-800" onClick={onExecuteSimulation}>執行模擬</Button>
            <Button className="rounded-2xl" variant="outline" onClick={onClosePosition}>平倉</Button>
            <Button variant="ghost" className="rounded-2xl text-rose-600 hover:bg-rose-50 hover:text-rose-700" onClick={onResetPaperAccount}>重置模擬</Button>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
