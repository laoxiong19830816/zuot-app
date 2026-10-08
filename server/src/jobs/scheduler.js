/**
 * 定时任务调度
 * 时刻表（仅交易日执行，时区 Asia/Shanghai）：
 *   09:24  集合竞价分析
 *   10:00 / 10:30 / 11:00 / 11:30  盘中分析
 *   13:00 / 13:30 / 14:00 / 14:30  盘中分析
 *   15:00  收盘分析
 *   16:00  收盘后处理：同步底仓股数 + AI 命中率回测
 */

const cron = require('node-cron');
const config = require('../config');
const prisma = require('../lib/prisma');
const { runAnalysis, evaluateHitRate } = require('../services/aiRunner');
const { isTradingDay } = require('../lib/time');

const TZ = 'Asia/Shanghai';

async function shouldRun(user, kind) {
  if (user.status !== 'ACTIVE' || user.role === 'DISABLED') return false;
  const settings = await prisma.userSettings.findUnique({ where: { userId: user.id } });
  if (!settings) return kind === 'INTRADAY'; // 无设置时至少跑盘中
  if (kind === 'PREOPEN' && !settings.aiEnablePreopen) return false;
  if (kind === 'INTRADAY' && !settings.aiEnableIntraday) return false;
  if (kind === 'CLOSE' && !settings.aiEnableClose) return false;
  return true;
}

async function runForAllUsers(kind) {
  if (!isTradingDay()) {
    console.log(`[CRON] ${kind} 跳过：非交易日`);
    return;
  }
  const users = await prisma.user.findMany({ where: { status: 'ACTIVE' } });
  console.log(`[CRON] ${kind} 开始，目标用户 ${users.length} 人`);

  let okCount = 0;
  let failCount = 0;

  for (const user of users) {
    try {
      // 无持仓的用户跳过，避免无意义调用浪费额度
      const posCount = await prisma.position.count({ where: { userId: user.id } });
      if (posCount === 0) continue;

      if (!(await shouldRun(user, kind))) continue;

      const res = await runAnalysis({ userId: user.id, kind, triggeredBy: 'cron' });
      if (res.success) okCount += 1;
      else failCount += 1;
    } catch (err) {
      failCount += 1;
      console.error(`[CRON] ${kind} 用户 ${user.id} 失败：`, err.message);
    }
  }
  console.log(`[CRON] ${kind} 完成：成功 ${okCount}，失败 ${failCount}`);
}

/**
 * 收盘后处理
 * 1. 底仓同步：收盘后「实际持股 = 可用股数」，做T等量买卖应回到原值，这里做一次校正
 * 2. AI 命中率回测：把昨天的分析结论与实际走势对照打分
 */
async function postCloseJob() {
  if (!isTradingDay()) return;

  const users = await prisma.user.findMany({ where: { status: 'ACTIVE' } });
  for (const user of users) {
    try {
      const positions = await prisma.position.findMany({ where: { userId: user.id } });
      for (const p of positions) {
        if (p.availableQty !== p.baseQty) {
          await prisma.position.update({
            where: { id: p.id },
            data: { baseQty: p.availableQty },
          });
        }
      }
      await evaluateHitRate(user.id, 1);
    } catch (err) {
      console.error(`[CRON] 收盘后处理失败 ${user.id}：`, err.message);
    }
  }
  console.log('[CRON] 收盘后处理完成');
}

function startScheduler() {
  if (!config.schedulerEnabled) {
    console.log('[CRON] 调度已关闭（SCHEDULER_ENABLED=false），仅支持 App 内手动触发');
    return;
  }

  // 9:24 集合竞价
  cron.schedule('24 9 * * 1-5', () => runForAllUsers('PREOPEN'), { timezone: TZ });

  // 盘中每半小时：10:00 10:30 11:00 11:30
  cron.schedule('0,30 10-11 * * 1-5', () => runForAllUsers('INTRADAY'), { timezone: TZ });

  // 盘中每半小时：13:00 13:30 14:00 14:30
  cron.schedule('0,30 13-14 * * 1-5', () => runForAllUsers('INTRADAY'), { timezone: TZ });

  // 15:00 收盘分析
  cron.schedule('0 15 * * 1-5', () => runForAllUsers('CLOSE'), { timezone: TZ });

  // 16:00 收盘后处理
  cron.schedule('0 16 * * 1-5', () => postCloseJob(), { timezone: TZ });

  console.log('[CRON] 调度已启动：9:24 竞价 / 盘中每半小时 / 15:00 收盘 / 16:00 收盘后处理');
}

module.exports = { startScheduler, runForAllUsers, postCloseJob };
