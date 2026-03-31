function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeRatio(value, fallback = 0.5) {
  const parsed = normalizeNumber(value);
  if (!Number.isFinite(parsed)) return fallback;
  return clamp(parsed, 0, 1);
}

function pushFactor(list, label, impact) {
  list.push({ label, impact: Number(impact.toFixed(1)) });
}

function calculateTrendScore({ side, indicators = {}, structure = {} }) {
  const factors = [];
  let score = 55;
  const price = normalizeNumber(indicators?.price ?? indicators?.close);
  const ma20 = normalizeNumber(indicators?.ma20);
  const ma50 = normalizeNumber(indicators?.ma50);

  if (Number.isFinite(price) && Number.isFinite(ma20) && Number.isFinite(ma50)) {
    const bullishAligned = price >= ma20 && ma20 >= ma50;
    const bearishAligned = price <= ma20 && ma20 <= ma50;
    const trendAligned = side === "SHORT" ? bearishAligned : bullishAligned;
    if (trendAligned) {
      score += 26;
      pushFactor(factors, "均線排列與方向一致", 26);
    } else {
      score -= 22;
      pushFactor(factors, "均線排列與方向衝突", -22);
    }
  }

  const adx = normalizeNumber(indicators?.adx);
  if (Number.isFinite(adx)) {
    if (adx >= 26) {
      score += 12;
      pushFactor(factors, "趨勢強度 ADX > 26", 12);
    } else if (adx < 18) {
      score -= 14;
      pushFactor(factors, "趨勢偏弱 ADX < 18", -14);
    }
  }

  const structureTag = String(structure?.structure ?? "").toLowerCase();
  if (structureTag.includes("上升") || structureTag.includes("bull")) {
    if (side === "LONG") {
      score += 8;
      pushFactor(factors, "結構偏多", 8);
    } else {
      score -= 8;
      pushFactor(factors, "空方逆結構", -8);
    }
  }
  if (structureTag.includes("下降") || structureTag.includes("bear")) {
    if (side === "SHORT") {
      score += 8;
      pushFactor(factors, "結構偏空", 8);
    } else {
      score -= 8;
      pushFactor(factors, "多方逆結構", -8);
    }
  }

  return { score: clamp(score, 0, 100), factors };
}

function calculateStructureScore({ confirmationState = {}, structure = {}, side, currentPrice }) {
  const factors = [];
  let score = 50;

  if (confirmationState.priceInZone) {
    score += 25;
    pushFactor(factors, "價格位於理想進場區", 25);
  } else {
    score -= 22;
    pushFactor(factors, "價格未落入進場區", -22);
  }

  const zoneMid = normalizeNumber(structure?.zoneMid);
  const price = normalizeNumber(currentPrice);
  if (Number.isFinite(zoneMid) && Number.isFinite(price)) {
    const distanceRatio = Math.abs(price - zoneMid) / Math.max(Math.abs(zoneMid), 1);
    if (distanceRatio <= 0.0035) {
      score += 10;
      pushFactor(factors, "接近結構中樞", 10);
    } else if (distanceRatio >= 0.012) {
      score -= 9;
      pushFactor(factors, "偏離結構中樞", -9);
    }
  }

  if (confirmationState.klineConfirmed) {
    score += 18;
    pushFactor(factors, "K 線觸發成立", 18);
  } else {
    score -= 14;
    pushFactor(factors, "K 線觸發未成立", -14);
  }

  if (!side) {
    score -= 18;
    pushFactor(factors, "缺少可執行方向", -18);
  }

  return { score: clamp(score, 0, 100), factors };
}

function calculateMomentumScore({ confirmationState = {}, indicators = {} }) {
  const factors = [];
  let score = 52;
  if (confirmationState.momentumConfirmed) {
    score += 24;
    pushFactor(factors, "RSI/MACD 動能同步", 24);
  } else {
    score -= 24;
    pushFactor(factors, "RSI/MACD 動能未同步", -24);
  }

  const rsi = normalizeNumber(indicators?.rsi);
  if (Number.isFinite(rsi) && rsi >= 47 && rsi <= 53) {
    score -= 8;
    pushFactor(factors, "RSI 落在中性區", -8);
  }

  return { score: clamp(score, 0, 100), factors };
}

