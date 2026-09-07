/* ============================================================
   光体•财无界 — 服务端（Node 原生，零依赖）
   - 静态资源 + REST API + 服务端 JSON 数据库
   - 账号体系：scrypt 密码哈希 + 持久化会话 Token
   - 资金体系：服务端账本（充值/托管冻结/结算/提现）
   - 支付网关：沙箱驱动（默认） + 支付宝 RSA2 适配器（配置商户密钥即启用）
   ============================================================ */
(function () {
  'use strict';
  var http = require('http');
  var fs = require('fs');
  var path = require('path');
  var crypto = require('crypto');

  /* ---------------- 配置 ---------------- */
  var CONFIG = {
    port: Number(process.env.PORT) || 8642,
    adminKey: process.env.ADMIN_KEY || 'gt-admin-demo',
    // 新用户开业资金（平台账本授予，便于演示真实资金流）
    grants: { merchant: 8888, creator: 8 },
    // 支付宝电脑网站支付（填入商户密钥后 recharge channel=alipay 自动启用真实收单）
    alipay: {
      enabled: false,
      appId: process.env.ALIPAY_APP_ID || '',
      privateKey: process.env.ALIPAY_PRIVATE_KEY || '',
      gateway: 'https://openapi.alipay.com/gateway.do',
      returnUrl: '',   // 支付后回跳页，例如 http://your-domain/#/wallet
      notifyUrl: ''    // 异步通知地址，例如 http://your-domain/api/pay/alipay/notify
    }
  };

  var ROOT = __dirname;
  var DATA_DIR = path.join(ROOT, 'data');
  var DB_FILE = path.join(DATA_DIR, 'db.json');

  /* ---------------- 小工具 ---------------- */
  function uid(p) { return p + '_' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex'); }
  function todayStr(off) {
    var d = new Date();
    if (off) d.setDate(d.getDate() + off);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function daysAgoStr(n) { return todayStr(-(n || 0)); }
  function rnd(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function hashPassword(pwd, salt) {
    return crypto.scryptSync(String(pwd), salt, 32).toString('hex');
  }

  /* ---------------- 数据库 ---------------- */
  var db = null;
  function loadDB() {
    try {
      if (fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) { db = null; }
    if (!db) { db = seedDB(); saveDB(); }
  }
  var saveTimer = null;
  function saveDB() {
    if (saveTimer) return;
    saveTimer = setTimeout(function () {
      saveTimer = null;
      try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(DB_FILE, JSON.stringify(db));
      } catch (e) { console.error('[db] save failed:', e.message); }
    }, 60);
  }

  /* ---------------- 种子任务（平台官方发布，预算预存托管池） ---------------- */
  function T(o) { o.merchantId = 'official'; o.status = 'on'; o.pubAt = Date.now() - (o.pubDaysAgo || 0) * 86400000; o.spend = 0; return o; }
  function seedTasks() {
    return [
      T({ id: 'T001', title: '即梦 AI 绘画体验官 · 创意作品共创计划', platform: 'dy', mode: 'cpe',
         reward: 0.8, unit: '每次互动', cap: '单条封顶 ¥20,000', capacity: 300, taken: 187,
         tags: ['置顶', '高佣'], fanMin: 1000, aiScore: 98, daysLeft: 12, pubDaysAgo: 1, cover: 1, pinned: true, oneKey: false,
         merchant: '光启 AI 实验室',
         desc: '使用即梦 AI 生成你的原创绘画作品并发布短视频，展示创作过程与成片效果，优秀作品可获得流量加持与额外奖金。',
         reqs: ['账号粉丝 ≥ 1,000 且完成实名认证', '视频时长 15s 以上，画面清晰无水印', '必须带话题 #AI绘画灵感 #光体共创', '发布后 72h 内不可删除'],
         steps: ['接受任务并报备账号', '使用即梦生成作品并录制过程', '按规范发布并回填链接', '平台按有效互动量 T+3 结算'] }),
      T({ id: 'T002', title: '出海短剧安利官 · 海外题材解说赛道', platform: 'dy', mode: 'ladder',
         reward: 15, unit: '每篇最高', cap: '阶梯 ¥3 → ¥15/篇', capacity: 200, taken: 96,
         tags: ['置顶', '一键发'], fanMin: 500, aiScore: 95, daysLeft: 20, pubDaysAgo: 2, cover: 2, pinned: true, oneKey: true,
         merchant: '星潮短剧发行',
         desc: '针对出海短剧进行剧情解说或混剪推荐，按播放阶梯结算：播放 <5w 得 ¥3，5w-20w 得 ¥8，>20w 得 ¥15。',
         reqs: ['剪辑素材由商家素材库提供，可二次创作', '单账号每日最多提交 2 条', '不得出现平台违禁词与夸大宣传'],
         steps: ['接受任务领取素材包', '完成剪辑并发布', '回填作品链接', '按阶梯自动结算'] }),
      T({ id: 'T003', title: '国民级手游周年庆共创（需账号报备）', platform: 'xhs', mode: 'milestone',
         reward: 500, unit: '封顶可赚', cap: '三阶里程碑 ¥120/¥300/¥500', capacity: 80, taken: 31,
         tags: ['置顶', '需报备'], fanMin: 5000, aiScore: 93, daysLeft: 9, pubDaysAgo: 3, cover: 0, pinned: true, oneKey: false,
         merchant: '云鲸互娱',
         desc: '周年庆版本体验图文/视频共创。发布基础体验笔记解锁 ¥120；笔记互动破 500 解锁 ¥300；进入品牌联合传播池再得 ¥200。',
         reqs: ['粉丝 ≥ 5,000，游戏垂类优先', '需先提交账号报备，审核通过后创作', '内容需含指定版本关键词与落地页'],
         steps: ['提交账号报备', '等待报备审核（24h 内）', '分阶段发布内容', '里程碑达标后结算'] }),
      T({ id: 'T004', title: '国风茶饮「春见青梅」新品体验笔记', platform: 'xhs', mode: 'fixed',
         reward: 88, unit: '每篇可赚', capacity: 50, taken: 49, tags: ['急单'], fanMin: 1000,
         aiScore: 91, daysLeft: 2, pubDaysAgo: 4, cover: 5, merchant: '青屿茶事',
         desc: '到店打卡新品并产出真实体验笔记，需包含产品特写与口感描述，图文 ≥ 4 张。',
         reqs: ['图文笔记 ≥ 4 张原图', '需出镜产品杯身与门店元素', '笔记发布后保留 ≥ 30 天'],
         steps: ['就近预约门店试饮', '拍摄并撰写笔记', '发布后回填链接', '审核通过 T+1 结算'] }),
      T({ id: 'T005', title: '智能手表睡眠监测深度测评', platform: 'sph', mode: 'cpm',
         reward: 45, unit: '千次播放', capacity: 60, taken: 22, tags: [], fanMin: 2000,
         aiScore: 88, daysLeft: 15, pubDaysAgo: 2, cover: 3, merchant: '驰为智能穿戴',
         desc: '围绕睡眠监测场景制作 1-3 分钟测评视频，重点展示数据准确性与佩戴体验，按千次有效播放结算。',
         reqs: ['视频 ≥ 60s，横竖屏均可', '需实测 3 晚以上睡眠数据', '不得贬低竞品品牌'],
         steps: ['接受任务', '录制实测素材并剪辑', '发布至视频号', '按播放量 T+7 结算'] }),
      T({ id: 'T006', title: '跨境电商选品工具拉新专栏', platform: 'bili', mode: 'per',
         reward: 2, unit: '每次有效注册', cap: '单人封顶 ¥600', capacity: 120, taken: 45,
         tags: ['高佣'], fanMin: 3000, aiScore: 90, daysLeft: 25, pubDaysAgo: 1, cover: 4, merchant: '海豚出海 SaaS',
         desc: '制作工具使用教程或选品实战专栏，通过专属链接引导注册，按有效注册结算。',
         reqs: ['专栏或视频需含实操演示', '专属推广链接由平台生成', '刷量将取消全部收益'],
         steps: ['接受任务获取专属链接', '产出教程内容', '引导注册并跟踪转化', '每周结算注册收益'] }),
      T({ id: 'T007', title: '城市剧本杀主题门店探店企划', platform: 'xhs', mode: 'fixed',
         reward: 150, unit: '每篇可赚', capacity: 30, taken: 8, tags: ['新'], fanMin: 2000,
         aiScore: 86, daysLeft: 6, pubDaysAgo: 0, cover: 2, merchant: '谜鹿剧本杀',
         desc: '到店体验指定主题本并发布探店笔记，突出场景沉浸感与服务体验，可携带 1 位同行免费体验。',
         reqs: ['粉丝 ≥ 2,000 的本地生活/探店账号', '笔记需含门店定位与预约方式', '素材需提前与店方确认可拍摄区域'],
         steps: ['预约到店时间', '体验并拍摄', '发布笔记回填链接', '审核通过结算'] }),
      T({ id: 'T008', title: 'AI 写作助手年度横评图文', platform: 'wb', mode: 'cpe',
         reward: 60, unit: '千次互动', capacity: 100, taken: 37, tags: [], fanMin: 1000,
         aiScore: 84, daysLeft: 18, pubDaysAgo: 3, cover: 1, merchant: '文渊科技',
         desc: '使用 3 款以上 AI 写作工具完成同一选题对比测评，输出客观横评长图或推文。',
         reqs: ['至少对比 3 款产品', '附实测 prompt 与输出截图', '结论需客观中立'],
         steps: ['领取测评账号权限', '完成横评内容', '发布并回填链接', '按互动量结算'] }),
      T({ id: 'T009', title: '新锐国货护肤「愈见」好物分享', platform: 'xhs', mode: 'fixed',
         reward: 66, unit: '每篇可赚', capacity: 80, taken: 52, tags: [], fanMin: 800,
         aiScore: 87, daysLeft: 11, pubDaysAgo: 2, cover: 0, merchant: '愈见生物科技',
         desc: '领取产品试用装后产出 14 天真实使用记录，图文视频均可，重在真实感受与肤质变化。',
         reqs: ['先填写肤质问卷再寄样', '内容含成分科普更佳', '敏感肌需注明适用性说明'],
         steps: ['填写问卷领取试用装', '连续记录使用感受', '发布笔记回填链接', '审核通过结算'] }),
      T({ id: 'T010', title: '短剧 APP 拉新激励视频任务', platform: 'ks', mode: 'per',
         reward: 1.5, unit: '每次有效下载', capacity: 500, taken: 213, tags: ['一键发'], fanMin: 500,
         aiScore: 89, daysLeft: 30, pubDaysAgo: 5, cover: 4, oneKey: true, merchant: '掌阅微剧',
         desc: '发布短剧高光切片并挂载下载组件，按有效下载结算，素材由官方提供，支持一键发布。',
         reqs: ['使用官方素材库切片', '每日最多 3 条', '不得诱导未成年下载'],
         steps: ['领取素材包', '一键发布或自行剪辑', '回填作品链接', '按下载量日结'] }),
      T({ id: 'T011', title: '全屋智能家居改造实录（长视频）', platform: 'bili', mode: 'milestone',
         reward: 1200, unit: '封顶可赚', cap: '两阶 ¥500/¥1200', capacity: 10, taken: 3,
         tags: ['高佣'], fanMin: 10000, aiScore: 92, daysLeft: 28, pubDaysAgo: 6, cover: 3, merchant: '栖云智能家装',
         desc: '记录一套真实的全屋智能改造过程，输出 10 分钟以上长视频。播放破 10w 解锁第二阶段奖金。',
         reqs: ['粉丝 ≥ 1w 的科技/家居区UP主', '需出镜讲解核心方案', '商家提供设备支持'],
         steps: ['提交账号与方案', '商家寄送设备', '拍摄制作长视频', '分阶段结算'] }),
      T({ id: 'T012', title: '城市露营装备清单种草合集', platform: 'xhs', mode: 'cpm',
         reward: 38, unit: '千次浏览', capacity: 150, taken: 64, tags: [], fanMin: 500,
         aiScore: 83, daysLeft: 14, pubDaysAgo: 4, cover: 5, merchant: '野格户外',
         desc: '围绕周末轻露营场景输出装备清单合集，合集内需包含指定品牌至少 2 件单品。',
         reqs: ['清单 ≥ 8 件装备', '含指定品牌单品 ≥ 2', '图片为实拍非网图'],
         steps: ['领取指定单品信息', '拍摄装备清单', '发布笔记回填链接', '按浏览量结算'] }),
      T({ id: 'T013', title: '在线音乐素养课试听推广', platform: 'sph', mode: 'fixed',
         reward: 45, unit: '每篇可赚', capacity: 200, taken: 88, tags: [], fanMin: 1000,
         aiScore: 81, daysLeft: 22, pubDaysAgo: 3, cover: 2, merchant: '知乐美育',
         desc: '面向家长群体分享孩子试听课的真实体验，强调课程体系与孩子变化，视频号优先。',
         reqs: ['需真实试听后产出', '不得承诺课程效果', '含试听领取入口'],
         steps: ['预约试听课', '记录体验过程', '发布内容回填链接', '审核通过结算'] }),
      T({ id: 'T014', title: '磁吸数码配件开箱合集（一键发）', platform: 'dy', mode: 'cpe',
         reward: 50, unit: '千次互动', capacity: 300, taken: 141, tags: ['一键发'],
         fanMin: 2000, aiScore: 85, daysLeft: 16, pubDaysAgo: 1, cover: 0, oneKey: true, merchant: '磁界数码',
         desc: '磁吸充电套装开箱与场景演示，支持一键发布至多平台，按互动量结算。',
         reqs: ['开箱需完整展示全家福', '演示磁吸吸附与充电实测', '突出旅行/办公场景'],
         steps: ['领取样品', '拍摄开箱', '一键发布或手动发布', '按互动量 T+3 结算'] }),
      T({ id: 'T015', title: '街角咖啡馆「慢拿铁」打卡计划', platform: 'xhs', mode: 'fixed',
         reward: 30, unit: '每篇可赚', capacity: 40, taken: 40, tags: ['已抢光'], fanMin: 300,
         aiScore: 78, daysLeft: 0, pubDaysAgo: 8, cover: 1, merchant: '山雾咖啡',
         desc: '到店打卡指定饮品并发布笔记，随杯附赠联名贴纸。本期名额已满，可关注下期。',
         reqs: ['到店实拍 ≥ 3 张', '笔记含门店定位'],
         steps: ['——本期已满——'] }),
      T({ id: 'T016', title: '数字艺术展「光之穹顶」体验官', platform: 'wb', mode: 'ladder',
         reward: 9, unit: '每篇最高', cap: '阶梯 ¥4 → ¥9/篇', capacity: 90, taken: 12,
         tags: ['新'], fanMin: 500, aiScore: 80, daysLeft: 10, pubDaysAgo: 0, cover: 3, merchant: '穹顶文化',
         desc: '观展后发布沉浸式体验图文，曝光量达阶梯即升档结算，优秀内容可获年卡赠送。',
         reqs: ['现场实拍 ≥ 5 张', '需含展览主题标签', '不得剧透核心展区机制'],
         steps: ['预约观展', '拍摄并发布', '回填链接', '按阶梯结算'] })
    ];
  }
  var INTERACT_DEFS = [
    { id: 'I1', title: '为指定笔记点赞 + 收藏', type: '点赞收藏', icon: 'i-heart', reward: 0.3, daily: 20, desc: '在互动列表打开指定笔记，完成点赞与收藏' },
    { id: 'I2', title: '关注品牌企业号', type: '关注任务', icon: 'i-users', reward: 0.5, daily: 10, desc: '关注指定企业号并保留 7 天' },
    { id: 'I3', title: '撰写 15 字以上优质评论', type: '评论任务', icon: 'i-book', reward: 0.8, daily: 10, desc: '评论需与内容相关，拒绝复制粘贴' },
    { id: 'I4', title: '转发指定微博并带话题', type: '转发任务', icon: 'i-send', reward: 0.4, daily: 15, desc: '转发需携带指定话题标签' },
    { id: 'I5', title: 'B 站视频一键三连', type: '三连任务', icon: 'i-bolt', reward: 0.5, daily: 20, desc: '对指定视频点赞、投币、收藏' },
    { id: 'I6', title: '观看直播间满 1 分钟', type: '观看任务', icon: 'i-clock', reward: 1.2, daily: 5, desc: '进入指定直播间停留满 60 秒' }
  ];
  function seedDB() {
    var tasks = seedTasks();
    var budget = tasks.reduce(function (s, t) {
      var unit = t.mode === 'fixed' ? t.reward : (t.mode === 'per' ? t.reward * 12 : t.reward * 4);
      return s + unit * Math.min(t.capacity - t.taken, 200);
    }, 0);
    return {
      users: [],
      sessions: {},
      tasks: tasks,
      orders: [],
      contents: [],
      recharges: [],
      withdrawals: [],
      txs: [],
      interactLog: [],
      escrow: Math.round(budget * 100) / 100,  // 官方任务预存托管池
      escrowSeed: Math.round(budget * 100) / 100
    };
  }

  /* ---------------- 账本 ---------------- */
  var EARN_TYPES = ['task_income', 'interact', 'checkin', 'invite_bonus']; // 计入累计收益/榜单的类型
  function txr(n) { return Math.round(n * 100) / 100; }
  function addTx(userId, type, title, amount) {
    var t = { id: uid('tx'), userId: userId, type: type, title: title, amount: txr(amount), at: Date.now() };
    db.txs.push(t);
    if (db.txs.length > 5000) db.txs.splice(0, 1000);
    return t;
  }
  function credit(user, amount, type, title) {
    amount = txr(amount);
    user.balance = txr(user.balance + amount);
    if (EARN_TYPES.indexOf(type) >= 0) user.totalEarn = txr((user.totalEarn || 0) + amount);
    addTx(user.id, type, title, amount);
  }
  function debit(user, amount, type, title) {
    amount = txr(amount);
    user.balance = txr(user.balance - amount);
    addTx(user.id, type, title, -amount);
  }

  // 任务托管预算：商家显式冻结额；官方种子任务按模式估算
  var MODE_EST = { fixed: 1, per: 12 };
  function taskBudget(t) {
    if (t.budget) return t.budget;
    var mult = MODE_EST[t.mode] || 4;
    return txr(t.reward * mult * t.capacity);
  }

  /* ---------------- 认证 ---------------- */
  function getUserByToken(req) {
    var auth = req.headers['authorization'] || '';
    var token = auth.replace(/^Bearer\s+/i, '');
    if (!token) return null;
    var s = db.sessions[token];
    if (!s) return null;
    return db.users.filter(function (u) { return u.id === s.userId; })[0] || null;
  }
  function publicUser(u) {
    return {
      id: u.id, name: u.display, uname: u.name, role: u.role,
      balance: u.balance, totalEarn: u.totalEarn || 0, totalWithdraw: u.totalWithdraw || 0,
      inviteCode: u.inviteCode, createdAt: u.createdAt
    };
  }

  /* ---------------- 业务：结算 ---------------- */
  function settleAmount(t) {
    if (t.mode === 'fixed') return t.reward;
    if (t.mode === 'per') return txr(t.reward * rnd(5, 20));
    return txr(Math.round(t.reward * rnd(20, 60)) / 10);
  }
  function settleOrder(order) {
    if (order.status !== 'review') return;
    var t = db.tasks.filter(function (x) { return x.id === order.taskId; })[0];
    var u = db.users.filter(function (x) { return x.id === order.userId; })[0];
    if (!t || !u) { order.status = 'settled'; return; }
    // 结算额以任务剩余托管预算封顶，防止非固定价模式击穿托管池
    var remaining = txr(taskBudget(t) - (t.spend || 0));
    var paid = Math.min(settleAmount(t), remaining);
    if (paid <= 0.005) {
      // 预算耗尽：任务自动停投，订单留在审核队列由运营处理
      t.status = 'off';
      saveDB();
      sendTo(t.merchantId, { type: 'task_paused', title: t.title });
      broadcast({ type: 'refresh' });
      return;
    }
    // 商家任务从托管池划付；官方任务由平台预存托管池支付
    db.escrow = txr(db.escrow - paid);
    t.spend = txr((t.spend || 0) + paid);
    order.status = 'settled';
    order.paid = paid;
    order.settledAt = Date.now();
    credit(u, paid, 'task_income', '任务结算 · ' + t.title.slice(0, 14) + '…');
    // 邀请返佣：达人获得任务收益时，邀请人得 10%（平台补贴，不扣达人）
    if (u.invitedBy) {
      var inviter = db.users.filter(function (x) { return x.id === u.invitedBy; })[0];
      if (inviter) {
        var bonus = txr(paid * 0.1);
        if (bonus > 0) {
          credit(inviter, bonus, 'invite_bonus', '邀请返佣 · ' + u.display + ' 的任务收益');
          sendTo(inviter.id, { type: 'invite_bonus', amount: bonus, from: u.display });
        }
      }
    }
    saveDB();
    sendTo(u.id, { type: 'order_settled', paid: paid, title: t.title, orderId: order.id });
    sendTo(t.merchantId, { type: 'campaign_spend', title: t.title, paid: paid });
    broadcast({ type: 'refresh' });
  }
  function sweepReviewOrders() {
    var now = Date.now();
    var changed = false;
    db.orders.forEach(function (o) {
      if (o.status === 'review' && o.settleAt && now >= o.settleAt) { settleOrder(o); changed = true; }
    });
    // 定时发布到点自动上线
    db.contents.forEach(function (c) {
      if (c.scheduledAt && c.status === 'scheduled' && now >= c.scheduledAt) {
        Object.keys(c.platforms).forEach(function (p) {
          if (c.platforms[p] === '定时中') c.platforms[p] = '已发布';
        });
        c.status = 'published';
        changed = true;
        sendTo(c.userId, { type: 'content_published', title: c.title });
      }
    });
    if (changed) { saveDB(); broadcast({ type: 'refresh' }); }
    // 截止天数随时间递减
    db.tasks.forEach(function (t) {
      if (t.deadlineAt) t.daysLeft = Math.max(0, Math.ceil((t.deadlineAt - now) / 86400000));
    });
  }
  // 统一过期时间：种子任务以首次启动为基准，商家任务以创建时间为基准
  function normalizeTasks() {
    db.tasks.forEach(function (t) {
      if (!t.deadlineAt) t.deadlineAt = Date.now() + (t.daysLeft || 7) * 86400000;
      t.daysLeft = Math.max(0, Math.ceil((t.deadlineAt - Date.now()) / 86400000));
    });
  }

  /* ---------------- 支付宝适配器（RSA2，配置商户密钥后启用） ---------------- */
  function alipayBuildPayUrl(recharge) {
    var cfg = CONFIG.alipay;
    var params = {
      app_id: cfg.appId,
      method: 'alipay.trade.page.pay',
      format: 'JSON',
      charset: 'utf-8',
      sign_type: 'RSA2',
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
      version: '1.0',
      return_url: cfg.returnUrl,
      notify_url: cfg.notifyUrl,
      biz_content: JSON.stringify({
        out_trade_no: recharge.id,
        product_code: 'FAST_INSTANT_TRADE_PAY',
        total_amount: recharge.amount.toFixed(2),
        subject: '光体•财无界 账户充值'
      })
    };
    var keys = Object.keys(params).sort();
    var signStr = keys.map(function (k) { return k + '=' + params[k]; }).join('&');
    var signer = crypto.createSign('RSA-SHA256');
    signer.update(signStr, 'utf8');
    params.sign = signer.sign(cfg.privateKey, 'base64');
    var query = keys.map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
    query += '&sign=' + encodeURIComponent(params.sign);
    return cfg.gateway + '?' + query;
  }
  // 支付宝异步通知验签（真实环境回调）
  function alipayVerifyNotify(postBody) {
    var cfg = CONFIG.alipay;
    var sign = postBody.sign;
    if (!sign) return false;
    var keys = Object.keys(postBody).filter(function (k) { return k !== 'sign' && k !== 'sign_type'; }).sort();
    var signStr = keys.map(function (k) { return k + '=' + postBody[k]; }).join('&');
    var verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(signStr, 'utf8');
    return verifier.verify(cfg.privateKey, sign, 'base64');
  }

  /* ---------------- HTTP 基础 ---------------- */
  function json(res, code, obj) {
    var body = JSON.stringify(obj);
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(body);
  }
  function readBody(req) {
    return new Promise(function (resolve) {
      var data = '';
      req.on('data', function (c) { data += c; if (data.length > 2e6) req.destroy(); });
      req.on('end', function () {
        try { resolve(data ? JSON.parse(data) : {}); return; } catch (e) { /* 非 JSON，按表单解析 */ }
        var out = {};
        data.split('&').forEach(function (kv) {
          var p = kv.split('=');
          if (p[0]) out[decodeURIComponent(p[0])] = decodeURIComponent((p[1] || '').replace(/\+/g, ' '));
        });
        resolve(out);
      });
    });
  }
  function readFormBody(req) {
    return new Promise(function (resolve) {
      var data = '';
      req.on('data', function (c) { data += c; if (data.length > 2e6) req.destroy(); });
      req.on('end', function () {
        var out = {};
        data.split('&').forEach(function (kv) {
          var p = kv.split('=');
          if (p[0]) out[decodeURIComponent(p[0])] = decodeURIComponent((p[1] || '').replace(/\+/g, ' '));
        });
        resolve(out);
      });
    });
  }

  /* ---------------- 支付沙箱页 ---------------- */
  function sandboxPage(res, recharge, user) {
    var ok = recharge.status !== 'pending';
    var html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>收银台 · 光体•财无界</title><style>' +
      'body{margin:0;font-family:"PingFang SC","Microsoft YaHei",sans-serif;background:#0d1024;color:#eef0ff;display:grid;place-items:center;min-height:100vh}' +
      '.box{width:min(420px,92vw);background:#131633;border:1px solid rgba(255,255,255,.1);border-radius:20px;padding:30px;text-align:center}' +
      'h1{font-size:17px;margin:0 0 18px;color:#8a90b8;font-weight:600}' +
      '.amt{font-size:42px;font-weight:800;background:linear-gradient(120deg,#f6c453,#ff8f6b,#8b7bff);-webkit-background-clip:text;background-clip:text;color:transparent;margin:8px 0 2px}' +
      '.row{display:flex;justify-content:space-between;font-size:13px;color:#9aa0c3;padding:10px 4px;border-bottom:1px dashed rgba(255,255,255,.1)}' +
      '.row b{color:#eef0ff}' +
      '.tip{font-size:12px;color:#8a90b8;margin:16px 0 20px;line-height:1.7}' +
      'button{width:100%;padding:13px;border:none;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer;margin-top:10px}' +
      '.pay{background:linear-gradient(120deg,#f6c453,#ff8f6b);color:#fff}' +
      '.cancel{background:transparent;border:1px solid rgba(255,255,255,.2);color:#9aa0c3}' +
      '.done{color:#3ddc97;font-size:15px;font-weight:700}' +
      '</style></head><body><div class="box">' +
      '<h1>光体•财无界 · 沙箱收银台</h1>' +
      '<div class="amt">¥' + recharge.amount.toFixed(2) + '</div>' +
      '<div class="row"><span>商户订单号</span><b>' + recharge.id + '</b></div>' +
      '<div class="row"><span>收款账户</span><b>' + user.display + '</b></div>' +
      '<div class="row"><span>支付渠道</span><b>沙箱支付（模拟银行/支付宝通道）</b></div>' +
      (ok
        ? '<p class="done">✔ 支付已完成，余额已到账</p><button class="cancel" onclick="location.href=\'/#/wallet\'">返回平台</button>'
        : '<p class="tip">这是平台内置的沙箱收银台，用于完整演练「下单 → 支付 → 到账」资金流。<br>在生产环境配置支付宝/微信商户密钥后，本页面将替换为真实收银台。</p>' +
          '<button class="pay" onclick="pay(true)">模拟支付成功</button>' +
          '<button class="cancel" onclick="pay(false)">取消支付</button>' +
          '<script>function pay(ok){fetch("/api/pay/sandbox/' + recharge.id + '/" + (ok ? "confirm" : "cancel"),{method:"POST"}).then(function(){location.href="/#/wallet"})}<\/script>') +
      '</div></body></html>';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }

  /* ---------------- SSE 实时推送 ---------------- */
  var sseClients = [];
  function sseSend(client, obj) {
    try {
      client.res.write('data: ' + JSON.stringify(obj) + '\n\n');
      return true;
    } catch (e) { return false; }
  }
  function broadcast(obj) {
    var dead = [];
    sseClients.forEach(function (c) { if (!sseSend(c, obj)) dead.push(c); });
    dead.forEach(function (c) {
      var i = sseClients.indexOf(c);
      if (i >= 0) sseClients.splice(i, 1);
    });
  }
  function sendTo(userId, obj) {
    var dead = [];
    sseClients.forEach(function (c) {
      if (c.userId === userId && !sseSend(c, obj)) dead.push(c);
    });
    dead.forEach(function (c) {
      var i = sseClients.indexOf(c);
      if (i >= 0) sseClients.splice(i, 1);
    });
  }
  setInterval(function () { broadcast({ type: 'hb' }); }, 25000);

  /* ---------------- API 路由 ---------------- */
  var API = {};
  // 统一包装：需要登录的接口传 needUser
  function route(method, pattern, handler, needUser) {
    API[method + ' ' + pattern] = { handler: handler, needUser: !!needUser };
  }
  function matchRoute(method, pathname) {
    var parts = pathname.split('/').filter(Boolean);
    for (var key in API) {
      if (key.indexOf(method + ' ') !== 0) continue;
      var pp = key.slice(method.length + 1).split('/').filter(Boolean);
      if (pp.length !== parts.length) continue;
      var params = {}, ok = true;
      for (var i = 0; i < pp.length; i++) {
        if (pp[i][0] === ':') params[pp[i].slice(1)] = decodeURIComponent(parts[i]);
        else if (pp[i] !== parts[i]) { ok = false; break; }
      }
      if (ok) return { def: API[key], params: params };
    }
    return null;
  }

  // ---- SSE 实时流 ----
  route('GET', '/api/stream', function (ctx) {
    ctx.res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'Connection': 'keep-alive'
    });
    ctx.res.write(':connected\n\n');
    var client = { res: ctx.res, userId: ctx.user ? ctx.user.id : null };
    sseClients.push(client);
    ctx.req.on('close', function () {
      var i = sseClients.indexOf(client);
      if (i >= 0) sseClients.splice(i, 1);
    });
  });

  // ---- 认证 ----
  route('POST', '/api/auth/register', function (ctx) {
    var b = ctx.body;
    var uname = String(b.uname || '').trim().toLowerCase();
    var pwd = String(b.password || '');
    var role = b.role === 'merchant' ? 'merchant' : 'creator';
    if (!/^[\w\u4e00-\u9fa5-]{2,16}$/.test(uname)) return json(ctx.res, 400, { error: '用户名需 2-16 位（中文、字母、数字、下划线）' });
    if (pwd.length < 6) return json(ctx.res, 400, { error: '密码至少 6 位' });
    if (db.users.some(function (u) { return u.name === uname; })) return json(ctx.res, 400, { error: '用户名已被注册' });
    var salt = crypto.randomBytes(8).toString('hex');
    var user = {
      id: uid('u'), name: uname, display: uname, salt: salt, passHash: hashPassword(pwd, salt),
      role: role, balance: 0, totalEarn: 0, totalWithdraw: 0,
      checkins: {}, createdAt: Date.now(),
      inviteCode: 'GT-' + crypto.randomBytes(2).toString('hex').toUpperCase()
    };
    // 邀请绑定：返佣在受邀人获得任务收益时按 10% 发放
    var inviteCode = String(b.inviteCode || '').trim().toUpperCase();
    if (inviteCode) {
      var inviter = db.users.filter(function (x) { return x.inviteCode === inviteCode; })[0];
      if (inviter) user.invitedBy = inviter.id;
    }
    db.users.push(user);
    var grant = CONFIG.grants[role] || 0;
    if (grant > 0) credit(user, grant, 'grant', role === 'merchant' ? '商家开业广告金（新客礼包）' : '新人见面礼（新客礼包）');
    var token = crypto.randomBytes(24).toString('hex');
    db.sessions[token] = { userId: user.id, at: Date.now() };
    saveDB();
    json(ctx.res, 200, { token: token, user: publicUser(user) });
  });
  route('POST', '/api/auth/login', function (ctx) {
    var uname = String(ctx.body.uname || '').trim().toLowerCase();
    var pwd = String(ctx.body.password || '');
    var user = db.users.filter(function (u) { return u.name === uname; })[0];
    if (!user || hashPassword(pwd, user.salt) !== user.passHash) return json(ctx.res, 400, { error: '用户名或密码错误' });
    var token = crypto.randomBytes(24).toString('hex');
    db.sessions[token] = { userId: user.id, at: Date.now() };
    saveDB();
    json(ctx.res, 200, { token: token, user: publicUser(user) });
  });
  route('GET', '/api/auth/me', function (ctx) {
    json(ctx.res, 200, { user: ctx.user ? publicUser(ctx.user) : null });
  }, true);

  // ---- 任务 ----
  route('GET', '/api/tasks', function (ctx) {
    sweepReviewOrders();
    var q = ctx.query;
    var list = db.tasks.filter(function (t) {
      if (q.platform && q.platform !== 'all' && t.platform !== q.platform) return false;
      if (q.mode && q.mode !== 'all' && t.mode !== q.mode) return false;
      if (q.q) {
        var s = (t.title + t.merchant).toLowerCase();
        if (s.indexOf(String(q.q).toLowerCase()) < 0) return false;
      }
      return true;
    });
    var sorters = {
      'new': function (a, b) { return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.pubAt - a.pubAt; },
      'price': function (a, b) { return b.reward - a.reward; },
      'left': function (a, b) { return (b.capacity - b.taken) - (a.capacity - a.taken); },
      'ai': function (a, b) { return b.aiScore - a.aiScore; }
    };
    list = list.slice().sort(sorters[q.sort] || sorters.new);
    var acceptedIds = {};
    if (ctx.user) db.orders.forEach(function (o) { if (o.userId === ctx.user.id) acceptedIds[o.taskId] = 1; });
    json(ctx.res, 200, {
      tasks: list.map(function (t) {
        return Object.assign({}, t, { accepted: !!acceptedIds[t.id], merchantName: t.merchant });
      })
    });
  });
  route('POST', '/api/tasks', function (ctx) {
    var u = ctx.user, b = ctx.body;
    // 双角色平台：任何账号均可作为投放方发布任务，真实约束是余额与托管预算
    var platforms = Array.isArray(b.platforms) && b.platforms.length ? b.platforms : ['xhs'];
    var reward = txr(Number(b.reward) || 0), capacity = Math.floor(Number(b.capacity) || 0);
    var days = Math.min(90, Math.max(1, Math.floor(Number(b.days) || 7)));
    if (!String(b.title || '').trim()) return json(ctx.res, 400, { error: '请填写任务名称' });
    if (!(reward > 0)) return json(ctx.res, 400, { error: '任务单价无效' });
    if (!(capacity > 0)) return json(ctx.res, 400, { error: '接单名额无效' });
    var budget = txr(reward * capacity);
    if (u.balance < budget) return json(ctx.res, 400, { error: '余额不足：需预存托管预算 ¥' + budget.toFixed(2) + '，当前 ¥' + u.balance.toFixed(2) + '，请先充值', need: budget });
    // 资金托管：预算从商家余额冻结进平台托管池
    debit(u, budget, 'freeze', '任务托管预算冻结 · ' + String(b.title).slice(0, 14));
    db.escrow = txr(db.escrow + budget);
    var reqs = String(b.reqs || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    var t = {
      id: uid('T'), title: String(b.title).trim(), platform: platforms[0], platforms: platforms, mode: b.mode || 'fixed',
      reward: reward, unit: { fixed: '每篇可赚', cpe: '每次互动', cpm: '千次播放', ladder: '每篇最高', milestone: '封顶可赚', per: '每次可赚' }[b.mode || 'fixed'],
      capacity: capacity, taken: 0, tags: ['新'], fanMin: Math.max(0, Math.floor(Number(b.fanMin) || 0)),
      aiScore: rnd(80, 95), daysLeft: days, pubDaysAgo: 0, pubAt: Date.now(), cover: rnd(0, 5),
      merchant: u.display, merchantId: u.id, budget: budget, spend: 0, status: 'on', pinned: false, oneKey: false,
      desc: String(b.desc || '').trim() || '商家暂未填写任务说明，可直接沟通确认创作方向。',
      reqs: reqs.length ? reqs : ['内容需为原创', '需带指定话题标签'],
      steps: ['接受任务', '创作并发布内容', '回填作品链接', '审核通过自动结算']
    };
    db.tasks.unshift(t);
    saveDB();
    broadcast({ type: 'refresh' });
    json(ctx.res, 200, { task: t, balance: u.balance });
  }, true);
  route('GET', '/api/tasks/:id', function (ctx) {
    var t = db.tasks.filter(function (x) { return x.id === ctx.params.id; })[0];
    if (!t) return json(ctx.res, 404, { error: '任务不存在' });
    json(ctx.res, 200, { task: t });
  });
  route('POST', '/api/campaigns/:id/status', function (ctx) {
    var u = ctx.user;
    var t = db.tasks.filter(function (x) { return x.id === ctx.params.id && x.merchantId === u.id; })[0];
    if (!t) return json(ctx.res, 404, { error: '任务不存在' });
    t.status = t.status === 'on' ? 'off' : 'on';
    saveDB();
    broadcast({ type: 'refresh' });
    json(ctx.res, 200, { task: t });
  }, true);

  // ---- 订单 ----
  route('POST', '/api/orders', function (ctx) {
    var u = ctx.user;
    var t = db.tasks.filter(function (x) { return x.id === ctx.body.taskId; })[0];
    if (!t) return json(ctx.res, 404, { error: '任务不存在' });
    if (t.status === 'off') return json(ctx.res, 400, { error: '任务已暂停接单' });
    if (t.deadlineAt && Date.now() > t.deadlineAt) return json(ctx.res, 400, { error: '任务已过截止时间' });
    if (t.taken >= t.capacity) return json(ctx.res, 400, { error: '来晚一步，名额已被抢光' });
    if (db.orders.some(function (o) { return o.userId === u.id && o.taskId === t.id && o.status !== 'settled'; }))
      return json(ctx.res, 400, { error: '你已接受过该任务' });
    var order = { id: uid('o'), taskId: t.id, userId: u.id, acceptedAt: Date.now(), status: 'todo', link: '', paid: 0 };
    db.orders.push(order);
    t.taken++;
    saveDB();
    broadcast({ type: 'refresh' });
    json(ctx.res, 200, { order: order });
  }, true);
  route('GET', '/api/orders/my', function (ctx) {
    sweepReviewOrders();
    var u = ctx.user;
    var orders = db.orders.filter(function (o) { return o.userId === u.id; }).slice().reverse().map(function (o) {
      var t = db.tasks.filter(function (x) { return x.id === o.taskId; })[0] || {};
      return Object.assign({}, o, { title: t.title, platform: t.platform, mode: t.mode, reward: t.reward });
    });
    json(ctx.res, 200, { orders: orders });
  }, true);
  route('POST', '/api/orders/:id/submit', function (ctx) {
    var u = ctx.user;
    var order = db.orders.filter(function (o) { return o.id === ctx.params.id && o.userId === u.id; })[0];
    if (!order) return json(ctx.res, 404, { error: '订单不存在' });
    if (order.status !== 'todo') return json(ctx.res, 400, { error: '当前状态不可提交' });
    var link = String(ctx.body.link || '').trim();
    if (!/^https?:\/\/.+/.test(link)) return json(ctx.res, 400, { error: '请粘贴以 http(s):// 开头的作品链接' });
    order.link = link;
    order.status = 'review';
    order.settleAt = Date.now() + 5000; // 平台审核窗口（演示 5 秒）
    saveDB();
    broadcast({ type: 'refresh' });
    json(ctx.res, 200, { order: order });
  }, true);

  // ---- 内容 ----
  route('POST', '/api/contents', function (ctx) {
    var u = ctx.user, b = ctx.body;
    var title = String(b.title || '').trim();
    if (!title) return json(ctx.res, 400, { error: '请填写标题' });
    var platforms = {};
    (Array.isArray(b.platforms) ? b.platforms : []).forEach(function (p) {
      platforms[p] = b.schedule ? '定时中' : (Math.random() > 0.25 ? '已发布' : '审核中');
    });
    if (!Object.keys(platforms).length) return json(ctx.res, 400, { error: '至少选择一个发布平台' });
    // 配图（dataURL，最多 3 张、单张 ≤ 300KB）
    var images = (Array.isArray(b.images) ? b.images : [])
      .filter(function (s) { return typeof s === 'string' && s.indexOf('data:image/') === 0 && s.length < 400000; })
      .slice(0, 3);
    var scheduledAt = 0;
    if (b.schedule) {
      scheduledAt = Date.parse(b.schedule);
      if (!scheduledAt || scheduledAt < Date.now() - 60000) return json(ctx.res, 400, { error: '定时发布时间无效（需为未来时间）' });
    }
    var c = {
      id: uid('c'), userId: u.id, title: title, text: String(b.text || '').slice(0, 600),
      platforms: platforms, images: images, createdAt: Date.now(),
      scheduledAt: scheduledAt, status: scheduledAt ? 'scheduled' : 'published',
      stats: { views: rnd(50, 600), likes: rnd(5, 80), comments: rnd(0, 20) }
    };
    db.contents.push(c);
    saveDB();
    broadcast({ type: 'refresh' });
    var pub = Object.assign({}, c);
    delete pub.images; // 列表不回传大图，仅展示缩略用时另取
    json(ctx.res, 200, { content: pub });
  }, true);
  route('GET', '/api/contents/mine', function (ctx) {
    sweepReviewOrders();
    var list = db.contents.filter(function (c) { return c.userId === ctx.user.id; }).slice().reverse().map(function (c) {
      var pub = Object.assign({}, c);
      pub.thumb = (c.images && c.images[0]) || '';
      delete pub.images;
      return pub;
    });
    json(ctx.res, 200, { contents: list });
  }, true);

  // ---- 互动 ----
  route('GET', '/api/interact', function (ctx) {
    var u = ctx.user, today = todayStr();
    var done = {}, cooldown = {};
    db.interactLog.forEach(function (l) {
      if (l.userId !== u.id) return;
      var d = new Date(l.at);
      var ds = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      if (ds === today) done[l.defId] = (done[l.defId] || 0) + 1;
      var left = 12 - Math.floor((Date.now() - l.at) / 1000);
      if (left > 0 && (!cooldown[l.defId] || left > cooldown[l.defId])) cooldown[l.defId] = left;
    });
    json(ctx.res, 200, { defs: INTERACT_DEFS, done: done, cooldown: cooldown });
  }, true);
  route('POST', '/api/interact/:defId', function (ctx) {
    var u = ctx.user;
    var def = INTERACT_DEFS.filter(function (d) { return d.id === ctx.params.defId; })[0];
    if (!def) return json(ctx.res, 404, { error: '任务不存在' });
    var today = todayStr();
    var doneToday = db.interactLog.filter(function (l) {
      return l.userId === u.id && l.defId === def.id &&
        new Date(l.at).toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10);
    }).length;
    if (doneToday >= def.daily) return json(ctx.res, 400, { error: '该任务今日次数已用完' });
    var last = db.interactLog.filter(function (l) { return l.userId === u.id && l.defId === def.id; }).slice(-1)[0];
    if (last && Date.now() - last.at < 12000) return json(ctx.res, 400, { error: '操作过于频繁，稍后再试' });
    db.interactLog.push({ id: uid('il'), userId: u.id, defId: def.id, at: Date.now() });
    credit(u, def.reward, 'interact', '互动任务 · ' + def.type);
    saveDB();
    broadcast({ type: 'refresh' });
    json(ctx.res, 200, { reward: def.reward, balance: u.balance });
  }, true);

  // ---- 打卡 ----
  route('GET', '/api/checkin', function (ctx) {
    var u = ctx.user, t = todayStr();
    var streak = 0, i = 0;
    while (u.checkins[daysAgoStr(i)]) { streak++; i++; }
    var reward = txr(Math.min(0.3 + streak * 0.1, 2.0));
    json(ctx.res, 200, {
      days: u.checkins, streak: streak, doneToday: !!u.checkins[t],
      nextReward: u.checkins[t] ? null : reward
    });
  }, true);
  route('POST', '/api/checkin', function (ctx) {
    var u = ctx.user, t = todayStr();
    if (u.checkins[t]) return json(ctx.res, 400, { error: '今天已经打卡过啦' });
    u.checkins[t] = true;
    var streak = 0, i = 0;
    while (u.checkins[daysAgoStr(i)]) { streak++; i++; }
    var reward = txr(Math.min(0.3 + (streak - 1) * 0.1, 2.0));
    if (streak % 7 === 0) reward = txr(reward + 5);
    credit(u, reward, 'checkin', 'AI 打卡 · 连续 ' + streak + ' 天');
    saveDB();
    broadcast({ type: 'refresh' });
    json(ctx.res, 200, { streak: streak, reward: reward, balance: u.balance });
  }, true);

  // ---- 钱包 ----
  route('GET', '/api/wallet', function (ctx) {
    var u = ctx.user, today = todayStr();
    var daily = {}, i;
    for (i = 6; i >= 0; i--) daily[daysAgoStr(i)] = 0;
    db.txs.forEach(function (t) {
      if (t.userId !== u.id || t.amount <= 0 || EARN_TYPES.indexOf(t.type) < 0) return;
      var d = new Date(t.at);
      var ds = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      if (ds in daily) daily[ds] = txr(daily[ds] + t.amount);
    });
    var tx = db.txs.filter(function (t) { return t.userId === u.id; }).slice(-40).reverse();
    var withdrawals = db.withdrawals.filter(function (w) { return w.userId === u.id; }).slice(-5).reverse();
    json(ctx.res, 200, {
      balance: u.balance, totalEarn: u.totalEarn || 0, totalWithdraw: u.totalWithdraw || 0,
      today: daily[today] || 0, daily: daily, tx: tx, withdrawals: withdrawals
    });
  }, true);
  route('POST', '/api/wallet/recharge', function (ctx) {
    var u = ctx.user;
    var amount = txr(Number(ctx.body.amount) || 0);
    if (!(amount >= 1)) return json(ctx.res, 400, { error: '充值金额至少 ¥1' });
    if (amount > 50000) return json(ctx.res, 400, { error: '单笔充值不得超过 ¥50,000' });
    var channel = (ctx.body.channel === 'alipay' && CONFIG.alipay.enabled) ? 'alipay' : 'sandbox';
    var r = { id: uid('R'), userId: u.id, amount: amount, channel: channel, status: 'pending', createdAt: Date.now() };
    db.recharges.push(r);
    saveDB();
    if (channel === 'alipay') {
      r.payUrl = alipayBuildPayUrl(r);
      json(ctx.res, 200, { recharge: { id: r.id }, redirect: r.payUrl });
    } else {
      json(ctx.res, 200, { recharge: { id: r.id }, redirect: '/pay/sandbox/' + r.id });
    }
  }, true);
  route('POST', '/api/pay/sandbox/:id/confirm', function (ctx) {
    var r = db.recharges.filter(function (x) { return x.id === ctx.params.id; })[0];
    if (!r) return json(ctx.res, 404, { error: '订单不存在' });
    if (r.status !== 'pending') return json(ctx.res, 400, { error: '订单状态已变化' });
    var u = db.users.filter(function (x) { return x.id === r.userId; })[0];
    r.status = 'paid';
    r.paidAt = Date.now();
    credit(u, r.amount, 'recharge', '账户充值（' + (r.channel === 'alipay' ? '支付宝' : '沙箱支付') + '）');
    saveDB();
    broadcast({ type: 'refresh' });
    json(ctx.res, 200, { ok: true, balance: u.balance });
  });
  route('POST', '/api/pay/sandbox/:id/cancel', function (ctx) {
    var r = db.recharges.filter(function (x) { return x.id === ctx.params.id; })[0];
    if (r && r.status === 'pending') { r.status = 'cancelled'; saveDB(); }
    json(ctx.res, 200, { ok: true });
  });
  // 支付宝异步通知（生产环境）
  route('POST', '/api/pay/alipay/notify', function (ctx) {
    if (!CONFIG.alipay.enabled) return json(ctx.res, 400, { error: '未启用' });
    if (!alipayVerifyNotify(ctx.body)) return json(ctx.res, 400, { error: '验签失败' });
    var r = db.recharges.filter(function (x) { return x.id === ctx.body.out_trade_no; })[0];
    if (r && r.status === 'pending' && ctx.body.trade_status === 'TRADE_SUCCESS') {
      var u = db.users.filter(function (x) { return x.id === r.userId; })[0];
      r.status = 'paid';
      credit(u, r.amount, 'recharge', '账户充值（支付宝）');
      saveDB();
    }
    ctx.res.writeHead(200, { 'Content-Type': 'text/plain' });
    ctx.res.end('success');
  });
  route('POST', '/api/wallet/withdraw', function (ctx) {
    var u = ctx.user;
    var amount = txr(Number(ctx.body.amount) || 0);
    if (!(amount >= 10)) return json(ctx.res, 400, { error: '提现金额需满 ¥10' });
    if (amount > u.balance) return json(ctx.res, 400, { error: '余额不足' });
    var w = { id: uid('W'), userId: u.id, amount: amount, status: 'pending', createdAt: Date.now() };
    db.withdrawals.push(w);
    debit(u, amount, 'withdraw', '提现申请（受理中）');
    u.totalWithdraw = txr((u.totalWithdraw || 0) + amount);
    saveDB();
    broadcast({ type: 'refresh' });
    json(ctx.res, 200, { withdrawal: w, balance: u.balance });
  }, true);

  // ---- 商家看板 ----
  route('GET', '/api/merchant/dashboard', function (ctx) {
    var u = ctx.user;
    var mine = db.tasks.filter(function (t) { return t.merchantId === u.id; });
    var orders = db.orders.filter(function (o) { return mine.some(function (t) { return t.id === o.taskId; }); });
    // 消耗口径：仅统计真实结算金额（冻结不是消耗）
    var daily = {}, i;
    for (i = 6; i >= 0; i--) daily[daysAgoStr(i)] = 0;
    orders.forEach(function (o) {
      if (o.status !== 'settled' || !o.settledAt) return;
      var d = new Date(o.settledAt);
      var ds = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      if (ds in daily) daily[ds] = txr(daily[ds] + (o.paid || 0));
    });
    json(ctx.res, 200, {
      onTasks: mine.filter(function (t) { return t.status === 'on'; }).length,
      orders: orders.length,
      settled: orders.filter(function (o) { return o.status === 'settled'; }).length,
      spend: txr(mine.reduce(function (s, t) { return s + (t.spend || 0); }, 0)),
      escrowFrozen: txr(mine.reduce(function (s, t) { return s + (t.status === 'on' ? (taskBudget(t) - (t.spend || 0)) : 0); }, 0)),
      daily: daily
    });
  }, true);
  route('GET', '/api/campaigns/mine', function (ctx) {
    var u = ctx.user;
    var mine = db.tasks.filter(function (t) { return t.merchantId === u.id; }).slice().reverse();
    json(ctx.res, 200, { campaigns: mine });
  }, true);

  // ---- 龙虎榜 ----
  route('GET', '/api/rank', function (ctx) {
    var creators = db.users.filter(function (u) { return u.role === 'creator'; });
    var list = creators.map(function (u) { return { name: u.display, amt: u.totalEarn || 0 }; });
    // 官方种子榜（营造冷启动氛围，标注为演示数据）
    [['星河拾光', 28460.5], ['无界漫游者', 23118], ['阿岚的镜头', 19987.6], ['快门手 Ken', 17422],
     ['南方有风', 15876.3], ['宅宅测评室', 13240], ['山城小面加蛋', 11208.9], ['喵酱不加班', 9877.4]]
      .forEach(function (s) { list.push({ name: s[0], amt: s[1], seed: true }); });
    list.sort(function (a, b) { return b.amt - a.amt; });
    var me = null;
    if (ctx.user) {
      var myAmt = ctx.user.totalEarn || 0;
      var rank = list.filter(function (x) { return x.amt > myAmt; }).length + 1;
      me = { rank: rank, amount: myAmt };
    }
    json(ctx.res, 200, { list: list.slice(0, 9), me: me });
  });

  // ---- 管理（运营用，ADMIN_KEY 鉴权）----
  route('POST', '/api/admin/withdrawals/:id/settle', function (ctx) {
    if ((ctx.req.headers['x-admin-key'] || '') !== CONFIG.adminKey) return json(ctx.res, 403, { error: '无权限' });
    var w = db.withdrawals.filter(function (x) { return x.id === ctx.params.id; })[0];
    if (!w) return json(ctx.res, 404, { error: '不存在' });
    w.status = 'paid';
    w.paidAt = Date.now();
    saveDB();
    broadcast({ type: 'refresh' });
    json(ctx.res, 200, { withdrawal: w });
  });
  route('GET', '/api/admin/withdrawals', function (ctx) {
    if ((ctx.req.headers['x-admin-key'] || '') !== CONFIG.adminKey) return json(ctx.res, 403, { error: '无权限' });
    json(ctx.res, 200, { withdrawals: db.withdrawals.slice().reverse() });
  });

  /* ---------------- 静态资源 ---------------- */
  var MIME = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
  };
  function serveStatic(req, res, pathname) {
    if (pathname === '/') pathname = '/index.html';
    var file = path.join(ROOT, path.normalize(pathname).replace(/^(\.\.[\/\\])+/, ''));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
    fs.readFile(file, function (err, data) {
      if (err) { res.writeHead(404); return res.end('Not Found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  }

  /* ---------------- 服务器 ---------------- */
  var server = http.createServer(function (req, res) {
    var u = new URL(req.url, 'http://localhost');
    var pathname = u.pathname;

    // 沙箱收银台页面
    var mPay = pathname.match(/^\/pay\/sandbox\/([\w-]+)$/);
    if (mPay) {
      var r = db.recharges.filter(function (x) { return x.id === mPay[1]; })[0];
      if (!r) { res.writeHead(404); return res.end('Not Found'); }
      var owner = db.users.filter(function (x) { return x.id === r.userId; })[0] || { display: '用户' };
      return sandboxPage(res, r, owner);
    }

    // API
    if (pathname.indexOf('/api/') === 0) {
      var m = matchRoute(req.method, pathname);
      if (!m) return json(res, 404, { error: '接口不存在' });
      Promise.all([readBody(req)]).then(function (results) {
        var user = getUserByToken(req);
        if (m.def.needUser && !user) return json(res, 401, { error: '请先登录' });
        var query = {};
        u.searchParams.forEach(function (v, k) { query[k] = v; });
        m.def.handler({ req: req, res: res, body: results[0], user: user, params: m.params, query: query });
      });
      return;
    }

    serveStatic(req, res, pathname);
  });

  loadDB();
  normalizeTasks();
  sweepReviewOrders();
  setInterval(sweepReviewOrders, 30000); // 周期清理：审核结算 / 定时发布 / 截止递减
  server.listen(CONFIG.port, function () {
    console.log('光体•财无界 服务已启动: http://localhost:' + CONFIG.port);
  });
})();
