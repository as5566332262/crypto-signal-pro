import React, { useEffect, useMemo, useState } from "react";
import { registerSW } from "virtual:pwa-register";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import {
  RefreshCw,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Activity,
  BrainCircuit,
  Target,
} from "lucide-react";
import {
  ResponsiveContainer,
  ComposedChart,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Line,
  Bar,
  ReferenceArea,
  ReferenceLine,
  Cell,
} from "recharts";
import { motion } from "framer-motion";

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

const APP_TITLE = "Crypto Signal Pro V3";

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
}) {
  const regimeText =
    marketRegime === "trend"
      ? "趨勢盤"
      : marketRegime === "ranging"
      ? "震盪盤"
      : marketRegime === "high volatility"
      ? "高波動盤"
      : "弱趨勢盤";

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

  return `主週期（${primaryTimeframe}）判讀為${bias}，市場目前屬於${regimeText}，結構為${structure}，${rhythm}。多週期一致性：${confluence}，整體信心等級為 ${confidenceLevel.toUpperCase()}。${reason}；因此策略建議「${entryAdvice} / ${setup}」，多頭機率約 ${longProb}%、空頭機率約 ${shortProb}%，請依波動調整倉位與節奏。`;
}

function getTradePlan({ bias, setup, levels, price, atr }) {
  const buffer = Math.max((atr || price * 0.01) * 0.3, price * 0.002);

  if (bias === "偏多") {
    return {
      entryZone:
        setup === "等突破"
          ? `${formatNumber(levels.structureResistanceZone.low)} ~ ${formatNumber(
              levels.structureResistanceZone.high + buffer
            )}`
          : `${formatNumber(levels.structureSupportZone.low)} ~ ${formatNumber(
              levels.structureSupportZone.high
            )}`,
      invalidation: formatNumber(levels.structureSupportZone.low - buffer),
      target1: formatNumber(levels.nearestResistance),
      target2: formatNumber(levels.secondResistance),
    };
  }

  if (bias === "偏空") {
    return {
      entryZone:
        setup === "等跌破"
          ? `${formatNumber(levels.structureSupportZone.low - buffer)} ~ ${formatNumber(
              levels.structureSupportZone.high
            )}`
          : `${formatNumber(levels.structureResistanceZone.low)} ~ ${formatNumber(
              levels.structureResistanceZone.high
            )}`,
      invalidation: formatNumber(levels.structureResistanceZone.high + buffer),
      target1: formatNumber(levels.nearestSupport),
      target2: formatNumber(levels.secondSupport),
    };
  }

  return {
    entryZone: "等待突破或回踩確認",
    invalidation: "-",
    target1: formatNumber(levels.nearestResistance),
    target2: formatNumber(levels.secondSupport),
  };
}

function analyzeMarket(candlesByInterval, primaryTimeframe) {
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
  const { longProb, shortProb } = probabilityModel({
    bias,
    breakoutState,
    confluence,
    volumeState,
    liquiditySweep,
    priceVsVwap,
    riskLevel,
    marketRegime,
    confidenceLevel,
    entryScore: entryScoreBase,
  });

  const smartSignal =
    bias === "偏多"
      ? breakoutState === "向上突破"
        ? "順勢突破多"
        : "回踩支撐多"
      : bias === "偏空"
      ? breakoutState === "向下跌破"
        ? "順勢跌破空"
        : "反彈壓力空"
      : "等待確認";

  const aiSummary = buildAiSummary({
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
  });

  const timeframeBiases = timeframeSignals.map(({ interval, bias: intervalBias, spread, weight }) => ({
    interval,
    bias: intervalBias,
    spread: Number(spread.toFixed(2)),
    weight: Number(weight.toFixed(2)),
  }));

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
    confidenceLevel,
    marketRegime,
    entryScore: Number(entryScoreBase.toFixed(1)),
    riskLevel,
    structure: structureInfo.structure,
    breakoutState,
    volumeState,
    tradePlan,
    liquiditySweep,
    trendlineState,
    aiSummary,
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

function MetricCard({ label, value, helper }) {
  return (
    <Card className="rounded-2xl shadow-sm">
      <CardContent className="p-4">
        <div className="text-sm text-slate-500">{label}</div>
        <div className="mt-1 text-2xl font-semibold">{value}</div>
        {helper ? <div className="mt-1 text-xs text-slate-500">{helper}</div> : null}
      </CardContent>
    </Card>
  );
}

function CustomTooltip({ active, payload, label, symbol }) {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0]?.payload || {};
  const digits = symbol === "BTCUSDT" ? 0 : 2;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 text-sm shadow-lg">
      <div className="mb-2 font-medium">{label}</div>
      <div>開盤：{formatNumber(row.open, digits)}</div>
      <div>最高：{formatNumber(row.high, digits)}</div>
      <div>最低：{formatNumber(row.low, digits)}</div>
      <div>收盤：{formatNumber(row.close, digits)}</div>
      <div>MA20：{formatNumber(row.ma20, digits)}</div>
      <div>MA50：{formatNumber(row.ma50, digits)}</div>
      <div>成交量：{formatNumber(row.volume, 2)}</div>
    </div>
  );
}

