#!/bin/sh
# ==============================================================================
# 一键把 zuot-app 推到 GitHub，触发 Actions 云构建 APK
# ------------------------------------------------------------------------------
# 用法（先 cd 到 zuot-app 目录，再执行）：
#
#   方式 A（推荐，不用管用户名）：
#     sh scripts/push-github.sh
#     → 脚本会让你粘贴 GitHub 仓库地址，照着提示复制粘贴即可
#
#   方式 B（直接给地址）：
#     sh scripts/push-github.sh https://github.com/laoxiong2026/zuot-app.git
#
#   方式 C（用户名 + 仓库名）：
#     sh scripts/push-github.sh laoxiong2026 zuot-app
#
# 兼容性说明（重要）：
#   1) 本脚本用 POSIX sh 编写，鸿蒙 PC 的 zsh / 系统 sh 都能直接跑，
#      **不需要单独安装 bash**。请用 `sh` 调用，不要用 `bash`（鸿蒙没装 bash）。
#   2) 鸿蒙共享目录常见「dubious ownership」报错，脚本会自动加 safe.directory 处理。
#
# 前置条件：
#   1. 装了 git（鸿蒙 PC 上装 GitNext 即可，终端 `git -v` 能输出版本号）
#   2. GitHub 上已建好空仓库（没建也行，脚本会告诉你怎么办）
#   3. ⚠️ GitHub 用户名只能是英文/数字/短横线，不支持中文。
#      「老雄」这类中文是你的显示名（昵称），不是用户名。
#      → 不知道用户名就用方式 A，直接复制仓库地址，绕开这个问题。
#
# 安全：先把文件暂存起来，再扫描暂存区里有没有 .env / 签名文件；
#       一旦发现就全部取消暂存并中止，绝不把 ARK_API_KEY 传上去。
# ==============================================================================
set -eu

BRANCH="${BRANCH:-main}"

