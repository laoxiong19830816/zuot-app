# 做T管家 · 日内做T交易系统

一套「App + 后端 + AI 副驾」的日内做T交易管理系统。Android / 鸿蒙双端（Flutter-OH 一套代码），
后端 Node.js + PostgreSQL，AI 用火山引擎方舟豆包（Function Calling 接自建行情服务）。

## 目录结构

```
zuot-app/
├── server/                    # 后端
│   ├── src/
│   │   ├── index.js           # 入口：路由装配 + 调度启动 + 管理员初始化
│   │   ├── config.js          # 全局配置（费率默认值、豆包、调度开关）
│   │   ├── lib/               # prisma / http / 交易日历
│   │   ├── middleware/auth.js # JWT + 数据隔离（userId 只从 token 取）
│   │   ├── routes/            # auth / positions / trades / ai / stats / risk / admin
│   │   ├── services/
│   │   │   ├── fee.js         # 费率引擎（股票 vs ETF，保本价差）
│   │   │   ├── pairing.js     # 对冲配对与结算（收益归属对冲日）
│   │   │   ├── quote.js       # 行情客户端（缓存 + 失败降级）
│   │   │   ├── doubao.js      # 豆包 Function Calling（防幻觉三铁律）
│   │   │   └── aiRunner.js    # 额度校验 → 调用 → 落库 → 命中率回测
│   │   └── jobs/scheduler.js  # 9:24 / 每半小时 / 15:00 / 16:00
│   ├── quote/akshare_service.py  # 自建行情服务（Python + AkShare）
│   ├── prisma/schema.prisma   # 数据模型（金额一律整数分）
│   └── Dockerfile
├── client/                    # Flutter 客户端（Android + 鸿蒙）
│   └── lib/
│       ├── core/              # api / theme / format
│       ├── providers.dart     # Riverpod 状态
│       └── pages/             # 登录 / 今日 / 记账 / 个股看板 / 统计 / 设置 / 后台
├── docker-compose.yml         # 一键起 db + app + quote
├── deploy.sh                  # 服务器一键部署
└── .github/workflows/build-apk.yml  # 云构建 APK（鸿蒙 PC 无法本地打包时的方案）
```

## 核心口径（改代码前务必读）

1. **收益只算对冲成功的配对**，未对冲挂单进独立池，只显示未实现浮盈亏，不入任何统计。
2. **收益归属对冲日**（后一笔成交的日期），不是开仓日。
3. **单位铁律（改代码前必读）**：
   - **价格 = 整数「厘」（mills，1 元 = 1000 厘）** —— ETF 最小变动价位是 0.001 元，
     若用「分」存会把 0.611 / 0.614 都记成 61，价差被抹平成 0，做T 收益直接失真。
   - **金额 = 整数「分」（cents）**，禁止用浮点存金额。
   - 换算一律走 `server/src/lib/units.js`，前端 `Fmt.price()`（÷1000）/ `Fmt.money()`（÷100）。
4. **费率**：股票佣金万0.74免五 + 印花税卖出0.05% + 过户费双向0.001%；
   ETF 佣金万0.5，**免印花税免过户费**。
5. **成本冲减**：新成本价 =（旧成本价×底仓股数 − 对冲净收益）÷ 底仓股数。
6. **豆包拿不到行情**，必须由 `quote` 服务用 Tool Call 提供数字；System Prompt 写死禁止编造。

## 快速开始

### 1. 后端（本地调试）

```bash
cd server
cp .env.example .env        # 填入 ARK_API_KEY、JWT_SECRET、DATABASE_URL
npm install
npx prisma migrate dev
npm run dev                 # http://localhost:8080/health
```

另开一个终端起行情服务：

```bash
cd server/quote
pip install -r requirements.txt
python akshare_service.py
```

### 2. 服务器部署

```bash
scp -r ../zuot-app root@<服务器IP>:/opt/zuot
ssh root@<服务器IP> "cd /opt/zuot && chmod +x deploy.sh && ./deploy.sh"
# 首次会生成 .env，填入 ARK_API_KEY 后再执行一次
```

### 3. 客户端

```bash
cd client
fvm use 3.35.7              # 鸿蒙端必须用 Flutter-OH；仅打 APK 可用官方稳定版
flutter pub get
flutter run
# 无 Flutter SDK 时，先跑冒烟检查兜底：
node ../scripts/dart-lint-lite.js
```

