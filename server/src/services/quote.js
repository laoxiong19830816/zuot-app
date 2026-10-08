/**
 * 行情服务客户端
 * 真正的取数在 Python 侧（AkShare），本模块负责 HTTP 调用 + 内存缓存 + 失败降级。
 *
 * 重要：豆包大模型本身拿不到行情，必须由这里提供事实数据，
 * 再交给模型推理。任何价格数字都必须经过本模块，不允许模型凭记忆生成。
 */

const config = require('../config');

// 简单内存缓存，避免高频重复拉取（盘中同一个标的 30 秒内复用）
const cache = new Map();
const DEFAULT_TTL = Number(process.env.QUOTE_CACHE_TTL_MS || 30000);

function cacheGet(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() > item.expireAt) {
    cache.delete(key);
    return null;
  }
  return item.value;
}

function cacheSet(key, value, ttl = DEFAULT_TTL) {
  cache.set(key, { value, expireAt: Date.now() + ttl });
  // 简单容量控制
  if (cache.size > 500) {
    for (const k of cache.keys()) {
      cache.delete(k);
      if (cache.size <= 300) break;
    }
  }
}

async function callQuote(path, params = {}, ttl = DEFAULT_TTL) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
  ).toString();
  const url = `${config.quoteServiceUrl}${path}${qs ? `?${qs}` : ''}`;
  const cacheKey = url;

  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(process.env.QUOTE_TIMEOUT_MS || 15000));
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`行情服务返回 ${res.status}`);
    const data = await res.json();
    cacheSet(cacheKey, data, ttl);
    return data;
  } catch (err) {
    // 行情失败必须显式告知上层，绝不返回假数据
    return { ok: false, error: `行情获取失败：${err.message}`, data: null };
  }
}

/** 实时快照：codes 逗号分隔 */
function realtime(codes) {
  return callQuote('/realtime', { codes }, 20000);
}

/** 个股资金流 */
function moneyflow(code) {
  return callQuote('/moneyflow', { code }, 60000);
}

/** 日K / 分钟K */
function kline(code, period = 'daily', limit = 60) {
  return callQuote('/kline', { code, period, limit }, 300000);
}

/** 个股新闻 / 公告标题 */
function news(code, limit = 10) {
  return callQuote('/news', { code, limit }, 300000);
}

/** 大盘概览（上证/深证/创业板） */
function market() {
  return callQuote('/market', {}, 60000);
}

/**
 * 给 AI 用的批量快照：一次性取回某用户所有持仓标的的关键数据
 * 返回结构已裁剪，避免把超大 payload 塞进 prompt
 */
async function snapshotForCodes(codes) {
  const list = Array.isArray(codes) ? codes : String(codes || '').split(',').filter(Boolean);
  if (list.length === 0) return { ok: true, data: [], asOf: new Date().toISOString() };

  const [rt, mk] = await Promise.all([realtime(list.join(',')), market()]);

  const quotes = Array.isArray(rt?.data) ? rt.data : [];
  const klines = {};
  // 逐个取最近 30 根日K（控制开销）
  for (const code of list) {
    const k = await kline(code, 'daily', 30);
    if (k?.ok && Array.isArray(k.data)) {
      klines[code] = k.data.slice(-30).map((row) => ({
        date: row.date,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume,
        amount: row.amount,
        pct: row.pct,
      }));
    }
  }

  return {
    ok: rt?.ok ?? false,
    error: rt?.error,
    asOf: new Date().toISOString(),
    market: mk?.data || null,
    data: quotes.map((q) => ({ ...q, kline: klines[q.code] || [] })),
  };
}

module.exports = {
  realtime,
  moneyflow,
  kline,
  news,
  market,
  snapshotForCodes,
  callQuote,
};
