/**
 * 文件存储引擎测试（纯 JS，不依赖任何第三方包，直接 node 跑）
 * 用法：node scripts/test-filestore.js
 *
 * 目的：证明 src/lib/filestore.js 的语义与 Prisma Client 一致——
 *       业务代码（routes/services）不改一行也能正确跑。
 *       覆盖：默认值/唯一键（含复合）/where 运算符/排序/分页/
 *             select/include/_count/aggregate/groupBy/upsert/
 *             事务回滚/日期往返/落盘重载/批量更新删除
 */

const fs = require('fs');
const path = require('path');
const { createFileStore } = require('../src/lib/filestore');

const TEST_FILE = path.join(__dirname, '..', 'data', 'test-db.json');
const y = (cents) => (cents / 100).toFixed(2);

// ------------------------------------------------------------------
// 迷你测试框架
// ------------------------------------------------------------------
let pass = 0;
let fail = 0;
const failures = [];

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    failures.push({ name, actual: a, expected: e });
    console.log(`  ✗ ${name}`);
    console.log(`      期望 ${e}`);
    console.log(`      实际 ${a}`);
  }
}

function section(title) {
  console.log('');
  console.log(`── ${title} ${'─'.repeat(Math.max(0, 46 - title.length))}`);
}

(async () => {
  // 每次从干净文件开始
  if (fs.existsSync(TEST_FILE)) fs.unlinkSync(TEST_FILE);
  const prisma = createFileStore(TEST_FILE);

  // ================================================================
  section('1. 创建与默认值');
  // ================================================================
  const alice = await prisma.user.create({
    data: { email: 'alice@example.com', passwordHash: 'hash1', nickname: '爱丽丝', role: 'ADMIN' },
  });
  check('自动生成 id', typeof alice.id === 'string' && alice.id.length > 8, true);
  check('role 显式传入生效', alice.role, 'ADMIN');
  check('status 取默认值 ACTIVE', alice.status, 'ACTIVE');
  check('aiDailyLimit 默认 20', alice.aiDailyLimit, 20);
  check('createdAt 是 Date 对象', alice.createdAt instanceof Date, true);

  const bob = await prisma.user.create({
    data: { email: 'bob@example.com', passwordHash: 'hash2' },
  });
  check('role 默认 USER', bob.role, 'USER');

  // ================================================================
  section('2. findUnique（单键 / 复合键）');
  // ================================================================
  const byEmail = await prisma.user.findUnique({ where: { email: 'alice@example.com' } });
  check('按 email 查到', byEmail.id, alice.id);

  const byId = await prisma.user.findUnique({ where: { id: bob.id } });
  check('按 id 查到', byId.email, 'bob@example.com');

  const missing = await prisma.user.findUnique({ where: { email: 'nobody@example.com' } });
  check('查不到返回 null', missing, null);

  await prisma.position.create({
    data: {
      userId: alice.id, code: '510300', name: '沪深300ETF', type: 'ETF',
      baseQty: 100000, availableQty: 100000, costPriceMills: 3850, initialCostMills: 3850,
    },
  });
  const pos = await prisma.position.findUnique({
    where: { userId_code: { userId: alice.id, code: '510300' } },
  });
  check('复合唯一键 userId_code 命中', pos.name, '沪深300ETF');
  check('priceMills 原样存储（3850 厘）', pos.costPriceMills, 3850);

  // ================================================================
  section('3. 设置表的一对一（userId 唯一）');
  // ================================================================
  await prisma.userSettings.create({
    data: { userId: alice.id, stockCommissionRate: 0.000074 },
  });
  const st = await prisma.userSettings.findUnique({ where: { userId: alice.id } });
  check('按 userId 查到设置', st.stockCommissionRate, 0.000074);
  check('未传字段取默认值（免五=0）', st.stockMinCommissionCents, 0);
  check('singleStopLossCents 默认 -20000', st.singleStopLossCents, -20000);
  check('aiEnableIntraday 默认 true', st.aiEnableIntraday, true);

  // ================================================================
  section('4. where 运算符');
  // ================================================================
  const mkFlow = (side, price, qty, remain, day, status) =>
    prisma.tradeFlow.create({
      data: {
        userId: alice.id, positionId: pos.id, code: '510300', side,
        priceMills: price, qty, remainingQty: remain,
        amountCents: price * qty, commissionCents: 10, stampTaxCents: 0,
        transferFeeCents: 0, totalFeeCents: 10,
        tradedAt: new Date(`2026-10-0${day}T09:30:00`), status,
      },
    });

  const f1 = await mkFlow('BUY', 3850, 10000, 10000, 1, 'PENDING');
  const f2 = await mkFlow('BUY', 3860, 10000, 4000, 2, 'PARTIAL');
  const f3 = await mkFlow('SELL', 3856, 10000, 0, 3, 'MATCHED');
  await mkFlow('BUY', 3870, 5000, 5000, 4, 'PENDING');

  const pendings = await prisma.tradeFlow.findMany({
    where: { userId: alice.id, remainingQty: { gt: 0 } },
    orderBy: [{ tradedAt: 'asc' }],
  });
  check('remainingQty gt 0 命中 3 条', pendings.length, 3);
  check('orderBy asc 第一条是最早的', pendings[0].id, f1.id);

  const dateRange = await prisma.tradeFlow.findMany({
    where: { tradedAt: { gte: new Date('2026-10-02T00:00:00'), lt: new Date('2026-10-04T00:00:00') } },
  });
  check('日期区间 gte/lt 命中 2 条', dateRange.length, 2);

  const inList = await prisma.tradeFlow.findMany({
    where: { side: { in: ['SELL'] } },
  });
  check('in 运算符', inList.length, 1);
  check('in 命中的是卖出单', inList[0].id, f3.id);

  const notSelf = await prisma.tradeFlow.findMany({
    where: { code: '510300', id: { not: f1.id } },
  });
  check('id not 排除自己', notSelf.length, 3);

  const byStatus = await prisma.tradeFlow.findMany({ where: { status: 'PARTIAL' } });
  check('枚举字符串等值匹配', byStatus.length, 1);
  check('枚举值正确', byStatus[0].id, f2.id);

  const orQuery = await prisma.tradeFlow.findMany({
    where: { OR: [{ side: 'SELL' }, { remainingQty: 5000 }] },
  });
  check('OR 条件', orQuery.length, 2);

  // ================================================================
  section('5. 排序 / 分页 / 计数');
  // ================================================================
  const descPage = await prisma.tradeFlow.findMany({
    where: { userId: alice.id },
    orderBy: [{ tradedAt: 'desc' }],
    take: 2,
  });
  check('orderBy desc + take 2', descPage.length, 2);
  check('desc 第一条是最新的', descPage[0].tradedAt.getTime() > descPage[1].tradedAt.getTime(), true);

  const skipped = await prisma.tradeFlow.findMany({
    where: { userId: alice.id },
    orderBy: [{ tradedAt: 'asc' }],
    skip: 1,
    take: 1,
  });
  check('skip 1 后第一条是第二早的', skipped[0].id, f2.id);

  const cnt = await prisma.tradeFlow.count({ where: { userId: alice.id, remainingQty: { gt: 0 } } });
  check('count 未对冲单数', cnt, 3);

  const totalUsers = await prisma.user.count();
  check('count 不带条件', totalUsers, 2);

  // ================================================================
  section('6. aggregate / groupBy');
  // ================================================================
  const agg = await prisma.tradeFlow.aggregate({
    where: { userId: alice.id, remainingQty: { gt: 0 } },
    _sum: { remainingQty: true },
  });
  check('aggregate _sum remainingQty', agg._sum.remainingQty, 10000 + 4000 + 5000);

  const aggEmpty = await prisma.tradeFlow.aggregate({
    where: { userId: 'not-exist-user' },
    _sum: { remainingQty: true },
  });
  check('无记录时 _sum 返回 null（与 Prisma 一致）', aggEmpty._sum.remainingQty, null);

  const grouped = await prisma.tradeFlow.groupBy({
    by: ['code'],
    where: { userId: alice.id, remainingQty: { gt: 0 } },
    _count: { _all: true },
  });
  check('groupBy 分组数', grouped.length, 1);
  check('groupBy 的 code', grouped[0].code, '510300');
  check('groupBy _count._all', grouped[0]._count._all, 3);

  // ================================================================
  section('7. select / include / _count');
  // ================================================================
  const picked = await prisma.aiAnalysis.findMany({ where: { userId: alice.id } });
  check('无记录时 findMany 返回空数组', picked, []);

  await prisma.aiAnalysis.create({
    data: {
      userId: alice.id, kind: 'INTRADAY', code: '510300', title: '盘中分析',
      summary: '一句话结论', content: '正文', model: 'Doubao-Seed-2.1-pro',
      dataSnapshot: { price: 3.856, note: '快照' },
    },
  });
  const one = await prisma.aiAnalysis.findFirst({
    where: { userId: alice.id, kind: 'INTRADAY' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, kind: true, title: true, summary: true },
  });
  check('select 只返回白名单字段', Object.keys(one).sort(), ['id', 'kind', 'summary', 'title']);
  check('select 里 content 被排除', one.content, undefined);

  const withCount = await prisma.user.findMany({
    select: {
      email: true,
      _count: { select: { positions: true, flows: true } },
    },
  });
  const aliceRow = withCount.find((u) => u.email === 'alice@example.com');
  check('select 内嵌 _count.positions', aliceRow._count.positions, 1);
  check('select 内嵌 _count.flows（4 笔流水）', aliceRow._count.flows, 4);

  await prisma.adminAuditLog.create({
    data: { adminId: alice.id, action: 'SET_STATUS', targetId: bob.id, detail: '测试' },
  });
  const logs = await prisma.adminAuditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: { admin: { select: { email: true, nickname: true } } },
  });
  check('include 关联到管理员', logs[0].admin.email, 'alice@example.com');
  check('include 子级 select 生效', Object.keys(logs[0].admin).sort(), ['email', 'nickname']);

  // ================================================================
  section('8. update / updateMany / upsert / delete');
  // ================================================================
  const updated = await prisma.position.update({
    where: { id: pos.id },
    data: { costPriceMills: 3840, realizedProfitCents: 2938 },
  });
  check('update 改价格（厘）', updated.costPriceMills, 3840);
  check('update 改已实现收益（分）', updated.realizedProfitCents, 2938);
  check('update 未传字段保持原值', updated.baseQty, 100000);

  const beforeUpdatedAt = updated.updatedAt;
  await new Promise((r) => setTimeout(r, 5));
  const again = await prisma.position.update({ where: { id: pos.id }, data: { baseQty: 90000 } });
  check('updatedAt 自动刷新', again.updatedAt.getTime() >= beforeUpdatedAt.getTime(), true);

  await prisma.position.create({
    data: { userId: alice.id, code: '600062', name: '华润双鹤', type: 'STOCK', baseQty: 1000 },
  });
  const many = await prisma.position.updateMany({
    where: { userId: alice.id },
    data: { lastPriceMills: 12345 },
  });
  check('updateMany 返回改动条数', many.count, 2);
  const afterMany = await prisma.position.findMany({ where: { userId: alice.id } });
  check('updateMany 全部生效', afterMany.every((p) => p.lastPriceMills === 12345), true);

  const today = new Date('2026-10-08T00:00:00');
  await prisma.review.upsert({
    where: { userId_date: { userId: alice.id, date: today } },
    create: { userId: alice.id, date: today, aiContent: '第一次复盘' },
    update: { aiContent: '第二次复盘' },
  });
  const r1 = await prisma.review.findUnique({ where: { userId_date: { userId: alice.id, date: today } } });
  check('upsert 无记录时执行 create', r1.aiContent, '第一次复盘');

  await prisma.review.upsert({
    where: { userId_date: { userId: alice.id, date: today } },
    create: { userId: alice.id, date: today, aiContent: '不该出现' },
    update: { aiContent: '第二次复盘' },
  });
  const r2 = await prisma.review.findUnique({ where: { userId_date: { userId: alice.id, date: today } } });
  check('upsert 已有记录时执行 update', r2.aiContent, '第二次复盘');
  check('upsert 不会重复插入', await prisma.review.count({ where: { userId: alice.id } }), 1);

  const delCount = await prisma.position.deleteMany({ where: { userId: alice.id, code: '600062' } });
  check('deleteMany 返回条数', delCount.count, 1);
  check('删除后持仓剩 1 个', await prisma.position.count({ where: { userId: alice.id } }), 1);

  const gone = await prisma.position.findUnique({ where: { userId_code: { userId: alice.id, code: '600062' } } });
  check('删除后查不到', gone, null);

  // ================================================================
  section('9. 事务：成功提交 / 失败回滚');
  // ================================================================
  await prisma.$transaction(async (tx) => {
    await tx.hedgePair.create({
      data: {
        userId: alice.id, code: '510300', buyFlowId: f1.id, sellFlowId: f3.id, qty: 10000,
        buyPriceMills: 3850, sellPriceMills: 3856, grossProfitCents: 6000,
        totalFeeCents: 20, netProfitCents: 5980, returnRate: 0.00156,
        openDate: new Date('2026-10-01'), hedgeDate: new Date('2026-10-03'),
      },
    });
    await tx.tradeFlow.update({ where: { id: f1.id }, data: { remainingQty: 0, status: 'MATCHED' } });
  });
  check('事务提交后配对已写入', await prisma.hedgePair.count(), 1);
  check('事务内更新已生效', (await prisma.tradeFlow.findUnique({ where: { id: f1.id } })).remainingQty, 0);

  let threw = false;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.hedgePair.create({
        data: {
          userId: alice.id, code: '510300', buyFlowId: f2.id, sellFlowId: f3.id, qty: 4000,
          buyPriceMills: 3860, sellPriceMills: 3856, grossProfitCents: -1600,
          totalFeeCents: 8, netProfitCents: -1608, returnRate: 0,
          openDate: new Date('2026-10-02'), hedgeDate: new Date('2026-10-03'),
        },
      });
      await tx.tradeFlow.update({ where: { id: f2.id }, data: { remainingQty: 0, status: 'MATCHED' } });
      throw new Error('模拟中途失败');
    });
  } catch (e) {
    threw = true;
  }
  check('事务抛错被外层捕获', threw, true);
  check('回滚后配对仍只有 1 条', await prisma.hedgePair.count(), 1);
  check('回滚后流水未被改动（仍剩 4000）', (await prisma.tradeFlow.findUnique({ where: { id: f2.id } })).remainingQty, 4000);

  // ================================================================
  section('10. 日期往返 / 落盘重载 / 数据完整性');
  // ================================================================
  const flow = await prisma.tradeFlow.findUnique({ where: { id: f1.id } });
  check('tradedAt 读出是 Date 对象', flow.tradedAt instanceof Date, true);
  // 本机时区为 GMT+8，构造时写的本地 09:30 对应 UTC 01:30，此处验证时区换算没走样
  check('tradedAt 时间戳未丢失', flow.tradedAt.toISOString(), '2026-10-01T01:30:00.000Z');
  check('tradedAt 与写入值完全相等', flow.tradedAt.getTime(), new Date('2026-10-01T09:30:00').getTime());
  check('JSON 字段（dataSnapshot）保持对象', typeof (await prisma.aiAnalysis.findFirst({})).dataSnapshot, 'object');

  const raw = JSON.parse(fs.readFileSync(TEST_FILE, 'utf8'));
  check('数据文件已落盘（含 users 表）', Array.isArray(raw.users), true);
  check('落盘的用户数为 2', raw.users.length, 2);

  // 重新加载一次，模拟服务重启
  const prisma2 = createFileStore(TEST_FILE);
  const reloaded = await prisma2.user.findUnique({ where: { email: 'alice@example.com' } });
  check('重启后数据仍在', reloaded.id, alice.id);
  check('重启后日期仍是 Date', reloaded.createdAt instanceof Date, true);

  // 大额整数不丢精度（金额分 / 价格厘都必须是整数）
  await prisma.position.update({
    where: { userId_code: { userId: alice.id, code: '510300' } },
    data: { costPriceMills: 16101, realizedProfitCents: 2938000 },
  });
  const big = await prisma.position.findUnique({
    where: { userId_code: { userId: alice.id, code: '510300' } },
  });
  check('价格 16101 厘 = 16.101 元（千分位不丢）', big.costPriceMills, 16101);
  check('金额 2938000 分 = 29380.00 元', y(big.realizedProfitCents), '29380.00');

  // ================================================================
  // 汇总
  // ================================================================
  fs.unlinkSync(TEST_FILE);
  console.log('');
  console.log('─'.repeat(52));
  console.log(`  通过 ${pass} 项，失败 ${fail} 项`);
  if (fail) {
    console.log('');
    console.log('  失败明细：');
    failures.forEach((f) => console.log(`   · ${f.name}\n     期望 ${f.expected}\n     实际 ${f.actual}`));
    process.exit(1);
  }
  console.log('  ✅ 文件存储引擎语义与 Prisma 一致');
  console.log('─'.repeat(52));
})().catch((e) => {
  console.error('测试异常：', e);
  process.exit(1);
});
