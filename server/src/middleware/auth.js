const jwt = require('jsonwebtoken');
const config = require('../config');
const prisma = require('../lib/prisma');
const { fail } = require('../lib/http');

function signToken(user) {
  return jwt.sign({ uid: user.id, role: user.role }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

/**
 * 登录校验 + 数据隔离基础
 * 关键：userId 一律从 token 取，绝不接受接口参数传入，防止越权读取他人数据。
 */
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return fail(res, '未登录', 401, 401);

    const payload = jwt.verify(token, config.jwtSecret);
    const user = await prisma.user.findUnique({ where: { id: payload.uid } });
    if (!user) return fail(res, '账号不存在', 401, 401);
    if (user.status === 'SUSPENDED') return fail(res, '账号已被停用，请联系管理员', 403, 403);

    req.user = user;
    req.userId = user.id;
    next();
  } catch (err) {
    return fail(res, `登录态失效：${err.message}`, 401, 401);
  }
}

/** 管理员 */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'ADMIN') {
    return fail(res, '需要管理员权限', 403, 403);
  }
  next();
}

/** 可写（被停用的账号只读） */
function requireWritable(req, res, next) {
  if (req.user.role === 'DISABLED') {
    return fail(res, '账号为只读状态，无法进行此操作', 403, 403);
  }
  next();
}

/** 取用户设置（不存在则按默认费率创建） */
async function ensureSettings(userId) {
  let settings = await prisma.userSettings.findUnique({ where: { userId } });
  if (!settings) {
    settings = await prisma.userSettings.create({
      data: {
        userId,
        stockCommissionRate: require('../config').defaultFees.stockCommissionRate,
        stockMinCommissionCents: require('../config').defaultFees.stockMinCommissionCents,
        stampTaxRate: require('../config').defaultFees.stampTaxRate,
        transferFeeRate: require('../config').defaultFees.transferFeeRate,
        etfCommissionRate: require('../config').defaultFees.etfCommissionRate,
        etfMinCommissionCents: require('../config').defaultFees.etfMinCommissionCents,
      },
    });
  }
  return settings;
}

module.exports = { signToken, requireAuth, requireAdmin, requireWritable, ensureSettings };
