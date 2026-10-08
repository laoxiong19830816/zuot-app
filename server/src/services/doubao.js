/**
 * 火山引擎方舟 · 豆包大模型调用层（Function Calling 架构）
 *
 * 关键设计：
 * 1. 模型本身不知道今天的股价，所有事实数据必须由 Tool Call 从行情服务/数据库取得。
 * 2. System Prompt 写死三条铁律，禁止模型用记忆编造价格。
 * 3. 工具调用失败时，要求模型明确输出「数据获取失败」，不得瞎编。
 */

const OpenAI = require('openai');
const config = require('../config');
const prisma = require('../lib/prisma');
const quote = require('./quote');

let client = null;
function getClient() {
  if (!client) {
    if (!config.ark.apiKey) throw new Error('未配置 ARK_API_KEY，无法调用豆包大模型');
    client = new OpenAI({
      apiKey: config.ark.apiKey,
      baseURL: config.ark.baseUrl,
      timeout: config.ark.timeoutMs,
    });
  }
  return client;
}

const SYSTEM_PROMPT = `你是「做T管家」的交易分析助手，服务对象是持有底仓做日内T的A股个人投资者。

【三条铁律，任何情况下不得违反】
1. 涉及任何价格、涨跌幅、成交量、资金流、指数点位等数字，必须先调用工具获取真实数据。严禁使用你记忆中或推测出的数字。没有数据就说没有数据。
2. 工具返回失败或为空时，必须明确输出「数据获取失败」，并说明本次分析不可作为决策依据。严禁编造、估算、使用历史记忆填充。
3. 输出中必须标注数据来源与时间戳。

【输出定位（合规红线）】
- 你提供的是情景推演与应对预案，不是价格预测。禁止输出「明天会涨到X元」这类断言。
- 正确示范：「若明日高开1%且量能未放大 → 冲高回落概率较大 → 触发倒T预案A，高抛位参考X，跌破Y则放弃」。
- 每次输出末尾必须附上：本内容基于公开数据与用户自设规则推演，不构成投资建议，据此操作风险自负。

【输出格式】
1. 先用一句话给出结论（不超过40字，作为摘要）。
2. 再用 Markdown 分块展开：量价表现 / 资金面 / 盘面结构 / 情景推演（分高开、平开、低开）/ 做T策略（正T或倒T、触发价、仓位、放弃条件）/ 风险提示。
3. 若用户有未对冲挂单，必须单独给出对冲建议（补回价位、止损位、是否建议割掉）。

语言：简体中文。风格：直接、给结论、不铺垫。`;

