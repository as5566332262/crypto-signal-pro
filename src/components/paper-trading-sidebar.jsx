import React from "react";
import { PanelLeftClose, PanelLeftOpen, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
        <div className="rounded-lg bg-slate-50 p-2"><div className="text-[11px] text-slate-500">已實現損益</div><div className="mt-0.5 font-semibold text-slate-800">{formatNumber(accountSnapshot.realizedPnL, 2)} USDT</div></div>
        <div className="col-span-2 rounded-lg bg-slate-50 p-2"><div className="text-[11px] text-slate-500">未實現損益</div><div className="mt-0.5 font-semibold text-slate-800">{formatNumber(accountSnapshot.unrealizedPnL, 2)} USDT</div></div>
      </CardContent>
    </Card>
  );
}

export function OpenPositionsCard({ accountSnapshot, paperDigits, formatNumber, activeOrders = 0 }) {
  return (
    <Card className="rounded-2xl border-slate-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">持倉資訊</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs text-slate-600">
        <div>目前持倉: {accountSnapshot.openPosition ? 1 : 0}</div>
        <div>模擬委託中: {activeOrders}</div>
        {accountSnapshot.openPosition ? (
          <>
            <div>方向: <span className="font-semibold text-slate-800">{accountSnapshot.openPosition.side}</span></div>
            <div>進場: <span className="font-semibold text-slate-800">{formatNumber(accountSnapshot.openPosition.entryPrice, paperDigits)}</span></div>
            <div>SL: <span className="font-semibold text-slate-800">{formatNumber(accountSnapshot.openPosition.stopLoss, paperDigits)}</span></div>
            <div>TP: <span className="font-semibold text-slate-800">{formatNumber(accountSnapshot.openPosition.target1, paperDigits)} / {formatNumber(accountSnapshot.openPosition.target2, paperDigits)}</span></div>
          </>
        ) : (
          <div>目前無持倉</div>
        )}
      </CardContent>
    </Card>
  );
}

export function TradeHistoryDrawer({ tradeHistory, paperDigits, formatNumber }) {
  return (
    <Card className="rounded-2xl border-slate-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">交易紀錄</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        {tradeHistory.length ? (
          tradeHistory.slice(0, 6).map((trade, index) => (
            <div key={`${trade.openedAt}-${index}`} className="rounded-lg bg-slate-50 p-2 text-slate-600">
              <div className="font-medium text-slate-700">{trade.symbol} {trade.side} · {trade.result}</div>
              <div>{formatNumber(trade.entryPrice, paperDigits)} → {formatNumber(trade.exitPrice, paperDigits)}</div>
              <div>損益: {formatNumber(trade.pnl, 2)} USDT</div>
            </div>
          ))
        ) : (
          <div className="text-slate-500">無交易紀錄</div>
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
  const sidebarWidthClass = sidebarOpen ? "w-full lg:w-[280px]" : "w-full lg:w-[76px]";

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

          <PaperAccountCard accountSnapshot={accountSnapshot} formatNumber={formatNumber} />
          <OpenPositionsCard accountSnapshot={accountSnapshot} paperDigits={paperDigits} formatNumber={formatNumber} />
          <TradeHistoryDrawer tradeHistory={accountSnapshot.tradeHistory} paperDigits={paperDigits} formatNumber={formatNumber} />

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
