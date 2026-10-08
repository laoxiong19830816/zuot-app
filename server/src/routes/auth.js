const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const config = require('../config');
const { ok, fail, asyncHandler } = require('../lib/http');
const { signToken, requireAuth, ensureSettings } = require('../middleware/auth');

const router = express.Router();

const DISCLAIMER =
  '本系统仅为个人交易记录与信息整理工具，所有 AI 分析均基于公开数据与用户自设规则推演，不构成投资建议，据此操作风险自负。';

/** 注册 */
router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const { email, password, nickname, inviteCode } = req.body || {};
    if (!email || !password) return fail(res, '邮箱和密码不能为空');
    if (String(password).length < 8) return fail(res, '密码至少 8 位');

    const exists = await prisma.user.findUnique({ where: { email: String(email).toLowerCase() } });
    if (exists) return fail(res, '该邮箱已注册');

    const userCount = await prisma.user.count();
    const isFirst = userCount === 0;

    // 注册模式控制（降低合规风险）
    let inviteRow = null;
    if (config.registerMode === 'closed') {
      return fail(res, '当前已关闭注册，请联系管理员');
    }
    // 【关键修复】引导期豁免：
    // invite 模式下若系统内还没有任何用户，必须放行第一个注册者，
    // 否则没有任何邀请码可发，超级管理员永远创建不出来 —— 死锁。
    const isBootstrap = isFirst && config.bootstrapFirstUserAsAdmin;
    if (config.registerMode === 'invite' && !isBootstrap) {
      if (!inviteCode) return fail(res, '当前需邀请码注册');
      inviteRow = await prisma.inviteCode.findUnique({ where: { code: String(inviteCode) } });
      if (!inviteRow) return fail(res, '邀请码无效');
      if (inviteRow.disabled) return fail(res, '邀请码已被停用');
      if (inviteRow.expiresAt && new Date(inviteRow.expiresAt) < new Date()) return fail(res, '邀请码已过期');
      if (inviteRow.usedCount >= inviteRow.maxUses) return fail(res, '邀请码已被用完');
    }

    const passwordHash = await bcrypt.hash(String(password), 10);

    const user = await prisma.user.create({
      data: {
        email: String(email).toLowerCase(),
        passwordHash,
        nickname: nickname || String(email).split('@')[0],
        role: isFirst && config.bootstrapFirstUserAsAdmin ? 'ADMIN' : 'USER',
        status: 'ACTIVE',
        inviteCodeUsed: inviteRow ? inviteRow.code : null,
      },
    });

    // 默认费率（你的真实费率）
    await prisma.userSettings.create({
      data: {
        userId: user.id,
        stockCommissionRate: config.defaultFees.stockCommissionRate,
        stockMinCommissionCents: config.defaultFees.stockMinCommissionCents,
        stampTaxRate: config.defaultFees.stampTaxRate,
        transferFeeRate: config.defaultFees.transferFeeRate,
        etfCommissionRate: config.defaultFees.etfCommissionRate,
        etfMinCommissionCents: config.defaultFees.etfMinCommissionCents,
      },
    });

    if (inviteRow) {
      await prisma.inviteCode.update({
        where: { id: inviteRow.id },
        data: { usedCount: inviteRow.usedCount + 1 },
      });
    }

    const token = signToken(user);
    return ok(res, {
      token,
      user: { id: user.id, email: user.email, nickname: user.nickname, role: user.role },
      disclaimer: DISCLAIMER,
    });
  })
);

/** 登录 */
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return fail(res, '请输入邮箱和密码');

    const user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase() } });
    if (!user) return fail(res, '账号或密码错误');

    const valid = await bcrypt.compare(String(password), user.passwordHash);
    if (!valid) return fail(res, '账号或密码错误');

    if (user.status === 'SUSPENDED') return fail(res, '账号已被停用，请联系管理员');

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const token = signToken(user);
    return ok(res, {
      token,
      user: { id: user.id, email: user.email, nickname: user.nickname, role: user.role },
      disclaimer: DISCLAIMER,
    });
  })
);

/** 当前用户信息 + 设置 */
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const settings = await ensureSettings(req.userId);
    return ok(res, {
      user: {
        id: req.user.id,
        email: req.user.email,
        nickname: req.user.nickname,
        role: req.user.role,
        status: req.user.status,
        aiDailyLimit: req.user.aiDailyLimit,
        aiMonthlyLimit: req.user.aiMonthlyLimit,
      },
      settings,
      disclaimer: DISCLAIMER,
    });
  })
);

/** 修改密码 */
router.post(
  '/password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { oldPassword, newPassword } = req.body || {};
    if (!oldPassword || !newPassword) return fail(res, '请填写原密码与新密码');
    if (String(newPassword).length < 8) return fail(res, '新密码至少 8 位');

    const valid = await bcrypt.compare(String(oldPassword), req.user.passwordHash);
    if (!valid) return fail(res, '原密码错误');

    const passwordHash = await bcrypt.hash(String(newPassword), 10);
    await prisma.user.update({ where: { id: req.userId }, data: { passwordHash } });
    return ok(res, null, '密码已更新');
  })
);

/** 更新设置（费率 / 风险规则 / AI 开关） */
router.put(
  '/settings',
  requireAuth,
  asyncHandler(async (req, res) => {
    await ensureSettings(req.userId);
    const allowed = [
      'stockCommissionRate', 'stockMinCommissionCents', 'stampTaxRate', 'transferFeeRate',
      'etfCommissionRate', 'etfMinCommissionCents', 'complianceMode',
      'maxTradePerDay', 'maxLossStreak', 'singleStopLossCents', 'pendingMaxDays',
      'positionLimitPct', 'feeErosionAlertPct',
      'aiEnablePreopen', 'aiEnableIntraday', 'aiEnableClose',
    ];
    const data = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) data[key] = req.body[key];
    }
    const settings = await prisma.userSettings.update({ where: { userId: req.userId }, data });
    return ok(res, settings, '设置已保存');
  })
);

module.exports = router;