function calculateVolumeScore({ confirmationState = {}, indicators = {} }) {
  const factors = [];
  let score = 58;

  if (confirmationState.volumeConfirmed) {
    score += 18;
    pushFactor(factors, "量能確認", 18);
  } else {
    score -= 30;
    pushFactor(factors, "量能不足", -30);
  }

  const currentVolume = normalizeNumber(indicators?.volume?.current ?? indicators?.currentVolume);
  const avgVolume = normalizeNumber(indicators?.volume?.avg20 ?? indicators?.avgVolume20);
  if (Number.isFinite(currentVolume) && Number.isFinite(avgVolume) && avgVolume > 0) {
    const ratio = currentVolume / avgVolume;
    if (ratio >= 1.6) {
      score += 8;
      pushFactor(factors, "成交量顯著放大", 8);
    } else if (ratio < 0.85) {
      score -= 8;
      pushFactor(factors, "成交量萎縮", -8);
    }
  }

  return { score: clamp(score, 0, 100), factors };
}

function calculateMtfScore({ confirmationState = {}, mtf = {} }) {
  const factors = [];
  let score = 55;
  if (confirmationState.mtfAligned) {
    score += 22;
    pushFactor(factors, "多週期方向一致", 22);
  } else {
    score -= 26;
    pushFactor(factors, "多週期方向分歧", -26);
  }

  const confluence = normalizeRatio(mtf?.confluenceScore ?? mtf?.score, 0.5);
  const confluenceDelta = (confluence - 0.5) * 28;
  score += confluenceDelta;
  if (Math.abs(confluenceDelta) >= 4) {
    pushFactor(factors, "MTF confluence 分數", confluenceDelta);
  }

  return { score: clamp(score, 0, 100), factors };
}

function calculateRrScore({ aiDecisionOutput = {}, side, currentPrice }) {
  const factors = [];
  const plan = aiDecisionOutput?.executionPlan || {};
  const entry = normalizeNumber(currentPrice ?? plan?.triggerPrice ?? aiDecisionOutput?.triggerPrice);
  const stop = normalizeNumber(plan?.stopLoss ?? aiDecisionOutput?.stopLoss ?? plan?.invalidationPrice);
  const targets = [
    normalizeNumber(plan?.takeProfit1 ?? aiDecisionOutput?.takeProfit1),
    normalizeNumber(plan?.takeProfit2 ?? aiDecisionOutput?.takeProfit2),
    normalizeNumber(plan?.takeProfit3 ?? aiDecisionOutput?.takeProfit3),
  ].filter((value) => Number.isFinite(value));

  let score = 50;
  if (!side || !Number.isFinite(entry) || !Number.isFinite(stop) || !targets.length) {
    score -= 20;
    pushFactor(factors, "RR 資料不完整", -20);
    return { score: clamp(score, 0, 100), factors, rr: null };
  }

  const risk = Math.abs(entry - stop);
  if (risk <= 0) {
    score -= 28;
    pushFactor(factors, "風險距離無效", -28);
    return { score: clamp(score, 0, 100), factors, rr: null };
  }

  const reward = side === "SHORT"
    ? Math.max(...targets.map((target) => entry - target))
    : Math.max(...targets.map((target) => target - entry));
  const rr = reward / risk;

  if (rr >= 2) {
    score += 30;
    pushFactor(factors, "RR >= 2", 30);
  } else if (rr >= 1.5) {
    score += 18;
    pushFactor(factors, "RR >= 1.5", 18);
  } else if (rr >= 1.2) {
    score += 8;
    pushFactor(factors, "RR >= 1.2", 8);
  } else {
    score -= 22;
    pushFactor(factors, "RR < 1.2", -22);
  }

  return { score: clamp(score, 0, 100), factors, rr: Number(rr.toFixed(2)) };
}

function deriveGrade(totalScore) {
  if (totalScore >= 80) return "A";
  if (totalScore >= 68) return "B";
  if (totalScore >= 54) return "C";
  return "D";
}

