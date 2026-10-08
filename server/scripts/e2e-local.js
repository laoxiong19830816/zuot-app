/**
 * 本地后端端到端自检（不需要 Postgres，直接连本机 8080）
 * 用法：先启动服务（sh 启动服务.sh），再执行 node scripts/e2e-local.js
 *
 * 走一遍真实链路：健康检查 → 注册 → 录持仓 → 交易预演 → 记买入/卖出
 *                → 看对冲结算 → 看统计 → 看风控，确认数据正确落盘。
 */

const http = require('http');
const path = require('path');

// 读取 .env：自检默认用管理员账号（服务首次启动会自动创建）
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const HOST = process.env.E2E_HOST || '127.0.0.1';
const PORT = Number(process.env.E2E_PORT || process.env.PORT || 8080);
const EMAIL = process.env.E2E_EMAIL || process.env.ADMIN_EMAIL || 'admin@zuot.local';
const PASSWORD = process.env.E2E_PASSWORD || process.env.ADMIN_PASSWORD || 'change_me_admin_pwd';

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
    console.log(`  ✗ ${name}\n      期望 ${e}\n      实际 ${a}`);
  }
}

function section(t) {
  console.log('');
  console.log(`── ${t} ${'─'.repeat(Math.max(0, 46 - t.length))}`);
}

