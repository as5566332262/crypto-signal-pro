import { mapDecisionTypeToExecutionIntent, runConfirmationEngine } from "@/lib/decision/confirmation-engine";

const DEFAULT_BALANCE = 5000;
const DEFAULT_LEVERAGE = 1;
const DEFAULT_POSITION_SIZE = 50;
const TRAP_BLOCK_CONFIDENCE = new Set(["MEDIUM", "HIGH", "中", "高"]);
const LEVEL_CHANGE_TOLERANCE_RATIO = 0.001;
const MAX_CANCELLED_ORDERS_HISTORY = 50;
const DECISION_STALE_MS = 30 * 60 * 1000;
const DEFAULT_PENDING_EXPIRY_MS = 6 * 60 * 60 * 1000;
const DEFAULT_SHORT_BREAKDOWN_ATR_RATIO = 0.2;
const DEFAULT_PENDING_DRIFT_ATR_RATIO = 2;
const REDUCED_CONFIDENCE_TYPES = new Set(["OPPORTUNITY_ENTRY", "FALLBACK_ENTRY", "MISSED_MOVE_ENTRY", "PROBE_ENTRY_D"]);

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

function resolveTradeMetadata({ decision, confirmationResult, signalContext = {} }) {
  const decisionType = resolveDecisionType(decision, confirmationResult);
  const scoring = confirmationResult?.scoring || decision?.scoring || {};
  return {
    decisionType,
    pendingType: resolvePendingType(decisionType, decision),
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

function applyEntryDistanceConstraint({ side, entryPrice, currentPrice, atr }) {
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
  if (!Number.isFinite(atrValue) || atrValue <= 0) {
    return { entryPrice, wasAdjusted: false, distance, isRejected: false };
  }
  if (distance <= atrValue * 0.5) {
    return { entryPrice, wasAdjusted: false, distance, isRejected: false };
  }
  return { entryPrice: currentPrice + atrValue * 0.3, wasAdjusted: true, distance, isRejected: false };
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
    simulationOrderConfig: {
      mode: "fixed_quantity",
      quantity: DEFAULT_POSITION_SIZE,
    },
  };
}

function hasMaterialNumberChange(previousValue, nextValue, toleranceRatio = LEVEL_CHANGE_TOLERANCE_RATIO) {
  const prev = normalizeNumber(previousValue);
  const next = normalizeNumber(nextValue);
  if (prev == null && next == null) return false;
  if (prev == null || next == null) return true;
  const baseline = Math.max(Math.abs(prev), Math.abs(next), 1);
  return Math.abs(prev - next) / baseline > toleranceRatio;
}

function cancelPendingOrder(order, reason, timestamp = nowIso()) {
  return {
    ...order,
    status: "CANCELLED",
    cancelReason: reason,
    cancelledAt: timestamp,
  };
}

function recalculateAccountState(state) {
  const unrealizedPnl = state.openPositions.reduce((sum, position) => sum + asSafeNumber(position.unrealizedPnl), 0);
  const usedMargin = state.openPositions.reduce((sum, position) => sum + asSafeNumber(position.notional) / Math.max(1, asSafeNumber(position.leverage, 1)), 0);

  return {
    ...state,
    balance: asSafeNumber(state.balance),
    realizedPnl: asSafeNumber(state.realizedPnl),
    unrealizedPnl,
    usedMargin,
    equity: asSafeNumber(state.balance) + unrealizedPnl,
  };
}

function closePosition(state, { positionId, exitPrice, closeReason, closedAt = nowIso() }) {
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
    exitReasonDetail: closeReason,
    maxFavorableExcursion: position.maxFavorableExcursion ?? 0,
    maxAdverseExcursion: position.maxAdverseExcursion ?? 0,
  };

  const nextOpen = state.openPositions.filter((item) => item.id !== positionId);
  return recalculateAccountState({
    ...state,
    balance: asSafeNumber(state.balance) + realizedPnl,
    realizedPnl: asSafeNumber(state.realizedPnl) + realizedPnl,
    openPositions: nextOpen,
    closedTrades: [closedTrade, ...state.closedTrades],
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

function shouldFillOrder(order, tickPrice) {
  const triggerPrice = asSafeNumber(order.triggerPrice);
  if (!triggerPrice) return false;
  if (!Number.isFinite(tickPrice)) return false;
  if (order.side === "LONG") return tickPrice >= triggerPrice;
  return tickPrice <= triggerPrice;
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

function maybeFillPendingOrders(state, { tickPrice, candleClose, rsi, macd, ma20, candleTime, timestamp = nowIso() }) {
  let nextState = {
    ...state,
    pendingOrders: [...state.pendingOrders],
    cancelledOrders: [...(state.cancelledOrders || [])],
    openPositions: [...state.openPositions],
  };

  nextState.pendingOrders = nextState.pendingOrders.map((order) => {
    if (order.status !== "PENDING") return order;
    if (isOrderExpired(order, timestamp)) {
      nextState.cancelledOrders.unshift(cancelPendingOrder(order, "EXPIRED", timestamp));
      return { ...order, status: "CANCELLED" };
    }
    if (isOrderPriceDrifted(order, tickPrice)) {
      nextState.cancelledOrders.unshift(cancelPendingOrder(order, "PRICE_DRIFTED", timestamp));
      return { ...order, status: "CANCELLED" };
    }
    if (isPreEntryInvalidated(order, tickPrice)) {
      nextState.cancelledOrders.unshift(cancelPendingOrder(order, "SETUP_INVALIDATED", timestamp));
      return { ...order, status: "CANCELLED" };
    }
    if (!shouldFillOrder(order, tickPrice)) return order;

    const confirmation = runConfirmationEngine(
      buildConfirmationPayload(order.decisionSnapshot, tickPrice, {
        rsi,
        macd,
        currentVolume: order?.placementSnapshot?.currentVolume,
        avgVolume20: order?.placementSnapshot?.avgVolume20,
        candleClose,
        structure: order?.placementSnapshot?.structure,
        mtf: order?.placementSnapshot?.mtf,
      })
    );
    if (!confirmation.canExecute) {
      return {
        ...order,
        lastConfirmation: confirmation,
        waitReason: "等待 confirmation-engine 條件成立",
      };
    }

    const entryPrice = asSafeNumber(candleClose ?? tickPrice, order.triggerPrice);
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
      decisionSnapshot: order.decisionSnapshot,
      decisionContextKey: order.decisionContextKey,
      hitTargets: [],
      createdAt: order.createdAt || timestamp,
      ...resolveTradeMetadata({
        decision: order.decisionSnapshot,
        confirmationResult: confirmation,
      }),
    };
    nextState.openPositions.push(position);
    console.info("[paper-trading] pending order executed", {
      orderId: order.id,
      symbol: order.symbol,
      timeframe: order.timeframe,
      side: order.side,
      entryPrice,
      executedAt: timestamp,
    });
    return { ...order, status: "FILLED", filledAt: timestamp };
  });

  nextState.pendingOrders = nextState.pendingOrders.filter((order) => order.status === "PENDING");
  nextState.cancelledOrders = nextState.cancelledOrders.slice(0, MAX_CANCELLED_ORDERS_HISTORY);
  return recalculateAccountState(nextState);
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
}) {
  if (!state) {
    return { state, result: "NO_DECISION" };
  }

  const executionOptions = { executionSource, orderMode };
  const bypassSetupGate = shouldBypassSetupGate(executionOptions);
  if (!decision) {
    return bypassSetupGate
      ? {
        state,
        result: "WATCH_ONLY",
        executionIntent: "WATCH_ONLY",
        eligibilityInfo: {
          eligibility: "WATCH_ONLY",
          reasonCode: "NO_DECISION",
          reason: "尚未產生可執行決策，已進入觀察模式",
        },
      }
      : { state, result: "NO_DECISION" };
  }
  const confirmationResult = runConfirmationEngine(buildConfirmationPayload(decision, currentPrice, signalContext));
  const tradeMetadata = resolveTradeMetadata({ decision, confirmationResult, signalContext });
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

  if (effectiveEligibility.eligibility === "BLOCKED" && !bypassSetupGate) {
    return { state, result: effectiveEligibility.reasonCode, eligibilityInfo: effectiveEligibility };
  }

  const side = resolveSideFromDecision(decision) || (bypassSetupGate ? resolveManualSimulationSide(decision) : null);
  if (!side) {
    return { state, result: "SKIP_NO_ACTIONABLE_SIDE", eligibilityInfo: effectiveEligibility };
  }
  const plannedEntry = resolvePlannedEntryPrice(decision, side);
  const fallbackEntryPrice = normalizeNumber(currentPrice) ?? plannedEntry.entryPrice ?? normalizeNumber(decision?.price);
  const constrainedEntry = applyEntryDistanceConstraint({
    side,
    entryPrice: bypassSetupGate ? fallbackEntryPrice : plannedEntry.entryPrice,
    currentPrice: normalizeNumber(currentPrice),
    atr: decision?.executionPlan?.atr ?? decision?.atr,
  });
  const triggerPrice = normalizeNumber(constrainedEntry.entryPrice ?? fallbackEntryPrice);
  if (constrainedEntry.isRejected) {
    if (bypassSetupGate) {
      return {
        state,
        result: "WATCH_AND_ARM",
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
        executionIntent: "WATCH_AND_ARM",
        confirmationResult,
        eligibilityInfo: {
          ...effectiveEligibility,
          reasonCode: "DUPLICATE_SETUP",
          reason: "同一 setup 已存在，保留既有單並持續監控",
        },
      };
    }
    return { state, result: "DUPLICATE_SETUP" };
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
    entryReason: decision.entryReason || null,
    entryMode: plannedEntry.mode,
    entryAdjusted: constrainedEntry.wasAdjusted,
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
    },
    decisionSnapshot: decision,
    decisionContextKey: contextKey,
    ...tradeMetadata,
  };

  const createPendingOrder = ({ baseState, order }) => {
    const beforeCount = (baseState?.pendingOrders || []).length;
    const nextState = recalculateAccountState({
      ...baseState,
      pendingOrders: [order, ...(baseState?.pendingOrders || [])],
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
      eligibilityInfo: {
        ...effectiveEligibility,
        executionIntent,
        confirmationResult,
      },
    };
  }

  if (effectiveEligibility.eligibility === "READY_TO_EXECUTE" || (executionIntent === "EXECUTE_NOW" && confirmationResult.canExecute)) {
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
      entryAdjusted: constrainedEntry.wasAdjusted,
      simulationLabel: effectiveEligibility.overrideApplied ? "模擬掛單（非建議）" : null,
      riskProfile: REDUCED_CONFIDENCE_TYPES.has(confirmationResult.decisionType) ? "LOW_CONFIDENCE_SMALL_SIZE" : "STANDARD",
      decisionSnapshot: decision,
      decisionContextKey: contextKey,
      hitTargets: [],
      createdAt: timestamp,
      ...tradeMetadata,
    };

    return {
      state: recalculateAccountState({
        ...state,
        openPositions: [position, ...state.openPositions],
      }),
      result: "EXECUTED_IMMEDIATELY",
      executionIntent: "EXECUTE_NOW",
      confirmationResult,
      position,
      eligibilityInfo: effectiveEligibility,
    };
  }

  const pendingCreation = createPendingOrder({ baseState: state, order: pendingOrder });

  return {
    state: pendingCreation.nextState,
    result: "PENDING_CREATED",
    executionIntent: "PLACE_PENDING",
    confirmationResult,
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

    let cancelReason = null;
    const referenceAtr = normalizeNumber(order?.placementSnapshot?.atr ?? decisionAtr);

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
    }

    if (cancelReason) {
      cancelledOrders.unshift(cancelPendingOrder(order, cancelReason, timestamp));
      continue;
    }

    nextPending.push(order);
  }

  return recalculateAccountState({
    ...state,
    pendingOrders: nextPending,
    cancelledOrders: cancelledOrders.slice(0, MAX_CANCELLED_ORDERS_HISTORY),
  });
}

