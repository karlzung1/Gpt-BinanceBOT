import streamlit as st
import pandas as pd
import plotly.graph_objects as go
from datetime import datetime
import ta
from binance.client import Client
from binance.exceptions import BinanceAPIException
import requests
import asyncio

# --- 페이지 설정 ---
st.set_page_config(
    page_title="자동매매 전략 모니터링 대시보드",
    page_icon="🤖",
    layout="wide"
)

# --- [핵심 수정 1] 바이낸스 클라이언트 초기화 (배포 환경용) ---
# Streamlit의 secrets와 asyncio 문제 해결 코드를 통합합니다.
try:
    # 1. Streamlit Cloud의 Secrets에서 API 키를 가져옵니다.
    api_key = st.secrets["BINANCE_API_KEY"]
    secret_key = st.secrets["BINANCE_SECRET_KEY"]

    # 2. Streamlit 환경에서 asyncio 이벤트 루프 충돌을 방지합니다.
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    
    # 3. API 키로 클라이언트를 초기화합니다.
    client = Client(api_key, secret_key, tld='com')

except Exception as e:
    st.error(f"API 키 설정 중 오류 발생: {e}. Streamlit Secrets에 BINANCE_API_KEY와 BINANCE_SECRET_KEY가 올바르게 설정되었는지 확인해주세요.")
    st.stop()


# --- 데이터 로딩 및 분석 함수 ---

@st.cache_data(ttl=60)
def fetch_data(ticker='BTCUSDT', interval='4h', limit=100):
    """바이낸스에서 K-line 데이터를 가져와 기술적 지표를 계산합니다."""
    try:
        klines = client.get_klines(symbol=ticker, interval=interval, limit=limit)
        df = pd.DataFrame(klines, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume', 'close_time',
                                          'quote_asset_volume', 'num_trades', 'taker_buy_base', 'taker_buy_quote', 'ignore'])
        
        cols_to_convert = ['open', 'high', 'low', 'close', 'volume']
        df = df[['timestamp'] + cols_to_convert]
        for col in cols_to_convert:
            df[col] = pd.to_numeric(df[col])
        df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')

        df['rsi_14'] = ta.momentum.RSIIndicator(df['close'], window=14).rsi()
        bb = ta.volatility.BollingerBands(df['close'], window=20, window_dev=2)
        df['bb_upper'] = bb.bollinger_hband()
        df['bb_lower'] = bb.bollinger_lband()
        df['atr'] = ta.volatility.AverageTrueRange(df['high'], df['low'], df['close'], window=14).average_true_range()
        df['sma_20'] = ta.trend.SMAIndicator(df['close'], window=20).sma_indicator()
        df['atr_sma_50'] = ta.trend.SMAIndicator(df['atr'], window=50).sma_indicator()
        df['adx'] = ta.trend.ADXIndicator(df['high'], df['low'], df['close'], window=14).adx()
        
        df.dropna(inplace=True)
        return df
    except Exception as e:
        st.error(f"K-line 데이터 수집 중 오류 발생: {e}")
        return pd.DataFrame()

# --- [기능 추가] 계좌 정보 로딩 함수 ---
@st.cache_data(ttl=30)
def fetch_account_info(ticker='BTCUSDT'):
    """선물 계좌의 잔고, 포지션, 수익률 정보를 가져옵니다."""
    try:
        balance_info = client.futures_account_balance()
        total_balance = 0
        for asset in balance_info:
            if asset['asset'] == 'USDT':
                total_balance = float(asset['balance'])
                break
        
        position_info = client.futures_position_information(symbol=ticker)
        
        if not position_info:
            return {"total_balance": total_balance, "position_amt": 0, "entry_price": 0, "pnl": 0, "pnl_percent": 0}

        position = position_info[0]
        position_amt = float(position['positionAmt'])
        entry_price = float(position['entryPrice'])
        unrealized_pnl = float(position['unRealizedProfit'])
        
        pnl_percent = 0
        if entry_price > 0 and position_amt != 0:
            pnl_percent = (unrealized_pnl / (entry_price * abs(position_amt))) * 100

        return {"total_balance": total_balance, "position_amt": position_amt, "entry_price": entry_price, "pnl": unrealized_pnl, "pnl_percent": pnl_percent}
        
    except BinanceAPIException as e:
        st.error(f"계좌 정보 조회 중 API 오류 발생: {e}")
        return None
    except Exception as e:
        st.error(f"계좌 정보 조회 중 오류 발생: {e}")
        return None

