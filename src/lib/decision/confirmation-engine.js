import { evaluateDecisionScore } from "@/lib/decision/scoring-engine";

const FALLBACK_WAIT_BARS = 4;
const MISSED_MOVE_ATR_RATIO = 1.2;
const FORCE_PROBE_NO_TRADE_BARS = 12;
const RANGE_EDGE_TOLERANCE_PCT = 0.003;

function normalizeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeSide(aiDecisionOutput = {}) {
  const action = String(aiDecisionOutput?.action ?? aiDecisionOutput?.executionPlan?.action ?? "").toUpperCase();
  if (["LONG", "BUY"].includes(action)) return "LONG";
  if (["SHORT", "SELL"].includes(action)) return "SHORT";
  const fallback = String(
    aiDecisionOutput?.executionPlan?.preferredSide ??
      aiDecisionOutput?.preferredSide ??
      aiDecisionOutput?.biasSide ??
      ""
  ).toUpperCase();
  if (fallback === "LONG") return "LONG";
  if (fallback === "SHORT") return "SHORT";
  return null;
}

function resolveDecisionType(aiDecisionOutput = {}, hasActionableSide) {
  const setupType = String(aiDecisionOutput?.setupType ?? aiDecisionOutput?.executionPlan?.setupType ?? "").toLowerCase();
  const entryTiming = String(aiDecisionOutput?.entryTiming ?? "").toUpperCase();
  const finalDecision = String(aiDecisionOutput?.finalDecision ?? aiDecisionOutput?.action ?? "").toUpperCase();

  if (["NO_TRADE", "HOLD", "WAIT"].includes(finalDecision) || setupType === "no_setup" || setupType === "no-trade") {
    return "NO_TRADE";
  }
  if (entryTiming === "WAIT_PULLBACK" || setupType === "pullback") return "WAIT_PULLBACK";
  if (entryTiming === "WAIT_BREAKOUT" || setupType === "breakout") return "WAIT_BREAKOUT";
  if (entryTiming === "READY" && hasActionableSide) return "IMMEDIATE_ENTRY";
  if (hasActionableSide) return "OPPORTUNITY_ENTRY";
  return "NO_TRADE";
}

function resolvePriceInZone(currentPrice, aiDecisionOutput = {}, structure = {}, side) {
  const price = normalizeNumber(currentPrice);
  if (!Number.isFinite(price)) return false;
  const zoneLow = normalizeNumber(
    structure?.zoneLow ?? aiDecisionOutput?.executionPlan?.entryLow ?? aiDecisionOutput?.entryLow ?? structure?.supportLow
  );
  const zoneHigh = normalizeNumber(
    structure?.zoneHigh ?? aiDecisionOutput?.executionPlan?.entryHigh ?? aiDecisionOutput?.entryHigh ?? structure?.resistanceHigh
  );
  if (Number.isFinite(zoneLow) && Number.isFinite(zoneHigh)) {
    const low = Math.min(zoneLow, zoneHigh);
    const high = Math.max(zoneLow, zoneHigh);
    return price >= low && price <= high;
  }
  const triggerPrice = normalizeNumber(aiDecisionOutput?.executionPlan?.triggerPrice ?? aiDecisionOutput?.triggerPrice);
  if (Number.isFinite(triggerPrice)) {
    return side === "SHORT" ? price >= triggerPrice : price <= triggerPrice;
  }
  return false;
}

function resolveVolumeConfirmed(indicators = {}) {
  if (typeof indicators?.volumeConfirmed === "boolean") return indicators.volumeConfirmed;
  const currentVolume = normalizeNumber(indicators?.volume?.current ?? indicators?.currentVolume);
  const avgVolume = normalizeNumber(indicators?.volume?.avg20 ?? indicators?.avgVolume20);
  if (!Number.isFinite(currentVolume) || !Number.isFinite(avgVolume) || avgVolume <= 0) return true;
  return currentVolume >= avgVolume * 1.2;
}

function resolveMtfAligned(mtf = {}) {
  if (typeof mtf?.aligned === "boolean") return mtf.aligned;
  if (typeof mtf?.isAligned === "boolean") return mtf.isAligned;
  const confluence = normalizeNumber(mtf?.confluenceScore ?? mtf?.score);
  if (Number.isFinite(confluence)) return confluence >= 0.55;
  return true;
}