let token = null;

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request(
      {
        host: HOST,
        port: PORT,
        method,
        path,
        headers: {
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = raw ? JSON.parse(raw) : null;
          } catch (_) {
            parsed = raw;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  console.log('');
  console.log('做T管家 · 本地后端端到端自检');
  console.log(`目标：http://${HOST}:${PORT}`);

  // ================================================================
  section('1. 健康检查');
  // ================================================================
  let health;
  try {
    health = await request('GET', '/health');
  } catch (e) {
    console.log(`  ✗ 连不上服务：${e.message}`);
    console.log('');
    console.log('  请先启动后端：sh 启动服务.sh');
    process.exit(1);
  }
  check('服务在线（HTTP 200）', health.status, 200);
  check('返回业务码 0', health.body.code, 0);
  check('服务名正确', health.body.data.service, 'zuot-server');
  console.log(`   调度器：${health.body.data.scheduler}  豆包密钥已配置：${health.body.data.arkConfigured}`);

  // ================================================================
  section('2. 登录（管理员账号由服务首次启动时自动创建）');
  // ================================================================
  let reg = await request('POST', '/api/auth/login', { email: EMAIL, password: PASSWORD });
  if (!reg.body || reg.body.code !== 0) {
    // 账号不存在时（例如还没初始化）改为注册
    reg = await request('POST', '/api/auth/register', {
      email: EMAIL,
      password: PASSWORD,
      nickname: '自检账号',
    });
  }
  if (!reg.body || reg.body.code !== 0) {
    console.log(`  ✗ 登录失败：${reg.body && reg.body.message}`);
    console.log('');
    console.log('  自检需要用到管理员账号，请确认 .env 里的 ADMIN_EMAIL / ADMIN_PASSWORD 正确。');
    process.exit(1);
  }
  check('拿到登录态（HTTP 200）', reg.status, 200);
  check('业务码 0', reg.body.code, 0);
  token = reg.body.data && reg.body.data.token;
  check('token 非空', typeof token === 'string' && token.length > 20, true);
  check('返回用户信息', !!(reg.body.data.user && reg.body.data.user.id), true);

  const me = await request('GET', '/api/auth/me');
  check('带 token 能取到自己的资料', me.body.code, 0);

  // 接口隔离：不带 token 必须被拒
  const savedToken = token;
  token = null;
  const noAuth = await request('GET', '/api/positions');
  check('不带 token 被拒绝（401）', noAuth.status, 401);
  token = savedToken;

  // ================================================================
  section('3. 录入持仓');
  // ================================================================
  const CODE = process.env.E2E_CODE || '510300';
  const posListBefore = await request('GET', '/api/positions');
  const existed = (posListBefore.body.data || []).some((p) => p.code === CODE);
  if (!existed) {
    const created = await request('POST', '/api/positions', {
      code: CODE,
      name: '沪深300ETF',
      type: 'ETF',
      baseQty: 100000,
      availableQty: 100000,
      costPrice: 3.85,
      initialCost: 3.85,
    });
    check('新增持仓成功', created.body.code, 0);
  } else {
    console.log('   （该标的已存在，跳过新增）');
  }
  const posList = await request('GET', '/api/positions');
  const pos = (posList.body.data || []).find((p) => p.code === CODE);
  check('持仓列表能查到该标的', !!pos, true);
  if (!existed) {
    check('成本价按「厘」返回（3.85 元 = 3850 厘）', pos && pos.costPriceMills, 3850);
  } else {
    // 已跑过一次 ⇒ 成本已被做T净收益冲减（业务预期行为），只会比初始价低一点
    const cm = pos ? pos.costPriceMills : 0;
    check('重跑时成本价已被做T收益冲减（3840~3850 厘）', cm >= 3840 && cm <= 3850, true);
    console.log(`   当前成本价：${(cm / 1000).toFixed(3)} 元（初始 3.850 元）`);
  }

  // ================================================================
  section('4. 交易预演（不落库）');
  // ================================================================
  const preview = await request('POST', '/api/trades/preview', {
    code: CODE,
    side: 'BUY',
    price: 3.85,
    qty: 10000,
  });
  check('预演成功', preview.body.code, 0);
  const pv = preview.body.data || {};
  console.log(`   预演费用合计：${((pv.totalFeeCents || 0) / 100).toFixed(2)} 元`);
  check('ETF 不收印花税', pv.stampTaxCents, 0);
  check('ETF 不收过户费', pv.transferFeeCents, 0);
  check('佣金 > 0（万0.5）', (pv.commissionCents || 0) > 0, true);

  // ================================================================
  section('5. 记一笔买入 + 一笔卖出（触发 FIFO 对冲结算）');
  // ================================================================
  const buyPrice = 3.85;
  const sellPrice = 3.856;
  const qty = 10000;
  const today = new Date();
  const t1 = new Date(today.getTime() - 3600 * 1000).toISOString();
  const t2 = new Date(today.getTime() - 60 * 1000).toISOString();

  const buy = await request('POST', '/api/trades', {
    code: CODE,
    side: 'BUY',
    price: buyPrice,
    qty,
    tradedAt: t1,
    note: '端到端自检-买入',
  });
  check('买入记账成功', buy.body.code, 0);
  const buyFlow = buy.body.data && buy.body.data.flow;
  check('买入流水剩余量 = 股数（成为未对冲挂单）', buyFlow && buyFlow.remainingQty, qty);
  check('买入 0 组配对', buy.body.data && buy.body.data.pairCount, 0);

  const sell = await request('POST', '/api/trades', {
    code: CODE,
    side: 'SELL',
    price: sellPrice,
    qty,
    tradedAt: t2,
    note: '端到端自检-卖出',
  });
  check('卖出记账成功', sell.body.code, 0);
  const sd = sell.body.data || {};
  check('卖出触发 1 组配对', sd.pairCount, 1);
  check('配对数量 = 本次卖出量', sd.pairs && sd.pairs[0] && sd.pairs[0].qty, qty);

  // 手工核算：毛利 = (3.856-3.85)*10000 = 60 元 = 6000 分
  const gross = sd.pairs && sd.pairs[0] && sd.pairs[0].grossProfitCents;
  check('毛利 = 6000 分（60 元）', gross, 6000);

  const net = sd.netProfitCents;
  const fee = sd.pairs && sd.pairs[0] && sd.pairs[0].totalFeeCents;
  console.log(`   双边费用：${(fee / 100).toFixed(2)} 元   净收益：${(net / 100).toFixed(2)} 元`);
  check('净收益 = 毛利 − 双边费用', net, gross - fee);
  check('净收益为正（真实费率下这笔是做T盈利）', net > 0, true);
  // 手工核算（ETF 万0.5、免五、免印花税免过户费）：
  //   买入 3.850×10000 = 38500 元 → 佣金 1.925 元 → 193 分
  //   卖出 3.856×10000 = 38560 元 → 佣金 1.928 元 → 193 分
  //   双边费用 386 分；毛利 6000 分 → 净收益应为 5614 分（56.14 元）
  check('净收益在合理区间（5614 分上下）', net >= 5500 && net <= 5700, true);
  check('费用与手工核算一致（386 分 = 3.86 元）', fee, 386);

  // 卖出后剩余未对冲
  const pending = await request('GET', '/api/trades/pending', {});
  const pendingList = (pending.body.data || []).filter((f) => f.code === CODE);
  check('无残留未对冲挂单（已全部对冲）', pendingList.length, 0);

  // ================================================================
  section('6. 统计与风控接口');
  // ================================================================
  const statsToday = await request('GET', '/api/stats/today');
  check('今日统计接口可用', statsToday.body.code, 0);
  const st = statsToday.body.data || {};
  console.log(`   今日净收益：${((st.netProfitCents || 0) / 100).toFixed(2)} 元  `
    + `配对数：${st.pairCount ?? '-'}  今日流水：${st.flowCount ?? '-'}`);
  check('今日净收益 ≥ 本次配对净收益', (st.netProfitCents || 0) >= net, true);
  check('今日流水数 ≥ 2', (st.flowCount || 0) >= 2, true);

  const pairsRes = await request('GET', '/api/trades/pairs');
  check('配对列表接口可用', pairsRes.body.code, 0);
  check('配对列表里能找到这笔', (pairsRes.body.data || []).some((p) => p.code === CODE), true);

  const overview = await request('GET', '/api/stats/overview');
  check('总览接口可用', overview.body.code, 0);

  const byCode = await request('GET', '/api/stats/by-code');
  check('按标的统计可用', byCode.body.code, 0);
  const bc = (byCode.body.data || []).find((x) => x.code === CODE);
  check('按标的统计包含该标的', !!bc, true);

  const risk = await request('GET', '/api/risk');
  check('风控接口可用', risk.body.code, 0);

  // ================================================================
  section('7. 管理员接口（首注册用户即为管理员）');
  // ================================================================
  const users = await request('GET', '/api/admin/users');
  check('用户列表可用（管理员权限正常）', users.body.code, 0);

  const codes = await request('POST', '/api/admin/invite-codes', { count: 2, maxUses: 1, days: 30, note: '自检' });
  check('生成邀请码成功', codes.body.code, 0);
  const listCodes = await request('GET', '/api/admin/invite-codes');
  check('邀请码列表可用', listCodes.body.code, 0);

  const adminOverview = await request('GET', '/api/admin/overview');
  check('系统概览可用', adminOverview.body.code, 0);

  // ================================================================
  const total = pass + fail;
  console.log('');
  console.log('─'.repeat(52));
  console.log(`  通过 ${pass}/${total} 项`);
  if (fail) {
    console.log('');
    console.log('  失败明细：');
    failures.forEach((f) => console.log(`   · ${f.name}\n     期望 ${f.expected}\n     实际 ${f.actual}`));
    process.exit(1);
  }
  console.log('  ✅ 后端全链路正常（登录 / 持仓 / 交易 / 对冲结算 / 统计 / 风控 / 管理）');
  console.log('─'.repeat(52));
  console.log('');
})().catch((e) => {
  console.error('自检异常：', e);
  process.exit(1);
});
