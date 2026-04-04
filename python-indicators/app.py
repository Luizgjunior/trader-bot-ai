from flask import Flask, request, jsonify
import pandas as pd
import ta

app = Flask(__name__)


def candles_to_df(candles: list) -> pd.DataFrame:
    df = pd.DataFrame(candles, columns=["t", "o", "h", "l", "c", "v"])
    df = df.rename(columns={"t": "time", "o": "open", "h": "high", "l": "low", "c": "close", "v": "volume"})
    df[["open", "high", "low", "close", "volume"]] = df[["open", "high", "low", "close", "volume"]].astype(float)
    return df


@app.route("/health")
def health():
    return jsonify({"status": "ok"})


@app.route("/indicators", methods=["POST"])
def indicators():
    body = request.get_json(force=True)
    raw = body.get("candles", [])

    if len(raw) < 50:
        return jsonify({"error": "Need at least 50 candles"}), 400

    df = candles_to_df([[c["t"], c["o"], c["h"], c["l"], c["c"], c["v"]] for c in raw])

    # RSI
    rsi = ta.momentum.RSIIndicator(df["close"], window=14)
    df["rsi"] = rsi.rsi()

    # MACD
    macd = ta.trend.MACD(df["close"])
    df["macd"] = macd.macd()
    df["macd_signal"] = macd.macd_signal()
    df["macd_hist"] = macd.macd_diff()

    # EMA
    df["ema20"] = ta.trend.EMAIndicator(df["close"], window=20).ema_indicator()
    df["ema50"] = ta.trend.EMAIndicator(df["close"], window=50).ema_indicator()
    df["ema200"] = ta.trend.EMAIndicator(df["close"], window=200).ema_indicator()

    # Bollinger Bands
    bb = ta.volatility.BollingerBands(df["close"], window=20, window_dev=2)
    df["bb_upper"] = bb.bollinger_hband()
    df["bb_middle"] = bb.bollinger_mavg()
    df["bb_lower"] = bb.bollinger_lband()

    # ATR
    df["atr"] = ta.volatility.AverageTrueRange(df["high"], df["low"], df["close"], window=14).average_true_range()

    # Volume SMA
    df["volume_sma"] = df["volume"].rolling(window=20).mean()

    # ADX
    df["adx"] = ta.trend.ADXIndicator(df["high"], df["low"], df["close"], window=14).adx()

    last = df.iloc[-1]

    result = {
        "rsi": round(float(last["rsi"]), 2) if pd.notna(last["rsi"]) else None,
        "macd": round(float(last["macd"]), 4) if pd.notna(last["macd"]) else None,
        "macdSignal": round(float(last["macd_signal"]), 4) if pd.notna(last["macd_signal"]) else None,
        "macdHist": round(float(last["macd_hist"]), 4) if pd.notna(last["macd_hist"]) else None,
        "ema20": round(float(last["ema20"]), 2) if pd.notna(last["ema20"]) else None,
        "ema50": round(float(last["ema50"]), 2) if pd.notna(last["ema50"]) else None,
        "ema200": round(float(last["ema200"]), 2) if pd.notna(last["ema200"]) else None,
        "bbUpper": round(float(last["bb_upper"]), 2) if pd.notna(last["bb_upper"]) else None,
        "bbMiddle": round(float(last["bb_middle"]), 2) if pd.notna(last["bb_middle"]) else None,
        "bbLower": round(float(last["bb_lower"]), 2) if pd.notna(last["bb_lower"]) else None,
        "atr": round(float(last["atr"]), 2) if pd.notna(last["atr"]) else None,
        "volumeSma": round(float(last["volume_sma"]), 2) if pd.notna(last["volume_sma"]) else None,
        "adx": round(float(last["adx"]), 2) if pd.notna(last["adx"]) else None,
    }

    return jsonify(result)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=False, threaded=True)