@st.cache_data(ttl=60)
def fetch_fear_greed_index():
    """공포탐욕지수를 가져옵니다."""
    try:
        response = requests.get("https://api.alternative.me/fng/?limit=1", timeout=10)
        response.raise_for_status()
        data = response.json()['data'][0]
        return int(data['value']), data['value_classification']
    except Exception:
        return -1, "Unknown"

def scoring_strategy(prev_row, current_row):
    """BinanceReal.py의 scoring_strategy_60 로직과 동일"""
    base_signal, score, analysis_text = "hold", 0, "진입 신호 대기 중"

    adx_value = current_row['adx']
    if adx_value < 20:
        analysis_text = f"ADX 필터: {adx_value:.2f} < 20, 거래 신호 무시"
        return "hold", 0, analysis_text

    if (prev_row['close'] <= prev_row['bb_lower'] * 1.01 and current_row['close'] > current_row['bb_lower']):
        base_signal, score = "long", 50; analysis_text = "기본 신호: 볼린저 하단 돌파 (롱)"
    elif (prev_row['close'] >= prev_row['bb_upper'] * 0.99 and current_row['close'] < current_row['bb_upper']):
        base_signal, score = "short", 50; analysis_text = "기본 신호: 볼린저 상단 돌파 (숏)"
    else:
        analysis_text = "Bollinger Bands 조건 미충족. 대기."; return "hold", 0, analysis_text

    analysis_text += "\n\n**추가 조건 분석:**"
    if base_signal == "long":
        if current_row['close'] > current_row['sma_20']: score += 20; analysis_text += f"\n- 추세 강화 (SMA 20): `+{20}`"
        if current_row['atr'] > current_row['atr_sma_50'] * 0.4: score += 15; analysis_text += f"\n- 변동성 증가 (ATR): `+{15}`"
        if current_row['rsi_14'] < 30: score += 15; analysis_text += f"\n- 과매도 확인 (RSI): `+{15}`"
    elif base_signal == "short":
        if current_row['close'] < current_row['sma_20']: score += 20; analysis_text += f"\n- 추세 강화 (SMA 20): `+{20}`"
        if current_row['atr'] > current_row['atr_sma_50'] * 0.4: score += 15; analysis_text += f"\n- 변동성 증가 (ATR): `+{15}`"
        if current_row['rsi_14'] > 70: score += 15; analysis_text += f"\n- 과매수 확인 (RSI): `+{15}`"

    return base_signal, score, analysis_text


# --- 메인 대시보드 UI ---
st.title("🤖 자동매매 전략 모니터링 (scoring_strategy_60)")
st.write(f"업데이트 시간: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} KST")

# [수정] 데이터 로드 (계좌 정보 추가)
df = fetch_data()
account_info = fetch_account_info()

if df.empty or account_info is None:
    st.warning("데이터를 불러오지 못했습니다. API 연결 권한(특히 선물)을 확인하거나 잠시 후 다시 시도해주세요.")
    st.stop()

# 최신 데이터
prev_row = df.iloc[-2]
current_row = df.iloc[-1]
current_price = current_row['close']
score_threshold = 60

# 전략 분석
signal, score, analysis = scoring_strategy(prev_row, current_row)

st.divider()

# --- [기능 추가] 계좌 현황 UI ---
st.subheader("💰 계좌 현황 (BTCUSDT 선물)")
col1, col2, col3 = st.columns(3)
with col1:
    st.metric("총 자산 (USDT)", f"${account_info['total_balance']:,.2f}")
