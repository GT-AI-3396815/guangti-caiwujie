/* ============================================================
   光体•财无界 — 客户端 API 层
   会话 Token 存于本地，业务数据全部来自服务端
   ============================================================ */
(function () {
  'use strict';
  var TOKEN_KEY = 'gt_token';
  var THEME_KEY = 'gt_theme';

  function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
  function setToken(t) {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  }

  function request(method, url, body) {
    return fetch(url, {
      method: method,
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        getToken() ? { 'Authorization': 'Bearer ' + getToken() } : {}
      ),
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error(data.error || ('请求失败 ' + res.status));
          err.status = res.status;
          err.need = data.need;
          throw err;
        }
        return data;
      });
    });
  }

  window.Api = {
    // 认证
    register: function (uname, password, role, inviteCode) { return request('POST', '/api/auth/register', { uname: uname, password: password, role: role, inviteCode: inviteCode }); },
    login: function (uname, password) { return request('POST', '/api/auth/login', { uname: uname, password: password }); },
    logout: function () { setToken(''); },
    me: function () { return request('GET', '/api/auth/me'); },

    // 任务与订单
    tasks: function (filters) {
      var q = Object.keys(filters || {}).map(function (k) {
        return filters[k] ? encodeURIComponent(k) + '=' + encodeURIComponent(filters[k]) : '';
      }).filter(Boolean).join('&');
      return request('GET', '/api/tasks' + (q ? '?' + q : ''));
    },
    createTask: function (data) { return request('POST', '/api/tasks', data); },
    campaignStatus: function (id) { return request('POST', '/api/campaigns/' + id + '/status'); },
    campaigns: function () { return request('GET', '/api/campaigns/mine'); },
    dashboard: function () { return request('GET', '/api/merchant/dashboard'); },
    accept: function (taskId) { return request('POST', '/api/orders', { taskId: taskId }); },
    myOrders: function () { return request('GET', '/api/orders/my'); },
    submitOrder: function (id, link) { return request('POST', '/api/orders/' + id + '/submit', { link: link }); },

    // 内容
    publish: function (data) { return request('POST', '/api/contents', data); },
    myContents: function () { return request('GET', '/api/contents/mine'); },

    // 互动 / 打卡
    interact: function () { return request('GET', '/api/interact'); },
    interactDo: function (defId) { return request('POST', '/api/interact/' + defId); },
    checkin: function () { return request('GET', '/api/checkin'); },
    checkinDo: function () { return request('POST', '/api/checkin'); },

    // 钱包
    wallet: function () { return request('GET', '/api/wallet'); },
    recharge: function (amount, channel) { return request('POST', '/api/wallet/recharge', { amount: amount, channel: channel }); },
    withdraw: function (amount) { return request('POST', '/api/wallet/withdraw', { amount: amount }); },

    // 榜单
    rank: function () { return request('GET', '/api/rank'); },

    // 会话与主题
    getToken: getToken,
    setToken: setToken,
    theme: {
      get: function () { return localStorage.getItem(THEME_KEY) || 'dark'; },
      set: function (t) { localStorage.setItem(THEME_KEY, t); }
    }
  };
})();