function resolveMomentumConfirmed(indicators = {}, side) {
  const rsi = normalizeNumber(indicators?.rsi);
  const macdHistogram = normalizeNumber(indicators?.macd?.histogram ?? indicators?.macdHistogram);
  const rsiConfirmed = !Number.isFinite(rsi) || (side === "SHORT" ? rsi <= 45 : rsi >= 55);
  const macdConfirmed =
    !Number.isFinite(macdHistogram) || (side === "SHORT" ? macdHistogram < 0 : macdHistogram > 0);
  return rsiConfirmed && macdConfirmed;
}

function resolveRangeMarket({ confirmationState = {}, indicators = {}, mtf = {} }) {
  const marketRegime = String(indicators?.marketRegime ?? "").toLowerCase();
  const breakoutState = String(indicators?.breakoutState ?? "").toLowerCase();
  if (marketRegime === "ranging" || breakoutState.includes("區間")) return true;
  const mtfDisagreement = normalizeNumber(mtf?.disagreement ?? mtf?.disagreementRatio ?? mtf?.divergence);
  const mtfDivergent = confirmationState?.mtfAligned === false || (Number.isFinite(mtfDisagreement) && mtfDisagreement >= 0.45);
  const momentumOutOfSync = confirmationState?.momentumConfirmed === false;
  const volumeLow = confirmationState?.volumeConfirmed === false;
  return mtfDivergent && momentumOutOfSync && volumeLow;
}

function resolveRangeBounds({ structure = {}, aiDecisionOutput = {} }) {
  const rangeLow = normalizeNumber(
    aiDecisionOutput?.executionPlan?.rangeLow ??
      aiDecisionOutput?.levels?.structureSupportZone?.low ??
      structure?.supportLow ??
      structure?.zoneLow
  );
  const rangeHigh = normalizeNumber(
    aiDecisionOutput?.executionPlan?.rangeHigh ??
      aiDecisionOutput?.levels?.structureResistanceZone?.high ??
      structure?.resistanceHigh ??
      structure?.zoneHigh
  );
  return { rangeLow, rangeHigh };
}

function isNearSupport(price, rangeLow, tolerancePct = RANGE_EDGE_TOLERANCE_PCT) {
  const normalizedPrice = normalizeNumber(price);
  const normalizedRangeLow = normalizeNumber(rangeLow);
  if (!Number.isFinite(normalizedPrice) || !Number.isFinite(normalizedRangeLow) || normalizedRangeLow <= 0) return false;
  const clampedTolerance = Math.min(0.005, Math.max(0.002, normalizeNumber(tolerancePct) ?? RANGE_EDGE_TOLERANCE_PCT));
  return Math.abs(normalizedPrice - normalizedRangeLow) / normalizedRangeLow <= clampedTolerance;
}

function isNearResistance(price, rangeHigh, tolerancePct = RANGE_EDGE_TOLERANCE_PCT) {
  const normalizedPrice = normalizeNumber(price);
  const normalizedRangeHigh = normalizeNumber(rangeHigh);
  if (!Number.isFinite(normalizedPrice) || !Number.isFinite(normalizedRangeHigh) || normalizedRangeHigh <= 0) return false;
  const clampedTolerance = Math.min(0.005, Math.max(0.002, normalizeNumber(tolerancePct) ?? RANGE_EDGE_TOLERANCE_PCT));
  return Math.abs(normalizedPrice - normalizedRangeHigh) / normalizedRangeHigh <= clampedTolerance;
}

function resolveRangeProbeSide({ currentPrice, side, structure = {}, aiDecisionOutput = {}, indicators = {} }) {
  if (side) return side;
  const price = normalizeNumber(currentPrice);
  if (!Number.isFinite(price)) return null;
  const supportLow = normalizeNumber(
    structure?.supportLow ?? aiDecisionOutput?.levels?.structureSupportZone?.low ?? aiDecisionOutput?.executionPlan?.rangeLow
  );
  const supportHigh = normalizeNumber(
    structure?.supportHigh ?? aiDecisionOutput?.levels?.structureSupportZone?.high ?? supportLow
  );
  const resistanceLow = normalizeNumber(
    structure?.resistanceLow ?? aiDecisionOutput?.levels?.structureResistanceZone?.low ?? aiDecisionOutput?.executionPlan?.rangeHigh
  );
  const resistanceHigh = normalizeNumber(
    structure?.resistanceHigh ?? aiDecisionOutput?.levels?.structureResistanceZone?.high ?? resistanceLow
  );
  const atr = normalizeNumber(indicators?.atr ?? aiDecisionOutput?.executionPlan?.atr ?? aiDecisionOutput?.atr);
  const tolerance = Number.isFinite(atr) && atr > 0 ? atr * 0.4 : Math.max(Math.abs(price) * 0.002, 1e-8);
  if (Number.isFinite(supportLow) || Number.isFinite(supportHigh)) {
    const supportRef = Number.isFinite(supportHigh) ? supportHigh : supportLow;
    if (Number.isFinite(supportRef) && Math.abs(price - supportRef) <= tolerance) return "LONG";
  }
  if (Number.isFinite(resistanceLow) || Number.isFinite(resistanceHigh)) {
    const resistanceRef = Number.isFinite(resistanceLow) ? resistanceLow : resistanceHigh;
    if (Number.isFinite(resistanceRef) && Math.abs(price - resistanceRef) <= tolerance) return "SHORT";
  }
  return null;
}

