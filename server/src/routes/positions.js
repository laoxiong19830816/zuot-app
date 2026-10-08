const express = require('express');
const prisma = require('../lib/prisma');
const { ok, fail, asyncHandler } = require('../lib/http');
const { requireAuth, requireWritable } = require('../middleware/auth');
const { feeParamsFromSettings, breakEvenSpreadMills } = require('../services/fee');
const { ensureSettings } = require('../middleware/auth');
const { yuanToMills, spreadCents } = require('../lib/units');

const router = express.Router();

/** 判断标的类型：ETF 代码规则 vs 股票 */
function guessType(code) {
  return /^(51|58|56|50|15|16|18|159)/.test(String(code)) ? 'ETF' : 'STOCK';
}

/**
 * 持仓列表
 * 返回：底仓、可用、成本价、累计做T收益、浮盈、保本价差（按单次计划股数）
 */
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const settings = await ensureSettings(req.userId);
    const feeParams = feeParamsFromSettings(settings);

    const positions = await prisma.position.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'desc' },
    });

    // 未对冲挂单数
    const pendings = await prisma.tradeFlow.groupBy({
      by: ['code'],
      where: { userId: req.userId, remainingQty: { gt: 0 } },
      _count: { _all: true },
    });
    const pendingMap = Object.fromEntries(pendings.map((p) => [p.code, p._count._all]));

    const list = positions.map((p) => {
      const lastPrice = p.lastPriceMills;
      const floatProfitCents =
        lastPrice != null ? spreadCents(lastPrice - p.costPriceMills, p.baseQty) : null;

      return {
        id: p.id,
        code: p.code,
        name: p.name,
        type: p.type,
        baseQty: p.baseQty,
        availableQty: p.availableQty,
        // 价格类字段单位 = 厘（0.001 元）
        costPriceMills: p.costPriceMills,
        initialCostMills: p.initialCostMills,
        lastPriceMills: lastPrice,
        // 金额类字段单位 = 分
        realizedProfitCents: p.realizedProfitCents,
        floatProfitCents,
        pendingCount: pendingMap[p.code] || 0,
        // 保本价差（厘/股）：按单次做T 1000 股测算，仅供参考；实际按录入数量实时算
        breakEvenSpreadMills: Number(
          breakEvenSpreadMills({
            type: p.type,
            priceMills: p.costPriceMills || 10000,
            qty: 1000,
            params: feeParams,
          }).toFixed(4)
        ),
      };
    });

    return ok(res, list);
  })
);

/** 新增持仓（底仓） */
router.post(
  '/',
  requireAuth,
  requireWritable,
  asyncHandler(async (req, res) => {
    const { code, name, type, baseQty, availableQty, costPrice } = req.body || {};
    if (!code) return fail(res, '请填写标的代码');

    const codeStr = String(code).trim();
    const typeStr = type || guessType(codeStr);
    const costMills = yuanToMills(costPrice || 0);

    const exists = await prisma.position.findUnique({
      where: { userId_code: { userId: req.userId, code: codeStr } },
    });
    if (exists) return fail(res, '该标的已在持仓列表中');

    const baseQtyNum = Number(baseQty || 0);
    // 注意：用 ?? 而不是 ||，否则用户显式填「可用 0 股」会被当成未填而回退成底仓数
    const availQtyNum = availableQty != null && availableQty !== '' ? Number(availableQty) : baseQtyNum;

    const position = await prisma.position.create({
      data: {
        userId: req.userId,
        code: codeStr,
        name: name || codeStr,
        type: typeStr === 'ETF' ? 'ETF' : 'STOCK',
        baseQty: baseQtyNum,
        availableQty: availQtyNum,
        costPriceMills: costMills,
        initialCostMills: costMills,
      },
    });
    return ok(res, position, '已添加');
  })
);

/**
 * 批量导入 / 覆盖持仓
 * ------------------------------------------------------------
 * 为什么需要：券商 App 一次只能看一个账户，手动一条条录 5 只票要点 5 次；
 * 直接粘贴「代码 名称 成本价 底仓 可用」这种表格文本，一次搞定。
 *
 * body: { items: [{ code, name?, costPrice, baseQty, availableQty? }], mode: 'merge'|'replace' }
 *   merge   = 已存在则更新（默认，安全）
 *   replace = 先清空该用户所有持仓（会连带删除流水与配对，需二次确认）
 */
