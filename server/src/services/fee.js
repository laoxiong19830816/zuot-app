/**
 * 费率引擎
 * 口径（2026 现行，按你的真实费率）：
 *   股票：佣金万 0.74，免五；印花税卖出 0.05%；过户费双向 0.001%
 *   ETF ：佣金万 0.5 ，免五；免印花税；免过户费
 *
 * 单位约定（详见 lib/units.js）：
 *   价格入参 = 厘（0.001 元）—— ETF 报价精度为 0.001 元，用「分」会算错
 *   金额出参 = 分（0.01 元）
 */

const { notionalCents, spreadCents, centsToSpreadMills } = require('../lib/units');

/**
 * 从用户设置取费率参数
 * complianceMode = true 时，最低佣金按监管口径 5 元（500 分）计算，用于成本对比
 */
function feeParamsFromSettings(settings) {
  const compliance = !!settings?.complianceMode;
  const s = settings || {};
  return {
    STOCK: {
      commissionRate: Number(s.stockCommissionRate ?? 0.000074),
      minCommissionCents: compliance
        ? Math.max(Number(s.stockMinCommissionCents ?? 0), 500)
        : Number(s.stockMinCommissionCents ?? 0),
      stampTaxRate: Number(s.stampTaxRate ?? 0.0005),
      transferFeeRate: Number(s.transferFeeRate ?? 0.00001),
    },
    ETF: {
      commissionRate: Number(s.etfCommissionRate ?? 0.00005),
      minCommissionCents: compliance
        ? Math.max(Number(s.etfMinCommissionCents ?? 0), 500)
        : Number(s.etfMinCommissionCents ?? 0),
      stampTaxRate: 0,
      transferFeeRate: 0,
    },
  };
}

/**
 * 计算单笔交易费用
 * @param {Object} args
 * @param {'STOCK'|'ETF'} args.type
 * @param {'BUY'|'SELL'} args.side
 * @param {number} args.priceMills 成交单价（厘，0.001 元）
 * @param {number} args.qty 股数
 * @param {Object} args.params feeParamsFromSettings 的返回值
 */
function computeFees({ type, side, priceMills, qty, params }) {
  const p = params[type] || params.STOCK;
  const amountCents = notionalCents(priceMills, qty);

  // 佣金：按成交额比例，与最低佣金取大者（免五时最低为 0）
  const commissionCents = Math.max(
    Math.round(amountCents * p.commissionRate),
    p.minCommissionCents
  );
  // 印花税：仅卖出收取；ETF 为 0
  const stampTaxCents = side === 'SELL' ? Math.round(amountCents * p.stampTaxRate) : 0;
  // 过户费：双向收取；ETF 为 0
  const transferFeeCents = Math.round(amountCents * p.transferFeeRate);

  const totalFeeCents = commissionCents + stampTaxCents + transferFeeCents;

  return {
    amountCents,
    commissionCents,
    stampTaxCents,
    transferFeeCents,
    totalFeeCents,
  };
}

/**
 * 保本价差（厘/股）：低于这个价差，做T必亏
 * 口径 = 双边总费用 ÷ 股数，返回值单位「厘」，可带小数
 * 例：10000 股 ETF，双边费用 61 分 → 0.061 厘/股（即 0.000061 元/股）
 */
function breakEvenSpreadMills({ type, priceMills, qty, params }) {
  const buy = computeFees({ type, side: 'BUY', priceMills, qty, params });
  const sell = computeFees({ type, side: 'SELL', priceMills, qty, params });
  return centsToSpreadMills(buy.totalFeeCents + sell.totalFeeCents, qty);
}

/**
 * 预演一次对冲的净收益（快速记账页实时显示用）
 * @returns {{grossCents:number, feeCents:number, netCents:number, breakEvenMills:number,
 *            spreadMills:number, profitable:boolean, returnRate:number}}
 */
function previewHedge({ type, buyPriceMills, sellPriceMills, qty, params }) {
  const buy = computeFees({ type, side: 'BUY', priceMills: buyPriceMills, qty, params });
  const sell = computeFees({ type, side: 'SELL', priceMills: sellPriceMills, qty, params });

  const spreadMills = Number(sellPriceMills) - Number(buyPriceMills);
  const grossCents = spreadCents(spreadMills, qty);
  const feeCents = buy.totalFeeCents + sell.totalFeeCents;
  const netCents = grossCents - feeCents;
  const breakEvenMills = centsToSpreadMills(feeCents, qty);
  const costCents = buy.amountCents;

  return {
    grossCents,
    feeCents,
    netCents,
    spreadMills,
    breakEvenMills,
    // 价差必须严格大于保本价差，才是真赚钱
    profitable: spreadMills > breakEvenMills,
    // 收益率口径：净收益 ÷ 买入成本
    returnRate: costCents > 0 ? netCents / costCents : 0,
  };
}

module.exports = {
  feeParamsFromSettings,
  computeFees,
  breakEvenSpreadMills,
  previewHedge,
};
