/* ============================================================
   光体•财无界 — 限流专项测试（node tests/ratelimit-test.mjs）
   独立运行：避免污染主套件的认证配额
   运行前需重启服务（限流计数在服务内存中）
   ============================================================ */
var BASE = process.env.TEST_BASE || 'http://localhost:8642';
var passed = 0, failed = 0;
function ok(cond, name, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? ' | 实际: ' + JSON.stringify(extra) : '')); }
}
async function req(method, path, body) {
  var res = await fetch(BASE + path, {
    method: method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  var data = await res.json().catch(function () { return {}; });
  return { status: res.status, data: data };
}

(async function main() {
  console.log('— 认证限流（爆破防护） —');
  var burst429 = 0, other = 0;
  for (var i = 0; i < 60; i++) {
    var rr = await req('POST', '/api/auth/login', { uname: 'rl_burst_' + i, password: 'wrongpwd' });
    if (rr.status === 429) burst429++;
    else other++;
  }
  ok(burst429 > 0, '认证接口触发限流(429)', burst429 + ' 次 / 正常响应 ' + other + ' 次');
  console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { console.error('测试脚本异常:', e); process.exit(1); });
