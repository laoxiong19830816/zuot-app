/**
 * 核心业务逻辑测试（无需数据库、无需装依赖，直接 node 跑）
 * 用法：node scripts/test.js
 *
 * 覆盖：单位换算、费率引擎（股票/ETF/合规口径）、对冲配对结算、成本冲减、边界场景
 */

// ------------------------------------------------------------------
// 在 require pairing.js 之前，把 prisma 替换成空壳，避免连数据库
// ------------------------------------------------------------------
const prismaPath = require.resolve('../src/lib/prisma');
require.cache[prismaPath] = {
  id: prismaPath,
  filename: prismaPath,
  loaded: true,
  exports: {},
  children: [],
  paths: [],
};

const units = require('../src/lib/units');
const fee = require('../src/services/fee');
const { matchFlow, statusOf } = require('../src/services/pairing');

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
    failures.push({ name, actual, expected });
    console.log(`  ✗ ${name}`);
    console.log(`      期望 ${e}`);
    console.log(`      实际 ${a}`);
  }
}

function section(title) {
  console.log('');
  console.log(`── ${title} ${'─'.repeat(Math.max(0, 46 - title.length))}`);
}

/** 元 → 分，方便阅读 */
const y = (cents) => (cents / 100).toFixed(2);
const ym = (mills) => (mills / 1000).toFixed(3);

// ==================================================================
section('1. 单位换算（价格用厘，金额用分）');
// ==================================================================

check('16.101 元 → 16101 厘（3 位小数不丢）', units.yuanToMills(16.101), 16101);
check('0.611 元 → 611 厘（ETF 关键精度）', units.yuanToMills(0.611), 611);
check('0.614 元 → 614 厘', units.yuanToMills(0.614), 614);
check('0.611 与 0.614 的价差 = 3 厘', units.yuanToMills(0.614) - units.yuanToMills(0.611), 3);

// 成交额：0.611 元 × 10000 股 = 6110.00 元 = 611000 分
check('成交额 0.611×10000股 = 611000 分（6110 元）', units.notionalCents(611, 10000), 611000);
// 毛利：0.003 元/股 × 10000 股 = 30.00 元 = 3000 分
check('价差 3 厘 × 10000 股 = 3000 分（30 元）', units.spreadCents(3, 10000), 3000);
// 保本价差反算：61 分 ÷ 10000 股 → 0.061 厘/股
check('61 分 ÷ 10000 股 = 0.061 厘/股', units.centsToSpreadMills(61, 10000), 0.061);

// 成本冲减：原成本 16.101 元（16101 厘），做T赚 50 元（5000 分），底仓 500 股
// 每股应降 0.10 元 → 16.001 元 = 16001 厘
check('成本冲减 16.101 赚50元/500股 → 16.001 元', units.reduceCostMills(16101, 500, 5000), 16001);

// ==================================================================
section('2. 费率引擎 · 股票（万0.74 免五 / 印花税0.05% / 过户费0.001%）');
// ==================================================================

const stockParams = fee.feeParamsFromSettings({
  stockCommissionRate: 0.000074,
  stockMinCommissionCents: 0,
  stampTaxRate: 0.0005,
  transferFeeRate: 0.00001,
});

// 华润双鹤：16.101 元 × 500 股 = 8050.50 元 = 805050 分
const sBuy = fee.computeFees({ type: 'STOCK', side: 'BUY', priceMills: 16101, qty: 500, params: stockParams });
check('买入成交额 805050 分（8050.50 元）', sBuy.amountCents, 805050);
check('买入佣金 60 分（805050×0.000074=59.57→60）', sBuy.commissionCents, 60);
check('买入印花税 = 0（只有卖出收）', sBuy.stampTaxCents, 0);
check('买入过户费 8 分（805050×0.00001=8.05）', sBuy.transferFeeCents, 8);
check('买入总费用 68 分', sBuy.totalFeeCents, 68);