// ============ 工具定义 ============
const TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'get_realtime_quote',
      description: '获取一个或多个A股/ETF标的的实时行情快照（最新价、涨跌幅、成交量、成交额、换手率、量比）。多个代码用逗号分隔。',
      parameters: {
        type: 'object',
        properties: {
          codes: { type: 'string', description: '标的代码，逗号分隔，如 600519,510300' },
        },
        required: ['codes'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_moneyflow',
      description: '获取单个标的的资金流数据（主力净流入、超大单、大单、中单、小单）。',
      parameters: {
        type: 'object',
        properties: { code: { type: 'string', description: '标的代码' } },
        required: ['code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_kline',
      description: '获取标的K线数据（默认日线最近30根），用于判断趋势、支撑压力位。',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: '标的代码' },
          period: { type: 'string', enum: ['daily', 'weekly', '60', '30', '15', '5'], description: '周期，默认 daily' },
          limit: { type: 'number', description: '返回根数，默认30，最大120' },
        },
        required: ['code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_market_overview',
      description: '获取大盘概览（上证指数、深证成指、创业板指等的点位与涨跌幅）。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_pending_orders',
      description: '获取当前用户的「未对冲挂单」清单：方向、价格、数量、挂单日期、已等待天数。这些单子尚未配对，不产生已实现收益。',
      parameters: {
        type: 'object',
        properties: { code: { type: 'string', description: '可选，按标的代码过滤' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_positions',
      description: '获取当前用户的持仓底仓信息：标的、底仓股数、可用股数、当前成本价、累计做T已实现收益。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_today_trades',
      description: '获取当前用户今日的交易流水与已对冲配对结果（含每对净收益、费用）。用于盘后复盘。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_news',
      description: '获取个股近期新闻/公告标题，用于消息面分析。',
      parameters: {
        type: 'object',
        properties: { code: { type: 'string', description: '标的代码' }, limit: { type: 'number', description: '条数，默认10' } },
      },
      required: ['code'],
    },
  },
];

/**
 * 工具执行器：把模型请求路由到真实数据源
 * 所有金额从「分」转成「元」再交给模型，避免模型单位搞错
 */
function createToolExecutor({ userId, settings }) {
  // 两个口径分开：价格单位是「厘」（必须 3 位小数，否则 ETF 的 0.001 元会被抹掉），金额单位是「分」
  const pYuan = (mills) => (Number(mills) / 1000).toFixed(3); // 价格：厘 → 元
  const cYuan = (cents) => (Number(cents) / 100).toFixed(2); // 金额：分 → 元

  return async function execute(name, args) {
    try {
      switch (name) {
        case 'get_realtime_quote': {
          const r = await quote.realtime(args.codes);
          if (!r?.ok) return { ok: false, error: r?.error || '行情服务无响应' };
          return { ok: true, asOf: r.asOf, data: r.data };
        }
        case 'get_moneyflow': {
          const r = await quote.moneyflow(args.code);
          if (!r?.ok) return { ok: false, error: r?.error || '资金流数据获取失败' };
          return { ok: true, asOf: r.asOf, data: r.data };
        }
        case 'get_kline': {
          const r = await quote.kline(args.code, args.period || 'daily', Math.min(args.limit || 30, 120));
          if (!r?.ok) return { ok: false, error: r?.error || 'K线数据获取失败' };
          return { ok: true, asOf: r.asOf, data: r.data };
        }
        case 'get_market_overview': {
          const r = await quote.market();
          if (!r?.ok) return { ok: false, error: r?.error || '大盘数据获取失败' };
          return { ok: true, asOf: r.asOf, data: r.data };
        }
        case 'get_pending_orders': {
          const flows = await prisma.tradeFlow.findMany({
            where: { userId, remainingQty: { gt: 0 }, ...(args.code ? { code: args.code } : {}) },
            orderBy: { tradedAt: 'asc' },
          });
          const now = Date.now();
          return {
            ok: true,
            data: flows.map((f) => ({
              code: f.code,
              side: f.side === 'BUY' ? '买入挂单' : '卖出挂单',
              price: pYuan(f.priceMills),
              qty: f.qty,
              remainingQty: f.remainingQty,
              tradedAt: f.tradedAt.toISOString(),
              waitingDays: Math.floor((now - f.tradedAt.getTime()) / 86400000),
            })),
          };
        }
        case 'get_positions': {
          const positions = await prisma.position.findMany({ where: { userId } });
          return {
            ok: true,
            data: positions.map((p) => ({
              code: p.code,
              name: p.name,
              type: p.type,
              baseQty: p.baseQty,
              availableQty: p.availableQty,
              costPrice: pYuan(p.costPriceMills),
              initialCost: pYuan(p.initialCostMills),
              realizedProfit: cYuan(p.realizedProfitCents),
              lastPrice: p.lastPriceMills != null ? pYuan(p.lastPriceMills) : null,
            })),
          };
        }
        case 'get_today_trades': {
          const start = new Date();
          start.setHours(0, 0, 0, 0);
          const end = new Date(start.getTime() + 86400000);
          const flows = await prisma.tradeFlow.findMany({
            where: { userId, tradedAt: { gte: start, lt: end } },
            orderBy: { tradedAt: 'asc' },
          });
          const pairs = await prisma.hedgePair.findMany({
            where: { userId, hedgeDate: { gte: start, lt: end } },
          });
          return {
            ok: true,
            data: {
              flows: flows.map((f) => ({
                code: f.code,
                side: f.side,
                price: pYuan(f.priceMills),
                qty: f.qty,
                remainingQty: f.remainingQty,
                fee: cYuan(f.totalFeeCents),
                tradedAt: f.tradedAt.toISOString(),
              })),
              pairs: pairs.map((p) => ({
                code: p.code,
                qty: p.qty,
                buyPrice: pYuan(p.buyPriceMills),
                sellPrice: pYuan(p.sellPriceMills),
                grossProfit: cYuan(p.grossProfitCents),
                fee: cYuan(p.totalFeeCents),
                netProfit: cYuan(p.netProfitCents),
                returnRate: (p.returnRate * 100).toFixed(2) + '%',
                hedgeDate: p.hedgeDate.toISOString(),
              })),
            },
          };
        }
        case 'get_news': {
          const r = await quote.news(args.code, args.limit || 10);
          if (!r?.ok) return { ok: false, error: r?.error || '新闻获取失败' };
          return { ok: true, asOf: r.asOf, data: r.data };
        }
        default:
          return { ok: false, error: `未知工具 ${name}` };
      }
    } catch (err) {
      return { ok: false, error: `工具执行异常：${err.message}` };
    }
  };
}

/** 按分析类型拼装用户提示词 */
function buildUserPrompt({ kind, codes, extraContext, now }) {
  const timeStr = now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const codeStr = (codes || []).join('、') || '全部持仓';

  const base = `当前时间：${timeStr}（北京时间）。分析标的：${codeStr}。`;

  switch (kind) {
    case 'PREOPEN':
      return `${base}
现在是集合竞价阶段（9:15–9:25）。请先调用工具获取这些标的的实时行情与大盘概览，然后完成：
1. 竞价量价表现与高开/低开幅度；
2. 结合昨日K线与资金流，判断今日多空倾向；
3. 给出今日做T预案：正T还是倒T、参考的买入触发价与卖出目标价、放弃条件；
4. 若有未对冲挂单，给出今日对冲优先级建议。`;
    case 'INTRADAY':
      return `${base}
现在是盘中时段。请先调用工具获取实时行情、资金流、大盘概览，以及我的未对冲挂单，然后完成：
1. 当前盘面强弱与资金动向（主力净流入/流出）；
2. 结合最近30根日K判断当前所处位置（支撑/压力）；
3. 趋势情景推演：接下来半小时更可能延续还是反转，给出判断依据；
4. 针对我的未对冲挂单，给出具体对冲策略（补回价位、止损位、是否建议止损了结）；
5. 若要新开一单，给出方向与价位建议。`;
    case 'CLOSE':
      return `${base}
今日已收盘。请调用工具获取收盘行情、全天资金流、今日我的交易与配对结果，然后完成：
1. 全天走势与量价资金回顾；
2. 今日做T操作评价（哪些对冲做得对、哪些是失误）；
3. 列出仍未对冲的挂单及处理建议；
4. 明日情景推演与做T策略（分高开/平开/低开三种情况）。`;
    case 'REVIEW':
      return `${base}
这是用户手动触发的盘后复盘。请调用工具获取今日全部交易流水、已对冲配对结果、收盘行情、资金流、新闻消息面，然后完成：
1. 当日操作评价：做对了什么、做错了什么（结合每笔对净收益与费用）；
2. 当日量价、资金面、消息面、成交量回顾；
3. 未对冲挂单的处理建议；
4. 下一交易日情景推演（高开/平开/低开分别对应什么预案）；
5. 明日做T策略：正T或倒T、触发价位、单次股数、最多做几次、放弃条件。
${extraContext ? `\n用户补充信息：${extraContext}` : ''}`;
    case 'STOCK':
      return `${base}
请针对该标的做一次专项分析：技术位置、资金动向、消息面、以及结合我的底仓成本与未对冲挂单的做T策略。${extraContext ? `\n用户补充：${extraContext}` : ''}`;
    default:
      return base;
  }
}

/**
 * 调用豆包进行分析
 * @returns {{content, summary, tokensIn, tokensOut, model, success, error}}
 */
async function analyze({ kind, userId, codes = [], extraContext = '', settings = null, model = null }) {
  const client = getClient();
  const useModel = model || config.ark.model;
  const execute = createToolExecutor({ userId, settings });
  const now = new Date();

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt({ kind, codes, extraContext, now }) },
  ];

  let tokensIn = 0;
  let tokensOut = 0;
  let finalContent = '';
  const toolTrace = [];

  try {
    for (let round = 0; round < 6; round += 1) {
      const resp = await client.chat.completions.create({
        model: useModel,
        messages,
        tools: TOOL_DEFS,
        tool_choice: 'auto',
        temperature: 0.3,
        max_tokens: 4000,
      });

      if (resp.usage) {
        tokensIn += resp.usage.prompt_tokens || 0;
        tokensOut += resp.usage.completion_tokens || 0;
      }

      const msg = resp.choices?.[0]?.message;
      if (!msg) throw new Error('模型返回为空');

      // 有工具调用 → 执行后把结果喂回去
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        messages.push(msg);
        for (const call of msg.tool_calls) {
          const name = call.function?.name;
          let args = {};
          try {
            args = JSON.parse(call.function?.arguments || '{}');
          } catch (_) {
            args = {};
          }
          const result = await execute(name, args);
          toolTrace.push({ tool: name, args, ok: result?.ok });
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(result),
          });
        }
        continue;
      }

      // 无工具调用 → 最终答案
      finalContent = msg.content || '';
      break;
    }

    if (!finalContent) throw new Error('模型未输出最终结果');

    return {
      success: true,
      content: finalContent,
      summary: extractSummary(finalContent),
      tokensIn,
      tokensOut,
      model: useModel,
      toolTrace,
    };
  } catch (err) {
    return {
      success: false,
      content: '',
      summary: `AI 分析失败：${err.message}`,
      tokensIn,
      tokensOut,
      model: useModel,
      error: err.message,
    };
  }
}

/** 抽取一句话摘要：优先取 Markdown 首个加粗/标题行，否则截断首段 */
function extractSummary(text) {
  const clean = String(text || '').trim();
  if (!clean) return '';
  const lines = clean.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 6)) {
    const stripped = line.replace(/^#+\s*/, '').replace(/\*\*/g, '').replace(/^[-*]\s*/, '');
    if (stripped.length >= 8) return stripped.length > 60 ? `${stripped.slice(0, 60)}…` : stripped;
  }
  return clean.length > 60 ? `${clean.slice(0, 60)}…` : clean;
}

module.exports = { analyze, SYSTEM_PROMPT, TOOL_DEFS };
