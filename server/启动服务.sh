#!/bin/sh
# ==========================================================================
# 做T管家 · 后端一键启动（鸿蒙 PC / 任何装了 Node 的电脑都能跑）
#
# 用法：在终端里执行（注意是 sh，不是 bash —— 鸿蒙 PC 没有 bash）
#     cd /你的路径/zuot-app/server
#     sh 启动服务.sh
#
# 它会自动：检查 Node → 缺依赖就装 → 显示手机该填的地址 → 启动服务
# 停止服务：在这个窗口按 Ctrl + C
# ==========================================================================
set -eu

cd "$(dirname "$0")"

PORT=8080
if [ -f .env ]; then
  _p=$(sed -n 's/^PORT=\([0-9]*\).*/\1/p' .env | head -1)
  if [ -n "$_p" ]; then PORT="$_p"; fi
fi

echo ""
echo "=================================================="
echo "   做T管家 · 后端服务"
echo "=================================================="
echo ""

# ---------- 1. 检查 Node ----------
if ! command -v node >/dev/null 2>&1; then
  echo "✗ 找不到 node（Node.js 运行时）"
  echo "  这台电脑需要先装 Node.js 才能跑后端。"
  exit 1
fi
echo "· Node 版本：$(node -v)"

# ---------- 2. 依赖 ----------
if [ ! -d node_modules ]; then
  echo ""
  echo "· 第一次运行，正在安装依赖（纯 JS 包，1~2 分钟，请耐心等）…"
  echo ""
  if ! npm install --omit=optional --no-audit --no-fund; then
    echo ""
    echo "✗ 依赖安装失败。多半是网络问题，请连上能上网的网络后重试。"
    exit 1
  fi
  echo ""
  echo "· 依赖安装完成"
fi

# ---------- 3. 告诉用户手机该填什么地址 ----------
echo ""
echo "--------------------------------------------------"
echo "  📱 手机 App 里「服务器地址」请填下面其中一个："
echo "--------------------------------------------------"
ZUOT_PORT="$PORT" node -e '
const os = require("os");
const port = process.env.ZUOT_PORT || "8080";
const nets = os.networkInterfaces();
const list = [];
Object.values(nets).forEach((arr) => {
  (arr || []).forEach((n) => {
    const isV4 = n.family === "IPv4" || n.family === 4;
    if (isV4 && !n.internal) list.push(n.address);
  });
});
if (!list.length) {
  console.log("   （没检测到局域网 IP，请确认电脑已连上 Wi-Fi/网线）");
} else {
  list.forEach((ip) => console.log("     http://" + ip + ":" + port));
  console.log("");
  console.log("   填哪个都行；若连不上就换另一个试试。");
}
console.log("");
console.log("   注意：手机要和这台电脑连同一个 Wi-Fi。");
'
echo "--------------------------------------------------"
echo ""

# 端口占用提醒（在同一台电脑上重复启动时最常见）
if command -v curl >/dev/null 2>&1; then
  if curl -s -m 2 "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    echo "⚠️  ${PORT} 端口上已经有一个服务在跑了（可能是上次没关掉）。"
    echo "   如果手机已经能用，就不用重复启动；要重启请先关掉旧窗口。"
    echo ""
  fi
fi

echo "· 正在启动服务…（这个窗口别关，关掉服务就停了；Ctrl + C 可停止）"
echo ""

ZUOT_PORT="$PORT" node src/index.js
