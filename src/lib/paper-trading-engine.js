const DEFAULT_BALANCE = 5000;
const DEFAULT_LEVERAGE = 1;
const DEFAULT_POSITION_SIZE = 50;
const TRAP_BLOCK_CONFIDENCE = new Set(["MEDIUM", "HIGH", "中", "高"]);
const LEVEL_CHANGE_TOLERANCE_RATIO = 0.001;
const MAX_CANCELLED_ORDERS_HISTORY = 50;
const DECISION_STALE_MS = 30 * 60 * 1000;

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

function getPnl(side, entryPrice, exitPrice, quantity) {
  if (side === "SHORT") return (entryPrice - exitPrice) * quantity;
  return (exitPrice - entryPrice) * quantity;
}

function getUnrealizedPnl(position, markPrice) {
  return getPnl(position.side, position.entryPrice, markPrice, position.quantity);
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

function isDecisionContextStale(decision) {
  const generatedAt = decision?.generatedAt ?? decision?.timestamp ?? decision?.decisionAt;
  if (!generatedAt) return false;
  const parsed = new Date(generatedAt).getTime();
  if (!Number.isFinite(parsed)) return false;
  return Date.now() - parsed > DECISION_STALE_MS;
}

export function getSimulationEligibility(decision, currentPrice) {
  if (!decision) {
    return {
      eligibility: "BLOCKED",
      reasonCode: "NO_DECISION",
      reason: "尚未產生可執行決策",
    };
  }

  const side = resolveSideFromDecision(decision);
  const action = String(decision?.action ?? decision?.executionPlan?.action ?? "").toUpperCase();
  const setupType = String(decision?.setupType ?? decision?.executionPlan?.setupType ?? "").toLowerCase();
  const triggerPrice = normalizeNumber(decision?.executionPlan?.triggerPrice ?? decision?.triggerPrice);
  const invalidationPrice = normalizeNumber(decision?.executionPlan?.invalidationPrice ?? decision?.invalidationPrice);
  const markPrice = normalizeNumber(currentPrice);
  const confirmationStrength = String(
    decision?.triggerEngine?.confirmationStrength ?? decision?.entryTiming ?? ""
  ).toUpperCase();
  const confidence = normalizeConfidence(decision?.confidence ?? decision?.confidenceLevel);
  const hasExecutionPlan = Boolean(decision?.executionPlan);

  if (isDecisionContextStale(decision)) {
    return { eligibility: "BLOCKED", reasonCode: "STALE_CONTEXT", reason: "決策內容已過期，請先重新整理資料" };
  }

  if (!side) {
    return { eligibility: "BLOCKED", reasonCode: "SKIP_NO_ACTIONABLE_SIDE", reason: "缺少可執行方向" };
  }
  if (setupType === "no_setup" || setupType === "no-trade" || confirmationStrength === "NO_SETUP" || confirmationStrength === "TOO_LATE") {
    return { eligibility: "BLOCKED", reasonCode: "STRUCTURE_INVALID", reason: "結構條件不足，暫不建立掛單" };
  }
  if (confidence === "LOW" || confidence === "VERY_LOW" || confidence === "低" || confidence === "極低") {
    return { eligibility: "BLOCKED", reasonCode: "EXTREMELY_LOW_CONFIDENCE", reason: "信心過低，模擬執行暫停" };
  }
  if (!hasExecutionPlan) {
    return { eligibility: "BLOCKED", reasonCode: "MISSING_EXECUTION_PLAN", reason: "缺少 execution plan，無法建立掛單" };
  }
  if (!Number.isFinite(triggerPrice)) {
    return { eligibility: "BLOCKED", reasonCode: "MISSING_TRIGGER", reason: "缺少觸發價格，無法建立掛單" };
  }
  if (!Number.isFinite(invalidationPrice)) {
    return { eligibility: "BLOCKED", reasonCode: "MISSING_INVALIDATION", reason: "缺少失效價格，無法定義風險" };
  }
  if (isTrapBlockingEntry(decision, side)) {
    return { eligibility: "BLOCKED", reasonCode: "BLOCKED_BY_TRAP", reason: "誘多 / 誘空風險阻擋執行" };
  }

  if (Number.isFinite(markPrice)) {
    const invalidForLong = side === "LONG" && markPrice <= invalidationPrice;
    const invalidForShort = side === "SHORT" && markPrice >= invalidationPrice;
    if (invalidForLong || invalidForShort) {
      return { eligibility: "BLOCKED", reasonCode: "SETUP_ALREADY_INVALIDATED", reason: "策略已失效，不建立掛單" };
    }
  }

  const triggerHit = Number.isFinite(markPrice)
    ? (side === "LONG" ? markPrice >= triggerPrice : markPrice <= triggerPrice)
    : false;

  if (triggerHit && action !== "HOLD") {
    return { eligibility: "READY_TO_EXECUTE", reasonCode: "TRIGGER_READY", reason: "觸發條件已成立，可立即進場" };
  }


  return {
    eligibility: "READY_TO_PLACE_PENDING",
    reasonCode: "WAITING_TRIGGER",
    reason: `目前尚未觸發，等待價格${side === "LONG" ? "突破" : "跌破"} ${triggerPrice}`,
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

function getOrderRsiThreshold(order) {
  const customThreshold = normalizeNumber(
    order?.decisionSnapshot?.executionPlan?.confirmationRsiThreshold ??
      order?.decisionSnapshot?.executionPlan?.rsiThreshold ??
      order?.confirmationRsiThreshold
  );
  if (Number.isFinite(customThreshold)) return customThreshold;
  return order.side === "SHORT" ? 45 : 55;
}

function hasConfirmation(order, { candleClose, rsi, macd, ma20 }) {
  const threshold = getOrderRsiThreshold(order);
  if (!Number.isFinite(candleClose) || !Number.isFinite(rsi) || !Number.isFinite(macd) || !Number.isFinite(ma20)) {
    return false;
  }
  if (order.side === "LONG") {
    return rsi >= threshold && macd > 0 && candleClose > ma20;
  }
  return rsi <= threshold && macd < 0 && candleClose < ma20;
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

function maybeFillPendingOrders(state, { tickPrice, candleClose, rsi, macd, ma20, candleTime, timestamp = nowIso() }) {
  let nextState = {
    ...state,
    pendingOrders: [...state.pendingOrders],
    cancelledOrders: [...(state.cancelledOrders || [])],
    openPositions: [...state.openPositions],
  };

  nextState.pendingOrders = nextState.pendingOrders.map((order) => {
    if (order.status !== "PENDING") return order;
    if (isPreEntryInvalidated(order, tickPrice)) {
      nextState.cancelledOrders.unshift(cancelPendingOrder(order, "SETUP_INVALIDATED", timestamp));
      return { ...order, status: "CANCELLED" };
    }
    if (hasActiveTrapSignal(order.decisionSnapshot)) return order;
    if (!shouldFillOrder(order, tickPrice)) return order;
    if (!hasConfirmation(order, { candleClose, rsi, macd, ma20 })) return order;

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
}) {
  if (!decision || !state) {
    return { state, result: "NO_DECISION" };
  }

  const eligibilityInfo = getSimulationEligibility(decision, currentPrice);
  if (eligibilityInfo.eligibility === "BLOCKED") {
    return { state, result: eligibilityInfo.reasonCode, eligibilityInfo };
  }

  const side = resolveSideFromDecision(decision);
  const triggerPrice = normalizeNumber(decision.executionPlan?.triggerPrice ?? decision.triggerPrice);
  const invalidationPrice = normalizeNumber(decision.executionPlan?.invalidationPrice ?? decision.invalidationPrice);
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
    quantity: asSafeNumber(quantity, DEFAULT_POSITION_SIZE),
    createdAt: nowIso(),
    status: "PENDING",
    waitReason: eligibilityInfo.reason,
    entryReason: decision.entryReason || null,
    decisionSnapshot: decision,
    decisionContextKey: contextKey,
  };

  if (eligibilityInfo.eligibility === "READY_TO_EXECUTE") {
    const timestamp = nowIso();
    const entryPrice = asSafeNumber(currentPrice, triggerPrice);
    const quantityValue = asSafeNumber(quantity, DEFAULT_POSITION_SIZE);
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
      decisionSnapshot: decision,
      decisionContextKey: contextKey,
      hitTargets: [],
    };

    return {
      state: recalculateAccountState({
        ...state,
        openPositions: [position, ...state.openPositions],
      }),
      result: "EXECUTED_IMMEDIATELY",
      position,
      eligibilityInfo,
    };
  }

  const nextState = recalculateAccountState({
    ...state,
    pendingOrders: [pendingOrder, ...state.pendingOrders],
  });

  return { state: nextState, result: "PENDING_CREATED", pendingOrder, eligibilityInfo };
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
  const triggerPrice = normalizeNumber(decision.executionPlan?.triggerPrice ?? decision.triggerPrice);
  const invalidationPrice = normalizeNumber(decision.executionPlan?.invalidationPrice ?? decision.invalidationPrice);
  const normalizedLevels = normalizeDirectionalLevels({
    side,
    referencePrice: triggerPrice,
    stopLoss: decision.executionPlan?.stopLoss ?? decision.stopLoss,
    takeProfit1: decision.executionPlan?.takeProfit1 ?? decision.takeProfit1,
    takeProfit2: decision.executionPlan?.takeProfit2 ?? decision.takeProfit2,
    takeProfit3: decision.executionPlan?.takeProfit3 ?? decision.takeProfit3,
  });
  const stopLoss = normalizedLevels.stopLoss;
  const takeProfit1 = normalizedLevels.takeProfit1;
  const takeProfit2 = normalizedLevels.takeProfit2;
  const takeProfit3 = normalizedLevels.takeProfit3;
  const setupType = String(decision.setupType || decision.executionPlan?.setupType || "").toLowerCase();
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

    if (!side) {
      cancelReason = "DECISION_HOLD";
    } else if (order.side !== side) {
      cancelReason = "DECISION_CHANGED";
    } else if (isTrapBlockingEntry(decision, side)) {
      cancelReason = "TRAP_BLOCKED";
    } else if (setupType === "no_setup" || setupType === "no-trade") {
      cancelReason = "SETUP_INVALIDATED";
    } else {
      const levelsChanged =
        hasMaterialNumberChange(order.triggerPrice, triggerPrice) ||
        hasMaterialNumberChange(order.invalidationPrice, invalidationPrice) ||
        hasMaterialNumberChange(order.stopLoss, stopLoss) ||
        hasMaterialNumberChange(order.takeProfit1, takeProfit1) ||
        hasMaterialNumberChange(order.takeProfit2, takeProfit2) ||
        hasMaterialNumberChange(order.takeProfit3, takeProfit3);
      if (levelsChanged) {
        cancelReason = "SETUP_INVALIDATED";
      } else if (invalidationPrice != null && Number.isFinite(markPrice)) {
        const invalidForLong = side === "LONG" && markPrice <= invalidationPrice;
        const invalidForShort = side === "SHORT" && markPrice >= invalidationPrice;
        if (invalidForLong || invalidForShort) cancelReason = "SETUP_INVALIDATED";
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
    ...position,
    currentPrice: tickPrice,
    unrealizedPnl: getUnrealizedPnl(position, tickPrice),
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

export function closePositionManually(state, { symbol, timeframe, price, reason = "MANUAL_CLOSE" }) {
  const open = state.openPositions.find((position) => position.symbol === symbol && position.timeframe === timeframe);
  if (!open) return state;
  return closePosition(state, {
    positionId: open.id,
    exitPrice: asSafeNumber(price, open.currentPrice),
    closeReason: reason,
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
