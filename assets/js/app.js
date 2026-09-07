/* ============================================================
   光体•财无界 — 应用逻辑（API 驱动，服务端为唯一数据源）
   ============================================================ */
(function () {
  'use strict';

  var GT = window.GT;
  var Api = window.Api;

  /* ---------------- 运行时状态 ---------------- */
  var S = {
    role: 'creator',
    route: 'market',
    booted: false,
    filters: { platform: 'all', mode: 'all', sort: 'new', q: '' },
    pubTab: 'compose',
    pubForm: { platforms: ['xhs'], images: [] },
    wizard: null,
    authTab: 'login',
    interactTimer: null,
    drawerTaskId: null,
    notifiedOrders: {}
  };

  // 客户端数据缓存（每次导航从服务端刷新）
  var C = {
    me: null,
    tasks: [],
    orders: [],
    contents: [],
    campaigns: [],
    dash: null,
    wallet: null,
    rank: null,
    interact: { defs: [], done: {}, cooldown: {} },
    checkin: null
  };

  /* ---------------- 小工具 ---------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    n = Number(n) || 0;
    return n % 1 === 0 ? String(n) : n.toFixed(2);
  }
  function icon(name, cls) { return '<svg class="ic ' + (cls || '') + '"><use href="#' + name + '"/></svg>'; }
  function timeAgo(ts) {
    var m = Math.floor((Date.now() - ts) / 60000);
    if (m < 1) return '刚刚';
    if (m < 60) return m + ' 分钟前';
    var h = Math.floor(m / 60);
    if (h < 24) return h + ' 小时前';
    return Math.floor(h / 24) + ' 天前';
  }
  function platBadge(p, sm) {
    var pl = GT.PLATFORMS[p];
    if (!pl) return '';
    return '<span class="plat' + (sm ? ' plat-sm' : '') + '" style="background:' + pl.color + '" title="' + pl.name + '">' + pl.ch + '</span>';
  }
  function modeBadge(mode) {
    var m = GT.MODES[mode];
    return m ? '<span class="badge b-violet">' + esc(m.name) + '</span>' : '';
  }
  function tagBadge(t) {
    var map = {
      '置顶': 'b-gold', '急单': 'b-red', '新': 'b-green', '高佣': 'b-cyan',
      '一键发': 'b-blue', '需报备': 'b-gray', '已抢光': 'b-gray'
    };
    return '<span class="badge ' + (map[t] || 'b-gray') + '">' + (t === '一键发' ? icon('i-bolt', 'ic-sm') : '') + esc(t) + '</span>';
  }
  function levelOf(total) {
    var lv = GT.LEVELS, cur = lv[0], next = null, i;
    for (i = 0; i < lv.length; i++) {
      if (total >= lv[i].min) { cur = lv[i]; next = lv[i + 1] || null; }
    }
    var prog = next ? (total - cur.min) / (next.min - cur.min) : 1;
    return { cur: cur, next: next, prog: Math.min(1, Math.max(0.04, prog)) };
  }

  /* ---------------- Toast ---------------- */
  function toast(msg, type) {
    type = type || 'ok';
    var root = $('#toastRoot');
    var el = document.createElement('div');
    el.className = 'toast ' + type;
    var ic = type === 'ok' ? 'i-check' : type === 'warn' ? 'i-clock' : 'i-close';
    el.innerHTML = icon(ic);
    var span = document.createElement('span');
    span.textContent = msg; // textContent 防止昵称等动态内容注入
    el.appendChild(span);
    root.appendChild(el);
    setTimeout(function () {
      el.classList.add('out');
      setTimeout(function () { el.remove(); }, 260);
    }, 3000);
  }
  function handleErr(e) {
    if (e && e.status === 401) { toast('请先登录后再操作', 'warn'); openAuth('login'); return; }
    var msg = (e && e.message) || '操作失败，请重试';
    if (e && e.message && e.message.indexOf('Failed to fetch') >= 0) msg = '网络连接失败，请确认服务已启动';
    toast(msg, 'err');
  }

  /* ---------------- 图层 ---------------- */
  function closeLayers() {
    $('#layerRoot').innerHTML = '';
    S.drawerTaskId = null;
  }
  function openModal(html) {
    $('#layerRoot').innerHTML = '<div class="modal-mask"><div class="modal">' + html + '</div></div>';
  }
  function openDrawer(html) {
    $('#layerRoot').innerHTML = '<div class="drawer-mask"><aside class="drawer">' + html + '</aside></div>';
  }

  /* ================================================================
     数据刷新（服务端 → 缓存）
     ================================================================ */
  function refreshCurrent() { return refresh(S.route); }
  function refresh(route) {
    var jobs = [];
    switch (route) {
      case 'market':
        jobs.push(Api.tasks(S.filters).then(function (r) { C.tasks = r.tasks; }));
        break;
      case 'my':
        jobs.push(Api.myOrders().then(function (r) { C.orders = r.orders; }));
        break;
      case 'publish':
        jobs.push(Api.myContents().then(function (r) { C.contents = r.contents; }));
        break;
      case 'interact':
        jobs.push(Api.interact().then(function (r) { C.interact = r; }));
        break;
      case 'checkin':
        jobs.push(Api.checkin().then(function (r) { C.checkin = r; }));
        break;
      case 'wallet':
        jobs.push(Api.wallet().then(function (r) {
          C.wallet = r;
          if (C.me) C.me.balance = r.balance;
        }));
        break;
      case 'rank':
        jobs.push(Api.rank().then(function (r) { C.rank = r; }));
        break;
      case 'dash':
        jobs.push(Api.dashboard().then(function (r) { C.dash = r; }));
        jobs.push(Api.campaigns().then(function (r) { C.campaigns = r.campaigns; }));
        break;
      case 'campaigns':
        jobs.push(Api.campaigns().then(function (r) { C.campaigns = r.campaigns; }));
        break;
      case 'create':
        jobs.push(Api.me().then(function (r) { C.me = r.user; }));
        break;
    }
    return Promise.all(jobs);
  }

  /* ================================================================
     导航与路由
     ================================================================ */
  var NAVS = {
    creator: [
      { r: 'market',   n: '任务广场', i: 'i-bolt' },
      { r: 'my',       n: '我的任务', i: 'i-check' },
      { r: 'publish',  n: '发布·内容', i: 'i-send' },
      { r: 'interact', n: '互动大厅', i: 'i-heart' },
      { r: 'checkin',  n: 'AI 打卡', i: 'i-clock' },
      { r: 'wallet',   n: '收益钱包', i: 'i-wallet' },
      { r: 'rank',     n: '龙虎榜', i: 'i-trophy' },
      { r: 'help',     n: '帮助中心', i: 'i-book' }
    ],
    merchant: [
      { r: 'dash',      n: '数据看板', i: 'i-chart' },
      { r: 'create',    n: '发布任务', i: 'i-plus' },
      { r: 'campaigns', n: '任务管理', i: 'i-megaphone' },
      { r: 'help',      n: '帮助中心', i: 'i-book' }
    ]
  };
  var ROUTES = ['market', 'my', 'publish', 'interact', 'checkin', 'wallet', 'rank', 'help', 'dash', 'create', 'campaigns'];
  var MERCHANT_ROUTES = ['dash', 'create', 'campaigns'];

  function parseHash() {
    var h = location.hash.replace(/^#\/?/, '');
    var r = h.split('?')[0] || '';
    return ROUTES.indexOf(r) >= 0 ? r : null;
  }
  function defaultRoute() {
    return '#/' + (S.role === 'merchant' ? 'dash' : 'market');
  }

  async function nav() {
    var r = parseHash();
    if (!r) { location.hash = defaultRoute(); return; }
    S.role = MERCHANT_ROUTES.indexOf(r) >= 0 ? 'merchant' : 'creator';
    S.route = r;
    if (!S.booted) renderLoading();
    try {
      await refresh(r);
    } catch (e) {
      handleErr(e);
      if (e.status === 401) { render(); return; }
    }
    S.booted = true;
    render();
    window.scrollTo(0, 0);
    // 确保激活项可见
    var active = $('#mainNav a.active');
    if (active && active.scrollIntoView) {
      try { active.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { /* 旧浏览器忽略 */ }
    }
  }

  function renderNav() {
    var items = NAVS[S.role];
    var html = items.map(function (it) {
      return '<a href="#/' + it.r + '" class="' + (S.route === it.r ? 'active' : '') + '">' +
        icon(it.i) + esc(it.n) + '</a>';
    }).join('');
    $('#mainNav').innerHTML = html;
    $('#mobileNav').innerHTML = html;
    $all('#roleSwitch .role-btn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-role') === S.role);
    });
  }

  function renderUser() {
    var z = $('#userZone');
    if (C.me) {
      z.innerHTML = '<div class="user-pill" data-action="user-menu">' +
        '<span class="avatar">' + esc(C.me.name.slice(0, 1)) + '</span>' +
        '<span class="user-pill-body"><b>' + esc(C.me.name) + '</b>' +
        '<i>¥' + money(C.me.balance) + '</i></span></div>';
    } else {
      z.innerHTML = '<button class="btn-ghost btn btn-sm" data-action="auth" data-tab="register">注册</button>' +
        '<button class="btn-login" data-action="auth" data-tab="login">登录</button>';
    }
  }

  function renderLoading() {
    $('#app').innerHTML =
      '<div class="loading-wrap"><div class="spinner"></div><p>正在从服务器同步数据…</p></div>';
  }

  /* ================================================================
     视图：任务广场
     ================================================================ */
  function taskCard(t) {
    var full = t.taken >= t.capacity;
    var pct = Math.min(100, Math.round(t.taken / t.capacity * 100));
    var accepted = t.accepted;
    return '<article class="task-card">' +
      '<div class="task-cover" style="background:' + GT.COVERS[(t.cover || 0) % GT.COVERS.length] + '">' +
        '<div class="task-tags">' + (t.pinned ? tagBadge('置顶') : '') + (t.tags || []).filter(function (x) { return x !== '置顶'; }).map(tagBadge).join('') + '</div>' +
        '<span class="badge" style="background:rgba(0,0,0,.35);color:#fff;backdrop-filter:blur(4px)">' + icon('i-robot', 'ic-sm') + 'AI 推荐 ' + t.aiScore + '</span>' +
      '</div>' +
      '<div class="task-body">' +
        '<h3 class="task-title" data-action="open-task" data-id="' + t.id + '">' + esc(t.title) + '</h3>' +
        '<div class="task-settle"><span class="task-reward">¥' + money(t.reward) + '</span>' +
          '<span class="task-reward-unit">' + esc(t.unit) + (t.cap ? ' · ' + esc(t.cap) : '') + '</span></div>' +
        '<div class="task-meta">' +
          '<span>' + platBadge(t.platform, true) + esc((GT.PLATFORMS[t.platform] || {}).name || '') + '</span>' +
          '<span>' + icon('i-clock') + '剩 ' + t.daysLeft + ' 天</span>' +
          '<span>' + icon('i-users') + (t.fanMin >= 1000 ? (t.fanMin / 1000) + 'k' : t.fanMin) + ' 粉可接</span>' +
          modeBadge(t.mode) +
        '</div>' +
        '<div class="task-foot">' +
          '<div class="progress' + (full ? ' full' : '') + '"><i style="width:' + pct + '%"></i></div>' +
          '<span class="quota-text">' + t.taken + '/' + t.capacity + ' 人</span>' +
          (full
            ? '<button class="btn btn-ghost btn-sm" disabled>已抢光</button>'
            : accepted
              ? '<button class="btn btn-soft btn-sm" data-action="go-my">已接受</button>'
              : '<button class="btn btn-primary btn-sm" data-action="accept" data-id="' + t.id + '">接受任务</button>') +
        '</div>' +
      '</div></article>';
  }

  function viewMarket() {
    var f = S.filters;
    var pins = C.tasks.filter(function (t) { return t.pinned; });
    var rest = C.tasks.filter(function (t) { return !t.pinned; });
    var dayAgo = Date.now() - 86400000;
    var newToday = C.tasks.filter(function (t) { return (t.pubAt || 0) > dayAgo; }).length;
    var openRewards = C.tasks.reduce(function (s, t) {
      var unit = t.mode === 'fixed' ? t.reward : (t.mode === 'per' ? t.reward * 12 : t.reward * 4);
      return s + (t.taken < t.capacity ? unit * Math.min(t.capacity - t.taken, 10) : 0);
    }, 0);

    var platChips = '<button class="chip ' + (f.platform === 'all' ? 'active' : '') + '" data-action="f-plat" data-v="all">全部平台</button>' +
      Object.keys(GT.PLATFORMS).map(function (p) {
        return '<button class="chip ' + (f.platform === p ? 'active' : '') + '" data-action="f-plat" data-v="' + p + '">' +
          esc(GT.PLATFORMS[p].name) + '</button>';
      }).join('');
    var modeOpts = '<option value="all">全部模式</option>' + Object.keys(GT.MODES).map(function (k) {
      return '<option value="' + k + '"' + (f.mode === k ? ' selected' : '') + '>' + esc(GT.MODES[k].name) + '</option>';
    }).join('');
    var sortOpts = [['new', '最新发布'], ['price', '单价最高'], ['left', '剩余名额最多'], ['ai', 'AI 推荐优先']]
      .map(function (o) { return '<option value="' + o[0] + '"' + (f.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('');

    return '' +
      '<section class="hero">' +
        '<h2>让每一次创作，<span class="grad-text">都有回响</span></h2>' +
        '<p>光体•财无界聚合全网优质投放任务，AI 智能匹配你的账号赛道，接单、发布、结算一站直达，收益透明、到账可查。</p>' +
        '<div class="hero-actions">' +
          '<button class="btn btn-primary" data-action="scroll-list">' + icon('i-bolt') + '开始淘金</button>' +
          '<button class="btn btn-ghost" data-action="invite">' + icon('i-gift') + '邀请好友得奖励</button>' +
        '</div>' +
        '<svg class="hero-deco ic" style="width:120px;height:120px;opacity:.5"><use href="#i-coin"/></svg>' +
      '</section>' +

      '<div class="stat-strip">' +
        '<div class="stat-card"><div class="num">' + newToday + '</div><div class="lab">' + icon('i-bolt') + '今日新增任务</div></div>' +
        '<div class="stat-card"><div class="num">¥' + money(Math.round(openRewards)) + '</div><div class="lab">' + icon('i-coin') + '在途佣金池</div></div>' +
        '<div class="stat-card"><div class="num">12.6w</div><div class="lab">' + icon('i-users') + '累计服务达人</div></div>' +
        '<div class="stat-card"><div class="num">T+1.5</div><div class="lab">' + icon('i-shield') + '平均结算时效</div></div>' +
      '</div>' +

      '<div class="filter-bar" id="listTop">' +
        '<div class="chip-row">' + platChips + '</div>' +
        '<span class="filter-sep"></span>' +
        '<select class="select" id="modeSelect">' + modeOpts + '</select>' +
        '<select class="select" id="sortSelect">' + sortOpts + '</select>' +
        '<button class="link-reset" data-action="f-reset">' + icon('i-refresh', 'ic-sm') + '重置</button>' +
      '</div>' +

      (pins.length ? '<div class="section-head">' + icon('i-pin') + '官方置顶 · 高佣优选' +
        '<a class="more" href="javascript:void 0" data-action="scroll-list">查看全部 ' + icon('i-arrow', 'ic-sm') + '</a></div>' +
        '<div class="task-grid">' + pins.map(taskCard).join('') + '</div>' : '') +

      '<div class="section-head">' + icon('i-fire') + '任务广场 · ' + rest.length + ' 个可接</div>' +
      (rest.length
        ? '<div class="task-grid">' + rest.map(taskCard).join('') + '</div>'
        : '<div class="card empty">' + icon('i-search') + '<p>没有符合条件的任务，换个筛选试试～</p></div>');
  }

  /* ================================================================
     任务详情抽屉
     ================================================================ */
  function rewardRows(t) {
    var rows = [];
    if (t.mode === 'fixed') rows.push(['单篇奖励', '¥' + money(t.reward)], ['结算周期', '审核通过 T+1']);
    if (t.mode === 'cpe') rows.push(['每次有效互动', '¥' + money(t.reward)], ['封顶规则', t.cap || '—'], ['结算周期', 'T+3 按互动量结算']);
    if (t.mode === 'cpm') rows.push(['千次有效播放', '¥' + money(t.reward)], ['封顶规则', t.cap || '上不封顶'], ['结算周期', 'T+7 按播放结算']);
    if (t.mode === 'ladder') rows.push(['阶梯上限', '¥' + money(t.reward) + '/篇'], ['阶梯规则', t.cap || '—'], ['结算周期', '按最终阶梯 T+3']);
    if (t.mode === 'milestone') rows.push(['里程碑封顶', '¥' + money(t.reward)], ['阶段规则', t.cap || '—'], ['结算周期', '达成后 T+3']);
    if (t.mode === 'per') rows.push(['每次有效动作', '¥' + money(t.reward)], ['封顶规则', t.cap || '—'], ['结算周期', '日结']);
    rows.push(['资金保障', '商家已预存托管预算，平台担保结算'], ['违规说明', '刷量/抄袭将取消全部收益']);
    return rows.map(function (r) {
      return '<tr><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td></tr>';
    }).join('');
  }

  function openTask(id) {
    var t = C.tasks.filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    S.drawerTaskId = id;
    var full = t.taken >= t.capacity;
    var pct = Math.min(100, Math.round(t.taken / t.capacity * 100));
    openDrawer(
      '<div class="drawer-head"><div style="display:flex;gap:8px;flex-wrap:wrap">' +
        (t.pinned ? tagBadge('置顶') : '') + (t.tags || []).filter(function (x) { return x !== '置顶'; }).map(tagBadge).join('') + modeBadge(t.mode) +
      '</div><button class="drawer-close" data-action="close-layers">' + icon('i-close') + '</button></div>' +

      '<h2 style="font-size:20px;font-weight:800;line-height:1.5;margin-top:8px">' + esc(t.title) + '</h2>' +
      '<div class="task-meta" style="margin-top:12px">' +
        '<span>' + platBadge(t.platform, true) + esc((GT.PLATFORMS[t.platform] || {}).name || '') + '</span>' +
        '<span>' + icon('i-clock') + '截止剩余 ' + t.daysLeft + ' 天</span>' +
        '<span>' + icon('i-users') + '粉丝 ≥ ' + t.fanMin + '</span>' +
        '<span>' + icon('i-robot') + 'AI 推荐 ' + t.aiScore + ' 分</span>' +
      '</div>' +

      '<div style="margin-top:16px;padding:16px;border-radius:14px;background:var(--brand-grad-soft);border:1px solid var(--line)">' +
        '<div class="task-settle"><span class="task-reward">¥' + money(t.reward) + '</span>' +
        '<span class="task-reward-unit">' + esc(t.unit) + '</span></div>' +
        '<div style="display:flex;align-items:center;gap:10px;margin-top:10px">' +
          '<div class="progress' + (full ? ' full' : '') + '" style="flex:1"><i style="width:' + pct + '%"></i></div>' +
          '<span class="quota-text">' + t.taken + '/' + t.capacity + ' 人</span></div>' +
      '</div>' +

      '<div class="detail-sec"><h4>任务说明</h4><p style="font-size:13.5px;color:var(--text2);line-height:1.8">' + esc(t.desc) + '</p></div>' +
      '<div class="detail-sec"><h4>结算与资金保障</h4><table class="reward-table">' + rewardRows(t) + '</table></div>' +
      '<div class="detail-sec"><h4>发布要求</h4><ul>' + (t.reqs || []).map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul></div>' +
      '<div class="detail-sec"><h4>参与流程</h4><ul>' + (t.steps || []).map(function (r, i) { return '<li><b style="color:var(--gold)">' + (i + 1) + '.</b> ' + esc(r) + '</li>'; }).join('') + '</ul></div>' +

      '<div class="detail-sec"><h4>发布商家</h4><div class="merchant-line">' +
        '<span class="merchant-ava">' + esc(String(t.merchant || '商').slice(0, 1)) + '</span>' +
        '<div><div style="font-weight:700;font-size:14px">' + esc(t.merchant) + '</div>' +
        '<div style="font-size:12px;color:var(--muted)">' + icon('i-shield', 'ic-sm') + ' 预算已托管 · 平台担保结算</div></div></div></div>' +

      '<div style="margin-top:26px;display:flex;gap:10px">' +
        (full
          ? '<button class="btn btn-ghost btn-block" disabled>本期已抢光，等待下期</button>'
          : t.accepted
            ? '<button class="btn btn-soft btn-block" data-action="go-my">' + icon('i-check') + '已接受 · 去发布</button>'
            : '<button class="btn btn-primary btn-block btn-lg" data-action="accept" data-id="' + t.id + '">' + icon('i-bolt') + '立即接受任务</button>') +
      '</div>' +
      (t.oneKey && !full && !t.accepted
        ? '<button class="btn btn-ghost btn-block" style="margin-top:10px" data-action="quick-publish" data-id="' + t.id + '">' + icon('i-send') + '一键发布（AI 代发）</button>'
        : '')
    );
  }

  /* ================================================================
     视图：我的任务
     ================================================================ */
  var ST_NAMES = { todo: ['待发布', 'st-todo'], review: ['审核中', 'st-review'], settled: ['已结算', 'st-settled'] };

  function viewMy() {
    if (!C.orders.length) {
      return '<div class="page-head"><h1>' + icon('i-check') + '我的任务</h1><div class="sub">接受的任务会出现在这里，跟进发布与结算进度。</div></div>' +
        '<div class="card empty">' + icon('i-bolt') + '<p>还没有接受任务，去任务广场接一单吧！</p>' +
        '<div style="margin-top:16px"><button class="btn btn-primary" data-action="nav" data-route="market">前往任务广场</button></div></div>';
    }
    var rows = C.orders.map(function (o) {
      var st = ST_NAMES[o.status] || ST_NAMES.todo;
      var act = '';
      if (o.status === 'todo') {
        act = '<button class="btn btn-primary btn-sm" data-action="submit-link" data-id="' + o.id + '">' + icon('i-link') + '提交作品链接</button>' +
              '<button class="btn btn-ghost btn-sm" data-action="quick-publish" data-task="' + o.taskId + '">去创作</button>';
      } else if (o.status === 'review') {
        act = '<span class="dot-status st-review">平台审核中</span>';
      } else {
        act = '<span class="dot-status st-settled">已结算 ¥' + money(o.paid) + '</span>';
      }
      return '<tr><td class="strong">' + esc(o.title || '') + '</td>' +
        '<td>' + platBadge(o.platform, true) + ' ' + esc((GT.PLATFORMS[o.platform] || {}).name || '') + '</td>' +
        '<td>' + modeBadge(o.mode) + '</td>' +
        '<td class="num">¥' + money(o.status === 'settled' ? o.paid : (o.reward || 0)) + '</td>' +
        '<td><span class="dot-status ' + st[1] + '">' + st[0] + '</span></td>' +
        '<td style="color:var(--muted)">' + timeAgo(o.acceptedAt) + '</td>' +
        '<td>' + act + '</td></tr>';
    }).join('');
    return '<div class="page-head"><h1>' + icon('i-check') + '我的任务</h1><div class="sub">共 ' + C.orders.length + ' 个任务 · 提交链接后平台自动审核并结算（服务端实时处理）</div></div>' +
      '<div class="card" style="padding:0"><div class="table-wrap" style="border:none"><table class="data">' +
      '<thead><tr><th>任务</th><th>平台</th><th>模式</th><th>收益</th><th>状态</th><th>接单时间</th><th>操作</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div></div>';
  }

  /* ================================================================
     视图：发布 · 内容
     ================================================================ */
  var pendingTitle = '', pendingText = '';

  function viewPublish() {
    var f = S.pubForm;
    var platToggles = Object.keys(GT.PLATFORMS).map(function (p) {
      var on = f.platforms.indexOf(p) >= 0;
      return '<button class="plat-toggle' + (on ? ' on' : '') + '" data-action="plat-toggle" data-plat="' + p + '">' +
        '<span class="dot"></span>' + platBadge(p, true) + esc(GT.PLATFORMS[p].name) + '</button>';
    }).join('');
    var firstPlat = f.platforms[0] || 'xhs';

    var composer =
      '<div class="card">' +
        '<div class="card-title">' + icon('i-send') + '多平台一键发布</div>' +
        '<div class="composer-head">' + platToggles + '</div>' +
        '<div class="field"><label>标题</label><input class="input" id="pubTitle" maxlength="30" placeholder="一句话讲清亮点（30 字内）" value="' + esc(pendingTitle) + '"></div>' +
        '<div class="field"><label>正文</label><textarea id="pubText" placeholder="分享真实体验、使用感受，配上具体场景更容易获得推荐流量…">' + esc(pendingText) + '</textarea>' +
          '<div class="hint">支持话题词（#），AI 会自动优化排版与标签</div></div>' +
        '<div class="field"><label>配图（最多 3 张）</label>' +
          '<label class="upload-box" for="pubImg">' + icon('i-plus', 'ic-sm') + ' 点击上传图片</label>' +
          '<input type="file" id="pubImg" accept="image/*" multiple hidden>' +
          '<div class="upload-previews" id="pubPreviews"></div></div>' +
        '<div class="field-row"><div class="field"><label>定时发布（可选）</label><input class="input" type="datetime-local" id="pubSchedule"></div>' +
          '<div class="field"><label>发布方式</label><select class="select" style="width:100%" id="pubMode"><option value="ai">AI 智能优化后发布</option><option value="raw">按原文直接发布</option></select></div></div>' +
        '<button class="btn btn-primary btn-lg btn-block" data-action="publish-submit">' + icon('i-send') + '一键发布到 ' + f.platforms.length + ' 个平台</button>' +
      '</div>';

    var phone =
      '<div class="card"><div class="card-title">' + icon('i-robot') + '实时预览</div>' +
      '<div class="phone-mock"><div class="pm-status"><span>9:41</span><span>光体预览</span></div>' +
      '<div class="pm-author"><span class="avatar" style="width:30px;height:30px;font-size:12px">' + esc(C.me ? C.me.name.slice(0, 1) : '光') + '</span>' +
      '<div><div style="font-size:12.5px;font-weight:700">' + esc(C.me ? C.me.name : '未登录用户') + '</div>' +
      '<div style="font-size:10.5px;color:var(--muted)">' + esc((GT.PLATFORMS[firstPlat] || {}).name || '') + ' · 刚刚</div></div></div>' +
      '<div class="pm-img" id="pmImg">配图预览区</div>' +
      '<div class="pm-title" id="pmTitle">' + (pendingTitle ? esc(pendingTitle) : '标题会显示在这里') + '</div>' +
      '<div class="pm-text" id="pmText">' + (pendingText ? esc(pendingText) : '正文内容实时预览…') + '</div>' +
      '<div class="pm-stats"><span>' + icon('i-heart', 'ic-sm') + ' 获赞</span><span>' + icon('i-star', 'ic-sm') + ' 收藏</span><span>' + icon('i-send', 'ic-sm') + ' 转发</span></div>' +
      '<div class="pm-platforms" id="pmPlats">' + f.platforms.map(function (p) { return platBadge(p, true); }).join('') + '</div>' +
      '</div></div>';

    return '<div class="page-head"><h1>' + icon('i-send') + '发布 · 内容</h1><div class="sub">一次创作，多平台分发，数据自动回流</div></div>' +
      '<div class="tabs"><button class="' + (S.pubTab === 'compose' ? 'active' : '') + '" data-action="pub-tab" data-tab="compose">立即发布</button>' +
      '<button class="' + (S.pubTab === 'contents' ? 'active' : '') + '" data-action="pub-tab" data-tab="contents">我的内容（' + C.contents.length + '）</button></div>' +
      (S.pubTab === 'compose'
        ? '<div class="split"><div>' + composer + '</div><div>' + phone + '</div></div>'
        : viewContents());
  }

  function viewContents() {
    if (!C.contents.length) {
      return '<div class="card empty">' + icon('i-book') + '<p>还没有发布记录，发布第一条内容试试～</p></div>';
    }
    var rows = C.contents.map(function (c) {
      var plats = Object.keys(c.platforms).map(function (p) {
        var st = c.platforms[p];
        var b = st === '已发布' ? 'b-green' : st === '审核中' ? 'b-blue' : st === '定时中' ? 'b-cyan' : 'b-red';
        return '<span style="display:inline-flex;align-items:center;gap:4px;margin-right:10px">' + platBadge(p, true) +
          '<span class="badge ' + b + '">' + esc(st) + '</span></span>';
      }).join('');
      var thumb = c.thumb
        ? '<img src="' + c.thumb + '" alt="" style="width:34px;height:34px;border-radius:8px;object-fit:cover;vertical-align:middle;margin-right:8px;border:1px solid var(--line)">'
        : '';
      return '<tr><td class="strong">' + thumb + esc(c.title) + '</td><td>' + plats + '</td>' +
        '<td class="num">' + c.stats.views + '</td><td>' + c.stats.likes + '</td><td>' + c.stats.comments + '</td>' +
        '<td style="color:var(--muted)">' + timeAgo(c.createdAt) + '</td></tr>';
    }).join('');
    return '<div class="card" style="padding:0"><div class="table-wrap" style="border:none"><table class="data">' +
      '<thead><tr><th>标题</th><th>平台状态</th><th>播放</th><th>点赞</th><th>评论</th><th>发布时间</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div></div>';
  }

  /* ================================================================
     视图：互动大厅
     ================================================================ */
  function interactLeft(def) {
    var done = C.interact.done[def.id] || 0;
    return Math.max(0, def.daily - done);
  }
  function cdLeft(def) { return C.interact.cooldown[def.id] || 0; }

  function viewInteract() {
    var doneTotal = Object.keys(C.interact.done).reduce(function (s, k) { return s + C.interact.done[k]; }, 0);
    var rows = C.interact.defs.map(function (d) {
      var left = interactLeft(d);
      var cd = cdLeft(d);
      var btn;
      if (left <= 0) btn = '<button class="btn btn-ghost btn-sm" disabled>今日已满</button>';
      else if (cd > 0) btn = '<button class="btn btn-ghost btn-sm" data-cd="' + d.id + '" disabled>' + cd + 's</button>';
      else btn = '<button class="btn btn-primary btn-sm" data-action="interact-do" data-id="' + d.id + '">去完成</button>';
      return '<div class="interact-row">' +
        '<span class="interact-ico">' + icon(d.icon, 'ic-lg') + '</span>' +
        '<div class="interact-main"><h4>' + esc(d.title) + '</h4><p>' + esc(d.desc) + ' · 今日剩余 ' + left + ' 次</p></div>' +
        '<span class="interact-reward">¥' + money(d.reward) + '<small>/次</small></span>' + btn + '</div>';
    }).join('');
    return '<div class="page-head"><h1>' + icon('i-heart') + '互动大厅</h1><div class="sub">轻量互动任务，随做随结 · 今日已完成 ' + doneTotal + ' 次</div></div>' +
      '<div style="display:flex;flex-direction:column;gap:10px">' + rows + '</div>' +
      '<p style="margin-top:16px;font-size:12.5px;color:var(--muted)">' + icon('i-shield', 'ic-sm') +
      ' 平台风控提示：互动任务需真实操作，检测到机器刷量将扣除当日全部互动收益。</p>';
  }
  function startInteractTimer() {
    if (S.interactTimer) clearInterval(S.interactTimer);
    if (S.route !== 'interact') return;
    S.interactTimer = setInterval(async function () {
      if (S.route !== 'interact') { clearInterval(S.interactTimer); return; }
      var need = false;
      Object.keys(C.interact.cooldown).forEach(function (k) {
        if (C.interact.cooldown[k] > 0) {
          C.interact.cooldown[k]--;
          if (C.interact.cooldown[k] <= 0) need = true;
        }
      });
      if (need) { await refreshCurrent().catch(function () {}); render(); return; }
      $all('[data-cd]').forEach(function (b) {
        var id = b.getAttribute('data-cd');
        var left = C.interact.cooldown[id] || 0;
        if (left > 0) b.textContent = left + 's';
      });
    }, 1000);
  }

  /* ================================================================
     视图：AI 打卡
     ================================================================ */
  function viewCheckin() {
    var ck = C.checkin || { days: {}, streak: 0, doneToday: false, nextReward: 0.3 };
    var now = new Date();
    var y = now.getFullYear(), mo = now.getMonth();
    var first = new Date(y, mo, 1).getDay();
    var days = new Date(y, mo + 1, 0).getDate();
    var pad = function (n) { return String(n).padStart(2, '0'); };
    var tstr = y + '-' + pad(mo + 1) + '-' + pad(now.getDate());

    var cells = ['日', '一', '二', '三', '四', '五', '六'].map(function (d) { return '<div class="dow">' + d + '</div>'; }).join('');
    var i;
    for (i = 0; i < first; i++) cells += '<div class="day blank"></div>';
    for (i = 1; i <= days; i++) {
      var ds = y + '-' + pad(mo + 1) + '-' + pad(i);
      var cls = 'day';
      if (ck.days[ds]) cls += ' done';
      if (ds === tstr) cls += ' today';
      if (ds > tstr) cls += ' future';
      cells += '<div class="' + cls + '">' + i + '</div>';
    }
    var pills = '';
    for (i = 1; i <= 7; i++) {
      var amt = i === 7 ? '¥5.0' : '¥' + money(Math.min(0.3 + (i - 1) * 0.1, 2.0));
      pills += '<div class="cr-pill ' + (i <= ck.streak ? 'hit' : '') + '"><span>D' + i + '</span><b>' + amt + '</b></div>';
    }
    return '<div class="page-head"><h1>' + icon('i-clock') + 'AI 打卡</h1><div class="sub">连续打卡奖励递进，第 7 天解锁 ¥5 超值奖励</div></div>' +
      '<div class="checkin-hero">' +
        '<div><div class="streak-num">' + ck.streak + '</div><div style="color:var(--text2);font-size:13px;margin-top:4px">连续打卡天数</div></div>' +
        '<div style="flex:1;min-width:240px"><div class="cal">' + cells + '</div></div>' +
        '<div style="text-align:center">' +
          (ck.doneToday
            ? '<button class="btn btn-ghost btn-lg" disabled>' + icon('i-check') + '今日已打卡</button>'
            : '<button class="btn btn-primary btn-lg" data-action="checkin">' + icon('i-bolt') + '立即打卡</button>') +
          '<p style="font-size:12px;color:var(--muted);margin-top:8px">今日打卡可得 ¥' + money(ck.doneToday ? Math.min(0.3 + ck.streak * 0.1, 2.0) : (ck.nextReward || 0.3)) + '</p>' +
        '</div>' +
      '</div>' +
      '<div class="card"><div class="card-title">' + icon('i-gift') + '七日奖励进度</div>' +
        '<div class="checkin-rewards">' + pills + '</div></div>';
  }

  /* ================================================================
     视图：收益钱包
     ================================================================ */
  function drawChart(cv, data, colorA) {
    var dpr = window.devicePixelRatio || 1;
    var w = cv.clientWidth, h = cv.clientHeight;
    cv.width = w * dpr; cv.height = h * dpr;
    var ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    var pad = { l: 8, r: 8, t: 14, b: 22 };
    var max = Math.max.apply(null, data.map(function (x) { return x.v; }).concat([10]));
    var bw = (w - pad.l - pad.r) / data.length;
    ctx.strokeStyle = 'rgba(128,134,170,.18)';
    ctx.lineWidth = 1;
    [0.25, 0.5, 0.75, 1].forEach(function (f) {
      var y = pad.t + (h - pad.t - pad.b) * (1 - f);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    });
    var grad = ctx.createLinearGradient(0, pad.t, 0, h - pad.b);
    grad.addColorStop(0, colorA); grad.addColorStop(1, 'rgba(139,123,255,.08)');
    data.forEach(function (x, idx) {
      var bh = (h - pad.t - pad.b) * (x.v / max);
      var bx = pad.l + bw * idx + bw * 0.18, bwidth = bw * 0.64;
      var by = h - pad.b - bh;
      ctx.fillStyle = x.v > 0 ? grad : 'rgba(128,134,170,.15)';
      if (x.v > 0) {
        ctx.beginPath();
        var r = Math.min(6, bwidth / 2);
        ctx.moveTo(bx, h - pad.b);
        ctx.lineTo(bx, by + r); ctx.quadraticCurveTo(bx, by, bx + r, by);
        ctx.lineTo(bx + bwidth - r, by); ctx.quadraticCurveTo(bx + bwidth, by, bx + bwidth, by + r);
        ctx.lineTo(bx + bwidth, h - pad.b); ctx.closePath(); ctx.fill();
      } else {
        ctx.beginPath(); ctx.arc(bx + bwidth / 2, h - pad.b - 3, 2.5, 0, 7); ctx.fill();
      }
      ctx.fillStyle = 'rgba(138,144,184,.9)';
      ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(x.d.slice(5), bx + bwidth / 2, h - 7);
      if (x.v > 0) ctx.fillText('¥' + (x.v % 1 ? x.v.toFixed(1) : String(Math.round(x.v))), bx + bwidth / 2, by - 5);
    });
  }
  function daily7() {
    var d = (C.wallet && C.wallet.daily) || {};
    var arr = [], i;
    var pad = function (n) { return String(n).padStart(2, '0'); };
    for (i = 6; i >= 0; i--) {
      var dd = new Date(); dd.setDate(dd.getDate() - i);
      var key = dd.getFullYear() + '-' + pad(dd.getMonth() + 1) + '-' + pad(dd.getDate());
      arr.push({ d: key, v: d[key] || 0 });
    }
    return arr;
  }

  function viewWallet() {
    var w = C.wallet || { balance: 0, totalEarn: 0, totalWithdraw: 0, today: 0, tx: [] };
    var lv = levelOf(w.totalEarn);
    var txRows = w.tx.map(function (t) {
      var plus = t.amount > 0;
      return '<tr><td class="strong">' + esc(t.title) + '</td><td>' + (plus ? '<span class="badge b-green">收入</span>' : '<span class="badge b-red">支出</span>') + '</td>' +
        '<td class="tx-amount ' + (plus ? 'plus' : 'minus') + '">' + (plus ? '+' : '') + '¥' + money(Math.abs(t.amount)) + '</td>' +
        '<td style="color:var(--muted)">' + timeAgo(t.at) + '</td></tr>';
    }).join('');
    return '<div class="page-head"><h1>' + icon('i-wallet') + '收益钱包</h1><div class="sub">服务端实时账本 · 每一笔资金变动都有据可查</div></div>' +
      '<div class="split">' +
        '<div>' +
          '<div class="wallet-hero">' +
            '<div style="font-size:13px;opacity:.75">可用余额</div>' +
            '<div class="wallet-balance"><small>¥</small>' + money(w.balance) + '</div>' +
            '<div class="wallet-sub">' +
              '<div class="ws">累计收益<b>¥' + money(w.totalEarn) + '</b></div>' +
              '<div class="ws">累计提现<b>¥' + money(w.totalWithdraw) + '</b></div>' +
              '<div class="ws">今日收益<b>¥' + money(w.today) + '</b></div>' +
            '</div>' +
            '<div style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap">' +
              '<button class="btn btn-primary" data-action="recharge-open">' + icon('i-coin') + '账户充值</button>' +
              '<button class="btn btn-ghost" style="border-color:rgba(255,255,255,.3);color:#fff" data-action="withdraw-open">' + icon('i-wallet') + '提现</button>' +
              '<button class="btn btn-ghost" style="border-color:rgba(255,255,255,.3);color:#fff" data-action="invite">' + icon('i-gift') + '邀请返佣 10%</button>' +
            '</div>' +
          '</div>' +
          '<div class="card" style="margin-top:16px"><div class="card-title">' + icon('i-chart') + '近 7 日收益</div><canvas class="chart" id="walletChart"></canvas></div>' +
          '<div class="card" style="margin-top:16px;padding:0"><div class="card-title" style="padding:16px 18px 0">收支明细</div>' +
            (w.tx.length
              ? '<div class="table-wrap" style="border:none;margin-top:8px"><table class="data"><thead><tr><th>事项</th><th>类型</th><th>金额</th><th>时间</th></tr></thead><tbody>' + txRows + '</tbody></table></div>'
              : '<div class="empty">' + icon('i-wallet') + '<p>暂无收支记录，去接第一单吧～</p></div>') +
          '</div>' +
        '</div>' +
        '<div>' +
          '<div class="card level-card">' +
            '<div class="card-title">' + icon('i-trophy') + '创作者等级</div>' +
            '<div class="lv-name grad-text">' + lv.cur.name + '</div>' +
            '<div class="level-bar"><i style="width:' + Math.round(lv.prog * 100) + '%"></i></div>' +
            '<div style="font-size:12px;color:var(--muted)">' +
              (lv.next ? '累计收益 ¥' + money(w.totalEarn) + ' / ¥' + money(lv.next.min) + ' 升级 ' + lv.next.name : '已达最高等级，光耀无界！') +
            '</div>' +
          '</div>' +
          '<div class="card" style="margin-top:14px"><div class="card-title">' + icon('i-robot') + '收益计算器</div>' +
            '<div class="field"><label>结算模式</label><select class="select" style="width:100%" id="calcMode">' +
              Object.keys(GT.MODES).map(function (k) {
                return '<option value="' + k + '"' + (k === 'cpe' ? ' selected' : '') + '>' + esc(GT.MODES[k].name) + '</option>';
              }).join('') + '</select></div>' +
            '<div class="field-row"><div class="field"><label>单价（¥）</label><input class="input" id="calcPrice" type="number" min="0" step="0.1" value="0.5"></div>' +
            '<div class="field"><label id="calcQtyLabel">预估互动量（次）</label><input class="input" id="calcQty" type="number" min="0" value="50000"></div></div>' +
            '<div style="padding:14px;border-radius:12px;background:var(--brand-grad-soft);text-align:center">' +
              '<div style="font-size:12px;color:var(--muted)">预估收益</div>' +
              '<div class="task-reward" style="font-size:26px" id="calcOut">¥25,000.00</div></div>' +
            '<div class="hint" style="margin-top:8px">互动/曝光类按千次折算，按次与固定类按件数计算</div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  /* ================================================================
     视图：龙虎榜
     ================================================================ */
  function viewRank() {
    var r = C.rank || { list: [], me: null };
    var medals = ['🥇', '🥈', '🥉'];
    var podium = [1, 0, 2].map(function (i) {
      var e = r.list[i];
      if (!e) return '<div class="pod pod' + (i + 1) + '"><div class="rank-ico">' + medals[i] + '</div><div class="pod-name">虚位以待</div><div class="pod-amt">¥0</div></div>';
      return '<div class="pod pod' + (i + 1) + '"><div class="rank-ico">' + medals[i] + '</div>' +
        '<div class="pod-name">' + esc(e.name) + (e.seed ? ' <span class="badge b-gray">示例</span>' : '') + '</div>' +
        '<div class="pod-amt">¥' + money(e.amt) + '</div></div>';
    }).join('');
    var rows = r.list.slice(3).map(function (e, i) {
      return '<tr><td class="strong">' + (i + 4) + '</td><td class="strong">' + esc(e.name) + (e.seed ? ' <span class="badge b-gray">示例</span>' : '') + '</td>' +
        '<td class="num">¥' + money(e.amt) + '</td></tr>';
    }).join('');
    var mine = r.me
      ? '<div class="rank-me">' + icon('i-fire') + '我的实时排名：<b>#' + r.me.rank + '</b>，累计收益 <b>¥' + money(r.me.amount) + '</b></div>'
      : '<div class="rank-me">' + icon('i-fire') + '登录后查看你的实时排名与收益</div>';
    return '<div class="page-head"><h1>' + icon('i-trophy') + '赚钱龙虎榜</h1><div class="sub">全站真实收益排行 · 标注「示例」的为平台演示数据</div></div>' +
      '<div class="podium">' + podium + '</div>' +
      '<div class="card" style="padding:0"><div class="table-wrap" style="border:none"><table class="data">' +
      '<thead><tr><th>排名</th><th>达人</th><th>累计收益</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>' +
      mine;
  }

  /* ================================================================
     视图：帮助中心
     ================================================================ */
  var FAQS = [
    ['接了任务不想做怎么办？', '任务可在「我的任务」中放弃，但 24 小时内连续放弃 3 单会触发冷静期限制，建议接单前确认档期与粉丝要求。'],
    ['收益什么时候到账？', '固定价格任务审核通过后 T+1 结算；互动/曝光类按平台数据回传周期结算（通常 T+3 ~ T+7），全部自动到账，无需申请。'],
    ['平台资金是如何保障的？', '商家发布任务时需将预算预存至平台托管账户，达人完成并通过审核后由托管账户划付，避免拖款；充值、冻结、结算、提现全程有服务端账本记录。'],
    ['提现有门槛吗？', '满 ¥10 即可发起提现，平台受理后按支付通道打款；可在明细中跟踪每笔提现状态。'],
    ['充值支持哪些方式？', '当前内置沙箱收银台（完整演练资金流）；生产环境配置支付宝/微信商户密钥后即接入真实收单。'],
    ['多平台一键发布安全吗？', '一键发布通过官方开放接口投递，账号授权数据加密存储，可随时解除授权。'],
    ['AI 打卡中断会清零吗？', '每月有 2 次「补光卡」机会可补打卡不断签，超过则连续天数从 1 重新累计。'],
    ['内容被商家采用后版权归谁？', '默认约定为商家获得内容使用权、达人保留署名权；特殊约定以任务详情页的协议为准。']
  ];
  function viewHelp() {
    var guides = [
      ['注册并绑定账号', '一键授权绑定社交平台账号，AI 自动读取账号画像与粉丝画像。'],
      ['接下第一单', '在任务广场按平台与结算模式筛选，AI 推荐分越高、与你账号的匹配度越高。'],
      ['创作并一键发布', '用发布器完成创作，多平台一键分发，也可使用 AI 代发。'],
      ['坐收到账', '提交作品链接后自动审核结算，收益明细实时可查，满 ¥10 提现。']
    ].map(function (g, i) {
      return '<div class="guide-step"><span class="gsn">' + (i + 1) + '</span><div><h5>' + g[0] + '</h5><p>' + g[1] + '</p></div></div>';
    }).join('');
    var faqs = FAQS.map(function (f, i) {
      return '<div class="faq-item" id="faq' + i + '"><button class="faq-q" data-action="faq" data-i="' + i + '">' + esc(f[0]) + icon('i-arrow') + '</button>' +
        '<div class="faq-a"><div>' + esc(f[1]) + '</div></div></div>';
    }).join('');
    return '<div class="page-head"><h1>' + icon('i-book') + '帮助中心</h1><div class="sub">三分钟上手光体•财无界，常见问题一站解决</div></div>' +
      '<div class="split"><div>' +
        '<div class="card"><div class="card-title">' + icon('i-rocket') + '新手指南</div>' + guides + '</div>' +
        '<h3 style="margin:22px 0 12px;font-size:16px">常见问题</h3>' + faqs +
      '</div>' +
      '<div><div class="card" style="text-align:center;padding:30px 20px">' +
        '<svg class="ic" style="width:52px;height:52px;color:var(--gold);margin:0 auto 12px"><use href="#i-headset"/></svg>' +
        '<h3 style="font-size:16px;margin-bottom:6px">联系光体客服</h3>' +
        '<p style="font-size:13px;color:var(--muted);margin-bottom:16px">工作日 9:00 - 21:00 在线<br>演示站点未接入人工客服通道</p>' +
        '<button class="btn btn-soft btn-block" data-action="toast-demo">复制反馈邮箱</button>' +
      '</div></div></div>';
  }

  /* ================================================================
     商家端：数据看板
     ================================================================ */
  function viewDash() {
    var d = C.dash || { onTasks: 0, orders: 0, settled: 0, spend: 0, escrowFrozen: 0, daily: {} };
    var data = dailyFrom(d.daily);
    return '<div class="page-head"><h1>' + icon('i-chart') + '数据看板</h1><div class="sub">投放效果一目了然，预算消耗与托管资金实时监控</div></div>' +
      '<div class="stat-strip">' +
        '<div class="stat-card"><div class="num">' + d.onTasks + '</div><div class="lab">' + icon('i-megaphone') + '投放中任务</div></div>' +
        '<div class="stat-card"><div class="num">' + d.orders + '</div><div class="lab">' + icon('i-users') + '累计接单</div></div>' +
        '<div class="stat-card"><div class="num">' + d.settled + '</div><div class="lab">' + icon('i-check') + '已结算订单</div></div>' +
        '<div class="stat-card"><div class="num">¥' + money(d.spend) + '</div><div class="lab">' + icon('i-coin') + '累计消耗</div></div>' +
      '</div>' +
      '<div class="card"><div class="card-title">' + icon('i-chart') + '近 7 日消耗趋势</div><canvas class="chart" id="dashChart"></canvas></div>' +
      '<div class="card" style="margin-top:16px;display:flex;gap:14px;align-items:center;flex-wrap:wrap">' +
        icon('i-shield', 'ic-lg') +
        '<div style="flex:1;min-width:220px"><b style="font-size:14px">托管资金</b>' +
        '<p style="font-size:13px;color:var(--muted);margin-top:3px">当前有 ¥' + money(d.escrowFrozen) + ' 预算托管在平台账户，任务结算时自动划付给达人。</p></div>' +
        '<button class="btn btn-primary btn-sm" data-action="nav" data-route="create">' + icon('i-plus') + '新建投放</button>' +
      '</div>';
  }
  function dailyFrom(map) {
    var arr = [], i;
    var pad = function (n) { return String(n).padStart(2, '0'); };
    for (i = 6; i >= 0; i--) {
      var dd = new Date(); dd.setDate(dd.getDate() - i);
      var key = dd.getFullYear() + '-' + pad(dd.getMonth() + 1) + '-' + pad(dd.getDate());
      arr.push({ d: key, v: (map || {})[key] || 0 });
    }
    return arr;
  }

  /* ---------------- 商家端：发布任务向导 ---------------- */
  function freshWizard() {
    return { step: 1, platforms: ['xhs'], mode: 'fixed', title: '', reward: '', capacity: '', days: 7, fanMin: 1000, desc: '', reqs: '' };
  }
  function viewCreate() {
    if (!S.wizard) S.wizard = freshWizard();
    var w = S.wizard;
    var balance = C.me ? C.me.balance : 0;
    var steps = ['选择平台与模式', '设置预算与门槛', '填写任务详情'].map(function (n, i) {
      var cls = w.step === i + 1 ? 'active' : w.step > i + 1 ? 'done' : '';
      return '<div class="wstep ' + cls + '"><span class="wn">' + (w.step > i + 1 ? '✓' : i + 1) + '</span>' + n + '</div>' +
        (i < 2 ? '<div class="wstep-line"></div>' : '');
    }).join('');

    var body = '';
    if (w.step === 1) {
      body = '<div class="field"><label>投放平台（可多选）</label><div class="chip-row">' +
        Object.keys(GT.PLATFORMS).map(function (p) {
          return '<button class="chip ' + (w.platforms.indexOf(p) >= 0 ? 'active' : '') + '" data-action="w-plat" data-v="' + p + '">' + esc(GT.PLATFORMS[p].name) + '</button>';
        }).join('') + '</div></div>' +
        '<div class="field"><label>结算模式</label><div class="mode-cards">' +
        Object.keys(GT.MODES).map(function (k) {
          return '<div class="mode-card ' + (w.mode === k ? 'active' : '') + '" data-action="w-mode" data-v="' + k + '"><b>' + esc(GT.MODES[k].name) + '</b><span>' + esc(GT.MODES[k].desc) + '</span></div>';
        }).join('') + '</div></div>';
    } else if (w.step === 2) {
      var budget = (Number(w.reward) || 0) * (Number(w.capacity) || 0);
      var short = budget > balance;
      var unit = { fixed: '每篇（¥）', cpe: '每次互动（¥）', cpm: '千次播放（¥）', ladder: '阶梯上限（¥）', milestone: '封顶奖金（¥）', per: '每次动作（¥）' }[w.mode];
      body = '<div class="field"><label>任务名称</label><input class="input" id="wzTitle" placeholder="例如：新品体验笔记招募" value="' + esc(w.title) + '"></div>' +
        '<div class="field-row">' +
        '<div class="field"><label>' + unit + '</label><input class="input" id="wzReward" type="number" min="0.1" step="0.1" placeholder="0.00" value="' + esc(w.reward) + '"></div>' +
        '<div class="field"><label>接单名额（人）</label><input class="input" id="wzCap" type="number" min="1" placeholder="50" value="' + esc(w.capacity) + '"></div></div>' +
        '<div class="field-row">' +
        '<div class="field"><label>截止天数</label><input class="input" id="wzDays" type="number" min="1" value="' + w.days + '"></div>' +
        '<div class="field"><label>粉丝门槛</label><input class="input" id="wzFan" type="number" min="0" value="' + w.fanMin + '"></div></div>' +
        '<div style="padding:14px;border-radius:12px;background:var(--brand-grad-soft);font-size:13px">' +
          '托管预算：<b>¥' + money(budget) + '</b>（单价 × 名额，发布时从余额冻结进平台托管账户）' +
          '<div style="margin-top:4px;color:var(--muted)">当前余额 ¥' + money(balance) + (short ? ' · <b style="color:var(--red)">余额不足，请先充值</b>' : ' · 余额充足') + '</div>' +
        '</div>' +
        (short ? '<button class="btn btn-soft btn-sm" style="margin-top:10px" data-action="recharge-open">' + icon('i-coin') + '去充值</button>' : '');
    } else {
      body = '<div class="field"><label>任务说明</label><textarea id="wzDesc" placeholder="向达人介绍产品亮点、创作方向与注意事项…">' + esc(w.desc) + '</textarea></div>' +
        '<div class="field"><label>发布要求（每行一条）</label><textarea id="wzReqs" placeholder="图文不少于 3 张&#10;需带指定话题标签">' + esc(w.reqs) + '</textarea></div>';
    }

    var foot = '<div class="modal-actions" style="justify-content:space-between">' +
      '<button class="btn btn-ghost" data-action="w-prev" ' + (w.step === 1 ? 'disabled' : '') + '>上一步</button>' +
      (w.step < 3
        ? '<button class="btn btn-primary" data-action="w-next">下一步</button>'
        : '<button class="btn btn-primary" data-action="w-submit">' + icon('i-rocket') + '发布并冻结预算</button>') +
      '</div>';

    return '<div class="page-head"><h1>' + icon('i-plus') + '发布投放任务</h1><div class="sub">三步创建任务 · 预算托管，结算平台担保</div></div>' +
      '<div class="card" style="max-width:760px;margin:0 auto">' +
        '<div class="wizard-steps">' + steps + '</div>' + body + foot +
      '</div>';
  }

  /* ---------------- 商家端：任务管理 ---------------- */
  function viewCampaigns() {
    if (!C.campaigns.length) {
      return '<div class="page-head"><h1>' + icon('i-megaphone') + '任务管理</h1><div class="sub">管理你发布的投放任务</div></div>' +
        '<div class="card empty">' + icon('i-megaphone') + '<p>还没有投放任务，创建第一个让达人为你创作吧！</p>' +
        '<div style="margin-top:16px"><button class="btn btn-primary" data-action="nav" data-route="create">新建投放任务</button></div></div>';
    }
    var rows = C.campaigns.map(function (c) {
      var pct = Math.min(100, Math.round(c.taken / c.capacity * 100));
      var plats = (c.platforms && c.platforms.length ? c.platforms : [c.platform]);
      return '<tr><td class="strong" style="max-width:240px;white-space:normal">' + esc(c.title) + '</td>' +
        '<td><span class="plat-row">' + plats.map(function (p) { return platBadge(p, true); }).join('') + '</span></td>' +
        '<td>' + modeBadge(c.mode) + '</td>' +
        '<td><div style="display:flex;align-items:center;gap:8px;min-width:130px"><div class="progress" style="flex:1"><i style="width:' + pct + '%"></i></div><span class="quota-text">' + c.taken + '/' + c.capacity + '</span></div></td>' +
        '<td class="num">¥' + money(c.budget || 0) + '</td>' +
        '<td class="num">¥' + money(c.spend || 0) + '</td>' +
        '<td>' + (c.status === 'on'
          ? '<span class="dot-status st-settled">投放中</span>'
          : '<span class="dot-status st-off">已暂停</span>') + '</td>' +
        '<td><button class="btn btn-ghost btn-sm" data-action="camp-toggle" data-id="' + c.id + '">' + (c.status === 'on' ? '暂停投放' : '恢复投放') + '</button></td></tr>';
    }).join('');
    return '<div class="page-head"><h1>' + icon('i-megaphone') + '任务管理</h1><div class="sub">共 ' + C.campaigns.length + ' 个任务 · 预算已托管，结算自动划付</div></div>' +
      '<div class="card" style="padding:0"><div class="table-wrap" style="border:none"><table class="data">' +
      '<thead><tr><th>任务名称</th><th>平台</th><th>模式</th><th>接单进度</th><th>托管预算</th><th>已消耗</th><th>状态</th><th>操作</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div></div>';
  }

  /* ================================================================
     模态框集合
     ================================================================ */
  function modalAuth(tab) {
    S.authTab = tab || 'login';
    var isLogin = S.authTab === 'login';
    openModal(
      '<div class="tabs" style="margin-bottom:18px"><button class="' + (isLogin ? 'active' : '') + '" data-action="auth-tab" data-tab="login">登录</button>' +
      '<button class="' + (!isLogin ? 'active' : '') + '" data-action="auth-tab" data-tab="register">注册</button></div>' +
      '<h3>' + (isLogin ? '欢迎回来' : '加入光体•财无界') + '</h3>' +
      '<div class="modal-sub">账号数据保存在平台服务器，换设备登录依旧同步</div>' +
      '<div class="field"><label>用户名</label><input class="input" id="authName" autocomplete="username" placeholder="中文、字母、数字、下划线（2-16 位）"></div>' +
      '<div class="field"><label>密码</label><input class="input" id="authPwd" type="password" autocomplete="' + (isLogin ? 'current-password' : 'new-password') + '" placeholder="至少 6 位"></div>' +
      (!isLogin
        ? '<div class="field"><label>选择身份</label><select class="select" id="authRole" style="width:100%">' +
          '<option value="creator">达人 · 接任务赚钱（送 ¥8 新人礼）</option>' +
          '<option value="merchant">商家 · 发布投放（送 ¥8,888 开业广告金）</option></select></div>' +
          '<div class="field"><label>邀请码（选填）</label><input class="input" id="authInvite" placeholder="填写好友邀请码，绑定后其享你的任务收益返佣" maxlength="12"></div>'
        : '') +
      '<div class="modal-actions"><button class="btn btn-ghost" data-action="close-layers">取消</button>' +
      '<button class="btn btn-primary" data-action="auth-submit">' + (isLogin ? '登录' : '注册并进入') + '</button></div>');
  }
  function modalAccept(t) {
    openModal(
      '<h3>接受任务</h3><div class="modal-sub">接受后请在截止日期前完成发布</div>' +
      '<div style="padding:14px;border-radius:12px;background:var(--chip);font-size:13.5px;line-height:1.9">' +
      '<b>' + esc(t.title) + '</b><br>收益：¥' + money(t.reward) + ' ' + esc(t.unit) +
      '<br>剩余名额：' + (t.capacity - t.taken) + ' 人 · 剩余 ' + t.daysLeft + ' 天</div>' +
      '<div class="modal-actions"><button class="btn btn-ghost" data-action="close-layers">再想想</button>' +
      '<button class="btn btn-primary" data-action="accept-confirm" data-id="' + t.id + '">确认接受</button></div>');
  }
  function modalSubmitLink(orderId) {
    openModal(
      '<h3>提交作品链接</h3><div class="modal-sub">提交后平台将自动审核，通过即由托管账户划付结算</div>' +
      '<div class="field"><label>作品链接</label><input class="input" id="linkInput" placeholder="https://…"></div>' +
      '<div class="modal-actions"><button class="btn btn-ghost" data-action="close-layers">取消</button>' +
      '<button class="btn btn-primary" data-action="submit-link-go" data-id="' + orderId + '">提交审核</button></div>');
  }
  function modalRecharge() {
    openModal(
      '<h3>账户充值</h3><div class="modal-sub">资金用于任务托管与账户消费，服务端账本实时记账</div>' +
      '<div class="field"><label>充值金额（¥）</label><input class="input" id="rcAmount" type="number" min="1" step="0.01" placeholder="100.00"></div>' +
      '<div class="field"><label>支付方式</label><select class="select" id="rcChannel" style="width:100%">' +
        '<option value="sandbox">沙箱收银台（演示通道 · 完整资金流）</option>' +
        '<option value="alipay">支付宝（需平台配置商户密钥）</option></select></div>' +
      '<div class="modal-actions"><button class="btn btn-ghost" data-action="close-layers">取消</button>' +
      '<button class="btn btn-primary" data-action="recharge-submit">去支付</button></div>');
  }
  function modalWithdraw() {
    openModal(
      '<h3>提现申请</h3><div class="modal-sub">满 ¥10 可提，平台受理后按支付通道打款（账本即时冻结余额）</div>' +
      '<div class="field"><label>提现金额（¥）</label><input class="input" id="wdAmount" type="number" min="10" step="0.01" placeholder="10.00"></div>' +
      '<div class="field"><label>收款账户</label><input class="input" id="wdAccount" placeholder="支付宝账号 / 银行卡号"></div>' +
      '<div class="modal-actions"><button class="btn btn-ghost" data-action="close-layers">取消</button>' +
      '<button class="btn btn-primary" data-action="withdraw-submit">提交申请</button></div>');
  }
  function modalInvite() {
    var code = C.me ? C.me.inviteCode : 'GT-WUJIE';
    openModal(
      '<h3>邀请好友 · 收益返佣</h3><div class="modal-sub">好友注册时填写你的邀请码完成绑定</div>' +
      '<div style="display:flex;gap:10px;align-items:center;padding:16px;border-radius:14px;background:var(--brand-grad-soft);border:1px dashed rgba(246,196,83,.45)">' +
      '<div style="flex:1"><div style="font-size:12px;color:var(--muted)">你的专属邀请码</div>' +
      '<div style="font-size:22px;font-weight:800;letter-spacing:2px" class="grad-text">' + esc(code) + '</div></div>' +
      '<button class="btn btn-primary btn-sm" data-action="copy" data-text="' + esc(code) + '">' + icon('i-copy') + '复制</button></div>' +
      '<p style="font-size:12.5px;color:var(--muted);margin-top:14px">· 好友每获得一笔任务结算，你实时到账其 10% 返佣（平台补贴，不扣好友收益）<br>' +
      '· 绑定关系永久有效，返佣直接进入余额，可提现</p>' +
      '<div class="modal-actions"><button class="btn btn-ghost btn-block" data-action="close-layers">我知道了</button></div>');
  }
  function modalUser() {
    if (!C.me) return;
    var lv = levelOf(C.me.totalEarn);
    openModal(
      '<div style="display:flex;align-items:center;gap:14px;margin-bottom:14px">' +
      '<span class="avatar" style="width:52px;height:52px;font-size:20px">' + esc(C.me.name.slice(0, 1)) + '</span>' +
      '<div><div style="font-weight:800;font-size:17px">' + esc(C.me.name) + '</div>' +
      '<div style="font-size:12.5px;color:var(--muted)">' + (C.me.role === 'merchant' ? '商家账号' : '达人账号') + ' · ' + lv.cur.name + '</div></div></div>' +
      '<div class="stat-strip" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:14px">' +
      '<div class="stat-card" style="padding:10px"><div class="num" style="font-size:17px">¥' + money(C.me.balance) + '</div><div class="lab">余额</div></div>' +
      '<div class="stat-card" style="padding:10px"><div class="num" style="font-size:17px">' + C.orders.length + '</div><div class="lab">任务</div></div>' +
      '<div class="stat-card" style="padding:10px"><div class="num" style="font-size:17px">' + C.contents.length + '</div><div class="lab">内容</div></div></div>' +
      '<div class="modal-actions" style="justify-content:space-between">' +
      '<button class="btn btn-danger" data-action="logout">退出登录</button>' +
      '<button class="btn btn-ghost" data-action="close-layers">关闭</button></div>');
  }

  /* ================================================================
     业务动作（全部走服务端 API）
     ================================================================ */
  function requireAuth(next) {
    if (C.me) { next(); return; }
    S.authNext = next;
    openAuth('login');
  }
  function openAuth(tab) { modalAuth(tab); }

  async function doAccept(taskId) {
    try {
      var t = C.tasks.filter(function (x) { return x.id === taskId; })[0];
      await Api.accept(taskId);
      closeLayers();
      toast('任务接受成功，记得在 ' + (t ? t.daysLeft : 7) + ' 天内完成发布哦～');
      await refreshCurrent().catch(function () {});
      if (S.route !== 'my') location.hash = '#/my'; else render();
    } catch (e) { handleErr(e); }
  }

  async function submitLink(orderId) {
    var input = $('#linkInput');
    var v = ((input && input.value) || '').trim();
    if (!v) { toast('请先粘贴作品链接', 'warn'); return; }
    try {
      await Api.submitOrder(orderId, v);
      closeLayers();
      toast('作品已提交，平台审核中…');
      await refreshCurrent().catch(function () {});
      render();
      // 轮询结算结果（服务端审核窗口 5 秒；SSE 推送为主，此处兜底去重）
      setTimeout(async function () {
        try {
          var r = await Api.myOrders();
          C.orders = r.orders;
          var o = r.orders.filter(function (x) { return x.id === orderId; })[0];
          if (o && o.status === 'settled' && !S.notifiedOrders[orderId]) {
            S.notifiedOrders[orderId] = true;
            toast('审核通过！¥' + money(o.paid) + ' 已入账钱包 🎉');
          } else if (o && o.status !== 'settled') {
            toast('作品仍在审核中，通过后将自动实时入账', 'warn');
          }
          if (S.route === 'my' || S.route === 'wallet') { await refreshCurrent().catch(function () {}); render(); }
        } catch (e) { /* 静默 */ }
      }, 6500);
    } catch (e) { handleErr(e); }
  }

  async function doCheckin() {
    try {
      var r = await Api.checkinDo();
      if (C.me) C.me.balance = r.balance;
      toast('打卡成功！¥' + money(r.reward) + ' 已入账');
      await refreshCurrent().catch(function () {});
      render();
    } catch (e) { handleErr(e); }
  }

  async function doInteract(defId) {
    try {
      var r = await Api.interactDo(defId);
      if (C.me) C.me.balance = r.balance;
      toast('完成！¥' + money(r.reward) + ' 已入账');
      await refreshCurrent().catch(function () {});
      render();
    } catch (e) { handleErr(e); }
  }

  function downscale(file, cb) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = 480, w = img.width, h = img.height;
        if (w > max || h > max) { var k = max / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
        var cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        cb(cv.toDataURL('image/jpeg', 0.72));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }
  function refreshPreviews() {
    var box = $('#pubPreviews');
    if (!box) return;
    box.innerHTML = S.pubForm.images.map(function (src, i) {
      return '<div class="pv"><img src="' + src + '" alt=""><button data-action="img-remove" data-i="' + i + '" title="移除">✕</button></div>';
    }).join('');
    var pm = $('#pmImg');
    if (pm) pm.innerHTML = S.pubForm.images.length ? '<img src="' + S.pubForm.images[0] + '" alt="">' : '配图预览区';
  }

  async function doPublish() {
    var title = ($('#pubTitle') || {}).value || '';
    var text = ($('#pubText') || {}).value || '';
    var sched = ($('#pubSchedule') || {}).value || '';
    if (!title.trim()) { toast('先给内容起个标题吧', 'warn'); return; }
    if (!S.pubForm.platforms.length) { toast('至少选择一个发布平台', 'warn'); return; }
    try {
      await Api.publish({
        title: title.trim(), text: text, platforms: S.pubForm.platforms,
        schedule: sched, images: S.pubForm.images
      });
      pendingTitle = ''; pendingText = '';
      S.pubForm = { platforms: ['xhs'], images: [] };
      S.pubTab = 'contents';
      toast(sched ? '已加入定时发布队列，到点自动上线 ⏰' : '一键发布成功，数据回传中 🚀');
      await refreshCurrent().catch(function () {});
      render();
    } catch (e) { handleErr(e); }
  }

  function collectW2(validate) {
    var w = S.wizard;
    w.title = ($('#wzTitle') || {}).value || '';
    w.reward = ($('#wzReward') || {}).value || '';
    w.capacity = ($('#wzCap') || {}).value || '';
    w.days = Number(($('#wzDays') || {}).value) || 7;
    w.fanMin = Number(($('#wzFan') || {}).value) || 0;
    if (!validate) return true;
    if (!w.title.trim()) { toast('请填写任务名称', 'warn'); return false; }
    if (!(Number(w.reward) > 0)) { toast('请填写有效的任务单价', 'warn'); return false; }
    if (!(Number(w.capacity) > 0)) { toast('请填写接单名额', 'warn'); return false; }
    return true;
  }
  function collectW3() {
    var w = S.wizard;
    w.desc = ($('#wzDesc') || {}).value || '';
    w.reqs = ($('#wzReqs') || {}).value || '';
  }
  async function wSubmit() {
    collectW3();
    var w = S.wizard;
    if (!w.platforms.length) { toast('请选择至少一个平台', 'warn'); S.wizard.step = 1; render(); return; }
    try {
      var r = await Api.createTask({
        title: w.title, mode: w.mode, reward: Number(w.reward), capacity: Number(w.capacity),
        days: w.days, fanMin: w.fanMin, desc: w.desc, reqs: w.reqs, platforms: w.platforms
      });
      if (C.me && r.balance !== undefined) C.me.balance = r.balance;
      S.wizard = freshWizard();
      toast('任务发布成功，预算已托管，已进入达人任务广场 🎉');
      location.hash = '#/campaigns';
    } catch (e) {
      handleErr(e);
      if (e.need) { /* 余额不足，可前往充值 */ }
    }
  }

  async function doRecharge() {
    var amount = Number(($('#rcAmount') || {}).value);
    var channel = ($('#rcChannel') || {}).value || 'sandbox';
    if (!(amount >= 1)) { toast('充值金额至少 ¥1', 'warn'); return; }
    try {
      var r = await Api.recharge(amount, channel);
      window.location.href = r.redirect; // 跳转收银台
    } catch (e) { handleErr(e); }
  }
  async function doWithdraw() {
    var amount = Number(($('#wdAmount') || {}).value);
    var account = (($('#wdAccount') || {}).value || '').trim();
    if (!(amount >= 10)) { toast('提现金额需满 ¥10', 'warn'); return; }
    if (!account) { toast('请填写收款账户', 'warn'); return; }
    try {
      var r = await Api.withdraw(amount);
      if (C.me) C.me.balance = r.balance;
      closeLayers();
      toast('提现申请已提交，平台受理后打款（¥' + money(amount) + ' 已冻结）');
      await refreshCurrent().catch(function () {});
      render();
    } catch (e) { handleErr(e); }
  }

  /* ================================================================
     渲染入口
     ================================================================ */
  var VIEWS = {
    market: viewMarket, my: viewMy, publish: viewPublish, interact: viewInteract,
    checkin: viewCheckin, wallet: viewWallet, rank: viewRank, help: viewHelp,
    dash: viewDash, create: viewCreate, campaigns: viewCampaigns
  };

  function render() {
    document.documentElement.setAttribute('data-theme', Api.theme.get());
    $('#themeBtn').innerHTML = icon(Api.theme.get() === 'dark' ? 'i-sun' : 'i-moon');
    renderNav();
    renderUser();
    var fn = VIEWS[S.route] || viewMarket;
    $('#app').innerHTML = fn();
    if (S.route === 'wallet') {
      var cv = $('#walletChart');
      if (cv) drawChart(cv, daily7(), 'rgba(246,196,83,.85)');
      bindCalc();
    }
    if (S.route === 'dash') {
      var dc = $('#dashChart');
      if (dc) drawChart(dc, dailyFrom((C.dash || {}).daily), 'rgba(139,123,255,.85)');
    }
    if (S.route === 'publish' && S.pubTab === 'compose') {
      refreshPreviews();
      bindPublishLive();
      var imgInput = $('#pubImg');
      if (imgInput) {
        imgInput.addEventListener('change', function (e) {
          Array.prototype.slice.call(e.target.files || []).forEach(function (f) {
            if (S.pubForm.images.length >= 3) { toast('最多上传 3 张图片', 'warn'); return; }
            downscale(f, function (dataUrl) {
              S.pubForm.images.push(dataUrl);
              refreshPreviews();
            });
          });
        });
      }
    }
    if (S.route === 'interact') startInteractTimer();
  }

  function bindCalc() {
    var m = $('#calcMode'), p = $('#calcPrice'), q = $('#calcQty'), out = $('#calcOut');
    if (!m) return;
    function calc() {
      var price = Number(p.value) || 0, qty = Number(q.value) || 0, mode = m.value, r = 0;
      if (mode === 'cpe' || mode === 'cpm') r = price * qty / 1000;
      else r = price * qty;
      out.textContent = '¥' + r.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    function syncMode() {
      var mode = m.value;
      var lab = $('#calcQtyLabel');
      if (lab) lab.textContent =
        mode === 'cpe' ? '预估互动量（次）' :
        mode === 'cpm' ? '预估播放量（次）' :
        mode === 'per' ? '动作次数' : '篇数';
      q.value = (mode === 'cpe' || mode === 'cpm') ? 50000 : mode === 'per' ? 200 : 10;
      calc();
    }
    [p, q].forEach(function (el) { el.addEventListener('input', calc); });
    m.addEventListener('change', syncMode);
    calc();
  }

  function bindPublishLive() {
    var t = $('#pubTitle'), x = $('#pubText');
    function sync() {
      pendingTitle = t.value; pendingText = x.value;
      var pt = $('#pmTitle'), px = $('#pmText');
      if (pt) pt.textContent = t.value || '标题会显示在这里';
      if (px) px.textContent = x.value || '正文内容实时预览…';
      var btn = $('.btn[data-action="publish-submit"]');
      if (btn) btn.innerHTML = icon('i-send') + '一键发布到 ' + S.pubForm.platforms.length + ' 个平台';
    }
    if (t) t.addEventListener('input', sync);
    if (x) x.addEventListener('input', sync);
  }

  /* ================================================================
     事件委托
     ================================================================ */
  document.addEventListener('click', function (e) {
    if (e.target.classList && (e.target.classList.contains('modal-mask') || e.target.classList.contains('drawer-mask'))) {
      closeLayers();
      return;
    }
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var act = el.getAttribute('data-action');

    switch (act) {
      case 'nav':
        $('#mobileNav').classList.remove('open');
        location.hash = '#/' + el.getAttribute('data-route');
        break;
      case 'role': {
        var role = el.getAttribute('data-role');
        if (role === S.role) return;
        S.role = role;
        location.hash = role === 'merchant' ? '#/dash' : '#/market';
        break;
      }
      case 'theme': {
        var t = Api.theme.get() === 'dark' ? 'light' : 'dark';
        Api.theme.set(t);
        document.documentElement.setAttribute('data-theme', t);
        $('#themeBtn').innerHTML = icon(t === 'dark' ? 'i-sun' : 'i-moon');
        render();
        break;
      }
      case 'burger':
        $('#mobileNav').classList.toggle('open');
        break;
      case 'auth': openAuth(el.getAttribute('data-tab') || 'login'); break;
      case 'auth-tab': openAuth(el.getAttribute('data-tab')); break;
      case 'auth-submit': doAuthSubmit(); break;
      case 'logout':
        Api.logout();
        C.me = null;
        closeLayers();
        toast('已退出登录', 'warn');
        location.hash = '#/market';
        nav();
        break;
      case 'user-menu': modalUser(); break;
      case 'close-layers': closeLayers(); break;
      case 'open-task': openTask(el.getAttribute('data-id')); break;
      case 'accept':
        var t1 = C.tasks.filter(function (x) { return x.id === el.getAttribute('data-id'); })[0];
        requireAuth(function () { modalAccept(t1); });
        break;
      case 'accept-confirm': doAccept(el.getAttribute('data-id')); break;
      case 'go-my': closeLayers(); location.hash = '#/my'; break;
      case 'submit-link': requireAuth(function () { modalSubmitLink(el.getAttribute('data-id')); }); break;
      case 'submit-link-go': submitLink(el.getAttribute('data-id')); break;
      case 'quick-publish': {
        var taskId = el.getAttribute('data-task') || el.getAttribute('data-id');
        var t2 = C.tasks.filter(function (x) { return x.id === taskId; })[0];
        if (t2) { pendingTitle = t2.title; pendingText = ''; }
        closeLayers();
        S.pubTab = 'compose';
        location.hash = '#/publish';
        if (parseHash() === 'publish') nav(); // hash 未变化时手动刷新
        break;
      }
      case 'checkin': requireAuth(doCheckin); break;
      case 'interact-do': requireAuth(function () { doInteract(el.getAttribute('data-id')); }); break;
      case 'pub-tab': S.pubTab = el.getAttribute('data-tab'); render(); break;
      case 'plat-toggle': {
        var p = el.getAttribute('data-plat');
        var i = S.pubForm.platforms.indexOf(p);
        if (i >= 0) { if (S.pubForm.platforms.length > 1) S.pubForm.platforms.splice(i, 1); }
        else S.pubForm.platforms.push(p);
        render();
        break;
      }
      case 'img-remove':
        S.pubForm.images.splice(Number(el.getAttribute('data-i')), 1);
        refreshPreviews();
        break;
      case 'publish-submit': requireAuth(doPublish); break;
      case 'recharge-open': requireAuth(function () { modalRecharge(); }); break;
      case 'recharge-submit': doRecharge(); break;
      case 'withdraw-open': requireAuth(function () { modalWithdraw(); }); break;
      case 'withdraw-submit': doWithdraw(); break;
      case 'invite': modalInvite(); break;
      case 'copy': {
        var txt = el.getAttribute('data-text');
        if (navigator.clipboard) navigator.clipboard.writeText(txt);
        toast('邀请码已复制：' + txt);
        break;
      }
      case 'faq': {
        var item = el.parentElement;
        var a = $('.faq-a', item);
        var open = item.classList.toggle('open');
        a.style.maxHeight = open ? a.scrollHeight + 'px' : '0';
        break;
      }
      case 'f-plat':
        S.filters.platform = el.getAttribute('data-v');
        nav();
        break;
      case 'f-reset':
        S.filters = { platform: 'all', mode: 'all', sort: 'new', q: '' };
        $('#globalSearch').value = '';
        nav();
        break;
      case 'scroll-list': {
        var top = $('#listTop');
        if (top) top.scrollIntoView({ behavior: 'smooth', block: 'start' });
        break;
      }
      case 'w-plat': {
        var pv = el.getAttribute('data-v');
        var pi = S.wizard.platforms.indexOf(pv);
        if (pi >= 0) S.wizard.platforms.splice(pi, 1); else S.wizard.platforms.push(pv);
        render();
        break;
      }
      case 'w-mode': S.wizard.mode = el.getAttribute('data-v'); render(); break;
      case 'w-next':
        if (S.wizard.step === 1) {
          if (!S.wizard.platforms.length) { toast('请至少选择一个投放平台', 'warn'); return; }
          S.wizard.step = 2; render();
        } else if (S.wizard.step === 2) {
          if (collectW2(true)) { S.wizard.step = 3; render(); }
        }
        break;
      case 'w-prev':
        if (S.wizard.step === 2) collectW2(false);
        if (S.wizard.step === 3) collectW3();
        S.wizard.step--; render();
        break;
      case 'w-submit': wSubmit(); break;
      case 'camp-toggle': {
        var cid = el.getAttribute('data-id');
        Api.campaignStatus(cid).then(async function () {
          toast('投放状态已更新');
          await refreshCurrent().catch(function () {});
          render();
        }).catch(handleErr);
        break;
      }
      case 'toast-demo':
        if (navigator.clipboard) navigator.clipboard.writeText('feedback@guangti.demo');
        toast('反馈邮箱已复制：feedback@guangti.demo');
        break;
    }
  });

  async function doAuthSubmit() {
    var uname = (($('#authName') || {}).value || '').trim();
    var pwd = (($('#authPwd') || {}).value || '');
    try {
      var r;
      if (S.authTab === 'register') {
        var role = (($('#authRole') || {}).value || 'creator');
        var invite = (($('#authInvite') || {}).value || '').trim();
        r = await Api.register(uname, pwd, role, invite);
        toast('注册成功！' + (role === 'merchant' ? '¥8,888 开业广告金已到账' : '¥8 新人礼已到账'));
      } else {
        r = await Api.login(uname, pwd);
        toast('欢迎回来，' + r.user.name);
      }
      Api.setToken(r.token);
      C.me = r.user;
      S.role = C.me.role === 'merchant' ? 'merchant' : 'creator';
      closeLayers();
      var next = S.authNext; S.authNext = null;
      if (next) next();
      else location.hash = defaultRoute();
      nav();
    } catch (e) { handleErr(e); }
  }

  // 下拉框与搜索
  document.addEventListener('change', function (e) {
    if (e.target.id === 'modeSelect') { S.filters.mode = e.target.value; nav(); }
    if (e.target.id === 'sortSelect') { S.filters.sort = e.target.value; nav(); }
  });
  document.addEventListener('input', function (e) {
    if (e.target.id === 'globalSearch') {
      S.filters.q = e.target.value.trim();
      if (S.role === 'creator' && S.route !== 'market') location.hash = '#/market';
      else if (S.role === 'creator') {
        clearTimeout(S._searchT);
        S._searchT = setTimeout(function () { nav(); }, 250);
      }
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeLayers();
  });

  window.addEventListener('hashchange', nav);
  window.addEventListener('resize', function () {
    if (S.route === 'wallet') { var cv = $('#walletChart'); if (cv) drawChart(cv, daily7(), 'rgba(246,196,83,.85)'); }
    if (S.route === 'dash') { var dc = $('#dashChart'); if (dc) drawChart(dc, dailyFrom((C.dash || {}).daily), 'rgba(139,123,255,.85)'); }
  });

  /* ---------------- SSE 实时更新 ---------------- */
  var es = null, liveTimer = null;
  function setLive(on) {
    var dot = $('#liveDot');
    if (dot) {
      dot.classList.toggle('on', on);
      dot.classList.toggle('off', !on);
      dot.title = on ? '实时连接正常 · 数据自动更新' : '实时连接断开，正在重连…';
    }
  }
  function scheduleLive() {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(async function () {
      // 刷新登录态与余额（头部胶囊）
      if (Api.getToken()) {
        try { C.me = (await Api.me()).user; } catch (e) { /* 会话失效由其他流程处理 */ }
      }
      // 用户正在输入或弹层打开时不整体重绘，避免打断操作
      var tag = document.activeElement ? document.activeElement.tagName : '';
      var typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      var layerOpen = !!$('#layerRoot').firstChild;
      if (!typing && !layerOpen) {
        await refreshCurrent().catch(function () {});
        render();
      } else {
        renderUser();
      }
    }, 400);
  }
  function handlePush(m) {
    if (!C.me) return;
    if (m.type === 'order_settled' && m.userId === C.me.id) {
      if (!S.notifiedOrders[m.orderId]) {
        S.notifiedOrders[m.orderId] = true;
        toast('审核通过！「' + String(m.title || '').slice(0, 14) + '…」¥' + money(m.paid) + ' 已实时入账 🎉');
      }
    }
    if (m.type === 'invite_bonus' && m.userId === C.me.id) {
      toast('邀请返佣实时到账 ¥' + money(m.amount) + '（' + (m.from || '好友') + ' 的任务收益）');
    }
    if (m.type === 'task_paused' && m.userId === C.me.id) {
      toast('任务「' + String(m.title || '').slice(0, 14) + '…」托管预算耗尽，已自动停投', 'warn');
    }
    if (m.type === 'content_published' && m.userId === C.me.id) {
      toast('定时内容「' + String(m.title || '').slice(0, 14) + '…」已自动上线 🚀');
    }
  }
  function startLive() {
    try {
      es = new EventSource('/api/stream');
    } catch (e) { setLive(false); return; }
    es.onopen = function () { setLive(true); };
    es.onerror = function () { setLive(false); };
    es.onmessage = function (ev) {
      var m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.type === 'hb') return;
      handlePush(m);
      if (m.type === 'refresh') scheduleLive();
    };
  }

  /* ---------------- 启动 ---------------- */
  (async function boot() {
    document.documentElement.setAttribute('data-theme', Api.theme.get());
    if (Api.getToken()) {
      try { C.me = (await Api.me()).user; } catch (e) { Api.setToken(''); }
    }
    if (C.me) S.role = C.me.role === 'merchant' ? 'merchant' : 'creator';
    startLive();
    if (!parseHash()) location.hash = defaultRoute();
    else nav();
  })();
})();
