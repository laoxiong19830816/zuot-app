const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { ok, fail, asyncHandler } = require('../lib/http');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { startOfDay } = require('../lib/time');

const router = express.Router();

// 所有管理接口都需要管理员权限
router.use(requireAuth, requireAdmin);

/** 记录审计日志 */
async function audit(adminId, action, targetId, detail) {
  await prisma.adminAuditLog.create({ data: { adminId, action, targetId, detail } });
}

/** 用户列表 */
router.get(
  '/users',
  asyncHandler(async (req, res) => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, email: true, nickname: true, role: true, status: true,
        aiDailyLimit: true, aiMonthlyLimit: true, createdAt: true, lastLoginAt: true,
        inviteCodeUsed: true,
        _count: { select: { positions: true, flows: true, pairs: true } },
      },
    });

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const result = [];
    for (const u of users) {
      const monthUsage = await prisma.aiUsageLog.count({
        where: { userId: u.id, createdAt: { gte: monthStart } },
      });
      result.push({ ...u, monthAiUsage: monthUsage });
    }
    return ok(res, result);
  })
);

/** 启用 / 停用 / 只读 */
router.post(
  '/users/:id/status',
  asyncHandler(async (req, res) => {
    const { status, reason } = req.body || {};
    if (!['ACTIVE', 'SUSPENDED', 'DISABLED'].includes(status)) {
      return fail(res, '状态值不合法');
    }
    const user = await prisma.user.update({ where: { id: req.params.id }, data: { status } });
    await audit(req.userId, 'SET_STATUS', user.id, `状态改为 ${status}。原因：${reason || '未填写'}`);
    return ok(res, user, '已更新');
  })
);

/** 调整 AI 额度 */
router.post(
  '/users/:id/quota',
  asyncHandler(async (req, res) => {
    const { daily, monthly } = req.body || {};
    const data = {};
    if (daily != null) data.aiDailyLimit = Number(daily);
    if (monthly != null) data.aiMonthlyLimit = Number(monthly);
    const user = await prisma.user.update({ where: { id: req.params.id }, data });
    await audit(req.userId, 'SET_QUOTA', user.id, `日限额 ${daily} / 月限额 ${monthly}`);
    return ok(res, user, '额度已更新');
  })
);

/** 重置密码 */
router.post(
  '/users/:id/reset-password',
  asyncHandler(async (req, res) => {
    const { newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < 8) return fail(res, '新密码至少 8 位');
    const passwordHash = await bcrypt.hash(String(newPassword), 10);
    await prisma.user.update({ where: { id: req.params.id }, data: { passwordHash } });
    await audit(req.userId, 'RESET_PASSWORD', req.params.id, '管理员重置密码');
    return ok(res, null, '密码已重置');
  })
);

/** 设为管理员 / 取消管理员 */
router.post(
  '/users/:id/role',
  asyncHandler(async (req, res) => {
    const { role } = req.body || {};
    if (!['ADMIN', 'USER', 'DISABLED'].includes(role)) return fail(res, '角色值不合法');
    const user = await prisma.user.update({ where: { id: req.params.id }, data: { role } });
    await audit(req.userId, 'SET_ROLE', user.id, `角色改为 ${role}`);
    return ok(res, user, '角色已更新');
  })
);

// ------------------------------------------------------------------
// 邀请码管理
// ------------------------------------------------------------------

// 码字符集：去掉 I / O / 0 / 1 等易混淆字符，方便口头传达与手输
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function genInviteCode(len = 8) {
  const bytes = crypto.randomBytes(len);
  let s = '';
  // 32 个字符，256 % 32 === 0，取模无偏
  for (let i = 0; i < len; i += 1) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return s;
}

/** 判定邀请码当前能否使用 */
function inviteState(row) {
  if (row.disabled) return { usable: false, reason: '已停用' };
  if (row.expiresAt && new Date(row.expiresAt) < new Date()) return { usable: false, reason: '已过期' };
  if (row.usedCount >= row.maxUses) return { usable: false, reason: '已用完' };
  return { usable: true, reason: '' };
}

/** 生成邀请码 */
router.post(
  '/invite-codes',
  asyncHandler(async (req, res) => {
    const { count = 1, maxUses = 1, days = 30, note } = req.body || {};
    const n = Math.min(Math.max(Number(count) || 1, 1), 50);
    const codes = [];
    for (let i = 0; i < n; i += 1) {
      let row = null;
      // 唯一性兜底：命中已存在的码就重新生成（8 位 32 进制，概率极低）
      for (let tries = 0; tries < 5 && !row; tries += 1) {
        try {
          row = await prisma.inviteCode.create({
            data: {
              code: genInviteCode(8),
              maxUses: Math.max(Number(maxUses) || 1, 1),
              expiresAt: Number(days) > 0 ? new Date(Date.now() + Number(days) * 86400000) : null,
              createdBy: req.userId,
              note: note || null,
            },
          });
        } catch (e) {
          // P2002 = 唯一约束冲突，重试即可；其他错误直接抛出
          if (e.code !== 'P2002') throw e;
        }
      }
      if (row) codes.push(row);
    }
    await audit(req.userId, 'CREATE_INVITE', null, `生成 ${codes.length} 个邀请码（每个可用 ${maxUses} 次）`);
    return ok(res, codes, `已生成 ${codes.length} 个邀请码`);
  })
);