### 4. 手动触发（无服务器 / 定时任务关闭时的用法）

`.env` 里 `SCHEDULER_ENABLED=false` 时，**定时任务完全不启动**，
但下面两个接口始终可用，App 里点按钮即可：

```
POST /api/ai/refresh   { kind: 'PREOPEN'|'INTRADAY'|'CLOSE'|'STOCK', code? }   # 立即分析
POST /api/ai/review                                                            # 盘后复盘（当日须有交易）
```

### 5. 录入持仓（两种方式）

```bash
# 方式一：脚本（需要数据库已起来）
node server/scripts/seed-positions.js your@email.com
node server/scripts/seed-positions.js your@email.com --force   # 覆盖已存在标的
```

方式二（推荐）：App 内「**我的 → 批量导入持仓**」，粘贴券商持仓文本，一次录多只票：

```
600062 华润双鹤 16.101 500 500
000100 TCL科技 3.530 4100 100
000423 东阿阿胶 49.750 2000 1500
```

支持空格 / 逗号 / 制表符分隔，顺序自适应；可选「合并」或「覆盖」。

### 6. 推送到 GitHub（触发云构建 APK）

```sh
# 方式 A（推荐）：不填用户名，脚本会让你粘贴仓库地址
sh scripts/push-github.sh

# 方式 B：直接给地址
sh scripts/push-github.sh https://github.com/<用户名>/zuot-app.git

# 方式 C：用户名 + 仓库名
sh scripts/push-github.sh <英文用户名> zuot-app
```

仓库地址：打开 GitHub 仓库页 → 绿色「**<> Code**」→ **HTTPS** → 复制图标。

> ⚠️ 用 `sh` 调用，**不要用 `bash`**。鸿蒙 PC 没有 bash，只有 zsh，用 bash 会报
> `zsh: command not found: bash`。脚本本身是 POSIX sh 写的，`sh` 直接能跑。
>
> ⚠️ **GitHub 用户名只认英文/数字/短横线，不支持中文**。中文那是「显示名/昵称」。
> 不知道用户名就用方式 A，粘贴仓库地址即可，完全绕开这个问题。

脚本内置两道保险：
1. **密钥泄露自检**：先暂存再扫暂存区，发现 `.env` / `*.jks` / `key.properties` 就全部撤回并中止
2. **自动修 `dubious ownership`**：鸿蒙共享目录属主不一致会让 git 罢工，脚本自动加 `safe.directory`

推上去后到仓库 Actions 页手动 Run workflow，约 5 分钟产出 `app-release.apk`。

**打包**：
- Android APK：`flutter build apk --release`
- 鸿蒙 HAP：`flutter build hap --release`（需 DevEco Studio 环境，且手机为 HarmonyOS 5.0+）
- 云构建（鸿蒙 PC 开发机适用）：推代码到 GitHub，Actions 自动产出 APK

## 常见问题

| 问题 | 处理 |
|---|---|
| AI 分析一直失败 | 检查 `.env` 的 `ARK_API_KEY`；确认 `quote` 服务可访问（`/health` 返回 akshareReady: true） |
| 行情数据拿不到 | AkShare 接口会随上游变动，查看 `quote` 容器日志；可临时用手动录入价格 |
| 定时任务没执行 | `SCHEDULER_ENABLED` 是否为 true；服务器时区必须是 Asia/Shanghai；**docker-compose 的 `environment` 会覆盖 `.env`，别在这两处写不同的值** |
| 打不了 APK | 鸿蒙 PC 无 Android SDK，用 `.github/workflows/build-apk.yml` 云构建 |
| 注册不了（要邀请码） | 系统零用户时第一个注册者自动免码并成为管理员，之后才需要邀请码；见 `邀请码与权限说明.md` |
| 数字对不上 / 做T 收益为 0 | 检查价格字段是不是还在用「分」；ETF 必须用「厘」，见本文核心口径第 3 条 |

## 相关文档

- `邀请码与权限说明.md` —— 注册模式、邀请码玩法、权限管理、合规建议
- `打包与部署指引.md` —— APK / HAP 打包与服务器部署
- 上级目录 `测试与BUG修复清单.md` —— 本次修的 P0/P1/P2 BUG 与待办
- `UI视觉重构方案V3.md` —— 设计令牌与组件库
