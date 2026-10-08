FROM node:20-alpine

WORKDIR /app

# 安装依赖
COPY package.json ./
RUN npm install --omit=dev

# 生成 Prisma Client（schema 必须存在）
COPY prisma ./prisma
RUN npx prisma generate

COPY src ./src
COPY scripts ./scripts

ENV NODE_ENV=production
ENV TZ=Asia/Shanghai
EXPOSE 8080

CMD ["node", "src/index.js"]
