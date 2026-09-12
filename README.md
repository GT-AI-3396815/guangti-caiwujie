# 光体•财无界

> 创作无界 · 钱景无限 —— 连接达人与商家的内容变现平台（前后端真实架构）

「光体•财无界」是一个**前后端分离、零第三方依赖**的内容变现平台：Node 原生后端 + 服务端 JSON 数据库 + 服务端资金账本。达人注册接任务、发布内容、打卡、做互动任务赚收益；商家充值后发布投放任务，预算**冻结进平台托管账户**，订单结算时由托管账户自动划付给达人——完整演练真实平台的资金流。

## 快速开始

```bash
cd guangti-qianwujie
node server.js          # 启动平台
node tests/api-test.mjs # （可选）运行 40 项 API 集成测试
# 打开 http://localhost:8642
```

> 旧版纯静态模式已升级：现在必须通过 `node server.js` 访问（前端所有业务数据都来自 `/api/*`）。

## 持续在线与实时更新

### 持续在线（Windows）

- **手动启动**：双击 `start-guangti.bat`——带守护循环，服务崩溃 2 秒自动重启，关闭窗口即停止
- **开机自启**：安装脚本已写入注册表 Run 键（`HKCU\...\Run\GuangTiCaiWuJie` → `server-hidden.vbs`），Windows 登录后在后台静默拉起服务守护，无需任何操作
- 移除自启：`reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v GuangTiCaiWuJie /f`

### 实时数据更新（SSE）

服务端内置 `/api/stream` 推送通道（Server-Sent Events + 25 秒心跳），所有业务变更**毫秒级广播**：

| 事件 | 前端行为 |
| --- | --- |
| 任务发布/接单/暂停/到期 | 广场上新、名额进度自动刷新（免刷新实测通过） |
| 订单审核结算 | 达人页面实时弹「¥xx 已入账」，钱包/明细即时更新 |
| 邀请返佣到账 | 邀请人实时弹到账通知 |
| 托管预算耗尽 | 商家端实时弹停投警告 |
| 定时内容到点上线 | 作者端实时弹发布成功 |
| 充值/提现/打卡/互动 | 全端余额同步 |

头部**绿点指示灯**表示实时连接状态（红色=断线自动重连）。页面在用户输入或弹层打开时暂停整体重绘，避免打断操作。

## 真实可交易的架构

### 资金流（服务端账本强约束）

```
商家注册 → 账户充值（收银台） ─┐
                              ├─→ 发布任务时按「单价 × 名额」冻结预算进托管池
达人接单 → 提交作品 → 平台审核 ─┘
                              → 审核通过：托管池划付到达人余额（账本双向记账）
达人提现 → 平台受理打款（余额即时冻结，运营后台可查可批）
```

- **账号体系**：用户名 + 密码（scrypt 加盐哈希），会话 Token 持久化，换设备登录数据不丢
- **账本口径**：累计收益/龙虎榜/近 7 日收益只统计真实收入（任务结算/互动/打卡/邀请返佣），充值与礼金不算收益
- **托管**：商家余额不足以覆盖 `单价 × 名额` 时无法发布任务；**结算额以任务剩余托管预算封顶**，预算耗尽任务自动停投，托管池永不为负；暂停投放不释放预算
- **邀请返佣**：注册时绑定邀请码，好友每获得一笔任务结算，邀请人实时到账 10%（平台补贴，不扣好友收益）
- **时效**：任务截止天数随时间递减、过期自动禁止接单；定时发布到点自动上线（30 秒周期清理 + 读取时触发）
- **风控**：互动任务冷却与每日限额、打卡日期、接单去重、提现门槛、非法用户名拦截全部在**服务端**校验

### 支付网关

| 渠道 | 状态 | 说明 |
| --- | --- | --- |
| 沙箱收银台 | ✅ 默认可用 | 内置 `/pay/sandbox/:orderId` 收银台页，完整演练「下单 → 支付 → 到账 → 账本」 |
| 支付宝（电脑网站支付） | 🔌 填配置即启用 | 已实现 `alipay.trade.page.pay` RSA2 签名与异步通知验签（表单回调兼容），配置后自动生效 |

启用支付宝真实收单：

```bash
export ALIPAY_APP_ID=你的应用APPID
export ALIPAY_PRIVATE_KEY="应用私钥（PKCS8）"
# 或直接编辑 server.js 顶部 CONFIG.alipay
node server.js
```

配置后充值弹窗选择「支付宝」即跳转真实支付宝收银台；`/api/pay/alipay/notify` 负责验签入账。

### 运营后台接口（Header 携带 `x-admin-key`）

- `GET  /api/admin/withdrawals` —— 提现申请列表
- `POST /api/admin/withdrawals/:id/settle` —— 标记打款完成