const sSell = fee.computeFees({ type: 'STOCK', side: 'SELL', priceMills: 16101, qty: 500, params: stockParams });
check('卖出佣金 60 分', sSell.commissionCents, 60);
check('卖出印花税 403 分（805050×0.0005=402.5→403）', sSell.stampTaxCents, 403);
check('卖出总费用 471 分（60+403+8）', sSell.totalFeeCents, 471);

const sBE = fee.breakEvenSpreadMills({ type: 'STOCK', priceMills: 16101, qty: 500, params: stockParams });
check('双边保本价差 10.78 厘/股（即 0.0108 元）', Number(sBE.toFixed(2)), 10.78);

// 合规口径：不足5元按5元收
const complianceParams = fee.feeParamsFromSettings({
  stockCommissionRate: 0.000074,
  stockMinCommissionCents: 0,
  stampTaxRate: 0.0005,
  transferFeeRate: 0.00001,
  complianceMode: true,
});
const cBuy = fee.computeFees({ type: 'STOCK', side: 'BUY', priceMills: 16101, qty: 500, params: complianceParams });
check('合规口径下佣金被抬到 500 分（5 元）', cBuy.commissionCents, 500);

// ==================================================================
section('3. 费率引擎 · ETF（万0.5，免印花税、免过户费）');
// ==================================================================

const etfParams = fee.feeParamsFromSettings({
  etfCommissionRate: 0.00005,
  etfMinCommissionCents: 0,
});

// 0.611 元 × 10000 股 = 6110.00 元
const eBuy = fee.computeFees({ type: 'ETF', side: 'BUY', priceMills: 611, qty: 10000, params: etfParams });
check('ETF 买入成交额 611000 分（6110 元）', eBuy.amountCents, 611000);
check('ETF 佣金 31 分（611000×0.00005=30.55→31）', eBuy.commissionCents, 31);
check('ETF 买入印花税 = 0', eBuy.stampTaxCents, 0);
check('ETF 买入过户费 = 0', eBuy.transferFeeCents, 0);

const eSell = fee.computeFees({ type: 'ETF', side: 'SELL', priceMills: 614, qty: 10000, params: etfParams });
check('ETF 卖出佣金 31 分', eSell.commissionCents, 31);
check('ETF 卖出印花税 = 0（与股票的关键差异）', eSell.stampTaxCents, 0);

// ==================================================================
section('4. ★核心回归：ETF 做T收益必须算得对');
// ==================================================================

// 场景：0.611 买入 10000 股 → 0.614 卖出 10000 股
const p = fee.previewHedge({
  type: 'ETF',
  buyPriceMills: units.yuanToMills(0.611),
  sellPriceMills: units.yuanToMills(0.614),
  qty: 10000,
  params: etfParams,
});

check('价差 = 3 厘（0.003 元）', p.spreadMills, 3);
check('毛利 = 3000 分（30.00 元）', p.grossCents, 3000);
check('双边费用 = 62 分（0.62 元）', p.feeCents, 62);
check('净收益 = 2938 分（29.38 元）', p.netCents, 2938);
check('判定为可做（价差 > 保本价差）', p.profitable, true);
check('保本价差 0.062 厘/股（0.000062 元，远小于 1 格）', Number(p.breakEvenMills.toFixed(3)), 0.062);

// ---- 反向证明：若价格误用「分」存储会发生什么 ----
const wrongBuy = Math.round(0.611 * 100); // 61 分
const wrongSell = Math.round(0.614 * 100); // 61 分
const wrongGross = (wrongSell - wrongBuy) * 10000;
check('【反证】若用「分」存价格：毛利变 0 分', wrongGross, 0);
check('【反证】若用「分」存价格：净收益变 -62 分（把赚29.38元算成亏0.62元）', wrongGross - 62, -62);