function resolveRangeProbeContext({ currentPrice, side, structure = {}, aiDecisionOutput = {}, indicators = {} }) {
  const price = normalizeNumber(currentPrice);
  const atr = normalizeNumber(indicators?.atr ?? aiDecisionOutput?.executionPlan?.atr ?? aiDecisionOutput?.atr);
  const tolerance = Number.isFinite(atr) && atr > 0
    ? atr * 0.4
    : Number.isFinite(price)
      ? Math.max(Math.abs(price) * 0.002, 1e-8)
      : null;
  const supportLow = normalizeNumber(
    structure?.supportLow ?? aiDecisionOutput?.levels?.structureSupportZone?.low ?? aiDecisionOutput?.executionPlan?.rangeLow
  );
  const supportHigh = normalizeNumber(
    structure?.supportHigh ?? aiDecisionOutput?.levels?.structureSupportZone?.high ?? supportLow
  );
  const resistanceLow = normalizeNumber(
    structure?.resistanceLow ?? aiDecisionOutput?.levels?.structureResistanceZone?.low ?? aiDecisionOutput?.executionPlan?.rangeHigh
  );
  const resistanceHigh = normalizeNumber(
    structure?.resistanceHigh ?? aiDecisionOutput?.levels?.structureResistanceZone?.high ?? resistanceLow
  );

  const supportRef = Number.isFinite(supportHigh) ? supportHigh : supportLow;
  const resistanceRef = Number.isFinite(resistanceLow) ? resistanceLow : resistanceHigh;
  const nearSupport = Number.isFinite(price) && Number.isFinite(supportRef) && Number.isFinite(tolerance)
    ? Math.abs(price - supportRef) <= tolerance
    : false;
  const nearResistance = Number.isFinite(price) && Number.isFinite(resistanceRef) && Number.isFinite(tolerance)
    ? Math.abs(price - resistanceRef) <= tolerance
    : false;
  const probeSide = side || (nearSupport ? "LONG" : nearResistance ? "SHORT" : null);

  return { nearSupport, nearResistance, probeSide };
}

function resolveKlineConfirmed(aiDecisionOutput = {}, indicators = {}) {
  if (typeof indicators?.klineConfirmed === "boolean") return indicators.klineConfirmed;
  const side = normalizeSide(aiDecisionOutput);
  const rsi = normalizeNumber(indicators?.rsi);
  const open = normalizeNumber(indicators?.candleOpen ?? indicators?.open);
  const close = normalizeNumber(indicators?.candleClose ?? indicators?.close);
  const high = normalizeNumber(indicators?.candleHigh ?? indicators?.high);
  const low = normalizeNumber(indicators?.candleLow ?? indicators?.low);
  const prevOpen = normalizeNumber(indicators?.prevOpen);
  const prevClose = normalizeNumber(indicators?.prevClose);
  if (!side || !Number.isFinite(open) || !Number.isFinite(close) || !Number.isFinite(high) || !Number.isFinite(low)) {
    return false;
  }
  const body = Math.abs(close - open);
  const upperWick = high - Math.max(open, close);
  const lowerWick = Math.min(open, close) - low;
  const hasUpperWick = Number.isFinite(upperWick) && upperWick >= body * 0.8;
  const hasLowerWick = Number.isFinite(lowerWick) && lowerWick >= body * 0.8;
  const bearishClose = close < open;
  const bullishClose = close > open;
  const bearishEngulfing =
    Number.isFinite(prevOpen) &&
    Number.isFinite(prevClose) &&
    prevClose > prevOpen &&
    bearishClose &&
    open >= prevClose &&
    close <= prevOpen;
  const bullishEngulfing =
    Number.isFinite(prevOpen) &&
    Number.isFinite(prevClose) &&
    prevClose < prevOpen &&
    bullishClose &&
    open <= prevClose &&
    close >= prevOpen;

  if (side === "SHORT") {
    return Number.isFinite(rsi) && rsi > 60 && (hasUpperWick || bearishEngulfing || bearishClose);
  }
  if (side === "LONG") {
    return Number.isFinite(rsi) && rsi < 40 && (hasLowerWick || bullishEngulfing || bullishClose);
  }
  return false;
}

