const express = require('express');
const prisma = require('../lib/prisma');
const { ok, fail, asyncHandler } = require('../lib/http');
const { requireAuth, requireWritable, ensureSettings } = require('../middleware/auth');
const { feeParamsFromSettings, computeFees, breakEvenSpreadMills, previewHedge } = require('../services/fee');
const { matchFlow, revertPairsForFlow } = require('../services/pairing');
const { yuanToMills, spreadCents } = require('../lib/units');

const router = express.Router();

function guessType(code) {
  return /^(51|58|56|50|15|16|18|159)/.test(String(code)) ? 'ETF' : 'STOCK';
}

/**
 * 实时试算（不落库）：快速记账页输入即变
 * body: { code, side, price, qty }
 * 返回：费用明细、保本价差，以及若与现有挂单配对后的预估净收益
 */
router.post(
  '/preview',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { code, side, price, qty } = req.body || {};
    if (!code || !price || !qty) return fail(res, '请填写代码、价格与数量');

    const settings = await ensureSettings(req.userId);
    const feeParams = feeParamsFromSettings(settings);

    const position = await prisma.position.findUnique({
      where: { userId_code: { userId: req.userId, code: String(code) } },
    });
    const type = position?.type || guessType(code);
    const priceMills = yuanToMills(price);
    const qtyNum = Number(qty);

    const fees = computeFees({ type, side: side === 'SELL' ? 'SELL' : 'BUY', priceMills, qty: qtyNum, params: feeParams });
    const breakEvenMills = breakEvenSpreadMills({ type, priceMills, qty: qtyNum, params: feeParams });

    // 找最优对手挂单（FIFO 第一个反向单）预估配对收益
    const opposite = side === 'SELL' ? 'BUY' : 'SELL';
    const candidate = await prisma.tradeFlow.findFirst({
      where: { userId: req.userId, code: String(code), side: opposite, remainingQty: { gt: 0 } },
      orderBy: [{ tradedAt: 'asc' }],
    });

    let hedgePreview = null;
    if (candidate) {
      const matchQty = Math.min(qtyNum, candidate.remainingQty);
      const buyPriceMills = opposite === 'BUY' ? candidate.priceMills : priceMills;
      const sellPriceMills = opposite === 'BUY' ? priceMills : candidate.priceMills;
      const pre = previewHedge({ type, buyPriceMills, sellPriceMills, qty: matchQty, params: feeParams });
      hedgePreview = {
        ...pre,
        matchQty,
        counterpartPriceMills: candidate.priceMills,
        counterpartSide: opposite,
        counterpartTradedAt: candidate.tradedAt,
      };
    }

    return ok(res, {
      type,
      priceMills,
      amountCents: fees.amountCents,
      commissionCents: fees.commissionCents,
      stampTaxCents: fees.stampTaxCents,
      transferFeeCents: fees.transferFeeCents,
      totalFeeCents: fees.totalFeeCents,
      // 保本价差（厘/股）。示例：0.061 厘 = 0.000061 元 —— 说明「赚多少才不亏」
      breakEvenSpreadMills: Number(breakEvenMills.toFixed(4)),
      // 实时校验：这次卖出有没有超过可用股数
      availableQty: position?.availableQty ?? null,
      oversell: side === 'SELL' && position ? qtyNum > position.availableQty : false,
      hedgePreview,
    });
  })
);

/**
 * 记一笔（核心）
 * body: { code, side, price, qty, tradedAt?, note? }
 * 事务：算费 → 落流水 → FIFO 配对 → 冲减成本
 */
router.post(
  '/',
  requireAuth,
  requireWritable,
  asyncHandler(async (req, res) => {
    const { code, side, price, qty, tradedAt, note } = req.body || {};
    if (!code || !price || !qty) return fail(res, '请填写代码、价格与数量');
    if (!['BUY', 'SELL'].includes(side)) return fail(res, '方向必须是 BUY 或 SELL');

    const codeStr = String(code).trim();
    const qtyNum = Number(qty);
    if (qtyNum <= 0) return fail(res, '数量必须大于 0');
    const priceMills = yuanToMills(price);
    if (priceMills <= 0) return fail(res, '价格必须大于 0');

    const settings = await ensureSettings(req.userId);
    const feeParams = feeParamsFromSettings(settings);

    let position = await prisma.position.findUnique({
      where: { userId_code: { userId: req.userId, code: codeStr } },
    });
    // 标的未登记时自动建仓（底仓 0，用户后续可在持仓页补股数）
    if (!position) {
      position = await prisma.position.create({
        data: {
          userId: req.userId,
          code: codeStr,
          name: codeStr,
          type: guessType(codeStr),
          baseQty: 0,
          availableQty: 0,
          costPriceMills: 0,
          initialCostMills: 0,
        },
      });
    }

    const type = position.type;

    // 【风控·必须】卖出前校验可用股数，防止超卖导致持仓数据失真
    // A股股票 T+1：当日买入的股票次日才可用；ETF/LOF 是 T+0，当日买当日可卖
    if (side === 'SELL' && qtyNum > position.availableQty) {
      return fail(
        res,
        `可用股数不足：本次要卖 ${qtyNum} 股，当前可用只有 ${position.availableQty} 股。` +
          `（A股股票当日买入次日才可卖；若确已持有，请到「我的 → 底仓管理」修正可用股数）`
      );
    }

    const fees = computeFees({ type, side, priceMills, qty: qtyNum, params: feeParams });
    const flowTime = tradedAt ? new Date(tradedAt) : new Date();

    const result = await prisma.$transaction(async (tx) => {
      const flow = await tx.tradeFlow.create({
        data: {
          userId: req.userId,
          positionId: position.id,
          code: codeStr,
          side,
          priceMills,
          qty: qtyNum,
          remainingQty: qtyNum,
          amountCents: fees.amountCents,
          commissionCents: fees.commissionCents,
          stampTaxCents: fees.stampTaxCents,
          transferFeeCents: fees.transferFeeCents,
          totalFeeCents: fees.totalFeeCents,
          tradedAt: flowTime,
          note: note || null,
          status: 'PENDING',
        },
      });

      const pairs = await matchFlow(tx, flow, feeParams);

      // 可用股数维护（贴近券商真实规则）：
      //   ETF / LOF → T+0，当日买入当日即可卖，故买入增加可用
      //   股票      → T+1，当日买入不增加可用（次日结算后才释放）
      //   卖出      → 一律扣减
      if (side === 'BUY') {
        if (type === 'ETF') {
          await tx.position.update({
            where: { id: position.id },
            data: { availableQty: { increment: qtyNum } },
          });
        }
      } else {
        const next = Math.max(0, position.availableQty - qtyNum);
        await tx.position.update({ where: { id: position.id }, data: { availableQty: next } });
      }

      return { flow, pairs };
    });

    const remainingPending = await prisma.tradeFlow.count({
      where: { userId: req.userId, remainingQty: { gt: 0 } },
    });

    return ok(res, {
      flow: result.flow,
      pairs: result.pairs,
      pairCount: result.pairs.length,
      netProfitCents: result.pairs.reduce((s, p) => s + p.netProfitCents, 0),
      remainingPendingCount: remainingPending,
      message: result.pairs.length
        ? `已记录，本次对冲 ${result.pairs.length} 组`
        : `已记录，未形成对冲，进入挂单池（当前共 ${remainingPending} 笔挂单未对冲）`,
    });
  })
);

