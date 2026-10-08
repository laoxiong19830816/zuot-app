const express = require('express');
const prisma = require('../lib/prisma');
const { ok, fail, asyncHandler } = require('../lib/http');
const { requireAuth, requireWritable, ensureSettings } = require('../middleware/auth');
const { runAnalysis, checkQuota, evaluateHitRate } = require('../services/aiRunner');
const { todaySummary } = require('../services/pairing');
const { startOfDay } = require('../lib/time');
const config = require('../config');

const router = express.Router();

const DISCLAIMER = '本内容由 AI 基于公开数据推演生成，不构成投资建议，据此操作风险自负。';

/** 最新一条分析 */
router.get(
  '/latest',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { kind, code } = req.query;
    const where = { userId: req.userId };
    if (kind) where.kind = String(kind);
    if (code) where.code = String(code);

    const item = await prisma.aiAnalysis.findFirst({
      where,
      orderBy: { createdAt: 'desc' },
    });
    return ok(res, item ? { ...item, disclaimer: DISCLAIMER } : null);
  })
);

/** 分析列表 */
router.get(
  '/list',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { kind, code, limit } = req.query;
    const where = { userId: req.userId };
    if (kind) where.kind = String(kind);
    if (code) where.code = String(code);

    const list = await prisma.aiAnalysis.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Number(limit || 30),
      select: {
        id: true, kind: true, code: true, title: true, summary: true,
        model: true, success: true, errorMsg: true, createdAt: true, hitResult: true,
      },
    });
    return ok(res, list);
  })
);

/** 分析详情 */
router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const item = await prisma.aiAnalysis.findUnique({ where: { id: req.params.id } });
    if (!item || item.userId !== req.userId) return fail(res, '分析记录不存在', 404, 404);
    return ok(res, { ...item, disclaimer: DISCLAIMER });
  })
);

/**
 * 手动触发一次分析（「立即刷新」按钮）
 * body: { kind, code? }
 */
router.post(
  '/refresh',
  requireAuth,
  requireWritable,
  asyncHandler(async (req, res) => {
    const { kind, code, extraContext } = req.body || {};
    const allowedKinds = ['PREOPEN', 'INTRADAY', 'CLOSE', 'REVIEW', 'STOCK'];
    const useKind = allowedKinds.includes(kind) ? kind : 'INTRADAY';

    const settings = await ensureSettings(req.userId);
    if (useKind === 'PREOPEN' && !settings.aiEnablePreopen) return fail(res, '集合竞价分析已关闭');
    if (useKind === 'INTRADAY' && !settings.aiEnableIntraday) return fail(res, '盘中分析已关闭');
    if (useKind === 'CLOSE' && !settings.aiEnableClose) return fail(res, '收盘分析已关闭');

    const result = await runAnalysis({
      userId: req.userId,
      kind: useKind,
      code: code || null,
      codes: code ? [code] : [],
      extraContext: extraContext || '',
      triggeredBy: 'manual',
    });

    if (!result.success) {
      return fail(res, result.error || 'AI 分析失败', result.quotaExceeded ? 2 : 1);
    }
    return ok(res, { ...result.analysis, disclaimer: DISCLAIMER });
  })
);

/**
 * 盘后复盘（需求 2：录完交易后点按钮触发）
 * 前置校验：当日必须有交易记录
 */
router.post(
  '/review',
  requireAuth,
  requireWritable,
  asyncHandler(async (req, res) => {
    const dayStart = startOfDay();
    const dayEnd = new Date(dayStart.getTime() + 86400000);

    const flowCount = await prisma.tradeFlow.count({
      where: { userId: req.userId, tradedAt: { gte: dayStart, lt: dayEnd } },
    });
    if (flowCount === 0) {
      return fail(res, '今日还没有交易记录，请先录入今日做T后再生成复盘');
    }

    const result = await runAnalysis({
      userId: req.userId,
      kind: 'REVIEW',
      extraContext: req.body?.extraContext || '',
      triggeredBy: 'manual',
    });

    if (!result.success) return fail(res, result.error || '复盘生成失败', result.quotaExceeded ? 2 : 1);

    // 同时落一条 Review 记录（人工复盘表单后续补充）
    const review = await prisma.review.upsert({
      where: { userId_date: { userId: req.userId, date: dayStart } },
      create: { userId: req.userId, date: dayStart, aiContent: result.analysis.content },
      update: { aiContent: result.analysis.content },
    });

    return ok(res, { analysis: { ...result.analysis, disclaimer: DISCLAIMER }, review });
  })
);

/** 额度与用量 */
router.get(
  '/usage',
  requireAuth,
  asyncHandler(async (req, res) => {
    const quota = await checkQuota(req.userId);
    return ok(res, quota);
  })
);

/** 人工复盘表单保存 */
router.post(
  '/review/manual',
  requireAuth,
  requireWritable,
  asyncHandler(async (req, res) => {
    const dayStart = startOfDay(req.body?.date ? new Date(req.body.date) : new Date());
    const { executedPlan, deviationReason, mistakeTags, emotion, improvement } = req.body || {};

    const review = await prisma.review.upsert({
      where: { userId_date: { userId: req.userId, date: dayStart } },
      create: {
        userId: req.userId, date: dayStart,
        executedPlan: !!executedPlan,
        deviationReason: deviationReason || null,
        mistakeTags: mistakeTags || null,
        emotion: emotion || null,
        improvement: improvement || null,
      },
      update: {
        executedPlan: !!executedPlan,
        deviationReason: deviationReason || null,
        mistakeTags: mistakeTags || null,
        emotion: emotion || null,
        improvement: improvement || null,
      },
    });
    return ok(res, review, '复盘已保存');
  })
);

/** AI 命中率统计 */
router.get(
  '/hit-rate',
  requireAuth,
  asyncHandler(async (req, res) => {
    // 先对昨天的分析做一次回填，再统计
    await evaluateHitRate(req.userId, 1);

    const [hit, miss, flat] = await Promise.all([
      prisma.aiAnalysis.count({ where: { userId: req.userId, hitResult: 'HIT' } }),
      prisma.aiAnalysis.count({ where: { userId: req.userId, hitResult: 'MISS' } }),
      prisma.aiAnalysis.count({ where: { userId: req.userId, hitResult: 'FLAT' } }),
    ]);
    const total = hit + miss;
    return ok(res, { hit, miss, flat, rate: total ? hit / total : 0, sampleSize: total });
  })
);

module.exports = router;
