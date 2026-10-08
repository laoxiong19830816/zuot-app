const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');

const config = require('./config');
const prisma = require('./lib/prisma');
const { ok, errorHandler } = require('./lib/http');
const { startScheduler } = require('./jobs/scheduler');

const authRoutes = require('./routes/auth');
const positionRoutes = require('./routes/positions');
const tradeRoutes = require('./routes/trades');
const aiRoutes = require('./routes/ai');
const statsRoutes = require('./routes/stats');
const riskRoutes = require('./routes/risk');
const adminRoutes = require('./routes/admin');

const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// 健康检查
app.get('/health', (req, res) => {
  ok(res, {
    service: 'zuot-server',
    time: new Date().toISOString(),
    scheduler: config.schedulerEnabled,
    model: config.ark.model,
    arkConfigured: !!config.ark.apiKey,
    quoteService: config.quoteServiceUrl,
  });
});

// 业务路由（全部带 user_id 隔离）
app.use('/api/auth', authRoutes);
app.use('/api/positions', positionRoutes);
app.use('/api/trades', tradeRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/risk', riskRoutes);
app.use('/api/admin', adminRoutes);

app.use((req, res) => {
  res.status(404).json({ code: 1, message: '接口不存在', data: null });
});

app.use(errorHandler);

/** 初始化超级管理员（首次启动） */
async function bootstrapAdmin() {
  try {
    const exists = await prisma.user.findUnique({ where: { email: config.adminInit.email } });
    if (exists) return;
    const passwordHash = await bcrypt.hash(config.adminInit.password, 10);
    const admin = await prisma.user.create({
      data: {
        email: config.adminInit.email,
        passwordHash,
        nickname: '管理员',
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });
    await prisma.userSettings.create({
      data: {
        userId: admin.id,
        stockCommissionRate: config.defaultFees.stockCommissionRate,
        stockMinCommissionCents: config.defaultFees.stockMinCommissionCents,
        stampTaxRate: config.defaultFees.stampTaxRate,
        transferFeeRate: config.defaultFees.transferFeeRate,
        etfCommissionRate: config.defaultFees.etfCommissionRate,
        etfMinCommissionCents: config.defaultFees.etfMinCommissionCents,
      },
    });
    console.log(`[INIT] 已创建管理员账号：${config.adminInit.email}`);
  } catch (err) {
    console.error('[INIT] 管理员初始化失败：', err.message);
  }
}

async function main() {
  await bootstrapAdmin();
  startScheduler();
  app.listen(config.port, '0.0.0.0', () => {
    console.log(`[INFO] 做T管家后端已启动：http://0.0.0.0:${config.port}`);
    console.log(`[INFO] 豆包模型：${config.ark.model}  密钥已配置：${!!config.ark.apiKey}`);
    console.log(`[INFO] 行情服务：${config.quoteServiceUrl}`);
  });
}

main().catch((err) => {
  console.error('[FATAL] 启动失败：', err);
  process.exit(1);
});