# 颜色（用 POSIX 的 printf 生成转义，不依赖 bash 的 $'...' 语法）
ESC=$(printf '\033')
RED="${ESC}[0;31m"; GRN="${ESC}[0;32m"; YEL="${ESC}[1;33m"; NC="${ESC}[0m"
info() { printf '%s\n' "${GRN}> $1${NC}"; }
warn() { printf '%s\n' "${YEL}! $1${NC}"; }
die()  { printf '%s\n' "${RED}x $1${NC}"; exit 1; }
trim() { printf '%s' "$1" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'; }

# ---------- 0. 环境检查 ----------
command -v git >/dev/null 2>&1 || die "没找到 git。鸿蒙 PC 请在「应用市场」安装 GitNext，装完关掉终端重新打开。"

# ---------- 1. 定位到项目根目录 ----------
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
PROJECT_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
cd "$PROJECT_ROOT"
info "项目目录：$PROJECT_ROOT"

if [ ! -f README.md ] || [ ! -d server ]; then
  die "这里看起来不是 zuot-app 项目目录。请先 cd 到 zuot-app 再执行本脚本。"
fi

# ---------- 2. 处理「dubious ownership」（鸿蒙共享目录高频问题） ----------
# 鸿蒙的 /storage 目录属主和当前用户可能不一致，git 默认拒绝操作并报
# fatal: detected dubious ownership —— 会导致后面所有 git 命令失效，必须最先修掉。
if ! git config --global --get-all safe.directory 2>/dev/null | grep -qxF "$PROJECT_ROOT"; then
  git config --global --add safe.directory "$PROJECT_ROOT" >/dev/null 2>&1 || true
fi

# ---------- 3. 初始化仓库 ----------
if [ ! -d .git ]; then
  info "初始化 git 仓库…"
  git init -b "$BRANCH" >/dev/null 2>&1 || git init >/dev/null 2>&1
  git symbolic-ref HEAD "refs/heads/$BRANCH" 2>/dev/null || true
else
  info "已存在 git 仓库，跳过初始化"
fi

# ---------- 4. 提交身份 ----------
if [ -z "$(git config user.name 2>/dev/null || true)" ] || [ -z "$(git config user.email 2>/dev/null || true)" ]; then
  warn "还没配置 git 身份，先用默认值兜底（想改就在 GitNext 的「用户信息配置」里改）"
  git config user.name  "${GIT_USER_NAME:-zuot-dev}"
  git config user.email "${GIT_USER_EMAIL:-zuot-dev@local}"
fi

# ---------- 5. 暂存 ----------
info "暂存文件…"
git add -A

# ---------- 6. 安全检查：暂存完再扫，最可靠 ----------
# （不用 git check-ignore：它在 dubious ownership / 部分 git 实现下会失效误报）
BAD=$(git ls-files | grep -Ei '\.env$|\.jks$|\.keystore$|key\.properties$' || true)
if [ -n "$BAD" ]; then
  printf '%s\n' "$BAD" | while IFS= read -r line; do warn "  不想提交：$line"; done
  git reset >/dev/null 2>&1 || true
  die "检测到密钥文件被暂存，已取消全部暂存并中止。
    请确认 .gitignore 里含 .env / *.env / *.jks / *.keystore / key.properties 后重试。"
fi
info "安全检查通过：没有密钥文件进入提交范围"

# ---------- 7. 提交 ----------
if git diff --cached --quiet 2>/dev/null; then
  warn "没有需要提交的新改动"
else
  git commit -m "feat: 做T管家 V1（手动触发版）

- 后端：Node + Express + Prisma，费率引擎 / FIFO 配对结算 / 邀请码与权限
- 前端：Flutter（Android APK + 鸿蒙 HAP 同源），V3 深空终端设计
- 价格统一用「厘」存储，修正 ETF 做T 收益失真问题
- 定时任务默认关闭（SCHEDULER_ENABLED=false），AI 分析走 App 内手动触发" >/dev/null
  info "已提交"
fi

# ---------- 8. 拿到仓库地址（三种方式） ----------
ARG1="${1:-}"
ARG2="${2:-}"
REMOTE_URL=""

if [ -n "$ARG1" ]; then
  case "$ARG1" in
    *://*|*.git)
      REMOTE_URL="$ARG1"
      ;;
    *)
      # 旧用法：用户名 + 仓库名
      case "$ARG1" in
        *[!A-Za-z0-9-]*)
          die "「$ARG1」不能当 GitHub 用户名。
    GitHub 用户名只允许英文、数字和短横线，**不支持中文**。
    「老雄」这类中文是你的显示名（昵称），不是登录用的用户名。

    怎么查真实用户名：
      1) 浏览器打开 https://github.com/settings/account
      2) 页面最上面第一个框「Username」里那串英文就是
      （也可以点右上角头像 -> Your profile，地址栏 github.com/后面那串）

    嫌麻烦就直接用仓库地址，不用管用户名：
      sh scripts/push-github.sh https://github.com/<用户名>/zuot-app.git

    仓库地址怎么拿：
      打开你在 GitHub 上建的那个空仓库页面，点绿色「Code」按钮，
      复制 HTTPS 那一行（形如 https://github.com/xxxx/zuot-app.git）。"
          ;;
      esac
      case "${ARG2:-}" in
        *[!A-Za-z0-9._-]*) die "仓库名「$ARG2」含非法字符，只能用英文/数字/点/短横线/下划线。" ;;
      esac
      REMOTE_URL="https://github.com/${ARG1}/${ARG2:-zuot-app}.git"
      ;;
  esac
else
  cat <<'EOF'

没传仓库地址，先告诉你去哪复制（不用知道用户名）：

  1) 打开你在 GitHub 上建的那个空仓库页面
  2) 点页面中间那个绿色的「<> Code」按钮
  3) 弹出的框里选「HTTPS」，点右边的小复制图标
     复制到的样子：https://github.com/xxxx/zuot-app.git

把那串地址粘到下面，回车。
（还没建仓库？先去 https://github.com/new 建一个：名字 zuot-app、
  选 Private、下面三个勾都别勾，建完再回来粘地址）

EOF
  printf '仓库地址 > '
  INPUT=""
  read -r INPUT || true
  INPUT=$(trim "$INPUT")
  if [ -z "$INPUT" ]; then
    warn "没收到地址，本地仓库已建好，推送先跳过"
    cat <<'EOF'

