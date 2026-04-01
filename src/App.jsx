import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  applyMarketTickToPaperState,
  cancelPendingOrderManually,
  closePositionManually,
  createInitialPaperAccountState,
  DEFAULT_PERFORMANCE_DEBUG_STATE,
  getSimulationEligibility,
  isFormalCancelledOrder,
  isFormalPendingOrder,
  normalizePaperAccountState,
  paperTradingAnalytics,
  paperTradingConstants,
  reconcilePendingOrdersWithDecision,
  resetPaperTradingState,
  simulateDecisionExecution,
} from "@/lib/paper-trading-engine";
import { registerSW } from "virtual:pwa-register";
import PaperTradingSidebar from "@/components/paper-trading-sidebar";
import TradingDecisionPage from "@/components/trading-decision-page";

const SYMBOL_OPTIONS = [
  { label: "BTC", value: "BTCUSDT" },
  { label: "ETH", value: "ETHUSDT" },
  { label: "SOL", value: "SOLUSDT" },
];

const INTERVAL_OPTIONS = [
  { label: "15m", value: "15m" },
  { label: "1h", value: "1h" },
  { label: "4h", value: "4h" },
  { label: "1d", value: "1d" },
];

const ANALYSIS_INTERVALS = ["15m", "1h", "4h", "1d"];

const PAPER_ACCOUNT_STORAGE_KEY = "crypto-signal-pro-paper-account-v7";
const SIMULATION_SNAPSHOT_STORAGE_KEY = "crypto-signal-pro-simulation-snapshot-v1";
const PAPER_SUPPORTED_SYMBOLS = ["BTC", "ETH", "SOL"];
const PAPER_MARKET_SYMBOLS = PAPER_SUPPORTED_SYMBOLS.map((item) => `${item}USDT`);
const SIMULATION_LIFECYCLES = ["running", "paused", "stopped", "idle"];

function normalizeSimulationExecutionStatus(status) {
  if (!status || typeof status !== "object") {
    return {
      ...DEFAULT_PERFORMANCE_DEBUG_STATE,
    };
  }
  return {
    ...DEFAULT_PERFORMANCE_DEBUG_STATE,
    ...status,
    blockedByPerformanceFilter: Boolean(status?.blockedByPerformanceFilter),
    performanceSampleSize: Number(status?.performanceSampleSize ?? status?.currentSetupSampleSize ?? 0),
    currentSetupSampleSize: Number(status?.currentSetupSampleSize ?? status?.performanceSampleSize ?? 0),
    performanceWinRate: status?.performanceWinRate ?? status?.currentSetupWinRate ?? null,
    currentSetupWinRate: status?.currentSetupWinRate ?? status?.performanceWinRate ?? null,
    currentFullSetupKey: status?.currentFullSetupKey || status?.currentSetupKey || "-",
    currentSetupKey: status?.currentSetupKey || status?.currentFullSetupKey || "-",
    currentCoarseSetupKey: status?.currentCoarseSetupKey || "-",
    performanceSource: status?.performanceSource || "-",
  };
}

function createDefaultSymbolSimulationState() {
  return {
    isSimulating: false,
    lifecycle: "idle",
    startedAt: null,
    elapsedTime: 0,
    lastProcessedAt: null,
    lastCandleTime: null,
    lastTickTime: null,
    pendingOrders: [],
    openPositions: [],
    closedTrades: [],
    cooldown: null,
    performanceStats: null,
    executionStatus: normalizeSimulationExecutionStatus(null),
    executionLock: false,
    restore: {
      restored: false,
      restoredAt: null,
      restoredLifecycle: "idle",
      restoredPositionsCount: 0,
      restoredPendingCount: 0,
      lastDecisionTime: null,
      restoredKeys: [],
    },
    rehydrate: {
      attempted: false,
      completed: false,
    },
    simulationAgentRuntimeState: {},
    lastDecisionAt: null,
    currentPhase: "idle",
    waitingReason: "尚未啟動模擬",
    executionMode: null,
    targetEntryZone: null,
    currentPrice: null,
    unmetConditions: [],
    lastBlockReason: null,
    recentSimulationEvents: [],
    lastDecisionSummary: "尚未有決策",
  };
}

function normalizeSimulationStateBySymbol(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return PAPER_SUPPORTED_SYMBOLS.reduce((acc, symbolKey) => {
    const item = source?.[symbolKey] && typeof source[symbolKey] === "object" ? source[symbolKey] : {};
    const lifecycle = SIMULATION_LIFECYCLES.includes(item?.lifecycle) ? item.lifecycle : "idle";
    const startedAtTs = item?.startedAt ? new Date(item.startedAt).getTime() : null;
    const elapsedTime = Number(item?.elapsedTime);
    const now = Date.now();
    const runtimeSec = lifecycle === "running" && Number.isFinite(startedAtTs)
      ? Math.max(0, Math.floor((now - startedAtTs) / 1000))
      : 0;
    acc[symbolKey] = {
      ...createDefaultSymbolSimulationState(),
      ...item,
      isSimulating: lifecycle === "running",
      lifecycle,
      startedAt: item?.startedAt || null,
      elapsedTime: Number.isFinite(elapsedTime) ? elapsedTime : runtimeSec,
      executionStatus: normalizeSimulationExecutionStatus(item?.executionStatus),
      pendingOrders: Array.isArray(item?.pendingOrders) ? item.pendingOrders : [],
      openPositions: Array.isArray(item?.openPositions) ? item.openPositions : [],
      closedTrades: Array.isArray(item?.closedTrades) ? item.closedTrades : [],
      restore: {
        ...createDefaultSymbolSimulationState().restore,
        ...(item?.restore || {}),
        restoredKeys: Array.isArray(item?.restore?.restoredKeys) ? item.restore.restoredKeys : [],
      },
      rehydrate: {
        ...createDefaultSymbolSimulationState().rehydrate,
        ...(item?.rehydrate || {}),
      },
      simulationAgentRuntimeState: item?.simulationAgentRuntimeState && typeof item.simulationAgentRuntimeState === "object"
        ? item.simulationAgentRuntimeState
        : {},
      currentPhase: item?.currentPhase || "idle",
      waitingReason: item?.waitingReason || "尚未啟動模擬",
      executionMode: item?.executionMode || null,
      targetEntryZone: item?.targetEntryZone || null,
      currentPrice: Number.isFinite(Number(item?.currentPrice)) ? Number(item.currentPrice) : null,
      unmetConditions: Array.isArray(item?.unmetConditions) ? item.unmetConditions.slice(0, 3) : [],
      lastBlockReason: item?.lastBlockReason || null,
      recentSimulationEvents: Array.isArray(item?.recentSimulationEvents) ? item.recentSimulationEvents.slice(0, 5) : [],
      lastDecisionSummary: item?.lastDecisionSummary || "尚未有決策",
    };
    return acc;
  }, {});
}

function loadPaperAccount() {
  if (typeof window === "undefined") return createInitialPaperAccountState();
  try {
    const raw = window.localStorage.getItem(PAPER_ACCOUNT_STORAGE_KEY);
    if (!raw) return createInitialPaperAccountState();
    const parsed = JSON.parse(raw);
    return normalizePaperAccountState({
      ...createInitialPaperAccountState(),
      ...parsed,
      openPositions: Array.isArray(parsed?.openPositions) ? parsed.openPositions : [],
      pendingOrders: Array.isArray(parsed?.pendingOrders) ? parsed.pendingOrders : [],
      cancelledOrders: Array.isArray(parsed?.cancelledOrders) ? parsed.cancelledOrders : [],
      closedTrades: Array.isArray(parsed?.closedTrades) ? parsed.closedTrades : [],
      symbolIsolationState: parsed?.symbolIsolationState && typeof parsed.symbolIsolationState === "object"
        ? parsed.symbolIsolationState
        : {},
      simulationOrderConfig: {
        mode: "fixed_quantity",
        quantity: Number(parsed?.simulationOrderConfig?.quantity) > 0 ? Number(parsed.simulationOrderConfig.quantity) : 50,
      },
    }, { eventType: "RESTORE", sourceFunction: "loadPaperAccount" });
  } catch {
    return createInitialPaperAccountState();
  }
}

function loadSimulationSnapshot() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SIMULATION_SNAPSHOT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    const fallbackAccount = loadPaperAccount();
    const normalizedLifecycle = SIMULATION_LIFECYCLES.includes(parsed?.simulationLifecycle)
      ? parsed.simulationLifecycle
      : "idle";
    const normalizedPaperAccount = normalizePaperAccountState({
      ...fallbackAccount,
      ...(parsed?.paperAccount || {}),
      openPositions: Array.isArray(parsed?.openPositions)
        ? parsed.openPositions
        : Array.isArray(parsed?.paperAccount?.openPositions)
          ? parsed.paperAccount.openPositions
          : [],
      pendingOrders: Array.isArray(parsed?.pendingOrders)
        ? parsed.pendingOrders
        : Array.isArray(parsed?.paperAccount?.pendingOrders)
          ? parsed.paperAccount.pendingOrders
          : [],
      closedTrades: Array.isArray(parsed?.closedTrades)
        ? parsed.closedTrades
        : Array.isArray(parsed?.paperAccount?.closedTrades)
          ? parsed.paperAccount.closedTrades
          : [],
      symbolIsolationState:
        (parsed?.paperAccount?.symbolIsolationState && typeof parsed.paperAccount.symbolIsolationState === "object")
          ? parsed.paperAccount.symbolIsolationState
          : (fallbackAccount?.symbolIsolationState && typeof fallbackAccount.symbolIsolationState === "object")
            ? fallbackAccount.symbolIsolationState
            : {},
      simulationOrderConfig: {
        mode: "fixed_quantity",
        quantity: Number(parsed?.simulationOrderConfig?.quantity || parsed?.paperAccount?.simulationOrderConfig?.quantity) > 0
          ? Number(parsed?.simulationOrderConfig?.quantity || parsed?.paperAccount?.simulationOrderConfig?.quantity)
          : 50,
      },
    }, { eventType: "RESTORE", sourceFunction: "loadSimulationSnapshot" });

    const legacySymbol = parsed?.currentSymbol || "SOL";
    const simulationStateBySymbol = normalizeSimulationStateBySymbol(parsed?.simulationStateBySymbol);
    simulationStateBySymbol[legacySymbol] = {
      ...simulationStateBySymbol[legacySymbol],
      lifecycle: normalizedLifecycle,
      isSimulating: normalizedLifecycle === "running",
      startedAt: parsed?.simulationStartTime || simulationStateBySymbol[legacySymbol]?.startedAt || null,
      lastDecisionAt: parsed?.lastDecisionTime || simulationStateBySymbol[legacySymbol]?.lastDecisionAt || null,
      restore: {
        ...simulationStateBySymbol[legacySymbol]?.restore,
        restored: true,
        restoredAt: new Date().toISOString(),
        restoredLifecycle: normalizedLifecycle,
        restoredPositionsCount: normalizedPaperAccount.openPositions.filter((position) => position.symbol === `${legacySymbol}USDT`).length,
        restoredPendingCount: normalizedPaperAccount.pendingOrders.filter((order) => order.symbol === `${legacySymbol}USDT`).length,
        lastDecisionTime: parsed?.lastDecisionTime || null,
        restoredKeys: ["pendingOrders", "openPositions", "closedTrades", "performanceStats"],
      },
      rehydrate: {
        attempted: true,
        completed: true,
      },
    };

    return {
      simulationLifecycle: normalizedLifecycle,
      simulationStartTime: parsed?.simulationStartTime || null,
      lastDecisionTime: parsed?.lastDecisionTime || null,
      currentSymbol: legacySymbol,
      marketSymbol: parsed?.marketSymbol || "SOLUSDT",
      timeframe: parsed?.timeframe || "15m",
      simulationStats: parsed?.simulationStats || null,
      simulationStateBySymbol,
      paperAccount: normalizedPaperAccount,
      restoredAt: new Date().toISOString(),
      restoredPositionsCount: normalizedPaperAccount.openPositions.length,
      restoredPendingCount: normalizedPaperAccount.pendingOrders.length,
    };
  } catch (error) {
    console.debug("[simulation:persistence] restore failed", error);
    return null;
  }
}

const FINAL_DECISION_LABELS = {
  WAIT: "等待",
  BUY: "做多",
  SELL: "做空",
  NO_TRADE: "不交易",
};

const SETUP_TYPE_LABELS = {
  wait: "等待條件",
  pullback: "回踩進場",
  breakout: "突破進場",
  reversal: "反轉進場",
  range: "區間策略",
  "no-trade": "無有效策略",
  no_setup: "無有效策略",
};

const ENTRY_TIMING_LABELS = {
  READY: "可進場",
  WAIT_PULLBACK: "等待回踩",
  WAIT_BREAKOUT: "等待突破",
  TOO_LATE: "已錯過",
  NO_SETUP: "無進場條件",
};

const CONFIRMATION_STRENGTH_LABELS = {
  weak: "條件不足",
  forming: "初步形成",
  near: "接近完成",
  ready: "已完成可進場",
};

const MARKET_REGIME_LABELS = {
  trend: "趨勢盤",
  ranging: "震盪盤",
  "high volatility": "高波動盤",
  "weak trend": "弱趨勢盤",
};

const CONFIDENCE_LEVEL_LABELS = {
  low: "低",
  medium: "中",
  high: "高",
};
const SIMULATION_FORCE_PROBE_NO_TRADE_BARS = 36;
const TREND_KLINE_RELAXED_SCORE_THRESHOLD = 0.72;
const SIMULATION_DIRECTIONAL_LOSS_STREAK_THRESHOLD = 2;

const TRAP_SIGNAL_LABELS = {
  BULL_TRAP: "誘多",
  BEAR_TRAP: "誘空",
  NONE: "無明顯陷阱訊號",
};

