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
const DEFAULT_SETUP_TIMEOUT_BARS = 20;
const DEFAULT_TREND_ENTRY_CLAMP_PCT = 0.002;
const DEFAULT_RANGE_ENTRY_CLAMP_PCT = 0.0008;
const PRE_ARM_LONG_UPPER_ZONE_BUFFER_RATIO = 0.2;
const DEFAULT_REENTRY_MAX_ATTEMPTS = 2;
const DEFAULT_REENTRY_FAIL_LIMIT = 2;
const DEFAULT_REENTRY_PULLBACK_ATR_RATIO = 0.15;
const DEFAULT_REENTRY_MIN_DISTANCE_PCT = 0.0004;
const DEFAULT_BREAKOUT_VOLUME_MULTIPLIER = 1.2;
const DEFAULT_BREAKOUT_HOLD_BARS = 1;
const DEFAULT_FAKE_BREAK_MAX_BARS = 1;
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
const DRAFT_WAITING_REASON_KEYS = new Set([
  "blockedByKlineConfirmation",
  "waitingForPullback",
  "waitingForBreakout",
]);

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

function buildActiveSetupKey(symbol, timeframe) {
  return [symbol || "-", timeframe || "-"].join("|");
}

function normalizeSetupTypeValue(value) {
  return String(value || "").trim().toLowerCase();
}

function logSetupTypeOverwriteDebug({
  symbol,
  side,
  previousSetupType,
  nextSetupType,
  sourceFunction,
  reason,
}) {
  const prev = normalizeSetupTypeValue(previousSetupType);
  const next = normalizeSetupTypeValue(nextSetupType);
  if (prev && next && prev !== next) {
    console.warn(
      "[SETUP_TYPE_OVERWRITE_DEBUG]\n" +
      `symbol=${symbol ?? "-"}\n` +
      `side=${side ?? "-"}\n` +
      `previousSetupType=${previousSetupType ?? null}\n` +
      `nextSetupType=${nextSetupType ?? null}\n` +
      `sourceFunction=${sourceFunction ?? "unknown"}\n` +
      `reason=${reason ?? "setup_type_changed"}`
    );
  }
}

function logExecutionIntentOverwriteDebug({
  symbol,
  side,
  previousIntent,
  nextIntent,
  sourceFunction,
  reason,
}) {
  if (previousIntent && nextIntent && previousIntent !== nextIntent) {
    console.warn(
      "[EXECUTION_INTENT_OVERWRITE_DEBUG]\n" +
      `symbol=${symbol ?? "-"}\n` +
      `side=${side ?? "-"}\n` +
      `previousIntent=${previousIntent}\n` +
      `nextIntent=${nextIntent}\n` +
      `sourceFunction=${sourceFunction ?? "unknown"}\n` +
      `reason=${reason ?? "execution_intent_changed"}`
    );
  }
}

function assignDecisionSetupType(decision, nextSetupType, context = {}) {
  const previousSetupType = decision?.setupType ?? null;
  const isPullbackLocked = normalizeSetupTypeValue(decision?.__lockedSetupType) === "pullback";
  logSetupTypeOverwriteDebug({
    ...context,
    previousSetupType,
    nextSetupType,
  });
  if (isPullbackLocked && normalizeSetupTypeValue(previousSetupType) === "pullback" && normalizeSetupTypeValue(nextSetupType) === "no-trade") {
    return previousSetupType;
  }
  decision.setupType = nextSetupType;
  return decision.setupType;
}

function assignExecutionPlanSetupType(decision, nextSetupType, context = {}) {
  const previousSetupType = decision?.executionPlan?.setupType ?? null;
  const isPullbackLocked = normalizeSetupTypeValue(decision?.__lockedSetupType) === "pullback";
  logSetupTypeOverwriteDebug({
    ...context,
    previousSetupType,
    nextSetupType,
  });
  if (isPullbackLocked && normalizeSetupTypeValue(previousSetupType) === "pullback" && normalizeSetupTypeValue(nextSetupType) === "no-trade") {
    return previousSetupType;
  }
  decision.executionPlan = {
    ...(decision.executionPlan || {}),
    setupType: nextSetupType,
  };
  return decision.executionPlan.setupType;
}

function lockPullbackSetupType(decision, context = {}) {
  decision.__lockedSetupType = "pullback";
  assignDecisionSetupType(decision, "pullback", context);
  assignExecutionPlanSetupType(decision, "pullback", context);
}

function resolveExecutionPlanEntryRange(decision) {
  const rawRange = decision?.executionPlan?.entryRange;
  if (!rawRange) return { low: undefined, high: undefined };
  if (Array.isArray(rawRange)) {
    return {
      low: normalizeNumber(rawRange[0]),
      high: normalizeNumber(rawRange[1]),
    };
  }
  if (typeof rawRange === "object") {
    return {
      low: normalizeNumber(rawRange?.low),
      high: normalizeNumber(rawRange?.high),
    };
  }
  return { low: undefined, high: undefined };
}

function buildLockedSetupFromDecision({
  decision,
  signalContext,
  symbol,
  timeframe,
  side,
  executionMode,
}) {
  const setupId = buildDecisionContextKey(decision, symbol, timeframe);
  const entryRange = resolveExecutionPlanEntryRange(decision);
  const entryLow = normalizeNumber(entryRange.low ?? decision?.executionPlan?.entryLow ?? decision?.entryLow);
  const entryHigh = normalizeNumber(entryRange.high ?? decision?.executionPlan?.entryHigh ?? decision?.entryHigh);
  const zoneLow = Number.isFinite(entryLow) && Number.isFinite(entryHigh) ? Math.min(entryLow, entryHigh) : undefined;
  const zoneHigh = Number.isFinite(entryLow) && Number.isFinite(entryHigh) ? Math.max(entryLow, entryHigh) : undefined;
  const stopPrice = normalizeNumber(
    decision?.executionPlan?.stop ??
    decision?.executionPlan?.stopLoss ??
    decision?.stop ??
    decision?.stopLoss ??
    decision?.invalidationPrice
  );
  const createdAt = nowIso();
  return {
    setupId,
    symbol,
    timeframe,
    side,
    strategyType: decision?.strategyType ?? decision?.executionPlan?.setupType ?? decision?.setupType ?? null,
    executionMode,
    entryZoneLow: zoneLow,
    entryZoneHigh: zoneHigh,
    triggerPrice: normalizeNumber(decision?.executionPlan?.triggerPrice ?? decision?.triggerPrice),
    support: normalizeNumber(signalContext?.structure?.supportLow ?? decision?.levels?.structureSupportZone?.low),
    resistance: normalizeNumber(signalContext?.structure?.resistanceHigh ?? decision?.levels?.structureResistanceZone?.high),
    stopPrice,
    tp1: normalizeNumber(decision?.executionPlan?.takeProfit ?? decision?.executionPlan?.takeProfit1 ?? decision?.takeProfit ?? decision?.takeProfit1),
    tp2: normalizeNumber(decision?.executionPlan?.takeProfit2 ?? decision?.takeProfit2),
    setupCreatedAt: createdAt,
    setupCreatedCandleTime: normalizeBarTime(signalContext?.candleTime),
    mtfContext: {
      aligned: signalContext?.mtf?.aligned ?? decision?.multiTimeframe?.aligned ?? null,
      score: normalizeNumber(signalContext?.mtf?.score ?? decision?.multiTimeframe?.score),
      disagreement: signalContext?.mtf?.disagreement ?? decision?.multiTimeframe?.disagreement ?? null,
    },
    decisionSnapshot: {
      action: decision?.action ?? decision?.executionPlan?.action ?? null,
      setupType: decision?.setupType ?? decision?.executionPlan?.setupType ?? null,
      breakoutState: decision?.breakoutState ?? null,
      structure: decision?.structure ?? null,
      rsi: normalizeNumber(decision?.rsi),
      macdHistogram: normalizeNumber(decision?.macdHistogram ?? decision?.macd?.histogram),
      mtfAligned: decision?.multiTimeframe?.aligned ?? null,
    },
    status: "ACTIVE",
    invalidationReason: null,
    releasedAt: null,
  };
}

function getLockedSetup(state, symbol, timeframe) {
  return state?.activeSetups?.[buildActiveSetupKey(symbol, timeframe)] || null;
}

function lockSetup(state, setup) {
  const setupKey = buildActiveSetupKey(setup?.symbol, setup?.timeframe);
  const existing = state?.activeSetups?.[setupKey];
  if (existing && existing.status === "ACTIVE" && existing.setupId !== setup.setupId) {
    console.info("[SETUP_RELEASED]", { setupId: existing.setupId, symbol: existing.symbol, timeframe: existing.timeframe, reason: "REPLACED" });
  }
  console.info("[SETUP_LOCKED]", {
    setupId: setup.setupId,
    symbol: setup.symbol,
    timeframe: setup.timeframe,
    executionMode: setup.executionMode,
    entryZoneLow: setup.entryZoneLow,
    entryZoneHigh: setup.entryZoneHigh,
    triggerPrice: setup.triggerPrice,
  });
  return {
    ...state,
    activeSetups: {
      ...(state?.activeSetups || {}),
      [setupKey]: setup,
    },
    lastReleasedSetup: state?.lastReleasedSetup || null,
  };
}

function releaseSetup(state, setup, reason, metadata = {}) {
  if (!setup) return state;
  const setupKey = buildActiveSetupKey(setup.symbol, setup.timeframe);
  const nextSetup = {
    ...setup,
    status: reason === "TIMEOUT_INVALIDATED" ? "EXPIRED" : reason === "TRIGGERED" ? "TRIGGERED" : "INVALIDATED",
    invalidationReason: reason,
    releasedAt: metadata.timestamp || nowIso(),
  };
  console.info("[SETUP_RELEASED]", {
    setupId: setup.setupId,
    symbol: setup.symbol,
    timeframe: setup.timeframe,
    reason,
  });
  return {
    ...state,
    activeSetups: {
      ...(state?.activeSetups || {}),
      [setupKey]: nextSetup,
    },
    lastReleasedSetup: nextSetup,
  };
}

function isDraftLikeWaitingOrder(order) {
  const waitingReasons = Array.isArray(order?.waitingReasons) ? order.waitingReasons : [];
  return waitingReasons.some((reason) => DRAFT_WAITING_REASON_KEYS.has(reason));
}

function isExecutionPlanValidatedOrder(order) {
  return Boolean(order?.executionPlanValidated);
}

export function isFormalPendingOrder(order) {
  if (!order || typeof order !== "object") return false;
  if (!order.id || !order.createdAt) return false;
  if (!["PENDING", "ACTIVE"].includes(order.status)) return false;
  if (!isExecutionPlanValidatedOrder(order)) return false;
  if (isDraftLikeWaitingOrder(order)) return false;
  return true;
}

export function isFormalCancelledOrder(order) {
  if (!order || typeof order !== "object") return false;
  if (order.status !== "CANCELLED") return false;
  if (!order.cancelledAt || !order.createdAt || !order.id) return false;
  if (!isExecutionPlanValidatedOrder(order)) return false;
  if (isDraftLikeWaitingOrder(order)) return false;
  if (order.cancelReason === "INVALID_EXECUTION_PLAN_BLOCKED") return false;
  return true;
}