想手动推就这两行（把地址换成你自己的）：
  git remote add origin https://github.com/<用户名>/zuot-app.git
  git push -u origin main
EOF
    exit 0
  fi
  REMOTE_URL="$INPUT"
fi

REMOTE_URL=$(trim "$REMOTE_URL")

# ---------- 9. 规范化并解析出 用户名 / 仓库名 ----------
case "$REMOTE_URL" in
  git@github.com:*) REMOTE_URL="https://github.com/${REMOTE_URL#git@github.com:}" ;;
esac
case "$REMOTE_URL" in
  https://*) ;; http://*) ;;
  *) REMOTE_URL="https://${REMOTE_URL}" ;;
esac
case "$REMOTE_URL" in
  *.git) ;;
  *) REMOTE_URL="${REMOTE_URL}.git" ;;
esac

_PATH=$(printf '%s' "$REMOTE_URL" | sed 's|^https\?://||; s|\.git$||')
GH_HOST=$(printf '%s' "$_PATH" | cut -d/ -f1)
GH_USER=$(printf '%s' "$_PATH" | cut -d/ -f2)
GH_REPO=$(printf '%s' "$_PATH" | cut -d/ -f3)

if [ -z "$GH_USER" ] || [ -z "$GH_REPO" ]; then
  die "看不懂这个地址：$REMOTE_URL
    正确样子应该是：https://github.com/laoxiong2026/zuot-app.git
    去仓库页面点绿色「Code」按钮复制 HTTPS 那一行再来一次。"
fi
info "目标仓库：${GH_USER}/${GH_REPO}"

# ---------- 10. 设置远端 ----------
if git remote get-url origin >/dev/null 2>&1; then
  OLD=$(git remote get-url origin)
  if [ "$OLD" != "$REMOTE_URL" ]; then
    warn "已有远端地址 $OLD，改成 $REMOTE_URL"
    git remote set-url origin "$REMOTE_URL"
  fi
else
  info "添加远端：$REMOTE_URL"
  git remote add origin "$REMOTE_URL"
fi

# ---------- 11. 推送 ----------
CURRENT_BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "")
if [ "$CURRENT_BRANCH" != "$BRANCH" ]; then
  git branch -M "$BRANCH" 2>/dev/null || git branch -m "$BRANCH" 2>/dev/null || true
fi

info "推送到 origin/${BRANCH} …"
if git push -u origin "$BRANCH"; then
  info "推送成功！"
else
  die "推送失败。按顺序排查：
    1) 仓库还没建。去 https://${GH_HOST}/new 建一个，
       名字填 ${GH_REPO}，选 Private（私有），下面三个选项都别勾。
    2) 地址拼错了（要跟你仓库页面 Code / 克隆 按钮里那行完全一致）。
    3) 要令牌（PAT）而不是登录密码：
       GitHub：头像 -> Settings -> Developer settings -> Personal access tokens
               -> Tokens (classic) -> Generate new token -> 勾 repo -> 复制 ghp_xxx
       Gitee ：头像 -> 设置 -> 私人令牌 -> 生成新令牌 -> 勾 projects -> 复制
       然后依次执行：
         git remote set-url origin https://<令牌>@${GH_HOST}/${GH_USER}/${GH_REPO}.git
         git push -u origin ${BRANCH}"
fi

case "$GH_HOST" in
  *gitee.com) NEXT_URL="https://gitee.com/${GH_USER}/${GH_REPO}/pipelines" ;;
  *)          NEXT_URL="https://${GH_HOST}/${GH_USER}/${GH_REPO}/actions" ;;
esac

cat <<EOF

下一步：
  1. 打开 ${NEXT_URL}
  2. 看「Flutter 代码检查」：绿勾=通过，红叉=有错（把红色那几行复制给我）
  3. 绿勾后点左侧「Build Android APK」-> 右上角 Run workflow -> 约 5 分钟
     下载 zuot-app-release -> app-release.apk，传到手机安装
EOF
