import { mapDecisionTypeToExecutionIntent, runConfirmationEngine } from "@/lib/decision/confirmation-engine";

const DEFAULT_BALANCE = 5000;
const DEFAULT_LEVERAGE = 1;
const DEFAULT_POSITION_SIZE = 50;
const TRAP_BLOCK_CONFIDENCE = new Set(["MEDIUM", "HIGH", "中", "高"]);
const LEVEL_CHANGE_TOLERANCE_RATIO = 0.001;
const MAX_CANCELLED_ORDERS_HISTORY = 50;
const ALLOWED_PENDING_CANCEL_TRIGGERS = new Set(["MARKET_TICK", "MARKET_CANDLE", "RECONCILE"]);
const DECISION_STALE_MS = 30 * 60 * 1000;
const DEFAULT_PENDING_EXPIRY_MS = 6 * 60 * 60 * 1000;
const DEFAULT_SHORT_BREAKDOWN_ATR_RATIO = 0.2;
const DEFAULT_PENDING_DRIFT_ATR_RATIO = 2;
const DEFAULT_PENDING_TIMEOUT_BARS = 4;
const DEFAULT_PULLBACK_MAX_WAIT_BARS = 6;
const DEFAULT_TREND_ENTRY_CLAMP_PCT = 0.002;
const DEFAULT_RANGE_ENTRY_CLAMP_PCT = 0.0008;
const DEFAULT_REENTRY_MAX_ATTEMPTS = 2;
const DEFAULT_REENTRY_FAIL_LIMIT = 2;
const DEFAULT_REENTRY_PULLBACK_ATR_RATIO = 0.15;
const DEFAULT_REENTRY_MIN_DISTANCE_PCT = 0.0004;
const MAX_ACCOUNT_TRACE_HISTORY = 2000;
const MAX_ACCOUNT_ERROR_TRACE_HISTORY = 400;
const ACCOUNT_SURGE_ABS_THRESHOLD = 10000;
const ACCOUNT_SURGE_RATIO_THRESHOLD = 5;
const REDUCED_CONFIDENCE_TYPES = new Set(["OPPORTUNITY_ENTRY", "FALLBACK_ENTRY", "MISSED_MOVE_ENTRY", "PROBE_ENTRY_D"]);
const DIRECTIONAL_LOSS_STREAK_THRESHOLD = 2;
const DIRECTIONAL_COOLDOWN_BARS = 6;
const PERFORMANCE_MIN_SAMPLE_SIZE = 10;
const RECENT_PERFORMANCE_WINDOW = 20;
const WAITING_REASON_KEYS = [
  "blockedByKlineConfirmation",
  "blockedByRangeFilter",
  "blockedByLocationFilter",
  "blockedByPerformanceFilter",
  "blockedByCooldown",
  "waitingForPullback",
  "waitingForBreakout",
  "pendingTooFarFromPrice",
  "canceledByPriceDrift",
];

export const DEFAULT_PERFORMANCE_DEBUG_STATE = {
  currentSetupKey: "-",
  currentFullSetupKey: "-",
  currentCoarseSetupKey: "-",
  performanceSource: "-",
  performanceSampleSize: 0,
  performanceWinRate: null,
  performanceAvgPnl: null,
  currentSetupWinRate: null,
  currentSetupSampleSize: 0,
  blockedByPerformanceFilter: false,
};

function buildPerformanceDebugState(overrides = {}) {
  return {
    ...DEFAULT_PERFORMANCE_DEBUG_STATE,
    ...overrides,
  };
}

function createEmptyWaitingReasonCounter() {
  return WAITING_REASON_KEYS.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {});
}

function createDefaultWaitingDiagnostics() {
  return {
    reasonCounts: createEmptyWaitingReasonCounter(),
    symbolWaitBars: {},
    firstValidSignalByContext: {},
    signalToPlaceBars: [],
    placeToFillBars: [],
    recentEvents: [],
  };
}

