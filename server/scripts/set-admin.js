#!/usr/bin/env node
/**
 * 确定一个管理员账号（幂等，可反复跑）
 *
 * 作用：不管数据库里现在是什么状态，跑完一定存在一个能登录的管理员：
 *   - 账号不存在 → 创建（角色 ADMIN、状态 ACTIVE）
 *   - 账号已存在 → 重设密码、强制恢复为 ADMIN + ACTIVE（防止被误停用/降级）
 *
 * ⚠️ 必须**先停掉后端服务**再跑本脚本：
 *    文件存储模式下，运行中的服务把数据放在内存里，它下一次写盘会把你的改动覆盖掉。
 *
 * 用法：
 *   NEW_ADMIN_EMAIL=admin@zuot.com NEW_ADMIN_PASSWORD=zuot2026 node scripts/set-admin.js
 *   不传参数时，用 .env 里的 ADMIN_EMAIL / ADMIN_PASSWORD
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const bcrypt = require('bcryptjs');
const prisma = require('../src/lib/prisma');

async function main() {
  const email = String(
    process.env.NEW_ADMIN_EMAIL || process.env.ADMIN_EMAIL || 'admin@zuot.local'
  )
    .trim()
    .toLowerCase();
  const password = String(
    process.env.NEW_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || 'Zuot@Admin2026'
  );

  const passwordHash = await bcrypt.hash(password, 10);

  let user = await prisma.user.findUnique({ where: { email } });
  if (user) {
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, role: 'ADMIN', status: 'ACTIVE' },
    });
    console.log('已重设管理员密码：%s', email);
  } else {
    user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        nickname: '管理员',
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });
    console.log('已创建管理员：%s', email);

    // 顺手补一份默认费率设置，避免新账号进来费率是空的
    const exist = await prisma.userSettings.findUnique({ where: { userId: user.id } });
    if (!exist) {
      await prisma.userSettings.create({
        data: {
          userId: user.id,
          stockCommissionRate: 0.000074,
          stockMinCommissionCents: 0,
          stampTaxRate: 0.0005,
          transferFeeRate: 0.00001,
          etfCommissionRate: 0.00005,
          etfMinCommissionCents: 0,
        },
      });
      console.log('已写入默认费率');
    }
  }

  // 自检：用同一个哈希再比对一次，确保存进去的就是这个密码
  const saved = await prisma.user.findUnique({ where: { email } });
  const okPwd = await bcrypt.compare(password, saved.passwordHash);

  console.log('----------------------------------------');
  console.log('管理员邮箱：%s', saved.email);
  console.log('管理员密码：%s', password);
  console.log('角色 / 状态：%s / %s', saved.role, saved.status);
  console.log('密码校验：%s', okPwd ? '通过 ✅' : '失败 ❌');
  console.log('----------------------------------------');

  await prisma.$disconnect();
  process.exit(okPwd ? 0 : 1);
}

main().catch((e) => {
  console.error('设置管理员失败：', e);
  process.exit(1);
});
