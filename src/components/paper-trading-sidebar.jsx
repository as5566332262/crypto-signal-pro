import React from "react";
import { PanelLeftClose, PanelLeftOpen, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function SimulatorPayloadCard({ simulatorSignalPayload }) {
  if (!simulatorSignalPayload) return null;

  return (
    <Card className="rounded-2xl border border-slate-200 bg-white">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">V6 Simulator Payload（Phase 1）</CardTitle>
      </CardHeader>
      <CardContent>
        <pre className="overflow-x-auto whitespace-pre-wrap text-xs text-slate-600">
          {JSON.stringify(simulatorSignalPayload, null, 2)}
        </pre>
      </CardContent>
    </Card>
  );
}

export default function PaperTradingSidebar({
  sidebarOpen,
  onToggleSidebar,
  appMode,
  setAppMode,
  paperSymbol,
  setPaperSymbol,
  supportedSymbols,
  accountSnapshot,
  paperDigits,
  simulatorSignalPayload,
  onResetPaperAccount,
  formatNumber,
}) {
  return (
    <aside
      className={`border-r border-slate-200 bg-white p-3 transition-all duration-200 ${
        sidebarOpen ? "w-80" : "w-[72px]"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        {sidebarOpen ? (
          <div className="text-sm font-semibold text-slate-700">Workspace</div>
        ) : (
          <Wallet className="mx-auto h-5 w-5 text-slate-600" />
        )}
        <Button variant="ghost" size="icon" onClick={onToggleSidebar}>
          {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
        </Button>
      </div>

      {sidebarOpen ? (
        <div className="mt-4 space-y-3">
          <Card className="rounded-2xl">
            <CardContent className="space-y-2 p-3">
              <div className="text-xs font-medium text-slate-500">模式切換</div>
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" variant={appMode === "analysis" ? "default" : "outline"} onClick={() => setAppMode("analysis")}>
                  分析模式
                </Button>
                <Button size="sm" variant={appMode === "paper" ? "default" : "outline"} onClick={() => setAppMode("paper")}>
                  模擬交易
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardContent className="space-y-2 p-3">
              <div className="text-xs font-medium text-slate-500">模擬幣種</div>
              <Select value={paperSymbol} onValueChange={setPaperSymbol}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {supportedSymbols.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="text-xs text-slate-500">初始資金：{formatNumber(accountSnapshot.initialBalance, 2)} USDT</div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">帳戶資訊</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-xs text-slate-600">
              <div>目前餘額：{formatNumber(accountSnapshot.balance, 2)} USDT</div>
              <div>淨值 Equity：{formatNumber(accountSnapshot.equity, 2)} USDT</div>
              <div>已實現損益：{formatNumber(accountSnapshot.realizedPnL, 2)} USDT</div>
              <div>未實現損益：{formatNumber(accountSnapshot.unrealizedPnL, 2)} USDT</div>
              <div>勝率：{formatNumber(accountSnapshot.winRate, 2)}%</div>
              <div>交易次數：{accountSnapshot.totalTrades}</div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">持倉資訊</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-xs text-slate-600">
              {accountSnapshot.openPosition ? (
                <>
                  <div>狀態：持倉中</div>
                  <div>方向：{accountSnapshot.openPosition.side}</div>
                  <div>進場價：{formatNumber(accountSnapshot.openPosition.entryPrice, paperDigits)}</div>
                  <div>止損：{formatNumber(accountSnapshot.openPosition.stopLoss, paperDigits)}</div>
                  <div>
                    止盈：{formatNumber(accountSnapshot.openPosition.target1, paperDigits)} /{" "}
                    {formatNumber(accountSnapshot.openPosition.target2, paperDigits)}
                  </div>
                  <div>浮盈虧：{formatNumber(accountSnapshot.unrealizedPnL, 2)} USDT</div>
                </>
              ) : (
                <div>目前無持倉</div>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">最近交易紀錄</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              {accountSnapshot.tradeHistory.length ? (
                accountSnapshot.tradeHistory.slice(0, 5).map((trade, index) => (
                  <div key={`${trade.openedAt}-${index}`} className="rounded-lg bg-slate-50 p-2 text-slate-600">
                    <div className="font-medium text-slate-700">
                      {trade.symbol} {trade.side} · {trade.result}
                    </div>
                    <div>
                      {formatNumber(trade.entryPrice, paperDigits)} → {formatNumber(trade.exitPrice, paperDigits)}
                    </div>
                    <div>PnL: {formatNumber(trade.pnl, 2)} USDT</div>
                  </div>
                ))
              ) : (
                <div className="text-slate-500">尚無交易紀錄</div>
              )}
            </CardContent>
          </Card>

          <SimulatorPayloadCard simulatorSignalPayload={simulatorSignalPayload} />

          <Button variant="outline" className="w-full rounded-2xl" onClick={onResetPaperAccount}>
            重設模擬帳戶
          </Button>
        </div>
      ) : null}
    </aside>
  );
}
