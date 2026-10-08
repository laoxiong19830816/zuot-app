require('dotenv').config();

/**
 * 全局配置
 * 注意：所有费率默认值为「你的真实费率」（股票万0.74免五 / ETF万0.5免五），
 * 合规口径（不足5元按5元）由用户设置里的 complianceMode 开关单独控制。
 */
module.exports = {
  port: Number(process.env.PORT || 8080),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL,

  jwtSecret: process.env.JWT_SECRET || 'dev_secret_please_change',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '30d',

  ark: {
    apiKey: process.env.ARK_API_KEY || '',
    baseUrl: process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3',
    model: process.env.ARK_MODEL || 'Doubao-Seed-2.1-pro',
    timeoutMs: Number(process.env.ARK_TIMEOUT_MS || 120000),
  },

  quoteServiceUrl: process.env.QUOTE_SERVICE_URL || 'http://127.0.0.1:8620',

  schedulerEnabled: process.env.SCHEDULER_ENABLED !== 'false',
  registerMode: process.env.REGISTER_MODE || 'invite',
  bootstrapFirstUserAsAdmin: process.env.BOOTSTRAP_FIRST_USER_AS_ADMIN !== 'false',
  adminInit: {
    email: process.env.ADMIN_EMAIL || 'admin@example.com',
    password: process.env.ADMIN_PASSWORD || 'change_me_admin_pwd',
  },

  aiLimits: {
    daily: Number(process.env.AI_DAILY_LIMIT || 20),
    monthly: Number(process.env.AI_MONTHLY_LIMIT || 400),
  },

  // 默认费率（新用户注册时写入 UserSettings）
  defaultFees: {
    stockCommissionRate: 0.000074, // 万 0.74
    stockMinCommissionCents: 0,    // 免五
    stampTaxRate: 0.0005,          // 卖出 0.05%
    transferFeeRate: 0.00001,      // 双向 0.001%
    etfCommissionRate: 0.00005,    // ETF 万 0.5
    etfMinCommissionCents: 0,
  },

  // 合规口径：不足 5 元按 5 元收取（complianceMode = true 时使用）
  complianceMinCommissionCents: 500,
};
