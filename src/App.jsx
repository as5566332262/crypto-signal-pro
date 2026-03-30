import React, { useEffect, useMemo, useState } from "react";
import {
  applyMarketTickToPaperState,
  closePositionManually,
  createInitialPaperAccountState,
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
const PAPER_SUPPORTED_SYMBOLS = ["BTC", "ETH", "SOL"];

function loadPaperAccount() {
  if (typeof window === "undefined") return createInitialPaperAccountState();
  try {
    const raw = window.localStorage.getItem(PAPER_ACCOUNT_STORAGE_KEY);
    if (!raw) return createInitialPaperAccountState();
    const parsed = JSON.parse(raw);
    return {
      ...createInitialPaperAccountState(),
      ...parsed,
      openPositions: Array.isArray(parsed?.openPositions) ? parsed.openPositions : [],
      pendingOrders: Array.isArray(parsed?.pendingOrders) ? parsed.pendingOrders : [],
      cancelledOrders: Array.isArray(parsed?.cancelledOrders) ? parsed.cancelledOrders : [],
      closedTrades: Array.isArray(parsed?.closedTrades) ? parsed.closedTrades : [],
      simulationOrderConfig: {
        mode: "fixed_quantity",
        quantity: Number(parsed?.simulationOrderConfig?.quantity) > 0 ? Number(parsed.simulationOrderConfig.quantity) : 50,
      },
    };
  } catch {
    return createInitialPaperAccountState();
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
  };
  return reasonMap[reason] || "條件變更，掛單已取消";
}

function mapExecutionBlockedReason(resultCode, decision) {
  const setupType = String(decision?.setupType || decision?.executionPlan?.setupType || "").toLowerCase();
  const entryTiming = String(decision?.entryTiming || "").toUpperCase();
  const confidence = String(decision?.confidence || "").toUpperCase();

  if (setupType === "no_setup" || setupType === "no-trade") return "無有效 setup，未執行";
  if (entryTiming === "WAIT_PULLBACK" || entryTiming === "WAIT_BREAKOUT") return "尚未進入進場區間";
  if (entryTiming === "TOO_LATE") return "觸發條件尚未成立";
  if (confidence === "LOW" || confidence === "低") return "信心不足，未建立模擬單";

  const reasonMap = {
    SKIP_HOLD_NO_TRIGGER: "AI 決策目前為「不交易」",
    SKIP_NO_ACTIONABLE_SIDE: "觸發條件尚未成立",
    BLOCKED_BY_TRAP: "誘多 / 誘空風險阻擋執行",
    DUPLICATE_SETUP: "同一 setup 已存在掛單或持倉",
    MISSING_TRIGGER: "觸發條件尚未成立",
    SETUP_ALREADY_INVALIDATED: "無有效 setup，未執行",
    NO_DECISION: "尚未產生可執行決策",
  };
  return reasonMap[resultCode] || "條件不足，暫不執行";
}

function getSimulationButtonState(decision) {
  if (!decision) {
    return {
      disabled: true,
      disabledReason: "尚未取得 AI 決策",
    };
  }

  const action = String(decision?.action || decision?.executionPlan?.action || "").toUpperCase();
  const triggerPrice = Number(decision?.executionPlan?.triggerPrice ?? decision?.triggerPrice);
  const setupType = String(decision?.setupType || decision?.executionPlan?.setupType || "").toLowerCase();

  if (setupType === "no_setup" || setupType === "no-trade") {
    return { disabled: true, disabledReason: "無有效 setup，未執行" };
  }
  if ((action === "HOLD" || !action) && !Number.isFinite(triggerPrice)) {
    return { disabled: true, disabledReason: "AI 決策目前為「不交易」" };
  }
  return { disabled: false, disabledReason: "" };
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
    action,
    confidence: localizeConfidence(adjustedConfidenceLevel),
    risk: riskLevel,
    summary,
    marketRegime: localizeMarketRegime(marketRegime),
    mtfBias: mtfBiasObject,
    executionPlan: {
      action,
      currentActionLabel:
        action === "LONG" ? "偏多劇本：等待觸發後執行做多" : action === "SHORT" ? "偏空劇本：等待觸發後執行做空" : "目前動作：觀望，等待條件完成",
      rangeHigh,
      rangeLow,
      triggerPrice: triggerPrice != null ? Number(triggerPrice.toFixed(4)) : undefined,
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
  useEffect(() => {
    try {
      const updateSW = registerSW({ immediate: true });
      return () => updateSW && updateSW();
    } catch {
      return undefined;
    }
  }, []);

  const [symbol, setSymbol] = useState("SOLUSDT");
  const [timeframe, setTimeframe] = useState("15m");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const [candles, setCandles] = useState([]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [paperSymbol, setPaperSymbol] = useState("SOL");
  const [paperAccount, setPaperAccount] = useState(() => loadPaperAccount());
  const [simulationExecutionStatus, setSimulationExecutionStatus] = useState(null);

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
      setAnalysis(analyzeMarket(candlesByInterval, nextTimeframe, nextSymbol));
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(PAPER_ACCOUNT_STORAGE_KEY, JSON.stringify(paperAccount));
  }, [paperAccount]);

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
    if (!paperCurrentPrice) return;
    setPaperAccount((prev) =>
      applyMarketTickToPaperState(prev, {
        price: paperCurrentPrice,
        candleClose: currentCandle?.close,
      })
    );
  }, [paperCurrentPrice, currentCandle?.close]);

  useEffect(() => {
    if (!analysis?.aiDecisionOutput) return;
    setPaperAccount((prev) =>
      reconcilePendingOrdersWithDecision({
        state: prev,
        decision: analysis.aiDecisionOutput,
        symbol: paperMarketSymbol,
        timeframe,
        currentPrice: paperCurrentPrice,
      })
    );
  }, [analysis?.aiDecisionOutput, paperCurrentPrice, paperMarketSymbol, timeframe]);

  const accountSnapshot = useMemo(() => {
    const wins = paperAccount.closedTrades.filter((trade) => trade.realizedPnl >= 0).length;
    const losses = paperAccount.closedTrades.length - wins;
    const totalTrades = paperAccount.closedTrades.length;
    const winRate = totalTrades ? (wins / totalTrades) * 100 : 0;

    return {
      ...paperAccount,
      wins,
      losses,
      totalTrades,
      winRate,
    };
  }, [paperAccount]);

  const handleExecuteSimulation = () => {
    if (!analysis?.aiDecisionOutput || !paperCurrentPrice) {
      setSimulationExecutionStatus({
        status: "BLOCKED",
        statusLabel: "模擬執行被阻擋",
        reason: "尚未取得即時價格或 AI 決策",
        timestamp: new Date().toISOString(),
      });
      return;
    }

    setPaperAccount((prev) => {
      let nextFeedback = {
        status: "BLOCKED",
        statusLabel: "模擬執行被阻擋",
        reason: "觸發條件尚未成立",
        timestamp: new Date().toISOString(),
      };
      const reconciledState = reconcilePendingOrdersWithDecision({
        state: prev,
        decision: analysis.aiDecisionOutput,
        symbol: paperMarketSymbol,
        timeframe,
        currentPrice: paperCurrentPrice,
      });
      const previousCancelledCount = (prev.cancelledOrders || []).length;
      const cancelledCount = (reconciledState.cancelledOrders || []).length - previousCancelledCount;
      const latestCancelled = cancelledCount > 0 ? reconciledState.cancelledOrders?.[0] : null;
      const selectedQuantity = Number(prev?.simulationOrderConfig?.quantity) > 0 ? Number(prev.simulationOrderConfig.quantity) : 50;
      const result = simulateDecisionExecution({
        state: reconciledState,
        decision: analysis.aiDecisionOutput,
        symbol: paperMarketSymbol,
        timeframe,
        currentPrice: paperCurrentPrice,
        quantity: selectedQuantity,
      });
      const executedState = result.result === "PENDING_CREATED"
        ? applyMarketTickToPaperState(result.state, {
          price: paperCurrentPrice,
          candleClose: currentCandle?.close,
        })
        : result.state;

      const prevOpenCount = prev.openPositions.filter((position) => position.symbol === paperMarketSymbol && position.timeframe === timeframe).length;
      const nextOpenCount = executedState.openPositions.filter((position) => position.symbol === paperMarketSymbol && position.timeframe === timeframe).length;

      if (nextOpenCount > prevOpenCount) {
        nextFeedback = {
          status: "POSITION_OPENED",
          statusLabel: "已開啟模擬持倉",
          reason: "掛單觸發成功，已建立持倉",
          timestamp: new Date().toISOString(),
        };
      } else if (result.result === "PENDING_CREATED") {
        nextFeedback = {
          status: "PENDING_CREATED",
          statusLabel: "掛單已建立",
          reason: "已建立待觸發模擬掛單",
          timestamp: new Date().toISOString(),
        };
      } else if (cancelledCount > 0) {
        nextFeedback = {
          status: "PENDING_CANCELLED",
          statusLabel: "掛單已取消",
          reason: mapCancelReasonLabel(latestCancelled?.cancelReason),
          timestamp: latestCancelled?.cancelledAt || new Date().toISOString(),
        };
      } else if (String(analysis.aiDecisionOutput?.setupType || "").toLowerCase() === "no_setup") {
        nextFeedback = {
          status: "NO_SETUP",
          statusLabel: "無有效 setup，未執行",
          reason: "策略條件不足，系統未建立模擬單",
          timestamp: new Date().toISOString(),
        };
      } else {
        nextFeedback = {
          status: "BLOCKED",
          statusLabel: "模擬執行被阻擋",
          reason: mapExecutionBlockedReason(result.result, analysis.aiDecisionOutput),
          timestamp: new Date().toISOString(),
        };
      }

      setSimulationExecutionStatus(nextFeedback);
      return executedState;
    });
  };

  const handleSimulationQuantityChange = (quantity) => {
    setPaperAccount((prev) => ({
      ...prev,
      simulationOrderConfig: {
        mode: "fixed_quantity",
        quantity: Number(quantity) > 0 ? Number(quantity) : 1,
      },
    }));
  };

  const handleClosePosition = () => {
    if (!paperCurrentPrice) return;

    setPaperAccount((prev) =>
      closePositionManually(prev, {
        symbol: paperMarketSymbol,
        timeframe,
        price: paperCurrentPrice,
        reason: "MANUAL_CLOSE",
      })
    );
  };

  const handleResetPaperAccount = () => {
    setPaperAccount(resetPaperTradingState());
    setSimulationExecutionStatus(null);
  };

  const simulationButtonState = useMemo(
    () => getSimulationButtonState(analysis?.aiDecisionOutput),
    [analysis?.aiDecisionOutput]
  );

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
          simulationOrderConfig={accountSnapshot.simulationOrderConfig}
          onSimulationQuantityChange={handleSimulationQuantityChange}
          simulationExecutionStatus={simulationExecutionStatus}
          simulationButtonState={simulationButtonState}
          onClosePosition={handleClosePosition}
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