/** 邀请码列表（含使用者明细与可用状态） */
router.get(
  '/invite-codes',
  asyncHandler(async (req, res) => {
    const list = await prisma.inviteCode.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });

    // 通过 User.inviteCodeUsed 反查「谁用了这个码」，无需额外建表
    const users = await prisma.user.findMany({
      where: { inviteCodeUsed: { in: list.map((c) => c.code) } },
      select: { id: true, email: true, nickname: true, inviteCodeUsed: true, createdAt: true },
    });
    const byCode = {};
    for (const u of users) {
      byCode[u.inviteCodeUsed] = byCode[u.inviteCodeUsed] || [];
      byCode[u.inviteCodeUsed].push(u);
    }

    return ok(
      res,
      list.map((c) => ({ ...c, users: byCode[c.code] || [], ...inviteState(c) }))
    );
  })
);

/** 停用 / 启用邀请码 */
router.post(
  '/invite-codes/:id/toggle',
  asyncHandler(async (req, res) => {
    const row = await prisma.inviteCode.findUnique({ where: { id: req.params.id } });
    if (!row) return fail(res, '邀请码不存在');
    const updated = await prisma.inviteCode.update({
      where: { id: row.id },
      data: { disabled: !row.disabled },
    });
    await audit(req.userId, 'TOGGLE_INVITE', row.id, `${updated.disabled ? '停用' : '启用'}邀请码 ${row.code}`);
    return ok(res, updated, updated.disabled ? '已停用' : '已启用');
  })
);

/** 修改邀请码（可用次数 / 有效期 / 备注） */
router.put(
  '/invite-codes/:id',
  asyncHandler(async (req, res) => {
    const { maxUses, days, note } = req.body || {};
    const data = {};
    if (maxUses != null) data.maxUses = Math.max(Number(maxUses) || 1, 1);
    if (days != null) {
      data.expiresAt = Number(days) > 0 ? new Date(Date.now() + Number(days) * 86400000) : null;
    }
    if (note !== undefined) data.note = note || null;
    const updated = await prisma.inviteCode.update({ where: { id: req.params.id }, data });
    await audit(req.userId, 'UPDATE_INVITE', req.params.id, `修改邀请码 ${updated.code}`);
    return ok(res, updated, '已保存');
  })
);

/** 删除邀请码 */
router.delete(
  '/invite-codes/:id',
  asyncHandler(async (req, res) => {
    const row = await prisma.inviteCode.findUnique({ where: { id: req.params.id } });
    if (!row) return fail(res, '邀请码不存在');
    // 已有人用过的码不给删，避免审计断链；改用「停用」
    if (row.usedCount > 0) return fail(res, '该邀请码已有用户使用，不能删除，请改为停用');
    await prisma.inviteCode.delete({ where: { id: row.id } });
    await audit(req.userId, 'DELETE_INVITE', row.id, `删除邀请码 ${row.code}`);
    return ok(res, null, '已删除');
  })
);

/** 系统概览 */
router.get(
  '/overview',
  asyncHandler(async (req, res) => {
    const dayStart = startOfDay();
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [userCount, activeToday, aiToday, aiMonth, aiFailToday] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { lastLoginAt: { gte: dayStart } } }),
      prisma.aiUsageLog.count({ where: { createdAt: { gte: dayStart } } }),
      prisma.aiUsageLog.count({ where: { createdAt: { gte: monthStart } } }),
      prisma.aiUsageLog.count({ where: { createdAt: { gte: dayStart }, success: false } }),
    ]);

    // 粗略估算成本：输入 6元/百万token，输出 30元/百万token → 转成「分」
    const usage = await prisma.aiUsageLog.findMany({ where: { createdAt: { gte: monthStart } } });
    const tokensIn = usage.reduce((s, u) => s + (u.tokensIn || 0), 0);
    const tokensOut = usage.reduce((s, u) => s + (u.tokensOut || 0), 0);
    const costCents = Math.round((tokensIn / 1e6) * 600 + (tokensOut / 1e6) * 3000);

    const recentLogs = await prisma.adminAuditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { admin: { select: { email: true, nickname: true } } },
    });

    return ok(res, {
      userCount,
      activeToday,
      aiToday,
      aiMonth,
      aiFailToday,
      estCostCentsMonth: costCents,
      recentLogs,
    });
  })
);

module.exports = router;