function resolveRsiThresholdReached(indicators = {}, side) {
  const rsi = normalizeNumber(indicators?.rsi);
  if (!Number.isFinite(rsi) || !side) return false;
  if (side === "SHORT") return rsi > 60;
  if (side === "LONG") return rsi < 40;
  return false;
}

function resolveBreakoutConfirmed(aiDecisionOutput = {}, currentPrice, indicators = {}) {
  if (typeof indicators?.breakoutConfirmed === "boolean") return indicators.breakoutConfirmed;
  const side = normalizeSide(aiDecisionOutput);
  const price = normalizeNumber(currentPrice);
  const trigger = normalizeNumber(aiDecisionOutput?.executionPlan?.triggerPrice ?? aiDecisionOutput?.triggerPrice);
  if (!Number.isFinite(price) || !Number.isFinite(trigger)) return false;
  return side === "SHORT" ? price <= trigger : price >= trigger;
}

function resolveRiskRewardAcceptable(aiDecisionOutput = {}) {
  const rr = normalizeNumber(
    aiDecisionOutput?.riskReward ??
      aiDecisionOutput?.riskRewardRatio ??
      aiDecisionOutput?.executionPlan?.riskReward ??
      aiDecisionOutput?.rr
  );
  if (!Number.isFinite(rr)) return true;
  return rr >= 1.4;
}

function resolveZoneWaitBars(indicators = {}, aiDecisionOutput = {}) {
  const direct = normalizeNumber(
    indicators?.zoneWaitBars ??
      indicators?.barsInZoneWithoutConfirmation ??
      aiDecisionOutput?.executionPlan?.zoneWaitBars ??
      aiDecisionOutput?.zoneWaitBars
  );
  if (!Number.isFinite(direct)) return 0;
  return Math.max(0, Math.floor(direct));
}

function resolveDistanceFromEntryZone({
  currentPrice,
  structure = {},
  aiDecisionOutput = {},
}) {
  const price = normalizeNumber(currentPrice);
  const zoneLow = normalizeNumber(
    structure?.zoneLow ?? aiDecisionOutput?.executionPlan?.entryLow ?? aiDecisionOutput?.entryLow ?? structure?.supportLow
  );
  const zoneHigh = normalizeNumber(
    structure?.zoneHigh ?? aiDecisionOutput?.executionPlan?.entryHigh ?? aiDecisionOutput?.entryHigh ?? structure?.resistanceHigh
  );
  if (!Number.isFinite(price) || !Number.isFinite(zoneLow) || !Number.isFinite(zoneHigh)) return null;
  const low = Math.min(zoneLow, zoneHigh);
  const high = Math.max(zoneLow, zoneHigh);
  if (price >= low && price <= high) return 0;
  if (price < low) return low - price;
  return price - high;
}