/**
 * 流水列表
 * query: code, status(pending|matched|all), date(YYYY-MM-DD)
 */
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { code, status, date } = req.query;
    const where = { userId: req.userId };
    if (code) where.code = String(code);
    if (status === 'pending') where.remainingQty = { gt: 0 };
    if (status === 'matched') where.status = 'MATCHED';
    if (date) {
      const d = new Date(String(date));
      const next = new Date(d.getTime() + 86400000);
      where.tradedAt = { gte: d, lt: next };
    }

    const flows = await prisma.tradeFlow.findMany({
      where,
      orderBy: [{ tradedAt: 'desc' }],
      take: 500,
    });
    return ok(res, flows);
  })
);

/** 未对冲挂单池（核心） */
router.get(
  '/pending',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { code } = req.query;
    const settings = await ensureSettings(req.userId);
    const where = { userId: req.userId, remainingQty: { gt: 0 } };
    if (code) where.code = String(code);

    const flows = await prisma.tradeFlow.findMany({ where, orderBy: [{ tradedAt: 'asc' }] });
    const positions = await prisma.position.findMany({ where: { userId: req.userId } });
    const posMap = Object.fromEntries(positions.map((p) => [p.code, p]));

    const now = Date.now();
    const list = flows.map((f) => {
      const pos = posMap[f.code];
      const waitingDays = Math.floor((now - f.tradedAt.getTime()) / 86400000);
      // 未实现浮盈亏：按最新价估算，仅展示，不计入任何统计
      let unrealizedCents = null;
      let priceGapMills = null;
      if (pos?.lastPriceMills != null) {
        // 挂单买入 → 现价高于挂单价为浮盈；挂单卖出 → 现价低于挂单价为浮盈
        priceGapMills =
          f.side === 'BUY' ? pos.lastPriceMills - f.priceMills : f.priceMills - pos.lastPriceMills;
        unrealizedCents = spreadCents(priceGapMills, f.remainingQty);
      }
      return {
        ...f,
        name: pos?.name || f.code,
        type: pos?.type || 'STOCK',
        waitingDays,
        overdue: waitingDays > (settings.pendingMaxDays || 5),
        unrealizedCents,
        priceGapMills,
      };
    });

    return ok(res, list);
  })
);

/** 配对结算列表（按对冲日） */
router.get(
  '/pairs',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { code, from, to } = req.query;
    const where = { userId: req.userId };
    if (code) where.code = String(code);
    if (from || to) {
      where.hedgeDate = {};
      if (from) where.hedgeDate.gte = new Date(String(from));
      if (to) where.hedgeDate.lte = new Date(`${String(to)}T23:59:59`);
    }
    const pairs = await prisma.hedgePair.findMany({
      where,
      orderBy: [{ hedgeDate: 'desc' }],
      take: 500,
    });
    return ok(res, pairs);
  })
);

/** 删除流水（自动回滚配对与成本冲减） */
router.delete(
  '/:id',
  requireAuth,
  requireWritable,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const flow = await prisma.tradeFlow.findUnique({ where: { id } });
    if (!flow || flow.userId !== req.userId) return fail(res, '记录不存在', 404, 404);

    await prisma.$transaction(async (tx) => {
      await revertPairsForFlow(tx, id);
      // 回滚可用股数
      const position = await tx.position.findUnique({
        where: { userId_code: { userId: req.userId, code: flow.code } },
      });
      if (position) {
        const delta = flow.side === 'BUY' ? -flow.qty : flow.qty;
        const next = Math.max(0, position.availableQty + delta);
        await tx.position.update({ where: { id: position.id }, data: { availableQty: next } });
      }
      await tx.tradeFlow.delete({ where: { id } });
    });

    return ok(res, null, '已删除，相关配对已回滚');
  })
);

module.exports = router;