export function applyMarketTickToPaperState(
  state,
  { price, candleClose, rsi, macd, ma20, candleTime, timestamp = nowIso() }
) {
  const tickPrice = asSafeNumber(price);
  if (!Number.isFinite(tickPrice)) return state;

  const normalizedRsi = normalizeNumber(rsi);
  const normalizedCandleClose = normalizeNumber(candleClose);
  const normalizedMa20 = normalizeNumber(ma20);
  const normalizedMacd = resolveMacdValue(macd);

  let nextState = maybeFillPendingOrders(state, {
    tickPrice,
    candleClose: normalizedCandleClose,
    rsi: normalizedRsi,
    macd: normalizedMacd,
    ma20: normalizedMa20,
    candleTime,
    timestamp,
  });
  const updatedPositions = nextState.openPositions.map((position) => ({
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
  }));

  nextState = recalculateAccountState({
    ...nextState,
    openPositions: updatedPositions,
  });

  const toClose = [];
  for (const position of nextState.openPositions) {
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
    });
  }

  return recalculateAccountState(nextState);
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
  });
}

export function cancelPendingOrderManually(state, { orderId, reason = "MANUAL_CANCEL", cancelledAt = nowIso() }) {
  if (!orderId) return state;
  const targetOrder = (state.pendingOrders || []).find((order) => order.id === orderId && order.status === "PENDING");
  if (!targetOrder) return state;

  return recalculateAccountState({
    ...state,
    pendingOrders: (state.pendingOrders || []).filter((order) => order.id !== orderId),
    cancelledOrders: [cancelPendingOrder(targetOrder, reason, cancelledAt), ...(state.cancelledOrders || [])]
      .slice(0, MAX_CANCELLED_ORDERS_HISTORY),
  });
}

export function resetPaperTradingState() {
  return createInitialPaperAccountState();
}

export const paperTradingConstants = {
  DEFAULT_BALANCE,
  DEFAULT_POSITION_SIZE,
  DEFAULT_LEVERAGE,
};