function resolveMissedMoveSignals({ side, indicators = {}, structure = {} }) {
  const rsi = normalizeNumber(indicators?.rsi);
  const currentVolume = normalizeNumber(indicators?.volume?.current ?? indicators?.currentVolume);
  const avgVolume = normalizeNumber(indicators?.volume?.avg20 ?? indicators?.avgVolume20);
  const macdHistogram = normalizeNumber(indicators?.macd?.histogram ?? indicators?.macdHistogram);
  const prevMacdHistogram = normalizeNumber(indicators?.macd?.prevHistogram ?? indicators?.prevMacdHistogram);
  const reversalTag = String(
    indicators?.reversalStructure ??
      structure?.reversalStructure ??
      structure?.microStructure ??
      structure?.reversalPattern ??
      ""
  ).toLowerCase();

  const rsiExtreme = Number.isFinite(rsi)
    ? side === "SHORT"
      ? rsi >= 65
      : rsi <= 35
    : false;
  const momentumFading = Number.isFinite(macdHistogram) && Number.isFinite(prevMacdHistogram)
    ? Math.abs(macdHistogram) < Math.abs(prevMacdHistogram) * 0.75
    : Boolean(indicators?.momentumFading);
  const volumeDeclining =
    Number.isFinite(currentVolume) && Number.isFinite(avgVolume) && avgVolume > 0
      ? currentVolume <= avgVolume * 0.85
      : Boolean(indicators?.volumeDeclining);
  const reversalStructure = reversalTag.includes("lower_high") || reversalTag.includes("higher_low") || Boolean(indicators?.reversalStructure);

  const signals = {
    rsiExtreme,
    momentumFading,
    volumeDeclining,
    reversalStructure,
  };
  const signalCount = Object.values(signals).filter(Boolean).length;
  return { signals, signalCount };
}

