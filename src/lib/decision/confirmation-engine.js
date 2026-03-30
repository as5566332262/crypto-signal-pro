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

function resolveKlineConfirmed(aiDecisionOutput = {}, indicators = {}) {
  if (typeof indicators?.klineConfirmed === "boolean") return indicators.klineConfirmed;
  const close = normalizeNumber(indicators?.candleClose ?? indicators?.close);
  const trigger = normalizeNumber(aiDecisionOutput?.executionPlan?.triggerPrice ?? aiDecisionOutput?.triggerPrice);
  if (!Number.isFinite(close) || !Number.isFinite(trigger)) return false;
  const side = normalizeSide(aiDecisionOutput);
  return side === "SHORT" ? close <= trigger : close >= trigger;
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

export function runConfirmationEngine({
  aiDecisionOutput,
  currentPrice,
  indicators = {},
  structure = {},
  mtf = {},
} = {}) {
  const side = normalizeSide(aiDecisionOutput);
  const decisionType = resolveDecisionType(aiDecisionOutput, Boolean(side));
  const confirmationState = {
    priceInZone: resolvePriceInZone(currentPrice, aiDecisionOutput, structure, side),
    klineConfirmed: resolveKlineConfirmed(aiDecisionOutput, indicators),
    volumeConfirmed: resolveVolumeConfirmed(indicators),
    mtfAligned: resolveMtfAligned(mtf),
    momentumConfirmed: resolveMomentumConfirmed(indicators, side),
  };

  const breakoutConfirmed = resolveBreakoutConfirmed(aiDecisionOutput, currentPrice, indicators);
  const riskRewardAcceptable = resolveRiskRewardAcceptable(aiDecisionOutput);

  let canExecute = false;
  if (decisionType === "IMMEDIATE_ENTRY") {
    canExecute = confirmationState.mtfAligned && confirmationState.momentumConfirmed;
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
      confirmationState.priceInZone &&
      confirmationState.klineConfirmed &&
      confirmationState.volumeConfirmed &&
      confirmationState.mtfAligned &&
      confirmationState.momentumConfirmed;
  }

  return {
    decisionType,
    confirmationState: {
      ...confirmationState,
      breakoutConfirmed,
      riskRewardAcceptable,
    },
    canExecute,
    side,
  };
}

export function mapDecisionTypeToExecutionIntent(decisionType, confirmationResult = null) {
  if (decisionType === "IMMEDIATE_ENTRY") return "EXECUTE_NOW";
  if (decisionType === "OPPORTUNITY_ENTRY") return confirmationResult?.canExecute ? "EXECUTE_NOW" : "PLACE_PENDING";
  if (decisionType === "WAIT_PULLBACK" || decisionType === "WAIT_BREAKOUT") return "PLACE_PENDING";
  if (decisionType === "CONFIRMATION_REQUIRED") return "WATCH_AND_ARM";
  return "WATCH_ONLY";
}