with col2:
    if account_info['position_amt'] != 0:
        pnl_delta = f"${account_info['pnl']:,.2f} ({account_info['pnl_percent']:.2f}%)"
        st.metric("미실현 손익 (PNL)", f"${account_info['pnl']:,.2f}", delta=pnl_delta)
    else:
        st.metric("미실현 손익 (PNL)", "N/A", "포지션 없음")
with col3:
    pos_direction = " 없음"
    if account_info['position_amt'] > 0: pos_direction = "🟢 LONG"
    elif account_info['position_amt'] < 0: pos_direction = "🔴 SHORT"
    st.metric(f"현재 포지션 [{pos_direction}]", f"{abs(account_info['position_amt']):.4f} BTC", f"진입가: ${account_info['entry_price']:,.2f}" if account_info['position_amt'] != 0 else "")

st.divider()

# 상단 메트릭스
col1, col2, col3, col4 = st.columns(4)
with col1:
    st.metric("현재 BTC 가격", f"${current_price:,.2f}")
with col2:
    st.metric("RSI (14)", f"{current_row['rsi_14']:.2f}")
with col3:
    st.metric("ADX (14)", f"{current_row['adx']:.2f}")
with col4:
    fng_val, fng_text = fetch_fear_greed_index()
    st.metric(f"공포/탐욕 지수 ({fng_text})", f"{fng_val}" if fng_val != -1 else "N/A")

st.divider()

# 전략 분석 결과
col1, col2 = st.columns([1, 2])
with col1:
    st.subheader("🎯 현재 신호 분석")
    if signal == 'long' and score >= score_threshold: st.success(f"**매수 (LONG) 신호 발생!**")
    elif signal == 'short' and score >= score_threshold: st.error(f"**매도 (SHORT) 신호 발생!**")
    else: st.info(f"**포지션 대기 (HOLD)**")
    st.metric("전략 점수", f"{score} / {score_threshold}")
    st.progress(min(score, 100) / 100)
    with st.expander("세부 분석 내용 보기"): st.markdown(analysis)
with col2:
    st.subheader("📈 BTC 가격 및 볼린저 밴드 (4시간 봉)")
    fig = go.Figure()
    fig.add_trace(go.Scatter(x=df['timestamp'], y=df['close'], mode='lines', name='Price', line=dict(color='skyblue')))
    fig.add_trace(go.Scatter(x=df['timestamp'], y=df['bb_upper'], mode='lines', name='Upper Band', line=dict(width=1, dash='dash', color='gray')))
    fig.add_trace(go.Scatter(x=df['timestamp'], y=df['bb_lower'], mode='lines', name='Lower Band', line=dict(width=1, dash='dash', color='gray'), fill='tonexty', fillcolor='rgba(100, 100, 100, 0.1)'))
    fig.add_trace(go.Scatter(x=df['timestamp'], y=df['sma_20'], mode='lines', name='SMA 20', line=dict(width=1.5, color='orange')))
    fig.update_layout(height=450, xaxis_title=None, yaxis_title="Price (USDT)")
    st.plotly_chart(fig, use_container_width=True)

# 하단 데이터 테이블
st.subheader("📊 기술적 지표 데이터")
st.dataframe(df.tail(10).sort_values('timestamp', ascending=False), use_container_width=True)

# 자동 새로고침
st.sidebar.title("⚙️ 설정")
auto_refresh = st.sidebar.checkbox("자동 새로고침", value=True)
if auto_refresh:
    refresh_interval = st.sidebar.slider("새로고침 간격(초)", min_value=10, max_value=300, value=60)
    from streamlit_js_eval import streamlit_js_eval
    streamlit_js_eval(js_expressions=f"setInterval(function(){{window.parent.location.reload()}}, {refresh_interval * 1000});")
    st.sidebar.caption(f"{refresh_interval}초 마다 페이지가 자동으로 새로고침됩니다.")