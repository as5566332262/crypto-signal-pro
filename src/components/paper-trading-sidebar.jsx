import React from "react";
import { PanelLeftClose, PanelLeftOpen, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function PaperAccountCard({ accountSnapshot, formatNumber }) {
  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Paper Account</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-xs text-slate-600">
        <div>Balance: {formatNumber(accountSnapshot.balance, 2)} USDT</div>
        <div>Equity: {formatNumber(accountSnapshot.equity, 2)} USDT</div>
        <div>Used Margin: {formatNumber(accountSnapshot.usedMargin || 0, 2)} USDT</div>
        <div>Realized PnL: {formatNumber(accountSnapshot.realizedPnL, 2)} USDT</div>
        <div>Unrealized PnL: {formatNumber(accountSnapshot.unrealizedPnL, 2)} USDT</div>
      </CardContent>
    </Card>
  );
}

export function OpenPositionsCard({ accountSnapshot, paperDigits, formatNumber, activeOrders = 0 }) {
  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">OpenPositionsCard</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-xs text-slate-600">
        <div>Open positions: {accountSnapshot.openPosition ? 1 : 0}</div>
        <div>Active simulated orders: {activeOrders}</div>
        {accountSnapshot.openPosition ? (
          <>
            <div>Side: {accountSnapshot.openPosition.side}</div>
            <div>Entry: {formatNumber(accountSnapshot.openPosition.entryPrice, paperDigits)}</div>
            <div>SL: {formatNumber(accountSnapshot.openPosition.stopLoss, paperDigits)}</div>
            <div>TP: {formatNumber(accountSnapshot.openPosition.target1, paperDigits)} / {formatNumber(accountSnapshot.openPosition.target2, paperDigits)}</div>
          </>
        ) : (
          <div>No active position</div>
        )}
      </CardContent>
    </Card>
  );
}

export function TradeHistoryDrawer({ tradeHistory, paperDigits, formatNumber }) {
  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">TradeHistoryDrawer</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        {tradeHistory.length ? (
          tradeHistory.slice(0, 6).map((trade, index) => (
            <div key={`${trade.openedAt}-${index}`} className="rounded-lg bg-slate-50 p-2 text-slate-600">
              <div className="font-medium text-slate-700">{trade.symbol} {trade.side} · {trade.result}</div>
              <div>{formatNumber(trade.entryPrice, paperDigits)} → {formatNumber(trade.exitPrice, paperDigits)}</div>
              <div>PnL: {formatNumber(trade.pnl, 2)} USDT</div>
            </div>
          ))
        ) : (
          <div className="text-slate-500">No trade history</div>
        )}
      </CardContent>
    </Card>
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
}) {
  return (
    <aside className={`border-r border-slate-200 bg-white p-3 transition-all duration-200 ${sidebarOpen ? "w-80" : "w-[72px]"}`}>
      <div className="flex items-center justify-between gap-2">
        {sidebarOpen ? <div className="text-sm font-semibold text-slate-700">Paper Trading</div> : <Wallet className="mx-auto h-5 w-5 text-slate-600" />}
        <Button variant="ghost" size="icon" onClick={onToggleSidebar}>
          {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
        </Button>
      </div>

      {sidebarOpen ? (
        <div className="mt-4 space-y-3">
          <Card className="rounded-2xl">
            <CardContent className="space-y-2 p-3">
              <div className="text-xs font-medium text-slate-500">Symbol</div>
              <Select value={paperSymbol} onValueChange={setPaperSymbol}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {supportedSymbols.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <PaperAccountCard accountSnapshot={accountSnapshot} formatNumber={formatNumber} />
          <OpenPositionsCard accountSnapshot={accountSnapshot} paperDigits={paperDigits} formatNumber={formatNumber} />
          <TradeHistoryDrawer tradeHistory={accountSnapshot.tradeHistory} paperDigits={paperDigits} formatNumber={formatNumber} />

          <div className="grid grid-cols-1 gap-2">
            <Button className="rounded-2xl" onClick={onExecuteSimulation}>Execute simulation</Button>
            <Button className="rounded-2xl" variant="outline" onClick={onClosePosition}>Close position</Button>
            <Button variant="outline" className="rounded-2xl" onClick={onResetPaperAccount}>Reset simulation</Button>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
