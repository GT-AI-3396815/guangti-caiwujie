/* ============================================================
   光体•财无界 — API 集成测试（node tests/api-test.mjs）
   覆盖：认证/邀请/充值/托管/验收状态机/服务费/KYC/消息/举报/
         敏感词/账号报备/改密码/达人主页/内容删除/SSE 定向推送
   限流测试独立于 tests/ratelimit-test.mjs（避免污染认证配额）
   ============================================================ */
import { readFileSync } from 'node:fs';
var BASE = process.env.TEST_BASE || 'http://localhost:8642';
// 运营密钥与服务端同源：环境变量优先，其次本机 config.local.json
var ADMIN_KEY = process.env.ADMIN_KEY || '';
if (!ADMIN_KEY) {
  try {
    ADMIN_KEY = JSON.parse(readFileSync(new URL('../config.local.json', import.meta.url), 'utf8')).ADMIN_KEY || '';
  } catch (e) { /* 无本地配置 */ }
}
var passed = 0, failed = 0;

function ok(cond, name, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? ' | 实际: ' + JSON.stringify(extra) : '')); }
}
async function req(method, path, body, token, extraHeaders) {
  var headers = Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {});
  if (token) headers.Authorization = 'Bearer ' + token;
  var res = await fetch(BASE + path, {
    method: method,
    headers: headers,
    body: (method === 'GET' || body === undefined) ? undefined : JSON.stringify(body)
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

  var merchant = (await req('POST', '/api/auth/register', { uname: '金主爸爸' + suffix, password: 'demo666', role: 'merchant' })).data;
  ok(merchant.user.balance === 8888, '商家注册送¥8,888开业金', merchant.user && merchant.user.balance);
  var mt = merchant.token;
  var bt = invitee.token;
  var at = inviter.token;

  console.log('— 实名与资质认证 —');
  var noBiz = await req('POST', '/api/tasks', { title: '未认证任务', mode: 'fixed', reward: 10, capacity: 1, days: 1 }, mt);
  ok(noBiz.status === 400 && noBiz.data.code === 'need_biz', '未资质认证禁止发布任务', noBiz.data && noBiz.data.code);
  var biz = await req('POST', '/api/biz', { bizName: '金主传媒有限公司', licenseNo: '91110000TEST2026' }, mt);
  ok(biz.status === 200 && biz.data.biz.status === 'verified', '商家资质认证通过');
  var kycBad = await req('POST', '/api/kyc', { realName: '王', idTail: '12' }, bt);
  ok(kycBad.status === 400, '实名信息不完整被拒');
  var kyc = await req('POST', '/api/kyc', { realName: '王小明', idTail: '1234' }, bt);
  ok(kyc.status === 200 && kyc.data.kyc.status === 'verified', '达人实名认证通过');

  console.log('— 充值与账本 —');
  var rc = (await req('POST', '/api/wallet/recharge', { amount: 3000, channel: 'sandbox' }, mt)).data;
  await req('POST', '/api/pay/sandbox/' + rc.recharge.id + '/confirm');
  var w = (await req('GET', '/api/wallet', null, mt)).data;
  ok(w.balance === 11888, '充值3000到账(8888+3000)', w.balance);
  ok(w.daily[new Date().toISOString().slice(0, 10)] === 0, '充值不计入收益口径', w.daily);

  console.log('— 敏感词与托管投放 —');
  var dirty = await req('POST', '/api/tasks', { title: ' cheapest 代刷 推广', mode: 'fixed', reward: 10, capacity: 2, days: 1 }, mt);
  ok(dirty.status === 400 && dirty.data.code === 'sensitive', '任务标题敏感词被拦截', dirty.data && dirty.data.error);
  var created = await req('POST', '/api/tasks', { title: '自动验收·固定价任务', mode: 'fixed', reward: 120, capacity: 30, days: 7, fanMin: 0, desc: 'x', reqs: 'a', platforms: ['xhs'], reviewMode: 'auto' }, mt);
  ok(created.status === 200, '商家创建自动验收任务');
  var createdManual = await req('POST', '/api/tasks', { title: '人工验收·种草任务', mode: 'fixed', reward: 100, capacity: 5, days: 7, desc: 'y', reqs: 'b', platforms: ['dy'], reviewMode: 'manual' }, mt);
  ok(createdManual.status === 200, '商家创建人工验收任务');
  var wm = (await req('GET', '/api/wallet', null, mt)).data;
  ok(wm.balance === 11888 - 3600 - 500, '两任务托管冻结共4100', wm.balance);

  console.log('— 接单与自动验收（含服务费）—');
  var acc = await req('POST', '/api/orders', { taskId: created.data.task.id }, bt);
  ok(acc.status === 200, '达人B接单成功');
  var acc2 = await req('POST', '/api/orders', { taskId: created.data.task.id }, bt);
  ok(acc2.status === 400, '同任务重复接单被拒');
  var accNoKyc = await req('POST', '/api/orders', { taskId: created.data.task.id }, at);
  ok(accNoKyc.status === 200, '接单不强制实名（提现才强制）');
  var badLink = await req('POST', '/api/orders/' + acc.data.order.id + '/submit', { link: 'not-a-url' }, bt);
  ok(badLink.status === 400, '非法作品链接被拒');
  await req('POST', '/api/orders/' + acc.data.order.id + '/submit', { link: 'https://xhs.demo/note/1' }, bt);
  await sleep(5800);
  var orders = (await req('GET', '/api/orders/my', null, bt)).data.orders;
  var done = orders.filter(function (o) { return o.id === acc.data.order.id; })[0];
  ok(done && done.status === 'settled' && done.paid === 120, '自动验收结算额¥120', done && [done.status, done.paid]);
  ok(done.income === 108 && done.fee === 12, '服务费10%拆分(实收108+费12)', done && [done.income, done.fee]);
  var wb = (await req('GET', '/api/wallet', null, bt)).data;
  ok(wb.balance === 116, '达人B余额=8礼金+108实收', wb.balance);
  ok(wb.totalEarn === 108, '累计收益只含实收(108)', wb.totalEarn);
  var wa = (await req('GET', '/api/wallet', null, at)).data;
  ok(wa.balance === 18.8, '邀请返佣=实收10%=¥10.8', wa.balance);

  console.log('— 人工验收：通过/拒稿/重提 —');
  var accM = await req('POST', '/api/orders', { taskId: createdManual.data.task.id }, bt);
  await req('POST', '/api/orders/' + accM.data.order.id + '/submit', { link: 'https://dy.demo/video/1' }, bt);
  var oMid = (await req('GET', '/api/orders/my', null, bt)).data.orders.filter(function (o) { return o.id === accM.data.order.id; })[0];
  ok(oMid.status === 'review' && !oMid.settledAt, '人工验收模式提交后等待商家', oMid.status);
  var msgM = (await req('GET', '/api/messages', null, mt)).data;
  ok(msgM.unread > 0 && msgM.messages.some(function (m) { return m.type === 'order_review'; }), '商家收到待验收站内消息', msgM.unread);
  var rejBad = await req('POST', '/api/orders/' + accM.data.order.id + '/reject', { reason: '不行' }, mt);
  ok(rejBad.status === 400, '拒稿理由过短被拒');
  var rej = await req('POST', '/api/orders/' + accM.data.order.id + '/reject', { reason: '画面曝光不足，请补充分镜细节' }, mt);
  ok(rej.status === 200 && rej.data.order.status === 'rejected', '商家拒稿成功');
  var oRej = (await req('GET', '/api/orders/my', null, bt)).data.orders.filter(function (o) { return o.id === accM.data.order.id; })[0];
  ok(oRej.status === 'rejected' && oRej.rejectReason.length > 0, '达人侧可见拒稿理由');
  var msgB = (await req('GET', '/api/messages', null, bt)).data;
  ok(msgB.messages.some(function (m) { return m.type === 'order_rejected'; }), '达人收到拒稿站内消息');
  var re = await req('POST', '/api/orders/' + accM.data.order.id + '/resubmit', { link: 'https://dy.demo/video/2' }, bt);
  ok(re.status === 200 && re.data.order.status === 'review', '达人修改后重提回验收队列');
  var apClamp = await req('POST', '/api/orders/' + accM.data.order.id + '/approve', { rating: 6, reviewText: '数据表现不错，期待合作' }, mt);
  ok(apClamp.status === 200 && apClamp.data.order.status === 'settled' && apClamp.data.order.income === 90, '商家验收通过，评分越界被夹取，实收¥90(费¥10)', apClamp.data && apClamp.data.order && [apClamp.data.order.income, apClamp.data.order.status]);
  var apAgain = await req('POST', '/api/orders/' + accM.data.order.id + '/approve', { rating: 5 }, mt);
  ok(apAgain.status === 400, '已结算订单不可重复验收');
  var msgB2 = (await req('GET', '/api/messages', null, bt)).data;
  ok(msgB2.messages.some(function (m) { return m.type === 'order_settled'; }), '结算站内消息已送达');
  await req('POST', '/api/messages/read-all', null, bt);
  var msgB3 = (await req('GET', '/api/messages', null, bt)).data;
  ok(msgB3.unread === 0, '全部已读后未读清零');

  console.log('— 达人主页与信用 —');
  var prof = (await req('GET', '/api/users/' + invitee.user.id + '/profile')).data;
  ok(prof.doneCount === 2 && prof.rejectCount === 1, '完成/拒稿计数正确', [prof.doneCount, prof.rejectCount]);
  ok(prof.completionRate === 67, '完成率67%', prof.completionRate);
  ok(prof.avgStars === 5 && prof.ratings.length === 1, '商家评分已记录', prof.avgStars);
  ok(prof.credit < 100 && prof.credit >= 76, '信用分随拒稿扣减', prof.credit);

  console.log('— KYC 门控提现 —');
  var wdNo = await req('POST', '/api/wallet/withdraw', { amount: 50, account: 'a@b.c' }, at);
  ok(wdNo.status === 400 && wdNo.data.code === 'need_kyc', '未实名提现被拦截', wdNo.data && wdNo.data.code);
  await req('POST', '/api/kyc', { realName: '榜一大哥本名', idTail: '5678' }, at);
  var wd = await req('POST', '/api/wallet/withdraw', { amount: 10, account: 'a@b.c' }, at);
  ok(wd.status === 200, '实名后提现受理');
  var wdBad = await req('POST', '/api/wallet/withdraw', { amount: 99999, account: 'a@b.c' }, at);
  ok(wdBad.status === 400, '余额不足提现被拒');
  var wl = (await req('GET', '/api/admin/withdrawals', null, null, { 'x-admin-key': ADMIN_KEY })).data.withdrawals;
  ok(Array.isArray(wl) && wl.length >= 1, '运营可查提现单');
  var res3 = await fetch(BASE + '/api/admin/withdrawals/' + wl[wl.length - 1].id + '/settle', { method: 'POST', headers: { 'x-admin-key': ADMIN_KEY } });
  ok((await res3.json()).withdrawal.status === 'paid', '运营标记打款完成');

  console.log('— 举报与运营处理 —');
  var rp = await req('POST', '/api/reports', { targetType: 'task', targetId: created.data.task.id, reason: '任务描述涉嫌夸大收益' }, bt);
  ok(rp.status === 200 && rp.data.report.status === 'open', '举报提交成功');
  var rpBad = await req('POST', '/api/reports', { targetType: 'task', targetId: 'x', reason: '短' }, bt);
  ok(rpBad.status === 400, '举报理由过短被拒');
  var rpList = (await req('GET', '/api/admin/reports', null, null, { 'x-admin-key': ADMIN_KEY })).data.reports;
  ok(rpList.length >= 1 && rpList[0].reporter, '运营可查举报单(含举报人)');
  var rs = await req('POST', '/api/admin/reports/' + rp.data.report.id + '/resolve', { result: '已要求商家修改描述' }, null, { 'x-admin-key': ADMIN_KEY });
  ok(rs.status === 200 && rs.data.report.status === 'resolved', '运营处理举报');
  var msgR = (await req('GET', '/api/messages', null, bt)).data;
  ok(msgR.messages.some(function (m) { return m.type === 'report_resolved'; }), '举报人收到处理结果消息');

  console.log('— 运营后台 —');
  var ov = (await req('GET', '/api/admin/overview', null, null, { 'x-admin-key': ADMIN_KEY })).data;
  ok(ov.platformRevenue > 0, '平台服务费收入入账', ov.platformRevenue);
  ok(ov.escrow > 0, '托管池余额可见', ov.escrow);
  var ovNo = await req('GET', '/api/admin/overview');
  ok(ovNo.status === 403, '无密钥访问运营接口被拒');
  var ban = await req('POST', '/api/admin/tasks/' + createdManual.data.task.id + '/ban', null, null, { 'x-admin-key': ADMIN_KEY });
  ok(ban.status === 200 && ban.data.task.banned === true, '运营下架任务');
  var listAfter = (await req('GET', '/api/tasks')).data.tasks;
  ok(!listAfter.some(function (t) { return t.id === createdManual.data.task.id; }), '下架任务不再出现在广场');
  var sen = await req('POST', '/api/admin/sensitive', { word: '测试违禁词' }, null, { 'x-admin-key': ADMIN_KEY });
  ok(sen.status === 200 && sen.data.words.indexOf('测试违禁词') >= 0, '敏感词库可增补');

  console.log('— 内容删除与改密码 —');
  var pub = await req('POST', '/api/contents', { title: '待删内容', platforms: ['xhs'] }, bt);
  var del = await req('DELETE', '/api/contents/' + pub.data.content.id, null, bt);
  ok(del.status === 200, '内容删除成功');
  var cl = (await req('GET', '/api/contents/mine', null, bt)).data.contents;
  ok(!cl.some(function (c) { return c.id === pub.data.content.id; }), '删除后列表不含该内容');
  var delOther = await req('DELETE', '/api/contents/' + pub.data.content.id, null, at);
  ok(delOther.status === 404, '他人内容不可删');
  var pw = await req('POST', '/api/auth/password', { oldPassword: 'demo666', newPassword: 'newpass666' }, bt);
  ok(pw.status === 200 && pw.data.token, '修改密码成功并颁发新会话');
  var oldTok = await req('GET', '/api/auth/me', null, bt);
  ok(oldTok.status === 401, '旧会话已吊销');
  var newLogin = await req('POST', '/api/auth/login', { uname: invitee.user.uname, password: 'newpass666' });
  ok(newLogin.status === 200, '新密码可登录');
  bt = newLogin.data.token;

  console.log('— 账号报备与粉丝门控 —');
  var fanTask = await req('POST', '/api/tasks', { title: '高门槛·万粉任务', mode: 'fixed', reward: 60, capacity: 5, days: 7, fanMin: 5000, desc: 'f', reqs: 'r', platforms: ['xhs'], reviewMode: 'auto' }, mt);
  ok(fanTask.status === 200, '商家创建粉丝门槛任务');
  var accNoAcc = await req('POST', '/api/orders', { taskId: fanTask.data.task.id }, bt);
  ok(accNoAcc.status === 400 && accNoAcc.data.code === 'need_account', '未报备账号接单被拦截', accNoAcc.data && accNoAcc.data.error);
  var accAdd = await req('POST', '/api/accounts', { platform: 'xhs', handle: '@接单小王', followers: 6000 }, bt);
  ok(accAdd.status === 200 && accAdd.data.accounts.length === 1, '报备账号成功');
  var accList = (await req('GET', '/api/accounts/mine', null, bt)).data.accounts;
  ok(accList[0].followers === 6000, '报备列表可查', accList);
  var accOk = await req('POST', '/api/orders', { taskId: fanTask.data.task.id }, bt);
  ok(accOk.status === 200, '报备后粉丝门槛通过');
  var accRm = await req('POST', '/api/accounts/remove', { platform: 'xhs', handle: '@接单小王' }, bt);
  ok(accRm.status === 200 && accRm.data.accounts.length === 0, '账号可移除');

  console.log('— 互动目标链接 —');
  var itDef = (await req('GET', '/api/interact', null, bt)).data.defs[0];
  ok(typeof itDef.target === 'string' && itDef.target.indexOf('http') === 0, '互动任务携带目标链接', itDef.target);

  console.log('— 商家待验收计数 —');
  var cmps = (await req('GET', '/api/campaigns/mine', null, mt)).data.campaigns;
  var hasPendingField = cmps.every(function (c) { return typeof c.pendingReview === 'number'; });
  ok(cmps.length >= 2 && hasPendingField, '任务列表含待验收计数字段');

  console.log('— 邀请关系与认证商家标识 —');
  var invList = (await req('GET', '/api/invites/mine', null, at)).data;
  ok(invList.invited.length >= 1 && invList.invited[0].name === invitee.user.name, '邀请人可查受邀列表', invList.invited);
  ok(Number(invList.bonusTotal) >= 10.8, '累计返佣统计正确', invList.bonusTotal);
  var tasksPub = (await req('GET', '/api/tasks')).data.tasks;
  var mvTask = tasksPub.filter(function (t) { return t.id === created.data.task.id; })[0];
  ok(mvTask && mvTask.merchantVerified === true, '认证商家标识下发', mvTask && mvTask.merchantVerified);

  console.log('— SSE 个人事件推送（带令牌） —');
  var sseTask = await req('POST', '/api/tasks', { title: 'SSE 验证·人工验收', mode: 'fixed', reward: 30, capacity: 3, days: 5, desc: 's', reqs: 'r', platforms: ['xhs'], reviewMode: 'manual' }, mt);
  ok(sseTask.status === 200, '创建 SSE 验证任务');
  var accS = await req('POST', '/api/orders', { taskId: sseTask.data.task.id }, bt);
  ok(accS.status === 200, '达人接 SSE 验证任务');
  await req('POST', '/api/orders/' + accS.data.order.id + '/submit', { link: 'https://xhs.demo/sse-001' }, bt);
  var ctrl2 = new AbortController();
  var streamRes2 = await fetch(BASE + '/api/stream?token=' + encodeURIComponent(bt), { signal: ctrl2.signal });
  ok(streamRes2.status === 200, '带令牌 SSE 通道建立');
  var reader2 = streamRes2.body.getReader();
  var dec2 = new TextDecoder();
  var personalFrame = '';
  var readLoop2 = (async function () {
    try {
      for (;;) {
        var chunk = await reader2.read();
        if (chunk.done) break;
        personalFrame += dec2.decode(chunk.value);
        if (personalFrame.indexOf('"order_rejected"') >= 0) break;
      }
    } catch (e) { /* 中止 */ }
  })();
  await sleep(300);
  var rj2 = await req('POST', '/api/orders/' + accS.data.order.id + '/reject', { reason: '测试拒稿·数据不足请补充' }, mt);
  ok(rj2.status === 200, '人工拒稿触发（用于验证个人推送）');
  var t1 = Date.now();
  while (Date.now() - t1 < 4000 && personalFrame.indexOf('"order_rejected"') < 0) await sleep(100);
  ctrl2.abort();
  await readLoop2;
  ok(personalFrame.indexOf('"order_rejected"') >= 0, '个人事件按身份定向推送(拒稿)', personalFrame.slice(0, 100));

  console.log('— CPE 托管封顶（击穿防护） —');
  var cpeTask = await req('POST', '/api/tasks', { title: 'CPE 封顶验证', mode: 'cpe', reward: 10, capacity: 2, days: 3, fanMin: 0, desc: 'c', reqs: 'c', platforms: ['dy'], reviewMode: 'auto' }, mt);
  ok(cpeTask.status === 200, '创建 CPE 自动验收任务');
  var accC = await req('POST', '/api/orders', { taskId: cpeTask.data.task.id }, bt);
  await req('POST', '/api/orders/' + accC.data.order.id + '/submit', { link: 'https://dy.demo/cpe-001' }, bt);
  await sleep(5800);
  var cpeDetail = (await req('GET', '/api/tasks/' + cpeTask.data.task.id)).data.task;
  ok(cpeDetail.spend <= cpeDetail.budget, 'CPE 结算被托管预算封顶', [cpeDetail.spend, cpeDetail.budget]);

  console.log('— 榜单与安全 —');
  var rank = (await req('GET', '/api/rank')).data;
  ok(rank.list.every(function (x) { return !x.seed; }), '榜单无示例数据(纯真实用户)');
  var r = await fetch(BASE + '/api/orders/my');
  ok(r.status === 401, '未登录访问订单被拒');
  var xss = await req('POST', '/api/auth/register', { uname: '<img src=x>', password: 'demo666', role: 'creator' });
  ok(xss.status === 400, '非法用户名被拒(防注入)');

  console.log('— SSE 实时广播 —');
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
  await req('POST', '/api/interact/I2', null, bt);
  var t0 = Date.now();
  while (Date.now() - t0 < 4000 && gotFrame.indexOf('"refresh"') < 0) await sleep(100);
  ctrl.abort();
  await readLoop;
  ok(gotFrame.indexOf('"refresh"') >= 0, '变更事件实时推送到订阅端', gotFrame.slice(0, 80));

  console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { console.error('测试脚本异常:', e); process.exit(1); });
