/**
 * 对冲配对与结算
 *
 * 核心口径（务必与需求文档附录 C 一致）：
 * 1. 只有一买一卖配对成功，才产生净收益；未配对的流水进「未对冲挂单池」，不计入任何统计。
 * 2. 收益归属日 = 对冲日（后一笔成交的时间），不是开仓日。今日买、明日卖 → 收益算明天的。
 * 3. 持仓成本按对冲日冲减：新成本价 = (旧成本价×股数 − 净收益) ÷ 股数
 * 4. 配对采用先进先出（FIFO），支持部分配对（买入1000股、卖出600股 → 只对冲600股）。
 */

const prisma = require('../lib/prisma');
const { spreadCents, notionalCents, reduceCostMills } = require('../lib/units');

function statusOf(remainingQty, qty) {
  if (remainingQty <= 0) return 'MATCHED';
  if (remainingQty < qty) return 'PARTIAL';
  return 'PENDING';
}

/**
 * 尝试为新流水做对冲配对（必须在事务内调用，传入 tx）
 * @param {Object} tx Prisma 事务客户端
 * @param {Object} flow 新流水（已落库）
 * @param {Object} feeParams feeParamsFromSettings 结果
 * @returns {Array} 本次生成的配对记录
 */
async function matchFlow(tx, flow, feeParams) {
  const pairs = [];
  let remaining = flow.remainingQty;
  if (remaining <= 0) return pairs;

  // 对手方向：新流水是买 → 找未对冲的卖单；反之亦然
  const oppositeSide = flow.side === 'BUY' ? 'SELL' : 'BUY';

  // FIFO：按成交时间升序取还有余额的反向单
  const candidates = await tx.tradeFlow.findMany({
    where: {
      userId: flow.userId,
      code: flow.code,
      side: oppositeSide,
      remainingQty: { gt: 0 },
      id: { not: flow.id },
    },
    orderBy: [{ tradedAt: 'asc' }, { createdAt: 'asc' }],
  });

  for (const cand of candidates) {
    if (remaining <= 0) break;

    const qty = Math.min(remaining, cand.remainingQty);

    // 判定买卖两边（不论谁先谁后）
    const isNewSell = flow.side === 'SELL';
    const buyFlow = isNewSell ? cand : flow;
    const sellFlow = isNewSell ? flow : cand;

    // 费用按配对股数比例分摊（一笔流水可能被拆成多次配对）
    const buyFee = Math.round((buyFlow.totalFeeCents * qty) / buyFlow.qty);
    const sellFee = Math.round((sellFlow.totalFeeCents * qty) / sellFlow.qty);
    const totalFee = buyFee + sellFee;

    // 价差（厘）× 股数 → 毛利（分）。ETF 价差常为 0.001~0.003 元，用厘才不会归零
    const grossProfitCents = spreadCents(sellFlow.priceMills - buyFlow.priceMills, qty);
    const netProfitCents = grossProfitCents - totalFee;

    // 收益归属对冲日 = 两笔成交中较晚的那一天
    const hedgeDate = buyFlow.tradedAt > sellFlow.tradedAt ? buyFlow.tradedAt : sellFlow.tradedAt;
    const openDate = buyFlow.tradedAt < sellFlow.tradedAt ? buyFlow.tradedAt : sellFlow.tradedAt;

    const buyAmount = notionalCents(buyFlow.priceMills, qty);
    const returnRate = buyAmount > 0 ? netProfitCents / buyAmount : 0;

    const pair = await tx.hedgePair.create({
      data: {
        userId: flow.userId,
        code: flow.code,
        buyFlowId: buyFlow.id,
        sellFlowId: sellFlow.id,
        qty,
        buyPriceMills: buyFlow.priceMills,
        sellPriceMills: sellFlow.priceMills,
        grossProfitCents,
        totalFeeCents: totalFee,
        netProfitCents,
        returnRate,
        openDate,
        hedgeDate,
      },
    });
    pairs.push(pair);

    // 扣减余额
    remaining -= qty;
    const candRemaining = cand.remainingQty - qty;

    await tx.tradeFlow.update({
      where: { id: flow.id },
      data: { remainingQty: remaining, status: statusOf(remaining, flow.qty) },
    });
    await tx.tradeFlow.update({
      where: { id: cand.id },
      data: { remainingQty: candRemaining, status: statusOf(candRemaining, cand.qty) },
    });
  }

  if (pairs.length > 0) {
    await applyPositionCostReduction(tx, flow, pairs);
  }

  return pairs;
}