function appendBlockedAttempt(state, payload) {
  const next = [{
    timestamp: payload?.timestamp || nowIso(),
    reasonCode: payload?.reasonCode || "BLOCKED_ATTEMPT",
    symbol: payload?.symbol || null,
    timeframe: payload?.timeframe || null,
    side: payload?.side || null,
    orderId: payload?.orderId || null,
    details: payload?.details || null,
  }, ...(state?.blockedAttempts || [])].slice(0, 300);
  return {
    ...state,
    blockedAttempts: next,
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
  const executionMode = String(decision?.executionPlan?.executionMode ?? decision?.executionMode ?? "").toUpperCase();
  if (executionMode === "PULLBACK") return "pullback";
  if (executionMode === "BREAKOUT") return "breakout";
  const setupType = String(decision?.setupType ?? decision?.executionPlan?.setupType ?? "").toLowerCase();
  const strategyType = resolveStrategyType(decision);
  const hasPullbackZone = Number.isFinite(normalizeNumber(decision?.executionPlan?.entryLow ?? decision?.entryLow)) &&
    Number.isFinite(normalizeNumber(decision?.executionPlan?.entryHigh ?? decision?.entryHigh));

  if (strategyType === "range" || strategyType === "pullback") return "pullback";
  if (setupType === "pullback") return "pullback";
  if (setupType === "breakout") return "breakout";
  if (hasPullbackZone) return "pullback";
  return "pullback";
}

function resolveStrategyType(decision = {}) {
  return String(
    decision?.strategyType ??
    decision?.setupType ??
    decision?.executionPlan?.setupType ??
    decision?.marketRegimeLabel ??
    decision?.regime ??
    ""
  ).toLowerCase();
}

function resolveEntrySourceFunction(decision, side, mode) {
  const executionEntry = decision?.executionPlan?.entry;
  if (executionEntry != null) return "executionPlan.entry";
  return "unknown";
}

function resolvePlannedEntryPrice(decision, side) {
  const mode = resolveEntryMode(decision);
  const sourceFunction = resolveEntrySourceFunction(decision, side, mode);
  const executionEntry = decision?.executionPlan?.entry;
  if (executionEntry != null && typeof executionEntry === "object") {
    const low = normalizeNumber(executionEntry?.low);
    const high = normalizeNumber(executionEntry?.high);
    if (side === "LONG" && Number.isFinite(low)) return { entryPrice: low, mode, sourceFunction };
    if (side === "SHORT" && Number.isFinite(high)) return { entryPrice: high, mode, sourceFunction };
    return { entryPrice: undefined, mode, sourceFunction };
  }
  return { entryPrice: normalizeNumber(executionEntry), mode, sourceFunction };
}

function buildExecutionPlanSnapshot(decision, symbol, timeframe, selectedSize) {
  const executionPlan = decision?.executionPlan || {};
  const side = resolveSideFromDecision(decision);
  const setupIdRaw = executionPlan?.setupId ?? decision?.setupId ?? decision?.signalId ?? decision?.id;
  const setupId = setupIdRaw != null ? String(setupIdRaw) : null;
  const entryZoneLow = normalizeNumber(executionPlan?.entryLow ?? executionPlan?.entryZoneLow);
  const entryZoneHigh = normalizeNumber(executionPlan?.entryHigh ?? executionPlan?.entryZoneHigh);
  const stopLoss = normalizeNumber(
    executionPlan?.stopLoss ??
    executionPlan?.stop ??
    executionPlan?.invalidationPrice
  );
  const takeProfits = [
    normalizeNumber(executionPlan?.takeProfit1 ?? executionPlan?.takeProfit ?? executionPlan?.tp),
    normalizeNumber(executionPlan?.takeProfit2),
    normalizeNumber(executionPlan?.takeProfit3),
  ].filter((value) => Number.isFinite(value));

  const normalizedLow = Number.isFinite(entryZoneLow) && Number.isFinite(entryZoneHigh)
    ? Math.min(entryZoneLow, entryZoneHigh)
    : entryZoneLow;
  const normalizedHigh = Number.isFinite(entryZoneLow) && Number.isFinite(entryZoneHigh)
    ? Math.max(entryZoneLow, entryZoneHigh)
    : entryZoneHigh;
  const size = asSafeNumber(selectedSize, DEFAULT_POSITION_SIZE);
  const complete = Boolean(
    symbol &&
    side &&
    setupId &&
    Number.isFinite(normalizedLow) &&
    Number.isFinite(normalizedHigh) &&
    Number.isFinite(stopLoss) &&
    takeProfits.length > 0 &&
    size > 0
  );

  return {
    symbol,
    timeframe,
    side,
    setupId,
    entryZoneLow: normalizedLow,
    entryZoneHigh: normalizedHigh,
    stopLoss,
    takeProfits,
    selectedSize: size,
    complete,
  };
}

function createPendingOrderFromExecutionPlan(planSnapshot, selectedSize) {
  if (!planSnapshot?.complete) return null;
  const side = planSnapshot.side;
  const finalEntry = side === "SHORT"
    ? normalizeNumber(planSnapshot.entryZoneHigh)
    : normalizeNumber(planSnapshot.entryZoneLow);
  const size = Math.max(0, asSafeNumber(selectedSize, planSnapshot.selectedSize));
  if (!Number.isFinite(finalEntry) || size <= 0) return null;
  return {
    entryPrice: finalEntry,
    stopLoss: normalizeNumber(planSnapshot.stopLoss),
    takeProfit1: normalizeNumber(planSnapshot.takeProfits?.[0]),
    takeProfit2: normalizeNumber(planSnapshot.takeProfits?.[1]),
    takeProfit3: normalizeNumber(planSnapshot.takeProfits?.[2]),
    quantity: size,
  };
}

function validateExecutionPlanConsistency({ side, entryPrice, normalizedLevels, executionMode, sourceFunction }) {
  if (!Number.isFinite(entryPrice) || !normalizedLevels) return { valid: true };
  const takeProfit1 = normalizeNumber(normalizedLevels.takeProfit1);
  const takeProfit2 = normalizeNumber(normalizedLevels.takeProfit2);
  const stopLoss = normalizeNumber(normalizedLevels.stopLoss);
  const violations = [];
  const normalizedExecutionMode = String(executionMode || "").toUpperCase();
  const normalizedSourceFunction = String(sourceFunction || "");
  const sourceFromTargetEntryZone = /entryMid|entryLow|entryHigh/.test(normalizedSourceFunction);
  const sourceFromTriggerPrice = normalizedSourceFunction.includes("triggerPrice");

  if (normalizedExecutionMode === "PULLBACK") {
    if (!sourceFromTargetEntryZone || sourceFromTriggerPrice) {
      violations.push("PULLBACK_ENTRY_SOURCE_MUST_BE_TARGET_ENTRY_ZONE");
    }
  } else if (normalizedExecutionMode === "BREAKOUT") {
    if (!sourceFromTriggerPrice || sourceFromTargetEntryZone) {
      violations.push("BREAKOUT_ENTRY_SOURCE_MUST_BE_TRIGGER_PRICE");
    }
  }

  if (side === "LONG") {
    if (!Number.isFinite(takeProfit1) || takeProfit1 <= entryPrice) violations.push("LONG_ENTRY_MUST_BE_BELOW_TP1");
    if (!Number.isFinite(takeProfit2) || takeProfit2 <= entryPrice) violations.push("LONG_ENTRY_MUST_BE_BELOW_TP2");
    if (!Number.isFinite(stopLoss) || stopLoss >= entryPrice) violations.push("LONG_STOP_MUST_BE_BELOW_ENTRY");
  } else if (side === "SHORT") {
    if (!Number.isFinite(takeProfit1) || takeProfit1 >= entryPrice) violations.push("SHORT_ENTRY_MUST_BE_ABOVE_TP1");
    if (!Number.isFinite(takeProfit2) || takeProfit2 >= entryPrice) violations.push("SHORT_ENTRY_MUST_BE_ABOVE_TP2");
    if (!Number.isFinite(stopLoss) || stopLoss <= entryPrice) violations.push("SHORT_STOP_MUST_BE_ABOVE_ENTRY");
  }
  if (!violations.length) return { valid: true };
  return {
    valid: false,
    violations,
    entryPrice,
    stopLoss,
    takeProfit1,
    takeProfit2,
  };
}

function resolveRangeBoundarySnapshot(decision, signalContext = {}) {
  const structure = signalContext?.structure ?? decision?.structure ?? decision?.executionPlan?.structure ?? {};
  const support = normalizeNumber(
    structure?.supportHigh ??
    structure?.supportLow ??
    decision?.executionPlan?.entryLow ??
    decision?.entryLow
  );
  const resistance = normalizeNumber(
    structure?.resistanceLow ??
    structure?.resistanceHigh ??
    decision?.executionPlan?.entryHigh ??
    decision?.entryHigh
  );
  const zoneLowRaw = normalizeNumber(
    structure?.zoneLow ??
    structure?.supportLow ??
    decision?.executionPlan?.entryLow ??
    decision?.entryLow
  );
  const zoneHighRaw = normalizeNumber(
    structure?.zoneHigh ??
    structure?.resistanceHigh ??
    decision?.executionPlan?.entryHigh ??
    decision?.entryHigh
  );
  const zoneLow = Number.isFinite(zoneLowRaw) && Number.isFinite(zoneHighRaw) ? Math.min(zoneLowRaw, zoneHighRaw) : zoneLowRaw;
  const zoneHigh = Number.isFinite(zoneLowRaw) && Number.isFinite(zoneHighRaw) ? Math.max(zoneLowRaw, zoneHighRaw) : zoneHighRaw;
  return { support, resistance, zoneLow, zoneHigh };
}

function isRangeLikeStrategy(decision, signalContext = {}) {
  const setupType = String(decision?.setupType ?? decision?.executionPlan?.setupType ?? "").toLowerCase();
  const marketRegime = String(decision?.marketRegimeLabel ?? decision?.regime ?? signalContext?.marketRegime ?? "").toLowerCase();
  return setupType === "range" || marketRegime === "range" || marketRegime === "ranging";
}

function shouldBlockInvalidRangeLongEntry({
  side,
  decision,
  signalContext,
  currentPrice,
  entryPrice,
  support,
  resistance,
  zoneLow,
  zoneHigh,
}) {
  if (side !== "LONG") return null;
  const setupType = String(decision?.setupType ?? decision?.executionPlan?.setupType ?? "").toLowerCase();
  const isBreakoutStrategy = setupType === "breakout";
  const isRangeStrategy = isRangeLikeStrategy(decision, signalContext);
  if (!Number.isFinite(currentPrice) || !Number.isFinite(entryPrice)) return "INVALID_PRICE_INPUT";
  if (!isBreakoutStrategy && entryPrice > currentPrice) return "NON_BREAKOUT_LONG_ENTRY_ABOVE_CURRENT_PRICE";

  const upperBoundaryCandidates = [resistance, zoneHigh].filter((value) => Number.isFinite(value));
  if (!upperBoundaryCandidates.length) return null;
  const upperBoundary = Math.min(...upperBoundaryCandidates);
  if (!isBreakoutStrategy && entryPrice >= upperBoundary) {
    return "NON_BREAKOUT_LONG_ENTRY_AT_OR_ABOVE_UPPER_ZONE";
  }
  if (!isRangeStrategy) return null;
  if (entryPrice > currentPrice) return "LONG_ENTRY_ABOVE_CURRENT_PRICE";

  const rangeLowCandidates = [support, zoneLow].filter((value) => Number.isFinite(value));
  if (entryPrice >= upperBoundary) return "LONG_ENTRY_AT_OR_ABOVE_RESISTANCE";
  if (rangeLowCandidates.length) {
    const rangeLow = Math.min(...rangeLowCandidates);
    const rangeWidth = upperBoundary - rangeLow;
    if (rangeWidth > 0) {
      const distanceToUpper = upperBoundary - entryPrice;
      if (distanceToUpper <= rangeWidth * 0.2) return "LONG_ENTRY_NEAR_UPPER_ZONE";
    }
  }
  return null;
}

function evaluateConditionalPendingEligibility({
  decision,
  side,
  currentPrice,
  entryPrice,
  rangeBoundary = {},
  setupContext = {},
}) {
  const candidateSetupType = String(setupContext?.candidateSetupType || "").toLowerCase();
  const executionMode = String(setupContext?.executionMode || "").toUpperCase();
  const isPullbackLongSetup = side === "LONG" && (candidateSetupType === "pullback" || executionMode === "PULLBACK");
  const strategyType = resolveStrategyType(decision);
  const allowedStrategy = isPullbackLongSetup ? true : (strategyType === "range" || strategyType === "pullback");
  const canEvaluatePrice = Number.isFinite(currentPrice) && Number.isFinite(entryPrice);
  const zoneLow = normalizeNumber(rangeBoundary?.zoneLow);
  const zoneHigh = normalizeNumber(rangeBoundary?.zoneHigh);
  const support = normalizeNumber(rangeBoundary?.support);
  const resistance = normalizeNumber(rangeBoundary?.resistance);
  const lowerCandidates = [zoneLow, support].filter((value) => Number.isFinite(value));
  const upperCandidates = [zoneHigh, resistance].filter((value) => Number.isFinite(value));
  const hasEntryZone = lowerCandidates.length > 0 && upperCandidates.length > 0;
  const lowerBoundary = hasEntryZone ? Math.min(...lowerCandidates) : null;
  const upperBoundary = hasEntryZone ? Math.max(...upperCandidates) : null;
  const rangeWidth = Number.isFinite(lowerBoundary) && Number.isFinite(upperBoundary)
    ? Math.max(upperBoundary - lowerBoundary, 0)
    : 0;
  const nearUpperZone = side === "LONG" &&
    Number.isFinite(entryPrice) &&
    Number.isFinite(upperBoundary) &&
    rangeWidth > 0 &&
    (upperBoundary - entryPrice) <= rangeWidth * PRE_ARM_LONG_UPPER_ZONE_BUFFER_RATIO;
  const longEntryAboveCurrent = side === "LONG" && canEvaluatePrice && entryPrice > currentPrice;
  const unmetConditions = [];
  if (!allowedStrategy) unmetConditions.push("strategy_not_allowed");
  if (!hasEntryZone) unmetConditions.push("entry_zone_missing");
  if (!isPullbackLongSetup && longEntryAboveCurrent) unmetConditions.push("long_entry_above_current");
  if (!isPullbackLongSetup && nearUpperZone) unmetConditions.push("long_entry_near_resistance");
  const primaryBlockedReason = unmetConditions[0] || null;
  const reasons = [];
  if (allowedStrategy) reasons.push("strategyType 為 range/pullback");
  if (hasEntryZone) reasons.push("已識別有效 entry zone（支撐區）");
  if (side !== "LONG" || !longEntryAboveCurrent || isPullbackLongSetup) reasons.push("LONG entry 未高於 currentPrice");
  if (side !== "LONG" || !nearUpperZone || isPullbackLongSetup) reasons.push("未靠近 zoneHigh/resistance");
  const eligible = isPullbackLongSetup
    ? hasEntryZone
    : (allowedStrategy && hasEntryZone && !longEntryAboveCurrent && !nearUpperZone);

  return {
    eligible,
    candidateSetupType,
    strategyType,
    allowedStrategy,
    hasEntryZone,
    lowerBoundary,
    upperBoundary,
    longEntryAboveCurrent,
    nearUpperZone,
    reasons,
    unmetConditions,
    primaryBlockedReason,
    autoCancelConditions: [
      "結構破壞（STRUCTURE_CHANGED）",
      "動能轉弱（MOMENTUM_WEAKENED）",
      "失效區被擊穿（SETUP_INVALIDATED）",
    ],
  };
}

function applyEntryDistanceConstraint({
  side,
  entryPrice,
  currentPrice,
  atr,
  marketRegime,
  executionMode,
  constraintLayer = "pending",
}) {
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
  const isPullbackMode = String(executionMode || "").toUpperCase() === "PULLBACK";
  if (!Number.isFinite(atrValue) || atrValue <= 0) {
    return { entryPrice, wasAdjusted: false, distance, isRejected: false, isTooFarInRange: false, affectsFillOnly: false };
  }
  const distanceThresholdAtr = isTrendRegime ? 0.6 : 0.5;
  if (distance <= atrValue * distanceThresholdAtr) {
    return { entryPrice, wasAdjusted: false, distance, isRejected: false, isTooFarInRange: false, affectsFillOnly: false };
  }
  if (isRangeRegime) {
    if (isPullbackMode && constraintLayer === "pending") {
      return {
        entryPrice,
        wasAdjusted: false,
        distance,
        isRejected: false,
        rejectionReason: "ENTRY_TOO_FAR_IN_RANGE",
        isTooFarInRange: true,
        affectsFillOnly: true,
      };
    }
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
    isTooFarInRange: false,
    affectsFillOnly: false,
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

function resolveBreakoutGuardConfig(decision = {}) {
  const plan = decision?.executionPlan || {};
  const style = String(plan?.breakoutStyle ?? decision?.breakoutStyle ?? "CONSERVATIVE").toUpperCase();
  const aggressive = style === "AGGRESSIVE";
  return {
    breakoutCloseRequired: plan?.breakoutCloseRequired !== false,
    breakoutVolumeMultiplier: normalizeNumber(plan?.breakoutVolumeMultiplier) ?? DEFAULT_BREAKOUT_VOLUME_MULTIPLIER,
    breakoutHoldBars: Math.max(0, Math.floor(normalizeNumber(plan?.breakoutHoldBars) ?? (aggressive ? 0 : DEFAULT_BREAKOUT_HOLD_BARS))),
    breakoutRetestRequired: Boolean(plan?.breakoutRetestRequired),
    fakeBreakMaxBars: Math.max(1, Math.floor(normalizeNumber(plan?.fakeBreakMaxBars) ?? DEFAULT_FAKE_BREAK_MAX_BARS)),
    breakoutStyle: aggressive ? "AGGRESSIVE" : "CONSERVATIVE",
  };
}

function evaluateBreakoutConfirmationGuard({ decision, side, signalContext = {}, triggerPrice }) {
  const executionMode = String(decision?.executionPlan?.executionMode ?? decision?.executionMode ?? "").toUpperCase();
  if (executionMode !== "BREAKOUT") return { applies: false, confirmed: true, breakoutSetupState: null, checklist: null };
  const trigger = normalizeNumber(triggerPrice);
  if (!Number.isFinite(trigger) || !side) return { applies: true, confirmed: false, breakoutSetupState: "WAIT_BREAKOUT" };
  const cfg = resolveBreakoutGuardConfig(decision);
  const high = normalizeNumber(signalContext?.candleHigh ?? signalContext?.high);
  const low = normalizeNumber(signalContext?.candleLow ?? signalContext?.low);
  const close = normalizeNumber(signalContext?.candleClose ?? signalContext?.close);
  const prevClose = normalizeNumber(signalContext?.prevClose);
  const volume = normalizeNumber(signalContext?.currentVolume);
  const volumeMA20 = normalizeNumber(signalContext?.avgVolume20);
  const volumeThreshold = Number.isFinite(volumeMA20) && volumeMA20 > 0 ? volumeMA20 * cfg.breakoutVolumeMultiplier : null;
  const volumeConfirmed = !Number.isFinite(volumeThreshold) || !Number.isFinite(volume) ? true : volume >= volumeThreshold;
  const breakDetected = side === "LONG" ? high > trigger : low < trigger;
  const closeConfirmed = cfg.breakoutCloseRequired ? (side === "LONG" ? close > trigger : close < trigger) : breakDetected;
  const holdConfirmed = cfg.breakoutHoldBars <= 0
    ? true
    : Number.isFinite(prevClose) && (side === "LONG" ? prevClose > trigger && close > trigger : prevClose < trigger && close < trigger);
  const retestConfirmed = !cfg.breakoutRetestRequired
    ? true
    : side === "LONG"
      ? Number.isFinite(low) && low <= trigger && close > trigger
      : Number.isFinite(high) && high >= trigger && close < trigger;
  const holdOrRetestConfirmed = cfg.breakoutRetestRequired ? retestConfirmed : holdConfirmed;
  const conservativeConfirmed = breakDetected && closeConfirmed && volumeConfirmed && holdOrRetestConfirmed;
  const aggressiveConfirmed = breakDetected && closeConfirmed && volumeConfirmed;
  const confirmed = cfg.breakoutStyle === "AGGRESSIVE" ? aggressiveConfirmed : conservativeConfirmed;
  const fakeByClose = breakDetected && !closeConfirmed;
  const fakeByFastRevert = closeConfirmed && Number.isFinite(prevClose) && (side === "LONG" ? prevClose <= trigger : prevClose >= trigger);
  const fakeByRetestFail = cfg.breakoutRetestRequired && !retestConfirmed && closeConfirmed;
  const fakeByVolume = closeConfirmed && !volumeConfirmed;
  const fakeBreakout = fakeByClose || fakeByFastRevert || fakeByRetestFail || fakeByVolume;
  const breakoutSetupState = !breakDetected
    ? "WAIT_BREAKOUT"
    : confirmed
      ? "BREAKOUT_CONFIRMED"
      : fakeBreakout
        ? "BREAKOUT_FAKE"
        : closeConfirmed
          ? "BREAKOUT_CONFIRMING"
          : "BREAK_DETECTED";
  const confirmMethod = cfg.breakoutStyle === "AGGRESSIVE"
    ? "AGGRESSIVE"
    : (cfg.breakoutRetestRequired ? "RETEST" : "HOLD");
  const breakoutStyle = cfg.breakoutStyle;
  return {
    applies: true,
    confirmed,
    fakeBreakout,
    breakoutSetupState,
    confirmMethod,
    waitingReason: !breakDetected
      ? `尚未突破 trigger ${trigger}`
      : !closeConfirmed
        ? `價格已刺穿 ${trigger}，但收盤未站上/下 trigger，暫不追價`
        : !volumeConfirmed
          ? `已收盤突破 ${trigger}，但量能不足，暫不建立突破單`
          : !holdOrRetestConfirmed
            ? `已突破且量能達標，等待${cfg.breakoutRetestRequired ? "回踩確認" : "站穩確認"}後建立突破單`
            : "突破已確認，可建立突破單",
    checklist: {
      breakoutStyle,
      closeConfirmed,
      volumeConfirmed,
      holdOrRetestConfirmed,
      trigger,
    },
    metrics: {
      high, low, close, volume, volumeMA20, multiplier: cfg.breakoutVolumeMultiplier,
    },
  };
}

function resolveExecutionOrderType(decision) {
  const normalized = String(
    decision?.executionPlan?.orderType ??
    decision?.orderType ??
    decision?.executionPlan?.entryType ??
    ""
  ).trim().toUpperCase();
  if (normalized.includes("MARKET")) return "MARKET";
  return "LIMIT";
}

export function getSimulationEligibility(decision, currentPrice, signalContext = {}, options = {}) {
  const bypassSetupGate = shouldBypassSetupGate(options);
  const confirmationResult = runConfirmationEngine(buildConfirmationPayload(decision, currentPrice, signalContext));
  let executionIntent = mapDecisionTypeToExecutionIntent(confirmationResult.decisionType, confirmationResult);
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
  const executionOrderType = resolveExecutionOrderType(decision);
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
  if (executionReadiness.readyToExecute && executionOrderType === "MARKET") {
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
    pendingFillExecutions: [],
    pendingCancelTrace: [],
    activeSetups: {},
    lastReleasedSetup: null,
    setupDrafts: [],
    blockedAttempts: [],
    orderFillEventLocks: {},
    orderToPositionMap: {},
    orderProcessingLocks: {},
    filledOrderIds: {},
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

function appendPendingFillExecutionTrace(state, payload) {
  return {
    ...state,
    pendingFillExecutions: [payload, ...(state?.pendingFillExecutions || [])].slice(0, 1000),
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

function isAllowedAutomaticPendingCancelReason(reason) {
  return reason === "STRUCTURE_INVALIDATED";
}

function logPendingCancelBlocked(order, cancelReason) {
  console.warn(
    "[PENDING_CANCEL_BLOCKED]\n" +
    `symbol=${order?.symbol || ""}\n` +
    `side=${order?.side || ""}\n` +
    `pendingId=${order?.id || ""}\n` +
    `cancelReason=${cancelReason || "UNKNOWN"}\n` +
    "allowed=false"
  );
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

function resolvePendingFillEventId({ triggeredBy, symbol, candleTime, timestamp }) {
  const normalizedCandleTime = normalizeBarTime(candleTime);
  if (Number.isFinite(normalizedCandleTime)) {
    return `${symbol || "UNKNOWN"}:candle:${normalizedCandleTime}`;
  }
  return `${triggeredBy || "UNKNOWN"}:${symbol || "UNKNOWN"}:ts:${timestamp || nowIso()}`;
}

function resolveOrderEntryPrice(order) {
  return normalizeNumber(order?.entryPrice ?? order?.triggerPrice);
}

function evaluatePendingOrderFill(order, {
  tickPrice,
  candleHigh,
  candleLow,
  candleTime,
}) {
  const entryPrice = resolveOrderEntryPrice(order);
  const orderType = String(order?.orderType || "LIMIT").toUpperCase();
  if (orderType === "MARKET") {
    if (!Number.isFinite(entryPrice)) {
      return { shouldFill: false, reason: "INVALID_MARKET_ENTRY_PRICE", triggerSource: null };
    }
    return { shouldFill: true, reason: "MARKET_EXECUTE_NOW", triggerSource: "MARKET_ORDER" };
  }
  if (!Number.isFinite(entryPrice)) {
    return { shouldFill: false, reason: "INVALID_TRIGGER_PRICE", triggerSource: null };
  }

  const hasTick = Number.isFinite(tickPrice);
  const hasLow = Number.isFinite(candleLow);
  const hasHigh = Number.isFinite(candleHigh);
  if (order.side !== "LONG" && order.side !== "SHORT") {
    return { shouldFill: false, reason: "INVALID_ORDER_SIDE", triggerSource: null };
  }
  const fillDistanceConstraint = applyEntryDistanceConstraint({
    side: order.side,
    entryPrice,
    currentPrice: tickPrice,
    atr: order?.placementSnapshot?.atr,
    marketRegime: order?.decisionSnapshot?.marketRegimeLabel ||
      order?.decisionSnapshot?.regime ||
      order?.placementSnapshot?.marketRegime,
    executionMode: order?.executionMode,
    constraintLayer: "fill",
  });
  if (String(order?.executionMode || "").toUpperCase() === "PULLBACK") {
    console.log(
      "[ENTRY_DISTANCE_CHECK]\n" +
      `symbol=${order?.symbol || "UNKNOWN"}\n` +
      `distance=${Number.isFinite(fillDistanceConstraint?.distance) ? fillDistanceConstraint.distance : "NA"}\n` +
      `isTooFar=${Boolean(fillDistanceConstraint?.isTooFarInRange)}\n` +
      "affectsFillOnly=true"
    );
  }
  if (fillDistanceConstraint?.isRejected && String(fillDistanceConstraint?.rejectionReason || "").includes("TOO_FAR")) {
    return { shouldFill: false, reason: "ENTRY_TOO_FAR_IN_RANGE", triggerSource: null };
  }
  const normalizedCandleTime = normalizeBarTime(candleTime);
  const createdCandleTime = normalizeBarTime(order?.createdCandleTime ?? order?.placementSnapshot?.createdCandleTime);
  const allowCandleTrigger = !Number.isFinite(normalizedCandleTime) ||
    !Number.isFinite(createdCandleTime) ||
    normalizedCandleTime > createdCandleTime;

  const resolveFillReason = (pricePoint) => {
    if (!Number.isFinite(pricePoint)) return "PRICE_CROSSED";
    return pricePoint === entryPrice ? "PRICE_TOUCHED" : "PRICE_CROSSED";
  };

  // Tick crossing (strict directional checks only).
  if (order.side === "LONG" && hasTick && tickPrice <= entryPrice) {
    return { shouldFill: true, reason: resolveFillReason(tickPrice), triggerSource: "MARKET_TICK" };
  }
  if (order.side === "SHORT" && hasTick && tickPrice >= entryPrice) {
    return { shouldFill: true, reason: resolveFillReason(tickPrice), triggerSource: "MARKET_TICK" };
  }

  if (!allowCandleTrigger) {
    return { shouldFill: false, reason: "WAIT_NEXT_CANDLE_AFTER_ORDER_PLACED", triggerSource: null };
  }

  // Candle crossing (strict directional checks only).
  if (order.side === "LONG" && hasLow && candleLow <= entryPrice) {
    return { shouldFill: true, reason: resolveFillReason(candleLow), triggerSource: "MARKET_CANDLE" };
  }
  if (order.side === "SHORT" && hasHigh && candleHigh >= entryPrice) {
    return { shouldFill: true, reason: resolveFillReason(candleHigh), triggerSource: "MARKET_CANDLE" };
  }

  if (!hasTick && !hasLow && !hasHigh) {
    return { shouldFill: false, reason: "NO_MARKET_DATA", triggerSource: null };
  }
  return { shouldFill: false, reason: "TRIGGER_NOT_REACHED", triggerSource: null };
}

function evaluatePullbackFillConfirmation(order, { candleOpen, candleClose, rsi }) {
  const executionMode = String(order?.executionMode || "").toUpperCase();
  if (executionMode !== "PULLBACK") {
    return { confirmationStatus: "NOT_APPLICABLE", blockedReason: null, bullishCheck: null, rsiValue: normalizeNumber(rsi), rsiGate: null, isConfirmed: true };
  }
  const side = String(order?.side || "").toUpperCase();
  const open = normalizeNumber(candleOpen);
  const close = normalizeNumber(candleClose);
  const rsiValue = normalizeNumber(rsi);
  const bullishCheck = side === "LONG"
    ? (Number.isFinite(open) && Number.isFinite(close) ? close >= open : true)
    : (Number.isFinite(open) && Number.isFinite(close) ? close <= open : true);
  const rsiThreshold = side === "LONG" ? 55 : 45;
  const rsiGate = !Number.isFinite(rsiValue) || (side === "LONG" ? rsiValue >= rsiThreshold : rsiValue <= rsiThreshold);
  const blockedReason = !bullishCheck ? "KLINE_CONFIRMATION_PENDING" : (!rsiGate ? "RSI_CONFIRMATION_PENDING" : null);
  return {
    confirmationStatus: blockedReason ? "BLOCKED" : "CONFIRMED",
    blockedReason,
    bullishCheck,
    rsiValue,
    rsiGate,
    isConfirmed: !blockedReason,
  };
}

function isAllowedPendingFillTrigger(triggeredBy) {
  const trigger = String(triggeredBy || "").toUpperCase();
  return trigger === "MARKET_TICK" || trigger === "MARKET_CANDLE";
}

function isInvalidFillPriceForSide(side, entryPrice, filledPrice) {
  if (!Number.isFinite(entryPrice) || !Number.isFinite(filledPrice)) return true;
  if (side === "LONG") return filledPrice > entryPrice;
  if (side === "SHORT") return filledPrice < entryPrice;
  return true;
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

function evaluateSetupInvalidation(setup, { tickPrice, candleTime, decision } = {}) {
  if (!setup || setup.status !== "ACTIVE") return null;
  const side = setup.side;
  if (!side) return null;
  const current = normalizeNumber(tickPrice);
  const stop = normalizeNumber(setup.stopPrice);
  const entryZoneLow = normalizeNumber(setup.entryZoneLow);
  const entryZoneHigh = normalizeNumber(setup.entryZoneHigh);
  const support = normalizeNumber(setup.support);
  const resistance = normalizeNumber(setup.resistance);
  const waitedBars = Number.isFinite(Number(candleTime))
    ? calculateBarsDelta(setup.setupCreatedCandleTime, candleTime)
    : null;

  const structureBroken = side === "LONG"
    ? ((Number.isFinite(stop) && current < stop) ||
      (Number.isFinite(entryZoneLow) && current < entryZoneLow) ||
      (Number.isFinite(support) && current < support))
    : ((Number.isFinite(stop) && current > stop) ||
      (Number.isFinite(entryZoneHigh) && current > entryZoneHigh) ||
      (Number.isFinite(resistance) && current > resistance));
  if (structureBroken) return { reason: "STRUCTURE_INVALIDATED", waitedBars };

  if (Number.isFinite(waitedBars) && waitedBars >= DEFAULT_SETUP_TIMEOUT_BARS) {
    return { reason: "TIMEOUT_INVALIDATED", waitedBars };
  }

  if (decision) {
    const rsi = normalizeNumber(decision?.rsi);
    const macdHistogram = normalizeNumber(decision?.macdHistogram ?? decision?.macd?.histogram);
    const mtfAligned = decision?.multiTimeframe?.aligned;
    const momentumBroken = side === "LONG"
      ? ((Number.isFinite(rsi) && rsi < 48) || (Number.isFinite(macdHistogram) && macdHistogram < 0) || mtfAligned === false)
      : ((Number.isFinite(rsi) && rsi > 52) || (Number.isFinite(macdHistogram) && macdHistogram > 0) || mtfAligned === false);
    if (momentumBroken) return { reason: "MOMENTUM_INVALIDATED", waitedBars };
  }
  return null;
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
  candleOpen,
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
  console.log("[EXECUTION_LOOP_START]", {
    functionName: "maybeFillPendingOrders",
    totalPendingOrders: (state?.pendingOrders || []).filter((order) => order?.status === "PENDING").length,
    symbol,
    triggeredBy,
  });
  const normalizedCandleTime = normalizeBarTime(candleTime);
  const eventId = resolvePendingFillEventId({ triggeredBy, symbol, candleTime, timestamp });
  const perEventFilledOrderIds = new Set();
  let nextState = {
    ...state,
    pendingOrders: [...state.pendingOrders],
    cancelledOrders: [...(state.cancelledOrders || [])],
    openPositions: [...state.openPositions],
    waitingDiagnostics: state?.waitingDiagnostics || createDefaultWaitingDiagnostics(),
    orderFillEventLocks: { ...(state?.orderFillEventLocks || {}) },
    orderToPositionMap: { ...(state?.orderToPositionMap || {}) },
    orderProcessingLocks: { ...(state?.orderProcessingLocks || {}) },
    filledOrderIds: { ...(state?.filledOrderIds || {}) },
  };
  console.debug("[paper-trading] pending orders check", {
    pendingOrdersCount: (nextState.pendingOrders || []).filter((order) => order.status === "PENDING").length,
    tickPrice,
    timestamp,
  });

  const nextPendingOrders = [];
  for (const order of nextState.pendingOrders) {
    if (order.status !== "PENDING") {
      nextPendingOrders.push(order);
      continue;
    }
    console.log("[PENDING_FOUND]", {
      pendingId: order.id,
      symbol: order.symbol,
      timeframe: order.timeframe,
      side: order.side,
      entryMode: order.entryMode || null,
    });
    const checkedFunctionName = "maybeFillPendingOrders";
    const scopedMarket = (marketDataBySymbol && order.symbol)
      ? marketDataBySymbol[order.symbol]
      : null;
    const marketSymbolUsed = scopedMarket ? order.symbol : symbol;
    const orderTickPrice = normalizeNumber(scopedMarket?.tickPrice ?? scopedMarket?.price ?? (order.symbol === symbol ? tickPrice : undefined));
    const orderCandleOpen = normalizeNumber(scopedMarket?.candleOpen ?? scopedMarket?.open ?? (order.symbol === symbol ? candleOpen : undefined));
    const orderCandleHigh = normalizeNumber(scopedMarket?.candleHigh ?? scopedMarket?.high ?? (order.symbol === symbol ? candleHigh : undefined));
    const orderCandleLow = normalizeNumber(scopedMarket?.candleLow ?? scopedMarket?.low ?? (order.symbol === symbol ? candleLow : undefined));
    const orderCandleClose = normalizeNumber(scopedMarket?.candleClose ?? scopedMarket?.close ?? (order.symbol === symbol ? candleClose : undefined));
    const orderEntryPrice = resolveOrderEntryPrice(order);
    const nextWaitBars = Number.isFinite(normalizedCandleTime)
      ? calculateBarsDelta(order.createdCandleTime ?? order.placementSnapshot?.createdCandleTime, normalizedCandleTime)
      : asSafeNumber(order.waitedBars);
    const distancePct = Number.isFinite(orderTickPrice) && Number.isFinite(orderEntryPrice) && orderTickPrice !== 0
      ? (Math.abs(orderEntryPrice - orderTickPrice) / Math.abs(orderTickPrice)) * 100
      : null;
    const observedOrder = {
      ...order,
      waitedBars: nextWaitBars,
      distanceFromPricePct: distancePct,
      canceledByPriceDrift: false,
    };
    const hasMarketEventForOrder = Boolean(scopedMarket) || order.symbol === symbol;
    if (!hasMarketEventForOrder) {
      nextPendingOrders.push(observedOrder);
      continue;
    }
    const linkedSetup = order.setupId ? getLockedSetup(nextState, order.symbol, order.timeframe) : null;
    if (order.setupId && (!linkedSetup || linkedSetup.status !== "ACTIVE" || linkedSetup.setupId !== order.setupId)) {
      console.warn("[SETUP_INACTIVE_ORDER_BLOCKED]", {
        orderId: order.id,
        setupId: order.setupId,
        symbol: order.symbol,
        timeframe: order.timeframe,
      });
      logPendingCancelBlocked(order, "SETUP_INACTIVE");
      nextPendingOrders.push(observedOrder);
      continue;
    }

    const orderTerminal =
      order.status !== "PENDING" ||
      Boolean(nextState.filledOrderIds?.[order.id]) ||
      Boolean(nextState.orderToPositionMap?.[order.id]);
    if (orderTerminal) {
      console.debug("[FILL_SKIPPED_DUPLICATE]", {
        symbol: order.symbol,
        orderId: order.id,
        reason: "ORDER_ALREADY_TERMINAL",
      });
      continue;
    }
    const cancellationBlockedByTrigger = shouldBlockPendingCancellation(triggeredBy);
    const cancellationBlockedBySymbolMismatch = order.symbol !== marketSymbolUsed;
    if (
      order.entryMode === "pullback" &&
      Number.isFinite(nextWaitBars) &&
      nextWaitBars >= asSafeNumber(order.maxWaitBars, DEFAULT_PULLBACK_MAX_WAIT_BARS)
    ) {
      if (cancellationBlockedByTrigger || cancellationBlockedBySymbolMismatch) {
        nextPendingOrders.push(observedOrder);
        continue;
      }
      nextState = incrementWaitingReason(nextState, "waitingForPullback", {
        symbol: order.symbol,
        orderId: order.id,
        waitedBars: nextWaitBars,
      });
      const refreshedEntry = Number.isFinite(orderTickPrice)
        ? (order.side === "SHORT" ? orderTickPrice * 1.001 : orderTickPrice * 0.999)
        : orderEntryPrice;
      logPendingCancelBlocked(order, "PENDING_TIMEOUT_REEVALUATED");
      nextPendingOrders.push({
        ...observedOrder,
        canceledByPriceDrift: false,
        refreshSuggestion: refreshedEntry,
      });
      continue;
    }
    if (isOrderExpired(order, timestamp)) {
      if (cancellationBlockedByTrigger || cancellationBlockedBySymbolMismatch) {
        nextPendingOrders.push(observedOrder);
        continue;
      }
      logPendingCancelBlocked(order, "EXPIRED");
      nextPendingOrders.push(observedOrder);
      continue;
    }
    if (!cancellationBlockedByTrigger && !cancellationBlockedBySymbolMismatch && isOrderPriceDrifted(order, orderTickPrice)) {
      nextState = incrementWaitingReason(nextState, "canceledByPriceDrift", {
        symbol: order.symbol,
        orderId: order.id,
      });
      logPendingCancelBlocked(order, "PRICE_DRIFTED");
      nextPendingOrders.push({ ...observedOrder, canceledByPriceDrift: true });
      continue;
    }
    if (isPreEntryInvalidated(order, orderTickPrice)) {
      if (cancellationBlockedByTrigger || cancellationBlockedBySymbolMismatch) {
        nextPendingOrders.push(observedOrder);
        continue;
      }
      nextState.cancelledOrders.unshift(cancelPendingOrder(order, "STRUCTURE_INVALIDATED", timestamp, { triggeredBy }));
      nextState = appendOrderLifecycleEvent(nextState, {
        symbol: order.symbol, orderId: order.id, eventType: "CANCELED", reason: "STRUCTURE_INVALIDATED", triggeredBy, timestamp, selectedSymbolAtThatMoment, marketSymbolUsed,
        currentTickPrice: orderTickPrice, candleHigh: orderCandleHigh, candleLow: orderCandleLow, entryPrice: orderEntryPrice, checkedFunctionName,
      });
      nextState = appendPendingCancelTrace(nextState, {
        timestamp, orderId: order.id, orderSymbol: order.symbol, selectedSymbolAtThatMoment, marketSymbolUsed, reason: "STRUCTURE_INVALIDATED", triggeredBy,
        currentTickPrice: orderTickPrice, candleHigh: orderCandleHigh, candleLow: orderCandleLow, entryPrice: orderEntryPrice, checkedFunctionName,
      });
      nextPendingOrders.push({ ...order, status: "CANCELLED" });
      continue;
    }
    const blockByUnexpectedTrigger = !isAllowedPendingFillTrigger(triggeredBy);
    const blockByRestorePreload = Boolean(order?.restoredAtSimulationStart);
    const fillEvaluation = evaluatePendingOrderFill(order, {
      tickPrice: orderTickPrice,
      candleHigh: orderCandleHigh,
      candleLow: orderCandleLow,
      candleTime,
    });
    const fillConfirmation = evaluatePullbackFillConfirmation(order, {
      candleOpen: orderCandleOpen,
      candleClose: orderCandleClose,
      rsi,
    });
    console.log("[PENDING_FILL_RECHECK]", {
      pendingId: order.id,
      entryMode: order.entryMode || null,
      symbol: order.symbol,
      side: order.side,
      tickPrice: orderTickPrice,
      candleHigh: orderCandleHigh,
      candleLow: orderCandleLow,
      fillCandidate: Boolean(fillEvaluation?.shouldFill),
      fillReason: fillEvaluation?.reason || "UNKNOWN",
    });
    const alreadyProcessedInEvent = Array.isArray(nextState.orderFillEventLocks?.[order.id]) &&
      nextState.orderFillEventLocks[order.id].includes(eventId);
    const alreadyFilledByOrderId = Boolean(nextState.orderToPositionMap?.[order.id]);
    const blockedByEventLock = alreadyProcessedInEvent || perEventFilledOrderIds.has(order.id);
    const blockedByOrderFillGuard = alreadyFilledByOrderId;
    const shouldFill = fillEvaluation.shouldFill &&
      fillConfirmation.isConfirmed &&
      !blockedByEventLock &&
      !blockedByOrderFillGuard &&
      !blockByUnexpectedTrigger &&
      !blockByRestorePreload;
    const resolvedFillReason = blockedByEventLock
      ? "BLOCKED_BY_EVENT_LOCK"
      : blockedByOrderFillGuard
        ? "BLOCKED_BY_ORDER_FILLED"
        : !fillConfirmation.isConfirmed
          ? (fillConfirmation.blockedReason || "BLOCKED_BY_FILL_CONFIRMATION")
        : blockByUnexpectedTrigger
          ? "BLOCKED_UNSUPPORTED_TRIGGER_SOURCE"
          : blockByRestorePreload
            ? "BLOCKED_RESTORE_PRELOAD_EVENT"
        : fillEvaluation.reason;
    const resolvedTriggerSource = fillEvaluation.triggerSource || "NONE";
    nextState = appendPendingFillCheck(nextState, {
      orderId: order.id,
      symbol: order.symbol,
      side: order.side,
      entryPrice: orderEntryPrice,
      tickPrice: orderTickPrice,
      candleHigh: orderCandleHigh,
      candleLow: orderCandleLow,
      candleClose: orderCandleClose,
      shouldFill,
      fillReason: resolvedFillReason,
      triggerSource: resolvedTriggerSource,
      blockedByDecision: false,
      checkedAt: timestamp,
      checkedBy: triggeredBy,
      triggeredBy,
      eventId,
      candleTimestamp: normalizedCandleTime,
      functionName: checkedFunctionName,
    });
    console.debug("[FILL_CHECK]", {
      orderId: order.id,
      symbol: order.symbol,
      timeframe: order.timeframe,
      side: order.side,
      orderType: order.orderType || "LIMIT",
      entry: orderEntryPrice,
      tickPrice: orderTickPrice,
      currentPrice: orderTickPrice,
      candleOpen: orderCandleOpen,
      candleHigh: orderCandleHigh,
      candleLow: orderCandleLow,
      candleClose: orderCandleClose,
      triggerSource: resolvedTriggerSource,
      candleTime: normalizedCandleTime,
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
      shouldFill,
      fillReason: resolvedFillReason,
      blockedByEventLock,
      blockedByOrderFillGuard,
      eventId,
      functionName: checkedFunctionName,
    });
    console.info(
      "[PULLBACK_FILL_CONFIRMATION_DEBUG]\n" +
      `symbol=${order.symbol}\n` +
      `side=${order.side}\n` +
      `pendingId=${order.id}\n` +
      `bullishCheck=${fillConfirmation.bullishCheck}\n` +
      `rsiValue=${fillConfirmation.rsiValue}\n` +
      `rsiGate=${fillConfirmation.rsiGate}\n` +
      `confirmationStatus=${fillConfirmation.confirmationStatus}\n` +
      `blockedReason=${fillConfirmation.blockedReason}\n` +
      `fillTriggered=${shouldFill}`
    );
    if (!shouldFill) {
      if (resolvedFillReason === "TRIGGER_NOT_REACHED") {
        console.debug("[FILL_REJECTED_TRIGGER_NOT_REACHED]", {
          orderId: order.id,
          side: order.side,
          entryPrice: orderEntryPrice,
          tickPrice: orderTickPrice,
          candleLow: orderCandleLow,
          candleHigh: orderCandleHigh,
          triggerSource: resolvedTriggerSource,
          checkedBy: triggeredBy,
        });
      }
      console.debug("[FILL_REJECTED]", {
        orderId: order.id,
        reason: resolvedFillReason,
      });
      if (blockedByEventLock || blockedByOrderFillGuard) {
        console.debug("[FILL_SKIPPED_DUPLICATE]", {
          symbol: order.symbol,
          orderId: order.id,
          reason: resolvedFillReason,
        });
      }
      const nextObservedOrder = blockByRestorePreload
        ? { ...observedOrder, restoredAtSimulationStart: false }
        : observedOrder;
      nextPendingOrders.push(nextObservedOrder);
      continue;
    }

    perEventFilledOrderIds.add(order.id);
    const existingOrderLocks = Array.isArray(nextState.orderFillEventLocks?.[order.id])
      ? nextState.orderFillEventLocks[order.id]
      : [];
    nextState.orderFillEventLocks[order.id] = [eventId, ...existingOrderLocks].slice(0, 20);

    const existingProcessingLock = nextState.orderProcessingLocks?.[order.id];
    if (existingProcessingLock && existingProcessingLock !== eventId) {
      console.debug("[FILL_SKIPPED_DUPLICATE]", {
        symbol: order.symbol,
        orderId: order.id,
        reason: "ORDER_PROCESSING_LOCKED",
      });
      nextPendingOrders.push(observedOrder);
      continue;
    }
    nextState.orderProcessingLocks[order.id] = eventId;

    const entryPrice = orderEntryPrice;
    if (!Number.isFinite(entryPrice)) {
      delete nextState.orderProcessingLocks[order.id];
      console.debug("[FILL_REJECTED]", {
        orderId: order.id,
        reason: "INVALID_ENTRY_PRICE_ON_EXECUTION",
      });
      nextPendingOrders.push(observedOrder);
      continue;
    }
    const filledPrice = entryPrice;
    if (isInvalidFillPriceForSide(order.side, entryPrice, filledPrice)) {
      delete nextState.orderProcessingLocks[order.id];
      console.error("[INVALID_FILL_BLOCKED]", {
        reason: "FILLED_PRICE_OUT_OF_DIRECTIONAL_BOUNDARY",
        side: order.side,
        entry: entryPrice,
        filledPrice,
        currentPrice: orderTickPrice,
      });
      console.debug("[FILL_REJECTED]", {
        orderId: order.id,
        reason: "INVALID_FILL_PRICE_BLOCKED",
      });
      nextPendingOrders.push(observedOrder);
      continue;
    }
    const normalizedLevels = normalizeDirectionalLevels({
      side: order.side,
      referencePrice: filledPrice,
      stopLoss: order.stopLoss,
      takeProfit1: order.takeProfit1,
      takeProfit2: order.takeProfit2,
      takeProfit3: order.takeProfit3,
    });
    const finalExecutionPlanGuard = validateExecutionPlanConsistency({
      side: order.side,
      entryPrice: filledPrice,
      normalizedLevels,
      executionMode: order.executionMode,
      sourceFunction: order.sourceFunction,
    });
    if (!finalExecutionPlanGuard.valid) {
      delete nextState.orderProcessingLocks[order.id];
      const hasExecutionModeMismatch = finalExecutionPlanGuard.violations.some(
        (violation) => violation === "PULLBACK_ENTRY_SOURCE_MUST_BE_TARGET_ENTRY_ZONE" || violation === "BREAKOUT_ENTRY_SOURCE_MUST_BE_TRIGGER_PRICE"
      );
      if (hasExecutionModeMismatch) {
        console.error("[EXECUTION_MODE_MISMATCH_BLOCKED]", {
          symbol: order.symbol,
          timeframe: order.timeframe,
          orderId: order.id,
          executionMode: order.executionMode ?? null,
          sourceFunction: order.sourceFunction ?? null,
          violations: finalExecutionPlanGuard.violations,
          triggeredBy,
        });
      }
      console.error("[INVALID_EXECUTION_PLAN_BLOCKED]", {
        symbol: order.symbol,
        timeframe: order.timeframe,
        orderId: order.id,
        side: order.side,
        violations: finalExecutionPlanGuard.violations,
        entryPrice: finalExecutionPlanGuard.entryPrice,
        stopLoss: finalExecutionPlanGuard.stopLoss,
        takeProfit1: finalExecutionPlanGuard.takeProfit1,
        takeProfit2: finalExecutionPlanGuard.takeProfit2,
        triggeredBy,
      });
      console.debug("[BLOCKED_DRAFT_NOT_PERSISTED]", {
        symbol: order.symbol,
        timeframe: order.timeframe,
        orderId: order.id,
        reasonCode: "INVALID_EXECUTION_PLAN_BLOCKED",
        triggeredBy,
      });
      nextState = appendBlockedAttempt(nextState, {
        timestamp,
        reasonCode: "INVALID_EXECUTION_PLAN_BLOCKED",
        symbol: order.symbol,
        timeframe: order.timeframe,
        side: order.side,
        orderId: order.id,
        details: {
          violations: finalExecutionPlanGuard.violations,
          triggeredBy,
        },
      });
      continue;
    }
    const quantity = asSafeNumber(order.quantity, DEFAULT_POSITION_SIZE);
    const notional = quantity * filledPrice;
    const positionCreationSource = checkedFunctionName;
    if (positionCreationSource !== "maybeFillPendingOrders") {
      delete nextState.orderProcessingLocks[order.id];
      console.error("[ILLEGAL_POSITION_CREATION_BLOCKED]", {
        reason: "UNAUTHORIZED_POSITION_SOURCE",
        sourceFunction: positionCreationSource,
        triggerSource: resolvedTriggerSource,
        orderId: order.id,
      });
      nextPendingOrders.push(observedOrder);
      continue;
    }
    const position = {
      id: createId("pos"),
      symbol: order.symbol,
      timeframe: order.timeframe,
      side: order.side,
      orderType: order.orderType || "LIMIT",
      status: "OPEN",
      entryPrice: filledPrice,
      triggerPrice: order.triggerPrice,
      currentPrice: filledPrice,
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
      sourceFunction: positionCreationSource,
      triggerSource: resolvedTriggerSource,
      orderId: order.id,
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
    if (nextState.orderToPositionMap?.[order.id] || nextState.filledOrderIds?.[order.id]) {
      delete nextState.orderProcessingLocks[order.id];
      console.debug("[FILL_SKIPPED_DUPLICATE]", {
        symbol: order.symbol,
        orderId: order.id,
        reason: "ORDER_ALREADY_FILLED",
      });
      continue;
    }
    nextState.openPositions.push(position);
    nextState.orderToPositionMap[order.id] = position.id;
    nextState.filledOrderIds[order.id] = {
      positionId: position.id,
      filledAt: timestamp,
      eventId,
      triggerSource: triggeredBy,
    };
    delete nextState.orderProcessingLocks[order.id];
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
    nextState = appendPendingFillExecutionTrace(nextState, {
      orderId: order.id,
      createdPositionId: position.id,
      fillPrice: filledPrice,
      timestamp,
      eventId,
      functionName: checkedFunctionName,
      triggeredBy,
      symbol: order.symbol,
      side: order.side,
    });
    if (order.setupId) {
      const activeSetup = getLockedSetup(nextState, order.symbol, order.timeframe);
      if (activeSetup?.setupId === order.setupId && activeSetup.status === "ACTIVE") {
        nextState = releaseSetup(nextState, activeSetup, "TRIGGERED", { timestamp });
      }
    }
    console.info("[paper-trading] pending order executed", {
      orderId: order.id,
      symbol: order.symbol,
      timeframe: order.timeframe,
      side: order.side,
      entryPrice,
      fillReason: fillEvaluation.reason,
      executedAt: timestamp,
    });
    console.info("[FILL_EXECUTED]", {
      orderId: order.id,
      side: order.side,
      entry: orderEntryPrice,
      symbol: order.symbol,
      filledPrice,
      orderType: order.orderType || "LIMIT",
      triggerSource: resolvedTriggerSource,
      candleTime: normalizedCandleTime,
    });
    console.info("[POSITION_CREATED]", {
      orderId: order.id,
      source: "FILL_ENGINE",
      sourceFunction: positionCreationSource,
      triggerSource: resolvedTriggerSource,
      filledPrice,
      orderType: order.orderType || "LIMIT",
    });
    continue;
  }

  nextState.pendingOrders = nextPendingOrders.filter((order) => isFormalPendingOrder(order));
  nextState.cancelledOrders = nextState.cancelledOrders
    .filter((order) => isFormalCancelledOrder(order))
    .slice(0, MAX_CANCELLED_ORDERS_HISTORY);
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
  const executionPlan = decision?.executionPlan ?? {};
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
  const planSnapshot = buildExecutionPlanSnapshot(decision, symbol, timeframe, quantity);
  const planLockedPending = createPendingOrderFromExecutionPlan(planSnapshot, quantity);
  const shouldForceCreatePendingFromPlan = Boolean(planSnapshot.complete && planLockedPending);
  if (shouldForceCreatePendingFromPlan) {
    const existingPending = (state?.pendingOrders || []).find((candidate) => (
      isFormalPendingOrder(candidate) &&
      String(candidate?.symbol || "").toUpperCase() === String(symbol || "").toUpperCase() &&
      String(candidate?.side || "").toUpperCase() === String(planSnapshot.side || "").toUpperCase() &&
      String(candidate?.setupId || "") === String(planSnapshot.setupId || "")
    ));
    if (existingPending) {
      console.warn(
        "[PENDING_DUPLICATE_BLOCKED]\n" +
        `symbol=${symbol || ""}\n` +
        `side=${planSnapshot.side || ""}\n` +
        `setupId=${planSnapshot.setupId || ""}\n` +
        `existingPendingId=${existingPending?.id || ""}\n` +
        "reason=duplicate_pending_prevented"
      );
      return {
        state,
        result: "DUPLICATE_SETUP",
        pendingOrder: existingPending,
        pendingCreation: { created: false, blockedDuplicate: true, duplicatePendingId: existingPending?.id || null },
        ...basePerformanceDebug,
      };
    }
    const now = nowIso();
    const pendingOrder = {
      id: createId("order"),
      symbol,
      timeframe,
      side: planSnapshot.side,
      orderType: "LIMIT",
      entryPrice: planLockedPending.entryPrice,
      triggerPrice: planLockedPending.entryPrice,
      entryZoneLow: planSnapshot.entryZoneLow,
      entryZoneHigh: planSnapshot.entryZoneHigh,
      stopLoss: planLockedPending.stopLoss,
      invalidationPrice: planLockedPending.stopLoss,
      takeProfit1: planLockedPending.takeProfit1,
      takeProfit2: planLockedPending.takeProfit2,
      takeProfit3: planLockedPending.takeProfit3,
      quantity: planLockedPending.quantity,
      setupId: planSnapshot.setupId,
      createdAt: now,
      status: "PENDING",
      lifecycleType: "PENDING_ORDER",
      executionPlanValidated: true,
      waitingReasons: [],
      waitReason: "created_from_decision_center_plan",
      entryMode: "pullback",
      executionMode: "PLAN_LOCKED",
      decisionSnapshot: decision,
    };
    console.info(
      "[PENDING_PLAN_LOCKED]\n" +
      `symbol=${planSnapshot.symbol || ""}\n` +
      `side=${planSnapshot.side || ""}\n` +
      `setupId=${planSnapshot.setupId || ""}\n` +
      `entryZoneLow=${planSnapshot.entryZoneLow}\n` +
      `entryZoneHigh=${planSnapshot.entryZoneHigh}\n` +
      `finalEntry=${planLockedPending.entryPrice}\n` +
      `stopLoss=${planLockedPending.stopLoss}\n` +
      `takeProfits=${planSnapshot.takeProfits.join(" / ")}\n` +
      `size=${planLockedPending.quantity}\n` +
      "reason=created_from_decision_center_plan"
    );
    const nextState = recalculateAccountState({
      ...state,
      pendingOrders: [pendingOrder, ...(state?.pendingOrders || [])],
    }, {
      selectedSymbol: symbol,
      affectedSymbol: symbol,
      eventType: "PLACE_ORDER",
      sourceFunction: "simulateDecisionExecution.createPendingOrderFromExecutionPlan",
    });
    return {
      state: nextState,
      result: "PLACED_PENDING",
      pendingOrder,
      pendingCreation: { created: true, beforeCount: (state?.pendingOrders || []).length, afterCount: (nextState?.pendingOrders || []).length },
      executionIntent: "PLACE_PENDING",
      ...basePerformanceDebug,
      eligibilityInfo: {
        eligibility: "READY_TO_PLACE_PENDING",
        reasonCode: "PENDING_PLAN_LOCKED",
        reason: "完整 execution plan 已鎖定，直接建立 pending order",
      },
    };
  }
  const confirmationResult = runConfirmationEngine(buildConfirmationPayload(decision, currentPrice, signalContext));
  let executionIntent = mapDecisionTypeToExecutionIntent(confirmationResult.decisionType, confirmationResult);
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

  if (effectiveEligibility.eligibility === "BLOCKED" && !bypassSetupGate && !shouldForceCreatePendingFromPlan) {
    return { state, result: effectiveEligibility.reasonCode, eligibilityInfo: effectiveEligibility, ...basePerformanceDebug };
  }

  const side = resolveSideFromDecision(decision) || (bypassSetupGate ? resolveManualSimulationSide(decision) : null);
  const executionOrderType = resolveExecutionOrderType(decision);
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

  if (blockedByPerformanceFilter && !bypassSetupGate && !shouldForceCreatePendingFromPlan) {
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
  if (cooldownState.cooldownActive && !shouldForceCreatePendingFromPlan) {
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
  const existingLockedSetup = getLockedSetup(state, symbol, timeframe);
  const setupInvalidation = evaluateSetupInvalidation(existingLockedSetup, {
    tickPrice: currentPrice,
    candleTime: signalContext?.candleTime,
    decision,
  });
  if (existingLockedSetup?.status === "ACTIVE" && setupInvalidation) {
    const setupLogMap = {
      STRUCTURE_INVALIDATED: "[SETUP_INVALIDATED_STRUCTURE]",
      MOMENTUM_INVALIDATED: "[SETUP_INVALIDATED_MOMENTUM]",
      TIMEOUT_INVALIDATED: "[SETUP_INVALIDATED_TIMEOUT]",
    };
    console.info(setupLogMap[setupInvalidation.reason] || "[SETUP_INVALIDATED_STRUCTURE]", {
      setupId: existingLockedSetup.setupId,
      symbol,
      timeframe,
      reason: setupInvalidation.reason,
    });
    state = releaseSetup(state, existingLockedSetup, setupInvalidation.reason, { timestamp: nowIso() });
  }
  const lockedSetup = getLockedSetup(state, symbol, timeframe);
  const rangeBoundary = resolveRangeBoundarySnapshot(decision, signalContext);
  const reentryAttempt = resolveReentryAttempt(state, {
    decision,
    symbol,
    timeframe,
    side,
    currentPrice,
    candleTime: signalContext?.candleTime,
  });
  const parseExecutionPlanEntryZone = (plan) => {
    const rawEntry = plan?.entry;
    if (rawEntry != null && typeof rawEntry === "object") {
      const low = normalizeNumber(rawEntry?.low ?? rawEntry?.min);
      const high = normalizeNumber(rawEntry?.high ?? rawEntry?.max);
      if (Number.isFinite(low) || Number.isFinite(high)) {
        return {
          low: Number.isFinite(low) ? low : high,
          high: Number.isFinite(high) ? high : low,
          hasEntry: true,
        };
      }
    }
    if (typeof rawEntry === "string") {
      const matches = rawEntry.match(/-?\d+(?:\.\d+)?/g) || [];
      if (matches.length >= 2) {
        const first = normalizeNumber(matches[0]);
        const second = normalizeNumber(matches[1]);
        if (Number.isFinite(first) && Number.isFinite(second)) {
          return {
            low: Math.min(first, second),
            high: Math.max(first, second),
            hasEntry: true,
          };
        }
      }
    }
    const numericEntry = normalizeNumber(rawEntry);
    if (Number.isFinite(numericEntry)) {
      return { low: numericEntry, high: numericEntry, hasEntry: true };
    }
    return { low: undefined, high: undefined, hasEntry: false };
  };
  const executionPlanEntryZone = parseExecutionPlanEntryZone(executionPlan);
  const hasExecutionPlanEntry = executionPlanEntryZone.hasEntry;
  const tentativeEntryPrice = side === "SHORT"
    ? normalizeNumber(executionPlanEntryZone.high)
    : normalizeNumber(executionPlanEntryZone.low);
  const entryRangeForDebug = hasExecutionPlanEntry
    ? { low: normalizeNumber(executionPlanEntryZone.low), high: normalizeNumber(executionPlanEntryZone.high) }
    : resolveExecutionPlanEntryRange(decision);
  console.info("[PENDING_PRICE_SOURCE_DEBUG]", {
    symbol,
    side,
    executionPlanEntry: executionPlan?.entry ?? null,
    finalEntryUsed: tentativeEntryPrice,
    currentPrice: normalizeNumber(currentPrice),
  });
  console.info(
    "[PENDING_PRICE_SOURCE]\n" +
    `symbol=${symbol}\n` +
    `entryPrice=${Number.isFinite(tentativeEntryPrice) ? tentativeEntryPrice : "NaN"}\n` +
    `source=${plannedEntry.sourceFunction || "unknown"}\n` +
    `currentPrice=${Number.isFinite(normalizeNumber(currentPrice)) ? normalizeNumber(currentPrice) : "NaN"}\n` +
    `entryRangeLow=${Number.isFinite(entryRangeForDebug.low) ? entryRangeForDebug.low : "NaN"}\n` +
    `entryRangeHigh=${Number.isFinite(entryRangeForDebug.high) ? entryRangeForDebug.high : "NaN"}`
  );
  const pendingCreationRuleBlockedReason = hasExecutionPlanEntry ? null : "MISSING_EXECUTION_PLAN_ENTRY";
  console.info(
    "[PENDING_CREATION_RULE_DEBUG]\n" +
    `symbol=${symbol}\n` +
    `currentPrice=${Number.isFinite(normalizeNumber(currentPrice)) ? normalizeNumber(currentPrice) : "NaN"}\n` +
    `entryZoneLow=${Number.isFinite(normalizeNumber(executionPlanEntryZone.low)) ? normalizeNumber(executionPlanEntryZone.low) : "NaN"}\n` +
    `entryZoneHigh=${Number.isFinite(normalizeNumber(executionPlanEntryZone.high)) ? normalizeNumber(executionPlanEntryZone.high) : "NaN"}\n` +
    `hasExecutionPlanEntry=${hasExecutionPlanEntry}\n` +
    "requiresZoneHitBeforePending=false\n" +
    `shouldCreatePending=${hasExecutionPlanEntry}\n` +
    `blockedReason=${pendingCreationRuleBlockedReason || "none"}`
  );
  if (!hasExecutionPlanEntry || !Number.isFinite(tentativeEntryPrice)) {
    return {
      state,
      result: "MISSING_ENTRY_PRICE",
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
        reasonCode: "MISSING_ENTRY_PRICE",
        reason: "executionPlan.entry 缺失或無法解析，禁止建立 pending order",
      },
    };
  }
  console.info("[ENTRY_COMPUTED]", {
    symbol,
    strategyType: resolveStrategyType(decision) || "unknown",
    strategyTypeRaw: decision?.strategyType ?? null,
    setupType: decision?.setupType ?? null,
    executionPlanSetupType: decision?.executionPlan?.setupType ?? null,
    marketRegime: decision?.marketRegimeLabel ?? decision?.regime ?? "unknown",
    currentPrice: normalizeNumber(currentPrice),
    entryPrice: tentativeEntryPrice,
    support: rangeBoundary.support,
    resistance: rangeBoundary.resistance,
    zoneLow: rangeBoundary.zoneLow,
    zoneHigh: rangeBoundary.zoneHigh,
    sourceFunction: plannedEntry.sourceFunction || "unknown",
  });
  const conditionalPendingEligibility = evaluateConditionalPendingEligibility({
    decision,
    side,
    currentPrice: normalizeNumber(currentPrice),
    entryPrice: tentativeEntryPrice,
    rangeBoundary,
    setupContext: {
      candidateSetupType: plannedEntry.mode,
      executionMode: plannedEntry.mode === "breakout" ? "BREAKOUT" : "PULLBACK",
    },
  });
  const setupGateRsiValue = normalizeNumber(signalContext?.rsi ?? decision?.rsi);
  const setupGateRsiGate = !Number.isFinite(setupGateRsiValue) || (side === "SHORT" ? setupGateRsiValue <= 45 : setupGateRsiValue >= 55);
  const setupGateBullishCheck = side === "LONG"
    ? (Number.isFinite(normalizeNumber(signalContext?.candleOpen)) && Number.isFinite(normalizeNumber(signalContext?.candleClose))
      ? normalizeNumber(signalContext?.candleClose) >= normalizeNumber(signalContext?.candleOpen)
      : null)
    : (Number.isFinite(normalizeNumber(signalContext?.candleOpen)) && Number.isFinite(normalizeNumber(signalContext?.candleClose))
      ? normalizeNumber(signalContext?.candleClose) <= normalizeNumber(signalContext?.candleOpen)
      : null);
  const setupTypeForDebug = decision?.setupType ?? decision?.executionPlan?.setupType ?? null;
  const setupGateReason = conditionalPendingEligibility.primaryBlockedReason || "eligible";
  console.info(
    "[PULLBACK_SETUP_GATE_DEBUG]\n" +
    `symbol=${symbol}\n` +
    `timeframe=${timeframe}\n` +
    `side=${side}\n` +
    `hasEntryZone=${conditionalPendingEligibility.hasEntryZone}\n` +
    `candidateSetupType=${plannedEntry.mode}\n` +
    `setupType=${setupTypeForDebug}\n` +
    `allowedStrategy=${conditionalPendingEligibility.allowedStrategy}\n` +
    `bullishCheck=${setupGateBullishCheck}\n` +
    `rsiValue=${setupGateRsiValue}\n` +
    `rsiGate=${setupGateRsiGate}\n` +
    `reason=${setupGateReason}`
  );

  const shouldPromotePullbackSetup =
    hasExecutionPlanEntry &&
    plannedEntry.mode === "pullback" &&
    conditionalPendingEligibility.allowedStrategy;
  const logPreArmReturnDebug = ({ returnReason, nextAction = "RETURN", sourceFunction = "simulateDecisionExecution" }) => {
    console.warn(
      "[PRE_ARM_RETURN_DEBUG]\n" +
      `symbol=${symbol ?? "-"}\n` +
      `side=${side ?? "-"}\n` +
      `setupType=${decision?.setupType ?? null}\n` +
      `executionPlanSetupType=${decision?.executionPlan?.setupType ?? null}\n` +
      `executionIntent=${executionIntent ?? null}\n` +
      `nextAction=${nextAction}\n` +
      `returnReason=${returnReason ?? "unknown"}\n` +
      `sourceFunction=${sourceFunction}`
    );
  };
  const updateExecutionIntent = ({ nextIntent, sourceFunction, reason }) => {
    const previousIntent = executionIntent;
    executionIntent = nextIntent;
    logExecutionIntentOverwriteDebug({
      symbol,
      side,
      previousIntent,
      nextIntent,
      sourceFunction,
      reason,
    });
  };
  if (shouldPromotePullbackSetup) {
    lockPullbackSetupType(decision, {
      symbol,
      side,
      sourceFunction: "createPendingOrderFromDecision.shouldPromotePullbackSetup",
      reason: "has_entry_zone_pullback_candidate_and_allowed_strategy",
    });
    console.info(
      "[POST_SETUP_ELIGIBLE]\n" +
      `symbol=${symbol}\n` +
      `side=${side}\n` +
      `hasEntryZone=${conditionalPendingEligibility.hasEntryZone}\n` +
      `candidateSetupType=${plannedEntry.mode}\n` +
      `setupType=${decision?.setupType ?? null}\n` +
      `executionPlanSetupType=${decision?.executionPlan?.setupType ?? null}\n` +
      `allowedStrategy=${conditionalPendingEligibility.allowedStrategy}\n` +
      `executionIntent=${executionIntent}\n` +
      "nextAction=PENDING_ARMING_EVALUATION\n" +
      "sourceFunction=simulateDecisionExecution"
    );
    if (executionIntent === "WATCH_ONLY") {
      updateExecutionIntent({
        nextIntent: "PLACE_PENDING",
        sourceFunction: "simulateDecisionExecution.shouldPromotePullbackSetup",
        reason: "setup_eligible_promote_pending_arming",
      });
    }
  }

  executionIntent = "PLACE_PENDING";

  const constrainedEntry = {
    entryPrice: tentativeEntryPrice,
    isRejected: false,
    rejectionReason: null,
    wasAdjusted: false,
    distance: null,
    isTooFarInRange: false,
  };
  const triggerPrice = tentativeEntryPrice;
  const atrValue = normalizeNumber(executionPlan?.atr ?? decision?.atr);
  const fallbackInvalidation =
    Number.isFinite(triggerPrice) && Number.isFinite(atrValue) && atrValue > 0
      ? (side === "LONG" ? triggerPrice - atrValue * 1.5 : triggerPrice + atrValue * 1.5)
      : undefined;
  const invalidationPrice =
    normalizeNumber(executionPlan?.invalidationPrice ?? decision.invalidationPrice) ??
    normalizeNumber(executionPlan?.stop ?? decision.stop) ??
    normalizeNumber(executionPlan?.stopLoss ?? decision.stopLoss) ??
    fallbackInvalidation;
  const executionPlanStop = normalizeNumber(executionPlan?.stop ?? executionPlan?.stopLoss);
  const executionPlanTp1 = normalizeNumber(executionPlan?.tp ?? executionPlan?.takeProfit ?? executionPlan?.takeProfit1);
  const executionPlanTp2 = normalizeNumber(executionPlan?.takeProfit2);
  const executionPlanTp3 = normalizeNumber(executionPlan?.takeProfit3);
  const contextKey = buildDecisionContextKey(decision, symbol, timeframe);
  const decisionRevision = buildDecisionRevision(decision, timeframe);
  const normalizedLevels = normalizeDirectionalLevels({
    side,
    referencePrice: triggerPrice,
    stopLoss: executionPlanStop,
    takeProfit1: executionPlanTp1,
    takeProfit2: executionPlanTp2,
    takeProfit3: executionPlanTp3,
  });
  const planConsistency = validateExecutionPlanConsistency({
    side,
    entryPrice: triggerPrice,
    normalizedLevels,
    executionMode: decision?.executionPlan?.executionMode ?? null,
    sourceFunction: plannedEntry.sourceFunction,
  });
  if (!planConsistency.valid) {
    const hasExecutionModeMismatch = planConsistency.violations.some(
      (violation) => violation === "PULLBACK_ENTRY_SOURCE_MUST_BE_TARGET_ENTRY_ZONE" || violation === "BREAKOUT_ENTRY_SOURCE_MUST_BE_TRIGGER_PRICE"
    );
    if (hasExecutionModeMismatch) {
      console.error("[EXECUTION_MODE_MISMATCH_BLOCKED]", {
        symbol,
        timeframe,
        side,
        executionMode: decision?.executionPlan?.executionMode ?? null,
        sourceFunction: plannedEntry.sourceFunction ?? null,
        violations: planConsistency.violations,
      });
    }
    console.error("[INVALID_EXECUTION_PLAN_BLOCKED]", {
      symbol,
      timeframe,
      side,
      violations: planConsistency.violations,
      entryPrice: planConsistency.entryPrice,
      stopLoss: planConsistency.stopLoss,
      takeProfit1: planConsistency.takeProfit1,
      takeProfit2: planConsistency.takeProfit2,
      executionMode: decision?.executionPlan?.executionMode ?? null,
    });
    logPreArmReturnDebug({
      returnReason: "INVALID_EXECUTION_PLAN_BLOCKED",
      nextAction: "RETURN_WATCH_ONLY",
      sourceFunction: "simulateDecisionExecution.validateExecutionPlanConsistency",
    });
    return {
      state,
      result: "INVALID_EXECUTION_PLAN_BLOCKED",
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
        reasonCode: "INVALID_EXECUTION_PLAN_BLOCKED",
        reason: "交易計畫異常，已阻止下單",
      },
    };
  }

  if (isDuplicateContext(state, symbol, timeframe, contextKey)) {
    if (bypassSetupGate) {
      logPreArmReturnDebug({
        returnReason: "DUPLICATE_SETUP",
        nextAction: "RETURN_WATCH_AND_ARM",
        sourceFunction: "simulateDecisionExecution.isDuplicateContext",
      });
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
    logPreArmReturnDebug({
      returnReason: "DUPLICATE_SETUP",
      nextAction: "RETURN_DUPLICATE_SETUP",
      sourceFunction: "simulateDecisionExecution.isDuplicateContext",
    });
    return { state, result: "DUPLICATE_SETUP", ...performanceDebugPayload };
  }

  let stateWithSetupLock = state;
  const resolvedExecutionMode = plannedEntry.mode === "breakout" ? "BREAKOUT" : "PULLBACK";
  if (executionIntent === "WATCH_AND_ARM" || executionIntent === "PLACE_PENDING" || effectiveEligibility?.eligibility === "READY_TO_EXECUTE") {
    if (!lockedSetup || lockedSetup.status !== "ACTIVE") {
      const setupToLock = buildLockedSetupFromDecision({
        decision,
        signalContext,
        symbol,
        timeframe,
        side,
        executionMode: resolvedExecutionMode,
      });
      stateWithSetupLock = lockSetup(state, setupToLock);
    }
  }
  const finalLockedSetup = getLockedSetup(stateWithSetupLock, symbol, timeframe);
  const pendingOrder = {
    id: createId("order"),
    symbol,
    timeframe,
    side,
    orderType: executionOrderType === "MARKET" ? "MARKET" : "LIMIT",
    entryPrice: triggerPrice,
    entryZoneLow: normalizeNumber(finalLockedSetup?.entryZoneLow),
    entryZoneHigh: normalizeNumber(finalLockedSetup?.entryZoneHigh),
    triggerPrice: finalLockedSetup?.status === "ACTIVE" && finalLockedSetup.executionMode === "BREAKOUT"
      ? finalLockedSetup.triggerPrice
      : triggerPrice,
    invalidationPrice,
    stopLoss: normalizedLevels.stopLoss,
    takeProfit1: normalizedLevels.takeProfit1,
    takeProfit2: normalizedLevels.takeProfit2,
    takeProfit3: normalizedLevels.takeProfit3,
    quantity: asSafeNumber(quantity, DEFAULT_POSITION_SIZE),
    createdAt: nowIso(),
    status: "PENDING",
    lifecycleType: "PENDING_ORDER",
    executionPlanValidated: true,
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
    executionMode: resolvedExecutionMode,
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
      entryPrice: triggerPrice,
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
    conditionalPending: {
      enabled: true,
      strategyType: conditionalPendingEligibility.strategyType,
      whyEligible: conditionalPendingEligibility.reasons,
      autoCancelConditions: conditionalPendingEligibility.autoCancelConditions,
    },
    createdCandleTime: decisionBarTime,
    maxWaitBars: plannedEntry.mode === "pullback" ? DEFAULT_PULLBACK_MAX_WAIT_BARS : DEFAULT_PENDING_TIMEOUT_BARS,
    waitedBars: 0,
    distanceFromPricePct: Number.isFinite(Number(currentPrice)) && Number.isFinite(triggerPrice) && Number(currentPrice) !== 0
      ? (Math.abs(triggerPrice - Number(currentPrice)) / Math.abs(Number(currentPrice))) * 100
      : null,
    decisionSnapshot: decision,
    setupId: finalLockedSetup?.setupId || null,
    decisionContextKey: contextKey,
    ...tradeMetadata,
  };
  const breakoutGuard = evaluateBreakoutConfirmationGuard({
    decision,
    side,
    signalContext,
    triggerPrice: pendingOrder.triggerPrice,
  });
  if (breakoutGuard.applies) {
    if (side === "LONG" && breakoutGuard.breakoutSetupState === "BREAK_DETECTED") {
      console.info("[BREAKOUT_DETECTED]", { symbol, timeframe, side, triggerPrice: pendingOrder.triggerPrice, ...breakoutGuard.metrics });
      console.info("[BREAKOUT_UNCONFIRMED_CLOSE]", { symbol, triggerPrice: pendingOrder.triggerPrice, candleClose: breakoutGuard.metrics?.close });
    }
    if (side === "SHORT" && breakoutGuard.breakoutSetupState === "BREAK_DETECTED") {
      console.info("[BREAKDOWN_DETECTED]", { symbol, timeframe, side, triggerPrice: pendingOrder.triggerPrice, ...breakoutGuard.metrics });
      console.info("[BREAKDOWN_UNCONFIRMED_CLOSE]", { symbol, triggerPrice: pendingOrder.triggerPrice, candleClose: breakoutGuard.metrics?.close });
    }
    if (!breakoutGuard.checklist?.volumeConfirmed && breakoutGuard.checklist?.closeConfirmed) {
      console.info(side === "LONG" ? "[BREAKOUT_UNCONFIRMED_VOLUME]" : "[BREAKDOWN_UNCONFIRMED_VOLUME]", {
        symbol,
        triggerPrice: pendingOrder.triggerPrice,
        volume: breakoutGuard.metrics?.volume,
        volumeMA20: breakoutGuard.metrics?.volumeMA20,
        multiplier: breakoutGuard.metrics?.multiplier,
      });
    }
    if (breakoutGuard.breakoutSetupState === "BREAKOUT_CONFIRMED") {
      console.info(side === "LONG" ? "[BREAKOUT_CONFIRMED]" : "[BREAKDOWN_CONFIRMED]", {
        symbol,
        triggerPrice: pendingOrder.triggerPrice,
        confirmMethod: breakoutGuard.confirmMethod,
        candleClose: breakoutGuard.metrics?.close,
      });
    }
  }
  const draftSetup = isDraftLikeWaitingOrder(pendingOrder);
  const setupTypeNormalized = String(decision?.setupType || "").toLowerCase();
  const executionPlanSetupTypeNormalized = String(decision?.executionPlan?.setupType || "").toLowerCase();
  const candidateSetupTypeNormalized = String(plannedEntry.mode || "").toLowerCase();
  const draftWaitingReasons = Array.isArray(pendingOrder?.waitingReasons) ? pendingOrder.waitingReasons : [];
  const draftReason = draftWaitingReasons.find((reason) => DRAFT_WAITING_REASON_KEYS.has(reason)) || null;
  const shouldBypassSetupDraftWaitingGuard = (
    hasExecutionPlanEntry &&
    conditionalPendingEligibility.allowedStrategy &&
    candidateSetupTypeNormalized === "pullback" &&
    setupTypeNormalized === "pullback" &&
    executionPlanSetupTypeNormalized === "pullback"
  );
  const armingDebugPayload = {
    symbol,
    side,
    hasEntryZone: hasExecutionPlanEntry,
    candidateSetupType: plannedEntry.mode,
    setupType: decision?.setupType ?? null,
    executionPlanSetupType: decision?.executionPlan?.setupType ?? null,
    allowedStrategy: conditionalPendingEligibility.allowedStrategy,
  };
  const logPendingArmingDebug = ({ shouldCreatePending, blockedReason }) => {
    console.info(
      "[PENDING_ARMING_DEBUG]\n" +
      `symbol=${armingDebugPayload.symbol}\n` +
      `side=${armingDebugPayload.side}\n` +
      `hasEntryZone=${armingDebugPayload.hasEntryZone}\n` +
      `candidateSetupType=${armingDebugPayload.candidateSetupType}\n` +
      `setupType=${armingDebugPayload.setupType}\n` +
      `executionPlanSetupType=${armingDebugPayload.executionPlanSetupType}\n` +
      `allowedStrategy=${armingDebugPayload.allowedStrategy}\n` +
      `shouldCreatePending=${shouldCreatePending}\n` +
      `blockedReason=${blockedReason || "none"}`
    );
  };
  const pendingFinalWaitingReasons = shouldBypassSetupDraftWaitingGuard
    ? draftWaitingReasons.filter((reason) => (
      reason !== "blockedByKlineConfirmation" &&
      reason !== "waitingForPullback"
    ))
    : draftWaitingReasons;
  const shouldBypassSetupInactiveOrderGuard = (
    shouldBypassSetupDraftWaitingGuard &&
    pendingFinalWaitingReasons.length === 0
  );
  const pendingOrderExecutionMode = pendingOrder?.executionMode ?? null;
  const finalLockedSetupExecutionMode = finalLockedSetup?.executionMode ?? null;
  const debugExecutionMode =
    decision?.executionMode ??
    decision?.executionPlan?.executionMode ??
    pendingOrderExecutionMode ??
    finalLockedSetupExecutionMode ??
    null;
  const rawExecutionMode = debugExecutionMode;
  const rawCandidateSetupType = plannedEntry?.mode ?? null;
  const rawSetupType = decision?.setupType ?? null;
  const rawExecutionPlanSetupType = decision?.executionPlan?.setupType ?? null;
  const modeNormalized = String(rawExecutionMode ?? "").toLowerCase();
  const setupNormalized = String(rawExecutionPlanSetupType ?? rawSetupType ?? rawCandidateSetupType ?? "").toLowerCase();
  const normalizeExecutionSemantic = (value) => {
    const normalized = String(value ?? "").toLowerCase();
    if (!normalized) return "";
    if (normalized.includes("pullback")) return "pullback";
    if (normalized.includes("breakout")) return "breakout";
    return normalized;
  };
  const normalizedExecutionMode = normalizeExecutionSemantic(modeNormalized);
  const normalizedSetupType = normalizeExecutionSemantic(setupNormalized);
  const isModeMatched = (
    pendingOrderExecutionMode === finalLockedSetupExecutionMode ||
    (normalizedExecutionMode && normalizedExecutionMode === normalizedSetupType)
  );
  const logSetupInactiveDebug = ({ setupActive, orderActive, inactiveReason, finalBlockedReason }) => {
    console.info(
      "[SETUP_INACTIVE_DEBUG]\n" +
      `symbol=${armingDebugPayload.symbol}\n` +
      `side=${armingDebugPayload.side}\n` +
      `executionMode=${debugExecutionMode}\n` +
      `candidateSetupType=${armingDebugPayload.candidateSetupType}\n` +
      `setupType=${armingDebugPayload.setupType}\n` +
      `executionPlanSetupType=${armingDebugPayload.executionPlanSetupType}\n` +
      `setupActive=${setupActive}\n` +
      `orderActive=${orderActive}\n` +
      `inactiveReason=${inactiveReason || "none"}\n` +
      `finalBlockedReason=${finalBlockedReason || "none"}`
    );
  };
  const logExecutionModeMatchDebug = ({ finalBlockedReason }) => {
    console.info(
      "[EXECUTION_MODE_MATCH_DEBUG]\n" +
      `symbol=${armingDebugPayload.symbol}\n` +
      `side=${armingDebugPayload.side}\n` +
      `rawExecutionMode=${rawExecutionMode}\n` +
      `rawCandidateSetupType=${rawCandidateSetupType}\n` +
      `rawSetupType=${rawSetupType}\n` +
      `rawExecutionPlanSetupType=${rawExecutionPlanSetupType}\n` +
      `normalizedExecutionMode=${normalizedExecutionMode}\n` +
      `normalizedSetupType=${normalizedSetupType}\n` +
      `isModeMatched=${isModeMatched}\n` +
      `finalBlockedReason=${finalBlockedReason || "none"}`
    );
  };
  const logPendingFinalGateDebug = ({ finalShouldCreatePending, finalBlockedReason, nextAction }) => {
    console.info(
      "[PENDING_FINAL_GATE_DEBUG]\n" +
      `symbol=${armingDebugPayload.symbol}\n` +
      `side=${armingDebugPayload.side}\n` +
      `hasEntryZone=${armingDebugPayload.hasEntryZone}\n` +
      `candidateSetupType=${armingDebugPayload.candidateSetupType}\n` +
      `setupType=${armingDebugPayload.setupType}\n` +
      `executionPlanSetupType=${armingDebugPayload.executionPlanSetupType}\n` +
      `allowedStrategy=${armingDebugPayload.allowedStrategy}\n` +
      `waitingReasons=${pendingFinalWaitingReasons.length ? pendingFinalWaitingReasons.join(",") : "none"}\n` +
      `finalShouldCreatePending=${finalShouldCreatePending}\n` +
      `finalBlockedReason=${finalBlockedReason || "none"}\n` +
      `nextAction=${nextAction}`
    );
  };

  const buildPendingUniquenessKey = (order) => {
    const symbolKey = String(order?.symbol || "").toUpperCase();
    const sideKey = String(order?.side || "").toUpperCase();
    const setupId = order?.setupId ? String(order.setupId) : null;
    if (!symbolKey || !sideKey || !setupId) return null;
    return `${symbolKey}|${sideKey}|${setupId}`;
  };

  const createPendingOrder = ({ baseState, order, executionPlan: pendingExecutionPlan }) => {
    if (!pendingExecutionPlan) {
      console.warn("[PENDING_EXECUTION_PLAN_MISSING]", {
        symbol: order?.symbol ?? null,
        side: order?.side ?? null,
      });
    }
    const beforeCount = (baseState?.pendingOrders || []).length;
    const pendingKey = buildPendingUniquenessKey(order);
    const existingPending = (baseState?.pendingOrders || []).find((candidate) => {
      if (!isFormalPendingOrder(candidate)) return false;
      return buildPendingUniquenessKey(candidate) === pendingKey;
    });
    if (pendingKey && existingPending) {
      console.warn(
        "[PENDING_DUPLICATE_BLOCKED]\n" +
        `symbol=${order?.symbol || ""}\n` +
        `side=${order?.side || ""}\n` +
        `setupId=${order?.setupId || "entryZoneHash"}\n` +
        `existingPendingId=${existingPending?.id || ""}\n` +
        "reason=duplicate_pending_prevented"
      );
      return {
        nextState: baseState,
        beforeCount,
        afterCount: beforeCount,
        created: false,
        blockedDuplicate: true,
        duplicatePendingId: existingPending?.id || null,
      };
    }
    console.info(
      "[PENDING_PLAN_LOCKED]\n" +
      `symbol=${order?.symbol || ""}\n` +
      `side=${order?.side || ""}\n` +
      `setupId=${order?.setupId || ""}\n` +
      `entryZoneLow=${normalizeNumber(order?.entryZoneLow) ?? ""}\n` +
      `entryZoneHigh=${normalizeNumber(order?.entryZoneHigh) ?? ""}\n` +
      `finalEntry=${normalizeNumber(order?.entryPrice ?? order?.triggerPrice) ?? ""}\n` +
      `stopLoss=${normalizeNumber(order?.stopLoss) ?? ""}\n` +
      `takeProfits=${[
        normalizeNumber(order?.takeProfit1),
        normalizeNumber(order?.takeProfit2),
        normalizeNumber(order?.takeProfit3),
      ].filter((value) => Number.isFinite(value)).join(" / ")}\n` +
      `size=${asSafeNumber(order?.quantity)}\n` +
      "reason=created_from_decision_center_plan"
    );
    console.log("[PENDING_CREATED]", {
      pendingId: order?.id || null,
      entryZone: {
        low: normalizeNumber(order?.entryLow ?? order?.entryZoneLow ?? order?.placementSnapshot?.entryLow),
        high: normalizeNumber(order?.entryHigh ?? order?.entryZoneHigh ?? order?.placementSnapshot?.entryHigh),
      },
      price: normalizeNumber(order?.entryPrice ?? order?.triggerPrice),
    });
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
    logPreArmReturnDebug({
      returnReason: "EXECUTION_INTENT_WATCH_ONLY",
      nextAction: "RETURN_WATCH_ONLY",
      sourceFunction: "simulateDecisionExecution.executionIntentGate",
    });
    logPendingArmingDebug({ shouldCreatePending: false, blockedReason: "EXECUTION_INTENT_WATCH_ONLY" });
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
    logPreArmReturnDebug({
      returnReason: "EXECUTION_INTENT_WATCH_AND_ARM",
      nextAction: "RETURN_WATCH_AND_ARM",
      sourceFunction: "simulateDecisionExecution.executionIntentGate",
    });
    logPendingArmingDebug({ shouldCreatePending: false, blockedReason: "EXECUTION_INTENT_WATCH_AND_ARM" });
    return {
      state: stateWithSetupLock,
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

  if (draftSetup) {
    const blockedReason = shouldBypassSetupDraftWaitingGuard ? null : "SETUP_DRAFT_WAITING";
    console.info(
      "[SETUP_DRAFT_DEBUG]\n" +
      `symbol=${symbol}\n` +
      `side=${side}\n` +
      `executionMode=${resolvedExecutionMode}\n` +
      `candidateSetupType=${plannedEntry.mode}\n` +
      `setupType=${decision?.setupType ?? null}\n` +
      `executionPlanSetupType=${decision?.executionPlan?.setupType ?? null}\n` +
      `draftStatus=${draftSetup ? "WAITING_DRAFT" : "NONE"}\n` +
      `draftReady=${shouldBypassSetupDraftWaitingGuard}\n` +
      `draftReason=${draftReason || "none"}\n` +
      "blockedReason=none"
    );
    console.info("[SETUP_DRAFT_GUARD_BYPASSED]", {
      symbol,
      timeframe,
      side,
      reason: "PENDING_ORDER_MUST_BE_CREATED_FROM_DECISION_CENTER_PLAN",
      waitingReasons: pendingOrder.waitingReasons,
    });
  }
  pendingOrder.waitingReasons = pendingFinalWaitingReasons;

  if (executionIntent === "EXECUTE_NOW" && executionOrderType !== "MARKET") {
    console.warn("[EXECUTION_BLOCKED]", {
      orderId: pendingOrder.id,
      reason: "NOT_MARKET_EXECUTE_NOW_BLOCKED",
      executionIntent,
      orderType: executionOrderType,
    });
  }

  logSetupInactiveDebug({
    setupActive: Boolean(finalLockedSetup?.status === "ACTIVE"),
    orderActive: true,
    inactiveReason: null,
    finalBlockedReason: null,
  });
  logExecutionModeMatchDebug({ finalBlockedReason: null });

  logPendingArmingDebug({ shouldCreatePending: true, blockedReason: null });
  logPendingFinalGateDebug({
    finalShouldCreatePending: true,
    finalBlockedReason: null,
    nextAction: "CREATE_PENDING_ORDER",
  });
  const pendingCreation = createPendingOrder({ baseState: stateWithSetupLock, order: pendingOrder, executionPlan });
  if (pendingCreation.created) {
    console.log("[PENDING_CREATED]", {
      orderId: pendingOrder.id,
      symbol: pendingOrder.symbol,
      side: pendingOrder.side,
      orderType: pendingOrder.orderType,
      entry: pendingOrder.entryPrice,
      triggerPrice: pendingOrder.triggerPrice,
      currentPrice: normalizeNumber(currentPrice),
      createdAt: pendingOrder.createdAt,
      sourceFunction: "simulateDecisionExecution.createPendingOrder",
    });
    console.info("[PENDING_CREATED_FROM_DECISION]", {
      orderId: pendingOrder.id,
      entry: pendingOrder.entryPrice,
      orderType: pendingOrder.orderType,
      executionIntent,
    });
    console.info("[ORDER_CREATED]", {
      orderId: pendingOrder.id,
      side: pendingOrder.side,
      orderType: pendingOrder.orderType,
      entry: pendingOrder.entryPrice,
    });
  }
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
  let stateWithLifecycle = appendOrderLifecycleEvent(pendingCreation.nextState, {
    symbol,
    orderId: pendingOrder.id,
    eventType: "PLACED",
    reason: "PLACE_PENDING",
    triggeredBy,
    timestamp: pendingOrder.createdAt,
  });

  if (pendingOrder.orderType === "MARKET") {
    stateWithLifecycle = maybeFillPendingOrders(stateWithLifecycle, {
      tickPrice: normalizeNumber(currentPrice),
      candleHigh: normalizeNumber(signalContext?.candleHigh ?? signalContext?.high ?? currentPrice),
      candleLow: normalizeNumber(signalContext?.candleLow ?? signalContext?.low ?? currentPrice),
      candleClose: normalizeNumber(signalContext?.candleClose ?? signalContext?.close ?? currentPrice),
      rsi: normalizeNumber(signalContext?.rsi),
      macd: signalContext?.macd ?? null,
      ma20: normalizeNumber(signalContext?.ma20),
      candleTime: signalContext?.candleTime,
      symbol,
      timestamp: nowIso(),
      triggeredBy: "DECISION_ENGINE_EXECUTE_NOW",
      selectedSymbolAtThatMoment: symbol,
    });
  }

  return {
    state: stateWithLifecycle,
    result: pendingOrder.orderType === "MARKET" ? "EXECUTED_IMMEDIATELY" : "PENDING_CREATED",
    executionIntent: pendingOrder.orderType === "MARKET" ? "EXECUTE_NOW" : "PLACE_PENDING",
    confirmationResult,
    ...performanceDebugPayload,
    pendingOrder,
    pendingCreation,
    breakoutGuard,
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
  const lockedSetup = getLockedSetup(state, symbol, timeframe);
  const setupInvalidation = evaluateSetupInvalidation(lockedSetup, {
    tickPrice: markPrice,
    candleTime,
    decision,
  });
  if (lockedSetup?.status === "ACTIVE" && setupInvalidation) {
    const setupLogMap = {
      STRUCTURE_INVALIDATED: "[SETUP_INVALIDATED_STRUCTURE]",
      MOMENTUM_INVALIDATED: "[SETUP_INVALIDATED_MOMENTUM]",
      TIMEOUT_INVALIDATED: "[SETUP_INVALIDATED_TIMEOUT]",
    };
    console.info(setupLogMap[setupInvalidation.reason] || "[SETUP_INVALIDATED_STRUCTURE]", {
      setupId: lockedSetup.setupId,
      symbol,
      timeframe,
      reason: setupInvalidation.reason,
    });
    state = releaseSetup(state, lockedSetup, setupInvalidation.reason, { timestamp });
  }

  const nextPending = [];
  const cancelledOrders = [...(state.cancelledOrders || [])];

  for (const order of state.pendingOrders || []) {
    if (order.status !== "PENDING") continue;

    if (order.symbol !== symbol || order.timeframe !== timeframe) {
      nextPending.push(order);
      continue;
    }
    const checkedFunctionName = "reconcilePendingOrdersWithDecision";
    const orderEntryPrice = resolveOrderEntryPrice(order);
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
      cancelReason = "STRUCTURE_INVALIDATED";
    } else if (
      order?.conditionalPending?.enabled &&
      side === order.side &&
      order.side === "LONG" &&
      Number.isFinite(markPrice) &&
      Number.isFinite(order.invalidationPrice) &&
      markPrice <= order.invalidationPrice
    ) {
      cancelReason = "STRUCTURE_INVALIDATED";
    } else if (
      order?.conditionalPending?.enabled &&
      side === order.side &&
      order.side === "LONG" &&
      (String(decision?.breakoutState ?? "").toLowerCase().includes("breakdown") ||
        String(decision?.structure ?? "").toLowerCase().includes("break"))
    ) {
      cancelReason = "STRUCTURE_INVALIDATED";
    } else if (
      order?.conditionalPending?.enabled &&
      side === order.side &&
      order.side === "LONG"
    ) {
      const rsi = normalizeNumber(decision?.rsi);
      const macdHistogram = normalizeNumber(decision?.macdHistogram ?? decision?.macd?.histogram);
      if ((Number.isFinite(rsi) && rsi < 48) || (Number.isFinite(macdHistogram) && macdHistogram < 0)) {
        cancelReason = "MOMENTUM_INVALIDATED";
      }
    } else if (side && order.side !== side && Number.isFinite(referenceAtr) && referenceAtr > 0) {
      const movedDistance = Math.abs(asSafeNumber(markPrice) - asSafeNumber(order.triggerPrice));
      if (movedDistance > referenceAtr * DEFAULT_PENDING_DRIFT_ATR_RATIO) {
        cancelReason = "STRUCTURE_CHANGED";
      }
    } else if (Number.isFinite(waitedBars) && waitedBars >= asSafeNumber(order.maxWaitBars, DEFAULT_PENDING_TIMEOUT_BARS)) {
      cancelReason = "TIMEOUT_INVALIDATED";
    }
    if (order.setupId) {
      const orderSetup = getLockedSetup(state, order.symbol, order.timeframe);
      if (!orderSetup || orderSetup.status !== "ACTIVE" || orderSetup.setupId !== order.setupId) {
        cancelReason = orderSetup?.invalidationReason || "SETUP_INACTIVE";
      }
    }

    if (cancelReason && !isAllowedAutomaticPendingCancelReason(cancelReason)) {
      logPendingCancelBlocked(order, cancelReason);
      nextPending.push(order);
      continue;
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
        entryPrice: orderEntryPrice,
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
        entryPrice: orderEntryPrice,
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
    allowPendingFills = true,
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
  const symbolSetups = Object.values(nextState?.activeSetups || {}).filter((item) => item?.symbol === symbol && item?.status === "ACTIVE");
  for (const setup of symbolSetups) {
    const invalidation = evaluateSetupInvalidation(setup, { tickPrice, candleTime });
    if (!invalidation) continue;
    const setupLogMap = {
      STRUCTURE_INVALIDATED: "[SETUP_INVALIDATED_STRUCTURE]",
      MOMENTUM_INVALIDATED: "[SETUP_INVALIDATED_MOMENTUM]",
      TIMEOUT_INVALIDATED: "[SETUP_INVALIDATED_TIMEOUT]",
    };
    console.info(setupLogMap[invalidation.reason] || "[SETUP_INVALIDATED_STRUCTURE]", {
      setupId: setup.setupId,
      symbol: setup.symbol,
      timeframe: setup.timeframe,
      reason: invalidation.reason,
    });
    nextState = releaseSetup(nextState, setup, invalidation.reason, { timestamp });
  }

  if (allowPendingFills) {
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
  }
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
    entryPrice: resolveOrderEntryPrice(targetOrder),
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
    entryPrice: resolveOrderEntryPrice(targetOrder),
    checkedFunctionName: "cancelPendingOrderManually",
  });
}

export function resetPaperTradingState() {
  return createInitialPaperAccountState();
}

export function normalizePaperAccountState(state, { eventType = "RESTORE", sourceFunction = "normalizePaperAccountState" } = {}) {
  const restoredOpenPositions = Array.isArray(state?.openPositions) ? state.openPositions : [];
  const normalizedOpenPositions = restoredOpenPositions.filter((position) => {
    const isAllowedSource = position?.sourceFunction === "maybeFillPendingOrders";
    if (!isAllowedSource) {
      console.error("[ILLEGAL_POSITION_CREATION_BLOCKED]", {
        reason: "RESTORE_BLOCKED_NON_FILL_ENGINE_POSITION",
        sourceFunction: position?.sourceFunction || sourceFunction,
        triggerSource: position?.triggerSource || "RESTORE",
        orderId: position?.orderId || null,
        positionId: position?.id || null,
      });
      return false;
    }
    return true;
  }).map((position) => ({
    ...position,
    sourceFunction: "maybeFillPendingOrders",
    triggerSource: position?.triggerSource || "RESTORE",
    orderId: position?.orderId || null,
  }));
  const normalizedPendingOrders = (Array.isArray(state?.pendingOrders) ? state.pendingOrders : []).map((order) => {
    if (eventType !== "RESTORE") {
      return {
        ...order,
        entryPrice: resolveOrderEntryPrice(order),
      };
    }
    const restoredOrder = {
      ...order,
      entryPrice: resolveOrderEntryPrice(order),
      restoredAtSimulationStart: true,
    };
    console.debug("[RESTORE_PENDING]", {
      orderId: restoredOrder.id,
      side: restoredOrder.side,
      entry: normalizeNumber(restoredOrder.entryPrice),
      restoredAtSimulationStart: true,
    });
    return restoredOrder;
  }).filter((order) => isFormalPendingOrder(order));
  const normalizedCancelledOrders = (Array.isArray(state?.cancelledOrders) ? state.cancelledOrders : [])
    .filter((order) => isFormalCancelledOrder(order));
  return recalculateAccountState({
    ...createInitialPaperAccountState(),
    ...(state || {}),
    openPositions: normalizedOpenPositions,
    pendingOrders: normalizedPendingOrders,
    cancelledOrders: normalizedCancelledOrders,
    setupDrafts: [],
    blockedAttempts: Array.isArray(state?.blockedAttempts) ? state.blockedAttempts : [],
    closedTrades: Array.isArray(state?.closedTrades) ? state.closedTrades : [],
    orderFillEventLocks: state?.orderFillEventLocks && typeof state.orderFillEventLocks === "object" ? state.orderFillEventLocks : {},
    orderToPositionMap: state?.orderToPositionMap && typeof state.orderToPositionMap === "object" ? state.orderToPositionMap : {},
    orderProcessingLocks: state?.orderProcessingLocks && typeof state.orderProcessingLocks === "object" ? state.orderProcessingLocks : {},
    filledOrderIds: state?.filledOrderIds && typeof state.filledOrderIds === "object" ? state.filledOrderIds : {},
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
