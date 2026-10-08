/**
 * 数据库入口（双模式，业务代码 require('./lib/prisma') 保持不变）
 * ==========================================================================
 * 模式由环境变量 STORAGE 决定：
 *
 *   STORAGE=file（默认）
 *     用 src/lib/filestore.js 的纯 JS 文件存储，数据落在 server/data/zuot-db.json。
 *     适用：鸿蒙 PC 本机跑（装不了 PostgreSQL / Docker / Prisma 原生引擎）。
 *
 *   STORAGE=postgres
 *     用官方 Prisma Client 连 PostgreSQL。
 *     适用：以后买了云服务器，把 .env 里 STORAGE 改成 postgres 即可，
 *          业务代码一行都不用动。
 * ==========================================================================
 */

const path = require('path');

const mode = String(process.env.STORAGE || 'file').toLowerCase();

let client;

if (mode === 'postgres' || mode === 'pg') {
  // ---------------- 云端模式：官方 Prisma ----------------
  const { PrismaClient } = require('@prisma/client');
  if (process.env.NODE_ENV === 'production') {
    client = new PrismaClient();
  } else {
    // 开发环境避免热重载创建过多连接
    if (!global.__prisma) global.__prisma = new PrismaClient();
    client = global.__prisma;
  }
  console.log('[db] 使用 PostgreSQL（Prisma Client）');
} else {
  // ---------------- 本机模式：文件存储 ----------------
  const { createFileStore } = require('./filestore');
  const dataFile =
    process.env.DATA_FILE || path.join(__dirname, '..', '..', 'data', 'zuot-db.json');
  if (!global.__filestore) global.__filestore = createFileStore(dataFile);
  client = global.__filestore;
  console.log(`[db] 使用文件存储：${dataFile}`);
}

module.exports = client;
