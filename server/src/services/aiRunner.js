/**
 * AI 分析统一执行器
 * 负责：额度校验 → 调用豆包 → 落库 → 用量记账 → 回写最新价
 * 定时任务与手动触发都走这里，保证行为一致。
 */

const prisma = require('../lib/prisma');
const config = require('../config');
const doubao = require('./doubao');
const quote = require('./quote');
const { ensureSettings } = require('../middleware/auth');
const { yuanToMills } = require('../lib/units');

/** 检查并扣减额度（不真正扣减，只判断当日/当月用量是否超限） */
async function checkQuota(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('用户不存在');

  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [dayUsed, monthUsed] = await Promise.all([
    prisma.aiUsageLog.count({ where: { userId, createdAt: { gte: dayStart } } }),
    prisma.aiUsageLog.count({ where: { userId, createdAt: { gte: monthStart } } }),
  ]);

  const dailyLimit = user.aiDailyLimit ?? config.aiLimits.daily;
  const monthlyLimit = user.aiMonthlyLimit ?? config.aiLimits.monthly;

  if (dayUsed >= dailyLimit) {
    return { allowed: false, reason: `今日 AI 调用已达上限（${dailyLimit} 次），可联系管理员提高额度` };
  }
  if (monthUsed >= monthlyLimit) {
    return { allowed: false, reason: `本月 AI 调用已达上限（${monthlyLimit} 次）` };
  }
  return { allowed: true, dayUsed, monthUsed, dailyLimit, monthlyLimit };
}

const KIND_TITLE = {
  PREOPEN: '集合竞价分析',
  INTRADAY: '盘中分析',
  CLOSE: '收盘分析',
  REVIEW: '盘后复盘与次日策略',
  STOCK: '个股专项分析',
};

/**
 * 执行一次分析并落库
 * @param {Object} args {userId, kind, codes, extraContext, code, triggeredBy}
 */
async function runAnalysis({ userId, kind, codes = [], extraContext = '', code = null, triggeredBy = 'system' }) {
  const quota = await checkQuota(userId);
  if (!quota.allowed) {
    return { success: false, error: quota.reason, quotaExceeded: true };
  }

  const settings = await ensureSettings(userId);

  // 未指定标的时，取该用户全部持仓标的
  let targetCodes = codes;
  if (code) targetCodes = [code];
  if (!targetCodes || targetCodes.length === 0) {
    const positions = await prisma.position.findMany({ where: { userId }, select: { code: true } });
    targetCodes = positions.map((p) => p.code);
  }

  const res = await doubao.analyze({
    kind,
    userId,
    codes: targetCodes,
    extraContext,
    settings,
  });

  // 用量记账（失败也算一次，便于统计）
  await prisma.aiUsageLog.create({
    data: {
      userId,
      kind: `${kind}:${triggeredBy}`,
      model: res.model || config.ark.model,
      tokensIn: res.tokensIn || 0,
      tokensOut: res.tokensOut || 0,
      success: !!res.success,
    },
  });

  // 回写最新价（供 App 展示与浮盈计算）
  await refreshLastPrices(userId, targetCodes);

  const record = await prisma.aiAnalysis.create({
    data: {
      userId,
      kind,
      code: code || null,
      title: KIND_TITLE[kind] || 'AI 分析',
      summary: res.summary || (res.success ? '（无摘要）' : `分析失败：${res.error}`),
      content: res.content || '',
      model: res.model || config.ark.model,
      dataSnapshot: null,
      tokensIn: res.tokensIn || 0,
      tokensOut: res.tokensOut || 0,
      success: !!res.success,
      errorMsg: res.error || null,
    },
  });

  return { success: !!res.success, analysis: record, error: res.error };
}

/** 回写持仓最新价 */
async function refreshLastPrices(userId, codes) {
  if (!codes || codes.length === 0) return;
  try {
    const rt = await quote.realtime(codes.join(','));
    if (!rt?.ok || !Array.isArray(rt.data)) return;
    for (const q of rt.data) {
      if (q?.code == null || q?.price == null) continue;
      await prisma.position.updateMany({
        where: { userId, code: String(q.code) },
        data: { lastPriceMills: yuanToMills(q.price) },
      });
    }
  } catch (_) {
    // 行情回写失败不影响主流程
  }
}

/**
 * AI 命中率回测：把昨日 INTRADAY 分析的结论与实际涨跌对照
 * 规则：结论中出现「冲高回落/偏空/下跌」等词 → 预期跌；出现「走强/偏多/上涨」→ 预期涨
 * 次日收盘价对比分析时点价格，判定 HIT / MISS / FLAT（涨跌幅绝对值 < 0.3% 记 FLAT）
 */
async function evaluateHitRate(userId, daysBack = 1) {
  const target = new Date();
  target.setDate(target.getDate() - daysBack);
  const dayStart = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const dayEnd = new Date(dayStart.getTime() + 86400000);

  const analyses = await prisma.aiAnalysis.findMany({
    where: { userId, kind: 'INTRADAY', hitEvaluated: false, createdAt: { gte: dayStart, lt: dayEnd } },
  });

  let hit = 0;
  let miss = 0;
  let flat = 0;

  for (const a of analyses) {
    const text = `${a.title} ${a.summary} ${a.content}`;
    const bearish = /回落|偏空|走弱|下跌|调整|承压|减仓|谨慎/.test(text);
    const bullish = /走强|偏多|上涨|拉升|企稳|突破|加仓|积极/.test(text);
    if (!bearish && !bullish) {
      await prisma.aiAnalysis.update({ where: { id: a.id }, data: { hitEvaluated: true, hitResult: 'FLAT', hitNote: '结论无明显方向' } });
      flat += 1;
      continue;
    }
    const expectUp = bullish && !bearish;

    // 用分析标的的实际走势判定（取标的当日收盘相对分析时点的涨跌）
    const pct = await actualMoveSince(a.userId, a.code, a.createdAt);
    if (pct == null) {
      await prisma.aiAnalysis.update({ where: { id: a.id }, data: { hitEvaluated: true, hitResult: 'FLAT', hitNote: '缺少对照数据' } });
      flat += 1;
      continue;
    }
    let verdict = 'FLAT';
    if (Math.abs(pct) < 0.3) verdict = 'FLAT';
    else verdict = (pct > 0) === expectUp ? 'HIT' : 'MISS';

    if (verdict === 'HIT') hit += 1;
    else if (verdict === 'MISS') miss += 1;
    else flat += 1;

    await prisma.aiAnalysis.update({
      where: { id: a.id },
      data: { hitEvaluated: true, hitResult: verdict, hitNote: `预期${expectUp ? '上涨' : '下跌'}，实际${pct.toFixed(2)}%` },
    });
  }

  return { hit, miss, flat, rate: hit + miss > 0 ? hit / (hit + miss) : 0 };
}

/** 取某标的自指定时点以来的涨跌幅（用日K近似） */
async function actualMoveSince(userId, code, since) {
  if (!code) return null;
  try {
    const k = await quote.kline(code, 'daily', 3);
    if (!k?.ok || !Array.isArray(k.data) || k.data.length < 2) return null;
    const rows = k.data;
    const last = Number(rows[rows.length - 1].close);
    const prev = Number(rows[rows.length - 2].close);
    if (!last || !prev) return null;
    return ((last - prev) / prev) * 100;
  } catch (_) {
    return null;
  }
}

module.exports = { runAnalysis, checkQuota, evaluateHitRate, refreshLastPrices };
