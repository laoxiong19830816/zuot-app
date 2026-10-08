/**
 * 初始化脚本（可重复执行，不会覆盖已有数据）
 * 用法：node scripts/seed.js
 *
 * 做三件事：
 *   1. 创建/更新超级管理员账号（取自 .env 的 ADMIN_EMAIL / ADMIN_PASSWORD）
 *   2. 确保至少有一个可用的邀请码（REGISTER_MODE=invite 时必须有，否则无法注册）
 *   3. 可选：灌演示数据（SEED_DEMO=true 时才执行，用于验证配对/统计算得对不对）
 *
 * 真实持仓请用：node scripts/seed-positions.js
 */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const prisma = require('../src/lib/prisma');
const config = require('../src/config');
const { feeParamsFromSettings, computeFees } = require('../src/services/fee');
const { matchFlow } = require('../src/services/pairing');
const { yuanToMills } = require('../src/lib/units');

// 与 admin 路由一致的码字符集（去掉了 I/O/0/1 等易混淆字符）
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function genInviteCode(len = 8) {
  const bytes = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i += 1) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return s;
}

async function upsertAdmin() {
  const email = config.adminInit.email;
  let admin = await prisma.user.findUnique({ where: { email } });
  if (!admin) {
    admin = await prisma.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(config.adminInit.password, 10),
        nickname: '管理员',
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });
    console.log(`✓ 管理员已创建：${email}`);
  } else {
    // 已存在则不覆盖密码，避免把用户改过的密码重置回默认值
    console.log(`· 管理员已存在：${email}（未改动密码）`);
  }

  await prisma.userSettings.upsert({
    where: { userId: admin.id },
    create: {
      userId: admin.id,
      stockCommissionRate: config.defaultFees.stockCommissionRate,
      stockMinCommissionCents: config.defaultFees.stockMinCommissionCents,
      stampTaxRate: config.defaultFees.stampTaxRate,
      transferFeeRate: config.defaultFees.transferFeeRate,
      etfCommissionRate: config.defaultFees.etfCommissionRate,
      etfMinCommissionCents: config.defaultFees.etfMinCommissionCents,
    },
    update: {},
  });
  return admin;
}

/**
 * 确保存在可用邀请码。
 * 这一步很关键：REGISTER_MODE=invite 且一个码都没有时，除了「系统首个用户」之外谁都注册不了。
 */
async function ensureInviteCode() {
  if (config.registerMode !== 'invite') {
    console.log(`· 注册模式为 ${config.registerMode}，无需邀请码`);
    return;
  }
  const all = await prisma.inviteCode.findMany({ where: { disabled: false } });
  const hasUsable = all.some(
    (c) => c.usedCount < c.maxUses && (!c.expiresAt || new Date(c.expiresAt) > new Date())
  );
  if (hasUsable) {
    console.log('· 已有可用邀请码，跳过生成');
    return;
  }

  const row = await prisma.inviteCode.create({
    data: {
      code: genInviteCode(8),
      maxUses: 5,
      expiresAt: new Date(Date.now() + 30 * 86400000),
      note: '初始化脚本生成',
    },
  });
  console.log('');
  console.log('  ┌─────────────────────────────────────────┐');
  console.log(`  │  初始邀请码：${row.code}  （可用 5 次 / 30 天） │`);
  console.log('  └─────────────────────────────────────────┘');
  console.log('');
}

/** 演示数据：仅 SEED_DEMO=true 时执行 */
async function seedDemo(admin) {
  if (process.env.SEED_DEMO !== 'true') {
    console.log('· 跳过演示数据（如需灌入请加 SEED_DEMO=true）');
    return;
  }
  const settings = await prisma.userSettings.findUnique({ where: { userId: admin.id } });
  const feeParams = feeParamsFromSettings(settings);

  const demo = [
    { code: '510300', name: '沪深300ETF', type: 'ETF', baseQty: 100000, costPrice: 3.85 },
  ];

  for (const d of demo) {
    await prisma.position.upsert({
      where: { userId_code: { userId: admin.id, code: d.code } },
      create: {
        userId: admin.id, code: d.code, name: d.name, type: d.type,
        baseQty: d.baseQty, availableQty: d.baseQty,
        costPriceMills: yuanToMills(d.costPrice),
        initialCostMills: yuanToMills(d.costPrice),
        lastPriceMills: yuanToMills(d.costPrice),
      },
      update: {},
    });
  }

  // ETF 正T一组：3.850 买 → 3.856 卖（价差 6 厘 = 0.006 元，验证厘级精度）
  const today = new Date();
  const morning = new Date(today); morning.setHours(10, 12, 0, 0);
  const afternoon = new Date(today); afternoon.setHours(13, 45, 0, 0);

  const existing = await prisma.tradeFlow.count({ where: { userId: admin.id, code: '510300' } });
  if (existing === 0) {
    await prisma.$transaction(async (tx) => {
      for (const [side, price, time] of [['BUY', 3.85, morning], ['SELL', 3.856, afternoon]]) {
        const priceMills = yuanToMills(price);
        const fees = computeFees({ type: 'ETF', side, priceMills, qty: 10000, params: feeParams });
        const flow = await tx.tradeFlow.create({
          data: {
            userId: admin.id, code: '510300', side,
            priceMills, qty: 10000, remainingQty: 10000,
            amountCents: fees.amountCents,
            commissionCents: fees.commissionCents,
            stampTaxCents: fees.stampTaxCents,
            transferFeeCents: fees.transferFeeCents,
            totalFeeCents: fees.totalFeeCents,
            tradedAt: time,
            status: 'PENDING',
          },
        });
        await matchFlow(tx, flow, feeParams);
      }
    });
    console.log('✓ 演示交易已写入：沪深300ETF 正T 一组（3.850 买 → 3.856 卖，10000 股）');
  }
}

async function main() {
  const admin = await upsertAdmin();
  await ensureInviteCode();
  await seedDemo(admin);
  console.log('');
  console.log('初始化完成。下一步：');
  console.log('  1) 录入真实持仓：node scripts/seed-positions.js <你的登录邮箱>');
  console.log('  2) 启动服务：node src/index.js');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