function deriveConfidence(totalScore) {
  if (totalScore >= 78) return "high";
  if (totalScore >= 60) return "medium";
  return "low";
}

function applyTimingPenalties({ weightedTotal, confirmationState = {}, factors = [] }) {
  let adjusted = weightedTotal;
  const zoneWaitBars = normalizeNumber(confirmationState?.zoneWaitBars);
  if (Number.isFinite(zoneWaitBars) && zoneWaitBars >= 4 && !confirmationState?.klineConfirmed) {
    adjusted -= 6;
    pushFactor(factors, "區間等待過久仍未完整確認", -6);
  }
  const missedMoveSignalCount = normalizeNumber(confirmationState?.missedMoveSignalCount);
  if (Number.isFinite(missedMoveSignalCount) && missedMoveSignalCount >= 2 && !confirmationState?.priceInZone) {
    adjusted -= 8;
    pushFactor(factors, "錯過原始進場位，改採次優策略", -8);
  }
  const locationFilterScoreImpact = normalizeNumber(confirmationState?.locationFilterScoreImpact);
  if (Number.isFinite(locationFilterScoreImpact) && locationFilterScoreImpact !== 0) {
    adjusted += locationFilterScoreImpact;
    pushFactor(
      factors,
      locationFilterScoreImpact > 0 ? "趨勢盤進場位置加分" : "趨勢盤進場位置扣分",
      locationFilterScoreImpact
    );
  }
  return adjusted;
}

function gradeToDecisionType(grade, fallbackDecisionType = "NO_TRADE") {
  if (grade === "A") return "IMMEDIATE_ENTRY";
  if (grade === "B") return "STANDARD_ENTRY";
  if (grade === "C") return "OPPORTUNITY_ENTRY";
  if (fallbackDecisionType === "WAIT_PULLBACK" || fallbackDecisionType === "WAIT_BREAKOUT") return fallbackDecisionType;
  return "WATCH_ONLY";
}

export function evaluateDecisionScore({
  aiDecisionOutput = {},
  currentPrice,
  confirmationState = {},
  indicators = {},
  structure = {},
  mtf = {},
  side,
  fallbackDecisionType,
} = {}) {
  const trend = calculateTrendScore({ side, indicators, structure });
  const structureResult = calculateStructureScore({ confirmationState, structure, side, currentPrice });
  const momentum = calculateMomentumScore({ confirmationState, indicators });
  const volume = calculateVolumeScore({ confirmationState, indicators });
  const mtfResult = calculateMtfScore({ confirmationState, mtf });
  const rr = calculateRrScore({ aiDecisionOutput, side, currentPrice });

  const weightedTotal =
    trend.score * 0.2 +
    structureResult.score * 0.2 +
    momentum.score * 0.16 +
    volume.score * 0.14 +
    mtfResult.score * 0.14 +
    rr.score * 0.16;

  const timingPenaltyFactors = [];
  const adjustedWeightedTotal = applyTimingPenalties({
    weightedTotal,
    confirmationState,
    factors: timingPenaltyFactors,
  });
  const totalScore = clamp(Math.round(adjustedWeightedTotal), 0, 100);
  const scoreGrade = deriveGrade(totalScore);
  const confidenceLevel = deriveConfidence(totalScore);

  const allFactors = [
    ...trend.factors,
    ...structureResult.factors,
    ...momentum.factors,
    ...volume.factors,
    ...mtfResult.factors,
    ...rr.factors,
    ...timingPenaltyFactors,
  ].sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));

  const positiveFactors = allFactors.filter((item) => item.impact > 0).slice(0, 3);
  const negativeFactors = allFactors.filter((item) => item.impact < 0).slice(0, 3);

  return {
    trendScore: trend.score,
    structureScore: structureResult.score,
    momentumScore: momentum.score,
    volumeScore: volume.score,
    mtfScore: mtfResult.score,
    rrScore: rr.score,
    rrValue: rr.rr,
    totalScore,
    scoreGrade,
    confidenceLevel,
    keyPositiveFactors: positiveFactors,
    keyNegativeFactors: negativeFactors,
    decisionType: gradeToDecisionType(scoreGrade, fallbackDecisionType),
  };
}
