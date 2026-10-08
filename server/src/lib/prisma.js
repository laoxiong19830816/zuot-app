const { PrismaClient } = require('@prisma/client');

let prisma;
if (process.env.NODE_ENV === 'production') {
  prisma = new PrismaClient();
} else {
  // 开发环境避免热重载创建过多连接
  if (!global.__prisma) global.__prisma = new PrismaClient();
  prisma = global.__prisma;
}

module.exports = prisma;
