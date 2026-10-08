const express = require('express');
const prisma = require('../lib/prisma');
const { ok, fail, asyncHandler } = require('../lib/http');
const { requireAuth } = require('../middleware/auth');
const { todaySummary } = require('../services/pairing');
const { startOfDay } = require('../lib/time');
const { yuanToMills } = require('../lib/units');

const router = express.Router();

/** 今日概览 */
router.get(
  '/today',
  requireAuth,
  asyncHandler(async (req, res) => {
    const dayStart = startOfDay();
    const dayEnd = new Date(dayStart.getTime() + 86400000);

    const summary = await todaySummary(req.userId, dayStart, dayEnd);
    const pendingCount = await prisma.tradeFlow.count({
      where: { userId: req.userId, remainingQty: { gt: 0 } },
    });
    const pendingQty = await prisma.tradeFlow.aggregate({
      where: { userId: req.userId, remainingQty: { gt: 0 } },
      _sum: { remainingQty: true },
    });
    const flowCount = await prisma.tradeFlow.count({
      where: { userId: req.userId, tradedAt: { gte: dayStart, lt: dayEnd } },
    });

    return ok(res, {
      ...summary,
      flowCount,
      pendingCount,
      pendingQty: pendingQty._sum.remainingQty || 0,
    });
  })
);

/**
 * 总览统计
 * 口径：全部按「对冲日」归属，未对冲挂单不参与任何统计
 */
router.get(
  '/overview',
  requireAuth,
  asyncHandler(async (req, res) => {
    const pairs = await prisma.hedgePair.findMany({ where: { userId: req.userId } });

    const netProfitCents = pairs.reduce((s, p) => s + p.netProfitCents, 0);
    const feeCents = pairs.reduce((s, p) => s + p.totalFeeCents, 0);
    const grossCents = pairs.reduce((s, p) => s + p.grossProfitCents, 0);

    const wins = pairs.filter((p) => p.netProfitCents > 0);
    const losses = pairs.filter((p) => p.netProfitCents <= 0);

    const winSum = wins.reduce((s, p) => s + p.netProfitCents, 0);
    const lossSum = Math.abs(losses.reduce((s, p) => s + p.netProfitCents, 0));

    // 最大连亏
    let streak = 0;
    let maxStreak = 0;
    for (const p of pairs.sort((a, b) => a.hedgeDate - b.hedgeDate)) {
      if (p.netProfitCents <= 0) {
        streak += 1;
        maxStreak = Math.max(maxStreak, streak);
      } else {
        streak = 0;
      }
    }

    return ok(res, {
      pairCount: pairs.length,
      netProfitCents,
      grossCents,
      feeCents,
      winRate: pairs.length ? wins.length / pairs.length : 0,
      profitLossRatio: lossSum > 0 ? winSum / lossSum : winSum > 0 ? Infinity : 0,
      avgWinCents: wins.length ? Math.round(winSum / wins.length) : 0,
      avgLossCents: losses.length ? Math.round(lossSum / losses.length) : 0,
      feeToGrossRatio: grossCents > 0 ? feeCents / grossCents : 0,
      maxLossStreak: maxStreak,
    });
  })
);

/** 按标的聚合 */
router.get(
  '/by-code',
  requireAuth,
  asyncHandler(async (req, res) => {
    const pairs = await prisma.hedgePair.findMany({ where: { userId: req.userId } });
    const positions = await prisma.position.findMany({ where: { userId: req.userId } });
    const posMap = Object.fromEntries(positions.map((p) => [p.code, p]));

    const map = new Map();
    for (const p of pairs) {
      if (!map.has(p.code)) {
        map.set(p.code, { code: p.code, name: posMap[p.code]?.name || p.code, type: posMap[p.code]?.type || 'STOCK', pairCount: 0, netProfitCents: 0, feeCents: 0, winCount: 0 });
      }
      const item = map.get(p.code);
      item.pairCount += 1;
      item.netProfitCents += p.netProfitCents;
      item.feeCents += p.totalFeeCents;
      if (p.netProfitCents > 0) item.winCount += 1;
    }

    const list = Array.from(map.values()).map((i) => ({
      ...i,
      winRate: i.pairCount ? i.winCount / i.pairCount : 0,
      realizedProfitCents: posMap[i.code]?.realizedProfitCents || 0,
      costPriceMills: posMap[i.code]?.costPriceMills || 0,
      initialCostMills: posMap[i.code]?.initialCostMills || 0,
    }));

    list.sort((a, b) => b.netProfitCents - a.netProfitCents);
    return ok(res, list);
  })
);

/** 按日聚合（近 N 天） */
router.get(
  '/daily',
  requireAuth,
  asyncHandler(async (req, res) => {
    const days = Number(req.query.days || 30);
    const since = new Date();
    since.setDate(since.getDate() - days);
    since.setHours(0, 0, 0, 0);

    const pairs = await prisma.hedgePair.findMany({
      where: { userId: req.userId, hedgeDate: { gte: since } },
      orderBy: { hedgeDate: 'asc' },
    });

    const map = new Map();
    for (const p of pairs) {
      const key = p.hedgeDate.toISOString().slice(0, 10);
      if (!map.has(key)) map.set(key, { date: key, netProfitCents: 0, feeCents: 0, pairCount: 0 });
      const item = map.get(key);
      item.netProfitCents += p.netProfitCents;
      item.feeCents += p.totalFeeCents;
      item.pairCount += 1;
    }
    return ok(res, Array.from(map.values()));
  })
);

/** 盘前计划 */
router.get(
  '/plans',
  requireAuth,
  asyncHandler(async (req, res) => {
    const plans = await prisma.plan.findMany({
      where: { userId: req.userId },
      orderBy: { date: 'desc' },
      take: 60,
    });
    return ok(res, plans);
  })
);

router.post(
  '/plans',
  requireAuth,
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    if (!b.code) return fail(res, '请填写标的代码');
    const plan = await prisma.plan.create({
      data: {
        userId: req.userId,
        code: String(b.code),
        date: b.date ? new Date(b.date) : startOfDay(),
        direction: String(b.direction || '不做'),
        buyTriggerPriceMills: b.buyTriggerPrice != null ? yuanToMills(b.buyTriggerPrice) : null,
        sellTargetPriceMills: b.sellTargetPrice != null ? yuanToMills(b.sellTargetPrice) : null,
        stopLossPriceMills: b.stopLossPrice != null ? yuanToMills(b.stopLossPrice) : null,
        qty: b.qty != null ? Number(b.qty) : null,
        maxTimes: b.maxTimes != null ? Number(b.maxTimes) : 2,
        reason: b.reason || null,
      },
    });
    return ok(res, plan, '计划已保存');
  })
);

module.exports = router;