// 亏损场景：0.614 买 → 0.611 卖
const lossPreview = fee.previewHedge({
  type: 'ETF',
  buyPriceMills: units.yuanToMills(0.614),
  sellPriceMills: units.yuanToMills(0.611),
  qty: 10000,
  params: etfParams,
});
check('亏损场景净收益 = -3062 分（-30.62 元）', lossPreview.netCents, -3062);
check('亏损场景判定为不可做', lossPreview.profitable, false);

// ★重要结论：在「免五」费率下，ETF 只要跳动 1 格（0.001 元）就已经是赚的
const edgeEtf = fee.previewHedge({
  type: 'ETF', buyPriceMills: 611, sellPriceMills: 612, qty: 1000, params: etfParams,
});
check('免五 ETF：跳 1 格即盈利，profitable = true', edgeEtf.profitable, true);
// 毛利 = 1 厘 × 1000 股 = 100 分；双边佣金 = 3 + 3 = 6 分 → 净 94 分
check('免五 ETF：1000 股跳 1 格净赚 94 分（0.94 元）', edgeEtf.netCents, 94);

// 对比：若失去「免五」（合规口径 5 元最低佣金），同样一笔会变成亏
const edgeStock = fee.previewHedge({
  type: 'STOCK',
  buyPriceMills: 10000,   // 10.000 元
  sellPriceMills: 10001,  // 10.001 元，跳 1 厘
  qty: 1000,
  params: complianceParams,
});
check('有 5 元最低佣金时：1000 股股票保本价差 = 15.2 厘（0.0152 元）',
  Number(edgeStock.breakEvenMills.toFixed(1)), 15.2);
check('有 5 元最低佣金时：跳 1 厘 < 保本价差 → profitable = false', edgeStock.profitable, false);
// 毛利 100 分；双边费用 = 买(500+0+10) + 卖(500+500+10) = 1520 分 → 净 -1420 分
check('有 5 元最低佣金时：该笔实际亏损 1420 分（-14.20 元）', edgeStock.netCents, -1420);
check('★对比：同样跳 1 格，免五 ETF 赚 94 分，非免五股票亏 1420 分（差 15 倍）',
  edgeEtf.netCents - edgeStock.netCents, 1514);

// ==================================================================
section('5. 对冲配对结算（内存模拟，验证 FIFO 与成本冲减）');
// ==================================================================

/** 造一个内存版 Prisma 事务客户端 */
function makeTx(seedFlows = []) {
  const state = {
    flows: [...seedFlows],
    pairs: [],
    positions: [],
    seq: 0,
  };
  const matchWhere = (f, where) => {
    if (where.userId && f.userId !== where.userId) return false;
    if (where.code && f.code !== where.code) return false;
    if (where.side && f.side !== where.side) return false;
    if (where.remainingQty?.gt != null && !(f.remainingQty > where.remainingQty.gt)) return false;
    if (where.id?.not && f.id === where.id.not) return false;
    return true;
  };
  return {
    state,
    tradeFlow: {
      async findMany({ where }) {
        return state.flows
          .filter((f) => matchWhere(f, where))
          .sort((a, b) => a.tradedAt - b.tradedAt);
      },
      async create({ data }) {
        state.seq += 1;
        const f = { id: `flow_${state.seq}`, ...data };
        state.flows.push(f);
        return f;
      },
      async update({ where, data }) {
        const f = state.flows.find((x) => x.id === where.id);
        Object.assign(f, data);
        return f;
      },
      async findUnique({ where }) {
        return state.flows.find((x) => x.id === where.id) || null;
      },
    },
    hedgePair: {
      async create({ data }) {
        state.seq += 1;
        const p2 = { id: `pair_${state.seq}`, ...data };
        state.pairs.push(p2);
        return p2;
      },
      async findMany() { return state.pairs; },
      async delete({ where }) {
        const i = state.pairs.findIndex((x) => x.id === where.id);
        if (i >= 0) state.pairs.splice(i, 1);
      },
    },
    position: {
      async findUnique({ where }) {
        const k = where.userId_code;
        return state.positions.find((x) => x.userId === k.userId && x.code === k.code) || null;
      },
      async update({ where, data }) {
        const pos = state.positions.find((x) => x.id === where.id);
        Object.assign(pos, data);
        return pos;
      },
    },
  };
}