router.post(
  '/import',
  requireAuth,
  requireWritable,
  asyncHandler(async (req, res) => {
    const { items, mode = 'merge' } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) return fail(res, '请提供持仓列表');

    const cleaned = [];
    for (const raw of items) {
      const code = String(raw.code || '').trim();
      if (!code) continue;
      const costMills = yuanToMills(raw.costPrice || 0);
      const baseQtyNum = Number(raw.baseQty || 0);
      const availQtyNum =
        raw.availableQty != null && raw.availableQty !== '' ? Number(raw.availableQty) : baseQtyNum;
      cleaned.push({
        code,
        name: (raw.name && String(raw.name).trim()) || code,
        type: raw.type === 'ETF' || raw.type === 'STOCK' ? raw.type : guessType(code),
        baseQty: baseQtyNum,
        availableQty: availQtyNum,
        costMills,
        updateOnly: raw.updateOnly === true, // 只更新股数/成本，不动已有的做T累计
      });
    }
    if (cleaned.length === 0) return fail(res, '没有解析到有效持仓');

    let created = 0;
    let updated = 0;
    let removed = 0;

    await prisma.$transaction(async (tx) => {
      if (mode === 'replace') {
        // 先删流水与配对，避免留下孤儿数据
        await tx.hedgePair.deleteMany({ where: { userId: req.userId } });
        await tx.tradeFlow.deleteMany({ where: { userId: req.userId } });
        const del = await tx.position.deleteMany({ where: { userId: req.userId } });
        removed = del.count;
      }

      for (const it of cleaned) {
        const exists = await tx.position.findUnique({
          where: { userId_code: { userId: req.userId, code: it.code } },
        });
        if (exists) {
          await tx.position.update({
            where: { id: exists.id },
            data: {
              name: it.name,
              type: it.type,
              baseQty: it.baseQty,
              availableQty: it.availableQty,
              costPriceMills: it.costMills,
              // updateOnly 用于「只同步券商数据」的场景，保留本系统累计的做T收益
              initialCostMills: it.updateOnly ? exists.initialCostMills : it.costMills,
            },
          });
          updated += 1;
        } else {
          await tx.position.create({
            data: {
              userId: req.userId,
              code: it.code,
              name: it.name,
              type: it.type,
              baseQty: it.baseQty,
              availableQty: it.availableQty,
              costPriceMills: it.costMills,
              initialCostMills: it.costMills,
            },
          });
          created += 1;
        }
      }
    });

    return ok(res, { created, updated, removed }, `已导入：新增 ${created}，更新 ${updated}${removed ? `，清除 ${removed}` : ''}`);
  })
);

/** 修改持仓（股数、成本价） */
router.put(
  '/:id',
  requireAuth,
  requireWritable,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const position = await prisma.position.findUnique({ where: { id } });
    if (!position || position.userId !== req.userId) return fail(res, '持仓不存在', 404, 404);

    const data = {};
    if (req.body.name !== undefined) data.name = req.body.name;
    if (req.body.baseQty !== undefined) data.baseQty = Number(req.body.baseQty);
    if (req.body.availableQty !== undefined) data.availableQty = Number(req.body.availableQty);
    if (req.body.costPrice !== undefined) data.costPriceMills = yuanToMills(req.body.costPrice);
    if (req.body.initialCost !== undefined) data.initialCostMills = yuanToMills(req.body.initialCost);

    const updated = await prisma.position.update({ where: { id }, data });
    return ok(res, updated, '已保存');
  })
);

/** 删除持仓（同时删除其流水与配对） */
router.delete(
  '/:id',
  requireAuth,
  requireWritable,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const position = await prisma.position.findUnique({ where: { id } });
    if (!position || position.userId !== req.userId) return fail(res, '持仓不存在', 404, 404);

    await prisma.$transaction(async (tx) => {
      await tx.hedgePair.deleteMany({ where: { userId: req.userId, code: position.code } });
      await tx.tradeFlow.deleteMany({ where: { userId: req.userId, code: position.code } });
      await tx.position.delete({ where: { id } });
    });
    return ok(res, null, '已删除');
  })
);

module.exports = router;