`ADMIN_KEY` **仓库中不保存任何真实密钥**：服务端按优先级读取环境变量 `ADMIN_KEY` → 本机 `config.local.json`（已被 .gitignore 排除）→ 均未配置时运营后台自动禁用。生成强密钥：`node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`。**上线经营真实资金业务需具备相应企业资质（ICP 备案、支付商户签约等）**，代码侧已把接入点全部预留好。

## REST API 一览

```
POST /api/auth/register|login        GET /api/auth/me
GET  /api/tasks                      POST /api/tasks（创建投放，冻结预算）
POST /api/orders（接单）             GET /api/orders/my
POST /api/orders/:id/submit          POST /api/campaigns/:id/status
POST /api/contents                   GET  /api/contents/mine
GET  /api/interact                   POST /api/interact/:defId
GET  /api/checkin                    POST /api/checkin
GET  /api/wallet                     POST /api/wallet/recharge|withdraw
GET  /api/merchant/dashboard         GET  /api/campaigns/mine
GET  /api/rank
POST /api/pay/sandbox/:id/confirm|cancel   POST /api/pay/alipay/notify
GET  /api/admin/withdrawals          POST /api/admin/withdrawals/:id/settle
```

## 功能总览

**达人端**：任务广场（筛选/排序/搜索/规则化匹配分/名额进度）、任务详情（结算规则与资金保障+举报入口）、我的任务（接单→提交→**商家验收/拒稿重提**→托管划付）、多平台一键发布（实时预览/配图/定时发布）、互动大厅（冷却+限额）、AI 打卡（日历+七日递进）、收益钱包（充值/提现/提现记录/明细/7 日图表/等级/收益计算器/**实名门控**）、龙虎榜（纯真实用户榜）、达人主页（信用分/完成率/商家评分/作品集）。

**商家端**：数据看板（真实结算消耗/托管资金）、三步投放向导（**资质认证门控**/人工或自动验收模式）、任务管理（**验收队列**：通过评分/拒稿留痕/72h 超时自动通过）。

**合规与信任**：用户服务协议、隐私政策、注册协议勾选、敏感词过滤（任务/内容）、举报与运营处理闭环、商家资质认证、达人实名认证（提现门控）、平台服务费 10%（独立账本科目）、站内消息中心（未读角标+SSE 实时推送+离线补读）。

**运营后台**（`#/admin`，x-admin-key）：平台收入/托管池总览、提现打款审批、举报处理、任务下架、敏感词库增补。

**通用**：达人端/商家端切换、明暗双主题、两行式导航、移动端响应式、邀请码返佣、实时在线指示灯、修改密码（吊销其他会话）。

## 部署到 GitHub / 云端

- **代码仓库**：本项目即标准 Git 仓库；推送后 GitHub Actions 会自动运行 40 项集成测试（`.github/workflows/ci.yml`）
- **GitHub Pages 不适用**：本平台有 Node 后端（账本/SSE），Pages 仅能托管静态页
- **GitHub Codespaces（推荐，一键云端运行）**：仓库页 → Code → Codespaces → Create，容器就绪后执行 `node server.js`，8642 端口自动以公开 https 链接转发（配置见 `.devcontainer/`）
- **任意容器平台（Render/Railway/Fly 等）**：仓库自带 `Dockerfile`，启动命令 `node server.js`，端口 `8642`；务必给 `/app/data` 挂持久卷保存账本数据
- **本机自启**：Windows 注册表 Run 键（见"持续在线"章节），或直接运行 `start-guangti.bat`

## 目录结构

```
guangti-qianwujie/
├── server.js            # 后端：API + 账本 + 托管 + 支付网关 + SSE + 静态服务
├── tests/api-test.mjs   # 40 项 API 集成测试（资金流/风控/时效/SSE 全覆盖）
├── start-guangti.bat    # 一键启动（守护自愈）
├── server-hidden.vbs    # 开机自启静默拉起器（路径无关）
├── Dockerfile           # 容器化部署（/app/data 持久卷）
├── .github/workflows/   # CI：推送自动跑集成测试
├── render.yaml          # Render.com 部署蓝图（永久公网 URL）
├── scripts/             # 自启安装脚本与任务定义
├── .devcontainer/       # GitHub Codespaces 一键云端运行
├── data/db.json         # 服务端数据库（自动生成，不入库）
├── index.html           # 页面骨架 + SVG 图标库
└── assets/
    ├── css/style.css    # 设计系统（明暗双主题、两行导航）
    └── js/
        ├── data.js      # 前端常量（平台/结算模式/主题色）
        ├── api.js       # API 客户端（Token 会话）
        └── app.js       # 路由、视图与交互（全部 API 驱动 + SSE 实时更新）
```

## 免责声明

本仓库用于功能演示与技术学习。接入真实支付通道并对外经营需要企业资质与支付/备案合规，请在合法合规前提下上线。