async function runPairingTests() {
  const now = new Date('2026-10-08T10:00:00+08:00');
  const later = new Date('2026-10-08T14:30:00+08:00');

  // 建仓：底仓 10000 股，成本 0.611 元
  const tx = makeTx();
  tx.state.positions.push({
    id: 'pos1',
    userId: 'u1',
    code: '159399',
    baseQty: 10000,
    availableQty: 10000,
    costPriceMills: 611,
    initialCostMills: 611,
    realizedProfitCents: 0,
  });

  // 先买 10000 股 @0.611
  const buyFee = fee.computeFees({ type: 'ETF', side: 'BUY', priceMills: 611, qty: 10000, params: etfParams });
  const buyFlow = await tx.tradeFlow.create({
    data: {
      userId: 'u1', code: '159399', side: 'BUY',
      priceMills: 611, qty: 10000, remainingQty: 10000,
      amountCents: buyFee.amountCents, commissionCents: buyFee.commissionCents,
      stampTaxCents: buyFee.stampTaxCents, transferFeeCents: buyFee.transferFeeCents,
      totalFeeCents: buyFee.totalFeeCents,
      tradedAt: now, status: 'PENDING',
    },
  });
  const pairsAfterBuy = await matchFlow(tx, buyFlow, etfParams);
  check('只买未卖时不产生配对', pairsAfterBuy.length, 0);
  check('买单进入挂单池（remainingQty 保持不变）', buyFlow.remainingQty, 10000);
  check('买单状态为 PENDING', statusOf(buyFlow.remainingQty, buyFlow.qty), 'PENDING');

  // 再卖 10000 股 @0.614
  const sellFee = fee.computeFees({ type: 'ETF', side: 'SELL', priceMills: 614, qty: 10000, params: etfParams });
  const sellFlow = await tx.tradeFlow.create({
    data: {
      userId: 'u1', code: '159399', side: 'SELL',
      priceMills: 614, qty: 10000, remainingQty: 10000,
      amountCents: sellFee.amountCents, commissionCents: sellFee.commissionCents,
      stampTaxCents: sellFee.stampTaxCents, transferFeeCents: sellFee.transferFeeCents,
      totalFeeCents: sellFee.totalFeeCents,
      tradedAt: later, status: 'PENDING',
    },
  });
  const pairs = await matchFlow(tx, sellFlow, etfParams);

  check('卖出后生成 1 组配对', pairs.length, 1);
  check('配对股数 = 10000', pairs[0].qty, 10000);
  check('配对买价 = 611 厘', pairs[0].buyPriceMills, 611);
  check('配对卖价 = 614 厘', pairs[0].sellPriceMills, 614);
  check('配对毛利 = 3000 分', pairs[0].grossProfitCents, 3000);
  check('配对净收益 = 2938 分', pairs[0].netProfitCents, 2938);
  check('收益归属对冲日 = 较晚那笔（14:30）', pairs[0].hedgeDate.getTime(), later.getTime());
  check('开仓日 = 较早那笔（10:00）', pairs[0].openDate.getTime(), now.getTime());
  check('买卖两条流水都被清空余额', [buyFlow.remainingQty, sellFlow.remainingQty], [0, 0]);
  check('流水状态更新为 MATCHED', [buyFlow.status, sellFlow.status], ['MATCHED', 'MATCHED']);

  // 成本冲减：0.611 元赚 29.38 元 / 10000 股 → 每股降 0.002938 元 → 608 厘
  const pos = tx.state.positions[0];
  check('底仓成本价被冲减到 608 厘（0.608 元）', pos.costPriceMills, 608);
  check('累计做T收益累计到 2938 分', pos.realizedProfitCents, 2938);

  // ---------- 部分配对 ----------
  const tx2 = makeTx();
  tx2.state.positions.push({
    id: 'pos2', userId: 'u1', code: '562080', baseQty: 30000, availableQty: 30000,
    costPriceMills: 680, initialCostMills: 680, realizedProfitCents: 0,
  });
  const b2 = await tx2.tradeFlow.create({
    data: {
      userId: 'u1', code: '562080', side: 'BUY', priceMills: 680, qty: 10000, remainingQty: 10000,
      totalFeeCents: 40, tradedAt: now, status: 'PENDING',
    },
  });
  const s2 = await tx2.tradeFlow.create({
    data: {
      userId: 'u1', code: '562080', side: 'SELL', priceMills: 685, qty: 6000, remainingQty: 6000,
      totalFeeCents: 40, tradedAt: later, status: 'PENDING',
    },
  });
  const p2 = await matchFlow(tx2, s2, etfParams);
  check('部分配对：买 10000 / 卖 6000 → 只配 6000', p2[0].qty, 6000);
  check('买单剩余 4000 股仍在挂单池', b2.remainingQty, 4000);
  check('买单状态为 PARTIAL', statusOf(b2.remainingQty, b2.qty), 'PARTIAL');
  check('卖单已全部对冲', s2.remainingQty, 0);
  // 价差 5 厘 × 6000 股 = 3000 分；费用按配对比例分摊：40×6000/10000 + 40×6000/6000 = 24 + 40 = 64
  check('部分配对净收益 = 3000 − 64 = 2936 分', p2[0].netProfitCents, 2936);

  // ---------- 倒T：先卖后买（A股股票唯一可行的做T方式）----------
  const tx3 = makeTx();
  tx3.state.positions.push({
    id: 'pos3', userId: 'u1', code: '000100', baseQty: 4000, availableQty: 4000,
    costPriceMills: 3530, initialCostMills: 3530, realizedProfitCents: 0,
  });
  const s3 = await tx3.tradeFlow.create({
    data: {
      userId: 'u1', code: '000100', side: 'SELL', priceMills: 4630, qty: 1000, remainingQty: 1000,
      totalFeeCents: 100, tradedAt: now, status: 'PENDING',
    },
  });
  const b3 = await tx3.tradeFlow.create({
    data: {
      userId: 'u1', code: '000100', side: 'BUY', priceMills: 4580, qty: 1000, remainingQty: 1000,
      totalFeeCents: 100, tradedAt: later, status: 'PENDING',
    },
  });
  const p3 = await matchFlow(tx3, b3, stockParams);
  check('倒T（先卖后买）也能正确配对', p3.length, 1);
  check('倒T 买价取较低的那笔 = 4580 厘', p3[0].buyPriceMills, 4580);
  check('倒T 卖价取较高的那笔 = 4630 厘', p3[0].sellPriceMills, 4630);
  check('倒T 毛利 = 5 分/股 × 1000 = 5000 分', p3[0].grossProfitCents, 5000);
  check('倒T 净收益 = 5000 − 200 = 4800 分', p3[0].netProfitCents, 4800);

  console.log('');
  console.log('  —— 配对测试内部字段：');
  console.log(`     成本冲减后 ${ym(pos.costPriceMills)} 元（原 0.611 元）`);
  console.log(`     部分配对分摊费用 ${p2[0].totalFeeCents} 分`);
}

// ==================================================================
(async () => {
  await runPairingTests();

  section('结果汇总');
  console.log(`  通过 ${pass} 项，失败 ${fail} 项`);
  if (fail > 0) {
    console.log('');
    console.log('  失败明细：');
    for (const f of failures) {
      console.log(`   · ${f.name}`);
      console.log(`     期望 ${JSON.stringify(f.expected)} / 实际 ${JSON.stringify(f.actual)}`);
    }
    process.exit(1);
  }
  console.log('');
  console.log('  全部通过 ✅');
})();
