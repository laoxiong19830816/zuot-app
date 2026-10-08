#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
自建行情服务（Python + AkShare）

作用：给豆包大模型提供真实行情事实数据。
豆包本身拿不到股价，必须由本服务通过 Tool Call 提供数字，模型只负责推理。

启动：
    pip install -r requirements.txt
    python akshare_service.py            # 默认监听 8620
    python akshare_service.py --port 9000

接口：
    GET /health
    GET /realtime?codes=600519,510300
    GET /moneyflow?code=600519
    GET /kline?code=600519&period=daily&limit=60
    GET /news?code=600519&limit=10
    GET /market

统一返回：{"ok": true|false, "asOf": "...", "data": ..., "error": "..."}
"""

import argparse
import json
import re
import datetime as dt
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

try:
    import akshare as ak
except Exception as e:  # pragma: no cover
    ak = None
    _IMPORT_ERROR = str(e)
else:
    _IMPORT_ERROR = None

try:
    import pandas as pd
except Exception:
    pd = None


# ---------------- 工具函数 ----------------

def is_etf(code: str) -> bool:
    """ETF 代码规则：沪市 51/58/56/50 开头，深市 15/16/18 开头"""
    c = str(code).strip()
    return bool(re.match(r'^(51|58|56|50|15|16|18|159)', c))


def market_of(code: str) -> str:
    c = str(code).strip()
    return 'sh' if c.startswith(('6', '5', '11', '9')) else 'sz'


def to_float(v, default=0.0):
    try:
        if v is None:
            return default
        if isinstance(v, str):
            v = v.replace('%', '').replace(',', '').strip()
            if v in ('', '-', '--'):
                return default
        return float(v)
    except Exception:
        return default


def df_to_records(df, limit=None):
    if df is None:
        return []
    if limit:
        df = df.tail(limit)
    recs = df.to_dict(orient='records')
    out = []
    for r in recs:
        item = {}
        for k, v in r.items():
            if hasattr(v, 'item'):
                try:
                    v = v.item()
                except Exception:
                    pass
            if isinstance(v, (dt.datetime, dt.date)):
                v = str(v)
            elif not isinstance(v, (str, int, float, bool, type(None))):
                v = str(v)
            item[str(k)] = v
        out.append(item)
    return out


def result(ok, data=None, error=None, source=None):
    return {
        'ok': ok,
        'asOf': dt.datetime.now().isoformat(),
        'data': data,
        'error': error,
        'source': source or 'akshare',
    }


# ---------------- 各数据接口 ----------------

def get_realtime(codes):
    """实时快照：优先逐只取盘口（快），失败回退到全市场快照"""
    import concurrent.futures as cf

    def one(code):
        code = code.strip()
        try:
            if is_etf(code):
                df = ak.fund_etf_bid_ask_em(symbol=code)
            else:
                df = ak.stock_bid_ask_em(symbol=code)
            if df is None or df.empty:
                return None
            m = {str(r['item']): r['value'] for _, r in df.iterrows()}

            def pick(*names):
                for n in names:
                    if n in m:
                        return to_float(m[n], None)
                return None

            price = pick('最新', '最新价')
            pct = pick('涨幅', '涨跌幅')
            pre_close = pick('昨收', '昨收价')
            vol = pick('成交量', '总手')
            amount = pick('成交额', '金额')
            turnover = pick('换手率', '换手')
            return {
                'code': code,
                'price': price,
                'pct': pct,
                'preClose': pre_close,
                'volume': vol,
                'amount': amount,
                'turnoverRate': turnover,
                'high': pick('最高', '最高价'),
                'low': pick('最低', '最低价'),
                'open': pick('今开', '开盘'),
            }
        except Exception:
            return None

    with cf.ThreadPoolExecutor(max_workers=8) as ex:
        rows = [r for r in ex.map(one, codes) if r]

    if rows:
        return result(True, rows, source='akshare/bid_ask')

    # 回退：全市场快照（较慢，仅在前述方式全部失败时使用）
    try:
        df = ak.stock_zh_a_spot_em()
        df = df[df['代码'].isin(codes)]
        cols = ['代码', '名称', '最新价', '涨跌幅', '成交量', '成交额', '换手率', '最高', '最低', '今开', '昨收']
        cols = [c for c in cols if c in df.columns]
        rows = []
        for _, r in df[cols].iterrows():
            rows.append({
                'code': str(r.get('代码')),
                'name': r.get('名称'),
                'price': to_float(r.get('最新价'), None),
                'pct': to_float(r.get('涨跌幅'), None),
                'volume': to_float(r.get('成交量'), None),
                'amount': to_float(r.get('成交额'), None),
                'turnoverRate': to_float(r.get('换手率'), None),
                'high': to_float(r.get('最高'), None),
                'low': to_float(r.get('最低'), None),
                'open': to_float(r.get('今开'), None),
                'preClose': to_float(r.get('昨收'), None),
            })
        return result(True, rows, source='akshare/spot_em')
    except Exception as e:
        return result(False, [], error=f'实时行情获取失败: {e}')


def get_moneyflow(code):
    """资金流：股票取个股资金流历史（取最近5日）；ETF 无此数据"""
    code = code.strip()
    if is_etf(code):
        return result(True, [], error='ETF 无个股资金流数据（合规口径下不提供）')
    try:
        df = ak.stock_individual_fund_flow(stock=code, market=market_of(code))
        if df is None or df.empty:
            return result(False, [], error='资金流数据为空')
        df = df.tail(5)
        recs = df_to_records(df)
        # 统一字段名（不同 akshare 版本列名略有差异）
        return result(True, recs, source='akshare/stock_individual_fund_flow')
    except Exception as e:
        return result(False, [], error=f'资金流获取失败: {e}')


def get_kline(code, period='daily', limit=60):
    code = code.strip()
    end = dt.date.today()
    start = end - dt.timedelta(days=400 if period in ('daily', 'weekly') else 30)
    try:
        if is_etf(code):
            df = ak.fund_etf_hist_em(symbol=code, period=period if period in ('daily', 'weekly', 'monthly') else 'daily',
                                     start_date=start.strftime('%Y%m%d'), end_date=end.strftime('%Y%m%d'),
                                     adjust='qfq')
        else:
            df = ak.stock_zh_a_hist(symbol=code, period=period if period in ('daily', 'weekly', 'monthly') else 'daily',
                                    start_date=start.strftime('%Y%m%d'), end_date=end.strftime('%Y%m%d'),
                                    adjust='qfq')
        if df is None or df.empty:
            return result(False, [], error='K线数据为空')

        # 统一列名 → 英文
        rename = {
            '日期': 'date', '开盘': 'open', '收盘': 'close', '最高': 'high', '最低': 'low',
            '成交量': 'volume', '成交额': 'amount', '涨跌幅': 'pct', '涨跌额': 'change', '换手率': 'turnover',
        }
        df = df.rename(columns={k: v for k, v in rename.items() if k in df.columns})
        keep = [c for c in ['date', 'open', 'close', 'high', 'low', 'volume', 'amount', 'pct'] if c in df.columns]
        recs = df_to_records(df[keep], limit=limit)
        return result(True, recs, source='akshare/hist')
    except Exception as e:
        return result(False, [], error=f'K线获取失败: {e}')


def get_news(code, limit=10):
    code = code.strip()
    if is_etf(code):
        return result(True, [], error='ETF 暂无个股新闻数据')
    try:
        df = ak.stock_news_em(symbol=code)
        if df is None or df.empty:
            return result(True, [], error='暂无新闻')
        df = df.head(limit)
        recs = []
        for _, r in df.iterrows():
            recs.append({
                'title': str(r.get('新闻标题', '')),
                'time': str(r.get('发布时间', '')),
                'source': str(r.get('文章来源', '')),
                'url': str(r.get('新闻链接', '')),
            })
        return result(True, recs, source='akshare/stock_news_em')
    except Exception as e:
        return result(False, [], error=f'新闻获取失败: {e}')


def get_market():
    try:
        df = ak.stock_zh_index_spot_em(symbol='沪深重要指数')
        targets = {'000001': '上证指数', '399001': '深证成指', '399006': '创业板指', '000688': '科创50'}
        rows = []
        for _, r in df.iterrows():
            code = str(r.get('代码'))
            if code in targets:
                rows.append({
                    'code': code,
                    'name': targets[code],
                    'price': to_float(r.get('最新价'), None),
                    'pct': to_float(r.get('涨跌幅'), None),
                    'amount': to_float(r.get('成交额'), None),
                })
        if not rows:
            return result(False, [], error='指数数据为空')
        return result(True, rows, source='akshare/index_spot_em')
    except Exception as e:
        return result(False, [], error=f'大盘数据获取失败: {e}')


# ---------------- HTTP 服务 ----------------

class Handler(BaseHTTPRequestHandler):
    def _send(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip('/')
        q = {k: v[0] for k, v in parse_qs(parsed.query).items()}

        try:
            if path in ('', '/health'):
                return self._send(result(True, {
                    'service': 'zuot-quote',
                    'akshareReady': ak is not None,
                    'importError': _IMPORT_ERROR,
                    'time': dt.datetime.now().isoformat(),
                }))

            if ak is None:
                return self._send(result(False, None, error=f'akshare 未安装: {_IMPORT_ERROR}'), 503)

            if path == '/realtime':
                codes = [c for c in q.get('codes', '').split(',') if c.strip()]
                if not codes:
                    return self._send(result(False, [], error='缺少 codes 参数'), 400)
                return self._send(get_realtime(codes))

            if path == '/moneyflow':
                if not q.get('code'):
                    return self._send(result(False, [], error='缺少 code 参数'), 400)
                return self._send(get_moneyflow(q['code']))

            if path == '/kline':
                if not q.get('code'):
                    return self._send(result(False, [], error='缺少 code 参数'), 400)
                return self._send(get_kline(q['code'], q.get('period', 'daily'), int(q.get('limit', 60))))

            if path == '/news':
                if not q.get('code'):
                    return self._send(result(False, [], error='缺少 code 参数'), 400)
                return self._send(get_news(q['code'], int(q.get('limit', 10))))

            if path == '/market':
                return self._send(get_market())

            return self._send(result(False, None, error=f'未知接口 {path}'), 404)
        except Exception as e:
            return self._send(result(False, None, error=f'服务异常: {e}'), 500)

    def log_message(self, fmt, *args):
        # 静默默认日志，减少噪音；需要时改为 super().log_message
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8620)
    ap.add_argument('--host', default='0.0.0.0')
    args = ap.parse_args()

    if ak is None:
        print(f'[WARN] akshare 未安装，服务只能返回 /health。请先执行 pip install -r requirements.txt')
        print(f'[WARN] 导入错误: {_IMPORT_ERROR}')

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f'[INFO] 行情服务已启动: http://{args.host}:{args.port}')
    server.serve_forever()


if __name__ == '__main__':
    main()
