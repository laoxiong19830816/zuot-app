const express = require('express');
const prisma = require('../lib/prisma');
const { ok, asyncHandler } = require('../lib/http');
const { requireAuth, ensureSettings } = require('../middleware/auth');
const { feeParamsFromSettings, breakEvenSpreadMills } = require('../services/fee');
const { startOfDay } = require('../lib/time');
const { fmtMills, notionalCents } = require('../lib/units');

const router = express.Router();

/**
 * 风险预警检查
 * 规则来自需求文档附录 E；全部基于用户自设规则做确定性提醒，不做任何涨跌预测。
 */
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const settings = await ensureSettings(req.userId);
    const feeParams = feeParamsFromSettings(settings);
    const alerts = [];

    const dayStart = startOfDay();
    const dayEnd = new Date(dayStart.getTime() + 86400000);

    // 1) 当日做T次数超限
    const todayPairs = await prisma.hedgePair.count({
      where: { userId: req.userId, hedgeDate: { gte: dayStart, lt: dayEnd } },
    });
    if (todayPairs > settings.maxTradePerDay) {
      alerts.push({
        level: 'warn',
        rule: 'MAX_TIMES',
        title: '今日做T次数超限',
        message: `今日已完成 ${todayPairs} 次对冲，超过自设上限 ${settings.maxTradePerDay} 次，建议停手。`,
      });
    }

    // 2) 连亏冷静
    const recent = await prisma.hedgePair.findMany({
      where: { userId: req.userId },
      orderBy: { hedgeDate: 'desc' },
      take: 10,
    });
    let streak = 0;
    for (const p of recent) {
      if (p.netProfitCents <= 0) streak += 1;
      else break;
    }
    if (streak >= settings.maxLossStreak) {
      alerts.push({
        level: 'danger',
        rule: 'LOSS_STREAK',
        title: '连续亏损，建议冷静',
        message: `已连续 ${streak} 次对冲亏损（上限 ${settings.maxLossStreak} 次），建议今日停止做T，先复盘。`,
      });
    }

    // 3) 单笔亏损触及止损线
    const todayPairsList = await prisma.hedgePair.findMany({
      where: { userId: req.userId, hedgeDate: { gte: dayStart, lt: dayEnd } },
    });
    for (const p of todayPairsList) {
      if (p.netProfitCents <= settings.singleStopLossCents) {
        alerts.push({
          level: 'danger',
          rule: 'STOP_LOSS',
          title: '单笔亏损触及止损线',
          message: `${p.code} 本次对冲亏损 ${(p.netProfitCents / 100).toFixed(2)} 元，已触及自设止损线 ${(settings.singleStopLossCents / 100).toFixed(2)} 元。`,
        });
      }
    }

    // 4) 挂单滞留
    const pendings = await prisma.tradeFlow.findMany({
      where: { userId: req.userId, remainingQty: { gt: 0 } },
      orderBy: { tradedAt: 'asc' },
    });
    const now = Date.now();
    for (const f of pendings) {
      const days = Math.floor((now - f.tradedAt.getTime()) / 86400000);
      if (days > settings.pendingMaxDays) {
        alerts.push({
          level: 'warn',
          rule: 'PENDING_OVERDUE',
          title: '挂单滞留过久',
          message: `${f.code} 的${f.side === 'BUY' ? '买入' : '卖出'}挂单（${fmtMills(f.priceMills)} 元 × ${f.remainingQty} 股）已滞留 ${days} 天，超过 ${settings.pendingMaxDays} 天，建议处理。`,
        });
      }
    }

    // 5) 费用侵蚀
    const allPairs = await prisma.hedgePair.findMany({ where: { userId: req.userId } });
    const gross = allPairs.reduce((s, p) => s + p.grossProfitCents, 0);
    const fee = allPairs.reduce((s, p) => s + p.totalFeeCents, 0);
    if (gross > 0 && fee / gross > settings.feeErosionAlertPct / 100) {
      alerts.push({
        level: 'warn',
        rule: 'FEE_EROSION',
        title: '手续费侵蚀毛利',
        message: `累计手续费占毛利 ${((fee / gross) * 100).toFixed(1)}%，超过 ${settings.feeErosionAlertPct}%，做T频率可能过高或单次金额过小。`,
      });
    }

    // 6) 仓位集中
    const positions = await prisma.position.findMany({ where: { userId: req.userId } });
    // 市值 = 价格（厘）× 股数 → 分，统一走 notionalCents 换算
    const totalValueCents = positions.reduce(
      (s, p) => s + notionalCents(p.lastPriceMills || p.costPriceMills, p.baseQty),
      0
    );
    for (const p of positions) {
      const value = notionalCents(p.lastPriceMills || p.costPriceMills, p.baseQty);
      if (totalValueCents > 0 && (value / totalValueCents) * 100 > settings.positionLimitPct) {
        alerts.push({
          level: 'warn',
          rule: 'POSITION_CONCENTRATION',
          title: '单票仓位超配',
          message: `${p.name || p.code} 市值占比 ${((value / totalValueCents) * 100).toFixed(1)}%，超过上限 ${settings.positionLimitPct}%。`,
        });
      }
    }

    // 7) 保本价差提示：持仓标的当前成本价下的保本价差
    const breakEvenInfo = positions.map((p) => ({
      code: p.code,
      name: p.name,
      type: p.type,
      breakEvenSpreadMills: Number(
        breakEvenSpreadMills({
          type: p.type,
          priceMills: p.lastPriceMills || p.costPriceMills || 10000,
          qty: 1000,
          params: feeParams,
        }).toFixed(4)
      ),
    }));

    return ok(res, { alerts, breakEvenInfo });
  })
);

module.exports = router;