function ema(values, period) {
  if (!values.length) return [];
  const k = 2 / (period + 1);
  const result = [values[0]];
  for (let i = 1; i < values.length; i++) {
    result.push(values[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

function sma(values, period) {
  return values.map((_, index) => {
    if (index + 1 < period) return null;
    const slice = values.slice(index - period + 1, index + 1);
    return slice.reduce((a, b) => a + b, 0) / period;
  });
}

function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function calculateMACD(closes) {
  if (closes.length < 35) return null;
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = closes.map((_, i) => ema12[i] - ema26[i]);
  const signalLine = ema(macdLine, 9);

  return {
    macd: macdLine[macdLine.length - 1],
    signal: signalLine[signalLine.length - 1],
    histogram: macdLine[macdLine.length - 1] - signalLine[signalLine.length - 1],
  };
}

function resolveDecisionSide(decision) {
  const action = String(decision?.action ?? decision?.executionPlan?.action ?? "").toUpperCase();
  if (["LONG", "BUY"].includes(action)) return "LONG";
  if (["SHORT", "SELL"].includes(action)) return "SHORT";
  const preferredSide = String(
    decision?.executionPlan?.preferredSide ?? decision?.preferredSide ?? decision?.biasSide ?? ""
  ).toUpperCase();
  if (preferredSide === "LONG") return "LONG";
  if (preferredSide === "SHORT") return "SHORT";
  return null;
}

function getDirectionalCooldownStateFromAccount(account = {}, symbol) {
  const scopedState = symbol && account?.symbolIsolationState?.[symbol]
    ? account.symbolIsolationState[symbol]
    : account;
  const longCooldownBarsLeft = Math.max(0, Number(scopedState?.longCooldownBars) || 0);
  const shortCooldownBarsLeft = Math.max(0, Number(scopedState?.shortCooldownBars) || 0);
  const longLossStreak = Math.max(0, Number(scopedState?.longLossStreak) || 0);
  const shortLossStreak = Math.max(0, Number(scopedState?.shortLossStreak) || 0);
  const lastTradeDirection = scopedState?.lastTradeDirection || null;
  const consecutiveLossCount = lastTradeDirection === "SHORT" ? shortLossStreak : longLossStreak;
  const cooldownBarsLeft = lastTradeDirection === "SHORT" ? shortCooldownBarsLeft : longCooldownBarsLeft;
  return {
    lastTradeDirection,
    longLossStreak,
    shortLossStreak,
    longCooldownBarsLeft,
    shortCooldownBarsLeft,
    consecutiveLossCount,
    cooldownActive: cooldownBarsLeft > 0,
    cooldownBarsLeft,
  };
}

function resolveKlineConfirmation({ side, rsi, currentCandle, previousCandle, marketRegime, trendScore, forcedTradeRelaxation }) {
  if (!side || !currentCandle) return false;
  const open = Number(currentCandle?.open);
  const high = Number(currentCandle?.high);
  const low = Number(currentCandle?.low);
  const close = Number(currentCandle?.close);
  const prevOpen = Number(previousCandle?.open);
  const prevClose = Number(previousCandle?.close);
  const candleRange = Math.max(Math.abs(high - low), 1e-8);
  const body = Math.abs(close - open);
  const upperWick = high - Math.max(open, close);
  const lowerWick = Math.min(open, close) - low;
  const hasUpperWick = Number.isFinite(upperWick) && upperWick >= body * 0.8;
  const hasLowerWick = Number.isFinite(lowerWick) && lowerWick >= body * 0.8;
  const bearishClose = Number.isFinite(close) && Number.isFinite(open) && close < open;
  const bullishClose = Number.isFinite(close) && Number.isFinite(open) && close > open;
  const bearishEngulfing =
    Number.isFinite(prevOpen) &&
    Number.isFinite(prevClose) &&
    Number.isFinite(open) &&
    Number.isFinite(close) &&
    prevClose > prevOpen &&
    close < open &&
    open >= prevClose &&
    close <= prevOpen;
  const bullishEngulfing =
    Number.isFinite(prevOpen) &&
    Number.isFinite(prevClose) &&
    Number.isFinite(open) &&
    Number.isFinite(close) &&
    prevClose < prevOpen &&
    close > open &&
    open <= prevClose &&
    close >= prevOpen;
  const normalizedRegime = String(marketRegime || "").trim().toUpperCase();
  const trendScoreValue = Number(trendScore);
  const isTrend = normalizedRegime === "TREND" || normalizedRegime === "TRENDING";
  const isTrendRelaxed = isTrend && (forcedTradeRelaxation || (Number.isFinite(trendScoreValue) && trendScoreValue >= TREND_KLINE_RELAXED_SCORE_THRESHOLD));
  if (side === "SHORT") {
    const rsiReady = Number.isFinite(rsi) ? rsi > 60 : false;
    if (isTrendRelaxed) return rsiReady && bearishClose && candleRange > 0;
    return rsiReady && (hasUpperWick || bearishEngulfing || bearishClose) && candleRange > 0;
  }
  if (side === "LONG") {
    const rsiReady = Number.isFinite(rsi) ? rsi < 40 : false;
    if (isTrendRelaxed) return rsiReady && bullishClose && candleRange > 0;
    return rsiReady && (hasLowerWick || bullishEngulfing || bullishClose) && candleRange > 0;
  }
  return false;
}

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatTime(ts, timeframe) {
  const date = new Date(ts);
  if (timeframe === "15m" || timeframe === "1h" || timeframe === "4h") {
    return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(
      date.getDate()
    ).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(
      date.getMinutes()
    ).padStart(2, "0")}`;
  }
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

function mapCancelReasonLabel(reason) {
  const reasonMap = {
    DECISION_HOLD: "AI 決策目前為「不交易」",
    DECISION_CHANGED: "決策方向改變，原掛單已失效",
    TRAP_BLOCKED: "誘多 / 誘空風險阻擋執行",
    SETUP_INVALIDATED: "無有效 setup，未執行",
    EXPIRED: "掛單已到期，自動取消",
    PRICE_DRIFTED: "價格偏離掛單過遠，自動取消",
    STRUCTURE_CHANGED: "市場結構已明顯改變，掛單取消",
  };
  return reasonMap[reason] || "條件變更，掛單已取消";
}

function mapExecutionBlockedReason(resultCode, decision) {
  const setupType = String(decision?.setupType || decision?.executionPlan?.setupType || "").toLowerCase();
  const entryTiming = String(decision?.entryTiming || "").toUpperCase();
  const confidence = String(decision?.confidence || "").toUpperCase();

  if (setupType === "no_setup" || setupType === "no-trade") return "目前僅觀察，尚未建立條件單";
  if (entryTiming === "WAIT_PULLBACK" || entryTiming === "WAIT_BREAKOUT") return "尚未進入進場區間";
  if (entryTiming === "TOO_LATE") return "觸發條件尚未成立";
  if (confidence === "LOW" || confidence === "低") return "信心不足，未建立模擬單";

  const reasonMap = {
    SKIP_HOLD_NO_TRIGGER: "AI 決策目前為「不交易」",
    SKIP_NO_ACTIONABLE_SIDE: "觸發條件尚未成立",
    BLOCKED_BY_TRAP: "誘多 / 誘空風險阻擋執行",
    DUPLICATE_SETUP: "同一 setup 已存在掛單或持倉",
    MISSING_TRIGGER: "觸發條件尚未成立",
    MISSING_INVALIDATION: "缺少失效價格，風險無法定義",
    SETUP_ALREADY_INVALIDATED: "目前僅觀察，尚未建立條件單",
    STALE_CONTEXT: "決策內容已過期，請先重新整理",
    STRUCTURE_INVALID: "結構條件不足，暫不建立掛單",
    EXTREMELY_LOW_CONFIDENCE: "信心過低，模擬執行暫停",
    MISSING_EXECUTION_PLAN: "缺少 execution plan，無法建立掛單",
    NO_DECISION: "尚未產生可執行決策",
    SHORT_ENTRY_UNREALISTIC: "空單掛單位置不合理（距現價過遠）",
    SHORT_BREAKDOWN_ATR_REQUIRED: "空單跌破掛單缺少 ATR，無法驗證距離",
    BLOCKED_BY_PERFORMANCE_FILTER: "此 setup 歷史勝率與平均損益過差，已轉為觀察模式",
    INVALID_EXECUTION_PLAN_BLOCKED: "交易計畫異常，已阻止下單",
  };
  return reasonMap[resultCode] || "條件不足，已轉為觀察模式";
}

function buildExecutionDiagnostics({ decision, currentPrice, rsi, currentVolume, avgVolume20 }) {
  const action = String(decision?.action || decision?.executionPlan?.action || "").toUpperCase();
  const triggerPrice = Number(decision?.executionPlan?.triggerPrice ?? decision?.triggerPrice);
  const rsiThreshold = action === "SHORT" ? 45 : 55;
  const volumeThreshold = Number.isFinite(avgVolume20) ? avgVolume20 * 1.2 : null;
  const unmetConditions = [];
  const distances = [];

  if ((action === "LONG" || action === "SHORT") && Number.isFinite(triggerPrice) && Number.isFinite(currentPrice)) {
    const priceGap = action === "LONG" ? triggerPrice - currentPrice : currentPrice - triggerPrice;
    if (priceGap > 0) {
      const gapPct = triggerPrice !== 0 ? (Math.abs(priceGap) / Math.abs(triggerPrice)) * 100 : null;
      unmetConditions.push(
        `${action === "LONG" ? "價格未突破" : "價格未跌破"} ${formatNumber(triggerPrice)}（目前 ${formatNumber(currentPrice)}）`
      );
      distances.push(`價格差距：${formatNumber(priceGap)}${Number.isFinite(gapPct) ? `（${formatNumber(gapPct)}%）` : ""}`);
    }
  }

  if (Number.isFinite(rsi)) {
    const rsiGap = action === "SHORT" ? rsi - rsiThreshold : rsiThreshold - rsi;
    if (rsiGap > 0) {
      unmetConditions.push(
        `RSI 未達 ${formatNumber(rsiThreshold, 0)}（目前 ${formatNumber(rsi, 1)}）`
      );
      distances.push(`RSI 差距：${formatNumber(rsiGap, 1)}`);
    }
  }

  if (Number.isFinite(volumeThreshold) && Number.isFinite(currentVolume) && volumeThreshold > 0 && currentVolume < volumeThreshold) {
    const volumeGapPct = ((volumeThreshold - currentVolume) / volumeThreshold) * 100;
    unmetConditions.push(
      `成交量未達 20MA * 1.2（門檻 ${formatNumber(volumeThreshold, 2)}，目前 ${formatNumber(currentVolume, 2)}）`
    );
    distances.push(`Volume 差距：${formatNumber(volumeGapPct, 1)}%`);
  }

  return { unmetConditions, distances };
}

function resolveTargetEntryZone(decision, levels) {
  const action = String(decision?.action || decision?.executionPlan?.action || "").toUpperCase();
  const entryLow = Number(decision?.executionPlan?.entryLow ?? decision?.entryLow);
  const entryHigh = Number(decision?.executionPlan?.entryHigh ?? decision?.entryHigh);
  if (Number.isFinite(entryLow) && Number.isFinite(entryHigh)) {
    return { low: Math.min(entryLow, entryHigh), high: Math.max(entryLow, entryHigh) };
  }
  const fallbackLow = action === "SHORT" ? Number(levels?.structureResistanceZone?.low) : Number(levels?.structureSupportZone?.low);
  const fallbackHigh = action === "SHORT" ? Number(levels?.structureResistanceZone?.high) : Number(levels?.structureSupportZone?.high);
  if (Number.isFinite(fallbackLow) && Number.isFinite(fallbackHigh)) {
    return { low: Math.min(fallbackLow, fallbackHigh), high: Math.max(fallbackLow, fallbackHigh) };
  }
  return null;
}

function buildSimulationWaitingDetails({ analysis, timeframe, currentPrice, diagnostics = [] }) {
  const decision = analysis?.aiDecisionOutput;
  const mtfBias = analysis?.mtfBias || {};
  const action = String(decision?.action || decision?.executionPlan?.action || "").toUpperCase();
  const setupType = String(decision?.setupType || decision?.executionPlan?.setupType || "").toLowerCase();
  const strategyType = String(decision?.strategyType || "").toLowerCase();
  const executionMode = setupType === "breakout"
    ? "BREAKOUT"
    : (strategyType === "range" || strategyType === "pullback" || setupType === "pullback")
      ? "PULLBACK"
      : "PULLBACK";
  const targetZone = resolveTargetEntryZone(decision, analysis?.levels);
  const safePrice = Number(currentPrice);
  const sideText = action === "SHORT" ? "反彈壓力區" : "回踩支撐區";
  const currentMomentum = action === "SHORT" ? mtfBias?.tf15m || "bullish" : mtfBias?.tf15m || "bearish";
  const expectedMomentum = action === "SHORT" ? "bearish" : "bullish";

  const keyConditions = [];
  if (targetZone && Number.isFinite(safePrice)) {
    keyConditions.push(
      `等待價格${sideText}：${formatNumber(targetZone.low)} – ${formatNumber(targetZone.high)}（現價 ${formatNumber(safePrice)}）`
    );
  }
  keyConditions.push(`等待 ${timeframe} 動能轉為 ${expectedMomentum}（目前 ${currentMomentum}）`);
  keyConditions.push(...(Array.isArray(diagnostics) ? diagnostics : []));
  if (targetZone) keyConditions.push("等待價格進入 entry 區間後才建立掛單");

  const unmetConditions = [...new Set(keyConditions)].filter(Boolean).slice(0, 3);
  const waitingReason = unmetConditions.length ? unmetConditions.join("；") : "等待下一根 K 線確認";
  return {
    waitingReason,
    executionMode,
    targetEntryZone: targetZone ? `${formatNumber(targetZone.low)} – ${formatNumber(targetZone.high)}` : "-",
    currentPrice: Number.isFinite(safePrice) ? safePrice : null,
    unmetConditions,
  };
}

function getSimulationButtonState(decision, currentPrice, signalContext = {}) {
  const eligibilityInfo = getSimulationEligibility(decision, currentPrice, signalContext, {
    executionSource: "simulation_manual",
    orderMode: "simulation",
  });
  const waitingPending = eligibilityInfo.eligibility === "READY_TO_PLACE_PENDING";

  return {
    disabled: false,
    disabledReason: waitingPending ? "目前不可立即進場，但可建立條件掛單" : "",
    eligibility: eligibilityInfo.eligibility,
  };
}

function calculateSimulationStats(accountSnapshot, symbol) {
  const closedTrades = accountSnapshot.closedTrades || [];
  const openPositions = accountSnapshot.openPositions || [];
  const scopedClosedTrades = symbol ? closedTrades.filter((trade) => trade.symbol === symbol) : closedTrades;
  const scopedOpenPositions = symbol ? openPositions.filter((position) => position.symbol === symbol) : openPositions;
  const wins = scopedClosedTrades.filter((trade) => Number(trade.realizedPnl) > 0);
  const losses = scopedClosedTrades.filter((trade) => Number(trade.realizedPnl) <= 0);
  const totalTrades = scopedClosedTrades.length;
  const winRate = totalTrades ? (wins.length / totalTrades) * 100 : 0;
  const realizedPnl = scopedClosedTrades.reduce((sum, trade) => sum + Number(trade.realizedPnl || 0), 0);
  const unrealizedPnl = scopedOpenPositions.reduce((sum, pos) => sum + Number(pos.unrealizedPnl || 0), 0);
  const avgWin = wins.length ? wins.reduce((sum, trade) => sum + Number(trade.realizedPnl || 0), 0) / wins.length : 0;
  const avgLoss = losses.length ? Math.abs(losses.reduce((sum, trade) => sum + Number(trade.realizedPnl || 0), 0) / losses.length) : 0;
  const avgRR = avgLoss > 0 ? avgWin / avgLoss : 0;

  let maxWinStreak = 0;
  let maxLossStreak = 0;
  let currentWinStreak = 0;
  let currentLossStreak = 0;
  let peak = 0;
  let running = 0;
  let maxDrawdown = 0;
  for (const trade of [...scopedClosedTrades].reverse()) {
    const pnl = Number(trade.realizedPnl || 0);
    running += pnl;
    peak = Math.max(peak, running);
    maxDrawdown = Math.max(maxDrawdown, peak - running);
    if (pnl > 0) {
      currentWinStreak += 1;
      currentLossStreak = 0;
    } else {
      currentLossStreak += 1;
      currentWinStreak = 0;
    }
    maxWinStreak = Math.max(maxWinStreak, currentWinStreak);
    maxLossStreak = Math.max(maxLossStreak, currentLossStreak);
  }

  const byKeyWinRate = (key) => {
    const bucket = {};
    for (const trade of scopedClosedTrades) {
      const label = trade?.[key] || "UNKNOWN";
      if (!bucket[label]) bucket[label] = { total: 0, wins: 0 };
      bucket[label].total += 1;
      if (Number(trade.realizedPnl) > 0) bucket[label].wins += 1;
    }
    return Object.fromEntries(Object.entries(bucket).map(([label, stat]) => [label, stat.total ? (stat.wins / stat.total) * 100 : 0]));
  };
  const bySide = (side) => {
    const rows = scopedClosedTrades.filter((trade) => trade.side === side);
    const winsCount = rows.filter((trade) => Number(trade.realizedPnl) > 0).length;
    return rows.length ? (winsCount / rows.length) * 100 : 0;
  };
  const fullPerformance = paperTradingAnalytics.buildPerformanceSnapshot(
    scopedClosedTrades,
    (setupContext, trade) => trade?.setupKey || paperTradingAnalytics.buildSetupKey(setupContext)
  );
  const coarsePerformance = paperTradingAnalytics.buildPerformanceSnapshot(
    scopedClosedTrades,
    (setupContext, trade) => trade?.coarseSetupKey || paperTradingAnalytics.buildCoarseSetupKey(setupContext)
  );
  const performanceRows = Object.entries(fullPerformance.allTimeMap)
    .map(([setupKey, stat]) => ({
      setupKey,
      ...stat,
    }))
    .sort((a, b) => b.totalTrades - a.totalTrades);
  const coarsePerformanceRows = Object.entries(coarsePerformance.allTimeMap)
    .map(([setupKey, stat]) => ({
      setupKey,
      ...stat,
    }))
    .sort((a, b) => b.totalTrades - a.totalTrades);
  const waitingDiagnostics = accountSnapshot.waitingDiagnostics || {};
  const signalToPlaceBarsSeries = (waitingDiagnostics.signalToPlaceBars || []).filter((value) => Number.isFinite(Number(value)));
  const placeToFillBarsSeries = (waitingDiagnostics.placeToFillBars || []).filter((value) => Number.isFinite(Number(value)));
  const avgSignalToPlaceBars = signalToPlaceBarsSeries.length
    ? signalToPlaceBarsSeries.reduce((sum, value) => sum + Number(value), 0) / signalToPlaceBarsSeries.length
    : 0;
  const avgPlaceToFillBars = placeToFillBarsSeries.length
    ? placeToFillBarsSeries.reduce((sum, value) => sum + Number(value), 0) / placeToFillBarsSeries.length
    : 0;
  const waitingReasonRanking = Object.entries(waitingDiagnostics.reasonCounts || {})
    .map(([reason, count]) => ({ reason, count: Number(count) || 0 }))
    .sort((a, b) => b.count - a.count);
  const averageWaitBySymbol = Object.fromEntries(
    Object.entries(waitingDiagnostics.symbolWaitBars || {}).map(([symbolKey, rows]) => {
      const validRows = (rows || []).filter((value) => Number.isFinite(Number(value))).map(Number);
      const avg = validRows.length ? validRows.reduce((sum, value) => sum + value, 0) / validRows.length : 0;
      return [symbolKey, avg];
    })
  );
  const reentryTrades = scopedClosedTrades.filter((trade) => Boolean(trade?.isReentryAttempt));
  const initialTrades = scopedClosedTrades.filter((trade) => !trade?.isReentryAttempt);
  const reentryWins = reentryTrades.filter((trade) => Number(trade.realizedPnl) > 0).length;
  const initialWins = initialTrades.filter((trade) => Number(trade.realizedPnl) > 0).length;
  const sumPnl = (rows) => rows.reduce((sum, trade) => sum + Number(trade?.realizedPnl || 0), 0);
  const reentryPerformanceComparison = {
    reentryCount: reentryTrades.length,
    initialCount: initialTrades.length,
    reentryWinRate: reentryTrades.length ? (reentryWins / reentryTrades.length) * 100 : 0,
    initialWinRate: initialTrades.length ? (initialWins / initialTrades.length) * 100 : 0,
    reentryAvgPnl: reentryTrades.length ? sumPnl(reentryTrades) / reentryTrades.length : 0,
    initialAvgPnl: initialTrades.length ? sumPnl(initialTrades) / initialTrades.length : 0,
  };
  const accountSummary = calculateAccountSummary(accountSnapshot);

  return {
    totalTrades,
    winRate,
    totalPnl: realizedPnl + unrealizedPnl,
    realizedPnl,
    unrealizedPnl,
    avgRR,
    maxWinStreak,
    maxLossStreak,
    maxDrawdown,
    longWinRate: bySide("LONG"),
    shortWinRate: bySide("SHORT"),
    decisionTypeWinRate: byKeyWinRate("decisionType"),
    pendingTypeWinRate: byKeyWinRate("pendingType"),
    performanceMap: fullPerformance.allTimeMap,
    performanceRecentMap: fullPerformance.recentMap,
    performanceRows,
    coarsePerformanceMap: coarsePerformance.allTimeMap,
    coarsePerformanceRecentMap: coarsePerformance.recentMap,
    coarsePerformanceRows,
    avgSignalToPlaceBars,
    avgPlaceToFillBars,
    waitingReasonRanking,
    averageWaitBySymbol,
    reentrySuccessRate: reentryPerformanceComparison.reentryWinRate,
    reentryPerformanceComparison,
    cash: accountSummary.cash,
    equity: accountSummary.equity,
    marginUsed: accountSummary.marginUsed,
    positionValue: accountSummary.positionValue,
    totalAccountValue: accountSummary.totalAccountValue,
    netWorth: accountSummary.netWorth,
  };
}

function calculateAccountSummary(accountSnapshot) {
  const closedTrades = Array.isArray(accountSnapshot?.closedTrades) ? accountSnapshot.closedTrades : [];
  const openPositions = Array.isArray(accountSnapshot?.openPositions) ? accountSnapshot.openPositions : [];
  const realizedPnl = closedTrades.reduce((sum, trade) => sum + Number(trade?.realizedPnl || 0), 0);
  const cash = Number(paperTradingConstants?.DEFAULT_BALANCE || 5000) + realizedPnl;
  const unrealizedPnl = openPositions.reduce((sum, position) => sum + Number(position?.unrealizedPnl || 0), 0);
  const marginUsed = openPositions.reduce((sum, position) => {
    const notional = Number(position?.notional || 0);
    const leverage = Number(position?.leverage || 1);
    return sum + (Number.isFinite(notional) ? notional / Math.max(1, leverage || 1) : 0);
  }, 0);
  const positionValue = openPositions.reduce((sum, position) => {
    const qty = Number(position?.quantity || 0);
    const px = Number(position?.currentPrice ?? position?.entryPrice ?? 0);
    return sum + Math.abs(qty * px);
  }, 0);
  const equity = cash + unrealizedPnl;
  return {
    cash,
    balance: cash,
    realizedPnl,
    unrealizedPnl,
    marginUsed,
    usedMargin: marginUsed,
    positionValue,
    equity,
    totalAccountValue: equity,
    netWorth: equity,
  };
}

function buildDiagnostics(accountSnapshot) {
  const trades = accountSnapshot.closedTrades || [];
  if (!trades.length) return { reviewLines: [], suggestions: [] };
  const fullPerformance = paperTradingAnalytics.buildPerformanceSnapshot(
    trades,
    (setupContext, trade) => trade?.setupKey || paperTradingAnalytics.buildSetupKey(setupContext)
  );
  const coarsePerformance = paperTradingAnalytics.buildPerformanceSnapshot(
    trades,
    (setupContext, trade) => trade?.coarseSetupKey || paperTradingAnalytics.buildCoarseSetupKey(setupContext)
  );
  const performanceMap = fullPerformance.allTimeMap;
  const statsByDecision = {};
  const statsByPending = {};
  const lowVolumeBreakoutLosses = trades.filter((t) => t.pendingType === "BREAKOUT_ENTRY" && Number(t.realizedPnl) <= 0 && String(t.regime || "").includes("低量"));
  const lowRRLosses = trades.filter((t) => Number(t.realizedPnl) <= 0).filter((t) => {
    const risk = Math.abs(Number(t.entryPrice || 0) - Number(t?.decisionSnapshot?.stopLoss || t.stopLoss || 0));
    const reward = Math.abs(Number(t?.decisionSnapshot?.takeProfit1 || t.takeProfit1 || 0) - Number(t.entryPrice || 0));
    return risk > 0 && reward / risk < 1.2;
  });
  for (const trade of trades) {
    const d = trade.decisionType || "UNKNOWN";
    const p = trade.pendingType || "UNKNOWN";
    for (const [key, map] of [[d, statsByDecision], [p, statsByPending]]) {
      if (!map[key]) map[key] = { total: 0, wins: 0, losses: 0 };
      map[key].total += 1;
      if (Number(trade.realizedPnl) > 0) map[key].wins += 1;
      else map[key].losses += 1;
    }
  }
  const reviewLines = Object.entries(statsByDecision)
    .filter(([, v]) => v.total >= 3)
    .sort((a, b) => (a[1].wins / a[1].total) - (b[1].wins / b[1].total))
    .slice(0, 3)
    .map(([k, v]) => `${k} 勝率偏低（${((v.wins / v.total) * 100).toFixed(1)}%，${v.losses}/${v.total} 虧損）`);
  const setupReviewLines = Object.entries(performanceMap)
    .filter(([, v]) => v.totalTrades >= 3)
    .sort((a, b) => a[1].winRate - b[1].winRate)
    .slice(0, 3)
    .map(([k, v]) => `Setup ${k}：樣本 ${v.totalTrades}，勝率 ${v.winRate.toFixed(1)}%，平均PnL ${v.avgPnl.toFixed(2)}`);
  const coarseSetupReviewLines = Object.entries(coarsePerformance.allTimeMap)
    .filter(([, v]) => v.totalTrades >= 3)
    .sort((a, b) => a[1].winRate - b[1].winRate)
    .slice(0, 3)
    .map(([k, v]) => `Coarse Setup ${k}：樣本 ${v.totalTrades}，勝率 ${v.winRate.toFixed(1)}%，平均PnL ${v.avgPnl.toFixed(2)}`);
  const recentVsAllTimeLines = Object.entries(fullPerformance.recentMap)
    .filter(([, v]) => v.totalTrades >= 3)
    .slice(0, 3)
    .map(([k, recent]) => {
      const allTime = fullPerformance.allTimeMap[k];
      return `Recent vs All-time ${k}：recent ${recent.totalTrades} 筆/${recent.winRate.toFixed(1)}%/${recent.avgPnl.toFixed(2)}，all ${allTime?.totalTrades || 0} 筆/${(allTime?.winRate || 0).toFixed(1)}%/${(allTime?.avgPnl || 0).toFixed(2)}`;
    });
  const suggestions = [
    lowVolumeBreakoutLosses.length >= 2 ? "BREAKOUT_ENTRY 在低量環境勝率低，建議提高量能門檻" : null,
    (statsByPending.OPPORTUNITY_ENTRY?.losses || 0) >= 2 ? "OPPORTUNITY_ENTRY 虧損偏高，建議進一步降低倉位或降級為觀察" : null,
    lowRRLosses.length >= 2 ? "RR < 1.2 的交易表現差，建議避免執行" : null,
    (statsByDecision.WAIT_BREAKOUT?.losses || 0) > (statsByDecision.WAIT_BREAKOUT?.wins || 0) ? "MTF 分歧時建議降級，不要急於突破追價" : null,
    Object.values(performanceMap).some((v) => v.totalTrades >= 10 && v.winRate < 40 && v.avgPnl < 0)
      ? "已啟用 setup 歷史績效過濾：低勝率且負報酬 setup 將自動轉為觀察"
      : null,
  ].filter(Boolean);
  return { reviewLines: [...reviewLines, ...setupReviewLines, ...coarseSetupReviewLines, ...recentVsAllTimeLines], suggestions };
}

function calculateATR(candles, period = 14) {
  if (!candles || candles.length < period + 1) return null;
  const trueRanges = [];

  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trueRanges.push(tr);
  }

  const recent = trueRanges.slice(-period);
  return recent.reduce((sum, v) => sum + v, 0) / recent.length;
}

function calculateVWAP(candles) {
  if (!candles?.length) return null;
  let cumulativePV = 0;
  let cumulativeVol = 0;

  for (const candle of candles) {
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    cumulativePV += typicalPrice * candle.volume;
    cumulativeVol += candle.volume;
  }

  if (!cumulativeVol) return null;
  return cumulativePV / cumulativeVol;
}

function calculateStochRSI(closes, period = 14, smoothK = 3) {
  if (closes.length < period + smoothK + 5) return null;
  const rsiSeries = closes.map((_, i) => calculateRSI(closes.slice(0, i + 1), period));
  const validRsi = rsiSeries.filter((v) => v !== null);
  if (validRsi.length < period + smoothK) return null;

  const stochSeries = rsiSeries.map((value, index) => {
    if (value === null || index < period) return null;
    const window = rsiSeries.slice(Math.max(0, index - period + 1), index + 1).filter((v) => v !== null);
    if (!window.length) return null;
    const low = Math.min(...window);
    const high = Math.max(...window);
    if (high === low) return 50;
    return ((value - low) / (high - low)) * 100;
  });

  const validStoch = stochSeries.filter((v) => v !== null);
  if (validStoch.length < smoothK) return null;
  const k = validStoch.slice(-smoothK).reduce((a, b) => a + b, 0) / smoothK;
  return k;
}

function calculateADX(candles, period = 14) {
  if (!candles || candles.length < period + 15) return null;
  const tr = [];
  const plusDM = [];
  const minusDM = [];

  for (let i = 1; i < candles.length; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;

    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);

    tr.push(
      Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close)
      )
    );
  }

  const smooth = (arr) => {
    const result = [];
    let rolling = arr.slice(0, period).reduce((a, b) => a + b, 0);
    result.push(rolling);
    for (let i = period; i < arr.length; i++) {
      rolling = rolling - rolling / period + arr[i];
      result.push(rolling);
    }
    return result;
  };

  const trSmooth = smooth(tr);
  const plusSmooth = smooth(plusDM);
  const minusSmooth = smooth(minusDM);
  if (!trSmooth.length || trSmooth.length !== plusSmooth.length || trSmooth.length !== minusSmooth.length) {
    return null;
  }

  const dx = trSmooth.map((trValue, i) => {
    if (!trValue) return 0;
    const plusDI = (100 * plusSmooth[i]) / trValue;
    const minusDI = (100 * minusSmooth[i]) / trValue;
    if (plusDI + minusDI === 0) return 0;
    return (100 * Math.abs(plusDI - minusDI)) / (plusDI + minusDI);
  });

  if (dx.length < period) return null;
  const adxSeed = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let adx = adxSeed;
  for (let i = period; i < dx.length; i++) {
    adx = (adx * (period - 1) + dx[i]) / period;
  }
  return adx;
}

function detectSwingPoints(candles, left = 3, right = 3) {
  const swingHighs = [];
  const swingLows = [];

  for (let i = left; i < candles.length - right; i++) {
    const currentHigh = candles[i].high;
    const currentLow = candles[i].low;
    let isSwingHigh = true;
    let isSwingLow = true;

    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (candles[j].high >= currentHigh) isSwingHigh = false;
      if (candles[j].low <= currentLow) isSwingLow = false;
    }

    if (isSwingHigh) swingHighs.push({ index: i, price: currentHigh });
    if (isSwingLow) swingLows.push({ index: i, price: currentLow });
  }

  return { swingHighs, swingLows };
}

function dedupeLevels(levels, minGap) {
  const filtered = [];
  for (const level of levels) {
    if (!filtered.some((item) => Math.abs(item.price - level.price) < minGap)) {
      filtered.push(level);
    }
  }
  return filtered;
}

function makeZone(center, atr) {
  const width = Math.max((atr || center * 0.008) * 0.35, center * 0.0025);
  return { center, low: center - width, high: center + width };
}

function findPivotLevels(candles, currentPrice, atr = null) {
  const { swingHighs, swingLows } = detectSwingPoints(candles, 3, 3);
  const minGap = Math.max((atr || currentPrice * 0.01) * 0.6, currentPrice * 0.004);
  const distanceFloor = Math.max((atr || currentPrice * 0.01) * 0.8, currentPrice * 0.006);

  const shortSupportsRaw = candles
    .map((c, i) => ({ index: i, price: c.low }))
    .filter((l) => l.price < currentPrice && currentPrice - l.price >= distanceFloor * 0.3)
    .sort((a, b) => b.price - a.price);

  const shortResistancesRaw = candles
    .map((c, i) => ({ index: i, price: c.high }))
    .filter((h) => h.price > currentPrice && h.price - currentPrice >= distanceFloor * 0.3)
    .sort((a, b) => a.price - b.price);

  const structureSupportsRaw = swingLows
    .filter((l) => l.price < currentPrice && currentPrice - l.price >= distanceFloor)
    .sort((a, b) => b.price - a.price);

  const structureResistancesRaw = swingHighs
    .filter((h) => h.price > currentPrice && h.price - currentPrice >= distanceFloor)
    .sort((a, b) => a.price - b.price);

  const shortSupports = dedupeLevels(shortSupportsRaw, minGap).slice(0, 2);
  const shortResistances = dedupeLevels(shortResistancesRaw, minGap).slice(0, 2);
  const structureSupports = dedupeLevels(structureSupportsRaw, minGap).slice(0, 2);
  const structureResistances = dedupeLevels(structureResistancesRaw, minGap).slice(0, 2);

  const nearestSupport = structureSupports[0]?.price ?? shortSupports[0]?.price ?? currentPrice * 0.985;
  const secondSupport = structureSupports[1]?.price ?? shortSupports[1]?.price ?? currentPrice * 0.97;
  const nearestResistance =
    structureResistances[0]?.price ?? shortResistances[0]?.price ?? currentPrice * 1.015;
  const secondResistance =
    structureResistances[1]?.price ?? shortResistances[1]?.price ?? currentPrice * 1.03;

  return {
    nearestResistance,
    secondResistance,
    nearestSupport,
    secondSupport,
    shortSupportZone: makeZone(shortSupports[0]?.price ?? nearestSupport, atr),
    shortResistanceZone: makeZone(shortResistances[0]?.price ?? nearestResistance, atr),
    structureSupportZone: makeZone(structureSupports[0]?.price ?? nearestSupport, atr),
    structureResistanceZone: makeZone(structureResistances[0]?.price ?? nearestResistance, atr),
  };
}

function getBiasFromCandles(candles) {
  const closes = candles.map((c) => c.close);
  const price = closes[closes.length - 1];
  const ma20 = sma(closes, 20).at(-1);
  const ma50 = sma(closes, 50).at(-1);
  const rsi = calculateRSI(closes, 14);
  const macd = calculateMACD(closes);
  const recent = closes.slice(-6);
  const trendSlope = recent[recent.length - 1] - recent[0];

  let bullScore = 0;
  let bearScore = 0;

  if (ma20 !== null && price > ma20) bullScore += 1;
  else bearScore += 1;

  if (ma50 !== null && price > ma50) bullScore += 1;
  else bearScore += 1;

  if (trendSlope > 0) bullScore += 1;
  else bearScore += 1;

  if (macd && macd.macd > macd.signal && macd.histogram > 0) bullScore += 1;
  if (macd && macd.macd < macd.signal && macd.histogram < 0) bearScore += 1;

  if (rsi !== null && rsi >= 55 && rsi <= 70) bullScore += 1;
  if (rsi !== null && rsi <= 45 && rsi >= 30) bearScore += 1;

  let bias = "中性";
  if (bullScore - bearScore >= 1.5) bias = "偏多";
  if (bearScore - bullScore >= 1.5) bias = "偏空";

  return { bias, bullScore, bearScore };
}

function detectStructure(candles) {
  const recent = candles.slice(-30);
  const swing = detectSwingPoints(recent, 2, 2);
  const highs = swing.swingHighs.slice(-3).map((x) => x.price);
  const lows = swing.swingLows.slice(-3).map((x) => x.price);

  let structure = "盤整";
  if (highs.length >= 2 && lows.length >= 2) {
    const higherHighs = highs[highs.length - 1] > highs[0];
    const higherLows = lows[lows.length - 1] > lows[0];
    const lowerHighs = highs[highs.length - 1] < highs[0];
    const lowerLows = lows[lows.length - 1] < lows[0];

    if (higherHighs && higherLows) structure = "上升結構";
    else if (lowerHighs && lowerLows) structure = "下降結構";
  }

  return { structure, highs, lows };
}

function detectBreakoutState(candles, levels, atr) {
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const threshold = Math.max((atr || last.close * 0.01) * 0.25, last.close * 0.0025);

  if (last.close > levels.structureResistanceZone.high + threshold && prev.close <= levels.structureResistanceZone.high) {
    return "向上突破";
  }
  if (last.close < levels.structureSupportZone.low - threshold && prev.close >= levels.structureSupportZone.low) {
    return "向下跌破";
  }
  if (last.low <= levels.structureSupportZone.high && last.close > levels.structureSupportZone.high) {
    return "回踩支撐中";
  }
  if (last.high >= levels.structureResistanceZone.low && last.close < levels.structureResistanceZone.low) {
    return "反彈壓力中";
  }
  return "區間內";
}

function detectVolumeState(candles) {
  if (candles.length < 25) return "一般";
  const recent = candles.slice(-20).map((c) => c.volume);
  const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const last = candles[candles.length - 1].volume;

  if (last > avg * 1.6) return "放量";
  if (last < avg * 0.75) return "量縮";
  return "一般";
}

function detectLiquiditySweep(candles, levels, atr) {
  if (candles.length < 3) return "無明顯掃流動性";
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const buffer = Math.max((atr || last.close * 0.01) * 0.2, last.close * 0.002);

  const sweptHigh =
    last.high > levels.structureResistanceZone.high + buffer &&
    last.close < levels.structureResistanceZone.high;

  const sweptLow =
    last.low < levels.structureSupportZone.low - buffer &&
    last.close > levels.structureSupportZone.low;

  if (sweptHigh && last.close < prev.close) return "上方流動性掃單";
  if (sweptLow && last.close > prev.close) return "下方流動性掃單";
  return "無明顯掃流動性";
}

function detectTrendlineState(candles) {
  if (candles.length < 20) return "趨勢線資料不足";
  const closes = candles.slice(-20).map((c) => c.close);
  const x = closes.map((_, i) => i);
  const xMean = x.reduce((a, b) => a + b, 0) / x.length;
  const yMean = closes.reduce((a, b) => a + b, 0) / closes.length;
  const numerator = x.reduce((sum, xi, i) => sum + (xi - xMean) * (closes[i] - yMean), 0);
  const denominator = x.reduce((sum, xi) => sum + (xi - xMean) ** 2, 0);
  const slope = denominator ? numerator / denominator : 0;

  if (slope > 0.15 * (yMean / 100)) return "上升趨勢線有效";
  if (slope < -0.15 * (yMean / 100)) return "下降趨勢線有效";
  return "趨勢線偏平";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getDirectionalSignal(candles) {
  const closes = candles.map((c) => c.close);
  const price = closes[closes.length - 1];
  const ma20 = sma(closes, 20).at(-1);
  const ma50 = sma(closes, 50).at(-1);
  const rsi = calculateRSI(closes, 14);
  const macd = calculateMACD(closes);
  const recent = closes.slice(-8);
  const slope = recent.length > 1 ? recent[recent.length - 1] - recent[0] : 0;

  let longScore = 0;
  let shortScore = 0;

  if (ma20 != null && price > ma20) longScore += 1;
  else shortScore += 1;
  if (ma50 != null && price > ma50) longScore += 1;
  else shortScore += 1;
  if (slope > 0) longScore += 0.8;
  else if (slope < 0) shortScore += 0.8;
  if (macd && macd.histogram > 0) longScore += 0.8;
  if (macd && macd.histogram < 0) shortScore += 0.8;
  if (rsi != null && rsi >= 54 && rsi <= 72) longScore += 0.6;
  if (rsi != null && rsi <= 46 && rsi >= 28) shortScore += 0.6;

  const spread = longScore - shortScore;
  const bias = spread > 0.75 ? "偏多" : spread < -0.75 ? "偏空" : "中性";
  return { bias, spread, longScore, shortScore, slope };
}

function detectMarketRegime({ adx, atr, price, structure, breakoutState }) {
  const volatilityRatio = atr && price ? atr / price : 0;
  if (volatilityRatio > 0.028) return "high volatility";
  if (adx != null && adx >= 27 && ["上升結構", "下降結構"].includes(structure)) return "trend";
  if (adx != null && adx < 16 && breakoutState === "區間內") return "ranging";
  return "weak trend";
}

function computeDimensionScores({
  bias,
  priceAboveMA20,
  priceAboveMA50,
  adx,
  rsi,
  stochRsi,
  macd,
  volumeState,
  breakoutState,
  priceVsVwap,
  structure,
  mtfAlignment,
  marketRegime,
}) {
  const trendDirection = bias === "偏多" ? 1 : bias === "偏空" ? -1 : 0;

  let trendStrength = 5;
  if (trendDirection !== 0) {
    const maAgree = (priceAboveMA20 ? 1 : -1) === trendDirection && (priceAboveMA50 ? 1 : -1) === trendDirection;
    if (maAgree) trendStrength += 2;
    if (adx != null) trendStrength += clamp((adx - 16) / 6, -1.2, 2.2);
    if (structure === "上升結構" && trendDirection > 0) trendStrength += 1.2;
    if (structure === "下降結構" && trendDirection < 0) trendStrength += 1.2;
  }

  let momentum = 5;
  if (trendDirection > 0) {
    if (macd?.histogram > 0) momentum += 1.6;
    if (rsi != null && rsi >= 53 && rsi <= 70) momentum += 1.3;
    if (stochRsi != null && stochRsi < 20) momentum += 0.6;
    if (stochRsi != null && stochRsi > 85) momentum -= 1;
  } else if (trendDirection < 0) {
    if (macd?.histogram < 0) momentum += 1.6;
    if (rsi != null && rsi <= 47 && rsi >= 30) momentum += 1.3;
    if (stochRsi != null && stochRsi > 80) momentum += 0.6;
    if (stochRsi != null && stochRsi < 15) momentum -= 1;
  }

  let volumeConfirmation = 5;
  if (volumeState === "放量") {
    volumeConfirmation += ["向上突破", "向下跌破"].includes(breakoutState) ? 2.2 : 1.2;
  }
  if (volumeState === "量縮") volumeConfirmation -= 1.4;

  let structurePosition = 5;
  if (
    trendDirection > 0 &&
    (structure === "上升結構" || breakoutState === "向上突破" || breakoutState === "回踩支撐中")
  ) {
    structurePosition += 1.8;
  }
  if (
    trendDirection < 0 &&
    (structure === "下降結構" || breakoutState === "向下跌破" || breakoutState === "反彈壓力中")
  ) {
    structurePosition += 1.8;
  }
  if (priceVsVwap * trendDirection > 0.003) structurePosition += 1;
  if (priceVsVwap * trendDirection < -0.003) structurePosition -= 0.8;

  let multiTimeframeAlignment = 5 + mtfAlignment * 4;

  if (marketRegime === "trend") {
    trendStrength += 0.8;
    multiTimeframeAlignment += 0.6;
  } else if (marketRegime === "ranging") {
    momentum -= 0.5;
    structurePosition -= 0.6;
  } else if (marketRegime === "high volatility") {
    momentum -= 1;
    structurePosition -= 0.8;
    multiTimeframeAlignment -= 0.8;
  }

  return {
    trendStrength: clamp(trendStrength, 0, 10),
    momentum: clamp(momentum, 0, 10),
    volumeConfirmation: clamp(volumeConfirmation, 0, 10),
    structurePosition: clamp(structurePosition, 0, 10),
    multiTimeframeAlignment: clamp(multiTimeframeAlignment, 0, 10),
  };
}

function deriveConfidenceLevel({ mtfAlignedRatio, trendStrengthScore, momentumScore, isHighVolatility, volumeState }) {
  let confidenceScore = 50;
  confidenceScore += mtfAlignedRatio * 25;
  confidenceScore += (trendStrengthScore - 5) * 4;
  confidenceScore += (momentumScore - 5) * 3;
  if (volumeState === "放量") confidenceScore += 8;
  if (volumeState === "量縮") confidenceScore -= 6;
  if (isHighVolatility) confidenceScore -= 14;

  if (confidenceScore >= 67) return "high";
  if (confidenceScore >= 48) return "medium";
  return "low";
}

function probabilityModel({
  bias,
  breakoutState,
  confluence,
  volumeState,
  liquiditySweep,
  priceVsVwap,
  riskLevel,
  marketRegime,
  confidenceLevel,
  entryScore,
}) {
  let longProb = 50;
  let shortProb = 50;

  if (bias === "偏多") {
    longProb += 14;
    shortProb -= 14;
  }
  if (bias === "偏空") {
    shortProb += 14;
    longProb -= 14;
  }

  if (confluence === "多週期偏多") longProb += 10;
  if (confluence === "多週期偏空") shortProb += 10;
  if (confluence === "多週期分歧") {
    longProb -= 4;
    shortProb -= 4;
  }

  if (breakoutState === "向上突破") longProb += 7;
  if (breakoutState === "向下跌破") shortProb += 7;

  if (volumeState === "放量" && bias === "偏多") longProb += 4;
  if (volumeState === "放量" && bias === "偏空") shortProb += 4;
  if (volumeState === "量縮") {
    longProb -= 2;
    shortProb -= 2;
  }

  if (liquiditySweep === "上方流動性掃單") shortProb += 5;
  if (liquiditySweep === "下方流動性掃單") longProb += 5;
  if (priceVsVwap > 0.003) longProb += 4;
  if (priceVsVwap < -0.003) shortProb += 4;

  if (marketRegime === "trend") {
    if (bias === "偏多") longProb += 4;
    if (bias === "偏空") shortProb += 4;
  }
  if (marketRegime === "ranging") {
    if (breakoutState === "向上突破") longProb -= 2;
    if (breakoutState === "向下跌破") shortProb -= 2;
  }
  if (marketRegime === "high volatility" || riskLevel === "高") {
    longProb -= 3;
    shortProb -= 3;
  }

  if (confidenceLevel === "high") {
    if (bias === "偏多") longProb += 5;
    if (bias === "偏空") shortProb += 5;
  } else if (confidenceLevel === "low") {
    longProb -= 3;
    shortProb -= 3;
  }

  if (entryScore <= 4.5) {
    longProb -= 3;
    shortProb -= 3;
  }

  longProb = clamp(longProb, 5, 95);
  shortProb = clamp(shortProb, 5, 95);
  const total = longProb + shortProb;

  return {
    longProb: Math.round((longProb / total) * 100),
    shortProb: Math.round((shortProb / total) * 100),
  };
}

function buildAiSummary({
  finalDecision,
  entryTiming,
  setupType,
  bias,
  structure,
  breakoutState,
  volumeState,
  confluence,
  marketRegime,
  confidenceLevel,
  setup,
  entryAdvice,
  longProb,
  shortProb,
  primaryTimeframe,
  rrLabel,
  fakeBreakoutRisk,
  tradability,
  waitReasons,
  waitForConditions,
  triggerEngine,
  noEntryReason,
  trapDetection,
}) {
  const regimeText = localizeMarketRegime(marketRegime);
  const finalDecisionLabel = localizeDecision(finalDecision);
  const setupTypeLabel = localizeSetupType(setupType);
  const entryTimingLabel = localizeEntryTiming(entryTiming);
  const confidenceText = localizeConfidence(confidenceLevel);

  const rhythm =
    breakoutState === "向上突破"
      ? "短線節奏偏突破延續"
      : breakoutState === "向下跌破"
      ? "短線節奏偏弱勢延續"
      : breakoutState === "回踩支撐中"
      ? "短線正處於回踩確認"
      : breakoutState === "反彈壓力中"
      ? "短線以反彈測壓為主"
      : "短線仍在區間內等待方向";

  const reason =
    bias === "偏多"
      ? "偏多主因來自均線位置、結構與動能站在多方"
      : bias === "偏空"
      ? "偏空主因來自均線壓制、結構偏弱與動能下行"
      : "目前多空動能互有拉扯，暫不具明確單邊優勢";

  const entryNowText =
    finalDecision === "BUY" || finalDecision === "SELL"
      ? "目前可考慮進場，但仍需依風控分批執行。"
      : "目前不建議立即進場。";
  const cannotEnterText =
    finalDecision === "WAIT" || finalDecision === "NO_TRADE"
      ? `主因：${waitReasons?.length ? waitReasons.join("、") : "條件尚未完整"}。`
      : "";
  const waitForText =
    finalDecision === "WAIT" || finalDecision === "NO_TRADE"
      ? `建議等待：${waitForConditions?.length ? waitForConditions.join("、") : "趨勢與動能同步確認"}。`
      : "";
  const noSetupText =
    entryTiming === "NO_SETUP" && noEntryReason
      ? `目前無進場訊號，原因：${noEntryReason}。`
      : "";
  const triggerText = triggerEngine
    ? `進場觸發：${triggerEngine.formattedEntryCondition}。執行方式：${triggerEngine.executionPlan?.type}，${triggerEngine.executionPlan?.action}。取消條件：${triggerEngine.executionPlan?.cancel}。策略失效：${triggerEngine.invalidationSentence}。轉向條件：${triggerEngine.biasShiftSentence}。確認強度：${triggerEngine.confirmationLabel}。`
    : "";
  const waitExecutionText =
    finalDecision === "WAIT" || finalDecision === "NO_TRADE"
      ? `目前先不進場，正在等待：${triggerEngine?.waitConditionSentence || "價格回到關鍵區並完成結構確認"}。做多劇本：${triggerEngine?.waitScripts?.long || "-"} 做空劇本：${triggerEngine?.waitScripts?.short || "-"}`
    : "";
  const tooLateText = entryTiming === "TOO_LATE" ? "此 setup 已接近第一目標位，風報比優勢下降，不建議現在追單。" : "";
  const trapText =
    trapDetection?.trapSignal && trapDetection.trapSignal !== "NONE"
      ? `陷阱判讀：${TRAP_SIGNAL_LABELS[trapDetection.trapSignal]}（${trapDetection.trapConfidence}），${trapDetection.trapReason}。`
      : "陷阱判讀：無明顯誘多/誘空訊號。";
  return [
    `【最終決策】${finalDecisionLabel}`,
    `【Setup Type】${setupTypeLabel}`,
    `【Entry Timing】${entryTimingLabel}`,
    triggerEngine ? `【進場觸發條件】${triggerEngine.formattedEntryCondition}` : "",
    triggerEngine ? `【執行方式】${triggerEngine.executionPlan?.type} / ${triggerEngine.executionPlan?.action}` : "",
    triggerEngine ? `【取消條件】${triggerEngine.executionPlan?.cancel}` : "",
    triggerEngine ? `【策略失效條件】${triggerEngine.invalidationSentence}` : "",
    triggerEngine ? `【轉向條件】${triggerEngine.biasShiftSentence}` : "",
    triggerEngine ? `【下一步行動】${triggerEngine.nextAction}` : "",
    `【風報比 RR】${rrLabel}`,
    `【AI綜合結論】主週期（${primaryTimeframe}）判讀為${bias}，市場屬於${regimeText}，結構為${structure}，${rhythm}。多週期一致性：${confluence}，信心等級為${confidenceText}。${reason}。假突破風險為${fakeBreakoutRisk}，目前交易適配度：${tradability}；策略建議「${entryAdvice} / ${setup}」。${trapText}${entryNowText}${tooLateText}${cannotEnterText}${waitForText}${waitExecutionText}${noSetupText}${triggerText}多頭機率約 ${longProb}%、空頭機率約 ${shortProb}%，請依波動調整倉位與節奏。`,
  ]
    .filter(Boolean)
    .join("\n");
}

function categorizeRR(rr) {
  if (rr == null || rr <= 0) return "不足";
  if (rr < 1.2) return "不足（<1.2）";
  if (rr < 1.5) return "普通（1.2~1.5）";
  if (rr < 2) return "可接受（>1.5）";
  return "較佳（>2.0）";
}

function localizeDecision(value) {
  return FINAL_DECISION_LABELS[value] || value || "-";
}

function localizeSetupType(value) {
  return SETUP_TYPE_LABELS[value] || value || "-";
}

function localizeEntryTiming(value) {
  return ENTRY_TIMING_LABELS[value] || value || "-";
}

function localizeMarketRegime(value) {
  return MARKET_REGIME_LABELS[value] || value || "-";
}

function localizeConfidence(value) {
  return CONFIDENCE_LEVEL_LABELS[value] || value || "-";
}

function normalizeMtfBiasLabel(value) {
  if (value === "偏多") return "bullish";
  if (value === "偏空") return "bearish";
  return "neutral";
}

function deriveSetupType({
  bias,
  marketRegime,
  breakoutState,
  structure,
  momentumScore,
  mtfAlignedRatio,
  mtfDisagreement,
  directionalDecision,
}) {
  if (directionalDecision === "NO_TRADE") return "no-trade";
  if (directionalDecision === "WAIT" && bias === "中性") return "wait";
  if (marketRegime === "ranging" && breakoutState === "區間內") return "range";
  if (["向上突破", "向下跌破"].includes(breakoutState)) return "breakout";
  if (momentumScore <= 4.4 && mtfDisagreement > mtfAlignedRatio) return "wait";
  if (
    (bias === "偏多" && (breakoutState === "回踩支撐中" || structure === "上升結構")) ||
    (bias === "偏空" && (breakoutState === "反彈壓力中" || structure === "下降結構"))
  ) {
    return "pullback";
  }
  if (
    (bias === "偏多" && breakoutState === "向下跌破" && momentumScore >= 5.6) ||
    (bias === "偏空" && breakoutState === "向上突破" && momentumScore >= 5.6)
  ) {
    return "reversal";
  }
  return directionalDecision === "WAIT" ? "wait" : "pullback";
}

function evaluateEntryTiming({
  directionalDecision,
  setupType,
  bias,
  price,
  atr,
  tradePlan,
  breakoutState,
  marketRegime,
  mtfAlignedRatio,
  fakeBreakoutRisk,
}) {
  if (directionalDecision === "NO_TRADE" || bias === "中性" || ["no-trade", "wait"].includes(setupType)) {
    return "NO_SETUP";
  }

  const rrBest = tradePlan?.rrBest || 0;
  if (rrBest < 1.2 || fakeBreakoutRisk === "高") return "NO_SETUP";

  const atrBuffer = Math.max((atr || price * 0.01) * 0.2, price * 0.0018);
  const entryLow = tradePlan?.entryLow ?? price;
  const entryHigh = tradePlan?.entryHigh ?? price;
  const entryInZone = price >= entryLow - atrBuffer && price <= entryHigh + atrBuffer;
  const target1 = tradePlan?.target1;

  if (target1 != null) {
    const distanceToTarget = Math.abs(target1 - price);
    const baseline = Math.max(Math.abs(target1 - (tradePlan?.entryMid ?? price)), atrBuffer);
    if (distanceToTarget / baseline < 0.28) return "TOO_LATE";
  }

  if (setupType === "breakout") {
    if (!["向上突破", "向下跌破"].includes(breakoutState)) return "WAIT_BREAKOUT";
    if (marketRegime === "ranging" && mtfAlignedRatio < 0.4) return "WAIT_BREAKOUT";
    return entryInZone ? "READY" : "WAIT_BREAKOUT";
  }
  if (setupType === "pullback") {
    if (!entryInZone) return "WAIT_PULLBACK";
    return mtfAlignedRatio >= 0.32 ? "READY" : "WAIT_PULLBACK";
  }
  if (setupType === "range") {
    return entryInZone ? "READY" : "WAIT_PULLBACK";
  }
  if (setupType === "reversal") {
    if (marketRegime === "high volatility" && mtfAlignedRatio < 0.35) return "WAIT_BREAKOUT";
    return entryInZone ? "READY" : "WAIT_PULLBACK";
  }
  return "NO_SETUP";
}

function integrateDecisionWithTiming(directionalDecision, entryTiming) {
  if (directionalDecision === "NO_TRADE") return "NO_TRADE";
  if (entryTiming === "NO_SETUP" || entryTiming === "TOO_LATE") return "WAIT";
  if ((directionalDecision === "BUY" || directionalDecision === "SELL") && entryTiming !== "READY") {
    return "WAIT";
  }
  return directionalDecision;
}

function buildTriggerEngine({
  bias,
  setupType,
  entryTiming,
  breakoutState,
  structure,
  marketRegime,
  mtfAlignedRatio,
  mtfDisagreement,
  momentumScore,
  rsi,
  tradePlan,
  price,
  fakeBreakoutRisk,
  levels,
  ma20,
  ma50,
  volumeState,
  waitReasons,
  noEntryReason,
}) {
  const directionText = bias === "偏多" ? "偏多" : bias === "偏空" ? "偏空" : "中性";
  const actionableSide = bias === "偏多" ? "做多" : bias === "偏空" ? "做空" : "等待";
  const entryLow = tradePlan?.entryLow;
  const entryHigh = tradePlan?.entryHigh;
  const hasEntryZone = entryLow != null && entryHigh != null;
  const supportZoneText = `${formatNumber(levels?.structureSupportZone?.low)} ~ ${formatNumber(levels?.structureSupportZone?.high)}`;
  const resistanceZoneText = `${formatNumber(levels?.structureResistanceZone?.low)} ~ ${formatNumber(levels?.structureResistanceZone?.high)}`;
  const candleTrigger =
    bias === "偏多"
      ? "回踩後需出現止跌 K / 吞噬 K，且至少一根 K 線收盤站回進場區中軸"
      : "反彈後需出現上影線轉弱 K / 空方吞噬，且至少一根 K 線收盤跌回進場區中軸";
  const maTrigger =
    bias === "偏多"
      ? `價格需重新站上 MA20（${formatNumber(ma20)}）並維持 MA20 > MA50（${formatNumber(ma50)}）`
      : `價格需重新跌破 MA20（${formatNumber(ma20)}）並維持 MA20 < MA50（${formatNumber(ma50)}）`;
  const structureTrigger =
    bias === "偏多"
      ? `結構需守住支撐區 ${supportZoneText}，並維持高低點墊高`
      : `結構需守住壓力區 ${resistanceZoneText} 下方，並維持高低點下移`;
  const volumeTrigger =
    volumeState === "量增"
      ? "成交量需維持放大，最新量能不可低於近 20 根均量"
      : "突破/跌破當根的成交量需放大至近 20 根均量以上";

  const entryTriggers = [];
  const invalidationTriggers = [];
  const biasShiftConditions = [];
  const waitConditions = [];
  let triggerScore = 0;

  if (hasEntryZone) {
    entryTriggers.push(`價格回到進場區 ${formatNumber(entryLow)} ~ ${formatNumber(entryHigh)}`);
    const zoneMid = (entryLow + entryHigh) / 2;
    const zoneRange = Math.max(entryHigh - entryLow, price * 0.002);
    if (Math.abs(price - zoneMid) <= zoneRange * 0.75) triggerScore += 1.5;
  }

  if (setupType === "breakout") {
    entryTriggers.push(
      bias === "偏多"
        ? `等待價格有效突破 ${formatNumber(levels?.structureResistanceZone?.high)} 並收盤站穩，再搭配量能放大才追價`
        : `等待價格有效跌破 ${formatNumber(levels?.structureSupportZone?.low)} 並收盤跌破，再搭配量能放大才追空`
    );
    waitConditions.push("等待有效突破/跌破後的收盤確認與量能放大");
    if (["向上突破", "向下跌破"].includes(breakoutState)) triggerScore += 1.5;
  } else if (setupType === "pullback" || setupType === "range") {
    entryTriggers.push(
      bias === "偏多"
        ? `等待價格回踩 ${hasEntryZone ? `${formatNumber(entryLow)} ~ ${formatNumber(entryHigh)}` : supportZoneText} 支撐區，並出現止跌 K 線再考慮做多`
        : `等待價格反彈 ${hasEntryZone ? `${formatNumber(entryLow)} ~ ${formatNumber(entryHigh)}` : resistanceZoneText} 壓力區，並出現轉弱 K 線再考慮做空`
    );
    waitConditions.push(
      bias === "偏多" ? "等待回踩支撐區後出現止跌/吞噬 K 確認" : "等待反彈壓力區後出現上影線/吞噬 K 確認"
    );
    if (["回踩支撐中", "反彈壓力中"].includes(breakoutState)) triggerScore += 1.2;
  } else if (setupType === "reversal") {
    entryTriggers.push("等待結構突破前高/前低並完成回測，且動能由弱轉強（或由強轉弱）再進場");
    waitConditions.push("等待結構反轉與回測確認");
  } else {
    entryTriggers.push("先等待結構與動能重新同步，再尋找觸發");
    waitConditions.push("等待結構方向與動能重新同向");
  }

  entryTriggers.push(
    bias === "偏多"
      ? `RSI 需回到 52 上方且價格站回 MA20（${formatNumber(ma20)}）`
      : bias === "偏空"
      ? `RSI 需落在 48 下方且價格跌回 MA20（${formatNumber(ma20)}）`
      : "等待 RSI 與均線方向同向再評估"
  );
  if (rsi != null && ((bias === "偏多" && rsi >= 52) || (bias === "偏空" && rsi <= 48))) triggerScore += 1;
  if (momentumScore >= 6) triggerScore += 1;
  if (mtfAlignedRatio >= 0.4 && mtfAlignedRatio > mtfDisagreement) triggerScore += 1.3;
  if (structure === "上升結構" || structure === "下降結構") triggerScore += 0.8;
  if (fakeBreakoutRisk === "低") triggerScore += 0.6;

  if (tradePlan?.invalidation && tradePlan.invalidation !== "-") {
    if (bias === "偏多") {
      invalidationTriggers.push(
        `若價格跌破 ${tradePlan.invalidation} 並收在其下方，代表偏多策略失效，應停止做多並等待下一次結構重建`
      );
    } else if (bias === "偏空") {
      invalidationTriggers.push(
        `若價格突破 ${tradePlan.invalidation} 並站穩其上，代表偏空策略失效，應停止做空並重新評估方向`
      );
    }
  }
  invalidationTriggers.push(`${directionText}邏輯若出現結構反向且動能背離，該 setup 即視為失效並暫停進場`);
  if (setupType === "breakout") {
    invalidationTriggers.push("若突破後 1~2 根 K 線內回到原區間且量能無法延續，視為假突破，撤銷追價計畫");
  }
  if (mtfDisagreement >= 0.45) invalidationTriggers.push("若多週期分歧持續擴大，原方向優勢被破壞，先回到觀望");
  if (marketRegime === "high volatility") invalidationTriggers.push("若波動異常擴張且止損頻繁被掃，先退場等待波動收斂");

  if (bias === "偏多") {
    biasShiftConditions.push(
      `若跌破結構支撐 ${formatNumber(levels?.structureSupportZone?.low)} 並連續 2 根收在其下，偏多轉為中性/偏空`
    );
  } else if (bias === "偏空") {
    biasShiftConditions.push(
      `若突破結構壓力 ${formatNumber(levels?.structureResistanceZone?.high)} 並連續 2 根收在其上，偏空轉為中性/偏多`
    );
  } else {
    biasShiftConditions.push("若價格突破結構壓力且量增轉強，偏向做多；若跌破結構支撐且量增轉弱，偏向做空");
  }
  biasShiftConditions.push(
    bias === "偏多"
      ? `若 RSI 跌破 45 且 MACD 柱體連續 3 根為負值，取消做多偏向`
      : bias === "偏空"
      ? `若 RSI 站上 55 且 MACD 柱體連續 3 根為正值，取消做空偏向`
      : "若 RSI 重新站上 55 偏多優先；若 RSI 跌破 45 偏空優先"
  );

  if (entryTiming === "READY") triggerScore += 2.2;
  if (entryTiming === "TOO_LATE") triggerScore -= 1.5;
  if (entryTiming === "NO_SETUP") triggerScore -= 2;
  if (marketRegime === "weak trend" || marketRegime === "ranging") triggerScore -= 0.8;
  if (fakeBreakoutRisk === "高") triggerScore -= 1.6;

  let confirmationStrength = "forming";
  if (triggerScore < 2.6) confirmationStrength = "weak";
  else if (triggerScore < 4.1) confirmationStrength = "forming";
  else if (triggerScore < 5.5) confirmationStrength = "near";
  else confirmationStrength = "ready";

  const entryZoneText = hasEntryZone
    ? `${formatNumber(entryLow)} ~ ${formatNumber(entryHigh)}`
    : bias === "偏多"
    ? supportZoneText
    : resistanceZoneText;
  const behaviorClause =
    setupType === "breakout"
      ? bias === "偏多"
        ? `1 根 K 線收盤站上 ${formatNumber(levels?.structureResistanceZone?.high)}，且成交量高於近 20 根均量`
        : `1 根 K 線收盤跌破 ${formatNumber(levels?.structureSupportZone?.low)}，且成交量高於近 20 根均量`
      : bias === "偏多"
      ? `出現止跌/吞噬 K 線，且收盤站回 MA20（${formatNumber(ma20)}）`
      : bias === "偏空"
      ? `出現上影轉弱/空方吞噬 K 線，且收盤跌回 MA20（${formatNumber(ma20)}）`
      : "結構與動能同向";
  const triggerActionText =
    bias === "偏多" ? "執行做多" : bias === "偏空" ? "執行做空" : "等待方向明確後執行";
  const formattedEntryCondition =
    bias === "中性"
      ? "當：價格突破關鍵區間；且：結構與量能同向；→ 執行：依突破方向下單"
      : `當：價格進入 ${entryZoneText}；且：${behaviorClause}；→ 執行：${triggerActionText}`;

  const defaultExecutionPrice =
    tradePlan?.entryMid ?? tradePlan?.entryLow ?? tradePlan?.entryHigh ?? price;
  const executionType = setupType === "breakout" ? "Market" : "Limit";
  const executionAction =
    executionType === "Market"
      ? bias === "偏多"
        ? `突破 ${formatNumber(levels?.structureResistanceZone?.high)} 後，市價做多`
        : `跌破 ${formatNumber(levels?.structureSupportZone?.low)} 後，市價做空`
      : bias === "偏多"
      ? `掛多單於 ${formatNumber(defaultExecutionPrice)}`
      : `掛空單於 ${formatNumber(defaultExecutionPrice)}`;
  const executionCancel =
    bias === "偏多"
      ? `若 2 根 K 線收盤跌破 ${tradePlan?.invalidation || formatNumber(levels?.structureSupportZone?.low)}，取消多單計畫`
      : `若 2 根 K 線收盤突破 ${tradePlan?.invalidation || formatNumber(levels?.structureResistanceZone?.high)}，取消空單計畫`;
  const reverseCondition =
    bias === "偏多"
      ? `若價格跌破 ${formatNumber(levels?.structureSupportZone?.low)} 且收盤未站回，取消做多並啟動做空劇本`
      : bias === "偏空"
      ? `若價格突破 ${formatNumber(levels?.structureResistanceZone?.high)} 且收盤未跌回，取消做空並啟動做多劇本`
      : "若有效突破壓力改做多，若有效跌破支撐改做空";
  const executionModeText =
    executionType === "Market"
      ? bias === "偏多"
        ? `市價條件：若突破 ${formatNumber(levels?.structureResistanceZone?.high)}，立即市價做多`
        : `市價條件：若跌破 ${formatNumber(levels?.structureSupportZone?.low)}，立即市價做空`
      : bias === "偏多"
      ? `掛單價格（Limit）：${formatNumber(defaultExecutionPrice)} 做多`
      : `掛單價格（Limit）：${formatNumber(defaultExecutionPrice)} 做空`;

  const waitLongPrice = formatNumber(levels?.structureResistanceZone?.high);
  const waitShortPrice = formatNumber(levels?.structureSupportZone?.low);
  const waitLongScript = `若：價格突破 ${waitLongPrice} 且收盤站上、成交量高於近 20 根均量、MA20 > MA50 → 執行：市價做多；取消：下一根 K 線跌回 ${waitLongPrice} 下方；反手：跌破支撐 ${waitShortPrice} 時切換做空劇本。`;
  const waitShortScript = `若：價格跌破 ${waitShortPrice} 且收盤跌下、成交量高於近 20 根均量、MA20 < MA50 → 執行：市價做空；取消：下一根 K 線站回 ${waitShortPrice} 上方；反手：突破壓力 ${waitLongPrice} 時切換做多劇本。`;
  const nextAction =
    entryTiming === "READY"
      ? `${executionAction}，並同時設定止損 ${tradePlan?.invalidation || "-"}。`
      : `先不下單；滿足「${formattedEntryCondition}」後再執行。`;
  const ifActionBlock = [
    "當：",
    `- 價格條件：${hasEntryZone ? `價格進入 ${entryZoneText}` : "價格觸發關鍵結構區"}`,
    `且`,
    `- 行為條件：${behaviorClause}`,
    "→ 執行：",
    `- ${bias === "偏空" ? "做空" : bias === "偏多" ? "做多" : "依方向交易"}`,
    `- ${executionModeText}`,
  ].join("\n");
  const executionCard = {
    direction: bias === "偏多" ? "做多" : bias === "偏空" ? "做空" : "WAIT（雙劇本）",
    entryCondition: ifActionBlock,
    execution: executionModeText,
    stopLoss: tradePlan?.invalidation || "-",
    target: `${tradePlan?.target1Text || "-"} / ${tradePlan?.target2Text || "-"}`,
    rr: `${formatNumber(tradePlan?.rr1, 2)} / ${formatNumber(tradePlan?.rr2, 2)}（${tradePlan?.rrLabel || "-"}）`,
    cancel: executionCancel,
    reverse: reverseCondition,
  };

  return {
    side: actionableSide,
    priceRange: entryLow != null && entryHigh != null ? `${formatNumber(entryLow)} ~ ${formatNumber(entryHigh)}` : "-",
    triggerChecklist: [
      `【K線】${candleTrigger}`,
      `【均線】${maTrigger}`,
      `【結構】${structureTrigger}`,
      `【成交量】${volumeTrigger}`,
    ],
    entryTriggers: [...new Set(entryTriggers)],
    invalidationTriggers: [...new Set(invalidationTriggers)],
    biasShiftConditions: [...new Set(biasShiftConditions)],
    entryTriggerSentence: [...new Set(entryTriggers)].slice(0, 2).join("；"),
    invalidationSentence: [...new Set(invalidationTriggers)].slice(0, 2).join("；"),
    biasShiftSentence: [...new Set(biasShiftConditions)].slice(0, 2).join("；"),
    waitConditionSentence: [...new Set(waitConditions.concat(waitReasons || []))].slice(0, 3).join("、"),
    formattedEntryCondition,
    executionPlan: {
      type: executionType,
      action: executionAction,
      cancel: executionCancel,
      mode: executionModeText,
    },
    ifActionBlock,
    waitScripts: {
      long: waitLongScript,
      short: waitShortScript,
    },
    executionCard,
    nextAction,
    waitReason:
      entryTiming === "READY" ? "" : noEntryReason || waitReasons?.[0] || "目前尚未符合可執行進場條件",
    confirmationStrength,
    confirmationLabel: CONFIRMATION_STRENGTH_LABELS[confirmationStrength],
    triggerScore: Number(triggerScore.toFixed(1)),
  };
}

function getTradePlan({ bias, setup, levels, price, atr }) {
  const buffer = Math.max((atr || price * 0.01) * 0.3, price * 0.002);
  const calcRR = (entry, stop, target, side) => {
    if (!entry || !stop || !target) return null;
    const risk = side === "long" ? entry - stop : stop - entry;
    const reward = side === "long" ? target - entry : entry - target;
    if (risk <= 0 || reward <= 0) return null;
    return reward / risk;
  };

  if (bias === "偏多") {
    const entryLow =
      setup === "等突破" ? levels.structureResistanceZone.low : levels.structureSupportZone.low;
    const entryHigh =
      setup === "等突破" ? levels.structureResistanceZone.high + buffer : levels.structureSupportZone.high;
    const entryMid = (entryLow + entryHigh) / 2;
    const stop = levels.structureSupportZone.low - buffer;
    const target1 = levels.nearestResistance;
    const target2 = levels.secondResistance;
    const rr1 = calcRR(entryMid, stop, target1, "long");
    const rr2 = calcRR(entryMid, stop, target2, "long");

    return {
      side: "long",
      entryLow,
      entryHigh,
      entryMid,
      stop,
      target1,
      target2,
      rr1,
      rr2,
      rrBest: Math.max(rr1 || 0, rr2 || 0) || null,
      rrLabel: categorizeRR(Math.max(rr1 || 0, rr2 || 0) || null),
      entryZone: `${formatNumber(entryLow)} ~ ${formatNumber(entryHigh)}`,
      invalidation: formatNumber(stop),
      target1Text: formatNumber(target1),
      target2Text: formatNumber(target2),
    };
  }

  if (bias === "偏空") {
    const entryLow =
      setup === "等跌破" ? levels.structureSupportZone.low - buffer : levels.structureResistanceZone.low;
    const entryHigh =
      setup === "等跌破" ? levels.structureSupportZone.high : levels.structureResistanceZone.high;
    const entryMid = (entryLow + entryHigh) / 2;
    const stop = levels.structureResistanceZone.high + buffer;
    const target1 = levels.nearestSupport;
    const target2 = levels.secondSupport;
    const rr1 = calcRR(entryMid, stop, target1, "short");
    const rr2 = calcRR(entryMid, stop, target2, "short");

    return {
      side: "short",
      entryLow,
      entryHigh,
      entryMid,
      stop,
      target1,
      target2,
      rr1,
      rr2,
      rrBest: Math.max(rr1 || 0, rr2 || 0) || null,
      rrLabel: categorizeRR(Math.max(rr1 || 0, rr2 || 0) || null),
      entryZone: `${formatNumber(entryLow)} ~ ${formatNumber(entryHigh)}`,
      invalidation: formatNumber(stop),
      target1Text: formatNumber(target1),
      target2Text: formatNumber(target2),
    };
  }

  return {
    side: "neutral",
    rr1: null,
    rr2: null,
    rrBest: null,
    rrLabel: "不足",
    entryZone: "等待突破或回踩確認",
    invalidation: "-",
    target1Text: formatNumber(levels.nearestResistance),
    target2Text: formatNumber(levels.secondSupport),
  };
}

function detectFakeBreakoutRisk({ candles, levels, atr, volumeState, breakoutState }) {
  if (!candles?.length) return { score: 0, risk: "低", reasons: [] };
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const body = Math.abs(last.close - last.open);
  const candleRange = Math.max(last.high - last.low, 1e-8);
  const upperWick = last.high - Math.max(last.open, last.close);
  const lowerWick = Math.min(last.open, last.close) - last.low;
  const buffer = Math.max((atr || last.close * 0.01) * 0.2, last.close * 0.002);
  let score = 0;
  const reasons = [];

  if (["向上突破", "向下跌破"].includes(breakoutState) && volumeState === "量縮") {
    score += 2.4;
    reasons.push("突破/跌破但量能不足");
  }

  const backIntoRangeUp =
    last.high > levels.structureResistanceZone.high + buffer && last.close < levels.structureResistanceZone.high;
  const backIntoRangeDown =
    last.low < levels.structureSupportZone.low - buffer && last.close > levels.structureSupportZone.low;
  if (backIntoRangeUp || backIntoRangeDown) {
    score += 3;
    reasons.push("刺穿結構後收回區間");
  }

  if (upperWick > candleRange * 0.55 || lowerWick > candleRange * 0.55) {
    score += 1.4;
    reasons.push("長上/下影線偏長");
  }

  if (prev && ((backIntoRangeUp && last.close < prev.close) || (backIntoRangeDown && last.close > prev.close))) {
    score += 1.8;
    reasons.push("刺穿後快速反轉");
  }

  if (body / candleRange < 0.22) {
    score += 0.8;
    reasons.push("實體偏小，方向確認不足");
  }

  const risk = score >= 5.2 ? "高" : score >= 3 ? "中" : "低";
  return { score: Number(score.toFixed(1)), risk, reasons };
}

function detectTrapSignal({
  candles,
  levels,
  atr,
  rsi,
  macd,
  volumeState,
  mtfBias,
  breakoutState,
}) {
  if (!candles?.length || !levels) {
    return {
      trapSignal: "NONE",
      trapConfidence: "低",
      trapReason: "資料不足，暫無陷阱訊號。",
      trapZoneHigh: null,
      trapZoneLow: null,
      trapValidationRules: [],
      trapInvalidationRules: [],
    };
  }

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const candleRange = Math.max(last.high - last.low, 1e-8);
  const upperWick = last.high - Math.max(last.open, last.close);
  const lowerWick = Math.min(last.open, last.close) - last.low;
  const avgVolume20 =
    candles.slice(-20).reduce((sum, c) => sum + c.volume, 0) / Math.max(candles.slice(-20).length, 1);
  const volumeRatio = avgVolume20 > 0 ? last.volume / avgVolume20 : 1;
  const momentumWeakBull = (rsi != null && rsi < 54) || (macd?.histogram != null && macd.histogram <= 0);
  const momentumWeakBear = (rsi != null && rsi > 46) || (macd?.histogram != null && macd.histogram >= 0);
  const atrBuffer = Math.max((atr || last.close * 0.01) * 0.22, last.close * 0.0018);
  const sweptHigh = last.high > (levels?.structureResistanceZone?.high || last.high) + atrBuffer;
  const sweptLow = last.low < (levels?.structureSupportZone?.low || last.low) - atrBuffer;
  const failedUpHold = last.close < (levels?.structureResistanceZone?.high || last.close);
  const failedDownHold = last.close > (levels?.structureSupportZone?.low || last.close);
  const bullMtfMismatch = mtfBias?.tf15m !== "bullish" || (mtfBias?.tf1h === "bearish" && mtfBias?.tf4h !== "bullish");
  const bearMtfMismatch = mtfBias?.tf15m !== "bearish" || (mtfBias?.tf1h === "bullish" && mtfBias?.tf4h !== "bearish");

  let bullTrapScore = 0;
  const bullTrapReasons = [];
  if (sweptHigh && failedUpHold) {
    bullTrapScore += 2.8;
    bullTrapReasons.push(`已掃過上方流動性 ${formatNumber(levels?.structureResistanceZone?.high)}，但收盤跌回關鍵位下方`);
  }
  if (volumeRatio < 1) {
    bullTrapScore += 1.2;
    bullTrapReasons.push("突破後量能未高於 20MA 均量");
  }
  if (upperWick > candleRange * 0.45) {
    bullTrapScore += 1.1;
    bullTrapReasons.push("上影線明顯，顯示上方賣壓吸收");
  }
  if (momentumWeakBull) {
    bullTrapScore += 1.2;
    bullTrapReasons.push("RSI / MACD 未同步確認突破動能");
  }
  if (bullMtfMismatch) {
    bullTrapScore += 1.4;
    bullTrapReasons.push("多週期未同步偏多");
  }
  if (prev && prev.close > (levels?.structureResistanceZone?.high || prev.close) && failedUpHold) {
    bullTrapScore += 1;
    bullTrapReasons.push("前一根突破後無法延續，出現回落收盤");
  }

  let bearTrapScore = 0;
  const bearTrapReasons = [];
  if (sweptLow && failedDownHold) {
    bearTrapScore += 2.8;
    bearTrapReasons.push(`已掃過下方流動性 ${formatNumber(levels?.structureSupportZone?.low)}，但收盤收回關鍵位上方`);
  }
  if (volumeRatio < 1) {
    bearTrapScore += 1.2;
    bearTrapReasons.push("跌破後量能未高於 20MA 均量");
  }
  if (lowerWick > candleRange * 0.45) {
    bearTrapScore += 1.1;
    bearTrapReasons.push("下影線明顯，顯示下方承接買盤");
  }
  if (momentumWeakBear) {
    bearTrapScore += 1.2;
    bearTrapReasons.push("RSI / MACD 未同步確認下跌動能");
  }
  if (bearMtfMismatch) {
    bearTrapScore += 1.4;
    bearTrapReasons.push("多週期未同步偏空");
  }
  if (prev && prev.close < (levels?.structureSupportZone?.low || prev.close) && failedDownHold) {
    bearTrapScore += 1;
    bearTrapReasons.push("前一根跌破後無法延續，出現回收收盤");
  }

  const trapSignal =
    bullTrapScore < 3.2 && bearTrapScore < 3.2 ? "NONE" : bullTrapScore >= bearTrapScore ? "BULL_TRAP" : "BEAR_TRAP";
  const trapScore = trapSignal === "BULL_TRAP" ? bullTrapScore : trapSignal === "BEAR_TRAP" ? bearTrapScore : 0;
  const trapConfidence = trapScore >= 6 ? "高" : trapScore >= 4.2 ? "中" : "低";

  if (trapSignal === "BULL_TRAP") {
    const trapZoneLow = levels?.structureResistanceZone?.high || null;
    return {
      trapSignal,
      trapConfidence,
      trapReason:
        bullTrapReasons[0] ||
        "上破後未站穩且動能不足，短線偏向誘多風險。",
      trapZoneHigh: Number(last.high.toFixed(4)),
      trapZoneLow: trapZoneLow != null ? Number(trapZoneLow.toFixed(4)) : null,
      trapValidationRules: [
        `15m 收盤無法站穩 ${formatNumber(levels?.structureResistanceZone?.high)} 上方`,
        "突破後成交量未高於 20MA 均量",
        "上影線占比偏高或 RSI 未續強",
      ],
      trapInvalidationRules: [
        `價格重新站穩 ${formatNumber(last.high)} 上方`,
        "成交量放大並延續 2 根 K 線",
        "1h 轉為同步偏多且 MACD 柱體翻正",
      ],
    };
  }

  if (trapSignal === "BEAR_TRAP") {
    const trapZoneHigh = levels?.structureSupportZone?.low || null;
    return {
      trapSignal,
      trapConfidence,
      trapReason:
        bearTrapReasons[0] ||
        "下破後未站穩且動能不足，短線偏向誘空風險。",
      trapZoneHigh: trapZoneHigh != null ? Number(trapZoneHigh.toFixed(4)) : null,
      trapZoneLow: Number(last.low.toFixed(4)),
      trapValidationRules: [
        `15m 收盤無法跌破 ${formatNumber(levels?.structureSupportZone?.low)} 下方`,
        "跌破後成交量未高於 20MA 均量",
        "下影線占比偏高或 RSI 未續弱",
      ],
      trapInvalidationRules: [
        `價格重新跌破 ${formatNumber(last.low)} 下方`,
        "成交量放大並延續 2 根 K 線",
        "1h 轉為同步偏空且 MACD 柱體翻負",
      ],
    };
  }

  const regimeHint =
    breakoutState === "區間內" || volumeState === "量縮"
      ? "目前仍以區間震盪為主，暫無明顯陷阱訊號。"
      : "目前結構未出現明確誘多/誘空特徵。";
  return {
    trapSignal: "NONE",
    trapConfidence: "低",
    trapReason: regimeHint,
    trapZoneHigh: null,
    trapZoneLow: null,
    trapValidationRules: ["等待價格掃過關鍵位後是否失守/失敗站穩"],
    trapInvalidationRules: ["若量價與多週期同步，陷阱風險下降"],
  };
}

function buildAiDecisionOutput({
  symbol,
  price,
  atr,
  setupType,
  finalDecision,
  adjustedConfidenceLevel,
  riskLevel,
  marketRegime,
  mtfBiasObject,
  bias,
  levels,
  finalTradePlan,
  triggerEngine,
  trapDetection,
  summary,
  rsi,
  macd,
}) {
  const action = finalDecision === "BUY" ? "LONG" : finalDecision === "SELL" ? "SHORT" : "HOLD";
  const executionMode = setupType === "breakout" ? "BREAKOUT" : "PULLBACK";
  const rangeHigh = Number((levels?.structureResistanceZone?.high ?? levels?.nearestResistance ?? price).toFixed(4));
  const rangeLow = Number((levels?.structureSupportZone?.low ?? levels?.nearestSupport ?? price).toFixed(4));
  const triggerPrice =
    action === "LONG"
      ? rangeHigh
      : action === "SHORT"
      ? rangeLow
      : bias === "偏多"
      ? rangeHigh
      : rangeLow;
  const invalidationPrice =
    finalTradePlan?.stop ?? (action === "SHORT" ? levels?.structureResistanceZone?.high : levels?.structureSupportZone?.low);
  const mtfAlignmentRules = [
    `15m ${mtfBiasObject.tf15m}`,
    `1h ${mtfBiasObject.tf1h}`,
    `4h ${mtfBiasObject.tf4h}`,
    action === "LONG" ? "4h 不可為 bearish" : action === "SHORT" ? "4h 不可為 bullish" : "等待 15m + 1h 方向一致",
  ];
  const entryReason = {
    breakoutBreakdownCondition: triggerEngine?.formattedEntryCondition || triggerEngine?.entryTriggerSentence || "等待結構突破/跌破確認",
    timeframeCondition: `15m ${mtfBiasObject.tf15m} / 1h ${mtfBiasObject.tf1h} / 4h ${mtfBiasObject.tf4h}`,
    indicatorCondition:
      action === "SHORT"
        ? `RSI <= 45（目前 ${formatNumber(rsi, 2)}）且 MACD 柱體維持負值（目前 ${formatNumber(macd?.histogram, 4)}）`
        : `RSI >= 55（目前 ${formatNumber(rsi, 2)}）且 MACD 柱體維持正值（目前 ${formatNumber(macd?.histogram, 4)}）`,
  };

  return {
    symbol,
    setupType,
    atr,
    action,
    generatedAt: new Date().toISOString(),
    confidence: localizeConfidence(adjustedConfidenceLevel),
    risk: riskLevel,
    summary,
    marketRegime: localizeMarketRegime(marketRegime),
    mtfBias: mtfBiasObject,
    executionPlan: {
      action,
      setupType,
      executionMode,
      atr,
      preferredSide: bias === "偏空" ? "SHORT" : bias === "偏多" ? "LONG" : undefined,
      currentActionLabel:
        action === "LONG" ? "偏多劇本：等待觸發後執行做多" : action === "SHORT" ? "偏空劇本：等待觸發後執行做空" : "目前動作：觀望，等待條件完成",
      rangeHigh,
      rangeLow,
      triggerPrice: triggerPrice != null ? Number(triggerPrice.toFixed(4)) : undefined,
      entryLow: finalTradePlan?.entryLow,
      entryHigh: finalTradePlan?.entryHigh,
      entryMid: finalTradePlan?.entryMid,
      breakoutConfirmationRules: [
        action === "SHORT"
          ? `15m 收盤跌破 ${formatNumber(rangeLow)}`
          : `15m 收盤站上 ${formatNumber(rangeHigh)}`,
        "突破/跌破當根成交量 > 近 20 根平均成交量",
        action === "SHORT"
          ? `MACD 柱體維持負值，RSI <= 45（目前 ${formatNumber(rsi, 2)}）`
          : `MACD 柱體維持正值，RSI >= 55（目前 ${formatNumber(rsi, 2)}）`,
      ],
      retestConfirmationRules: [
        action === "SHORT"
          ? `回測 ${formatNumber(rangeLow)} 無法站回，且收盤再度跌破`
          : `回踩 ${formatNumber(rangeHigh)} 後不破，且收盤重新站上`,
        action === "SHORT" ? "回測時上影線放大、實體收弱" : "回踩時下影線承接、實體收強",
      ],
      mtfAlignmentRules,
      nextConfirmationRules: [
        triggerEngine?.nextAction || "滿足觸發條件後再執行",
        `確認強度：${triggerEngine?.confirmationLabel || "-"}`,
      ],
      invalidationRules: [
        `價格收盤重新回到觸發位反向（${formatNumber(triggerPrice)}）`,
        ...(triggerEngine?.invalidationTriggers || []),
        ...(trapDetection.trapSignal !== "NONE" ? trapDetection.trapInvalidationRules : []),
        action === "SHORT"
          ? `RSI 重新回到 50 上方（目前 ${formatNumber(rsi, 2)}）`
          : `RSI 重新跌回 50 下方（目前 ${formatNumber(rsi, 2)}）`,
        action === "SHORT" ? `MACD 柱體轉正（目前 ${formatNumber(macd?.histogram, 4)}）` : `MACD 柱體轉負（目前 ${formatNumber(macd?.histogram, 4)}）`,
      ].filter(Boolean).slice(0, 6),
      invalidationPrice: invalidationPrice != null ? Number(Number(invalidationPrice).toFixed(4)) : undefined,
      stopLoss: finalTradePlan?.stop,
      takeProfit1: finalTradePlan?.target1,
      takeProfit2: finalTradePlan?.target2,
      takeProfit3:
        action === "LONG" ? levels?.secondResistance : action === "SHORT" ? levels?.secondSupport : undefined,
    },
    entryReason,
    trapDetection,
  };
}

function analyzeMarket(candlesByInterval, primaryTimeframe, symbol = "MARKET") {
  const candles = candlesByInterval[primaryTimeframe] || [];
  if (!candles.length) return null;

  const closes = candles.map((c) => c.close);
  const price = closes[closes.length - 1];
  const ma20 = sma(closes, 20).at(-1);
  const ma50 = sma(closes, 50).at(-1);
  const rsi = calculateRSI(closes, 14);
  const macd = calculateMACD(closes);
  const atr = calculateATR(candles, 14);
  const adx = calculateADX(candles, 14);
  const vwap = calculateVWAP(candles.slice(-80));
  const stochRsi = calculateStochRSI(closes, 14, 3);
  const levels = findPivotLevels(candles.slice(-180), price, atr);
  const structureInfo = detectStructure(candles);
  const volumeState = detectVolumeState(candles);
  const breakoutState = detectBreakoutState(candles, levels, atr);
  const liquiditySweep = detectLiquiditySweep(candles, levels, atr);
  const trendlineState = detectTrendlineState(candles);

  const recent = closes.slice(-6);
  const trendSlope = recent[recent.length - 1] - recent[0];
  const priceAboveMA20 = ma20 !== null && price > ma20;
  const priceAboveMA50 = ma50 !== null && price > ma50;
  const macdBullish = macd && macd.macd > macd.signal && macd.histogram > 0;
  const macdBearish = macd && macd.macd < macd.signal && macd.histogram < 0;
  const priceVsVwap = vwap ? (price - vwap) / vwap : 0;

  let bullScore = 0;
  let bearScore = 0;

  if (priceAboveMA20) bullScore += 1.2;
  else bearScore += 1.2;
  if (priceAboveMA50) bullScore += 1.2;
  else bearScore += 1.2;
  if (trendSlope > 0) bullScore += 1;
  else bearScore += 1;
  if (macdBullish) bullScore += 1.1;
  if (macdBearish) bearScore += 1.1;
  if (rsi !== null && rsi >= 55 && rsi <= 70) bullScore += 1;
  if (rsi !== null && rsi <= 45 && rsi >= 30) bearScore += 1;
  if (stochRsi !== null && stochRsi > 80) bearScore += 0.6;
  if (stochRsi !== null && stochRsi < 20) bullScore += 0.6;
  if (priceVsVwap > 0.003) bullScore += 0.9;
  if (priceVsVwap < -0.003) bearScore += 0.9;
  if (structureInfo.structure === "上升結構") bullScore += 1;
  if (structureInfo.structure === "下降結構") bearScore += 1;
  if (breakoutState === "向上突破") bullScore += 1;
  if (breakoutState === "向下跌破") bearScore += 1;
  if (volumeState === "放量" && trendSlope > 0) bullScore += 0.5;
  if (volumeState === "放量" && trendSlope < 0) bearScore += 0.5;

  let bias = "中性";
  if (bullScore - bearScore >= 1.5) bias = "偏多";
  if (bearScore - bullScore >= 1.5) bias = "偏空";

  const intervalWeights = { "1d": 0.35, "4h": 0.3, "1h": 0.2, "15m": 0.15 };
  const primaryBoost = 0.1;
  const timeframeSignals = ANALYSIS_INTERVALS
    .filter((interval) => candlesByInterval[interval]?.length)
    .map((interval) => {
      const signal = getDirectionalSignal(candlesByInterval[interval]);
      const baseWeight = intervalWeights[interval] || 0.15;
      const weight = interval === primaryTimeframe ? baseWeight + primaryBoost : baseWeight;
      return { interval, ...signal, weight };
    });

  const normalizedWeight = timeframeSignals.reduce((sum, item) => sum + item.weight, 0) || 1;
  const weightedSpread = timeframeSignals.reduce((sum, item) => sum + item.spread * item.weight, 0) / normalizedWeight;
  const mtfBias = weightedSpread > 0.5 ? "偏多" : weightedSpread < -0.5 ? "偏空" : "中性";

  const alignedWeight = timeframeSignals
    .filter((item) => item.bias !== "中性" && item.bias === bias)
    .reduce((sum, item) => sum + item.weight, 0);
  const oppositeWeight = timeframeSignals
    .filter((item) => item.bias !== "中性" && item.bias !== bias)
    .reduce((sum, item) => sum + item.weight, 0);

  const mtfAlignedRatio = normalizedWeight ? alignedWeight / normalizedWeight : 0;
  const mtfDisagreement = normalizedWeight ? oppositeWeight / normalizedWeight : 0;
  const confluence =
    mtfBias === "偏多" ? "多週期偏多" : mtfBias === "偏空" ? "多週期偏空" : "多週期分歧";
  const intervalBiasMap = Object.fromEntries(timeframeSignals.map((item) => [item.interval, item.bias]));
  const mtfBiasObject = {
    tf15m: normalizeMtfBiasLabel(intervalBiasMap["15m"]),
    tf1h: normalizeMtfBiasLabel(intervalBiasMap["1h"]),
    tf4h: normalizeMtfBiasLabel(intervalBiasMap["4h"]),
  };

  const marketRegime = detectMarketRegime({
    adx,
    atr,
    price,
    structure: structureInfo.structure,
    breakoutState,
  });

  const regimeWeighting = {
    trend: { trendStrength: 0.28, momentum: 0.2, volumeConfirmation: 0.16, structurePosition: 0.16, multiTimeframeAlignment: 0.2 },
    ranging: { trendStrength: 0.2, momentum: 0.2, volumeConfirmation: 0.16, structurePosition: 0.24, multiTimeframeAlignment: 0.2 },
    "high volatility": { trendStrength: 0.2, momentum: 0.17, volumeConfirmation: 0.16, structurePosition: 0.17, multiTimeframeAlignment: 0.3 },
    "weak trend": { trendStrength: 0.24, momentum: 0.2, volumeConfirmation: 0.16, structurePosition: 0.18, multiTimeframeAlignment: 0.22 },
  };

  const dimensionScores = computeDimensionScores({
    bias,
    priceAboveMA20,
    priceAboveMA50,
    adx,
    rsi,
    stochRsi,
    macd,
    volumeState,
    breakoutState,
    priceVsVwap,
    structure: structureInfo.structure,
    mtfAlignment: mtfAlignedRatio - mtfDisagreement,
    marketRegime,
  });

  const weights = regimeWeighting[marketRegime] || regimeWeighting["weak trend"];
  let entryScoreBase =
    dimensionScores.trendStrength * weights.trendStrength +
    dimensionScores.momentum * weights.momentum +
    dimensionScores.volumeConfirmation * weights.volumeConfirmation +
    dimensionScores.structurePosition * weights.structurePosition +
    dimensionScores.multiTimeframeAlignment * weights.multiTimeframeAlignment;

  if (marketRegime === "high volatility") entryScoreBase -= 0.7;
  if (mtfDisagreement > 0.45) entryScoreBase -= 0.8;
  entryScoreBase = clamp(entryScoreBase, 0, 10);

  const confidenceLevel = deriveConfidenceLevel({
    mtfAlignedRatio,
    trendStrengthScore: dimensionScores.trendStrength,
    momentumScore: dimensionScores.momentum,
    isHighVolatility: marketRegime === "high volatility",
    volumeState,
  });
  const fakeBreakout = detectFakeBreakoutRisk({
    candles,
    levels,
    atr,
    volumeState,
    breakoutState,
  });
  const trapDetection = detectTrapSignal({
    candles,
    levels,
    atr,
    rsi,
    macd,
    volumeState,
    mtfBias: mtfBiasObject,
    breakoutState,
  });

  let entryAdvice = "先觀望";
  let setup = "等待更明確訊號";
  let stopLoss = null;
  let takeProfit1 = null;
  let takeProfit2 = null;
  let explanation = "多週期尚未形成足夠共振，先等待方向更一致。";

  if (bias === "偏多") {
    if (marketRegime === "ranging") {
      entryAdvice = "保守偏多，等回踩";
      setup = "等回踩";
      explanation = "大方向偏多但盤面偏震盪，避免追價，優先在支撐區分批。";
    } else if (marketRegime === "high volatility") {
      entryAdvice = "降低倉位，等波動收斂";
      setup = "等待波動降溫";
      explanation = "高波動環境下假突破機率偏高，建議縮小倉位並等待更穩定節奏。";
    } else if (breakoutState === "向上突破" && mtfAlignedRatio >= 0.45) {
      entryAdvice = "可考慮突破跟隨";
      setup = "等突破";
      explanation = "主趨勢與多週期方向一致，突破搭配量價條件可小倉位順勢。";
    } else {
      entryAdvice = "可考慮分批做多";
      setup = "等回踩";
      explanation = "主趨勢偏多，短線以回踩支撐承接會比直接追價更穩。";
    }
    stopLoss = levels.structureSupportZone.low;
    takeProfit1 = levels.nearestResistance;
    takeProfit2 = levels.secondResistance;
  }

  if (bias === "偏空") {
    if (marketRegime === "ranging") {
      entryAdvice = "保守偏空，等反彈";
      setup = "等反彈";
      explanation = "大方向偏空但盤勢震盪，建議等反彈壓力區再做評估。";
    } else if (marketRegime === "high volatility") {
      entryAdvice = "降低倉位，等波動收斂";
      setup = "等待波動降溫";
      explanation = "高波動使得反抽與急跌都加劇，建議先控風險再找節奏。";
    } else if (breakoutState === "向下跌破" && mtfAlignedRatio >= 0.45) {
      entryAdvice = "可考慮跌破跟隨";
      setup = "等跌破";
      explanation = "主趨勢與多週期偏空共振，跌破訊號可用小倉位順勢。";
    } else {
      entryAdvice = "可考慮分批做空";
      setup = "等反彈";
      explanation = "主趨勢偏空，短線優先等反彈壓力確認，不宜低位追空。";
    }
    stopLoss = levels.structureResistanceZone.high;
    takeProfit1 = levels.nearestSupport;
    takeProfit2 = levels.secondSupport;
  }

  const volatilityRatio = atr && price ? atr / price : 0;
  const riskLevel = volatilityRatio > 0.025 ? "高" : volatilityRatio > 0.015 ? "中" : "低";
  const tradePlan = getTradePlan({ bias, setup, levels, price, atr });

  const waitReasons = [];
  const waitForConditions = [];
  let entryScoreAdjusted = entryScoreBase;
  let confidenceScorePenalty = 0;
  const momentumUnclear =
    (rsi != null && rsi >= 45 && rsi <= 55) ||
    (macd?.histogram != null && Math.abs(macd.histogram) < (atr || price * 0.003) * 0.05) ||
    dimensionScores.momentum < 5.2;
  const rrGoodButLocationBad = (tradePlan.rrBest || 0) >= 1.5 && dimensionScores.structurePosition < 5.2;
  const structureRangeWidth = Math.abs((levels.nearestResistance || price) - (levels.nearestSupport || price));
  const rangeMiddle = ((levels.nearestResistance || price) + (levels.nearestSupport || price)) / 2;
  const isRangeMiddlePosition =
    structureRangeWidth > 0 &&
    Math.abs(price - rangeMiddle) <= structureRangeWidth * 0.18 &&
    breakoutState === "區間內";

  if (marketRegime === "weak trend" || marketRegime === "ranging") {
    waitReasons.push("市場偏弱趨勢/震盪");
    waitForConditions.push("市場轉為明確趨勢或有效突破區間");
    entryScoreAdjusted -= 0.8;
    confidenceScorePenalty += 1;
  }
  if (mtfDisagreement >= 0.42) {
    waitReasons.push("多週期方向分歧偏大");
    waitForConditions.push("至少主週期與 1h/4h 方向重回一致");
    entryScoreAdjusted -= 1;
    confidenceScorePenalty += 1;
  }
  if (fakeBreakout.risk === "中") {
    waitReasons.push("假突破風險偏高");
    waitForConditions.push("突破後至少一根 K 線收盤站穩/跌破關鍵位");
    entryScoreAdjusted -= 0.8;
    confidenceScorePenalty += 1;
  }
  if (fakeBreakout.risk === "高") {
    waitReasons.push("疑似流動性掃單/假突破");
    waitForConditions.push("掃流動性後結構重新確認且量能回穩");
    entryScoreAdjusted -= 1.4;
    confidenceScorePenalty += 2;
  }

  if (tradePlan.rrBest != null) {
    if (tradePlan.rrBest < 1.2) {
      waitReasons.push("風報比低於 1.2");
      waitForConditions.push("等待風報比提升至至少 1.5");
      entryScoreAdjusted -= 2.2;
      confidenceScorePenalty += 2;
    } else if (tradePlan.rrBest < 1.5) {
      waitReasons.push("風報比僅屬普通");
      waitForConditions.push("等待更佳進場位置提升 RR");
      entryScoreAdjusted -= 0.8;
      confidenceScorePenalty += 1;
    } else if (tradePlan.rrBest > 2) {
      entryScoreAdjusted += 0.4;
    }
  }

  if (rrGoodButLocationBad) {
    waitReasons.push("RR 雖佳但結構位置不理想");
    waitForConditions.push("價格回到支撐/壓力邊緣再評估");
    entryScoreAdjusted -= 1;
    confidenceScorePenalty += 1;
  }

  if (isRangeMiddlePosition) {
    waitReasons.push("價格位於區間中段，勝率與盈虧比不對稱");
    waitForConditions.push("等待價格靠近區間邊界或有效突破");
    entryScoreAdjusted -= 1.1;
    confidenceScorePenalty += 1;
  }

  if (momentumUnclear) {
    waitReasons.push("動能訊號不明確");
    waitForConditions.push("RSI/MACD 動能重新擴張並與方向一致");
    entryScoreAdjusted -= 0.9;
    confidenceScorePenalty += 1;
  }

  if (
    (bias === "偏多" && (breakoutState === "反彈壓力中" || structureInfo.structure === "下降結構")) ||
    (bias === "偏空" && (breakoutState === "回踩支撐中" || structureInfo.structure === "上升結構"))
  ) {
    waitReasons.push("結構與短線動能互相矛盾");
    entryScoreAdjusted -= 1.1;
    confidenceScorePenalty += 1;
  }

  entryScoreAdjusted = clamp(entryScoreAdjusted, 0, 10);
  let adjustedConfidenceLevel = confidenceLevel;
  if (confidenceScorePenalty >= 4) adjustedConfidenceLevel = "low";
  else if (confidenceScorePenalty >= 2 && confidenceLevel === "high") adjustedConfidenceLevel = "medium";
  else if (confidenceScorePenalty >= 2 && confidenceLevel === "medium") adjustedConfidenceLevel = "low";

  const shouldWait =
    bias === "中性" ||
    entryScoreAdjusted < 6 ||
    waitReasons.length >= 3 ||
    fakeBreakout.risk === "高" ||
    (tradePlan.rrBest != null && tradePlan.rrBest < 1.2);

  const shouldNoTrade =
    bias === "中性" ||
    entryScoreAdjusted < 4.8 ||
    waitReasons.length >= 5 ||
    ((marketRegime === "weak trend" || marketRegime === "ranging") &&
      (mtfDisagreement >= 0.42 || isRangeMiddlePosition || momentumUnclear)) ||
    (fakeBreakout.risk === "高" && mtfDisagreement >= 0.35);

  const directionalDecision = shouldNoTrade ? "NO_TRADE" : shouldWait ? "WAIT" : bias === "偏多" ? "BUY" : "SELL";
  const setupType = deriveSetupType({
    bias,
    marketRegime,
    breakoutState,
    structure: structureInfo.structure,
    momentumScore: dimensionScores.momentum,
    mtfAlignedRatio,
    mtfDisagreement,
    directionalDecision,
  });
  const entryTiming = evaluateEntryTiming({
    directionalDecision,
    setupType,
    bias,
    price,
    atr,
    tradePlan,
    breakoutState,
    marketRegime,
    mtfAlignedRatio,
    fakeBreakoutRisk: fakeBreakout.risk,
  });
  const finalDecision = integrateDecisionWithTiming(directionalDecision, entryTiming);
  const noEntryReason =
    entryTiming === "NO_SETUP"
      ? marketRegime === "weak trend" || marketRegime === "ranging"
        ? "市場仍在弱趨勢 / 區間震盪，結構與動能尚未形成可執行訊號"
        : mtfDisagreement > mtfAlignedRatio
        ? "多週期分歧仍大，方向尚未收斂"
        : (tradePlan.rrBest || 0) >= 1.5
        ? "雖然 RR 不錯，但目前位置缺乏有效觸發"
        : "結構、動能與位置優勢不足"
      : "";
  const triggerEngine = buildTriggerEngine({
    bias,
    setupType,
    entryTiming,
    breakoutState,
    structure: structureInfo.structure,
    marketRegime,
    mtfAlignedRatio,
    mtfDisagreement,
    momentumScore: dimensionScores.momentum,
    rsi,
    tradePlan,
    price,
    fakeBreakoutRisk: fakeBreakout.risk,
    levels,
    ma20,
    ma50,
    volumeState,
    waitReasons,
    noEntryReason,
  });

  if (finalDecision === "WAIT" || finalDecision === "NO_TRADE") {
    entryAdvice = finalDecision === "WAIT" ? "不建議進場（等待條件）" : "本輪無有效交易機會";
    if (entryTiming === "TOO_LATE") setup = "等待下一次回踩 / 反彈重置";
    else if (entryTiming === "WAIT_BREAKOUT") setup = "等待突破確認";
    else if (entryTiming === "WAIT_PULLBACK") setup = "等待回踩 / 反彈確認";
    else if (fakeBreakout.risk === "高") setup = "等待重新站穩 / 跌破確認";
    else if (breakoutState === "區間內") setup = "等待突破確認";
    else setup = "等待回踩 / 反彈確認";
    if (waitReasons.length) {
      explanation = `目前先等待，因為${waitReasons.join("、")}。建議等待${waitForConditions.slice(0, 2).join("、")}後再評估。`;
    } else {
      explanation = "目前條件不足，先等待更完整確認訊號。";
    }
  }

  if (entryTiming === "TOO_LATE") {
    if (!waitReasons.includes("價格已接近第一目標，不宜追價")) {
      waitReasons.push("價格已接近第一目標，不宜追價");
    }
    if (!waitForConditions.includes("等待下一次回踩/反彈後重建風報比")) {
      waitForConditions.push("等待下一次回踩/反彈後重建風報比");
    }
    explanation = "方向可能仍延續，但此波已接近目標區，建議等待下一次結構回測再評估。";
  }

  if (entryTiming === "NO_SETUP") {
    if (!waitReasons.includes("目前沒有有效 setup")) waitReasons.push("目前沒有有效 setup");
    if (!waitForConditions.includes("等待結構、動能與風報比同時成立")) {
      waitForConditions.push("等待結構、動能與風報比同時成立");
    }
  }

  let finalTradePlan = tradePlan;
  if (finalDecision === "NO_TRADE") {
    stopLoss = null;
    takeProfit1 = null;
    takeProfit2 = null;
    finalTradePlan = {
      ...tradePlan,
      entryZone: "本輪無有效交易機會",
      invalidation: "-",
      target1Text: "-",
      target2Text: "-",
      rr1: null,
      rr2: null,
      rrLabel: "無效",
    };
  }

  const { longProb, shortProb } = probabilityModel({
    bias,
    breakoutState,
    confluence,
    volumeState,
    liquiditySweep,
    priceVsVwap,
    riskLevel,
    marketRegime,
    confidenceLevel: adjustedConfidenceLevel,
    entryScore: entryScoreAdjusted,
  });

  const smartSignal =
    finalDecision === "NO_TRADE"
      ? "本輪無交易"
      : finalDecision === "WAIT"
    ? "等待確認"
    : bias === "偏多"
    ? breakoutState === "向上突破"
      ? "順勢突破多"
      : "回踩支撐多"
    : bias === "偏空"
    ? breakoutState === "向下跌破"
      ? "順勢跌破空"
      : "反彈壓力空"
    : "等待確認";

  const tradability =
    entryTiming === "READY" && (finalDecision === "BUY" || finalDecision === "SELL")
      ? "可規劃進場"
      : entryTiming === "TOO_LATE"
      ? "已錯過較佳進場"
      : entryTiming === "NO_SETUP"
      ? "無進場訊號"
      : "等待確認";

  const aiSummary = buildAiSummary({
    finalDecision,
    entryTiming,
    setupType,
    bias,
    structure: structureInfo.structure,
    breakoutState,
    volumeState,
    confluence,
    marketRegime,
    confidenceLevel,
    setup,
    entryAdvice,
    longProb,
    shortProb,
    primaryTimeframe,
    rrLabel: finalTradePlan.rrLabel,
    fakeBreakoutRisk: fakeBreakout.risk,
    tradability,
    waitReasons,
    waitForConditions,
    triggerEngine,
    noEntryReason,
    trapDetection,
  });

  const timeframeBiases = timeframeSignals.map(({ interval, bias: intervalBias, spread, weight }) => ({
    interval,
    bias: intervalBias,
    spread: Number(spread.toFixed(2)),
    weight: Number(weight.toFixed(2)),
  }));

  const decisionSummary = triggerEngine?.entryTriggerSentence || explanation;
  const aiDecisionOutput = buildAiDecisionOutput({
    symbol,
    price,
    atr,
    setupType,
    finalDecision,
    adjustedConfidenceLevel,
    riskLevel,
    marketRegime,
    mtfBiasObject,
    bias,
    levels,
    finalTradePlan,
    triggerEngine,
    trapDetection,
    summary: decisionSummary,
    rsi,
    macd,
  });

  return {
    price,
    ma20,
    ma50,
    rsi,
    macd,
    atr,
    adx,
    vwap,
    stochRsi,
    bias,
    entryAdvice,
    finalDecision,
    finalDecisionLabel: localizeDecision(finalDecision),
    entryTiming,
    entryTimingLabel: localizeEntryTiming(entryTiming),
    setupType,
    setupTypeLabel: localizeSetupType(setupType),
    setup,
    stopLoss,
    takeProfit1,
    takeProfit2,
    explanation,
    bullScore,
    bearScore,
    levels,
    higherBiases: timeframeBiases,
    confluence,
    mtfBias: mtfBiasObject,
    confidenceLevel: adjustedConfidenceLevel,
    confidenceLevelLabel: localizeConfidence(adjustedConfidenceLevel),
    marketRegime,
    marketRegimeLabel: localizeMarketRegime(marketRegime),
    entryScore: Number(entryScoreAdjusted.toFixed(1)),
    riskLevel,
    structure: structureInfo.structure,
    breakoutState,
    volumeState,
    tradePlan: finalTradePlan,
    executionPlan: aiDecisionOutput.executionPlan,
    trapDetection: aiDecisionOutput.trapDetection,
    aiDecisionOutput,
    fakeBreakout,
    waitReasons,
    waitForConditions,
    noEntryReason,
    triggerEngine,
    liquiditySweep,
    trendlineState,
    aiSummary,
    summary: decisionSummary,
    longProb,
    shortProb,
    smartSignal,
    dimensionScores,
  };
}

async function fetchBinanceKlines(symbol, timeframe, limit = 240) {
  const response = await fetch(
    `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${timeframe}&limit=${limit}`
  );
  if (!response.ok) throw new Error("無法取得價格資料，請稍後再試。");

  const data = await response.json();
  return data.map((row) => ({
    openTime: row[0],
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
  }));
}

export default function CryptoSignalWebApp() {
  const restoredSnapshot = useMemo(() => loadSimulationSnapshot(), []);

  useEffect(() => {
    try {
      const updateSW = registerSW({ immediate: true });
      return () => updateSW && updateSW();
    } catch {
      return undefined;
    }
  }, []);

  const [symbol, setSymbol] = useState(() => restoredSnapshot?.marketSymbol || "SOLUSDT");
  const [timeframe, setTimeframe] = useState(() => restoredSnapshot?.timeframe || "15m");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const [candles, setCandles] = useState([]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [paperSymbol, setPaperSymbol] = useState(() => restoredSnapshot?.currentSymbol || "SOL");
  const [paperAccount, setPaperAccount] = useState(() => restoredSnapshot?.paperAccount || loadPaperAccount());
  const [simulationStateBySymbol, setSimulationStateBySymbol] = useState(() =>
    normalizeSimulationStateBySymbol(restoredSnapshot?.simulationStateBySymbol)
  );
  const currentSimulationState = simulationStateBySymbol[paperSymbol] || createDefaultSymbolSimulationState();
  const simulationExecutionStatus = currentSimulationState.executionStatus;
  const simulationLifecycle = currentSimulationState.lifecycle;
  const simulationStartedAt = currentSimulationState.startedAt;
  const lastDecisionAt = currentSimulationState.lastDecisionAt;
  const simulationRestoreInfo = currentSimulationState.restore;
  const lastProcessedCandleRef = useRef({});
  const lastAppliedPaperTickKeyRef = useRef({});
  const hasLoggedResumeAfterRestoreRef = useRef({});
  const executionLocksRef = useRef({});
  const [marketSnapshots, setMarketSnapshots] = useState({});
  const updateSimulationStateForSymbol = (symbolKey, updater) => {
    if (!symbolKey) return;
    setSimulationStateBySymbol((prev) => {
      const previous = prev?.[symbolKey] || createDefaultSymbolSimulationState();
      const nextPartial = typeof updater === "function" ? updater(previous) : updater;
      return {
        ...prev,
        [symbolKey]: {
          ...previous,
          ...nextPartial,
        },
      };
    });
  };
  const appendSimulationEvent = (symbolKey, message, timestamp = new Date().toISOString()) => {
    if (!symbolKey || !message) return;
    updateSimulationStateForSymbol(symbolKey, (previous) => ({
      recentSimulationEvents: [
        { timestamp, message },
        ...(Array.isArray(previous?.recentSimulationEvents) ? previous.recentSimulationEvents : []),
      ].slice(0, 5),
    }));
  };
  const simulationStatusBySymbol = useMemo(() => {
    const result = {};
    for (const symbolKey of PAPER_SUPPORTED_SYMBOLS) {
      const state = simulationStateBySymbol?.[symbolKey] || createDefaultSymbolSimulationState();
      result[symbolKey] = {
        symbol: `${symbolKey}USDT`,
        isSimulating: state.isSimulating,
        lifecycle: state.lifecycle,
        startedAt: state.startedAt,
        elapsedTime: state.elapsedTime,
        lastDecisionAt: state.lastDecisionAt,
        currentPhase: state.currentPhase || "idle",
        waitingReason: state.waitingReason || "-",
        executionMode: state.executionMode || null,
        targetEntryZone: state.targetEntryZone || "-",
        currentPrice: state.currentPrice,
        unmetConditions: Array.isArray(state.unmetConditions) ? state.unmetConditions.slice(0, 3) : [],
        lastBlockReason: state.lastBlockReason || "-",
        hasPendingOrder: Array.isArray(state.pendingOrders) && state.pendingOrders.length > 0,
        hasOpenPosition: Array.isArray(state.openPositions) && state.openPositions.length > 0,
        cooldownActive: Boolean(state?.cooldown?.longCooldownBarsLeft > 0 || state?.cooldown?.shortCooldownBarsLeft > 0),
        blockedByRangeFilter: Boolean(state?.executionStatus?.reason?.includes("震盪") || state?.executionStatus?.reason?.includes("range")),
        blockedByPerformanceFilter: Boolean(state?.executionStatus?.blockedByPerformanceFilter),
        executionAllowed: !state.executionLock && state.lifecycle === "running",
        lastDecisionSummary: state.lastDecisionSummary || "-",
        latestDecisionResult: state?.executionStatus?.statusLabel || "-",
        recentSimulationEvents: Array.isArray(state.recentSimulationEvents) ? state.recentSimulationEvents : [],
      };
    }
    return result;
  }, [simulationStateBySymbol]);
  const currentSimulationStatus = simulationStatusBySymbol[paperSymbol] || simulationStatusBySymbol.SOL || createDefaultSymbolSimulationState();

  const buildPaperMarketSnapshot = (candlesInput = []) => {
    const validCandles = Array.isArray(candlesInput) ? candlesInput : [];
    const latest = validCandles[validCandles.length - 1];
    if (!latest) return null;
    const closes = validCandles.map((candle) => Number(candle.close)).filter((value) => Number.isFinite(value));
    const ma20Series = sma(closes, 20);
    const macd = calculateMACD(closes);
    return {
      price: Number(latest.close),
      candleClose: Number(latest.close),
      candleHigh: Number(latest.high),
      candleLow: Number(latest.low),
      candleTime: Number(latest.openTime),
      rsi: calculateRSI(closes, 14),
      ma20: ma20Series[ma20Series.length - 1],
      macd,
      updatedAt: new Date().toISOString(),
    };
  };

  const loadData = async (nextSymbol = symbol, nextTimeframe = timeframe) => {
    setIsLoading(true);
    setError("");

    try {
      const intervalEntries = await Promise.all(
        ANALYSIS_INTERVALS.map(async (interval) => [
          interval,
          await fetchBinanceKlines(nextSymbol, interval, interval === "1d" ? 365 : 240),
        ])
      );

      const candlesByInterval = Object.fromEntries(intervalEntries);

      setCandles(candlesByInterval[nextTimeframe] || []);
      const analyzed = analyzeMarket(candlesByInterval, nextTimeframe, nextSymbol);
      setAnalysis(analyzed);
      const nextPaperSnapshot = buildPaperMarketSnapshot(candlesByInterval[nextTimeframe] || []);
      if (nextPaperSnapshot) {
        setMarketSnapshots((prev) => ({
          ...prev,
          [nextSymbol]: nextPaperSnapshot,
        }));
      }
      setLastUpdated(new Date().toLocaleString());
    } catch (err) {
      setError(err.message || "讀取資料失敗");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData(symbol, timeframe);
  }, [symbol, timeframe]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => loadData(symbol, timeframe), 30000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, symbol, timeframe]);

  const currentCandle = candles[candles.length - 1];

  const chartData = useMemo(() => {
    if (!candles.length) return [];

    const closes = candles.map((c) => c.close);
    const ma20Series = sma(closes, 20);
    const ma50Series = sma(closes, 50);
    const sliced = candles.slice(-60);
    const highs = sliced.map((c) => c.high);
    const lows = sliced.map((c) => c.low);
    const maxPrice = Math.max(...highs);
    const minPrice = Math.min(...lows);
    const chartHeight = 260;

    const priceToY = (price) => {
      if (maxPrice === minPrice) return chartHeight / 2;
      return ((maxPrice - price) / (maxPrice - minPrice)) * chartHeight;
    };

    return sliced.map((c, idx, arr) => {
      const originalIndex = candles.length - arr.length + idx;
      return {
        openTime: c.openTime,
        time: formatTime(c.openTime, timeframe),
        open: c.open,
        close: c.close,
        high: c.high,
        low: c.low,
        volume: c.volume,
        ma20: ma20Series[originalIndex],
        ma50: ma50Series[originalIndex],
        bodyBase: Math.max(c.open, c.close),
        bodyValue: Math.abs(c.close - c.open),
        bullish: c.close >= c.open,
        openY: priceToY(c.open),
        closeY: priceToY(c.close),
        highY: priceToY(c.high),
        lowY: priceToY(c.low),
      };
    });
  }, [candles, timeframe]);

  const digits = symbol === "BTCUSDT" ? 0 : 2;
  const paperDigits = paperSymbol === "BTC" ? 0 : 2;
  const timeframeLabel =
    INTERVAL_OPTIONS.find((item) => item.value === timeframe)?.label || timeframe;
  const paperMarketSymbol = `${paperSymbol}USDT`;
  const paperCurrentPrice = symbol === paperMarketSymbol ? analysis?.price : null;

  useEffect(() => {
    setPaperAccount((prev) => normalizePaperAccountState(prev, {
      eventType: "SYMBOL_SWITCH",
      sourceFunction: "App.paperMarketSymbolChange",
    }));
  }, [paperMarketSymbol]);

  useEffect(() => {
    let cancelled = false;
    const refreshSnapshots = async () => {
      try {
        const results = await Promise.all(
          PAPER_MARKET_SYMBOLS.map(async (marketSymbol) => {
            const rows = await fetchBinanceKlines(marketSymbol, timeframe, 120);
            return [marketSymbol, buildPaperMarketSnapshot(rows)];
          })
        );
        if (cancelled) return;
        setMarketSnapshots((prev) => {
          const next = { ...prev };
          for (const [marketSymbol, snapshot] of results) {
            if (snapshot) next[marketSymbol] = snapshot;
          }
          return next;
        });
      } catch (pollError) {
        console.debug("[paper-market] snapshot refresh failed", pollError);
      }
    };
    refreshSnapshots();
    const timer = window.setInterval(refreshSnapshots, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [timeframe]);

  useEffect(() => {
    const snapshotEntries = Object.entries(marketSnapshots || {});
    if (!snapshotEntries.length) return;
    setPaperAccount((prev) => {
      let next = prev;
      for (const [marketSymbol, snapshot] of snapshotEntries) {
        const dedupeKey = `${snapshot?.candleTime || "na"}-${snapshot?.price || "na"}`;
        if (lastAppliedPaperTickKeyRef.current?.[marketSymbol] === dedupeKey) continue;
        lastAppliedPaperTickKeyRef.current[marketSymbol] = dedupeKey;
        next = applyMarketTickToPaperState(next, {
          price: snapshot?.price,
          symbol: marketSymbol,
          candleClose: snapshot?.candleClose,
          candleHigh: snapshot?.candleHigh,
          candleLow: snapshot?.candleLow,
          rsi: snapshot?.rsi,
          macd: snapshot?.macd,
          ma20: snapshot?.ma20,
          candleTime: snapshot?.candleTime,
          triggeredBy: "MARKET_CANDLE",
          selectedSymbolAtThatMoment: paperMarketSymbol,
          allowPendingFills: (simulationStateBySymbol?.[marketSymbol.replace("USDT", "")]?.lifecycle || "idle") === "running",
        });
      }
      return next;
    });
  }, [marketSnapshots, paperMarketSymbol, simulationStateBySymbol]);

  useEffect(() => {
    if (symbol !== paperMarketSymbol) return;
    if (!analysis?.aiDecisionOutput) return;
    setPaperAccount((prev) =>
      reconcilePendingOrdersWithDecision({
        state: prev,
        decision: analysis.aiDecisionOutput,
        symbol: paperMarketSymbol,
        timeframe,
        currentPrice: paperCurrentPrice,
        candleTime: currentCandle?.openTime,
        triggeredBy: "DECISION_ENGINE",
        selectedSymbolAtThatMoment: paperMarketSymbol,
      })
    );
  }, [analysis?.aiDecisionOutput, symbol, paperCurrentPrice, paperMarketSymbol, timeframe, currentCandle?.openTime]);

  useEffect(() => {
    if (symbol !== paperMarketSymbol) return;
    if (simulationLifecycle !== "running") return;
    const candleKey = `${paperMarketSymbol}-${timeframe}-${currentCandle?.openTime || "na"}-${analysis?.price || "na"}`;
    if (!currentCandle?.openTime || lastProcessedCandleRef.current?.[paperSymbol] === candleKey) return;
    lastProcessedCandleRef.current[paperSymbol] = candleKey;
    console.debug("[SIM_STATE_READ]", { symbol: paperSymbol, isSimulating: currentSimulationState.isSimulating, elapsedTime: currentSimulationState.elapsedTime });
    runSimulationStep({ mode: "agent_loop", executionSource: "simulation_agent" });
  }, [simulationLifecycle, symbol, currentCandle?.openTime, analysis?.price, paperMarketSymbol, timeframe, paperSymbol, currentSimulationState.isSimulating, currentSimulationState.elapsedTime]);

  const accountSnapshot = useMemo(() => {
    const accountSummary = calculateAccountSummary(paperAccount);
    const currentSymbolOpenPositions = (paperAccount.openPositions || []).filter((position) => position.symbol === paperMarketSymbol);
    const currentSymbolPendingOrders = (paperAccount.pendingOrders || [])
      .filter((order) => order.symbol === paperMarketSymbol)
      .filter((order) => isFormalPendingOrder(order));
    const currentSymbolClosedTrades = (paperAccount.closedTrades || []).filter((trade) => trade.symbol === paperMarketSymbol);
    const currentSymbolCancelledOrders = (paperAccount.cancelledOrders || [])
      .filter((order) => order.symbol === paperMarketSymbol)
      .filter((order) => isFormalCancelledOrder(order));
    const wins = currentSymbolClosedTrades.filter((trade) => trade.realizedPnl >= 0).length;
    const losses = currentSymbolClosedTrades.length - wins;
    const totalTrades = currentSymbolClosedTrades.length;
    const winRate = totalTrades ? (wins / totalTrades) * 100 : 0;
    const simulationStats = calculateSimulationStats(paperAccount, paperMarketSymbol);
    const diagnostics = buildDiagnostics({
      ...paperAccount,
      closedTrades: currentSymbolClosedTrades,
    });

    return {
      ...paperAccount,
      ...accountSummary,
      currentSymbolOpenPositions,
      currentSymbolPendingOrders,
      currentSymbolClosedTrades,
      currentSymbolCancelledOrders,
      totalOpenPositionsAllSymbols: (paperAccount.openPositions || []).length,
      totalPendingOrdersAllSymbols: (paperAccount.pendingOrders || []).filter((order) => isFormalPendingOrder(order)).length,
      currentSymbolOpenPositionsCount: currentSymbolOpenPositions.length,
      currentSymbolPendingOrdersCount: currentSymbolPendingOrders.length,
      wins,
      losses,
      totalTrades,
      winRate,
      simulationStats,
      diagnostics,
    };
  }, [paperAccount, paperMarketSymbol]);

  useEffect(() => {
    const now = Date.now();
    setSimulationStateBySymbol((prev) => {
      const next = { ...prev };
      for (const symbolKey of PAPER_SUPPORTED_SYMBOLS) {
        const marketSymbol = `${symbolKey}USDT`;
        const current = prev?.[symbolKey] || createDefaultSymbolSimulationState();
        const startedAtTs = current.startedAt ? new Date(current.startedAt).getTime() : null;
        const elapsedTime = current.lifecycle === "running" && Number.isFinite(startedAtTs)
          ? Math.max(0, Math.floor((now - startedAtTs) / 1000))
          : current.lifecycle === "idle"
            ? 0
            : current.elapsedTime;
        next[symbolKey] = {
          ...current,
          elapsedTime,
          pendingOrders: (paperAccount.pendingOrders || [])
            .filter((order) => order.symbol === marketSymbol)
            .filter((order) => isFormalPendingOrder(order)),
          openPositions: (paperAccount.openPositions || []).filter((position) => position.symbol === marketSymbol),
          closedTrades: (paperAccount.closedTrades || []).filter((trade) => trade.symbol === marketSymbol),
          cooldown: getDirectionalCooldownStateFromAccount(paperAccount, marketSymbol),
          performanceStats: calculateSimulationStats(paperAccount, marketSymbol),
          simulationAgentRuntimeState: paperAccount?.simulationAgentState?.[marketSymbol] || {},
        };
      }
      return next;
    });
  }, [paperAccount]);

  useEffect(() => {
    if (!simulationRestoreInfo?.restored) return;
    console.debug("[SIM_RESTORE]", {
      symbol: paperSymbol,
      restoredKeys: simulationRestoreInfo.restoredKeys || [],
    });
    console.debug("[simulation:persistence] simulation state restored", {
      restoredLifecycle: simulationRestoreInfo.restoredLifecycle,
      restoredPositionsCount: simulationRestoreInfo.restoredPositionsCount,
      restoredPendingCount: simulationRestoreInfo.restoredPendingCount,
      restoredAt: simulationRestoreInfo.restoredAt,
      lastDecisionTime: simulationRestoreInfo.lastDecisionTime,
    });
    console.debug("[simulation:persistence] restored lifecycle", simulationRestoreInfo.restoredLifecycle);
    console.debug("[simulation:persistence] restored positions count", simulationRestoreInfo.restoredPositionsCount);
    console.debug("[simulation:persistence] restored pending count", simulationRestoreInfo.restoredPendingCount);
  }, [simulationRestoreInfo, paperSymbol]);

  useEffect(() => {
    if (!simulationRestoreInfo?.restored || simulationLifecycle !== "running" || hasLoggedResumeAfterRestoreRef.current?.[paperSymbol]) return;
    hasLoggedResumeAfterRestoreRef.current[paperSymbol] = true;
    console.debug("[simulation:persistence] agent resumed after restore", {
      symbol: paperSymbol,
      lifecycle: simulationLifecycle,
      restoredAt: simulationRestoreInfo.restoredAt,
    });
  }, [simulationLifecycle, simulationRestoreInfo, paperSymbol]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const snapshot = {
      version: 1,
      updatedAt: new Date().toISOString(),
      simulationLifecycle,
      simulationStateBySymbol,
      paperAccount: {
        ...paperAccount,
        simulationStats: accountSnapshot.simulationStats,
      },
      openPositions: paperAccount.openPositions || [],
      pendingOrders: paperAccount.pendingOrders || [],
      closedTrades: paperAccount.closedTrades || [],
      simulationStats: accountSnapshot.simulationStats,
      simulationStartTime: simulationStartedAt,
      lastDecisionTime: lastDecisionAt,
      currentSymbol: paperSymbol,
      marketSymbol: symbol,
      timeframe,
      simulationOrderConfig: paperAccount.simulationOrderConfig || { mode: "fixed_quantity", quantity: 50 },
    };
    window.localStorage.setItem(SIMULATION_SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
    window.localStorage.setItem(PAPER_ACCOUNT_STORAGE_KEY, JSON.stringify(paperAccount));
    console.debug("[simulation:persistence] simulation state saved", {
      lifecycle: simulationLifecycle,
      symbol: paperSymbol,
      positions: snapshot.openPositions.length,
      pending: snapshot.pendingOrders.length,
    });
  }, [
    simulationLifecycle,
    simulationStateBySymbol,
    paperAccount,
    accountSnapshot.simulationStats,
    simulationStartedAt,
    lastDecisionAt,
    paperSymbol,
    symbol,
    timeframe,
  ]);

  const runSimulationStep = ({ mode = "manual_click", executionSource = "simulation_manual" } = {}) => {
    if (executionLocksRef.current?.[paperSymbol]) return;
    executionLocksRef.current[paperSymbol] = true;
    updateSimulationStateForSymbol(paperSymbol, { executionLock: true });
    updateSimulationStateForSymbol(paperSymbol, {
      currentPhase: "analyzing_strategy",
      waitingReason: "策略分析中",
      targetEntryZone: null,
      currentPrice: Number.isFinite(paperCurrentPrice) ? paperCurrentPrice : null,
      unmetConditions: [],
    });
    const manualExecutionMeta = {
      mode,
      executionSource,
      orderMode: "simulation",
    };
    console.debug("[simulation:click]", manualExecutionMeta);
    if (symbol !== paperMarketSymbol) {
      updateSimulationStateForSymbol(paperSymbol, {
        executionStatus: normalizeSimulationExecutionStatus({
        status: "WATCHING",
        statusLabel: "觀察中（非交易幣種畫面）",
        reason: "目前檢視的 symbol 非交易引擎 symbol，已阻擋因 UI 切換觸發的模擬下單流程",
        unmetConditions: [],
        distances: [],
        timestamp: new Date().toISOString(),
      }),
        currentPhase: "waiting_market_data",
        waitingReason: "尚未收到新市場資料",
        targetEntryZone: null,
        currentPrice: Number.isFinite(paperCurrentPrice) ? paperCurrentPrice : null,
        unmetConditions: [],
        lastBlockReason: "目前不在該交易幣種畫面",
        lastDecisionSummary: "等待資料",
      });
      appendSimulationEvent(paperSymbol, "等待市場資料（目前非交易幣種畫面）");
      executionLocksRef.current[paperSymbol] = false;
      updateSimulationStateForSymbol(paperSymbol, { executionLock: false });
      return;
    }
    if (!analysis?.aiDecisionOutput || !paperCurrentPrice) {
      updateSimulationStateForSymbol(paperSymbol, {
        executionStatus: normalizeSimulationExecutionStatus({
        status: "WATCHING",
        statusLabel: "已進入等待確認模式",
        reason: "尚未取得即時價格或 AI 決策，先觀察並等待下一筆有效條件",
        unmetConditions: [],
        distances: [],
        timestamp: new Date().toISOString(),
      }),
        currentPhase: "waiting_market_data",
        waitingReason: "尚未收到新市場資料",
        targetEntryZone: null,
        currentPrice: Number.isFinite(paperCurrentPrice) ? paperCurrentPrice : null,
        unmetConditions: [],
        lastBlockReason: "尚未取得即時價格或決策",
        lastDecisionSummary: "等待資料",
      });
      appendSimulationEvent(paperSymbol, "等待新市場資料或 AI 決策");
      executionLocksRef.current[paperSymbol] = false;
      updateSimulationStateForSymbol(paperSymbol, { executionLock: false });
      return;
    }

    setPaperAccount((prev) => {
      const recentVolumes = (candles || []).slice(-20).map((c) => Number(c.volume)).filter((v) => Number.isFinite(v));
      const avgVolume20 = recentVolumes.length ? recentVolumes.reduce((sum, v) => sum + v, 0) / recentVolumes.length : null;
      const latestVolume = Number(currentCandle?.volume ?? candles?.[candles.length - 1]?.volume);
      let nextFeedback = {
        status: "WATCHING",
        statusLabel: "已進入等待確認模式",
        reason: "觸發條件尚未成立，已轉為等待確認",
        unmetConditions: [],
        distances: [],
        timestamp: new Date().toISOString(),
      };
      const reconciledState = reconcilePendingOrdersWithDecision({
        state: prev,
        decision: analysis.aiDecisionOutput,
        symbol: paperMarketSymbol,
        timeframe,
        currentPrice: paperCurrentPrice,
        candleTime: currentCandle?.openTime,
        triggeredBy: "DECISION_ENGINE",
        selectedSymbolAtThatMoment: paperMarketSymbol,
      });
      const previousCancelledCount = (prev.cancelledOrders || []).length;
      const cancelledCount = (reconciledState.cancelledOrders || []).length - previousCancelledCount;
      const latestCancelled = cancelledCount > 0 ? reconciledState.cancelledOrders?.[0] : null;
      const selectedQuantity = Number(prev?.simulationOrderConfig?.quantity) > 0 ? Number(prev.simulationOrderConfig.quantity) : 50;
      const latestTradeTimestamp = [
        ...(prev?.openPositions || []).map((position) => new Date(position?.openedAt || 0).getTime()),
        ...(prev?.closedTrades || []).map((trade) => new Date(trade?.closedAt || 0).getTime()),
        ...(prev?.pendingOrders || []).map((order) => new Date(order?.createdAt || 0).getTime()),
      ]
        .filter((value) => Number.isFinite(value) && value > 0)
        .sort((a, b) => b - a)[0];
      const noTradeBars = (() => {
        if (!Array.isArray(candles) || candles.length === 0) return 0;
        if (!Number.isFinite(latestTradeTimestamp)) return candles.length;
        return candles.filter((candle) => Number(candle?.openTime) > latestTradeTimestamp).length;
      })();
      const forceProbeEntry = noTradeBars >= SIMULATION_FORCE_PROBE_NO_TRADE_BARS;
      const trendScore = Number(analysis?.multiTimeframe?.score);
      const normalizedRegime = String(analysis?.marketRegime || "").trim().toUpperCase();
      const forcedTradeRelaxation = forceProbeEntry && (normalizedRegime === "TREND" || normalizedRegime === "TRENDING");
      console.debug("[simulation:submit-payload]", {
        ...manualExecutionMeta,
        symbol: paperMarketSymbol,
        timeframe,
        currentPrice: paperCurrentPrice,
        quantity: selectedQuantity,
        noTradeBars,
        forceProbeEntry,
        forcedTradeRelaxation,
        trendScore: Number.isFinite(trendScore) ? trendScore : null,
        setupType: analysis.aiDecisionOutput?.setupType || analysis.aiDecisionOutput?.executionPlan?.setupType || null,
      });
      const decisionSide = resolveDecisionSide(analysis.aiDecisionOutput);
      const previousCandle = candles?.length > 1 ? candles[candles.length - 2] : null;
      const hasKlineConfirmation = resolveKlineConfirmation({
        side: decisionSide,
        rsi: Number(analysis?.rsi),
        currentCandle,
        previousCandle,
        marketRegime: analysis?.marketRegime,
        trendScore,
        forcedTradeRelaxation,
      });
      const cooldownState = getDirectionalCooldownStateFromAccount(prev, paperMarketSymbol);
      const cooldownActiveForSide =
        (decisionSide === "LONG" && cooldownState.longCooldownBarsLeft > 0) ||
        (decisionSide === "SHORT" && cooldownState.shortCooldownBarsLeft > 0);
      const sideCooldownBarsLeft = decisionSide === "SHORT"
        ? cooldownState.shortCooldownBarsLeft
        : cooldownState.longCooldownBarsLeft;
      const sideConsecutiveLossCount = decisionSide === "SHORT"
        ? cooldownState.shortLossStreak
        : cooldownState.longLossStreak;
      console.debug("[simulation:agent-guard]", {
        executionSource,
        decisionSide,
        hasKlineConfirmation,
        lastTradeDirection: cooldownState.lastTradeDirection,
        consecutiveLossCount: sideConsecutiveLossCount,
        cooldownActive: cooldownActiveForSide,
        cooldownBarsLeft: sideCooldownBarsLeft,
      });
      if (cooldownActiveForSide) {
        nextFeedback = {
          status: "WATCHING",
          statusLabel: "方向冷卻中",
          reason: `${decisionSide === "LONG" ? "多單" : "空單"}連續虧損已達 ${SIMULATION_DIRECTIONAL_LOSS_STREAK_THRESHOLD} 次，暫停 ${sideCooldownBarsLeft} 根 K`,
          unmetConditions: ["DIRECTIONAL_COOLDOWN_ACTIVE"],
          distances: [],
          hasKlineConfirmation,
          timestamp: new Date().toISOString(),
          cooldownDebug: {
            lastTradeDirection: cooldownState.lastTradeDirection,
            longLossStreak: cooldownState.longLossStreak,
            shortLossStreak: cooldownState.shortLossStreak,
            consecutiveLossCount: sideConsecutiveLossCount,
            cooldownActive: cooldownActiveForSide,
            cooldownBarsLeft: sideCooldownBarsLeft,
          },
        };
        updateSimulationStateForSymbol(paperSymbol, { executionStatus: normalizeSimulationExecutionStatus(nextFeedback) });
        updateSimulationStateForSymbol(paperSymbol, {
          currentPhase: "cooldown",
          waitingReason: "cooldown 尚未結束",
          targetEntryZone: null,
          currentPrice: Number.isFinite(paperCurrentPrice) ? paperCurrentPrice : null,
          unmetConditions: ["等待 cooldown 結束後再重新評估進場"],
          lastBlockReason: "cooldown 尚未結束",
          lastDecisionSummary: "不交易（cooldown 中）",
        });
        appendSimulationEvent(paperSymbol, "cooldown active");
        return {
          ...reconciledState,
          simulationAgentState: {
            ...(reconciledState?.simulationAgentState || {}),
            hasKlineConfirmation,
            lastTradeDirection: cooldownState.lastTradeDirection,
            longLossStreak: cooldownState.longLossStreak,
            shortLossStreak: cooldownState.shortLossStreak,
            consecutiveLossCount: sideConsecutiveLossCount,
            cooldownActive: cooldownActiveForSide,
            cooldownBarsLeft: sideCooldownBarsLeft,
          },
        };
      }
      const result = simulateDecisionExecution({
        state: reconciledState,
        decision: analysis.aiDecisionOutput,
        symbol: paperMarketSymbol,
        timeframe,
        currentPrice: paperCurrentPrice,
        quantity: selectedQuantity,
        forceSimulation: String(analysis?.finalDecision || "").toUpperCase() === "NO_TRADE",
        executionSource,
        orderMode: "simulation",
        triggeredBy: "DECISION_ENGINE",
        signalContext: {
          rsi: analysis?.rsi,
          macd: analysis?.macd,
          candleOpen: currentCandle?.open,
          candleHigh: currentCandle?.high,
          candleLow: currentCandle?.low,
          candleClose: currentCandle?.close,
          prevOpen: previousCandle?.open,
          prevClose: previousCandle?.close,
          currentVolume: latestVolume,
          avgVolume20,
          volumeConfirmed: analysis?.volumeState === "量增",
          structure: {
            supportLow: analysis?.levels?.structureSupportZone?.low,
            supportHigh: analysis?.levels?.structureSupportZone?.high,
            resistanceLow: analysis?.levels?.structureResistanceZone?.low,
            resistanceHigh: analysis?.levels?.structureResistanceZone?.high,
          },
          mtf: {
            aligned: analysis?.multiTimeframe?.aligned,
            disagreement: analysis?.multiTimeframe?.disagreement,
            score: analysis?.multiTimeframe?.score,
          },
          marketRegime: analysis?.marketRegime,
          breakoutState: analysis?.breakoutState,
          trendScore,
          hasKlineConfirmation,
          klineConfirmed: hasKlineConfirmation,
          candleTime: currentCandle?.openTime,
          noTradeBars,
          forceProbeEntry,
          forcedTradeRelaxation,
          cooldownActiveForSide,
        },
      });
      const pendingBefore = (reconciledState.pendingOrders || []).length;
      const pendingAfter = (result.state?.pendingOrders || []).length;
      const didCallCreatePendingOrder = result.executionIntent === "PLACE_PENDING";
      const createdPendingOrder = Boolean(result.pendingOrder) && pendingAfter > pendingBefore;
const confirmationDecisionType = result.confirmationResult?.decisionType || null;
const entryTiming = String(analysis.aiDecisionOutput?.entryTiming || "").toUpperCase();
const setupType = String(
  analysis.aiDecisionOutput?.setupType || analysis.aiDecisionOutput?.executionPlan?.setupType || ""
).toLowerCase();

const pendingType =
  confirmationDecisionType === "WAIT_PULLBACK" || entryTiming === "WAIT_PULLBACK" || setupType === "pullback"
    ? "PULLBACK_ENTRY"
    : confirmationDecisionType === "WAIT_BREAKOUT" ||
        entryTiming === "WAIT_BREAKOUT" ||
        setupType === "breakout"
      ? "BREAKOUT_ENTRY"
      : confirmationDecisionType || entryTiming || null;

const isOpportunityEntry = pendingType === "OPPORTUNITY_ENTRY" || pendingType === "FALLBACK_ENTRY";
const isMissedMoveEntry = pendingType === "MISSED_MOVE_ENTRY";
const isProbeEntryD = pendingType === "PROBE_ENTRY_D";
const scoringResult = result.confirmationResult?.scoring || null;
const isRangeStrategy = Boolean(result.confirmationResult?.confirmationState?.rangeMarket);
const simulationAgentState = {
  hasKlineConfirmation,
  lastTradeDirection: cooldownState.lastTradeDirection,
  longLossStreak: cooldownState.longLossStreak,
  shortLossStreak: cooldownState.shortLossStreak,
  consecutiveLossCount: sideConsecutiveLossCount,
  cooldownActive: cooldownActiveForSide,
  cooldownBarsLeft: sideCooldownBarsLeft,
};
      console.debug("[simulation:service-result]", {
        ...manualExecutionMeta,
        executionSource,
        finalDecision: analysis?.finalDecision || null,
        decisionType: result.confirmationResult?.decisionType || null,
        executionIntent: result.executionIntent || null,
        pendingType,
        didCallCreatePendingOrder,
        createPendingOrderResult: result.pendingCreation || null,
        pendingOrdersBefore: pendingBefore,
        pendingOrdersAfter: pendingAfter,
        result: result.result,
        eligibilityInfo: result.eligibilityInfo || null,
        createdPosition: Boolean(result.position),
        createdPendingOrder,
        ...simulationAgentState,
      });
      const shouldRunImmediateFillCheck = result.result === "PENDING_CREATED" && !createdPendingOrder;
      if (result.result === "PENDING_CREATED" && createdPendingOrder) {
        console.debug("[SIM_PENDING_GUARD]", {
          symbol: paperMarketSymbol,
          orderId: result.pendingOrder?.id || null,
          reason: "SKIP_IMMEDIATE_FILL_ON_CREATE",
          sourceFunction: "runSimulationStep",
          note: "first cycle after pending create does not run fill check",
          currentPrice: paperCurrentPrice,
          entryPrice: result.pendingOrder?.entryPrice ?? null,
        });
      }
      const executedState = shouldRunImmediateFillCheck
        ? applyMarketTickToPaperState(result.state, {
          price: paperCurrentPrice,
          symbol: paperMarketSymbol,
          candleClose: currentCandle?.close,
          candleHigh: undefined,
          candleLow: undefined,
          rsi: analysis?.rsi,
          macd: analysis?.macd,
          ma20: analysis?.ma20,
          candleTime: currentCandle?.openTime,
          triggeredBy: "MARKET_TICK",
          selectedSymbolAtThatMoment: paperMarketSymbol,
        })
        : result.state;

      const prevOpenCount = prev.openPositions.filter((position) => position.symbol === paperMarketSymbol && position.timeframe === timeframe).length;
      const nextOpenCount = executedState.openPositions.filter((position) => position.symbol === paperMarketSymbol && position.timeframe === timeframe).length;

      if (result.result === "EXECUTED_IMMEDIATELY" || nextOpenCount > prevOpenCount) {
        const simulatedNonRecommended = Boolean(result?.eligibilityInfo?.overrideApplied);
        nextFeedback = {
          status: "EXECUTED",
          statusLabel: simulatedNonRecommended
            ? "模擬掛單（非建議）"
            : isMissedMoveEntry
              ? "錯過行情進場（反彈 / 回檔）"
              : isProbeEntryD && isRangeStrategy
                ? "震盪盤策略"
              : isProbeEntryD
                ? "低信心試單（D級）"
              : isOpportunityEntry
                ? "次優進場（低信心）"
              : "已立即模擬進場",
          reason: simulatedNonRecommended
            ? "已覆寫 AI NO TRADE 並建立模擬持倉"
              : isMissedMoveEntry
                ? "價格已脫離原區間，偵測到反轉 / 回檔訊號，已以更小倉位進場"
              : isProbeEntryD && isRangeStrategy
                ? "震盪盤策略：靠近支撐/壓力觸發試單，採低倉位探測"
              : isProbeEntryD
                ? "D 級市場觸發 RSI 極值或最低交易頻率，已以小倉位試單"
              : isOpportunityEntry
                ? "價格在區間停留過久仍未完美確認，已以小倉位嘗試進場"
              : "觸發條件已成立，系統已建立持倉",
          unmetConditions: [],
          distances: [],
          timestamp: new Date().toISOString(),
        };
      } else if (result.result === "PENDING_CREATED" && createdPendingOrder) {
        const simulatedNonRecommended = Boolean(result?.eligibilityInfo?.overrideApplied);
        nextFeedback = {
          status: "PENDING",
          statusLabel: simulatedNonRecommended
            ? "模擬掛單（非建議）"
            : isMissedMoveEntry
              ? "錯過行情進場（反彈 / 回檔）"
              : isProbeEntryD && isRangeStrategy
                ? "震盪盤策略"
              : isProbeEntryD
                ? "低信心試單（D級）"
              : isOpportunityEntry
                ? "次優進場（低信心）"
              : "已建立條件掛單",
          reason: simulatedNonRecommended
            ? "已建立模擬掛單（非建議）"
              : isMissedMoveEntry
                ? "價格已遠離原進場區，改以反轉/回檔訊號掛單，並降低倉位"
              : isProbeEntryD && isRangeStrategy
                ? "震盪盤策略：在支撐/壓力附近以低倉位掛單探測"
              : isProbeEntryD
                ? "D 級市場 RSI 極值 / 長時間無交易，已啟用低信心試單"
              : isOpportunityEntry
                ? "在進場區久候未出現完整確認，已放寬條件並降低倉位掛單"
              : "已建立條件掛單，等待條件成立後進場",
          pendingOrder: result.pendingOrder,
          unmetConditions: [],
          distances: [],
          timestamp: new Date().toISOString(),
        };
      } else if (result.result === "PENDING_CREATED") {
        nextFeedback = {
          status: "WATCHING",
          statusLabel: "已進入等待確認模式",
          reason: "偵測到掛單未成功寫入，已回退為觀察模式（尚未建立條件單）",
          unmetConditions: [],
          distances: [],
          timestamp: new Date().toISOString(),
        };
      } else if (cancelledCount > 0) {
        nextFeedback = {
          status: "WATCHING",
          statusLabel: "已進入等待確認模式",
          reason: mapCancelReasonLabel(latestCancelled?.cancelReason),
          unmetConditions: [],
          distances: [],
          timestamp: latestCancelled?.cancelledAt || new Date().toISOString(),
        };
      } else if (result.result === "WATCH_AND_ARM") {
        nextFeedback = {
          status: "WATCHING",
          statusLabel: "已進入等待確認模式",
          reason: "已進入等待確認模式，條件成立後可轉為掛單或進場",
          unmetConditions: [],
          distances: [],
          timestamp: new Date().toISOString(),
        };
      } else if (result.result === "INVALID_EXECUTION_PLAN_BLOCKED") {
        nextFeedback = {
          status: "WATCHING",
          statusLabel: "交易計畫異常，已阻止下單",
          reason: "交易計畫異常，已阻止下單",
          unmetConditions: [],
          distances: [],
          timestamp: new Date().toISOString(),
        };
      } else if (result.result === "WATCH_ONLY" || String(analysis.aiDecisionOutput?.setupType || "").toLowerCase() === "no_setup") {
        nextFeedback = {
          status: "WATCHING",
          statusLabel: "目前不交易，已進入觀察模式",
          reason: "目前僅觀察，尚未建立條件單",
          unmetConditions: [],
          distances: [],
          timestamp: new Date().toISOString(),
        };
      } else {
        const diagnostics = buildExecutionDiagnostics({
          decision: analysis.aiDecisionOutput,
          currentPrice: paperCurrentPrice,
          rsi: analysis?.rsi,
          currentVolume: latestVolume,
          avgVolume20,
        });
        nextFeedback = {
          status: "WATCHING",
          statusLabel: "目前不交易，已進入觀察模式",
          reason: `等待結構與動能重新同步：${mapExecutionBlockedReason(result.result, analysis.aiDecisionOutput)}`,
          unmetConditions: diagnostics.unmetConditions,
          distances: diagnostics.distances,
          timestamp: new Date().toISOString(),
        };
      }

      const mappedPhase =
        result.result === "EXECUTED_IMMEDIATELY" || nextOpenCount > prevOpenCount
          ? "position_managing"
          : result.result === "PENDING_CREATED" && createdPendingOrder
            ? "pending_order_created"
            : result.result === "WATCH_AND_ARM"
              ? "waiting_fill_conditions"
              : result.result === "WATCH_ONLY"
                ? "condition_checking"
              : "waiting_new_candle";
      const waitingDetails = buildSimulationWaitingDetails({
        analysis,
        timeframe,
        currentPrice: paperCurrentPrice,
        diagnostics: nextFeedback?.unmetConditions,
      });
      const isNonWaitingState =
        result.result === "PENDING_CREATED" && createdPendingOrder
        || result.result === "EXECUTED_IMMEDIATELY"
        || nextOpenCount > prevOpenCount;
      const waitingReason =
        result.result === "PENDING_CREATED" && createdPendingOrder
          ? "已有 pending order，等待觸價"
          : result.result === "EXECUTED_IMMEDIATELY" || nextOpenCount > prevOpenCount
            ? "已有持倉，不重複進場"
            : waitingDetails.waitingReason;
      const blockReason =
        result.result === "WATCH_ONLY" || result.result === "WATCH_AND_ARM"
          ? nextFeedback?.reason
          : result.blockReason || nextFeedback?.reason || null;
      const decisionSummary =
        result.result === "EXECUTED_IMMEDIATELY" || nextOpenCount > prevOpenCount
          ? "可交易（已進場）"
          : result.result === "PENDING_CREATED" && createdPendingOrder
            ? "等待確認（已建立掛單）"
            : "不交易";

      console.debug("[simulation:ui-feedback-source]", {
        ...manualExecutionMeta,
        finalDecision: analysis?.finalDecision || null,
        decisionType: result.confirmationResult?.decisionType || null,
        executionIntent: result.executionIntent || null,
        uiStatus: nextFeedback.status,
        uiStatusLabel: nextFeedback.statusLabel,
        uiReason: nextFeedback.reason,
        feedbackSource: result.result,
        createdPendingOrder,
      });

      if (scoringResult) {
        nextFeedback = {
          ...nextFeedback,
          scoring: {
            totalScore: scoringResult.totalScore,
            scoreGrade: scoringResult.scoreGrade,
            confidenceLevel: scoringResult.confidenceLevel,
            keyPositiveFactors: scoringResult.keyPositiveFactors || [],
            keyNegativeFactors: scoringResult.keyNegativeFactors || [],
          },
        };
      }
      nextFeedback = {
        ...nextFeedback,
        hasKlineConfirmation,
        isTrendRelaxed: Boolean(result.confirmationResult?.confirmationState?.isTrendRelaxed),
        forcedTradeRelaxation: Boolean(result.confirmationResult?.confirmationState?.forcedTradeRelaxation),
        relaxationLevel: result.confirmationResult?.confirmationState?.relaxationLevel || null,
        currentSetupKey: result.currentSetupKey,
        currentFullSetupKey: result.currentFullSetupKey,
        currentCoarseSetupKey: result.currentCoarseSetupKey,
        currentSetupWinRate: result.currentSetupWinRate,
        currentSetupSampleSize: result.currentSetupSampleSize,
        performanceSource: result.performanceSource,
        performanceSampleSize: result.performanceSampleSize,
        performanceWinRate: result.performanceWinRate,
        performanceAvgPnl: result.performanceAvgPnl,
        blockedByPerformanceFilter: result.blockedByPerformanceFilter,
        cooldownDebug: {
          lastTradeDirection: cooldownState.lastTradeDirection,
          longLossStreak: cooldownState.longLossStreak,
          shortLossStreak: cooldownState.shortLossStreak,
          consecutiveLossCount: sideConsecutiveLossCount,
          cooldownActive: cooldownActiveForSide,
          cooldownBarsLeft: sideCooldownBarsLeft,
        },
      };

      updateSimulationStateForSymbol(paperSymbol, {
        executionStatus: normalizeSimulationExecutionStatus(nextFeedback),
        currentPhase: mappedPhase,
        waitingReason,
        executionMode: isNonWaitingState ? null : waitingDetails.executionMode,
        targetEntryZone: isNonWaitingState ? null : waitingDetails.targetEntryZone,
        currentPrice: isNonWaitingState ? null : waitingDetails.currentPrice,
        unmetConditions: isNonWaitingState ? [] : waitingDetails.unmetConditions,
        lastBlockReason: blockReason,
        lastDecisionSummary: decisionSummary,
      });
      if (result.result === "PENDING_CREATED" && createdPendingOrder) {
        appendSimulationEvent(paperSymbol, "pending order created");
      } else if (result.result === "EXECUTED_IMMEDIATELY" || nextOpenCount > prevOpenCount) {
        appendSimulationEvent(paperSymbol, "decision = trade");
      } else {
        appendSimulationEvent(paperSymbol, "decision = no trade");
      }
      console.debug("[simulation:position-write]", {
        ...manualExecutionMeta,
        finalStatus: nextFeedback.status,
        finalReason: nextFeedback.reason,
        openPositionCount: executedState.openPositions?.length || 0,
        pendingOrderCount: executedState.pendingOrders?.length || 0,
      });
      return {
        ...executedState,
        simulationAgentState,
      };
    });
    const decidedAt = new Date().toISOString();
    updateSimulationStateForSymbol(paperSymbol, {
      lastDecisionAt: decidedAt,
      lastProcessedAt: decidedAt,
      lastTickTime: currentCandle?.openTime || null,
      lastCandleTime: currentCandle?.openTime || null,
    });
    executionLocksRef.current[paperSymbol] = false;
    updateSimulationStateForSymbol(paperSymbol, { executionLock: false });
  };

  const handleExecuteSimulation = () => runSimulationStep({ mode: "manual_click", executionSource: "simulation_manual" });

  const handleSimulationQuantityChange = (quantity) => {
    setPaperAccount((prev) => ({
      ...prev,
      simulationOrderConfig: {
        mode: "fixed_quantity",
        quantity: Number(quantity) > 0 ? Number(quantity) : 1,
      },
    }));
  };

  const handleClosePosition = (positionId) => {
    if (!paperCurrentPrice) return;

    setPaperAccount((prev) =>
      closePositionManually(prev, {
        positionId,
        price: paperCurrentPrice,
        reason: "MANUAL_CLOSE",
      })
    );
  };

  const handleCancelPendingOrder = (orderId) => {
    setPaperAccount((prev) =>
      cancelPendingOrderManually(prev, {
        orderId,
        reason: "MANUAL_CANCEL",
      })
    );
  };

  const handleResetPaperAccount = () => {
    setPaperAccount(resetPaperTradingState());
    updateSimulationStateForSymbol(paperSymbol, {
      ...createDefaultSymbolSimulationState(),
      rehydrate: {
        attempted: true,
        completed: true,
      },
    });
    executionLocksRef.current[paperSymbol] = false;
    lastProcessedCandleRef.current[paperSymbol] = null;
  };

  const handleStartSimulation = () => {
    const nowIso = new Date().toISOString();
    const current = simulationStateBySymbol[paperSymbol] || createDefaultSymbolSimulationState();
    const startedAt = current.lifecycle === "paused" && current.startedAt ? current.startedAt : nowIso;
    updateSimulationStateForSymbol(paperSymbol, {
      lifecycle: "running",
      isSimulating: true,
      startedAt,
      currentPhase: "initializing",
      waitingReason: "初始化中",
      targetEntryZone: null,
      currentPrice: null,
      unmetConditions: [],
      lastDecisionSummary: "等待確認",
      rehydrate: {
        attempted: true,
        completed: true,
      },
    });
    appendSimulationEvent(paperSymbol, "simulation started");
    console.debug("[SIM_START]", { symbol: paperSymbol, startedAt });
  };

  const handlePauseSimulation = () => {
    updateSimulationStateForSymbol(paperSymbol, {
      lifecycle: "paused",
      isSimulating: false,
      currentPhase: "stopped",
      waitingReason: "模擬已暫停",
      targetEntryZone: null,
      currentPrice: null,
      unmetConditions: [],
    });
    appendSimulationEvent(paperSymbol, "simulation paused");
  };

  const handleStopSimulation = () => {
    const current = simulationStateBySymbol[paperSymbol] || createDefaultSymbolSimulationState();
    const stoppedAt = new Date().toISOString();
    const startedAtTs = current.startedAt ? new Date(current.startedAt).getTime() : null;
    const elapsed = Number.isFinite(startedAtTs) ? Math.max(0, Math.floor((Date.now() - startedAtTs) / 1000)) : current.elapsedTime;
    updateSimulationStateForSymbol(paperSymbol, {
      lifecycle: "stopped",
      isSimulating: false,
      elapsedTime: elapsed,
      currentPhase: "stopped",
      waitingReason: "模擬已停止",
      targetEntryZone: null,
      currentPrice: null,
      unmetConditions: [],
    });
    appendSimulationEvent(paperSymbol, "simulation stopped");
    console.debug("[SIM_STOP]", { symbol: paperSymbol, stoppedAt, elapsed });
  };

  const simulationButtonState = useMemo(
    () =>
      getSimulationButtonState(analysis?.aiDecisionOutput, paperCurrentPrice, {
        rsi: analysis?.rsi,
        macd: analysis?.macd,
        currentVolume: Number(currentCandle?.volume ?? candles?.[candles.length - 1]?.volume),
        avgVolume20: (() => {
          const recentVolumes = (candles || []).slice(-20).map((c) => Number(c.volume)).filter((v) => Number.isFinite(v));
          return recentVolumes.length ? recentVolumes.reduce((sum, v) => sum + v, 0) / recentVolumes.length : null;
        })(),
      }),
    [analysis?.aiDecisionOutput, paperCurrentPrice, analysis?.rsi, analysis?.macd, currentCandle?.volume, candles]
  );

  useEffect(() => {
    console.debug("[SIM_STATE_READ]", {
      symbol: paperSymbol,
      isSimulating: currentSimulationState.isSimulating,
      elapsedTime: currentSimulationState.elapsedTime,
    });
  }, [paperSymbol, currentSimulationState.isSimulating, currentSimulationState.elapsedTime]);

  return (
    <div className="min-h-screen w-full bg-slate-50">
      <div className="mx-auto flex min-h-screen w-full max-w-[1920px] flex-col lg:flex-row">
        <PaperTradingSidebar
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          paperSymbol={paperSymbol}
          setPaperSymbol={setPaperSymbol}
          supportedSymbols={PAPER_SUPPORTED_SYMBOLS}
          accountSnapshot={accountSnapshot}
          paperDigits={paperDigits}
          onExecuteSimulation={handleExecuteSimulation}
          onStartSimulation={handleStartSimulation}
          onPauseSimulation={handlePauseSimulation}
          onStopSimulation={handleStopSimulation}
          simulationOrderConfig={accountSnapshot.simulationOrderConfig}
          onSimulationQuantityChange={handleSimulationQuantityChange}
          simulationExecutionStatus={simulationExecutionStatus}
          simulationButtonState={simulationButtonState}
          simulationLifecycle={simulationLifecycle}
          simulationStartedAt={simulationStartedAt}
          lastDecisionAt={lastDecisionAt}
          simulationRestoreInfo={simulationRestoreInfo}
          currentSimulationStatus={currentSimulationStatus}
          onClosePosition={handleClosePosition}
          onCancelPendingOrder={handleCancelPendingOrder}
          onResetPaperAccount={handleResetPaperAccount}
          formatNumber={formatNumber}
        />

        <main className="min-w-0 flex-1 px-4 py-4 sm:px-6 lg:px-8 lg:py-8">
          <TradingDecisionPage
            symbol={symbol}
            setSymbol={setSymbol}
            timeframe={timeframe}
            setTimeframe={setTimeframe}
            symbolOptions={SYMBOL_OPTIONS}
            intervalOptions={INTERVAL_OPTIONS}
            loadData={loadData}
            isLoading={isLoading}
            autoRefresh={autoRefresh}
            setAutoRefresh={setAutoRefresh}
            error={error}
            analysis={analysis}
            timeframeLabel={timeframeLabel}
            lastUpdated={lastUpdated}
            chartData={chartData}
            currentCandle={currentCandle}
            formatNumber={formatNumber}
            digits={digits}
            showDevOutput={Boolean(import.meta.env.DEV)}
            paperState={accountSnapshot}
            paperSymbol={paperMarketSymbol}
          />
        </main>
      </div>
    </div>
  );
}
