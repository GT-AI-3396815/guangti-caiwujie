/* ============================================================
   光体•财无界 — 前端常量
   业务数据全部来自服务端（见 server.js 与 /api/*）
   ============================================================ */
(function () {
  'use strict';
  window.GT = {
    PLATFORMS: {
      xhs:  { name: '小红书', color: '#ff2442', ch: '红' },
      dy:   { name: '抖音',   color: '#fe2c55', ch: '抖' },
      sph:  { name: '视频号', color: '#07c160', ch: '视' },
      bili: { name: 'B站',    color: '#fb7299', ch: 'B' },
      wb:   { name: '微博',   color: '#e6162d', ch: '微' },
      ks:   { name: '快手',   color: '#ff5004', ch: '快' }
    },
    MODES: {
      fixed:     { name: '固定价格', desc: '按篇结算，发布审核通过即得全额' },
      cpe:       { name: 'CPE 互动', desc: '按有效互动量（赞/评/藏/转）结算' },
      cpm:       { name: 'CPM 曝光', desc: '按千次有效播放结算，上不封顶' },
      ladder:    { name: '阶梯奖励', desc: '数据越高，单价越高，多劳多得' },
      milestone: { name: '里程碑',   desc: '达成阶段目标解锁对应奖金' },
      per:       { name: '按次结算', desc: '完成一次动作结算一次' }
    },
    COVERS: [
      'linear-gradient(135deg,#f6c453,#ff8f6b)', 'linear-gradient(135deg,#8b7bff,#4fd8e0)',
      'linear-gradient(135deg,#ff6b81,#8b7bff)', 'linear-gradient(135deg,#3ddc97,#4fd8e0)',
      'linear-gradient(135deg,#5aa7ff,#8b7bff)', 'linear-gradient(135deg,#ff8f6b,#f6c453)'
    ],
    LEVELS: [
      { min: 0,     name: 'L1 见习光子' },
      { min: 100,   name: 'L2 流光创作者' },
      { min: 500,   name: 'L3 曜金创作者' },
      { min: 2000,  name: 'L4 星辉合伙人' },
      { min: 10000, name: 'L5 无界大师' }
    ]
  };
})();
