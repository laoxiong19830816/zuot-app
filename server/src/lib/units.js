/**
 * 单位换算中心 —— 全系统只在这里做单位转换，其他地方禁止手写 /100 或 *100
 *
 * 【为什么价格不能用「分」】
 * 股票报价最小变动 0.01 元，但 **场内 ETF / LOF / 可转债最小变动是 0.001 元**。
 * 若价格用「分」存：ETF 买 0.611 元、卖 0.614 元，都会被四舍五入成 61 分，
 * 价差变成 0 —— 做T毛利直接算成 0，只剩费用亏损，账全废。
 * 因此：**价格单位 = 厘（0.001 元）**。
 *
 * 【单位约定】
 *   价格 priceMills ：厘（milli-yuan），1 元 = 1000 厘
 *   金额 *Cents     ：分（cent）     ，1 元 = 100 分
 *   1 分 = 10 厘
 */

const MILLS_PER_YUAN = 1000;
const CENTS_PER_YUAN = 100;
const MILLS_PER_CENT = 10;

/** 元 → 厘（用户输入解析，保留 0.001 元精度） */
function yuanToMills(yuan) {
  return Math.round(Number(yuan) * MILLS_PER_YUAN);
}

/** 元 → 分（金额类输入解析） */
function yuanToCents(yuan) {
  return Math.round(Number(yuan) * CENTS_PER_YUAN);
}

/** 厘 → 元（数值，用于计算） */
function millsToYuan(mills) {
  return Number(mills) / MILLS_PER_YUAN;
}

/** 厘 → 元（字符串，默认 3 位小数，ETF 也能正确显示） */
function fmtMills(mills, digits = 3) {
  if (mills == null) return '';
  return (Number(mills) / MILLS_PER_YUAN).toFixed(digits);
}

/** 分 → 元（字符串，2 位小数） */
function fmtCents(cents, digits = 2) {
  if (cents == null) return '';
  return (Number(cents) / CENTS_PER_YUAN).toFixed(digits);
}

/**
 * 成交额：价格(厘) × 股数 → 金额(分)
 * 例：0.611 元 × 10000 股 = 6110 元 = 611000 分
 */
function notionalCents(priceMills, qty) {
  return Math.round((Number(priceMills) * Number(qty)) / MILLS_PER_CENT);
}

/**
 * 价差盈亏：价差(厘) × 股数 → 金额(分)
 * 例：0.003 元/股 × 10000 股 = 30 元 = 3000 分
 */
function spreadCents(priceSpreadMills, qty) {
  return Math.round((Number(priceSpreadMills) * Number(qty)) / MILLS_PER_CENT);
}

/**
 * 反算价差：金额(分) ÷ 股数 → 价差(厘，可为小数)
 * 用于「保本价差」：双边费用 ÷ 股数
 */
function centsToSpreadMills(cents, qty) {
  if (!qty || qty <= 0) return 0;
  return (Number(cents) * MILLS_PER_CENT) / Number(qty);
}

/**
 * 成本价冲减（价格口径，单位厘，四舍五入到整厘）
 * 新成本价 = (旧成本价 × 股数 − 做T累计净收益) ÷ 股数
 * 注意：分子里「金额(分)」必须先换算成「价格(厘) × 股数」的口径，即 × 10
 */
function reduceCostMills(costMills, qty, netProfitCents) {
  if (!qty || qty <= 0) return Number(costMills) || 0;
  const costValueMills = (Number(costMills) || 0) * qty;
  const profitAsMills = (Number(netProfitCents) || 0) * MILLS_PER_CENT; // 分 → 厘·股
  return Math.round((costValueMills - profitAsMills) / qty);
}

module.exports = {
  MILLS_PER_YUAN,
  CENTS_PER_YUAN,
  MILLS_PER_CENT,
  yuanToMills,
  yuanToCents,
  millsToYuan,
  fmtMills,
  fmtCents,
  notionalCents,
  spreadCents,
  centsToSpreadMills,
  reduceCostMills,
};