function CandlestickBody(props) {
  const { x, width, payload } = props;
  if (!payload) return null;
  const bullish = payload.close >= payload.open;

  return (
    <g>
      <line
        x1={x + width / 2}
        x2={x + width / 2}
        y1={payload.highY}
        y2={payload.lowY}
        stroke={bullish ? "#16a34a" : "#dc2626"}
        strokeWidth={1.5}
      />
      <rect
        x={x + width * 0.2}
        y={Math.min(payload.openY, payload.closeY)}
        width={width * 0.6}
        height={Math.max(2, Math.abs(payload.closeY - payload.openY))}
        fill={bullish ? "#16a34a" : "#dc2626"}
        rx={1}
      />
    </g>
  );
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
      setAnalysis(analyzeMarket(candlesByInterval, nextTimeframe));
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

  const biasStyle = useMemo(() => {
    if (!analysis) return "bg-slate-100 text-slate-700";
    if (analysis.bias === "偏多") return "bg-emerald-100 text-emerald-700";
    if (analysis.bias === "偏空") return "bg-rose-100 text-rose-700";
    return "bg-slate-100 text-slate-700";
  }, [analysis]);

  const digits = symbol === "BTCUSDT" ? 0 : 2;
  const timeframeLabel =
    INTERVAL_OPTIONS.find((item) => item.value === timeframe)?.label || timeframe;

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid gap-4"
        >
          <Card className="rounded-3xl border-0 shadow-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-2xl">
                <Activity className="h-6 w-6" />
                {APP_TITLE}
              </CardTitle>
            </CardHeader>

            <CardContent className="space-y-5">
              <div className="grid gap-3 md:grid-cols-4">
                <div>
                  <div className="mb-2 text-sm text-slate-600">幣種</div>
                  <Select value={symbol} onValueChange={setSymbol}>
                    <SelectTrigger className="rounded-2xl bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SYMBOL_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <div className="mb-2 text-sm text-slate-600">週期</div>
                  <Select value={timeframe} onValueChange={setTimeframe}>
                    <SelectTrigger className="rounded-2xl bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {INTERVAL_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-end">
                  <Button
                    className="w-full rounded-2xl"
                    onClick={() => loadData(symbol, timeframe)}
                    disabled={isLoading}
                  >
                    <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
                    重新分析
                  </Button>
                </div>

                <div>
                  <div className="mb-2 text-sm text-slate-600">自動更新</div>
                  <Button
                    variant={autoRefresh ? "default" : "outline"}
                    className="w-full rounded-2xl"
                    onClick={() => setAutoRefresh((v) => !v)}
                  >
                    {autoRefresh ? "已開啟" : "已關閉"}
                  </Button>
                </div>
              </div>

              {error ? (
                <Alert className="rounded-2xl border-rose-200 bg-rose-50 text-rose-700">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}

              <div className="rounded-2xl bg-slate-100 p-4 text-sm text-slate-600">
                目前分析週期：{timeframeLabel}。V3 第一階段已升級為 15m / 1h / 4h / 1d 多週期共振，並加入市場狀態、
                信心等級、分維度進場評分與強化結論文字。最後更新：
                {lastUpdated || "-"}
              </div>
            </CardContent>
          </Card>

        </motion.div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <MetricCard label="現價" value={formatNumber(analysis?.price, digits)} />
          <MetricCard label="MA20" value={formatNumber(analysis?.ma20, digits)} helper="20 根均線" />
          <MetricCard label="MA50" value={formatNumber(analysis?.ma50, digits)} helper="50 根均線" />
          <MetricCard label="RSI" value={formatNumber(analysis?.rsi, 2)} helper="14 週期" />
          <MetricCard
            label="MACD 柱狀體"
            value={formatNumber(analysis?.macd?.histogram, 4)}
            helper="正值偏強，負值偏弱"
          />
          <MetricCard label="結構" value={analysis?.structure || "-"} helper="高低點結構" />
          <MetricCard label="突破狀態" value={analysis?.breakoutState || "-"} helper="突破 / 回踩 / 區間" />
          <MetricCard label="量能狀態" value={analysis?.volumeState || "-"} helper="放量 / 量縮 / 一般" />
          <MetricCard label="掃流動性" value={analysis?.liquiditySweep || "-"} helper="掃高 / 掃低" />
          <MetricCard label="趨勢線" value={analysis?.trendlineState || "-"} helper="趨勢線狀態" />
          <MetricCard label="多頭勝率" value={`${analysis?.longProb ?? "-"}%`} helper="V3 概率模型" />
          <MetricCard label="空頭勝率" value={`${analysis?.shortProb ?? "-"}%`} helper="V3 概率模型" />
        </div>

        <div className="grid gap-4">
          {/* LEFT SIDE */}
          <div className="space-y-4">
            <Card className="rounded-3xl border-0 shadow-md">
              <CardHeader>
                <CardTitle className="text-lg">本次結論</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-500">趨勢偏向</span>
                  <Badge className={`rounded-full px-3 py-1 text-sm ${biasStyle}`}>
                    {analysis?.bias || "讀取中"}
                  </Badge>
                </div>

                <div className="rounded-2xl bg-white p-4 shadow-sm">
                  <div className="text-sm text-slate-500">是否適合進場</div>
                  <div className="mt-1 text-xl font-semibold">{analysis?.entryAdvice || "-"}</div>
                </div>

                <div className="rounded-2xl bg-white p-4 shadow-sm">
                  <div className="text-sm text-slate-500">較佳策略</div>
                  <div className="mt-1 text-xl font-semibold">{analysis?.setup || "-"}</div>
                </div>

                <div className="rounded-2xl bg-white p-4 shadow-sm">
                  <div className="text-sm text-slate-500">進場評分</div>
                  <div className="mt-1 text-xl font-semibold">{analysis?.entryScore || "-"} / 10</div>
                </div>

                <div className="rounded-2xl bg-white p-4 shadow-sm">
                  <div className="text-sm text-slate-500">風險等級</div>
                  <div className="mt-1 text-xl font-semibold">{analysis?.riskLevel || "-"}</div>
                </div>

                <div className="rounded-2xl bg-white p-4 shadow-sm">
                  <div className="text-sm text-slate-500">信心等級</div>
                  <div className="mt-1 text-xl font-semibold">{analysis?.confidenceLevel || "-"}</div>
                </div>

                <div className="rounded-2xl bg-white p-4 shadow-sm">
                  <div className="text-sm text-slate-500">市場狀態</div>
                  <div className="mt-1 text-xl font-semibold">{analysis?.marketRegime || "-"}</div>
                </div>

                <div className="rounded-2xl bg-white p-4 shadow-sm">
                  <div className="text-sm text-slate-500">多週期共振</div>
                  <div className="mt-1 text-xl font-semibold">{analysis?.confluence || "-"}</div>
                </div>

                <div className="rounded-2xl bg-white p-4 shadow-sm">
                  <div className="text-sm text-slate-500">V3 智能訊號</div>
                  <div className="mt-1 flex items-center gap-2 text-xl font-semibold">
                    <BrainCircuit className="h-5 w-5" />
                    {analysis?.smartSignal || "-"}
                  </div>
                  <div className="mt-2 text-sm text-slate-500">
                    做多 {analysis?.longProb ?? "-"}% ・ 做空 {analysis?.shortProb ?? "-"}%
                  </div>
                </div>

                <div className="rounded-2xl bg-white p-4 shadow-sm text-sm text-slate-600">
                  {analysis?.explanation || "等待資料中..."}
                </div>

                <div className="rounded-2xl bg-slate-900 p-4 text-sm leading-6 text-white shadow-sm">
                  <div className="mb-2 text-xs uppercase tracking-wide text-slate-300">AI 綜合判斷</div>
                  <div>{analysis?.aiSummary || "等待資料中..."}</div>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-3xl shadow-md">
              <CardHeader>
                <CardTitle className="text-lg">K 線圖、均線與支撐壓力</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[360px] w-full rounded-2xl bg-slate-100 p-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 12, right: 12, left: 4, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1" />
                      <XAxis dataKey="time" minTickGap={24} tick={{ fontSize: 12 }} />
                      <YAxis yAxisId="left" domain={["auto", "auto"]} tick={{ fontSize: 12 }} width={70} />
                      <YAxis yAxisId="right" orientation="right" tick={false} hide />
                      <Tooltip content={<CustomTooltip symbol={symbol} />} />

                      <ReferenceArea
                        yAxisId="left"
                        y1={analysis?.levels?.structureSupportZone?.low}
                        y2={analysis?.levels?.structureSupportZone?.high}
                        fill="#16a34a"
                        fillOpacity={0.08}
                      />
                      <ReferenceArea
                        yAxisId="left"
                        y1={analysis?.levels?.structureResistanceZone?.low}
                        y2={analysis?.levels?.structureResistanceZone?.high}
                        fill="#dc2626"
                        fillOpacity={0.08}
                      />
                      <ReferenceLine yAxisId="left" y={analysis?.price} stroke="#0f172a" strokeDasharray="4 4" />

                      <Bar yAxisId="right" dataKey="volume" opacity={0.22} radius={[3, 3, 0, 0]}>
                        {chartData.map((entry, index) => (
                          <Cell key={`vol-${index}`} fill={entry.bullish ? "#16a34a" : "#dc2626"} />
                        ))}
                      </Bar>

                      <Bar
                        yAxisId="left"
                        dataKey="bodyValue"
                        baseValue={(data) => data.bodyBase}
                        shape={<CandlestickBody />}
                        isAnimationActive={false}
                      >
                        {chartData.map((entry, index) => (
                          <Cell key={`candle-${index}`} fill={entry.bullish ? "#16a34a" : "#dc2626"} />
                        ))}
                      </Bar>

                      <Line yAxisId="left" type="monotone" dataKey="ma20" dot={false} strokeWidth={2} stroke="#a855f7" />
                      <Line yAxisId="left" type="monotone" dataKey="ma50" dot={false} strokeWidth={2} stroke="#eab308" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                <div className="mt-3 text-sm text-slate-500">
                  這張圖目前顯示 {timeframeLabel} 週期最近 60 根 K 線、MA20、MA50、成交量，以及結構支撐 / 壓力區。
                  綠色區是結構支撐，紅色區是結構壓力，虛線是現價。
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-3xl shadow-md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  {analysis?.bias === "偏多" ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
                  交易建議
                </CardTitle>
              </CardHeader>

              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl bg-slate-100 p-4">
                    <div className="text-sm text-slate-500">建議方式</div>
                    <div className="mt-1 text-lg font-semibold">{analysis?.setup || "-"}</div>
                  </div>
                  <div className="rounded-2xl bg-slate-100 p-4">
                    <div className="text-sm text-slate-500">止損</div>
                    <div className="mt-1 text-lg font-semibold">{formatNumber(analysis?.stopLoss, digits)}</div>
                  </div>
                  <div className="rounded-2xl bg-slate-100 p-4">
                    <div className="text-sm text-slate-500">止盈</div>
                    <div className="mt-1 text-lg font-semibold">
                      {formatNumber(analysis?.takeProfit1, digits)} / {formatNumber(analysis?.takeProfit2, digits)}
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 p-4 text-sm leading-6 text-slate-600">
                  <div>• V3 第一階段改為四週期共振與市場狀態分流評分。</div>
                  <div>• 趨勢盤偏重順勢，震盪盤偏重結構區間，高波動盤會主動降分控風險。</div>
                  <div>• 若多週期分歧，進場分數與信心會同步下調。</div>
                  <div>• 勝率為概率模型推估，請搭配風控與結構位使用。</div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl bg-slate-100 p-4">
                    <div className="text-sm text-slate-500">建議進場區</div>
                    <div className="mt-1 text-lg font-semibold">{analysis?.tradePlan?.entryZone || "-"}</div>
                  </div>
                  <div className="rounded-2xl bg-slate-100 p-4">
                    <div className="text-sm text-slate-500">失效位</div>
                    <div className="mt-1 text-lg font-semibold">{analysis?.tradePlan?.invalidation || "-"}</div>
                  </div>
                  <div className="rounded-2xl bg-slate-100 p-4">
                    <div className="text-sm text-slate-500">目標一</div>
                    <div className="mt-1 text-lg font-semibold">{analysis?.tradePlan?.target1 || "-"}</div>
                  </div>
                  <div className="rounded-2xl bg-slate-100 p-4">
                    <div className="text-sm text-slate-500">目標二</div>
                    <div className="mt-1 text-lg font-semibold">{analysis?.tradePlan?.target2 || "-"}</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-3xl shadow-md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Target className="h-5 w-5" />
                  即時資料摘要
                </CardTitle>
              </CardHeader>

              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl bg-slate-100 p-4">
                    <div className="text-sm text-slate-500">短線支撐區</div>
                    <div className="mt-1 text-lg font-semibold">
                      {formatNumber(analysis?.levels?.shortSupportZone?.low, digits)} ~{" "}
                      {formatNumber(analysis?.levels?.shortSupportZone?.high, digits)}
                    </div>
                  </div>

                  <div className="rounded-2xl bg-slate-100 p-4">
                    <div className="text-sm text-slate-500">短線壓力區</div>
                    <div className="mt-1 text-lg font-semibold">
                      {formatNumber(analysis?.levels?.shortResistanceZone?.low, digits)} ~{" "}
                      {formatNumber(analysis?.levels?.shortResistanceZone?.high, digits)}
                    </div>
                  </div>

                  <div className="rounded-2xl bg-slate-100 p-4">
                    <div className="text-sm text-slate-500">結構支撐區</div>
                    <div className="mt-1 text-lg font-semibold">
                      {formatNumber(analysis?.levels?.structureSupportZone?.low, digits)} ~{" "}
                      {formatNumber(analysis?.levels?.structureSupportZone?.high, digits)}
                    </div>
                  </div>

                  <div className="rounded-2xl bg-slate-100 p-4">
                    <div className="text-sm text-slate-500">結構壓力區</div>
                    <div className="mt-1 text-lg font-semibold">
                      {formatNumber(analysis?.levels?.structureResistanceZone?.low, digits)} ~{" "}
                      {formatNumber(analysis?.levels?.structureResistanceZone?.high, digits)}
                    </div>
                  </div>

                  <div className="rounded-2xl bg-slate-100 p-4">
                    <div className="text-sm text-slate-500">ATR 波動</div>
                    <div className="mt-1 text-lg font-semibold">{formatNumber(analysis?.atr, digits)}</div>
                  </div>

                  <div className="rounded-2xl bg-slate-100 p-4">
                    <div className="text-sm text-slate-500">最近 K 線區間</div>
                    <div className="mt-1 text-lg font-semibold">
                      {formatNumber(currentCandle?.low, digits)} ~ {formatNumber(currentCandle?.high, digits)}
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 p-4 text-sm text-slate-600">
                  <div className="mb-2 font-medium text-slate-700">AI 訊號細節</div>
                  <div>多方分數：{formatNumber(analysis?.bullScore, 1)}</div>
                  <div>空方分數：{formatNumber(analysis?.bearScore, 1)}</div>
                  <div>成交量：{formatNumber(currentCandle?.volume, 2)}</div>
                  <div>V3 勝率結合主趨勢、多週期一致性、市場狀態、量能與波動風險。</div>

                  <div className="mt-3 font-medium text-slate-700">多週期同步</div>
                  {(analysis?.higherBiases || []).map((item) => (
                    <div
                      key={item.interval}
                      className="mt-1 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2"
                    >
                      <span>{item.interval}</span>
                      <span>{item.bias}</span>
                    </div>
                  ))}
                </div>

                <div>
                  <div className="mb-2 text-sm text-slate-500">自訂提醒備註</div>
                  <Input className="rounded-2xl bg-white" placeholder="例如：SOL 日線站回 MA20 再考慮多單" />
                </div>
              </CardContent>
            </Card>
          </div>

        </div>
      </div>
    </div>
  );
}