/**
 * 持仓成本冲减
 * 新成本价 = (旧成本价 × 底仓股数 − 本次累计净收益) ÷ 底仓股数
 * 注意：做T是等量买卖，底仓股数不变；这里只冲减成本，避免做T收益与底仓浮盈重复计算。
 * 单位：成本价用「厘」，净收益用「分」，换算由 units.reduceCostMills 统一处理
 */
async function applyPositionCostReduction(tx, flow, pairs) {
  const totalNet = pairs.reduce((sum, p) => sum + p.netProfitCents, 0);
  const position = await tx.position.findUnique({
    where: { userId_code: { userId: flow.userId, code: flow.code } },
  });
  if (!position) return;

  const baseQty = position.baseQty;
  const realized = position.realizedProfitCents + totalNet;

  let newCost = position.costPriceMills;
  if (baseQty > 0) {
    newCost = reduceCostMills(position.costPriceMills, baseQty, totalNet);
    if (newCost < 0) newCost = 0; // 成本被T到负数，说明底仓已完全收回，成本记 0
  }

  await tx.position.update({
    where: { id: position.id },
    data: { costPriceMills: newCost, realizedProfitCents: realized },
  });
}

/**
 * 回滚某条流水相关的全部配对（删除/编辑流水时使用）
 * 会恢复对手方余额、冲回持仓已实现收益与成本价
 */
async function revertPairsForFlow(tx, flowId) {
  const pairs = await tx.hedgePair.findMany({
    where: { OR: [{ buyFlowId: flowId }, { sellFlowId: flowId }] },
  });

  for (const p of pairs) {
    // 1) 恢复两条流水的余额与状态
    for (const fid of [p.buyFlowId, p.sellFlowId]) {
      const f = await tx.tradeFlow.findUnique({ where: { id: fid } });
      if (!f) continue;
      const restored = f.remainingQty + p.qty;
      await tx.tradeFlow.update({
        where: { id: fid },
        data: { remainingQty: restored, status: statusOf(restored, f.qty) },
      });
    }

    // 2) 冲回持仓成本与已实现收益
    const position = await tx.position.findUnique({
      where: { userId_code: { userId: p.userId, code: p.code } },
    });
    if (position) {
      const realized = position.realizedProfitCents - p.netProfitCents;
      let cost = position.costPriceMills;
      if (position.baseQty > 0) {
        // 回滚 = 反向冲减（传入负的净收益）
        cost = reduceCostMills(position.costPriceMills, position.baseQty, -p.netProfitCents);
      }
      await tx.position.update({
        where: { id: position.id },
        data: { costPriceMills: cost, realizedProfitCents: realized },
      });
    }

    await tx.hedgePair.delete({ where: { id: p.id } });
  }
  return pairs.length;
}

/**
 * 取某用户今日（对冲日）的配对汇总
 */
async function todaySummary(userId, dayStart, dayEnd) {
  const pairs = await prisma.hedgePair.findMany({
    where: { userId, hedgeDate: { gte: dayStart, lt: dayEnd } },
  });
  const netProfitCents = pairs.reduce((s, p) => s + p.netProfitCents, 0);
  const feeCents = pairs.reduce((s, p) => s + p.totalFeeCents, 0);
  const grossCents = pairs.reduce((s, p) => s + p.grossProfitCents, 0);
  const winCount = pairs.filter((p) => p.netProfitCents > 0).length;
  return {
    pairCount: pairs.length,
    netProfitCents,
    feeCents,
    grossCents,
    winCount,
    lossCount: pairs.length - winCount,
    winRate: pairs.length ? winCount / pairs.length : 0,
  };
}

/** 未对冲挂单池 */
async function pendingOrders(userId, code) {
  return prisma.tradeFlow.findMany({
    where: {
      userId,
      remainingQty: { gt: 0 },
      ...(code ? { code } : {}),
    },
    orderBy: [{ tradedAt: 'asc' }],
  });
}

module.exports = {
  matchFlow,
  applyPositionCostReduction,
  revertPairsForFlow,
  todaySummary,
  pendingOrders,
  statusOf,
};