export function runConfirmationEngine({
  aiDecisionOutput,
  currentPrice,
  indicators = {},
  structure = {},
  mtf = {},
} = {}) {
  const side = normalizeSide(aiDecisionOutput);
  const baselineDecisionType = resolveDecisionType(aiDecisionOutput, Boolean(side));
  const confirmationState = {
    priceInZone: resolvePriceInZone(currentPrice, aiDecisionOutput, structure, side),
    klineConfirmed: resolveKlineConfirmed(aiDecisionOutput, indicators),
    volumeConfirmed: resolveVolumeConfirmed(indicators),
    mtfAligned: resolveMtfAligned(mtf),
    momentumConfirmed: resolveMomentumConfirmed(indicators, side),
  };
  const rsiThresholdReached = resolveRsiThresholdReached(indicators, side);

  const breakoutConfirmed = resolveBreakoutConfirmed(aiDecisionOutput, currentPrice, indicators);
  const riskRewardAcceptable = resolveRiskRewardAcceptable(aiDecisionOutput);
  const zoneWaitBars = resolveZoneWaitBars(indicators, aiDecisionOutput);
  const missedMove = resolveMissedMoveSignals({ side, indicators, structure });
  const atr = normalizeNumber(indicators?.atr ?? aiDecisionOutput?.executionPlan?.atr ?? aiDecisionOutput?.atr);
  const zoneDistance = resolveDistanceFromEntryZone({ currentPrice, structure, aiDecisionOutput });
  const missedMoveDistanceReached =
    Number.isFinite(zoneDistance) &&
    Number.isFinite(atr) &&
    atr > 0 &&
    zoneDistance >= atr * MISSED_MOVE_ATR_RATIO;
  const hardConditions = {
    hasActionableSide: Boolean(side),
    mtfAligned: confirmationState.mtfAligned,
    riskRewardAcceptable,
    momentumConfirmed: confirmationState.momentumConfirmed,
    priceInZone: confirmationState.priceInZone,
    zoneWaitReached: zoneWaitBars >= FALLBACK_WAIT_BARS,
    missedMoveDistanceReached,
  };

  const softConditions = {
    klineConfirmed: confirmationState.klineConfirmed,
    volumeConfirmed: confirmationState.volumeConfirmed,
    breakoutConfirmed,
    zoneWaitBars,
    missedMoveSignals: missedMove.signals,
    missedMoveSignalCount: missedMove.signalCount,
  };

  const scoring = evaluateDecisionScore({
    aiDecisionOutput,
    currentPrice,
    confirmationState: {
      ...confirmationState,
      breakoutConfirmed,
      zoneWaitBars,
      missedMoveSignalCount: missedMove.signalCount,
    },
    indicators,
    structure,
    mtf,
    side,
    fallbackDecisionType: baselineDecisionType,
  });

  const primaryEntryReady =
    hardConditions.hasActionableSide &&
    hardConditions.mtfAligned &&
    hardConditions.momentumConfirmed &&
    hardConditions.priceInZone &&
    softConditions.klineConfirmed &&
    softConditions.volumeConfirmed &&
    hardConditions.riskRewardAcceptable;
  const fallbackEntryReady =
    hardConditions.hasActionableSide &&
    hardConditions.mtfAligned &&
    hardConditions.priceInZone &&
    hardConditions.zoneWaitReached &&
    hardConditions.riskRewardAcceptable &&
    (softConditions.klineConfirmed || softConditions.volumeConfirmed || softConditions.breakoutConfirmed);
  const missedMoveEntryReady =
    hardConditions.hasActionableSide &&
    hardConditions.mtfAligned &&
    hardConditions.missedMoveDistanceReached &&
    hardConditions.riskRewardAcceptable &&
    softConditions.missedMoveSignalCount >= 2;
  const rsi = normalizeNumber(indicators?.rsi);
  const rangeMarket = resolveRangeMarket({ confirmationState, indicators, mtf });
  const normalizedMarketRegime = String(indicators?.marketRegime ?? "").trim().toUpperCase();
  const isExplicitRangeRegime = normalizedMarketRegime === "RANGE" || normalizedMarketRegime === "RANGING";
  const { rangeLow, rangeHigh } = resolveRangeBounds({ structure, aiDecisionOutput });
  const isNearSupportZone = isNearSupport(currentPrice, rangeLow, indicators?.rangeEdgeTolerancePct);
  const isNearResistanceZone = isNearResistance(currentPrice, rangeHigh, indicators?.rangeEdgeTolerancePct);
  const hasRangeEdgeForSide = side === "LONG" ? isNearSupportZone : side === "SHORT" ? isNearResistanceZone : false;
  const rangeSideRsiQualified =
    Number.isFinite(rsi) &&
    (side === "LONG" ? rsi < 40 : side === "SHORT" ? rsi > 60 : false);
  const rangeEntryQualified = rangeSideRsiQualified && softConditions.klineConfirmed && hasRangeEdgeForSide;
  const blockedByRangeFilter = isExplicitRangeRegime && Boolean(side) && !rangeEntryQualified;
  const { nearSupport, nearResistance, probeSide: detectedRangeProbeSide } = resolveRangeProbeContext({
    currentPrice,
    side,
    structure,
    aiDecisionOutput,
    indicators,
  });
  const rangeProbeSide = detectedRangeProbeSide || resolveRangeProbeSide({ currentPrice, side, structure, aiDecisionOutput, indicators });
  const dGradeRsiProbeReady =
    scoring?.scoreGrade === "D" &&
    Number.isFinite(rsi) &&
    (rsi <= 40 || rsi >= 60) &&
    softConditions.klineConfirmed;
  const noTradeBars = Math.max(0, Math.floor(normalizeNumber(indicators?.noTradeBars) || 0));
  const forceProbeByNoTradeBars = noTradeBars >= FORCE_PROBE_NO_TRADE_BARS;
  const forceProbeByFlag = Boolean(indicators?.forceProbeEntry);
  const cooldownActiveForSide = Boolean(indicators?.cooldownActiveForSide);
  const rangeProbeReady = (nearSupport || nearResistance) && softConditions.klineConfirmed;
  const probeTriggered = dGradeRsiProbeReady || rangeProbeReady || forceProbeByNoTradeBars || forceProbeByFlag;
  const probeSide = rangeProbeSide || (Number.isFinite(rsi) ? (rsi <= 40 ? "LONG" : rsi >= 60 ? "SHORT" : side) : side);

  console.debug("[confirmation-engine] PROBE_ENTRY_D check", {
    rsi,
    isRange: rangeMarket,
    isExplicitRangeRegime,
    nearSupport,
    nearResistance,
    isNearSupport: isNearSupportZone,
    isNearResistance: isNearResistanceZone,
    blockedByRangeFilter,
    noTradeBars,
    rsiReady: dGradeRsiProbeReady,
    rangeReady: rangeProbeReady,
    forcedByNoTradeBars: forceProbeByNoTradeBars,
    forcedByFlag: forceProbeByFlag,
    probeTriggered,
  });

  let decisionType = scoring?.decisionType || baselineDecisionType;
  if (cooldownActiveForSide) {
    decisionType = "NO_TRADE";
  }
  if (primaryEntryReady) {
    decisionType = "IMMEDIATE_ENTRY";
  } else if (fallbackEntryReady) {
    decisionType = "FALLBACK_ENTRY";
  } else if (missedMoveEntryReady) {
    decisionType = "MISSED_MOVE_ENTRY";
  } else if (probeTriggered) {
    decisionType = "PROBE_ENTRY_D";
  }
  if (rsiThresholdReached && !softConditions.klineConfirmed) {
    decisionType = "CONFIRMATION_REQUIRED";
  }
  if (cooldownActiveForSide) {
    decisionType = "NO_TRADE";
  }
  if (blockedByRangeFilter) {
    decisionType = "NO_TRADE";
  }

  let canExecute = false;
  if (decisionType === "IMMEDIATE_ENTRY") {
    canExecute = primaryEntryReady;
  } else if (decisionType === "FALLBACK_ENTRY") {
    canExecute =
      fallbackEntryReady &&
      scoring.totalScore >= 52;
  } else if (decisionType === "MISSED_MOVE_ENTRY") {
    canExecute =
      missedMoveEntryReady &&
      scoring.totalScore >= 50;
  } else if (decisionType === "OPPORTUNITY_ENTRY") {
    const relaxedOpportunitySignal =
      confirmationState.priceInZone || confirmationState.klineConfirmed || breakoutConfirmed;
    canExecute =
      confirmationState.mtfAligned &&
      confirmationState.momentumConfirmed &&
      riskRewardAcceptable &&
      relaxedOpportunitySignal;
  } else if (decisionType === "WAIT_PULLBACK") {
    canExecute = confirmationState.priceInZone && confirmationState.klineConfirmed;
  } else if (decisionType === "WAIT_BREAKOUT") {
    canExecute = breakoutConfirmed && confirmationState.volumeConfirmed;
  } else if (decisionType === "CONFIRMATION_REQUIRED") {
    canExecute =
      false;
  } else if (decisionType === "STANDARD_ENTRY" || decisionType === "WAIT_PULLBACK") {
    canExecute =
      scoring.totalScore >= 68 &&
      confirmationState.priceInZone &&
      confirmationState.klineConfirmed;
  } else if (decisionType === "WAIT_BREAKOUT") {
    canExecute =
      scoring.totalScore >= 68 &&
      breakoutConfirmed &&
      confirmationState.volumeConfirmed;
  } else if (decisionType === "OPPORTUNITY_ENTRY" || decisionType === "CONFIRMATION_REQUIRED") {
    canExecute =
      scoring.totalScore >= 54 &&
      confirmationState.priceInZone &&
      confirmationState.mtfAligned;
  } else if (decisionType === "PROBE_ENTRY_D") {
    canExecute = rangeMarket ? rangeProbeReady : probeTriggered;
  } else if (decisionType === "NO_TRADE") {
    canExecute = false;
  }
  if (blockedByRangeFilter) {
    canExecute = false;
  }

  return {
    decisionType,
    baselineDecisionType,
    scoring,
    confirmationState: {
      ...confirmationState,
      hasKlineConfirmation: confirmationState.klineConfirmed,
      breakoutConfirmed,
      rsiThresholdReached,
      riskRewardAcceptable,
      zoneWaitBars,
      hardConditions,
      softConditions,
      rangeMarket,
      isExplicitRangeRegime,
      nearSupport,
      nearResistance,
      rangeLow,
      rangeHigh,
      isNearSupport: isNearSupportZone,
      isNearResistance: isNearResistanceZone,
      blockedByRangeFilter,
      rangeProbeSide: probeSide,
      dGradeRsiProbeReady,
      forceProbeByNoTradeBars,
      forceProbeByFlag,
      cooldownActiveForSide,
    },
    canExecute,
    hasKlineConfirmation: confirmationState.klineConfirmed,
    side: probeSide || side,
  };
}

export function mapDecisionTypeToExecutionIntent(decisionType, confirmationResult = null) {
  if (decisionType === "IMMEDIATE_ENTRY") return "EXECUTE_NOW";
  if (decisionType === "FALLBACK_ENTRY" || decisionType === "MISSED_MOVE_ENTRY") {
    return confirmationResult?.canExecute ? "EXECUTE_NOW" : "PLACE_PENDING";
  }
  if (decisionType === "STANDARD_ENTRY") return "PLACE_PENDING";
  if (decisionType === "OPPORTUNITY_ENTRY")
    return confirmationResult?.canExecute ? "EXECUTE_NOW" : "PLACE_PENDING";
  if (decisionType === "PROBE_ENTRY_D")
    return confirmationResult?.canExecute ? "EXECUTE_NOW" : "PLACE_PENDING";
  if (decisionType === "WAIT_PULLBACK" || decisionType === "WAIT_BREAKOUT")
    return "PLACE_PENDING";
  if (decisionType === "CONFIRMATION_REQUIRED")
    return "WATCH_AND_ARM";
  return "WATCH_ONLY";
}
