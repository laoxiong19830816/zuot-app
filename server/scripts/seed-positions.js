/**
 * 录入真实持仓（底仓）
 * 用法：
 *   node scripts/seed-positions.js                          # 默认给管理员账号录
 *   node scripts/seed-positions.js your@email.com           # 指定账号
 *   node scripts/seed-positions.js your@email.com --force   # 覆盖已存在标的的股数与成本
 *
 * 数据来源：券商 App「我的持仓」截图（人民币账户 31165605）
 * 单位说明：成本价 / 现价用「厘」（0.001 元）存储，所以 16.101 元 = 16101 厘，零误差。
 */

const prisma = require('../src/lib/prisma');
const config = require('../src/config');
const { yuanToMills } = require('../src/lib/units');

/**
 * ⚠️ 数据全部来自截图，请核对后再执行。
 * availableQty = 券商显示的「可用」股数（已被挂单占用的部分不可用）。
 */
const HOLDINGS = [
  { code: '600062', name: '华润双鹤', type: 'STOCK', qty: 500,   available: 500,   cost: 16.101, last: 16.160 },
  { code: '000100', name: 'TCL科技',  type: 'STOCK', qty: 4100,  available: 100,   cost: 3.530,  last: 4.630  },
  { code: '000423', name: '东阿阿胶', type: 'STOCK', qty: 2000,  available: 1500,  cost: 49.750, last: 46.420 },
  { code: '000651', name: '格力电器', type: 'STOCK', qty: 500,   available: 500,   cost: 36.239, last: 38.320 },
  { code: '000915', name: '华特达因', type: 'STOCK', qty: 11500, available: 11400, cost: 28.273, last: 23.950 },
];

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const email = args.find((a) => a.includes('@')) || config.adminInit.email;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`✗ 找不到账号：${email}`);
    console.error('  可先执行 node scripts/seed.js 创建管理员，或在 App 里注册后重试。');
    process.exit(1);
  }

  console.log(`目标账号：${email}（${user.nickname}）`);
  console.log(`模式：${force ? '覆盖已有标的' : '仅新增，跳过已存在'}`);
  console.log('');

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const h of HOLDINGS) {
    const costMills = yuanToMills(h.cost);
    const lastMills = yuanToMills(h.last);
    const exists = await prisma.position.findUnique({
      where: { userId_code: { userId: user.id, code: h.code } },
    });

    if (exists && !force) {
      console.log(`· 跳过 ${h.code} ${h.name}（已存在，底仓 ${exists.baseQty} 股 @${(exists.costPriceMills / 1000).toFixed(3)}）`);
      skipped += 1;
      continue;
    }

    const data = {
      name: h.name,
      type: h.type,
      baseQty: h.qty,
      availableQty: h.available,
      costPriceMills: costMills,
      initialCostMills: costMills,
      lastPriceMills: lastMills,
    };

    if (exists) {
      await prisma.position.update({ where: { id: exists.id }, data });
      console.log(`✓ 已更新 ${h.code} ${h.name}：底仓 ${h.qty} 股（可用 ${h.available}）@ ${h.cost.toFixed(3)}`);
      updated += 1;
    } else {
      await prisma.position.create({
        data: { userId: user.id, code: h.code, ...data },
      });
      console.log(`✓ 已录入 ${h.code} ${h.name}：底仓 ${h.qty} 股（可用 ${h.available}）@ ${h.cost.toFixed(3)}`);
      created += 1;
    }
  }

  console.log('');
  console.log(`完成：新增 ${created} / 更新 ${updated} / 跳过 ${skipped}`);

  // 顺带算一下每只票的市值与盈亏，方便核对是否与券商一致
  const positions = await prisma.position.findMany({ where: { userId: user.id } });
  const { notionalCents } = require('../src/lib/units');
  let totalValue = 0;
  let totalFloat = 0;
  console.log('');
  console.log('核对表（用现价重算，应与券商截图一致）：');
  for (const p of positions) {
    const valueCents = notionalCents(p.lastPriceMills || p.costPriceMills, p.baseQty);
    const floatCents = notionalCents((p.lastPriceMills || 0) - p.costPriceMills, p.baseQty);
    totalValue += valueCents;
    totalFloat += floatCents;
    console.log(
      `  ${p.code} ${p.name.padEnd(5, '　')} 市值 ${(valueCents / 100).toFixed(2).padStart(12)}  ` +
        `浮动盈亏 ${(floatCents / 100).toFixed(2).padStart(11)}`
    );
  }
  console.log(`  ${'合计'.padEnd(9, '　')} 市值 ${(totalValue / 100).toFixed(2).padStart(12)}  浮动盈亏 ${(totalFloat / 100).toFixed(2).padStart(11)}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
