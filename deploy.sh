#!/bin/bash
# 一键部署脚本（在服务器上执行）
# 用法：
#   1) 把 zuot-app 整个目录拷到服务器 /opt/zuot
#   2) cd /opt/zuot && chmod +x deploy.sh && ./deploy.sh
set -e

echo "===== 做T管家 · 一键部署 ====="

# ---------- 1. 环境检查 ----------
if ! command -v docker >/dev/null 2>&1; then
  echo "[1/5] 未检测到 Docker，开始安装..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker && systemctl start docker
else
  echo "[1/5] Docker 已安装"
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose 插件缺失，请安装 docker-compose-plugin 后重试"
  exit 1
fi

# ---------- 2. 环境变量 ----------
if [ ! -f .env ]; then
  echo "[2/5] 生成 .env（请务必修改！）"
  cat > .env <<EOF
JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || echo change_me_$(date +%s))
ARK_API_KEY=请填写你的方舟APIKey
ARK_MODEL=Doubao-Seed-2.1-pro
REGISTER_MODE=invite
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change_me_admin_pwd
EOF
  echo "已生成 .env，请编辑填入 ARK_API_KEY 与管理员密码后重新执行本脚本"
  exit 0
fi
echo "[2/5] 已存在 .env"

# ---------- 3. 构建并启动 ----------
echo "[3/5] 构建镜像（首次约 5-10 分钟，AkShare 依赖较大）..."
docker compose build

echo "[4/5] 启动服务..."
docker compose up -d

# ---------- 4. 建表 ----------
echo "[5/5] 执行数据库迁移..."
sleep 8
docker compose exec -T app npx prisma migrate deploy || true

# 可选：灌入演示数据
# docker compose exec -T app node scripts/seed.js

echo ""
echo "===== 部署完成 ====="
echo "后端地址：http://<服务器IP>:8080/health"
echo "查看日志：docker compose logs -f app"
echo "重启服务：docker compose restart"
echo ""
echo "下一步：App 的设置页里把「服务器地址」填成 http://<服务器IP>:8080"