function normalizeBarTime(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function calculateBarsDelta(fromBarTime, toBarTime) {
  const from = normalizeBarTime(fromBarTime);
  const to = normalizeBarTime(toBarTime);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null;
  return Math.max(0, Math.floor(to - from));
}

function normalizeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function asSafeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function createDefaultSymbolIsolationState() {
  return {
    longLossStreak: 0,
    shortLossStreak: 0,
    longCooldownBars: 0,
    shortCooldownBars: 0,
    lastTradeDirection: null,
    cooldownLastCandleTime: null,
    performanceMap: {},
    coarsePerformanceMap: {},
  };
}

function buildReentryKey({ symbol, timeframe, side }) {
  return [symbol || "-", timeframe || "-", side || "-"].join("|");
}

function isTrendRegime(regime) {
  const normalized = String(regime || "").toLowerCase();
  return normalized === "trend" || normalized === "trending";
}

function resolveReentryReason(cancelReason, { side, triggerPrice, markPrice, atr } = {}) {
  if (cancelReason === "PRICE_DRIFTED") return "DRIFT";
  if (cancelReason === "PENDING_TIMEOUT_REEVALUATED") {
    const trigger = normalizeNumber(triggerPrice);
    const mark = normalizeNumber(markPrice);
    const atrValue = normalizeNumber(atr);
    if (Number.isFinite(trigger) && Number.isFinite(mark)) {
      const movedWithTrend = side === "LONG" ? mark > trigger : mark < trigger;
      const movedDistance = Math.abs(mark - trigger);
      if (movedWithTrend && (!Number.isFinite(atrValue) || movedDistance >= Math.max(atrValue * 0.8, Math.abs(trigger) * 0.002))) {
        return "MISSED_MOVE";
      }
    }
    return "TIMEOUT";
  }
  return null;
}

function registerReentryCandidate(state, {
  order,
  cancelReason,
  candleTime,
  timestamp = nowIso(),
  markPrice,
}) {
  if (!order?.symbol || !order?.timeframe || !order?.side) return state;
  const reentryReason = resolveReentryReason(cancelReason, {
    side: order.side,
    triggerPrice: order.triggerPrice,
    markPrice,
    atr: order?.placementSnapshot?.atr,
  });
  if (!reentryReason) return state;
  const isTrend = isTrendRegime(order?.regime ?? order?.decisionSnapshot?.marketRegimeLabel ?? order?.decisionSnapshot?.regime);
  if (!isTrend) return state;
  const key = buildReentryKey(order);
  const tracked = state?.reentryTracking?.[key] || {};
  const nextFailureStreak = order?.isReentryAttempt ? asSafeNumber(tracked.failureStreak) + 1 : asSafeNumber(tracked.failureStreak);
  const nextStateEntry = {
    ...tracked,
    symbol: order.symbol,
    timeframe: order.timeframe,
    side: order.side,
    contextKey: order.decisionContextKey || tracked.contextKey || null,
    decisionRevision: buildDecisionRevision(order?.decisionSnapshot, order?.timeframe),
    reentryCount: asSafeNumber(tracked.reentryCount),
    maxReentryAttempts: asSafeNumber(tracked.maxReentryAttempts, DEFAULT_REENTRY_MAX_ATTEMPTS),
    failureStreak: nextFailureStreak,
    lastCancelReason: reentryReason,
    lastCancelledAt: timestamp,
    lastCancelledCandleTime: normalizeBarTime(candleTime),
    lastTriggerPrice: normalizeNumber(order.triggerPrice),
    lastMarkPrice: normalizeNumber(markPrice),
    active: true,
    abandoned: nextFailureStreak >= asSafeNumber(tracked.failLimit, DEFAULT_REENTRY_FAIL_LIMIT),
    failLimit: asSafeNumber(tracked.failLimit, DEFAULT_REENTRY_FAIL_LIMIT),
  };
  return {
    ...state,
    reentryTracking: {
      ...(state?.reentryTracking || {}),
      [key]: nextStateEntry,
    },
  };
}

function resolveReentryAttempt(state, { decision, symbol, timeframe, side, currentPrice, candleTime }) {
  const key = buildReentryKey({ symbol, timeframe, side });
  const tracked = state?.reentryTracking?.[key];
  if (!tracked?.active || tracked?.abandoned) return null;
  if (!isTrendRegime(decision?.marketRegimeLabel || decision?.regime)) return null;
  if (asSafeNumber(tracked.reentryCount) >= asSafeNumber(tracked.maxReentryAttempts, DEFAULT_REENTRY_MAX_ATTEMPTS)) return null;
  const signalSide = resolveSideFromDecision(decision);
  if (!signalSide || signalSide !== side) return null;
  const currentCandleTime = normalizeBarTime(candleTime);
  if (Number.isFinite(currentCandleTime) && Number.isFinite(tracked.lastCancelledCandleTime) && currentCandleTime < tracked.lastCancelledCandleTime) {
    return null;
  }
  const baseEntry = resolvePlannedEntryPrice(decision, side);
  const basePrice = normalizeNumber(baseEntry.entryPrice);
  const mark = normalizeNumber(currentPrice);
  const atr = normalizeNumber(decision?.executionPlan?.atr ?? decision?.atr);
  if (!Number.isFinite(basePrice) || !Number.isFinite(mark)) return null;
  const pullbackOffset = Number.isFinite(atr) && atr > 0
    ? atr * DEFAULT_REENTRY_PULLBACK_ATR_RATIO
    : Math.abs(mark) * DEFAULT_REENTRY_MIN_DISTANCE_PCT;
  const minDistance = Math.max(Math.abs(mark) * DEFAULT_REENTRY_MIN_DISTANCE_PCT, 1e-8);
  const anchor = side === "LONG" ? mark - Math.max(pullbackOffset, minDistance) : mark + Math.max(pullbackOffset, minDistance);
  const adjustedEntry = side === "LONG"
    ? Math.max(basePrice, anchor)
    : Math.min(basePrice, anchor);
  const adjustedDistance = Math.abs(adjustedEntry - mark);
  if (adjustedDistance < minDistance) return null;
  return {
    isReentryAttempt: true,
    reentryCount: asSafeNumber(tracked.reentryCount) + 1,
    reentryReason: tracked.lastCancelReason || "TIMEOUT",
    reentryAdjustedEntry: Math.abs(adjustedEntry - basePrice) > 1e-8,
    adjustedEntryPrice: adjustedEntry,
    key,
  };
}

function getSymbolIsolationState(state, symbol) {
  if (!symbol) return createDefaultSymbolIsolationState();
  const scoped = state?.symbolIsolationState?.[symbol];
  if (scoped && typeof scoped === "object") {
    return {
      ...createDefaultSymbolIsolationState(),
      ...scoped,
    };
  }
  return {
    ...createDefaultSymbolIsolationState(),
    longLossStreak: asSafeNumber(state?.longLossStreak),
    shortLossStreak: asSafeNumber(state?.shortLossStreak),
    longCooldownBars: asSafeNumber(state?.longCooldownBars),
    shortCooldownBars: asSafeNumber(state?.shortCooldownBars),
    lastTradeDirection: state?.lastTradeDirection || null,
    cooldownLastCandleTime: state?.cooldownLastCandleTime ?? null,
    performanceMap: state?.performanceMap || {},
    coarsePerformanceMap: state?.coarsePerformanceMap || {},
  };
}

function createId(prefix = "sim") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeConfidence(value) {
  return String(value || "").trim().toUpperCase();
}

function getSizingMultiplier(decisionType) {
  if (decisionType === "PROBE_ENTRY_D") return 0.2;
  if (decisionType === "MISSED_MOVE_ENTRY") return 0.3;
  if (decisionType === "FALLBACK_ENTRY" || decisionType === "OPPORTUNITY_ENTRY") return 0.4;
  return 1;
}

function getPnl(side, entryPrice, exitPrice, quantity) {
  if (side === "SHORT") return (entryPrice - exitPrice) * quantity;
  return (exitPrice - entryPrice) * quantity;
}

function getUnrealizedPnl(position, markPrice) {
  return getPnl(position.side, position.entryPrice, markPrice, position.quantity);
}

function resolveDecisionType(decision, confirmationResult) {
  return (
    confirmationResult?.decisionType ||
    decision?.decisionType ||
    decision?.executionPlan?.decisionType ||
    "UNKNOWN"
  );
}

function resolvePendingType(decisionType, decision) {
  const entryTiming = String(decision?.entryTiming || "").toUpperCase();
  const setupType = String(decision?.setupType || decision?.executionPlan?.setupType || "").toLowerCase();
  if (decisionType === "WAIT_PULLBACK" || entryTiming === "WAIT_PULLBACK" || setupType === "pullback") return "PULLBACK_ENTRY";
  if (decisionType === "WAIT_BREAKOUT" || entryTiming === "WAIT_BREAKOUT" || setupType === "breakout") return "BREAKOUT_ENTRY";
  return decisionType || "UNKNOWN";
}

function resolveRsiZone(rsiValue) {
  const rsi = normalizeNumber(rsiValue);
  if (!Number.isFinite(rsi)) return "NEUTRAL";
  if (rsi >= 60) return "RSI_HIGH";
  if (rsi <= 40) return "RSI_LOW";
  return "NEUTRAL";
}

function resolveNearLevelFlag(price, low, high) {
  const referencePrice = normalizeNumber(price);
  const lowValue = normalizeNumber(low);
  const highValue = normalizeNumber(high);
  if (!Number.isFinite(referencePrice) || (!Number.isFinite(lowValue) && !Number.isFinite(highValue))) return false;
  const nearestDistance = Number.isFinite(lowValue) && Number.isFinite(highValue)
    ? Math.min(Math.abs(referencePrice - lowValue), Math.abs(referencePrice - highValue))
    : Number.isFinite(lowValue)
      ? Math.abs(referencePrice - lowValue)
      : Math.abs(referencePrice - highValue);
  const tolerance = Math.abs(referencePrice) * 0.005;
  return nearestDistance <= Math.max(tolerance, 1e-8);
}

function buildSetupContext({ decision, confirmationResult, signalContext = {}, side }) {
  const decisionType = resolveDecisionType(decision, confirmationResult);
  const scoring = confirmationResult?.scoring || decision?.scoring || {};
  const triggerPrice = normalizeNumber(decision?.executionPlan?.triggerPrice ?? decision?.triggerPrice ?? signalContext?.candleClose);
  const structure = signalContext?.structure ?? decision?.structure ?? decision?.executionPlan?.structure ?? {};
  return {
    marketRegime: decision?.marketRegimeLabel || decision?.regime || signalContext?.marketRegime || "UNKNOWN",
    direction: side || resolveSideFromDecision(decision) || "UNKNOWN",
    decisionType,
    pendingType: resolvePendingType(decisionType, decision),
    hasKlineConfirmation: Boolean(signalContext?.hasKlineConfirmation ?? signalContext?.klineConfirmed),
    rsiZone: resolveRsiZone(signalContext?.rsi ?? decision?.rsi),
    isNearSupport: resolveNearLevelFlag(triggerPrice, structure?.supportLow, structure?.supportHigh),
    isNearResistance: resolveNearLevelFlag(triggerPrice, structure?.resistanceLow, structure?.resistanceHigh),
    scoreGrade: scoring?.scoreGrade || null,
    confidenceLevel: scoring?.confidenceLevel || null,
  };
}

function buildSetupKey(setupContext = {}) {
  const safe = (value) => String(value == null ? "UNKNOWN" : value).toUpperCase();
  return [
    safe(setupContext.marketRegime),
    safe(setupContext.direction),
    safe(setupContext.decisionType),
    safe(setupContext.pendingType),
    safe(setupContext.hasKlineConfirmation ? "KLINE_TRUE" : "KLINE_FALSE"),
    safe(setupContext.rsiZone),
    safe(setupContext.isNearSupport ? "NEAR_SUPPORT_TRUE" : "NEAR_SUPPORT_FALSE"),
    safe(setupContext.isNearResistance ? "NEAR_RESISTANCE_TRUE" : "NEAR_RESISTANCE_FALSE"),
    safe(setupContext.scoreGrade),
    safe(setupContext.confidenceLevel),
  ].join("|");
}

function buildCoarseSetupKey(setupContext = {}) {
  const safe = (value) => String(value == null ? "UNKNOWN" : value).toUpperCase();
  return [
    safe(setupContext.marketRegime),
    safe(setupContext.direction),
    safe(setupContext.hasKlineConfirmation ? "KLINE_TRUE" : "KLINE_FALSE"),
    safe(setupContext.rsiZone),
  ].join("|");
}

function createEmptyPerformanceStat(setupContext = {}) {
  return {
    setupContext,
    totalTrades: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    avgPnl: 0,
    totalPnl: 0,
  };
}

function buildPerformanceMap(closedTrades = [], keyResolver = (setupContext) => buildSetupKey(setupContext)) {
  const map = {};
  for (const trade of closedTrades) {
    const setupContext = trade?.setupContext || {};
    const setupKey = keyResolver(setupContext, trade);
    if (!map[setupKey]) {
      map[setupKey] = createEmptyPerformanceStat(setupContext);
    }
    const pnl = asSafeNumber(trade?.realizedPnl);
    map[setupKey].totalTrades += 1;
    if (pnl > 0) map[setupKey].wins += 1;
    else map[setupKey].losses += 1;
    map[setupKey].totalPnl += pnl;
  }
  Object.values(map).forEach((item) => {
    item.winRate = item.totalTrades ? (item.wins / item.totalTrades) * 100 : 0;
    item.avgPnl = item.totalTrades ? item.totalPnl / item.totalTrades : 0;
  });
  return map;
}

function buildPerformanceSnapshot(closedTrades = [], keyResolver, recentWindow = RECENT_PERFORMANCE_WINDOW) {
  const recentTrades = closedTrades.slice(0, recentWindow);
  return {
    recentMap: buildPerformanceMap(recentTrades, keyResolver),
    allTimeMap: buildPerformanceMap(closedTrades, keyResolver),
  };
}

function resolvePerformanceCandidate(map, key, source) {
  const stats = map?.[key] || createEmptyPerformanceStat();
  return { source, stats };
}

function isUnderperforming(stats) {
  return (
    stats.totalTrades >= PERFORMANCE_MIN_SAMPLE_SIZE &&
    stats.winRate < 40 &&
    stats.avgPnl < 0
  );
}

function resolveTradeMetadata({ decision, confirmationResult, signalContext = {}, side }) {
  const setupContext = buildSetupContext({ decision, confirmationResult, signalContext, side });
  const setupKey = buildSetupKey(setupContext);
  const scoring = confirmationResult?.scoring || decision?.scoring || {};
  return {
    decisionType: setupContext.decisionType,
    pendingType: setupContext.pendingType,
    setupContext,
    setupKey,
    coarseSetupKey: buildCoarseSetupKey(setupContext),
    scoreGrade: scoring?.scoreGrade || null,
    totalScore: normalizeNumber(scoring?.totalScore),
    regime: decision?.marketRegimeLabel || decision?.regime || null,
    confirmationState: confirmationResult?.canExecute ? "CONFIRMED" : "WAITING_CONFIRMATION",
    entryReasonDetail: decision?.entryReason || decision?.summary || null,
  };
}

function isDuplicateContext(state, symbol, timeframe, contextKey) {
  const hasOpen = state.openPositions.some(
    (position) =>
      position.symbol === symbol &&
      position.timeframe === timeframe &&
      position.decisionContextKey === contextKey &&
      position.status === "OPEN"
  );

  const hasPending = state.pendingOrders.some(
    (order) =>
      order.symbol === symbol &&
      order.timeframe === timeframe &&
      order.decisionContextKey === contextKey &&
      order.status === "PENDING"
  );

  return hasOpen || hasPending;
}

function isTrapBlockingEntry(decision, side) {
  const trap = decision?.trapDetection;
  if (!trap || trap.trapSignal === "NONE") return false;
  const trapConfidence = normalizeConfidence(trap.trapConfidence);
  if (!TRAP_BLOCK_CONFIDENCE.has(trapConfidence)) return false;
  if (side === "LONG" && trap.trapSignal === "BULL_TRAP") return true;
  if (side === "SHORT" && trap.trapSignal === "BEAR_TRAP") return true;
  return false;
}

function buildDecisionContextKey(decision, symbol, timeframe) {
  const action = decision?.action || "HOLD";
  const trigger = decision?.executionPlan?.triggerPrice ?? decision?.triggerPrice ?? "none";
  const invalidation = decision?.executionPlan?.invalidationPrice ?? decision?.invalidationPrice ?? "none";
  const summary = decision?.summary || "";
  return [symbol, timeframe, action, trigger, invalidation, summary].join("|");
}

function resolveSideFromDecision(decision) {
  const action = String(decision?.action ?? decision?.executionPlan?.action ?? "").toUpperCase();
  if (action === "LONG" || action === "BUY") return "LONG";
  if (action === "SHORT" || action === "SELL") return "SHORT";
  const preferredSide = String(
    decision?.executionPlan?.preferredSide ??
      decision?.preferredSide ??
      decision?.biasSide ??
      ""
  ).toUpperCase();
  if (preferredSide === "LONG") return "LONG";
  if (preferredSide === "SHORT") return "SHORT";
  return null;
}

function shouldBypassSetupGate(options = {}) {
  const executionSource = String(options?.executionSource || "").toLowerCase();
  return executionSource === "simulation_manual";
}

function buildConfirmationPayload(decision, currentPrice, signalContext = {}) {
  return {
    aiDecisionOutput: decision,
    currentPrice,
    indicators: {
      rsi: signalContext?.rsi,
      macd: signalContext?.macd,
      macdHistogram: signalContext?.macdHistogram,
      currentVolume: signalContext?.currentVolume,
      avgVolume20: signalContext?.avgVolume20,
      candleClose: signalContext?.candleClose,
      close: signalContext?.candleClose,
      klineConfirmed: signalContext?.klineConfirmed,
      breakoutConfirmed: signalContext?.breakoutConfirmed,
      volumeConfirmed: signalContext?.volumeConfirmed,
      marketRegime: signalContext?.marketRegime ?? decision?.marketRegimeLabel ?? decision?.regime,
      breakoutState: signalContext?.breakoutState ?? decision?.breakoutState,
      trendScore: signalContext?.trendScore ?? decision?.trendScore ?? signalContext?.mtf?.score,
      noTradeBars: signalContext?.noTradeBars,
      forceProbeEntry: signalContext?.forceProbeEntry,
      cooldownActiveForSide: signalContext?.cooldownActiveForSide,
    },
    structure: signalContext?.structure ?? decision?.structure ?? decision?.executionPlan?.structure ?? {},
    mtf: signalContext?.mtf ?? decision?.mtf ?? decision?.multiTimeframe ?? {},
  };
}

function resolveManualSimulationSide(decision) {
  const directionalHints = [
    decision?.action,
    decision?.executionPlan?.action,
    decision?.executionPlan?.preferredSide,
    decision?.preferredSide,
    decision?.biasSide,
    decision?.marketBias,
    decision?.trendBias,
  ]
    .map((value) => String(value || "").toUpperCase())
    .filter(Boolean);

  for (const hint of directionalHints) {
    if (hint === "LONG" || hint === "BUY" || hint === "BULLISH") return "LONG";
    if (hint === "SHORT" || hint === "SELL" || hint === "BEARISH") return "SHORT";
  }
  return "LONG";
}

function resolveEntryMode(decision) {
  const setupType = String(decision?.setupType ?? decision?.executionPlan?.setupType ?? "").toLowerCase();
  if (setupType === "breakout") return "breakout";
  if (setupType === "pullback") return "pullback";
  return "breakout";
}

function resolvePlannedEntryPrice(decision, side) {
  const mode = resolveEntryMode(decision);
  const triggerPrice = normalizeNumber(decision?.executionPlan?.triggerPrice ?? decision?.triggerPrice);
  if (mode === "pullback") {
    const entryMid = normalizeNumber(decision?.executionPlan?.entryMid ?? decision?.entryMid);
    const entryLow = normalizeNumber(decision?.executionPlan?.entryLow ?? decision?.entryLow);
    const entryHigh = normalizeNumber(decision?.executionPlan?.entryHigh ?? decision?.entryHigh);
    if (Number.isFinite(entryMid)) return { entryPrice: entryMid, mode };
    if (side === "LONG" && Number.isFinite(entryLow)) return { entryPrice: entryLow, mode };
    if (side === "SHORT" && Number.isFinite(entryHigh)) return { entryPrice: entryHigh, mode };
  }
  return { entryPrice: triggerPrice, mode };
}

function applyEntryDistanceConstraint({ side, entryPrice, currentPrice, atr, marketRegime }) {
  if (!Number.isFinite(entryPrice) || !Number.isFinite(currentPrice)) {
    return { entryPrice, wasAdjusted: false, distance: undefined, isRejected: false };
  }
  const atrValue = normalizeNumber(atr);
  const distance = Math.abs(entryPrice - currentPrice);
  if (side === "SHORT") {
    if (entryPrice > currentPrice) {
      return { entryPrice, wasAdjusted: false, distance, isRejected: false, mode: "pullback_short" };
    }
    if (!Number.isFinite(atrValue) || atrValue <= 0) {
      return { entryPrice, wasAdjusted: false, distance, isRejected: true, rejectionReason: "SHORT_BREAKDOWN_ATR_REQUIRED" };
    }
    if (distance <= atrValue * DEFAULT_SHORT_BREAKDOWN_ATR_RATIO) {
      return { entryPrice, wasAdjusted: false, distance, isRejected: false, mode: "breakdown_short" };
    }
    return { entryPrice, wasAdjusted: false, distance, isRejected: true, rejectionReason: "SHORT_ENTRY_UNREALISTIC" };
  }
  const normalizedRegime = String(marketRegime || "").toUpperCase();
  const isRangeRegime = normalizedRegime === "RANGE" || normalizedRegime === "RANGING";
  const isTrendRegime = normalizedRegime === "TREND" || normalizedRegime === "TRENDING";
  if (!Number.isFinite(atrValue) || atrValue <= 0) {
    return { entryPrice, wasAdjusted: false, distance, isRejected: false };
  }
  const distanceThresholdAtr = isTrendRegime ? 0.6 : 0.5;
  if (distance <= atrValue * distanceThresholdAtr) {
    return { entryPrice, wasAdjusted: false, distance, isRejected: false };
  }
  if (isRangeRegime) {
    return { entryPrice, wasAdjusted: false, distance, isRejected: true, rejectionReason: "ENTRY_TOO_FAR_IN_RANGE" };
  }
  const direction = side === "SHORT" ? -1 : 1;
  const tightenedByAtr = currentPrice + direction * atrValue * 0.2;
  const clampPct = isTrendRegime ? DEFAULT_TREND_ENTRY_CLAMP_PCT : DEFAULT_RANGE_ENTRY_CLAMP_PCT;
  const clampByPct = currentPrice * (1 + direction * clampPct);
  const adjustedEntry = side === "SHORT"
    ? Math.max(Math.min(entryPrice, tightenedByAtr), clampByPct)
    : Math.min(Math.max(entryPrice, tightenedByAtr), clampByPct);
  return {
    entryPrice: adjustedEntry,
    wasAdjusted: adjustedEntry !== entryPrice,
    distance,
    isRejected: false,
  };
}

function isDecisionContextStale(decision) {
  const generatedAt = decision?.generatedAt ?? decision?.timestamp ?? decision?.decisionAt;
  if (!generatedAt) return false;
  const parsed = new Date(generatedAt).getTime();
  if (!Number.isFinite(parsed)) return false;
  return Date.now() - parsed > DECISION_STALE_MS;
}

function evaluateImmediateExecutionReadiness({ decision, side, triggerPrice, markPrice, signalContext = {} }) {
  const triggerHit = Number.isFinite(markPrice)
    ? (side === "LONG" ? markPrice >= triggerPrice : markPrice <= triggerPrice)
    : false;
  const rsi = normalizeNumber(signalContext?.rsi);
  const macdHistogram = normalizeNumber(signalContext?.macdHistogram ?? signalContext?.macd?.histogram);
  const currentVolume = normalizeNumber(signalContext?.currentVolume);
  const avgVolume20 = normalizeNumber(signalContext?.avgVolume20);
  const rsiThreshold = side === "SHORT" ? 45 : 55;
  const rsiConfirmed = !Number.isFinite(rsi) || (side === "SHORT" ? rsi <= rsiThreshold : rsi >= rsiThreshold);
  const volumeThreshold = Number.isFinite(avgVolume20) && avgVolume20 > 0 ? avgVolume20 * 1.2 : null;
  const volumeConfirmed =
    !Number.isFinite(volumeThreshold) || !Number.isFinite(currentVolume) ? true : currentVolume >= volumeThreshold;
  const macdConfirmed =
    !Number.isFinite(macdHistogram) || (side === "SHORT" ? macdHistogram < 0 : macdHistogram > 0);

  const unmetConditions = [];
  if (!triggerHit) unmetConditions.push("TRIGGER_NOT_HIT");
  if (!rsiConfirmed) unmetConditions.push("RSI_NOT_CONFIRMED");
  if (!volumeConfirmed) unmetConditions.push("VOLUME_NOT_CONFIRMED");
  if (!macdConfirmed) unmetConditions.push("MACD_NOT_CONFIRMED");

  return {
    readyToExecute: triggerHit && rsiConfirmed && volumeConfirmed && macdConfirmed,
    triggerHit,
    rsiConfirmed,
    volumeConfirmed,
    macdConfirmed,
    unmetConditions,
  };
}

export function getSimulationEligibility(decision, currentPrice, signalContext = {}, options = {}) {
  const bypassSetupGate = shouldBypassSetupGate(options);
  const confirmationResult = runConfirmationEngine(buildConfirmationPayload(decision, currentPrice, signalContext));
  const executionIntent = mapDecisionTypeToExecutionIntent(confirmationResult.decisionType, confirmationResult);
  if (!decision) {
    return {
      eligibility: bypassSetupGate ? "WATCH_ONLY" : "BLOCKED",
      reasonCode: "NO_DECISION",
      reason: bypassSetupGate ? "尚未產生可執行決策，已轉為觀察模式" : "尚未產生可執行決策",
      executionIntent: "WATCH_ONLY",
      confirmationResult,
    };
  }

  const side = resolveSideFromDecision(decision);
  const triggerPrice = normalizeNumber(decision?.executionPlan?.triggerPrice ?? decision?.triggerPrice);
  const invalidationPrice = normalizeNumber(decision?.executionPlan?.invalidationPrice ?? decision?.invalidationPrice);
  const markPrice = normalizeNumber(currentPrice);

  if (bypassSetupGate) {
    const manualResult = {
      eligibility:
        executionIntent === "EXECUTE_NOW"
          ? "READY_TO_EXECUTE"
          : executionIntent === "PLACE_PENDING"
            ? "READY_TO_PLACE_PENDING"
            : executionIntent,
      reasonCode: "SIMULATION_MANUAL_ROUTED",
      reason: "手動模擬：永不阻擋，僅調整為立即 / 掛單 / 觀察流程",
      executionIntent,
      confirmationResult,
      bypassSetupGate: true,
      bypassedMissingSide: !side,
    };
    console.debug("[paper-engine:getSimulationEligibility]", {
      executionSource: options?.executionSource || null,
      orderMode: options?.orderMode || null,
      bypassSetupGate,
      sideDetected: side || null,
      result: manualResult,
    });
    return manualResult;
  }

  if (!side) {
    return { eligibility: "BLOCKED", reasonCode: "SKIP_NO_ACTIONABLE_SIDE", reason: "缺少可執行方向" };
  }
  if (!Number.isFinite(triggerPrice) && !bypassSetupGate) {
    return { eligibility: "BLOCKED", reasonCode: "MISSING_TRIGGER", reason: "缺少觸發價格，無法建立掛單" };
  }
  if (!Number.isFinite(invalidationPrice) && !bypassSetupGate) {
    return { eligibility: "BLOCKED", reasonCode: "MISSING_INVALIDATION", reason: "缺少失效價格，無法定義風險" };
  }
  if (isTrapBlockingEntry(decision, side) && !bypassSetupGate) {
    return { eligibility: "BLOCKED", reasonCode: "BLOCKED_BY_TRAP", reason: "誘多 / 誘空風險阻擋執行" };
  }

  if (Number.isFinite(markPrice) && !bypassSetupGate) {
    const invalidForLong = side === "LONG" && markPrice <= invalidationPrice;
    const invalidForShort = side === "SHORT" && markPrice >= invalidationPrice;
    if (invalidForLong || invalidForShort) {
      return { eligibility: "BLOCKED", reasonCode: "SETUP_ALREADY_INVALIDATED", reason: "策略已失效，不建立掛單" };
    }
  }

  const executionReadiness = evaluateImmediateExecutionReadiness({
    decision,
    side,
    triggerPrice,
    markPrice,
    signalContext,
  });
  if (executionReadiness.readyToExecute) {
    return {
      eligibility: "READY_TO_EXECUTE",
      reasonCode: "TRIGGER_READY",
      reason: "觸發與確認條件皆成立，可立即進場",
      executionIntent: "EXECUTE_NOW",
      confirmationResult,
      executionReadiness,
    };
  }

  return {
    eligibility: executionIntent === "EXECUTE_NOW" ? "READY_TO_PLACE_PENDING" : executionIntent,
    reasonCode: "WAITING_CONFIRMATION",
    reason: "已建立條件掛單，等待條件成立後進場",
    executionIntent: executionIntent === "EXECUTE_NOW" ? "PLACE_PENDING" : executionIntent,
    confirmationResult,
    executionReadiness,
  };
}

function normalizeDirectionalLevels({ side, referencePrice, stopLoss, takeProfit1, takeProfit2, takeProfit3 }) {
  const entry = normalizeNumber(referencePrice);
  const normalizedStopLoss = normalizeNumber(stopLoss);
  const normalizedTp1 = normalizeNumber(takeProfit1);
  const normalizedTp2 = normalizeNumber(takeProfit2);
  const normalizedTp3 = normalizeNumber(takeProfit3);

  if (!side || !Number.isFinite(entry)) {
    return {
      stopLoss: normalizedStopLoss,
      takeProfit1: normalizedTp1,
      takeProfit2: normalizedTp2,
      takeProfit3: normalizedTp3,
    };
  }

  const isValidStop = (value) => (
    side === "LONG"
      ? Number.isFinite(value) && value < entry
      : Number.isFinite(value) && value > entry
  );

  const isValidTakeProfit = (value) => (
    side === "LONG"
      ? Number.isFinite(value) && value > entry
      : Number.isFinite(value) && value < entry
  );

  const sortedTakeProfits = [normalizedTp1, normalizedTp2, normalizedTp3]
    .filter((value) => isValidTakeProfit(value))
    .sort((a, b) => (side === "LONG" ? a - b : b - a));

  return {
    stopLoss: isValidStop(normalizedStopLoss) ? normalizedStopLoss : undefined,
    takeProfit1: sortedTakeProfits[0],
    takeProfit2: sortedTakeProfits[1],
    takeProfit3: sortedTakeProfits[2],
  };
}

export function createInitialPaperAccountState() {
  return {
    balance: DEFAULT_BALANCE,
    equity: DEFAULT_BALANCE,
    usedMargin: 0,
    realizedPnl: 0,
    unrealizedPnl: 0,
    openPositions: [],
    pendingOrders: [],
    cancelledOrders: [],
    closedTrades: [],
    longLossStreak: 0,
    shortLossStreak: 0,
    longCooldownBars: 0,
    shortCooldownBars: 0,
    lastTradeDirection: null,
    cooldownLastCandleTime: null,
    simulationOrderConfig: {
      mode: "fixed_quantity",
      quantity: DEFAULT_POSITION_SIZE,
    },
    symbolIsolationState: {},
    performanceMap: {},
    coarsePerformanceMap: {},
    reentryGuards: [],
    reentryTracking: {},
    orderLifecycleEvents: [],
    lifecycleTrace: [],
    pendingFillChecks: [],
    pendingCancelTrace: [],
    waitingDiagnostics: createDefaultWaitingDiagnostics(),
    accountTrace: [],
    accountErrorTrace: [],
    cash: DEFAULT_BALANCE,
    marginUsed: 0,
    positionValue: 0,
    totalAccountValue: DEFAULT_BALANCE,
    netWorth: DEFAULT_BALANCE,
  };
}

function appendOrderLifecycleEvent(state, event) {
  const normalizedEvent = {
    timestamp: event?.timestamp || nowIso(),
    symbol: event?.symbol || null,
    entityType: "ORDER",
    entityId: event?.orderId || event?.entityId || null,
    eventType: event?.eventType || "UPDATED",
    reason: event?.reason || null,
    triggeredBy: event?.triggeredBy || "RECONCILE",
    selectedSymbolAtThatMoment: event?.selectedSymbolAtThatMoment ?? null,
    marketSymbolUsed: event?.marketSymbolUsed || event?.symbol || null,
    orderId: event?.orderId || event?.entityId || null,
    currentTickPrice: normalizeNumber(event?.currentTickPrice),
    candleHigh: normalizeNumber(event?.candleHigh),
    candleLow: normalizeNumber(event?.candleLow),
    entryPrice: normalizeNumber(event?.entryPrice),
    checkedFunctionName: event?.checkedFunctionName || null,
  };
  const nextEvents = [normalizedEvent, ...(state?.orderLifecycleEvents || [])].slice(0, 300);
  const nextTrace = [normalizedEvent, ...(state?.lifecycleTrace || [])].slice(0, 1000);
  return {
    ...state,
    orderLifecycleEvents: nextEvents,
    lifecycleTrace: nextTrace,
  };
}

function appendPendingCancelTrace(state, payload) {
  const trace = {
    timestamp: payload?.timestamp || nowIso(),
    orderId: payload?.orderId || null,
    orderSymbol: payload?.orderSymbol || null,
    selectedSymbolAtThatMoment: payload?.selectedSymbolAtThatMoment ?? null,
    marketSymbolUsed: payload?.marketSymbolUsed || null,
    eventType: "CANCELED",
    reason: payload?.reason || null,
    triggeredBy: payload?.triggeredBy || null,
    currentTickPrice: normalizeNumber(payload?.currentTickPrice),
    candleHigh: normalizeNumber(payload?.candleHigh),
    candleLow: normalizeNumber(payload?.candleLow),
    entryPrice: normalizeNumber(payload?.entryPrice),
    checkedFunctionName: payload?.checkedFunctionName || null,
  };
  console.debug("[paper-trading] pending order canceled", trace);
  return {
    ...state,
    pendingCancelTrace: [trace, ...(state?.pendingCancelTrace || [])].slice(0, 1000),
  };
}

function shouldBlockPendingCancellation(triggeredBy) {
  return !ALLOWED_PENDING_CANCEL_TRIGGERS.has(String(triggeredBy || ""));
}

function appendPositionLifecycleEvent(state, event) {
  const normalizedEvent = {
    timestamp: event?.timestamp || nowIso(),
    symbol: event?.symbol || null,
    entityType: "POSITION",
    entityId: event?.positionId || event?.entityId || null,
    eventType: event?.eventType || "UPDATED",
    reason: event?.reason || null,
    triggeredBy: event?.triggeredBy || "RECONCILE",
    selectedSymbolAtThatMoment: event?.selectedSymbolAtThatMoment ?? null,
    marketSymbolUsed: event?.marketSymbolUsed || event?.symbol || null,
    positionId: event?.positionId || event?.entityId || null,
  };
  return {
    ...state,
    lifecycleTrace: [normalizedEvent, ...(state?.lifecycleTrace || [])].slice(0, 1000),
  };
}

function appendPendingFillCheck(state, payload) {
  return {
    ...state,
    pendingFillChecks: [payload, ...(state?.pendingFillChecks || [])].slice(0, 1000),
  };
}

function appendWaitingDiagnosticEvent(state, event = {}) {
  const diagnostics = state?.waitingDiagnostics || createDefaultWaitingDiagnostics();
  const nextEvent = {
    id: createId("wait"),
    timestamp: event.timestamp || nowIso(),
    ...event,
  };
  return {
    ...state,
    waitingDiagnostics: {
      ...diagnostics,
      recentEvents: [nextEvent, ...(diagnostics.recentEvents || [])].slice(0, 500),
    },
  };
}

function incrementWaitingReason(state, reasonKey, context = {}) {
  if (!reasonKey || !WAITING_REASON_KEYS.includes(reasonKey)) return state;
  const diagnostics = state?.waitingDiagnostics || createDefaultWaitingDiagnostics();
  const nextReasonCounts = {
    ...createEmptyWaitingReasonCounter(),
    ...(diagnostics.reasonCounts || {}),
    [reasonKey]: asSafeNumber(diagnostics?.reasonCounts?.[reasonKey]) + 1,
  };
  return appendWaitingDiagnosticEvent({
    ...state,
    waitingDiagnostics: {
      ...diagnostics,
      reasonCounts: nextReasonCounts,
    },
  }, {
    type: "reason",
    reasonKey,
    ...context,
  });
}

function buildDecisionRevision(decision, timeframe) {
  return [
    timeframe || "-",
    decision?.updatedAt || decision?.timestamp || decision?.signalTime || "-",
    decision?.executionPlan?.triggerPrice ?? decision?.triggerPrice ?? "-",
    decision?.executionPlan?.action ?? decision?.action ?? "-",
  ].join("|");
}

function registerReentryGuard(state, order, reason, timestamp, decision, candleTime) {
  if (reason !== "PRICE_DRIFTED") return state;
  const guard = {
    symbol: order.symbol,
    timeframe: order.timeframe,
    side: order.side,
    triggerPrice: normalizeNumber(order.triggerPrice),
    decisionContextKey: order.decisionContextKey || null,
    decisionRevision: buildDecisionRevision(decision || order?.decisionSnapshot, order.timeframe),
    cancelledAt: timestamp,
    cancelledCandleTime: Number.isFinite(Number(candleTime)) ? Number(candleTime) : null,
  };
  const deduped = (state?.reentryGuards || []).filter((item) => !(
    item.symbol === guard.symbol &&
    item.timeframe === guard.timeframe &&
    item.side === guard.side
  ));
  return {
    ...state,
    reentryGuards: [guard, ...deduped].slice(0, 100),
  };
}

function isReentryBlockedByGuard(state, {
  symbol, timeframe, side, triggerPrice, decisionContextKey, decisionRevision, atr, candleTime,
}) {
  const currentCandleTime = Number(candleTime);
  return (state?.reentryGuards || []).some((guard) => {
    if (guard.symbol !== symbol || guard.timeframe !== timeframe || guard.side !== side) return false;
    if (Number.isFinite(currentCandleTime) && Number.isFinite(guard.cancelledCandleTime) && currentCandleTime > guard.cancelledCandleTime) {
      return false;
    }
    if (guard.decisionRevision && decisionRevision && guard.decisionRevision !== decisionRevision) return false;
    if (guard.decisionContextKey && decisionContextKey && guard.decisionContextKey !== decisionContextKey) return false;
    const priceTolerance = Math.max(Math.abs(asSafeNumber(triggerPrice)) * 0.001, asSafeNumber(atr) * 0.25, 1e-8);
    return Math.abs(asSafeNumber(triggerPrice) - asSafeNumber(guard.triggerPrice)) <= priceTolerance;
  });
}

function hasMaterialNumberChange(previousValue, nextValue, toleranceRatio = LEVEL_CHANGE_TOLERANCE_RATIO) {
  const prev = normalizeNumber(previousValue);
  const next = normalizeNumber(nextValue);
  if (prev == null && next == null) return false;
  if (prev == null || next == null) return true;
  const baseline = Math.max(Math.abs(prev), Math.abs(next), 1);
  return Math.abs(prev - next) / baseline > toleranceRatio;
}

function cancelPendingOrder(order, reason, timestamp = nowIso(), metadata = {}) {
  return {
    ...order,
    status: "CANCELLED",
    cancelReason: reason,
    cancelledAt: timestamp,
    ...metadata,
  };
}

function deriveAccountMetrics(state) {
  const closedTrades = Array.isArray(state?.closedTrades) ? state.closedTrades : [];
  const openPositions = Array.isArray(state?.openPositions) ? state.openPositions : [];
  const realizedPnl = closedTrades.reduce((sum, trade) => sum + asSafeNumber(trade?.realizedPnl), 0);
  const cash = DEFAULT_BALANCE + realizedPnl;
  const unrealizedPnl = openPositions.reduce((sum, position) => sum + asSafeNumber(position?.unrealizedPnl), 0);
  const marginUsed = openPositions.reduce(
    (sum, position) => sum + asSafeNumber(position?.notional) / Math.max(1, asSafeNumber(position?.leverage, 1)),
    0
  );
  const positionValue = openPositions.reduce(
    (sum, position) => sum + Math.abs(asSafeNumber(position?.currentPrice, position?.entryPrice) * asSafeNumber(position?.quantity)),
    0
  );
  const equity = cash + unrealizedPnl;
  return {
    cash,
    balance: cash,
    realizedPnl,
    unrealizedPnl,
    marginUsed,
    usedMargin: marginUsed,
    positionValue,
    totalAccountValue: equity,
    netWorth: equity,
    equity,
  };
}

function buildAccountTraceEvent(previousState, nextState, payload = {}) {
  const previous = deriveAccountMetrics(previousState || {});
  const next = deriveAccountMetrics(nextState || {});
  const delta = {
    cash: next.cash - previous.cash,
    realizedPnl: next.realizedPnl - previous.realizedPnl,
    unrealizedPnl: next.unrealizedPnl - previous.unrealizedPnl,
    equity: next.equity - previous.equity,
  };
  const surgeDetected = Math.abs(delta.equity) >= ACCOUNT_SURGE_ABS_THRESHOLD &&
    Math.abs(delta.equity) > Math.max(1, Math.abs(previous.equity)) * ACCOUNT_SURGE_RATIO_THRESHOLD;
  const finiteDetected = [next.cash, next.realizedPnl, next.unrealizedPnl, next.equity].every(Number.isFinite);
  const warnings = [];
  if (!finiteDetected) warnings.push("NON_FINITE_ACCOUNT_VALUE");
  const largePositionVsEquity = Math.abs(next.positionValue) > Math.max(1, Math.abs(next.equity)) * 30;
  if (largePositionVsEquity) warnings.push("POSITION_VALUE_IMBALANCE");
  if (surgeDetected) warnings.push("ABNORMAL_EQUITY_SURGE");
  return {
    trace: {
      timestamp: payload.timestamp || nowIso(),
      selectedSymbol: payload.selectedSymbol ?? null,
      affectedSymbol: payload.affectedSymbol ?? null,
      eventType: payload.eventType || "STATE_UPDATE",
      sourceFunction: payload.sourceFunction || "unknown",
      cashBefore: previous.cash,
      cashAfter: next.cash,
      realizedPnlBefore: previous.realizedPnl,
      realizedPnlAfter: next.realizedPnl,
      unrealizedPnlBefore: previous.unrealizedPnl,
      unrealizedPnlAfter: next.unrealizedPnl,
      equityBefore: previous.equity,
      equityAfter: next.equity,
      delta,
      warnings,
    },
    warnings,
  };
}

function withAccountTrace(previousState, nextState, payload = {}) {
  const normalizedNextState = {
    ...nextState,
    accountTrace: Array.isArray(nextState?.accountTrace) ? nextState.accountTrace : [],
    accountErrorTrace: Array.isArray(nextState?.accountErrorTrace) ? nextState.accountErrorTrace : [],
  };
  const { trace, warnings } = buildAccountTraceEvent(previousState, normalizedNextState, payload);
  const nextTrace = [trace, ...normalizedNextState.accountTrace].slice(0, MAX_ACCOUNT_TRACE_HISTORY);
  const nextErrorTrace = warnings.length
    ? [trace, ...normalizedNextState.accountErrorTrace].slice(0, MAX_ACCOUNT_ERROR_TRACE_HISTORY)
    : normalizedNextState.accountErrorTrace;
  return {
    ...normalizedNextState,
    accountTrace: nextTrace,
    accountErrorTrace: nextErrorTrace,
  };
}

function recalculateAccountState(state, tracePayload = null) {
  const metrics = deriveAccountMetrics(state);
  const nextState = {
    ...state,
    ...metrics,
  };
  if (!tracePayload) return nextState;
  return withAccountTrace(state, nextState, tracePayload);
}

function closePosition(state, {
  positionId,
  exitPrice,
  closeReason,
  closedAt = nowIso(),
  triggeredBy = "RECONCILE",
  selectedSymbolAtThatMoment = null,
  marketSymbolUsed = null,
}) {
  const index = state.openPositions.findIndex((item) => item.id === positionId);
  if (index < 0) return state;

  const position = state.openPositions[index];
  const resolvedExitPrice = asSafeNumber(exitPrice, position.currentPrice);
  const realizedPnl = getPnl(position.side, position.entryPrice, resolvedExitPrice, position.quantity);
  const pnlPercent = position.entryPrice ? (realizedPnl / (position.entryPrice * position.quantity)) * 100 : 0;

  const closedTrade = {
    id: createId("closed"),
    symbol: position.symbol,
    timeframe: position.timeframe,
    side: position.side,
    entryPrice: position.entryPrice,
    exitPrice: resolvedExitPrice,
    quantity: position.quantity,
    openedAt: position.openedAt,
    closedAt,
    realizedPnl,
    pnlPercent,
    closeReason,
    entryReason: position.entryReason,
    stopLoss: position.stopLoss,
    takeProfit1: position.takeProfit1,
    createdAt: position.createdAt || position.openedAt,
    enteredAt: position.openedAt,
    decisionType: position.decisionType || null,
    pendingType: position.pendingType || null,
    scoreGrade: position.scoreGrade || null,
    totalScore: position.totalScore ?? null,
    regime: position.regime || null,
    confirmationState: position.confirmationState || null,
    entryReasonDetail: position.entryReasonDetail || null,
    isReentryAttempt: Boolean(position.isReentryAttempt),
    reentryCount: position.reentryCount ?? 0,
    reentryReason: position.reentryReason ?? null,
    reentryAdjustedEntry: Boolean(position.reentryAdjustedEntry),
    exitReasonDetail: closeReason,
    maxFavorableExcursion: position.maxFavorableExcursion ?? 0,
    maxAdverseExcursion: position.maxAdverseExcursion ?? 0,
    setupContext: position.setupContext || null,
    setupKey: position.setupKey || null,
  };

  const nextOpen = state.openPositions.filter((item) => item.id !== positionId);
  const symbol = position.symbol;
  const symbolState = getSymbolIsolationState(state, symbol);
  const symbolClosedTrades = [closedTrade, ...state.closedTrades].filter((trade) => trade?.symbol === symbol);
  const isLosingTrade = realizedPnl < 0;
  const isWinningTrade = realizedPnl > 0;
  const nextLongLossStreak = position.side === "LONG"
    ? isLosingTrade
      ? asSafeNumber(symbolState.longLossStreak) + 1
      : isWinningTrade
        ? 0
        : asSafeNumber(symbolState.longLossStreak)
    : asSafeNumber(symbolState.longLossStreak);
  const nextShortLossStreak = position.side === "SHORT"
    ? isLosingTrade
      ? asSafeNumber(symbolState.shortLossStreak) + 1
      : isWinningTrade
        ? 0
        : asSafeNumber(symbolState.shortLossStreak)
    : asSafeNumber(symbolState.shortLossStreak);
  const triggerLongCooldown = position.side === "LONG" && nextLongLossStreak >= DIRECTIONAL_LOSS_STREAK_THRESHOLD;
  const triggerShortCooldown = position.side === "SHORT" && nextShortLossStreak >= DIRECTIONAL_LOSS_STREAK_THRESHOLD;
  const nextSymbolIsolationState = {
    ...(state.symbolIsolationState || {}),
    [symbol]: {
      ...symbolState,
      longLossStreak: nextLongLossStreak,
      shortLossStreak: nextShortLossStreak,
      longCooldownBars: triggerLongCooldown ? DIRECTIONAL_COOLDOWN_BARS : asSafeNumber(symbolState.longCooldownBars),
      shortCooldownBars: triggerShortCooldown ? DIRECTIONAL_COOLDOWN_BARS : asSafeNumber(symbolState.shortCooldownBars),
      lastTradeDirection: position.side || null,
      performanceMap: buildPerformanceMap(symbolClosedTrades, (setupContext, trade) => trade?.setupKey || buildSetupKey(setupContext)),
      coarsePerformanceMap: buildPerformanceMap(symbolClosedTrades, (setupContext, trade) => trade?.coarseSetupKey || buildCoarseSetupKey(setupContext)),
    },
  };
  const recalculated = recalculateAccountState({
    ...state,
    openPositions: nextOpen,
    closedTrades: [closedTrade, ...state.closedTrades],
    longLossStreak: nextLongLossStreak,
    shortLossStreak: nextShortLossStreak,
    longCooldownBars: triggerLongCooldown ? DIRECTIONAL_COOLDOWN_BARS : asSafeNumber(symbolState.longCooldownBars),
    shortCooldownBars: triggerShortCooldown ? DIRECTIONAL_COOLDOWN_BARS : asSafeNumber(symbolState.shortCooldownBars),
    lastTradeDirection: position.side || null,
    symbolIsolationState: nextSymbolIsolationState,
    performanceMap: nextSymbolIsolationState[symbol].performanceMap,
    coarsePerformanceMap: nextSymbolIsolationState[symbol].coarsePerformanceMap,
  }, {
    timestamp: closedAt,
    selectedSymbol: selectedSymbolAtThatMoment,
    affectedSymbol: symbol,
    eventType: "CLOSE_POSITION",
    sourceFunction: "closePosition",
  });
  return appendPositionLifecycleEvent(recalculated, {
    timestamp: closedAt,
    symbol,
    positionId: position.id,
    eventType: "CLOSED",
    reason: closeReason,
    triggeredBy,
    selectedSymbolAtThatMoment,
    marketSymbolUsed: marketSymbolUsed || symbol,
  });
}

function maybeAdjustPositionRisk(position, tickPrice) {
  const entry = normalizeNumber(position.entryPrice);
  const tp1 = normalizeNumber(position.takeProfit1);
  if (!Number.isFinite(entry) || !Number.isFinite(tp1) || !Number.isFinite(tickPrice)) return position;
  const movedTowardsTarget = position.side === "LONG" ? tickPrice > entry : tickPrice < entry;
  if (!movedTowardsTarget) return position;
  const progress = Math.abs(tickPrice - entry) / Math.max(Math.abs(tp1 - entry), 1e-8);
  if (progress >= 0.5 && !position.breakEvenMoved) {
    return {
      ...position,
      stopLoss: entry,
      breakEvenMoved: true,
      lastRiskAction: "MOVE_STOP_TO_BREAKEVEN",
    };
  }
  return position;
}

function evaluatePendingOrderFill(order, {
  tickPrice,
  candleHigh,
  candleLow,
}) {
  const triggerPrice = asSafeNumber(order.triggerPrice);
  if (!Number.isFinite(triggerPrice)) {
    return { shouldFill: false, reason: null };
  }

  const hasTick = Number.isFinite(tickPrice);
  const hasLow = Number.isFinite(candleLow);
  const hasHigh = Number.isFinite(candleHigh);

  const resolveFillReason = (pricePoint) => {
    if (!Number.isFinite(pricePoint)) return "PRICE_CROSSED";
    return pricePoint === triggerPrice ? "PRICE_TOUCHED" : "PRICE_CROSSED";
  };

  // Tick crossing.
  if (order.side === "LONG" && tickPrice <= triggerPrice) {
    return { shouldFill: true, reason: resolveFillReason(tickPrice) };
  }
  if (order.side === "SHORT" && tickPrice >= triggerPrice) {
    return { shouldFill: true, reason: resolveFillReason(tickPrice) };
  }

  // Candle crossing.
  if (order.side === "LONG" && hasLow && candleLow <= triggerPrice) {
    return { shouldFill: true, reason: resolveFillReason(candleLow) };
  }
  if (order.side === "SHORT" && hasHigh && candleHigh >= triggerPrice) {
    return { shouldFill: true, reason: resolveFillReason(candleHigh) };
  }

  if (!hasTick && !hasLow && !hasHigh) {
    return { shouldFill: false, reason: "NO_MARKET_DATA" };
  }
  return { shouldFill: false, reason: null };
}

function hasActiveTrapSignal(decisionSnapshot) {
  const trapSignal = String(decisionSnapshot?.trapDetection?.trapSignal || "").toUpperCase();
  return trapSignal && trapSignal !== "NONE";
}

function resolveMacdValue(value) {
  if (Number.isFinite(value)) return value;
  if (value && typeof value === "object") {
    const candidates = [value.histogram, value.macd, value.value];
    for (const candidate of candidates) {
      if (Number.isFinite(candidate)) return candidate;
    }
  }
  return undefined;
}

function getCooldownStateForSide(state, side, symbol) {
  const symbolState = getSymbolIsolationState(state, symbol);
  const longCooldownBars = Math.max(0, asSafeNumber(symbolState?.longCooldownBars));
  const shortCooldownBars = Math.max(0, asSafeNumber(symbolState?.shortCooldownBars));
  const longLossStreak = Math.max(0, asSafeNumber(symbolState?.longLossStreak));
  const shortLossStreak = Math.max(0, asSafeNumber(symbolState?.shortLossStreak));
  const sideCooldownBarsLeft = side === "SHORT" ? shortCooldownBars : longCooldownBars;
  return {
    lastTradeDirection: symbolState?.lastTradeDirection || null,
    longLossStreak,
    shortLossStreak,
    longCooldownBars,
    shortCooldownBars,
    cooldownActive: sideCooldownBarsLeft > 0,
    cooldownBarsLeft: sideCooldownBarsLeft,
  };
}

function isPreEntryInvalidated(order, tickPrice) {
  if (order.invalidationPrice == null) return false;
  const invalidation = asSafeNumber(order.invalidationPrice);
  if (!Number.isFinite(invalidation) || !Number.isFinite(tickPrice)) return false;
  if (order.side === "LONG") return tickPrice <= invalidation;
  return tickPrice >= invalidation;
}

function resolveExpiryTimestamp(decision, createdAtIso) {
  const createdAt = new Date(createdAtIso).getTime();
  const configuredExpiryMinutes = normalizeNumber(
    decision?.executionPlan?.pendingExpiryMinutes ??
    decision?.executionPlan?.expiryMinutes ??
    decision?.pendingExpiryMinutes
  );
  const ttlMs = Number.isFinite(configuredExpiryMinutes) && configuredExpiryMinutes > 0
    ? configuredExpiryMinutes * 60 * 1000
    : DEFAULT_PENDING_EXPIRY_MS;
  const expiresAtMs = Number.isFinite(createdAt) ? createdAt + ttlMs : Date.now() + ttlMs;
  return new Date(expiresAtMs).toISOString();
}

function resolveWaitingReasonKeys({ effectiveEligibility, confirmationResult, blockedByPerformanceFilter, cooldownActive, entryMode, constrainedEntry }) {
  const keys = [];
  if (blockedByPerformanceFilter) keys.push("blockedByPerformanceFilter");
  if (cooldownActive) keys.push("blockedByCooldown");
  if (!confirmationResult?.confirmationState?.klineConfirmed) keys.push("blockedByKlineConfirmation");
  if (confirmationResult?.confirmationState?.blockedByRangeFilter) keys.push("blockedByRangeFilter");
  if (confirmationResult?.confirmationState?.blockedByLocationFilter) keys.push("blockedByLocationFilter");
  if (entryMode === "pullback") keys.push("waitingForPullback");
  if (entryMode === "breakout") keys.push("waitingForBreakout");
  if (constrainedEntry?.isRejected && String(constrainedEntry?.rejectionReason || "").includes("TOO_FAR")) {
    keys.push("pendingTooFarFromPrice");
  }
  if (effectiveEligibility?.reasonCode === "WAITING_CONFIRMATION" && entryMode === "pullback") keys.push("waitingForPullback");
  if (effectiveEligibility?.reasonCode === "WAITING_CONFIRMATION" && entryMode === "breakout") keys.push("waitingForBreakout");
  return Array.from(new Set(keys));
}

function isOrderExpired(order, timestamp) {
  const expiresAtMs = new Date(order?.expiresAt || "").getTime();
  const nowMs = new Date(timestamp).getTime();
  if (!Number.isFinite(expiresAtMs) || !Number.isFinite(nowMs)) return false;
  return nowMs >= expiresAtMs;
}

function isOrderPriceDrifted(order, tickPrice) {
  const atr = normalizeNumber(order?.placementSnapshot?.atr);
  const triggerPrice = normalizeNumber(order?.triggerPrice);
  if (!Number.isFinite(atr) || atr <= 0 || !Number.isFinite(triggerPrice) || !Number.isFinite(tickPrice)) return false;
  return Math.abs(tickPrice - triggerPrice) > atr * DEFAULT_PENDING_DRIFT_ATR_RATIO;
}

function maybeFillPendingOrders(state, {
  tickPrice,
  candleHigh,
  candleLow,
  candleClose,
  rsi,
  macd,
  ma20,
  candleTime,
  symbol,
  timestamp = nowIso(),
  triggeredBy = "MARKET_TICK",
  selectedSymbolAtThatMoment = null,
  marketDataBySymbol = null,
}) {
  const normalizedCandleTime = normalizeBarTime(candleTime);
  let nextState = {
    ...state,
    pendingOrders: [...state.pendingOrders],
    cancelledOrders: [...(state.cancelledOrders || [])],
    openPositions: [...state.openPositions],
    waitingDiagnostics: state?.waitingDiagnostics || createDefaultWaitingDiagnostics(),
  };
  console.debug("[paper-trading] pending orders check", {
    pendingOrdersCount: (nextState.pendingOrders || []).filter((order) => order.status === "PENDING").length,
    tickPrice,
    timestamp,
  });

  nextState.pendingOrders = nextState.pendingOrders.map((order) => {
    if (order.status !== "PENDING") return order;
    const checkedFunctionName = "maybeFillPendingOrders";
    const scopedMarket = (marketDataBySymbol && order.symbol)
      ? marketDataBySymbol[order.symbol]
      : null;
    const marketSymbolUsed = scopedMarket ? order.symbol : symbol;
    const orderTickPrice = normalizeNumber(scopedMarket?.tickPrice ?? scopedMarket?.price ?? (order.symbol === symbol ? tickPrice : undefined));
    const orderCandleHigh = normalizeNumber(scopedMarket?.candleHigh ?? scopedMarket?.high ?? (order.symbol === symbol ? candleHigh : undefined));
    const orderCandleLow = normalizeNumber(scopedMarket?.candleLow ?? scopedMarket?.low ?? (order.symbol === symbol ? candleLow : undefined));
    const nextWaitBars = Number.isFinite(normalizedCandleTime)
      ? calculateBarsDelta(order.createdCandleTime ?? order.placementSnapshot?.createdCandleTime, normalizedCandleTime)
      : asSafeNumber(order.waitedBars);
    const distancePct = Number.isFinite(orderTickPrice) && Number.isFinite(order.triggerPrice) && orderTickPrice !== 0
      ? (Math.abs(order.triggerPrice - orderTickPrice) / Math.abs(orderTickPrice)) * 100
      : null;
    const observedOrder = {
      ...order,
      waitedBars: nextWaitBars,
      distanceFromPricePct: distancePct,
      canceledByPriceDrift: false,
    };
    const hasMarketEventForOrder = Boolean(scopedMarket) || order.symbol === symbol;
    if (!hasMarketEventForOrder) return observedOrder;
    const cancellationBlockedByTrigger = shouldBlockPendingCancellation(triggeredBy);
    const cancellationBlockedBySymbolMismatch = order.symbol !== marketSymbolUsed;
    if (
      order.entryMode === "pullback" &&
      Number.isFinite(nextWaitBars) &&
      nextWaitBars >= asSafeNumber(order.maxWaitBars, DEFAULT_PULLBACK_MAX_WAIT_BARS)
    ) {
      if (cancellationBlockedByTrigger || cancellationBlockedBySymbolMismatch) return observedOrder;
      nextState = incrementWaitingReason(nextState, "waitingForPullback", {
        symbol: order.symbol,
        orderId: order.id,
        waitedBars: nextWaitBars,
      });
      const refreshedEntry = Number.isFinite(orderTickPrice)
        ? (order.side === "SHORT" ? orderTickPrice * 1.001 : orderTickPrice * 0.999)
        : order.triggerPrice;
      nextState.cancelledOrders.unshift(cancelPendingOrder(order, "PENDING_TIMEOUT_REEVALUATED", timestamp, {
        triggeredBy,
        waitedBars: nextWaitBars,
        distancePct,
      }));
      nextState = registerReentryCandidate(nextState, {
        order,
        cancelReason: "PENDING_TIMEOUT_REEVALUATED",
        candleTime,
        timestamp,
        markPrice: orderTickPrice,
      });
      nextState = appendOrderLifecycleEvent(nextState, {
        symbol: order.symbol, orderId: order.id, eventType: "CANCELED", reason: "PENDING_TIMEOUT_REEVALUATED", triggeredBy, timestamp, selectedSymbolAtThatMoment, marketSymbolUsed,
        currentTickPrice: orderTickPrice, candleHigh: orderCandleHigh, candleLow: orderCandleLow, entryPrice: order.triggerPrice, checkedFunctionName,
      });
      nextState = appendPendingCancelTrace(nextState, {
        timestamp, orderId: order.id, orderSymbol: order.symbol, selectedSymbolAtThatMoment, marketSymbolUsed, reason: "PENDING_TIMEOUT_REEVALUATED", triggeredBy,
        currentTickPrice: orderTickPrice, candleHigh: orderCandleHigh, candleLow: orderCandleLow, entryPrice: order.triggerPrice, checkedFunctionName,
      });
      return {
        ...order,
        status: "CANCELLED",
        canceledByPriceDrift: false,
        refreshSuggestion: refreshedEntry,
      };
    }
    if (isOrderExpired(order, timestamp)) {
      if (cancellationBlockedByTrigger || cancellationBlockedBySymbolMismatch) return observedOrder;
      nextState.cancelledOrders.unshift(cancelPendingOrder(order, "EXPIRED", timestamp, { triggeredBy }));
      nextState = appendOrderLifecycleEvent(nextState, {
        symbol: order.symbol, orderId: order.id, eventType: "CANCELED", reason: "EXPIRED", triggeredBy, timestamp, selectedSymbolAtThatMoment, marketSymbolUsed,
        currentTickPrice: orderTickPrice, candleHigh: orderCandleHigh, candleLow: orderCandleLow, entryPrice: order.triggerPrice, checkedFunctionName,
      });
      nextState = appendPendingCancelTrace(nextState, {
        timestamp, orderId: order.id, orderSymbol: order.symbol, selectedSymbolAtThatMoment, marketSymbolUsed, reason: "EXPIRED", triggeredBy,
        currentTickPrice: orderTickPrice, candleHigh: orderCandleHigh, candleLow: orderCandleLow, entryPrice: order.triggerPrice, checkedFunctionName,
      });
      return { ...order, status: "CANCELLED" };
    }
    if (!cancellationBlockedByTrigger && !cancellationBlockedBySymbolMismatch && isOrderPriceDrifted(order, orderTickPrice)) {
      nextState = incrementWaitingReason(nextState, "canceledByPriceDrift", {
        symbol: order.symbol,
        orderId: order.id,
      });
      nextState.cancelledOrders.unshift(cancelPendingOrder(order, "PRICE_DRIFTED", timestamp, { triggeredBy }));
      nextState = registerReentryCandidate(nextState, {
        order,
        cancelReason: "PRICE_DRIFTED",
        candleTime,
        timestamp,
        markPrice: orderTickPrice,
      });
      nextState = registerReentryGuard(nextState, order, "PRICE_DRIFTED", timestamp, order?.decisionSnapshot, candleTime);
      nextState = appendOrderLifecycleEvent(nextState, {
        symbol: order.symbol, orderId: order.id, eventType: "CANCELED", reason: "PRICE_DRIFTED", triggeredBy, timestamp, selectedSymbolAtThatMoment, marketSymbolUsed,
        currentTickPrice: orderTickPrice, candleHigh: orderCandleHigh, candleLow: orderCandleLow, entryPrice: order.triggerPrice, checkedFunctionName,
      });
      nextState = appendPendingCancelTrace(nextState, {
        timestamp, orderId: order.id, orderSymbol: order.symbol, selectedSymbolAtThatMoment, marketSymbolUsed, reason: "PRICE_DRIFTED", triggeredBy,
        currentTickPrice: orderTickPrice, candleHigh: orderCandleHigh, candleLow: orderCandleLow, entryPrice: order.triggerPrice, checkedFunctionName,
      });
      return { ...order, status: "CANCELLED", canceledByPriceDrift: true };
    }
    if (isPreEntryInvalidated(order, orderTickPrice)) {
      if (cancellationBlockedByTrigger || cancellationBlockedBySymbolMismatch) return observedOrder;
      nextState.cancelledOrders.unshift(cancelPendingOrder(order, "SETUP_INVALIDATED", timestamp, { triggeredBy }));
      nextState = appendOrderLifecycleEvent(nextState, {
        symbol: order.symbol, orderId: order.id, eventType: "CANCELED", reason: "SETUP_INVALIDATED", triggeredBy, timestamp, selectedSymbolAtThatMoment, marketSymbolUsed,
        currentTickPrice: orderTickPrice, candleHigh: orderCandleHigh, candleLow: orderCandleLow, entryPrice: order.triggerPrice, checkedFunctionName,
      });
      nextState = appendPendingCancelTrace(nextState, {
        timestamp, orderId: order.id, orderSymbol: order.symbol, selectedSymbolAtThatMoment, marketSymbolUsed, reason: "SETUP_INVALIDATED", triggeredBy,
        currentTickPrice: orderTickPrice, candleHigh: orderCandleHigh, candleLow: orderCandleLow, entryPrice: order.triggerPrice, checkedFunctionName,
      });
      return { ...order, status: "CANCELLED" };
    }
    const fillEvaluation = evaluatePendingOrderFill(order, {
      tickPrice: orderTickPrice,
      candleHigh: orderCandleHigh,
      candleLow: orderCandleLow,
    });
    nextState = appendPendingFillCheck(nextState, {
      orderId: order.id,
      symbol: order.symbol,
      side: order.side,
      entryPrice: order.triggerPrice,
      tickPrice: orderTickPrice,
      candleHigh: orderCandleHigh,
      candleLow: orderCandleLow,
      shouldFill: fillEvaluation.shouldFill,
      fillReason: fillEvaluation.reason,
      blockedByDecision: false,
      checkedAt: timestamp,
      checkedBy: triggeredBy,
    });
    console.debug("[paper-trading] pending order fill evaluation", {
      orderId: order.id,
      symbol: order.symbol,
      timeframe: order.timeframe,
      side: order.side,
      triggerPrice: order.triggerPrice,
      tickPrice: orderTickPrice,
      candleHigh: orderCandleHigh,
      candleLow: orderCandleLow,
      shouldFill: fillEvaluation.shouldFill,
      fillReason: fillEvaluation.reason,
    });
    if (!fillEvaluation.shouldFill) return observedOrder;

    const entryPrice = asSafeNumber(order.triggerPrice, orderTickPrice);
    const normalizedLevels = normalizeDirectionalLevels({
      side: order.side,
      referencePrice: entryPrice,
      stopLoss: order.stopLoss,
      takeProfit1: order.takeProfit1,
      takeProfit2: order.takeProfit2,
      takeProfit3: order.takeProfit3,
    });
    const quantity = asSafeNumber(order.quantity, DEFAULT_POSITION_SIZE);
    const notional = quantity * entryPrice;
    const position = {
      id: createId("pos"),
      symbol: order.symbol,
      timeframe: order.timeframe,
      side: order.side,
      status: "OPEN",
      entryPrice,
      triggerPrice: order.triggerPrice,
      currentPrice: entryPrice,
      quantity,
      notional,
      leverage: DEFAULT_LEVERAGE,
      stopLoss: normalizedLevels.stopLoss,
      takeProfit1: normalizedLevels.takeProfit1,
      takeProfit2: normalizedLevels.takeProfit2,
      takeProfit3: normalizedLevels.takeProfit3,
      invalidationPrice: order.invalidationPrice,
      openedAt: timestamp,
      entryCandleTime: candleTime ?? null,
      unrealizedPnl: 0,
      entryReason: order.entryReason || null,
      isReentryAttempt: Boolean(order.isReentryAttempt),
      reentryCount: order.reentryCount ?? 0,
      reentryReason: order.reentryReason ?? null,
      reentryAdjustedEntry: Boolean(order.reentryAdjustedEntry),
      decisionSnapshot: order.decisionSnapshot,
      decisionContextKey: order.decisionContextKey,
      hitTargets: [],
      createdAt: order.createdAt || timestamp,
      signalToPlaceBars: order.signalToPlaceBars ?? null,
      placeToFillBars: nextWaitBars,
      ...resolveTradeMetadata({
        decision: order.decisionSnapshot,
        confirmationResult: order.decisionSnapshot?.confirmationResult || null,
        signalContext: {
          ...order?.placementSnapshot,
          rsi,
          hasKlineConfirmation: order?.hasKlineConfirmation ?? null,
          klineConfirmed: order?.hasKlineConfirmation ?? null,
        },
        side: order.side,
      }),
    };
    nextState.openPositions.push(position);
    const diagnostics = nextState?.waitingDiagnostics || createDefaultWaitingDiagnostics();
    nextState.waitingDiagnostics = {
      ...diagnostics,
      placeToFillBars: [nextWaitBars, ...(diagnostics.placeToFillBars || [])]
        .filter((value) => Number.isFinite(value))
        .slice(0, 500),
      symbolWaitBars: {
        ...(diagnostics.symbolWaitBars || {}),
        [order.symbol]: [
          nextWaitBars,
          ...((diagnostics.symbolWaitBars || {})[order.symbol] || []),
        ].filter((value) => Number.isFinite(value)).slice(0, 300),
      },
    };
    nextState = appendOrderLifecycleEvent(nextState, { symbol: order.symbol, orderId: order.id, eventType: "FILLED", reason: fillEvaluation.reason, triggeredBy, timestamp, selectedSymbolAtThatMoment, marketSymbolUsed: order.symbol });
    console.info("[paper-trading] pending order executed", {
      orderId: order.id,
      symbol: order.symbol,
      timeframe: order.timeframe,
      side: order.side,
      entryPrice,
      fillReason: fillEvaluation.reason,
      executedAt: timestamp,
    });
    return { ...observedOrder, status: "FILLED", filledAt: timestamp };
  });

  nextState.pendingOrders = nextState.pendingOrders.filter((order) => order.status === "PENDING");
  nextState.cancelledOrders = nextState.cancelledOrders.slice(0, MAX_CANCELLED_ORDERS_HISTORY);
  return recalculateAccountState(nextState, {
    timestamp,
    selectedSymbol: selectedSymbolAtThatMoment,
    affectedSymbol: symbol,
    eventType: "MARKET_TICK",
    sourceFunction: "maybeFillPendingOrders",
  });
}

function detectTrapExit(position, decisionSnapshot, tickPrice) {
  const trap = decisionSnapshot?.trapDetection;
  if (!trap || trap.trapSignal === "NONE") return false;
  const confidence = normalizeConfidence(trap.trapConfidence);
  if (!TRAP_BLOCK_CONFIDENCE.has(confidence)) return false;

  const trapLow = normalizeNumber(trap.trapZoneLow);
  const trapHigh = normalizeNumber(trap.trapZoneHigh);
  if (!Number.isFinite(tickPrice) || (!trapLow && !trapHigh)) return false;

  if (position.side === "LONG") {
    return Number.isFinite(trapLow) ? tickPrice <= trapLow : false;
  }

  return Number.isFinite(trapHigh) ? tickPrice >= trapHigh : false;
}

function detectPositionCloseReason(position, tickPrice) {
  if (position.invalidationPrice != null) {
    if (position.side === "LONG" && tickPrice <= position.invalidationPrice) return "INVALIDATION";
    if (position.side === "SHORT" && tickPrice >= position.invalidationPrice) return "INVALIDATION";
  }

  if (position.stopLoss != null) {
    if (position.side === "LONG" && tickPrice <= position.stopLoss) return "STOP_LOSS";
    if (position.side === "SHORT" && tickPrice >= position.stopLoss) return "STOP_LOSS";
  }

  const targets = [
    { reason: "TP1", price: position.takeProfit1 },
    { reason: "TP2", price: position.takeProfit2 },
    { reason: "TP3", price: position.takeProfit3 },
  ].filter((target) => target.price != null);

  for (const target of targets) {
    if (position.side === "LONG" && tickPrice >= target.price) return target.reason;
    if (position.side === "SHORT" && tickPrice <= target.price) return target.reason;
  }

  if (detectTrapExit(position, position.decisionSnapshot, tickPrice)) return "TRAP_EXIT";
  return null;
}

export function simulateDecisionExecution({
  state,
  decision,
  symbol,
  timeframe,
  currentPrice,
  quantity = DEFAULT_POSITION_SIZE,
  forceSimulation = false,
  signalContext = {},
  executionSource = "",
  orderMode = "",
  triggeredBy = "DECISION_ENGINE",
}) {
  const basePerformanceDebug = buildPerformanceDebugState();
  const decisionBarTime = normalizeBarTime(signalContext?.candleTime);
  if (!state) {
    return { state, result: "NO_DECISION", ...basePerformanceDebug };
  }

  const executionOptions = { executionSource, orderMode };
  const bypassSetupGate = shouldBypassSetupGate(executionOptions);
  if (!decision) {
    return bypassSetupGate
      ? {
        state,
        result: "WATCH_ONLY",
        ...basePerformanceDebug,
        executionIntent: "WATCH_ONLY",
        eligibilityInfo: {
          eligibility: "WATCH_ONLY",
          reasonCode: "NO_DECISION",
          reason: "尚未產生可執行決策，已進入觀察模式",
        },
      }
      : { state, result: "NO_DECISION", ...basePerformanceDebug };
  }
  const confirmationResult = runConfirmationEngine(buildConfirmationPayload(decision, currentPrice, signalContext));
  const executionIntent = mapDecisionTypeToExecutionIntent(confirmationResult.decisionType, confirmationResult);
  console.debug("[paper-engine:simulateDecisionExecution:before-validator]", {
    symbol,
    timeframe,
    currentPrice,
    quantity,
    forceSimulation,
    executionSource,
    orderMode,
    bypassSetupGate,
  });
  const eligibilityInfo = getSimulationEligibility(decision, currentPrice, signalContext, executionOptions);
  console.debug("[paper-engine:simulateDecisionExecution:validator-result]", {
    executionSource,
    orderMode,
    eligibilityInfo,
  });
  let effectiveEligibility = eligibilityInfo;
  if (
    forceSimulation &&
    eligibilityInfo.eligibility === "BLOCKED" &&
    ["SKIP_NO_ACTIONABLE_SIDE", "STRUCTURE_INVALID", "EXTREMELY_LOW_CONFIDENCE"].includes(eligibilityInfo.reasonCode)
  ) {
    effectiveEligibility = {
      eligibility: "READY_TO_PLACE_PENDING",
      reasonCode: "SIMULATION_OVERRIDE",
      reason: "非建議交易（模擬）",
      overrideApplied: true,
      originalReasonCode: eligibilityInfo.reasonCode,
      originalReason: eligibilityInfo.reason,
    };
  }

  if (confirmationResult?.confirmationState?.blockedByRangeFilter) {
    state = incrementWaitingReason(state, "blockedByRangeFilter", { symbol, timeframe });
  }
  if (confirmationResult?.confirmationState?.blockedByLocationFilter) {
    state = incrementWaitingReason(state, "blockedByLocationFilter", { symbol, timeframe });
  }
  if (!confirmationResult?.confirmationState?.klineConfirmed) {
    state = incrementWaitingReason(state, "blockedByKlineConfirmation", { symbol, timeframe });
  }

  if (effectiveEligibility.eligibility === "BLOCKED" && !bypassSetupGate) {
    return { state, result: effectiveEligibility.reasonCode, eligibilityInfo: effectiveEligibility, ...basePerformanceDebug };
  }

  const side = resolveSideFromDecision(decision) || (bypassSetupGate ? resolveManualSimulationSide(decision) : null);
  if (!side) {
    return { state, result: "SKIP_NO_ACTIONABLE_SIDE", eligibilityInfo: effectiveEligibility, ...basePerformanceDebug };
  }
  const tradeMetadata = resolveTradeMetadata({ decision, confirmationResult, signalContext, side });
  const closedTrades = (state?.closedTrades || []).filter((trade) => trade?.symbol === symbol);
  const fullPerformance = buildPerformanceSnapshot(closedTrades, (setupContext, trade) => trade?.setupKey || buildSetupKey(setupContext));
  const coarsePerformance = buildPerformanceSnapshot(closedTrades, (setupContext, trade) => trade?.coarseSetupKey || buildCoarseSetupKey(setupContext));
  const currentSetupKey = tradeMetadata.setupKey;
  const currentCoarseSetupKey = tradeMetadata.coarseSetupKey;

  const fullRecentCandidate = resolvePerformanceCandidate(fullPerformance.recentMap, currentSetupKey, "recent");
  const fullAllTimeCandidate = resolvePerformanceCandidate(fullPerformance.allTimeMap, currentSetupKey, "allTime");
  const coarseRecentCandidate = resolvePerformanceCandidate(coarsePerformance.recentMap, currentCoarseSetupKey, "coarseRecent");
  const coarseAllTimeCandidate = resolvePerformanceCandidate(coarsePerformance.allTimeMap, currentCoarseSetupKey, "coarseAllTime");

  const selectedFullCandidate = fullRecentCandidate.stats.totalTrades >= PERFORMANCE_MIN_SAMPLE_SIZE
    ? fullRecentCandidate
    : fullAllTimeCandidate;
  const selectedCandidate = selectedFullCandidate.stats.totalTrades >= PERFORMANCE_MIN_SAMPLE_SIZE
    ? selectedFullCandidate
    : (coarseRecentCandidate.stats.totalTrades >= PERFORMANCE_MIN_SAMPLE_SIZE ? coarseRecentCandidate : coarseAllTimeCandidate);

  const blockedByPerformanceFilter = isUnderperforming(selectedCandidate.stats);
  const performanceSampleSize = selectedCandidate.stats.totalTrades;
  const performanceWinRate = selectedCandidate.stats.winRate;
  const performanceAvgPnl = selectedCandidate.stats.avgPnl;
  const performanceSource = selectedCandidate.source;
  const performanceDebugPayload = buildPerformanceDebugState({
    currentSetupKey,
    currentFullSetupKey: currentSetupKey,
    currentCoarseSetupKey,
    currentSetupWinRate: performanceWinRate,
    currentSetupSampleSize: performanceSampleSize,
    performanceSource,
    performanceSampleSize,
    performanceWinRate,
    performanceAvgPnl,
    blockedByPerformanceFilter,
  });

  if (blockedByPerformanceFilter && !bypassSetupGate) {
    let nextStateWithDiag = state;
    nextStateWithDiag = incrementWaitingReason(nextStateWithDiag, "blockedByPerformanceFilter", { symbol, timeframe });
    return {
      state: nextStateWithDiag,
      result: "BLOCKED_BY_PERFORMANCE_FILTER",
      executionIntent: "WATCH_ONLY",
      confirmationResult: {
        ...confirmationResult,
        canExecute: false,
        decisionType: "NO_TRADE",
      },
      ...performanceDebugPayload,
      eligibilityInfo: {
        ...effectiveEligibility,
        eligibility: "WATCH_ONLY",
        reasonCode: "BLOCKED_BY_PERFORMANCE_FILTER",
        reason: `setup 歷史表現不足（來源 ${performanceSource}，樣本 ${performanceSampleSize}，勝率 ${performanceWinRate.toFixed(1)}%，avgPnl ${performanceAvgPnl.toFixed(2)}）`,
        executionIntent: "WATCH_ONLY",
      },
    };
  }
  const cooldownState = getCooldownStateForSide(state, side, symbol);
  if (cooldownState.cooldownActive) {
    const nextStateWithDiag = incrementWaitingReason(state, "blockedByCooldown", { symbol, timeframe, side });
    return {
      state: nextStateWithDiag,
      result: "DIRECTIONAL_COOLDOWN_ACTIVE",
      executionIntent: "WATCH_ONLY",
      confirmationResult: {
        ...confirmationResult,
        canExecute: false,
        decisionType: "NO_TRADE",
      },
      eligibilityInfo: {
        ...effectiveEligibility,
        eligibility: "WATCH_ONLY",
        reasonCode: "DIRECTIONAL_COOLDOWN_ACTIVE",
        reason: `${side} directional cooldown active (${cooldownState.cooldownBarsLeft} bars left)`,
      },
      cooldownDebug: cooldownState,
      ...performanceDebugPayload,
    };
  }
  const plannedEntry = resolvePlannedEntryPrice(decision, side);
  const reentryAttempt = resolveReentryAttempt(state, {
    decision,
    symbol,
    timeframe,
    side,
    currentPrice,
    candleTime: signalContext?.candleTime,
  });
  const fallbackEntryPrice = normalizeNumber(currentPrice) ??
    reentryAttempt?.adjustedEntryPrice ??
    plannedEntry.entryPrice ??
    normalizeNumber(decision?.price);
  const constrainedEntry = applyEntryDistanceConstraint({
    side,
    entryPrice: bypassSetupGate ? fallbackEntryPrice : (reentryAttempt?.adjustedEntryPrice ?? plannedEntry.entryPrice),
    currentPrice: normalizeNumber(currentPrice),
    atr: decision?.executionPlan?.atr ?? decision?.atr,
    marketRegime: decision?.marketRegimeLabel || decision?.regime || signalContext?.marketRegime,
  });
  if (constrainedEntry.isRejected && String(constrainedEntry.rejectionReason || "").includes("TOO_FAR")) {
    state = incrementWaitingReason(state, "pendingTooFarFromPrice", { symbol, timeframe, side });
  }
  const triggerPrice = normalizeNumber(constrainedEntry.entryPrice ?? fallbackEntryPrice);
  if (constrainedEntry.isRejected) {
    if (bypassSetupGate) {
      return {
        state,
        result: "WATCH_AND_ARM",
        ...performanceDebugPayload,
        executionIntent: "WATCH_AND_ARM",
        confirmationResult,
        eligibilityInfo: {
          ...effectiveEligibility,
          reasonCode: constrainedEntry.rejectionReason || "ENTRY_UNREALISTIC",
          reason: "掛單距離不合理，已轉為等待確認模式",
        },
      };
    }
    return {
      state,
      result: constrainedEntry.rejectionReason || "ENTRY_UNREALISTIC",
      ...performanceDebugPayload,
      eligibilityInfo: effectiveEligibility,
    };
  }
  const atrValue = normalizeNumber(decision.executionPlan?.atr ?? decision?.atr);
  const fallbackInvalidation =
    Number.isFinite(triggerPrice) && Number.isFinite(atrValue) && atrValue > 0
      ? (side === "LONG" ? triggerPrice - atrValue * 1.5 : triggerPrice + atrValue * 1.5)
      : undefined;
  const invalidationPrice =
    normalizeNumber(decision.executionPlan?.invalidationPrice ?? decision.invalidationPrice) ??
    normalizeNumber(decision.executionPlan?.stopLoss ?? decision.stopLoss) ??
    fallbackInvalidation;
  const contextKey = buildDecisionContextKey(decision, symbol, timeframe);
  const decisionRevision = buildDecisionRevision(decision, timeframe);
  const normalizedLevels = normalizeDirectionalLevels({
    side,
    referencePrice: triggerPrice,
    stopLoss: decision.executionPlan?.stopLoss ?? decision.stopLoss,
    takeProfit1: decision.executionPlan?.takeProfit1 ?? decision.takeProfit1,
    takeProfit2: decision.executionPlan?.takeProfit2 ?? decision.takeProfit2,
    takeProfit3: decision.executionPlan?.takeProfit3 ?? decision.takeProfit3,
  });

  if (isDuplicateContext(state, symbol, timeframe, contextKey)) {
    if (bypassSetupGate) {
      return {
        state,
        result: "WATCH_AND_ARM",
        ...performanceDebugPayload,
        executionIntent: "WATCH_AND_ARM",
        confirmationResult,
        eligibilityInfo: {
          ...effectiveEligibility,
          reasonCode: "DUPLICATE_SETUP",
          reason: "同一 setup 已存在，保留既有單並持續監控",
        },
      };
    }
    return { state, result: "DUPLICATE_SETUP", ...performanceDebugPayload };
  }

  const pendingOrder = {
    id: createId("order"),
    symbol,
    timeframe,
    side,
    triggerPrice,
    invalidationPrice,
    stopLoss: normalizedLevels.stopLoss,
    takeProfit1: normalizedLevels.takeProfit1,
    takeProfit2: normalizedLevels.takeProfit2,
    takeProfit3: normalizedLevels.takeProfit3,
    quantity: asSafeNumber(
      asSafeNumber(quantity, DEFAULT_POSITION_SIZE) * getSizingMultiplier(confirmationResult.decisionType),
      DEFAULT_POSITION_SIZE
    ),
    createdAt: nowIso(),
    status: "PENDING",
    expiresAt: resolveExpiryTimestamp(decision, nowIso()),
    waitReason: effectiveEligibility.reason,
    waitingReasons: resolveWaitingReasonKeys({
      effectiveEligibility,
      confirmationResult,
      blockedByPerformanceFilter: false,
      cooldownActive: cooldownState.cooldownActive,
      entryMode: plannedEntry.mode,
      constrainedEntry,
    }),
    entryReason: decision.entryReason || null,
    entryMode: plannedEntry.mode,
    entryAdjusted: constrainedEntry.wasAdjusted || Boolean(reentryAttempt?.reentryAdjustedEntry),
    isReentryAttempt: Boolean(reentryAttempt?.isReentryAttempt),
    reentryCount: reentryAttempt?.reentryCount ?? 0,
    reentryReason: reentryAttempt?.reentryReason ?? null,
    reentryAdjustedEntry: Boolean(reentryAttempt?.reentryAdjustedEntry),
    simulationLabel: effectiveEligibility.overrideApplied ? "模擬掛單（非建議）" : null,
    riskProfile: REDUCED_CONFIDENCE_TYPES.has(confirmationResult.decisionType) ? "LOW_CONFIDENCE_SMALL_SIZE" : "STANDARD",
    placementSnapshot: {
      createdAt: nowIso(),
      symbol,
      timeframe,
      side,
      triggerPrice,
      invalidationPrice,
      atr: normalizeNumber(decision?.executionPlan?.atr ?? decision?.atr),
      rsi: normalizeNumber(decision?.rsi),
      volumeState: decision?.volumeState ?? null,
      currentVolume: normalizeNumber(signalContext?.currentVolume),
      avgVolume20: normalizeNumber(signalContext?.avgVolume20),
      structure: signalContext?.structure ?? decision?.structure ?? null,
      mtf: signalContext?.mtf ?? decision?.mtf ?? null,
      decisionAction: decision?.action ?? decision?.executionPlan?.action ?? null,
      setupType: decision?.setupType ?? decision?.executionPlan?.setupType ?? null,
      createdCandleTime: decisionBarTime,
    },
    createdCandleTime: decisionBarTime,
    maxWaitBars: plannedEntry.mode === "pullback" ? DEFAULT_PULLBACK_MAX_WAIT_BARS : DEFAULT_PENDING_TIMEOUT_BARS,
    waitedBars: 0,
    distanceFromPricePct: Number.isFinite(Number(currentPrice)) && Number.isFinite(triggerPrice) && Number(currentPrice) !== 0
      ? (Math.abs(triggerPrice - Number(currentPrice)) / Math.abs(Number(currentPrice))) * 100
      : null,
    decisionSnapshot: decision,
    decisionContextKey: contextKey,
    ...tradeMetadata,
  };

  const createPendingOrder = ({ baseState, order }) => {
    const beforeCount = (baseState?.pendingOrders || []).length;
    const nextState = recalculateAccountState({
      ...baseState,
      pendingOrders: [order, ...(baseState?.pendingOrders || [])],
    }, {
      selectedSymbol: symbol,
      affectedSymbol: order.symbol,
      eventType: "PLACE_ORDER",
      sourceFunction: "simulateDecisionExecution.createPendingOrder",
    });
    const afterCount = (nextState?.pendingOrders || []).length;
    return {
      nextState,
      beforeCount,
      afterCount,
      created: afterCount > beforeCount,
    };
  };

  if (executionIntent === "WATCH_ONLY") {
    return {
      state,
      result: "WATCH_ONLY",
      executionIntent,
      confirmationResult,
      ...performanceDebugPayload,
      eligibilityInfo: {
        ...effectiveEligibility,
        executionIntent,
        confirmationResult,
      },
    };
  }

  if (executionIntent === "WATCH_AND_ARM") {
    return {
      state,
      result: "WATCH_AND_ARM",
      executionIntent,
      confirmationResult,
      ...performanceDebugPayload,
      eligibilityInfo: {
        ...effectiveEligibility,
        executionIntent,
        confirmationResult,
      },
    };
  }

  if (
    !reentryAttempt &&
    (effectiveEligibility.eligibility === "READY_TO_EXECUTE" || (executionIntent === "EXECUTE_NOW" && confirmationResult.canExecute))
  ) {
    if (isReentryBlockedByGuard(state, {
      symbol,
      timeframe,
      side,
      triggerPrice,
      decisionContextKey: contextKey,
      decisionRevision,
      atr: atrValue,
      candleTime: signalContext?.candleTime,
    })) {
      return {
        state,
        result: "REENTRY_GUARD_BLOCKED",
        executionIntent: "WATCH_AND_ARM",
        confirmationResult,
        ...performanceDebugPayload,
        eligibilityInfo: {
          ...effectiveEligibility,
          reasonCode: "REENTRY_GUARD_BLOCKED",
          reason: "PRICE_DRIFTED 後尚未有新 candle/decision revision，暫停重建相近訂單",
        },
      };
    }
    const timestamp = nowIso();
    const entryPrice = asSafeNumber(triggerPrice, currentPrice);
    const quantityValue = asSafeNumber(
      asSafeNumber(quantity, DEFAULT_POSITION_SIZE) * getSizingMultiplier(confirmationResult.decisionType),
      DEFAULT_POSITION_SIZE
    );
    const position = {
      id: createId("pos"),
      symbol,
      timeframe,
      side,
      status: "OPEN",
      entryPrice,
      triggerPrice,
      currentPrice: entryPrice,
      quantity: quantityValue,
      notional: quantityValue * entryPrice,
      leverage: DEFAULT_LEVERAGE,
      stopLoss: normalizedLevels.stopLoss,
      takeProfit1: normalizedLevels.takeProfit1,
      takeProfit2: normalizedLevels.takeProfit2,
      takeProfit3: normalizedLevels.takeProfit3,
      invalidationPrice,
      openedAt: timestamp,
      unrealizedPnl: 0,
      entryReason: decision.entryReason || null,
      entryMode: plannedEntry.mode,
      entryAdjusted: constrainedEntry.wasAdjusted || Boolean(reentryAttempt?.reentryAdjustedEntry),
      isReentryAttempt: Boolean(reentryAttempt?.isReentryAttempt),
      reentryCount: reentryAttempt?.reentryCount ?? 0,
      reentryReason: reentryAttempt?.reentryReason ?? null,
      reentryAdjustedEntry: Boolean(reentryAttempt?.reentryAdjustedEntry),
      simulationLabel: effectiveEligibility.overrideApplied ? "模擬掛單（非建議）" : null,
      riskProfile: REDUCED_CONFIDENCE_TYPES.has(confirmationResult.decisionType) ? "LOW_CONFIDENCE_SMALL_SIZE" : "STANDARD",
      decisionSnapshot: decision,
      decisionContextKey: contextKey,
      hitTargets: [],
      createdAt: timestamp,
      ...tradeMetadata,
    };

    let nextState = recalculateAccountState({
      ...state,
      openPositions: [position, ...state.openPositions],
    }, {
      timestamp,
      selectedSymbol: symbol,
      affectedSymbol: symbol,
      eventType: "FILL_ORDER",
      sourceFunction: "simulateDecisionExecution",
    });
    if (reentryAttempt?.key) {
      const tracked = nextState?.reentryTracking?.[reentryAttempt.key] || {};
      nextState = {
        ...nextState,
        reentryTracking: {
          ...(nextState?.reentryTracking || {}),
          [reentryAttempt.key]: {
            ...tracked,
            active: false,
            failureStreak: 0,
            reentryCount: reentryAttempt.reentryCount,
          },
        },
      };
    }
    nextState = appendOrderLifecycleEvent(nextState, {
      symbol,
      orderId: position.id,
      eventType: "FILLED",
      reason: "EXECUTE_NOW",
      triggeredBy,
      timestamp,
    });
    return {
      state: nextState,
      result: "EXECUTED_IMMEDIATELY",
      executionIntent: "EXECUTE_NOW",
      confirmationResult,
      ...performanceDebugPayload,
      position,
      eligibilityInfo: effectiveEligibility,
    };
  }

  if (isReentryBlockedByGuard(state, {
    symbol,
    timeframe,
    side,
    triggerPrice,
    decisionContextKey: contextKey,
    decisionRevision,
    atr: atrValue,
    candleTime: signalContext?.candleTime,
  })) {
    return {
      state,
      result: "REENTRY_GUARD_BLOCKED",
      executionIntent: "WATCH_AND_ARM",
      confirmationResult,
      ...performanceDebugPayload,
      eligibilityInfo: {
        ...effectiveEligibility,
        reasonCode: "REENTRY_GUARD_BLOCKED",
        reason: "PRICE_DRIFTED 後尚未有新 candle/decision revision，暫停重建相近訂單",
      },
    };
  }

  const pendingCreation = createPendingOrder({ baseState: state, order: pendingOrder });
  if (reentryAttempt?.key) {
    const tracked = pendingCreation.nextState?.reentryTracking?.[reentryAttempt.key] || {};
    pendingCreation.nextState = {
      ...pendingCreation.nextState,
      reentryTracking: {
        ...(pendingCreation.nextState?.reentryTracking || {}),
        [reentryAttempt.key]: {
          ...tracked,
          reentryCount: reentryAttempt.reentryCount,
          active: true,
        },
      },
    };
  }
  const signalToPlaceBars = calculateBarsDelta(
    (state?.waitingDiagnostics?.firstValidSignalByContext || {})[contextKey],
    decisionBarTime
  );
  if (Number.isFinite(decisionBarTime)) {
    pendingCreation.nextState = {
      ...pendingCreation.nextState,
      waitingDiagnostics: {
        ...(pendingCreation.nextState.waitingDiagnostics || createDefaultWaitingDiagnostics()),
        firstValidSignalByContext: {
          ...((pendingCreation.nextState.waitingDiagnostics || createDefaultWaitingDiagnostics()).firstValidSignalByContext || {}),
          [contextKey]: decisionBarTime,
        },
        signalToPlaceBars: [
          signalToPlaceBars ?? 0,
          ...(((pendingCreation.nextState.waitingDiagnostics || createDefaultWaitingDiagnostics()).signalToPlaceBars) || []),
        ].filter((value) => Number.isFinite(value)).slice(0, 500),
      },
    };
    pendingOrder.signalToPlaceBars = signalToPlaceBars ?? 0;
  }
  const stateWithLifecycle = appendOrderLifecycleEvent(pendingCreation.nextState, {
    symbol,
    orderId: pendingOrder.id,
    eventType: "PLACED",
    reason: "PLACE_PENDING",
    triggeredBy,
    timestamp: pendingOrder.createdAt,
  });

  return {
    state: stateWithLifecycle,
    result: "PENDING_CREATED",
    executionIntent: "PLACE_PENDING",
    confirmationResult,
    ...performanceDebugPayload,
    pendingOrder,
    pendingCreation,
    eligibilityInfo: effectiveEligibility,
  };
}

export function reconcilePendingOrdersWithDecision({
  state,
  decision,
  symbol,
  timeframe,
  currentPrice,
  timestamp = nowIso(),
  candleTime,
  triggeredBy = "DECISION_ENGINE",
  selectedSymbolAtThatMoment = null,
}) {
  if (!state || !decision || !symbol || !timeframe) return state;

  const side = resolveSideFromDecision(decision);
  const decisionAtr = normalizeNumber(decision?.executionPlan?.atr ?? decision?.atr);
  const markPrice = normalizeNumber(currentPrice);

  const nextPending = [];
  const cancelledOrders = [...(state.cancelledOrders || [])];

  for (const order of state.pendingOrders || []) {
    if (order.status !== "PENDING") continue;

    if (order.symbol !== symbol || order.timeframe !== timeframe) {
      nextPending.push(order);
      continue;
    }
    const checkedFunctionName = "reconcilePendingOrdersWithDecision";
    if (shouldBlockPendingCancellation(triggeredBy)) {
      nextPending.push(order);
      continue;
    }

    let cancelReason = null;
    const referenceAtr = normalizeNumber(order?.placementSnapshot?.atr ?? decisionAtr);
    const waitedBars = Number.isFinite(Number(candleTime))
      ? calculateBarsDelta(order.createdCandleTime ?? order?.placementSnapshot?.createdCandleTime, candleTime)
      : asSafeNumber(order.waitedBars);

    if (isOrderExpired(order, timestamp)) {
      cancelReason = "EXPIRED";
    } else if (Number.isFinite(markPrice) && isOrderPriceDrifted(order, markPrice)) {
      cancelReason = "PRICE_DRIFTED";
    } else if (isPreEntryInvalidated(order, markPrice)) {
      cancelReason = "SETUP_INVALIDATED";
    } else if (side && order.side !== side && Number.isFinite(referenceAtr) && referenceAtr > 0) {
      const movedDistance = Math.abs(asSafeNumber(markPrice) - asSafeNumber(order.triggerPrice));
      if (movedDistance > referenceAtr * DEFAULT_PENDING_DRIFT_ATR_RATIO) {
        cancelReason = "STRUCTURE_CHANGED";
      }
    } else if (Number.isFinite(waitedBars) && waitedBars >= asSafeNumber(order.maxWaitBars, DEFAULT_PENDING_TIMEOUT_BARS)) {
      cancelReason = "PENDING_TIMEOUT_REEVALUATED";
    }

    if (cancelReason) {
      cancelledOrders.unshift(cancelPendingOrder(order, cancelReason, timestamp, { triggeredBy }));
      state = registerReentryCandidate(state, {
        order,
        cancelReason,
        candleTime,
        timestamp,
        markPrice,
      });
      if (cancelReason === "PRICE_DRIFTED") {
        state = registerReentryGuard(state, order, cancelReason, timestamp, decision, candleTime);
        state = incrementWaitingReason(state, "canceledByPriceDrift", { symbol: order.symbol, orderId: order.id });
      }
      state = appendOrderLifecycleEvent(state, {
        symbol: order.symbol,
        orderId: order.id,
        eventType: "CANCELED",
        reason: cancelReason,
        triggeredBy,
        timestamp,
        selectedSymbolAtThatMoment,
        marketSymbolUsed: symbol,
        currentTickPrice: markPrice,
        candleHigh: null,
        candleLow: null,
        entryPrice: order.triggerPrice,
        checkedFunctionName,
      });
      state = appendPendingCancelTrace(state, {
        timestamp,
        orderId: order.id,
        orderSymbol: order.symbol,
        selectedSymbolAtThatMoment,
        marketSymbolUsed: symbol,
        reason: cancelReason,
        triggeredBy,
        currentTickPrice: markPrice,
        candleHigh: null,
        candleLow: null,
        entryPrice: order.triggerPrice,
        checkedFunctionName,
      });
      continue;
    }

    nextPending.push(order);
  }

  return recalculateAccountState({
    ...state,
    pendingOrders: nextPending,
    cancelledOrders: cancelledOrders.slice(0, MAX_CANCELLED_ORDERS_HISTORY),
  }, {
    timestamp,
    selectedSymbol: selectedSymbolAtThatMoment,
    affectedSymbol: symbol,
    eventType: "RECONCILE",
    sourceFunction: "reconcilePendingOrdersWithDecision",
  });
}

export function applyMarketTickToPaperState(
  state,
  {
    price,
    candleHigh,
    candleLow,
    candleClose,
    rsi,
    macd,
    ma20,
    candleTime,
    symbol,
    timestamp = nowIso(),
    triggeredBy = "MARKET_TICK",
    selectedSymbolAtThatMoment = null,
    marketDataBySymbol = null,
  }
) {
  const tickPrice = asSafeNumber(price);
  if (!symbol || !Number.isFinite(tickPrice)) return state;

  const normalizedRsi = normalizeNumber(rsi);
  const normalizedCandleClose = normalizeNumber(candleClose);
  const normalizedMa20 = normalizeNumber(ma20);
  const normalizedMacd = resolveMacdValue(macd);

  const symbolState = getSymbolIsolationState(state, symbol);
  const normalizedCandleTime = Number(candleTime);
  const hasNewCandle = Number.isFinite(normalizedCandleTime) && normalizedCandleTime !== Number(symbolState?.cooldownLastCandleTime);
  const nextSymbolIsolationState = symbol
    ? {
      ...(state.symbolIsolationState || {}),
      [symbol]: {
        ...symbolState,
        longCooldownBars: hasNewCandle ? Math.max(0, asSafeNumber(symbolState?.longCooldownBars) - 1) : asSafeNumber(symbolState?.longCooldownBars),
        shortCooldownBars: hasNewCandle ? Math.max(0, asSafeNumber(symbolState?.shortCooldownBars) - 1) : asSafeNumber(symbolState?.shortCooldownBars),
        cooldownLastCandleTime: hasNewCandle ? normalizedCandleTime : symbolState?.cooldownLastCandleTime ?? null,
      },
    }
    : (state.symbolIsolationState || {});
  let nextState = {
    ...state,
    longCooldownBars: hasNewCandle ? Math.max(0, asSafeNumber(symbolState?.longCooldownBars) - 1) : asSafeNumber(symbolState?.longCooldownBars),
    shortCooldownBars: hasNewCandle ? Math.max(0, asSafeNumber(symbolState?.shortCooldownBars) - 1) : asSafeNumber(symbolState?.shortCooldownBars),
    cooldownLastCandleTime: hasNewCandle ? normalizedCandleTime : symbolState?.cooldownLastCandleTime ?? null,
    symbolIsolationState: nextSymbolIsolationState,
  };

  nextState = maybeFillPendingOrders(nextState, {
    tickPrice,
    candleClose: normalizedCandleClose,
    candleHigh: normalizeNumber(candleHigh),
    candleLow: normalizeNumber(candleLow),
    rsi: normalizedRsi,
    macd: normalizedMacd,
    ma20: normalizedMa20,
    candleTime,
    symbol,
    timestamp,
    triggeredBy,
    selectedSymbolAtThatMoment,
    marketDataBySymbol,
  });
  const updatedPositions = nextState.openPositions.map((position) => {
    if (symbol && position.symbol !== symbol) return position;
    return {
      ...maybeAdjustPositionRisk({
        ...position,
        currentPrice: tickPrice,
        unrealizedPnl: getUnrealizedPnl(position, tickPrice),
        maxFavorableExcursion: Math.max(
          asSafeNumber(position.maxFavorableExcursion, Number.NEGATIVE_INFINITY),
          getPnl(position.side, position.entryPrice, tickPrice, position.quantity)
        ),
        maxAdverseExcursion: Math.min(
          asSafeNumber(position.maxAdverseExcursion, Number.POSITIVE_INFINITY),
          getPnl(position.side, position.entryPrice, tickPrice, position.quantity)
        ),
      }, tickPrice),
    };
  });

  nextState = recalculateAccountState({
    ...nextState,
    openPositions: updatedPositions,
  }, {
    timestamp,
    selectedSymbol: selectedSymbolAtThatMoment,
    affectedSymbol: symbol,
    eventType: "MARKET_TICK",
    sourceFunction: "applyMarketTickToPaperState.updatePositions",
  });

  const toClose = [];
  for (const position of nextState.openPositions) {
    if (symbol && position.symbol !== symbol) continue;
    const closeReason = detectPositionCloseReason(position, tickPrice);
    if (closeReason) {
      toClose.push({ positionId: position.id, closeReason });
    }
  }

  for (const closeTarget of toClose) {
    nextState = closePosition(nextState, {
      ...closeTarget,
      exitPrice: tickPrice,
      closedAt: timestamp,
      triggeredBy,
      selectedSymbolAtThatMoment,
      marketSymbolUsed: symbol,
    });
  }

  return recalculateAccountState(nextState, {
    timestamp,
    selectedSymbol: selectedSymbolAtThatMoment,
    affectedSymbol: symbol,
    eventType: "MARKET_TICK",
    sourceFunction: "applyMarketTickToPaperState.finalize",
  });
}

export function closePositionManually(state, { positionId, symbol, timeframe, price, reason = "MANUAL_CLOSE" }) {
  const open = positionId
    ? state.openPositions.find((position) => position.id === positionId)
    : state.openPositions.find((position) => position.symbol === symbol && position.timeframe === timeframe);
  if (!open) return state;
  return closePosition(state, {
    positionId: open.id,
    exitPrice: asSafeNumber(price, open.currentPrice),
    closeReason: reason,
    triggeredBy: "MANUAL_ACTION",
    selectedSymbolAtThatMoment: symbol || open.symbol,
    marketSymbolUsed: open.symbol,
  });
}

export function cancelPendingOrderManually(state, { orderId, reason = "MANUAL_CANCEL", cancelledAt = nowIso() }) {
  if (!orderId) return state;
  const targetOrder = (state.pendingOrders || []).find((order) => order.id === orderId && order.status === "PENDING");
  if (!targetOrder) return state;

  let nextState = recalculateAccountState({
    ...state,
    pendingOrders: (state.pendingOrders || []).filter((order) => order.id !== orderId),
    cancelledOrders: [cancelPendingOrder(targetOrder, reason, cancelledAt, { triggeredBy: "MANUAL_ACTION" }), ...(state.cancelledOrders || [])]
      .slice(0, MAX_CANCELLED_ORDERS_HISTORY),
  }, {
    timestamp: cancelledAt,
    selectedSymbol: targetOrder.symbol,
    affectedSymbol: targetOrder.symbol,
    eventType: "CANCEL_ORDER",
    sourceFunction: "cancelPendingOrderManually",
  });
  nextState = appendOrderLifecycleEvent(nextState, {
    symbol: targetOrder.symbol,
    orderId: targetOrder.id,
    eventType: "CANCELED",
    reason,
    triggeredBy: "MANUAL_ACTION",
    timestamp: cancelledAt,
    selectedSymbolAtThatMoment: targetOrder.symbol,
    marketSymbolUsed: targetOrder.symbol,
    entryPrice: targetOrder.triggerPrice,
    checkedFunctionName: "cancelPendingOrderManually",
  });
  return appendPendingCancelTrace(nextState, {
    timestamp: cancelledAt,
    orderId: targetOrder.id,
    orderSymbol: targetOrder.symbol,
    selectedSymbolAtThatMoment: targetOrder.symbol,
    marketSymbolUsed: targetOrder.symbol,
    reason,
    triggeredBy: "MANUAL_ACTION",
    entryPrice: targetOrder.triggerPrice,
    checkedFunctionName: "cancelPendingOrderManually",
  });
}

export function resetPaperTradingState() {
  return createInitialPaperAccountState();
}

export function normalizePaperAccountState(state, { eventType = "RESTORE", sourceFunction = "normalizePaperAccountState" } = {}) {
  return recalculateAccountState({
    ...createInitialPaperAccountState(),
    ...(state || {}),
    openPositions: Array.isArray(state?.openPositions) ? state.openPositions : [],
    pendingOrders: Array.isArray(state?.pendingOrders) ? state.pendingOrders : [],
    cancelledOrders: Array.isArray(state?.cancelledOrders) ? state.cancelledOrders : [],
    closedTrades: Array.isArray(state?.closedTrades) ? state.closedTrades : [],
  }, {
    eventType,
    sourceFunction,
    selectedSymbol: null,
    affectedSymbol: null,
  });
}

export const paperTradingConstants = {
  DEFAULT_BALANCE,
  DEFAULT_POSITION_SIZE,
  DEFAULT_LEVERAGE,
};

export const paperTradingAnalytics = {
  buildSetupContext,
  buildSetupKey,
  buildCoarseSetupKey,
  buildPerformanceMap,
  buildPerformanceSnapshot,
};
