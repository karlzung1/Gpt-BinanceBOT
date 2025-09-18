import React, { useState, useEffect, useCallback } from 'react';
import { TrendingUp, TrendingDown, Activity, RefreshCw, Crown, Send, AlertTriangle, Loader } from 'lucide-react';

const CryptoSignalChecker = () => {
  const [signals, setSignals] = useState({});
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [selectedList, setSelectedList] = useState('all');
  const [sortBy, setSortBy] = useState('longDesc');
  const [allCoins, setAllCoins] = useState([]);
  const [telegramStatus, setTelegramStatus] = useState('');
  const [top3LongSignals, setTop3LongSignals] = useState([]);
  const [top3ShortSignals, setTop3ShortSignals] = useState([]);
  const [analysisProgress, setAnalysisProgress] = useState(0);

  // 텔레그램 설정
  const TELEGRAM_TOKEN = "8276919710:AAH2-ys7r5EN-iNl3yS0hlbSZqdZDrQSqbo";
  const TELEGRAM_CHAT_ID = "6309725883";

  // 바이낸스 선물 전종목 가져오기
  const fetchBinanceFuturesSymbols = useCallback(async () => {
    try {
      const response = await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo');
      if (!response.ok) {
        throw new Error(`Binance API error: ${response.status}`);
      }
      const data = await response.json();
      
      // USDT 마켓의 무기한 계약(PERPETUAL) 종목만 필터링
      const usdtPerpetuals = data.symbols
        .filter(s => 
          s.contractType === 'PERPETUAL' && 
          s.status === 'TRADING' &&
          s.quoteAsset === 'USDT'
        )
        .map(s => s.symbol)
        .sort();

      console.log(`Fetched ${usdtPerpetuals.length} symbols from Binance.`);
      setAllCoins(usdtPerpetuals);
      return usdtPerpetuals;
    } catch (error) {
      console.error("Failed to fetch Binance symbols:", error);
      // 기본 코인 목록 사용
      const fallbackCoins = [
        "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT", 
        "ADAUSDT", "AVAXUSDT", "SHIBUSDT", "DOTUSDT", "LINKUSDT", "TRXUSDT", 
        "MATICUSDT", "LTCUSDT", "BCHUSDT", "UNIUSDT", "NEARUSDT", "ATOMUSDT"
      ].sort();
      setAllCoins(fallbackCoins);
      return fallbackCoins;
    }
  }, []);

  // 실제 바이낸스 데이터 가져오기 (K라인 데이터)
  const fetchKlineData = async (symbol, interval = '1h', limit = 100) => {
    try {
      const response = await fetch(
        `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
      );
      
      if (!response.ok) {
        throw new Error(`Failed to fetch kline data for ${symbol}`);
      }
      
      const data = await response.json();
      
      return data.map(kline => ({
        openTime: kline[0],
        open: parseFloat(kline[1]),
        high: parseFloat(kline[2]),
        low: parseFloat(kline[3]),
        close: parseFloat(kline[4]),
        volume: parseFloat(kline[5]),
        closeTime: kline[6]
      }));
    } catch (error) {
      console.error(`Error fetching kline data for ${symbol}:`, error);
      return null;
    }
  };

  // RSI 계산 함수
  const calculateRSI = (prices, period = 14) => {
    if (prices.length < period + 1) return 50;
    
    let gains = 0;
    let losses = 0;
    
    // 첫 번째 평균 계산
    for (let i = 1; i <= period; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) gains += change;
      else losses += Math.abs(change);
    }
    
    let avgGain = gains / period;
    let avgLoss = losses / period;
    
    // RSI 계산
    for (let i = period + 1; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? Math.abs(change) : 0;
      
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  };

  // EMA 계산 함수 (시리즈 전체 반환으로 개선)
  const calculateEMA = (data, period) => {
    if (data.length < period) return [];
    
    const k = 2 / (period + 1);
    const emaArray = new Array(data.length);
    
    // 초기 SMA
    let sum = 0;
    for (let i = 0; i < period; i++) {
      sum += data[i];
    }
    emaArray[period - 1] = sum / period;
    
    // EMA 계산
    for (let i = period; i < data.length; i++) {
      emaArray[i] = data[i] * k + emaArray[i - 1] * (1 - k);
    }
    
    return emaArray;
  };

  // MACD 계산 함수 (시리즈 기반으로 제대로 재구현)
  const calculateMACD = (prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) => {
    if (prices.length < slowPeriod + signalPeriod - 1) return { macd: 0, signal: 0, histogram: 0 };

    const fastEMA = calculateEMA(prices, fastPeriod);
    const slowEMA = calculateEMA(prices, slowPeriod);

    // MACD Line 계산 (slowPeriod부터 유효)
    const macdLine = [];
    for (let i = slowPeriod - 1; i < prices.length; i++) {
      macdLine.push(fastEMA[i] - slowEMA[i]);
    }

    // Signal Line: MACD Line의 EMA
    const signalEMA = calculateEMA(macdLine, signalPeriod);

    const lastMacd = macdLine[macdLine.length - 1];
    const lastSignal = signalEMA[signalEMA.length - 1];
    const histogram = lastMacd - lastSignal;

    return { macd: lastMacd, signal: lastSignal, histogram };
  };

  // 볼린저 밴드 계산 함수
  const calculateBollingerBands = (prices, period = 20, multiplier = 2) => {
    if (prices.length < period) return { upper: 0, middle: 0, lower: 0, position: 0.5 };
    
    const recentPrices = prices.slice(-period);
    const sma = recentPrices.reduce((sum, price) => sum + price, 0) / period;
    
    const variance = recentPrices.reduce((sum, price) => sum + Math.pow(price - sma, 2), 0) / period;
    const stdDev = Math.sqrt(variance);
    
    const upper = sma + (stdDev * multiplier);
    const lower = sma - (stdDev * multiplier);
    const currentPrice = prices[prices.length - 1];
    
    const bandWidth = upper - lower;
    const position = bandWidth > 0 ? (currentPrice - lower) / bandWidth : 0.5;
    
    return { upper, middle: sma, lower, position: Math.max(0, Math.min(1, position)) };
  };

  // 실제 기술적 분석 수행 (개선된 버전)
  const performTechnicalAnalysis = async (symbol) => {
    const klineDataHourly = await fetchKlineData(symbol, '1h', 100);
    const klineDataDaily = await fetchKlineData(symbol, '1d', 10); // 최근 10일 일봉 데이터

    if (!klineDataHourly || klineDataHourly.length < 50 || !klineDataDaily || klineDataDaily.length < 5) {
      return {
        longConfidence: 50, shortConfidence: 50, volatility: 30, riskLevel: 'MEDIUM', recommendation: 'NEUTRAL', rsi: 50, volumeRatio: 1, confidenceScore: 50
      };
    }

    const closesHourly = klineDataHourly.map(k => k.close);
    const volumesHourly = klineDataHourly.map(k => k.volume);
    const highsHourly = klineDataHourly.map(k => k.high);
    const lowsHourly = klineDataHourly.map(k => k.low);
    const opensHourly = klineDataHourly.map(k => k.open);

    const rsi = calculateRSI(closesHourly);
    const macd = calculateMACD(closesHourly);
    const bb = calculateBollingerBands(closesHourly);
    
    const recentCloses = closesHourly.slice(-20);
    const returns = recentCloses.slice(1).map((price, i) => Math.abs((price - recentCloses[i]) / recentCloses[i]));
    let volatility = (returns.reduce((sum, ret) => sum + ret, 0) / (returns.length || 1)) * 100;
    
    const recentVolumes = volumesHourly.slice(-20);
    const avgVolume = recentVolumes.length > 10 ? recentVolumes.slice(0, -5).reduce((sum, vol) => sum + vol, 0) / (recentVolumes.length - 5) : 1;
    const currentVolume = recentVolumes.length > 0 ? recentVolumes.slice(-5).reduce((sum, vol) => sum + vol, 0) / Math.min(5, recentVolumes.length) : 1;
    const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 1;

    const currentPrice = closesHourly[closesHourly.length - 1];
    let longConfidence = 50;
    let shortConfidence = 50;
    let customRiskOverride = null;

    // 최근 가격 움직임 분석 강화
    const price1ago = closesHourly.length > 1 ? closesHourly[closesHourly.length - 2] : closesHourly[0];
    const price3ago = closesHourly.length > 3 ? closesHourly[closesHourly.length - 4] : closesHourly[0];
    const price5ago = closesHourly.length > 5 ? closesHourly[closesHourly.length - 6] : closesHourly[0];
    const price10ago = closesHourly.length > 10 ? closesHourly[closesHourly.length - 11] : closesHourly[0];
    const price20ago = closesHourly.length > 20 ? closesHourly[closesHourly.length - 21] : closesHourly[0];
    
    // 단기/중기/장기 트렌드 계산
    const veryShortTrend = price1ago > 0 ? (currentPrice - price1ago) / price1ago : 0;
    const shortTrend = price5ago > 0 ? (currentPrice - price5ago) / price5ago : 0;
    const mediumTrend = price10ago > 0 ? (currentPrice - price10ago) / price10ago : 0;
    const longTrend = price20ago > 0 ? (currentPrice - price20ago) / price20ago : 0;

    // 혼돈 시장 감지 로직
    const recentHighs = highsHourly.slice(-10);
    const recentLows = lowsHourly.slice(-10);
    const maxHigh = Math.max(...recentHighs);
    const minLow = Math.min(...recentLows);
    const recentRange = (maxHigh - minLow) / currentPrice;

    if (recentRange > 0.8) { // 극심한 변동성
      return {
        longConfidence: 5, shortConfidence: 5, volatility: parseFloat(volatility.toFixed(1)), riskLevel: 'CHAOS', recommendation: 'NEUTRAL', rsi: parseFloat(rsi.toFixed(1)), volumeRatio: parseFloat(volumeRatio.toFixed(2)), confidenceScore: 5
      };
    }

    // EMA 기반 이격도 분석
    const ema9Array = calculateEMA(closesHourly, 9);
    const ema20Array = calculateEMA(closesHourly, 20);
    const ema50Array = calculateEMA(closesHourly, 50);
    const ema9 = ema9Array[ema9Array.length - 1];
    const ema20 = ema20Array[ema20Array.length - 1];
    
    let emaSignal = 0;
    if (ema9Array.length > 0 && ema20Array.length > 0) {
      const disparity9 = (currentPrice - ema9) / ema9;
      const disparity20 = (currentPrice - ema20) / ema20;
      
      // 상방 이격도 (과매수)
      if (disparity9 > 0.20) {
          longConfidence -= 35;
          shortConfidence += 25;
          customRiskOverride = 'HIGH';
      } else if (disparity9 > 0.10) {
          longConfidence -= 20;
          shortConfidence += 15;
      }
      
      // 하방 이격도 (과매도) - 개선된 로직
      if (disparity9 < -0.15) {
          shortConfidence -= 30; // 숏에 강한 페널티
          longConfidence += 20; // 반등 기대
          customRiskOverride = customRiskOverride || 'HIGH';
      } else if (disparity9 < -0.08) {
          shortConfidence -= 15;
          longConfidence += 10;
      }
      
      // EMA 정렬 확인
      if (ema9 > ema20 && currentPrice > ema9) {
        emaSignal += 1;
      } else if (ema9 < ema20 && currentPrice < ema9) {
        emaSignal -= 1;
      }
    }

    // RSI 기반 분석 개선
    if (rsi < 25) { // 극과매도
        longConfidence += 30;
        shortConfidence -= 35; // 숏에 강한 페널티
    } else if (rsi < 35) { // 과매도
        longConfidence += 20;
        shortConfidence -= 25;
    } else if (rsi > 75) { // 극과매수
        longConfidence -= 30;
        shortConfidence += 25;
    } else if (rsi > 65) { // 과매수
        longConfidence -= 15;
        shortConfidence += 15;
    }

    // MACD 분석
    if (macd.histogram > 0.001 && macd.macd > macd.signal) {
        longConfidence += 15;
        shortConfidence -= 5;
    } else if (macd.histogram < -0.001 && macd.macd < macd.signal) {
        longConfidence -= 10;
        shortConfidence += 15;
    }

    // 볼린저밴드 분석
    if (bb.position < 0.1) { // 하단 근처
        longConfidence += 20;
        shortConfidence -= 15;
    } else if (bb.position > 0.9) { // 상단 근처
        longConfidence -= 20;
        shortConfidence += 15;
    }

    // 트렌드 분석 강화
    if (shortTrend < -0.10) { // 5시간 내 10% 하락
        if (rsi < 40) { // 과매도 상태라면
            shortConfidence -= 20; // 숏 추격 위험
            longConfidence += 15; // 반등 기회
        } else {
            shortConfidence += 15; // 지속 하락 가능성
        }
    }
    
    if (longTrend < -0.20) { // 20시간 내 20% 하락
        if (rsi < 35) {
            shortConfidence -= 25; // 바닥 추격 위험
            longConfidence += 20;
        }
    }

    // 거래량 분석
    if (volumeRatio > 2.0 && veryShortTrend < -0.05) {
        // 고거래량 + 급락 = 공포 매도일 가능성
        if (rsi < 40) {
            longConfidence += 15;
            shortConfidence -= 10;
        }
    }

    // 연속 하락/상승 캔들 확인
    const recentCandles = klineDataHourly.slice(-5);
    const redCandles = recentCandles.filter(k => k.close < k.open).length;
    const greenCandles = recentCandles.filter(k => k.close > k.open).length;
    
    if (redCandles >= 4) { // 5봉 중 4봉 이상 하락
        if (rsi < 40) {
            shortConfidence -= 15; // 과도한 하락 후 숏은 위험
            longConfidence += 10;
        }
    }

    // 급등 후 조정 감지
    const pump3h = price3ago > 0 ? (currentPrice - price3ago) / price3ago : 0;
    if (pump3h > 0.30) { // 3시간 내 30% 상승
        longConfidence -= 40;
        shortConfidence += 30;
        customRiskOverride = 'EXTREME';
        volatility *= 1.8;
    }

    // 급락 감지 및 처리
    const dump3h = price3ago > 0 ? (price3ago - currentPrice) / price3ago : 0;
    if (dump3h > 0.25) { // 3시간 내 25% 하락
        if (rsi < 30) {
            shortConfidence -= 30; // 급락 후 숏 추격 매우 위험
            longConfidence += 25; // 반등 기회
        }
        customRiskOverride = customRiskOverride || 'HIGH';
    }

    // BTC 페어 보너스
    if (symbol.includes('BTC')) {
      longConfidence += 5;
      shortConfidence -= 3;
    }

    // 숏 신호에 대한 일봉 조건 추가 (더 엄격하게 수정: 최근 5일 중 3개 이상 음봉 + RSI > 50 + shortConfidence > 70)
    let shortBoost = 0;
    const recentDailyCandles = klineDataDaily.slice(-5); // 최근 5일 일봉
    const negativeCandlesInLast5Days = recentDailyCandles.filter(k => k.close < k.open).length;
    if (negativeCandlesInLast5Days >= 3 && rsi > 50 && shortConfidence > 70) {
      shortBoost = 10; // 조건 만족 시 숏 확신도 추가 부스트
    }
    shortConfidence += shortBoost;

    // 최종 점수 조정
    longConfidence = Math.max(5, Math.min(95, parseFloat(longConfidence.toFixed(1))));
    shortConfidence = Math.max(5, Math.min(95, parseFloat(shortConfidence.toFixed(1))));

    // 리스크 레벨 계산
    const confidenceDiff = Math.abs(longConfidence - shortConfidence);
    const riskScore = (volatility * 0.7) + ((100 - confidenceDiff) * 0.3);
    let riskLevel = riskScore > 75 ? 'HIGH' : riskScore > 45 ? 'MEDIUM' : 'LOW';
    
    if (customRiskOverride) {
        riskLevel = customRiskOverride;
    }

    // 추천 로직
    let recommendation;
    if (riskLevel === 'CHAOS') recommendation = 'NEUTRAL';
    else if (riskLevel === 'EXTREME' && shortConfidence > longConfidence + 20) recommendation = 'STRONG_SHORT';
    else if (longConfidence >= 75 && riskLevel !== 'EXTREME') recommendation = 'STRONG_LONG';
    else if (shortConfidence >= 75 && riskLevel !== 'EXTREME' && rsi > 50) recommendation = 'STRONG_SHORT'; // RSI 50 이상에서만 강한 숏
    else if (longConfidence > shortConfidence + 15) recommendation = 'WEAK_LONG';
    else if (shortConfidence > longConfidence + 15 && rsi > 45) recommendation = 'WEAK_SHORT'; // 과매도 구간에서 숏 자제
    else recommendation = 'NEUTRAL';

    return {
      longConfidence, shortConfidence,
      volatility: parseFloat(volatility.toFixed(1)),
      riskLevel, recommendation,
      rsi: parseFloat(rsi.toFixed(1)),
      volumeRatio: parseFloat(volumeRatio.toFixed(2)),
      confidenceScore: Math.max(longConfidence, shortConfidence)
    };
  };

  // 코인 목록 분류
  const coinLists = {
    all: allCoins,
    major: allCoins.filter(coin =>
      ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "AVAXUSDT", "DOTUSDT", "LTCUSDT", "LINKUSDT", "MATICUSDT"].includes(coin)
    ),
    meme: allCoins.filter(coin =>
      coin.includes("PEPE") || coin.includes("SHIB") || coin.includes("DOGE") || coin.includes("BONK") ||
      coin.includes("MEME") || coin.includes("WIF") || coin.includes("FLOKI") || coin.includes("BOME") || 
      ["FARTCOINUSDT", "TURBOUSDT", "PORKUSDT", "MYROUSDT", "MEWUSDT", "DOGSUSDT"].includes(coin)
    ),
    defi: allCoins.filter(coin =>
      ["UNIUSDT", "AAVEUSDT", "LDOUSDT", "CRVUSDT", "ONDOUSDT", "MKRUSDT", "SNXUSDT", "COMPUSDT", "YFIUSDT", "JUPUSDT", "DYDXUSDT", "SUSHIUSDT"].includes(coin)
    ),
    gaming: allCoins.filter(coin =>
      ["GALAUSDT", "AXSUSDT", "SANDUSDT", "MANAUSDT", "IMXUSDT", "ENJUSDT", "MAGICUSDT", "PIXELUSDT", "ACEUSDT", "PORTALUSDT"].includes(coin)
    )
  };

  // Top 3 Long/Short 신호 계산
  const calculateTopSignals = (signals) => {
    const entries = Object.entries(signals);
    
    // Long top3
    const sortedLong = entries
      .filter(([, signal]) => signal.longConfidence > signal.shortConfidence)
      .sort(([,a], [,b]) => b.longConfidence - a.longConfidence)
      .slice(0, 3);
    
    // Short top3 (shortConfidence 높은 순, 일봉 조건 이미 분석에 포함됨)
    const sortedShort = entries
      .filter(([, signal]) => signal.shortConfidence > signal.longConfidence)
      .sort(([,a], [,b]) => b.shortConfidence - a.shortConfidence)
      .slice(0, 3);
    
    return { top3Long: sortedLong, top3Short: sortedShort };
  };

  // 텔레그램 알림 전송
  const sendTelegramNotification = async (top3LongData, top3ShortData) => {
    try {
      setTelegramStatus('전송 중...');
      
      let message = "🏆 *Project Hades AI - 실시간 분석 결과*\n\n";
      
      message += "📈 *TOP 3 LONG 신호*\n\n";
      top3LongData.forEach(([coin, signal], index) => {
        const emoji = index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉';
        const maxConfidence = signal.longConfidence;
        
        let riskText = signal.riskLevel;
        if (signal.riskLevel === 'EXTREME') riskText = '💀 EXTREME';
        if (signal.riskLevel === 'CHAOS') riskText = '🌪️ CHAOS';
        
        message += `${emoji} *${coin.replace('USDT', '')}*\n`;
        message += `LONG ${maxConfidence}% | 위험도: ${riskText}\n`;
        message += `L: ${signal.longConfidence}% | S: ${signal.shortConfidence}%\n`;
        message += `RSI: ${signal.rsi} | 거래량: ${signal.volumeRatio}x\n\n`;
      });
      
      message += "📉 *TOP 3 SHORT 신호*\n\n";
      top3ShortData.forEach(([coin, signal], index) => {
        const emoji = index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉';
        const maxConfidence = signal.shortConfidence;
        
        let riskText = signal.riskLevel;
        if (signal.riskLevel === 'EXTREME') riskText = '💀 EXTREME';
        if (signal.riskLevel === 'CHAOS') riskText = '🌪️ CHAOS';
        
        message += `${emoji} *${coin.replace('USDT', '')}*\n`;
        message += `SHORT ${maxConfidence}% | 위험도: ${riskText}\n`;
        message += `L: ${signal.longConfidence}% | S: ${signal.shortConfidence}%\n`;
        message += `RSI: ${signal.rsi} | 거래량: ${signal.volumeRatio}x\n\n`;
      });
      
      message += `⏰ ${new Date().toLocaleString('ko-KR')}\n`;
      message += `📊 실제 바이낸스 데이터 기반 분석`;

      const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: message,
          parse_mode: 'Markdown'
        })
      });

      if (response.ok) {
        setTelegramStatus('✅ 전송 완료');
        setTimeout(() => setTelegramStatus(''), 3000);
      } else {
        throw new Error('Telegram API 응답 오류');
      }
    } catch (error) {
      console.error('Telegram 전송 실패:', error);
      setTelegramStatus('❌ 전송 실패');
      setTimeout(() => setTelegramStatus(''), 3000);
    }
  };

  // 실제 신호 분석 수행
  const fetchSignals = async () => {
    setLoading(true);
    setTelegramStatus('');
    setAnalysisProgress(0);

    try {
      // 바이낸스 데이터가 없으면 먼저 가져오기
      let coinsToAnalyze = allCoins;
      if (coinsToAnalyze.length === 0) {
        coinsToAnalyze = await fetchBinanceFuturesSymbols();
      }

      const currentCoins = coinLists[selectedList].length > 0 ? coinLists[selectedList] : coinsToAnalyze.slice(0, 50); // 최대 50개로 제한
      const newSignals = {};
      
      console.log(`분석 시작: ${currentCoins.length}개 종목`);
      
      // 병렬 처리로 성능 향상 (동시에 10개씩 처리)
      const batchSize = 10;
      for (let i = 0; i < currentCoins.length; i += batchSize) {
        const batch = currentCoins.slice(i, i + batchSize);
        
        const batchPromises = batch.map(async (symbol) => {
          try {
            const analysis = await performTechnicalAnalysis(symbol);
            return [symbol, analysis];
          } catch (error) {
            console.error(`Error analyzing ${symbol}:`, error);
            return null;
          }
        });
        
        const batchResults = await Promise.all(batchPromises);
        
        batchResults.forEach(result => {
          if (result) {
            const [symbol, analysis] = result;
            newSignals[symbol] = analysis;
          }
        });
        
        // 진행도 업데이트
        const progress = Math.min(100, ((i + batchSize) / currentCoins.length) * 100);
        setAnalysisProgress(Math.round(progress));
        
        // UI 업데이트를 위한 짧은 대기
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      setSignals(newSignals);
      setLastUpdate(new Date());
      
      // Top signals 계산
      const { top3Long, top3Short } = calculateTopSignals(newSignals);
      setTop3LongSignals(top3Long);
      setTop3ShortSignals(top3Short);
      
      console.log(`분석 완료: ${Object.keys(newSignals).length}개 종목`);
      
      // 텔레그램 알림 전송
      if (Object.keys(newSignals).length > 0) {
        sendTelegramNotification(top3Long, top3Short);
      }

    } catch (error) {
      console.error('분석 중 오류:', error);
      setTelegramStatus('❌ 분석 실패');
    } finally {
      setLoading(false);
      setAnalysisProgress(0);
    }
  };

  // 초기 로딩
  useEffect(() => {
    const initializeApp = async () => {
      await fetchBinanceFuturesSymbols();
    };
    
    initializeApp();
  }, [fetchBinanceFuturesSymbols]);

  // 1시간마다 자동 분석 및 텔레그램 전송 (앱 로드 시 시작)
  useEffect(() => {
    // 초기 분석 실행
    fetchSignals();

    // 1시간(3600000ms)마다 자동 실행
    const intervalId = setInterval(() => {
      fetchSignals();
    }, 3600000);

    // 컴포넌트 언마운트 시 인터벌 정리
    return () => clearInterval(intervalId);
  }, [allCoins, selectedList]); // 의존성 배열에 allCoins와 selectedList 추가하여 변화 시 재설정

  // 선택된 리스트 변경 시 신호 재계산
  useEffect(() => {
    if (allCoins.length > 0 && Object.keys(signals).length > 0) {
      const currentCoins = coinLists[selectedList];
      if (currentCoins.length > 0) {
        // 기존 신호에서 필터링만 수행 (전체 재분석은 수동으로만)
        const filteredSignals = {};
        currentCoins.forEach(coin => {
          if (signals[coin]) {
            filteredSignals[coin] = signals[coin];
          }
        });
        
        const { top3Long, top3Short } = calculateTopSignals(filteredSignals);
        setTop3LongSignals(top3Long);
        setTop3ShortSignals(top3Short);
      }
    }
  }, [selectedList, signals, allCoins]);

  // 신호 정렬 함수
  const getSortedSignals = (signals) => {
    let sorted = Object.entries(signals);
    
    if (sortBy === 'longDesc') {
      sorted = sorted.sort(([,a], [,b]) => b.longConfidence - a.longConfidence);
    } else if (sortBy === 'shortDesc') {
      sorted = sorted.sort(([,a], [,b]) => b.shortConfidence - a.shortConfidence);
    } else if (sortBy === 'maxDesc') {
      sorted = sorted.sort(([,a], [,b]) => b.confidenceScore - a.confidenceScore);
    } else if (sortBy === 'alphabetical') {
      sorted = sorted.sort(([a], [b]) => a.localeCompare(b));
    }
    
    return sorted;
  };

  // 추천 아이콘 가져오기
  const getRecommendationIcon = (rec) => {
    switch (rec) {
      case 'STRONG_LONG': return <TrendingUp className="w-4 h-4 text-green-500" />;
      case 'WEAK_LONG': return <TrendingUp className="w-4 h-4 text-green-300" />;
      case 'STRONG_SHORT': return <TrendingDown className="w-4 h-4 text-red-500" />;
      case 'WEAK_SHORT': return <TrendingDown className="w-4 h-4 text-red-300" />;
      default: return <Activity className="w-4 h-4 text-yellow-500" />;
    }
  };

  // 리스크 색상 가져오기
  const getRiskColor = (risk) => {
    switch (risk) {
      case 'LOW': return 'bg-green-900/50 text-green-400';
      case 'MEDIUM': return 'bg-yellow-900/50 text-yellow-400';
      case 'HIGH': return 'bg-orange-900/50 text-orange-400';
      case 'EXTREME': return 'bg-red-900/50 text-red-400';
      case 'CHAOS': return 'bg-purple-900/50 text-purple-400';
      default: return 'bg-gray-700 text-gray-400';
    }
  };

  // 신호 색상 가져오기
  const getSignalColor = (conf) => {
    if (conf >= 80) return 'bg-green-600/80 text-green-100';
    if (conf >= 60) return 'bg-yellow-600/80 text-yellow-100';
    if (conf >= 40) return 'bg-orange-600/80 text-orange-100';
    return 'bg-red-600/80 text-red-100';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-black text-white p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center space-y-4 md:space-y-0">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 text-transparent bg-clip-text">
                Project Hades AI
              </h1>
              <p className="text-sm text-gray-400 mt-1">실시간 바이낸스 선물 기술적 분석 시스템</p>
            </div>
            
            <div className="flex items-center space-x-4">
              <button
                onClick={fetchSignals}
                disabled={loading}
                className={`px-6 py-2 rounded-lg font-medium transition-all flex items-center space-x-2 ${
                  loading 
                    ? 'bg-gray-700 cursor-not-allowed' 
                    : 'bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500'
                }`}
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                <span>실시간 분석</span>
              </button>
              
              {telegramStatus && (
                <span className={`text-sm ${telegramStatus.includes('✅') ? 'text-green-400' : 'text-red-400'}`}>
                  {telegramStatus}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mt-4">
            <button
              onClick={() => setSortBy('longDesc')}
              className={`px-3 py-1 rounded text-sm transition-colors ${
                sortBy === 'longDesc' ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              📈 Long 높은순
            </button>
            <button
              onClick={() => setSortBy('shortDesc')}
              className={`px-3 py-1 rounded text-sm transition-colors ${
                sortBy === 'shortDesc' ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              📉 Short 높은순
            </button>
            <button
              onClick={() => setSortBy('maxDesc')}
              className={`px-3 py-1 rounded text-sm transition-colors ${
                sortBy === 'maxDesc' ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              ⭐ 최대확신도순
            </button>
            <button
              onClick={() => setSortBy('alphabetical')}
              className={`px-3 py-1 rounded text-sm transition-colors ${
                sortBy === 'alphabetical' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              🔤 이름순
            </button>
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            {Object.keys(coinLists).map(listName =>
              <button
                key={listName}
                onClick={() => setSelectedList(listName)}
                className={`px-4 py-2 rounded-lg transition-colors text-sm font-medium ${
                  selectedList === listName
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {listName === 'all' ? `전체 (${coinLists.all.length}개)` :
                 listName === 'major' ? `주요코인 (${coinLists.major.length}개)` :
                 listName === 'meme' ? `밈코인 (${coinLists.meme.length}개)` :
                 listName === 'defi' ? `디파이 (${coinLists.defi.length}개)` :
                 `게이밍 (${coinLists.gaming.length}개)`}
              </button>
            )}
          </div>

          {/* 실시간 데이터 표시 */}
          <div className="bg-gradient-to-r from-green-900/20 to-blue-900/20 rounded-lg p-3 mb-4">
            <div className="flex items-center space-x-4 text-sm">
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                <span className="text-green-400">실시간 바이낸스 API 연결</span>
              </div>
              <div className="text-gray-400">
                RSI · MACD · 볼린저밴드 · 거래량 분석
              </div>
              <div className="text-blue-400">
                1시간 봉 기준 100개 데이터 분석
              </div>
            </div>
          </div>

          {lastUpdate && (
            <p className="text-sm text-gray-400">
              마지막 업데이트: {lastUpdate.toLocaleString('ko-KR')} 
              <span className="text-green-400 ml-2">✓ 실제 시장 데이터</span>
            </p>
          )}
        </header>

        {/* Top 6 섹션 (Long 3 + Short 3) */}
        {(top3LongSignals.length > 0 || top3ShortSignals.length > 0) && (
          <div className="bg-gradient-to-r from-yellow-900/30 to-orange-900/30 backdrop-blur-sm rounded-xl p-6 mb-6 border border-yellow-700/50">
            <div className="flex items-center space-x-3 mb-4">
              <Crown className="w-6 h-6 text-yellow-400" />
              <h2 className="text-xl font-bold text-yellow-400">🏆 TOP 6 실시간 최고 확신도 신호 (Long 3 + Short 3)</h2>
              <div className="flex items-center space-x-2 ml-auto">
                <Send className="w-4 h-4 text-blue-400" />
                <span className="text-sm text-blue-400">텔레그램 자동 알림</span>
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Top 3 Long */}
              <div>
                <h3 className="text-lg font-semibold text-green-400 mb-4">📈 TOP 3 LONG</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {top3LongSignals.map(([coin, signal], index) => {
                    const maxConfidence = signal.longConfidence;
                    const emoji = index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉';
                    
                    return (
                      <div key={coin} className="bg-gray-800/70 rounded-lg p-4 border border-yellow-600/30">
                        <div className="text-center mb-2">
                          <div className="text-2xl mb-1">{emoji}</div>
                          <div className="font-bold text-white text-lg">{coin.replace('USDT', '')}</div>
                        </div>
                        
                        <div className="space-y-2">
                          <div className="text-center">
                            <div className="text-2xl font-bold text-green-400">
                              {maxConfidence}%
                            </div>
                            <div className="text-sm text-gray-400">
                              LONG
                            </div>
                          </div>
                          
                          <div className="text-xs space-y-1">
                            <div className="flex justify-between">
                              <span className="text-gray-400">L:</span>
                              <span className="text-green-300">{signal.longConfidence}%</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-400">S:</span>
                              <span className="text-red-300">{signal.shortConfidence}%</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-400">RSI:</span>
                              <span className={signal.rsi < 30 ? 'text-green-400' : signal.rsi > 70 ? 'text-red-400' : 'text-gray-300'}>
                                {signal.rsi}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-400">위험도:</span>
                              <span className={getRiskColor(signal.riskLevel).replace(/bg-\w+-\d+\/\d+\s*/, '')}>{signal.riskLevel}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Top 3 Short */}
              <div>
                <h3 className="text-lg font-semibold text-red-400 mb-4">📉 TOP 3 SHORT</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {top3ShortSignals.map(([coin, signal], index) => {
                    const maxConfidence = signal.shortConfidence;
                    const emoji = index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉';
                    
                    return (
                      <div key={coin} className="bg-gray-800/70 rounded-lg p-4 border border-yellow-600/30">
                        <div className="text-center mb-2">
                          <div className="text-2xl mb-1">{emoji}</div>
                          <div className="font-bold text-white text-lg">{coin.replace('USDT', '')}</div>
                        </div>
                        
                        <div className="space-y-2">
                          <div className="text-center">
                            <div className="text-2xl font-bold text-red-400">
                              {maxConfidence}%
                            </div>
                            <div className="text-sm text-gray-400">
                              SHORT
                            </div>
                          </div>
                          
                          <div className="text-xs space-y-1">
                            <div className="flex justify-between">
                              <span className="text-gray-400">L:</span>
                              <span className="text-green-300">{signal.longConfidence}%</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-400">S:</span>
                              <span className="text-red-300">{signal.shortConfidence}%</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-400">RSI:</span>
                              <span className={signal.rsi < 30 ? 'text-green-400' : signal.rsi > 70 ? 'text-red-400' : 'text-gray-300'}>
                                {signal.rsi}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-400">위험도:</span>
                              <span className={getRiskColor(signal.riskLevel).replace(/bg-\w+-\d+\/\d+\s*/, '')}>{signal.riskLevel}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-12 border border-gray-700">
            <div className="flex flex-col items-center space-y-4">
              <Loader className="w-8 h-8 animate-spin text-blue-400" />
              <span className="text-white text-lg">실시간 바이낸스 데이터 분석 중...</span>
              <div className="text-gray-400 text-sm text-center">
                <div>🔍 K라인 데이터 수집</div>
                <div>📊 RSI, MACD, 볼린저밴드 계산</div>
                <div>📈 실시간 기술적 분석 수행</div>
                <div>⚡ 고성능 병렬 처리</div>
              </div>
              {analysisProgress > 0 && (
                <div className="text-blue-400">
                  진행률: {analysisProgress}%
                </div>
              )}
            </div>
          </div>
        ) : (
          <div>
            {Object.keys(signals).length > 0 ? (
              <>
                <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-6 mb-6 border border-gray-700">
                  <h3 className="text-lg font-semibold text-white mb-4">📊 실시간 분석 요약 (바이낸스 API 기반)</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 text-center">
                    <div className="bg-green-900/20 rounded-lg p-3">
                      <div className="text-2xl font-bold text-green-400">
                        {Object.values(signals).filter(s => s.recommendation === 'STRONG_LONG').length}
                      </div>
                      <div className="text-sm text-gray-400">Strong Long</div>
                    </div>
                    <div className="bg-red-900/20 rounded-lg p-3">
                      <div className="text-2xl font-bold text-red-400">
                        {Object.values(signals).filter(s => s.recommendation === 'STRONG_SHORT').length}
                      </div>
                      <div className="text-sm text-gray-400">Strong Short</div>
                    </div>
                    <div className="bg-yellow-900/20 rounded-lg p-3">
                      <div className="text-2xl font-bold text-yellow-400">
                        {Object.values(signals).filter(s => s.riskLevel === 'HIGH').length}
                      </div>
                      <div className="text-sm text-gray-400">고위험</div>
                    </div>
                    <div className="bg-fuchsia-900/30 rounded-lg p-3">
                      <div className="text-2xl font-bold text-fuchsia-500">
                        {Object.values(signals).filter(s => s.riskLevel === 'EXTREME').length}
                      </div>
                      <div className="text-sm text-gray-400">초고위험</div>
                    </div>
                    <div className="bg-gray-700/50 rounded-lg p-3">
                      <div className="text-2xl font-bold text-gray-400">
                        {Object.values(signals).filter(s => s.riskLevel === 'CHAOS').length}
                      </div>
                      <div className="text-sm text-gray-400">혼돈(관망)</div>
                    </div>
                    <div className="bg-blue-900/20 rounded-lg p-3">
                      <div className="text-2xl font-bold text-blue-400">
                        {Object.keys(signals).length}
                      </div>
                      <div className="text-sm text-gray-400">분석 완료</div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                  {getSortedSignals(signals).map(([coin, signal], index) => {
                    const isTopLong = top3LongSignals.some(([topCoin]) => topCoin === coin);
                    const topLongIndex = top3LongSignals.findIndex(([topCoin]) => topCoin === coin);
                    const isTopShort = top3ShortSignals.some(([topCoin]) => topCoin === coin);
                    const topShortIndex = top3ShortSignals.findIndex(([topCoin]) => topCoin === coin);
                    const isTop6 = isTopLong || isTopShort;
                    
                    return (
                      <div
                        key={coin}
                        className={`bg-gray-800/50 backdrop-blur-sm rounded-xl p-4 border transition-colors relative ${
                          isTop6 
                            ? 'border-yellow-600/50 shadow-lg shadow-yellow-900/20' 
                            : 'border-gray-700 hover:border-gray-600'
                        }`}
                      >
                        <div className="absolute top-2 left-2 bg-gray-700 text-gray-300 text-xs px-2 py-1 rounded-full font-bold">
                          #{index + 1}
                        </div>
                        
                        {isTop6 && (
                          <div className="absolute top-2 right-2">
                            <div className="bg-gradient-to-r from-yellow-500 to-orange-500 text-white text-xs px-2 py-1 rounded-full font-bold flex items-center space-x-1">
                              <Crown className="w-3 h-3" />
                              <span>TOP {isTopLong ? topLongIndex + 1 + ' (Long)' : topShortIndex + 1 + ' (Short)'}</span>
                            </div>
                          </div>
                        )}
                        
                        <div className="flex items-center justify-between mb-3 mt-6">
                          <h3 className="text-sm font-semibold text-white truncate">
                            {coin.replace('USDT', '')}
                          </h3>
                          <div className="flex items-center space-x-1">
                            {getRecommendationIcon(signal.recommendation)}
                            <span className={`text-xs px-1.5 py-0.5 rounded ${getRiskColor(signal.riskLevel)}`}>
                              {signal.riskLevel}
                            </span>
                          </div>
                        </div>
                        
                        <div className="space-y-2">
                          <div>
                            <div className="flex justify-between items-center mb-1">
                              <span className="text-xs text-gray-400">Long</span>
                              <span className={`text-xs px-1.5 py-0.5 rounded font-bold ${getSignalColor(signal.longConfidence)}`}>
                                {signal.longConfidence}%
                                {sortBy === 'longDesc' && index < 3 && <span className="ml-1">🔥</span>}
                              </span>
                            </div>
                            <div className="w-full bg-gray-700 rounded-full h-1.5">
                              <div
                                className="bg-gradient-to-r from-green-600 to-green-400 h-1.5 rounded-full transition-all duration-300"
                                style={{ width: `${signal.longConfidence}%` }}
                              />
                            </div>
                          </div>
                          
                          <div>
                            <div className="flex justify-between items-center mb-1">
                              <span className="text-xs text-gray-400">Short</span>
                              <span className={`text-xs px-1.5 py-0.5 rounded font-bold ${getSignalColor(signal.shortConfidence)}`}>
                                {signal.shortConfidence}%
                                {sortBy === 'shortDesc' && index < 3 && <span className="ml-1">📉</span>}
                              </span>
                            </div>
                            <div className="w-full bg-gray-700 rounded-full h-1.5">
                              <div
                                className="bg-gradient-to-r from-red-600 to-red-400 h-1.5 rounded-full transition-all duration-300"
                                style={{ width: `${signal.shortConfidence}%` }}
                              />
                            </div>
                          </div>
                          
                          <div className="text-xs text-gray-500 pt-2 border-t border-gray-700 space-y-1">
                            <div className="flex justify-between">
                              <span>변동성:</span>
                              <span>{signal.volatility}%</span>
                            </div>
                            <div className="flex justify-between">
                              <span>RSI:</span>
                              <span className={signal.rsi < 30 ? 'text-green-400' : signal.rsi > 70 ? 'text-red-400' : 'text-gray-400'}>
                                {signal.rsi}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span>거래량:</span>
                              <span className={signal.volumeRatio > 1.5 ? 'text-blue-400' : 'text-gray-400'}>
                                {signal.volumeRatio}x
                              </span>
                            </div>
                            {sortBy === 'maxDesc' && index < 3 && (
                              <div className="text-center">
                                <span className="text-yellow-400">⭐ 최고확신</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : null}
          </div>
        )}

        <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-6 mt-6 border border-gray-700">
          <h3 className="text-lg font-semibold text-white mb-4">🔬 개선된 분석 시스템 가이드</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 text-sm">
            <div>
              <h4 className="font-semibold text-blue-400 mb-3">🎯 실시간 데이터 소스</h4>
              <ul className="text-gray-400 space-y-1">
                <li>• 바이낸스 선물 API 실시간 연결</li>
                <li>• K라인 데이터 (1시간 봉, 100개)</li>
                <li>• 일봉 데이터 (최근 10일)</li>
                <li>• 실제 가격, 거래량, OHLCV</li>
                <li>• 무기한 계약 USDT 마켓만</li>
                <li>• 고성능 병렬 처리 (10개씩 배치)</li>
              </ul>
            </div>
            
            <div>
              <h4 className="font-semibold text-green-400 mb-3">📈 기술적 분석 지표</h4>
              <ul className="text-gray-400 space-y-1">
                <li>• RSI(14): 과매수/과매도 분석</li>
                <li>• MACD: 모멘텀 분석</li>
                <li>• 볼린저밴드: 변동성 + 위치 분석</li>
                <li>• 거래량 비율: 평균 대비 현재</li>
                <li>• 추세 분석: 1H/3H/5H/10H/20H</li>
              </ul>
            </div>
            
            <div>
              <h4 className="font-semibold text-purple-400 mb-3">⚡ 개선된 로직</h4>
              <ul className="text-gray-400 space-y-1">
                <li>• 과매도 구간 숏 추격 방지</li>
                <li>• 연속 하락 캔들 패턴 인식</li>
                <li>• EMA 이격도 정밀 분석</li>
                <li>• 급락 후 반등 기회 포착</li>
                <li>• 고거래량 + 급락 = 공포매도 감지</li>
                <li>• 숏: 최근 1~5일 음봉 발생 + 고확신도</li>
              </ul>
            </div>
          </div>
          
          <div className="mt-6 p-4 bg-gradient-to-r from-green-900/30 to-blue-900/30 rounded-lg border border-green-700/30">
            <div className="flex items-start space-x-3">
              <div className="w-5 h-5 bg-green-400 rounded-full animate-pulse mt-0.5"></div>
              <div>
                <h4 className="font-semibold text-green-400 mb-2">✅ 숏 신호 정확도 개선</h4>
                <div className="text-gray-300 text-sm space-y-1">
                  <p>• RSI &lt; 35: 숏 신뢰도 -25점 (과매도 구간 추격 방지)</p>
                  <p>• 5봉 중 4봉 하락 + RSI &lt; 40: 숏 -15점</p>
                  <p>• EMA 하방 이격도 -15%: 숏 -30점 (바닥 추격 위험)</p>
                  <p>• 급락(-25% in 3H) + RSI &lt; 30: 숏 -30점, 롱 +25점</p>
                  <p>• 고거래량 + 급락 + RSI &lt; 40: 공포매도로 판단하여 롱 기회 제공</p>
                  <p>• 일봉: 최근 1~5일 음봉 + shortConfidence &gt;70: 숏 +10점</p>
                </div>
              </div>
            </div>
          </div>
          
          <div className="mt-4 p-4 bg-gradient-to-r from-red-900/30 to-orange-900/30 rounded-lg border border-red-700/30">
            <div className="flex items-start space-x-3">
              <AlertTriangle className="w-5 h-5 text-red-400 mt-0.5" />
              <div>
                <h4 className="font-semibold text-red-400 mb-2">⚠️ 리스크 관리</h4>
                <div className="text-gray-300 text-sm space-y-1">
                  <p>• 과매도 구간에서는 숏 추격을 강력히 억제합니다</p>
                  <p>• USELESS 같은 급락 후 상황에서 숏보다 반등 기회를 우선 고려</p>
                  <p>• 모든 투자 결정은 본인 책임하에 진행하세요</p>
                  <p>• 포지션 크기와 손절매를 항상 설정하세요</p>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

export default CryptoSignalChecker;
