/**
 * 交易日历与时段工具
 * 说明：节假日表需每年维护一次；V2 可改为从行情服务拉取交易日历。
 */

// 2026 年 A 股休市日（法定节假日，含调休），按 YYYY-MM-DD 维护
const HOLIDAYS_2026 = [
  // 元旦
  '2026-01-01', '2026-01-02', '2026-01-05',
  // 春节（示例，需按国务院最终公告校准）
  '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-23',
  // 清明
  '2026-04-06',
  // 劳动节
  '2026-05-01', '2026-05-04', '2026-05-05',
  // 端午
  '2026-06-19',
  // 中秋
  '2026-09-25',
  // 国庆
  '2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08',
];

/** 取 YYYY-MM-DD */
function ymd(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 是否交易日（仅判断周末 + 节假日，不含临时休市） */
function isTradingDay(date = new Date()) {
  const day = date.getDay();
  if (day === 0 || day === 6) return false;
  return !HOLIDAYS_2026.includes(ymd(date));
}

/**
 * 当前交易时段
 * PREOPEN | CONTINUOUS | LUNCH | CLOSING | CLOSED
 */
function sessionLabel(date = new Date()) {
  const hhmm = date.getHours() * 60 + date.getMinutes();
  if (hhmm < 9 * 60 + 15) return 'CLOSED';
  if (hhmm < 9 * 60 + 25) return 'PREOPEN';   // 集合竞价
  if (hhmm < 11 * 60 + 30) return 'CONTINUOUS'; // 上午连续竞价
  if (hhmm < 13 * 60) return 'LUNCH';
  if (hhmm < 15 * 60) return 'CONTINUOUS';
  if (hhmm < 15 * 60 + 30) return 'CLOSING';
  return 'CLOSED';
}

/** 当日 00:00（用于按日聚合统计） */
function startOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

module.exports = { isTradingDay, sessionLabel, ymd, startOfDay, HOLIDAYS_2026 };
