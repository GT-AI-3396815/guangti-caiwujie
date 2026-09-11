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
          err.code = data.code;
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

    // 认证中心（实名 / 商家资质）
    kyc: function (realName, idTail) { return request('POST', '/api/kyc', { realName: realName, idTail: idTail }); },
    biz: function (bizName, licenseNo) { return request('POST', '/api/biz', { bizName: bizName, licenseNo: licenseNo }); },

    // 账号
    changePassword: function (oldPassword, newPassword) { return request('POST', '/api/auth/password', { oldPassword: oldPassword, newPassword: newPassword }); },

    // 站内消息
    messages: function () { return request('GET', '/api/messages'); },
    readMessage: function (id) { return request('POST', '/api/messages/' + id + '/read'); },
    readAllMessages: function () { return request('POST', '/api/messages/read-all'); },

    // 举报
    report: function (targetType, targetId, reason) { return request('POST', '/api/reports', { targetType: targetType, targetId: targetId, reason: reason }); },

    // 达人主页
    userProfile: function (id) { return request('GET', '/api/users/' + id + '/profile'); },

    // 验收
    campaignOrders: function (id) { return request('GET', '/api/campaigns/' + id + '/orders'); },
    approveOrder: function (id, rating, reviewText) { return request('POST', '/api/orders/' + id + '/approve', { rating: rating, reviewText: reviewText }); },
    rejectOrder: function (id, reason) { return request('POST', '/api/orders/' + id + '/reject', { reason: reason }); },
    resubmitOrder: function (id, link) { return request('POST', '/api/orders/' + id + '/resubmit', { link: link }); },

    // 内容
    deleteContent: function (id) { return request('DELETE', '/api/contents/' + id); },

    // 运营后台
    admin: {
      overview: function (key) { return request('GET', '/api/admin/overview', undefined, undefined, { 'x-admin-key': key }); },
      reports: function (key) { return request('GET', '/api/admin/reports', undefined, undefined, { 'x-admin-key': key }); },
      resolveReport: function (key, id, result) { return request('POST', '/api/admin/reports/' + id + '/resolve', { result: result }, undefined, { 'x-admin-key': key }); },
      banTask: function (key, id) { return request('POST', '/api/admin/tasks/' + id + '/ban', {}, undefined, { 'x-admin-key': key }); },
      withdrawals: function (key) { return request('GET', '/api/admin/withdrawals', undefined, undefined, { 'x-admin-key': key }); },
      settleWithdrawal: function (key, id) { return request('POST', '/api/admin/withdrawals/' + id + '/settle', {}, undefined, { 'x-admin-key': key }); },
      sensitive: function (key) { return request('GET', '/api/admin/sensitive', undefined, undefined, { 'x-admin-key': key }); },
      addSensitive: function (key, word) { return request('POST', '/api/admin/sensitive', { word: word }, undefined, { 'x-admin-key': key }); }
    },

    // 会话与主题
    getToken: getToken,
    setToken: setToken,
    theme: {
      get: function () { return localStorage.getItem(THEME_KEY) || 'dark'; },
      set: function (t) { localStorage.setItem(THEME_KEY, t); }
    }
  };
})();
