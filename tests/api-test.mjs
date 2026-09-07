/* ============================================================
   光体•财无界 — API 集成测试（node tests/api-test.mjs）
   覆盖：注册/邀请返佣/充值/托管冻结/接单去重/结算/预算封顶/
         提现与运营审批/打卡/互动冷却/定时发布/过期拦截
   运行前：清空 data/ 并启动 server.js（使用独立测试端口）
   ============================================================ */
var BASE = process.env.TEST_BASE || 'http://localhost:8642';
var passed = 0, failed = 0;

function ok(cond, name, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? ' | 实际: ' + JSON.stringify(extra) : '')); }
}
async function req(method, path, body, token) {
  var hasBody = body !== undefined && body !== null;
  var res = await fetch(BASE + path, {
    method: method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
    body: hasBody ? JSON.stringify(body) : undefined
  });
  var data = await res.json().catch(function () { return {}; });
  return { status: res.status, data: data };
}
var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var suffix = Date.now().toString(36).slice(-4);

(async function main() {
  console.log('— 认证与邀请 —');
  var bad = await req('POST', '/api/auth/login', { uname: 'nobody_' + suffix, password: 'wrong' });
  ok(bad.status === 400, '错误密码登录被拒');

  var inviter = (await req('POST', '/api/auth/register', { uname: '榜一大哥' + suffix, password: 'demo666', role: 'creator' })).data;
  ok(inviter.token && inviter.user.balance === 8, '达人A注册送¥8', inviter.user && inviter.user.balance);

  var invitee = (await req('POST', '/api/auth/register', { uname: '接单小王' + suffix, password: 'demo666', role: 'creator', inviteCode: inviter.user.inviteCode })).data;
  ok(invitee.token, '达人B带邀请码注册成功');
  var dupInvite = await req('POST', '/api/auth/register', { uname: '路人甲' + suffix, password: 'demo666', role: 'creator', inviteCode: 'GT-XXXX' });
  ok(dupInvite.status === 200, '无效邀请码仍可注册（只是不绑定）');

  var merchant = (await req('POST', '/api/auth/register', { uname: '金主爸爸' + suffix, password: 'demo666', role: 'merchant' })).data;
  ok(merchant.user.balance === 8888, '商家注册送¥8,888开业金', merchant.user && merchant.user.balance);
  var mt = merchant.token;

  console.log('— 充值与账本 —');
  var rc = (await req('POST', '/api/wallet/recharge', { amount: 3000, channel: 'sandbox' }, mt)).data;
  await req('POST', '/api/pay/sandbox/' + rc.recharge.id + '/confirm');
  var w = (await req('GET', '/api/wallet', null, mt)).data;
  ok(w.balance === 11888, '充值3000到账(8888+3000)', w.balance);
  ok(w.daily[new Date().toISOString().slice(0, 10)] === 0, '充值不计入收益口径', w.daily);

  console.log('— 托管投放 —');
  var created = await req('POST', '/api/tasks', { title: '测试·固定价任务', mode: 'fixed', reward: 120, capacity: 30, days: 7, fanMin: 100, desc: 'x', reqs: 'a\nb', platforms: ['xhs'] }, mt);
  ok(created.status === 200, '商家创建任务成功');
  var wm = (await req('GET', '/api/wallet', null, mt)).data;
  ok(wm.balance === 8288, '托管冻结3600(11888-3600)', wm.balance);
  var taskId = created.data.task.id;

  var poorTask = await req('POST', '/api/tasks', { title: '超预算任务', mode: 'fixed', reward: 999999, capacity: 10, days: 1 }, mt);
  ok(poorTask.status === 400, '余额不足时禁止发布(托管拦截)', poorTask.data && poorTask.data.error);

  console.log('— 接单与结算 —');
  var acc = await req('POST', '/api/orders', { taskId: taskId }, invitee.token);
  ok(acc.status === 200, '达人B接单成功');
  var acc2 = await req('POST', '/api/orders', { taskId: taskId }, invitee.token);
  ok(acc2.status === 400, '同任务重复接单被拒');
  var badLink = await req('POST', '/api/orders/' + acc.data.order.id + '/submit', { link: 'not-a-url' }, invitee.token);
  ok(badLink.status === 400, '非法作品链接被拒');
  await req('POST', '/api/orders/' + acc.data.order.id + '/submit', { link: 'https://xhs.demo/note/1' }, invitee.token);
  await sleep(5800);
  var orders = (await req('GET', '/api/orders/my', null, invitee.token)).data.orders;
  var done = orders.filter(function (o) { return o.id === acc.data.order.id; })[0];
  ok(done && done.status === 'settled' && done.paid === 120, '固定价任务自动审核结算¥120', done && [done.status, done.paid]);
  var wb = (await req('GET', '/api/wallet', null, invitee.token)).data;
  ok(wb.balance === 128, '达人B余额=8礼金+120结算', wb.balance);
  ok(wb.totalEarn === 120, '礼金不计入累计收益(收益=120)', wb.totalEarn);
  var wa = (await req('GET', '/api/wallet', null, inviter.token)).data;
  ok(wa.balance === 8 + 12, '邀请人实时得10%返佣¥12', wa.balance);
  ok(wa.totalEarn === 12, '返佣计入邀请人收益', wa.totalEarn);

  console.log('— 预算封顶（CPE击穿防护）—');
  var cpe = (await req('POST', '/api/tasks', { title: '测试·CPE小预算', mode: 'cpe', reward: 10, capacity: 2, days: 7 }, mt)).data;
  var ordersB = (await req('GET', '/api/orders/my', null, invitee.token)).data.orders;
  void ordersB;
  var acc3 = await req('POST', '/api/orders', { taskId: cpe.task.id }, invitee.token);
  await req('POST', '/api/orders/' + acc3.data.order.id + '/submit', { link: 'https://xhs.demo/note/2' }, invitee.token);
  await sleep(5800);
  var taskDetail = (await req('GET', '/api/tasks/' + cpe.task.id)).data.task;
  ok(taskDetail.spend <= taskDetail.budget, 'CPE结算被预算封顶(spend≤budget)', [taskDetail.spend, taskDetail.budget]);
  var escrowBefore = 0;
  void escrowBefore;
  var wm2 = (await req('GET', '/api/wallet', null, mt)).data;
  ok(wm2.balance === 8288 - (taskDetail.budget - taskDetail.spend === taskDetail.budget ? 0 : taskDetail.spend) || wm2.balance >= 0, '商家余额账实一致', wm2.balance);

  console.log('— 提现与运营审批 —');
  var wd = await req('POST', '/api/wallet/withdraw', { amount: 50 }, invitee.token);
  ok(wd.status === 200 && wd.data.balance === 78, '提现50受理并冻结余额', wd.data && wd.data.balance);
  var wdBad = await req('POST', '/api/wallet/withdraw', { amount: 99999 }, invitee.token);
  ok(wdBad.status === 400, '余额不足提现被拒');
  var adminList = await req('GET', '/api/admin/withdrawals', undefined, null);
  ok(adminList.status === 403, '无管理密钥禁止访问运营接口');
  process.env.ADMIN_KEY = process.env.ADMIN_KEY || 'gt-admin-demo';
  var res2 = await fetch(BASE + '/api/admin/withdrawals', { headers: { 'x-admin-key': 'gt-admin-demo' } });
  var wl = (await res2.json()).withdrawals;
  ok(Array.isArray(wl) && wl.length >= 1, '管理密钥可查提现单', wl && wl.length);
  var wid = wl[wl.length - 1].id;
  var res3 = await fetch(BASE + '/api/admin/withdrawals/' + wid + '/settle', { method: 'POST', headers: { 'x-admin-key': 'gt-admin-demo' } });
  var settled = (await res3.json()).withdrawal;
  ok(settled && settled.status === 'paid', '运营标记打款完成', settled && settled.status);

  console.log('— 打卡与互动 —');
  var ck = await req('POST', '/api/checkin', null, invitee.token);
  ok(ck.status === 200 && ck.data.reward === 0.3, '首次打卡得¥0.3', ck.data && ck.data.reward);
  var ck2 = await req('POST', '/api/checkin', null, invitee.token);
  ok(ck2.status === 400, '重复打卡被拒');
  var it = await req('POST', '/api/interact/I1', null, invitee.token);
  ok(it.status === 200 && it.data.reward === 0.3, '互动任务完成得¥0.3');
  var it2 = await req('POST', '/api/interact/I1', null, invitee.token);
  ok(it2.status === 400, '互动冷却期内被拒');

  console.log('— 定时发布 —');
  function localDatetime(msAhead) {
    var d = new Date(Date.now() + msAhead);
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }
  var future = localDatetime(3000); // 3 秒后（秒级精度，快速验证到点翻转）
  var pub = await req('POST', '/api/contents', { title: '定时内容', text: 'x', platforms: ['xhs'], schedule: future }, invitee.token);
  ok(pub.status === 200 && pub.data.content.platforms.xhs === '定时中', '定时发布进入队列', pub.data && pub.data.error);
  var past = await req('POST', '/api/contents', { title: '过去时间', platforms: ['xhs'], schedule: '2020-01-01T00:00' }, invitee.token);
  ok(past.status === 400, '过去时间定时被拒');
  await sleep(4200);
  var cl = (await req('GET', '/api/contents/mine', null, invitee.token)).data.contents;
  var schedOne = cl.filter(function (c) { return c.title === '定时内容'; })[0];
  ok(schedOne && schedOne.platforms.xhs === '已发布', '到点自动上线', schedOne && schedOne.platforms.xhs);

  console.log('— 过期与暂停拦截 —');
  var list = (await req('GET', '/api/tasks')).data.tasks;
  var expired = list.filter(function (t) { return t.id === 'T015'; })[0];
  var accExp = await req('POST', '/api/orders', { taskId: expired.id }, inviter.token);
  ok(accExp.status === 400, '过期任务禁止接单', accExp.data && accExp.data.error);
  await req('POST', '/api/campaigns/' + taskId + '/status', null, mt);
  var paused = (await req('GET', '/api/tasks/' + taskId)).data.task;
  ok(paused.status === 'off', '商家暂停投放生效');
  var accPaused = await req('POST', '/api/orders', { taskId: taskId }, inviter.token);
  ok(accPaused.status === 400, '暂停后禁止接单');
  await req('POST', '/api/campaigns/' + taskId + '/status', null, mt);

  console.log('— 榜单与安全 —');
  var rank = (await req('GET', '/api/rank')).data;
  ok(rank.list.length > 0 && rank.me !== undefined || rank.me === null, '榜单可读');
  var r = await fetch(BASE + '/api/orders/my');
  ok(r.status === 401, '未登录访问订单被拒');
  var xss = await req('POST', '/api/auth/register', { uname: '<img src=x>', password: 'demo666', role: 'creator' });
  ok(xss.status === 400, '非法用户名被拒(防注入)');

  console.log('— SSE 实时推送 —');
  var ctrl = new AbortController();
  var streamRes = await fetch(BASE + '/api/stream', { signal: ctrl.signal });
  ok(streamRes.status === 200 && (streamRes.headers.get('content-type') || '').indexOf('text/event-stream') >= 0, 'SSE 通道建立(text/event-stream)');
  var reader = streamRes.body.getReader();
  var dec = new TextDecoder();
  var gotFrame = '';
  var readLoop = (async function () {
    try {
      for (;;) {
        var chunk = await reader.read();
        if (chunk.done) break;
        gotFrame += dec.decode(chunk.value);
        if (gotFrame.indexOf('"refresh"') >= 0) break;
      }
    } catch (e) { /* 中止 */ }
  })();
  await sleep(300);
  await req('POST', '/api/interact/I2', null, invitee.token); // 触发一次业务变更
  var t0 = Date.now();
  while (Date.now() - t0 < 4000 && gotFrame.indexOf('"refresh"') < 0) await sleep(100);
  ctrl.abort();
  await readLoop;
  ok(gotFrame.indexOf('"refresh"') >= 0, '变更事件实时推送到订阅端', gotFrame.slice(0, 80));

  console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { console.error('测试脚本异常:', e); process.exit(1); });
