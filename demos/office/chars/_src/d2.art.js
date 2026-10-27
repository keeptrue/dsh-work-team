/* 方向 B · 团子兽 —— 扁平色块 + 统一 2 单位墨线，64 网格 */
window.ART = (function () {
  'use strict';

  var INK = '#2E2A33';
  var CREAM = '#FFF4E2';
  var DESK = '#F3E7D5', DESK_LINE = '#CBB79A';

  var P = {
    pm: { sp: 'cat',     fur: '#FFB870', main: '#EF6B45', acc: '#F6B23E', k: 1 },
    fe: { sp: 'rabbit',  fur: '#A8D8FF', main: '#3E86F5', acc: '#38C8E8', k: 1.02 },
    be: { sp: 'bear',    fur: '#C3AEFF', main: '#7A5AE0', acc: '#B9A6FF', k: 1.05 },
    rv: { sp: 'dog',     fur: '#7FDCC8', main: '#12A594', acc: '#7FE0CE', k: 0.92 },
    rs: { sp: 'fox',     fur: '#FFC94D', main: '#E0A22A', acc: '#FFD98A', k: 0.88 },
    ds: { sp: 'sheep',   fur: '#FFA8C8', main: '#E85D9E', acc: '#FFC2DC', k: 0.96 },
    op: { sp: 'raccoon', fur: '#8FD3A8', main: '#2E9E6B', acc: '#9BE3BC', k: 1.02 },
    wr: { sp: 'bird',    fur: '#F0C39B', main: '#B4552F', acc: '#F4D9A6', k: 0.94 }
  };

  var NOTE = {
    pm: '橘猫 · 三角耳 + 卷尾 + 领巾',
    fe: '长耳兔 · 一只耳朵折下来',
    be: '圆耳熊 · 最宽的团子 + 大肚皮',
    rv: '垂耳狗 · 耳朵盖住脸侧',
    rs: '大耳狐 · 蓬尾 + 白嘴',
    ds: '卷角羊 · 云朵刘海 + 铃铛',
    op: '环尾浣熊 · 三条尾巴环',
    wr: '小鸟 · 三根呆毛 + 尖喙'
  };

  function rgb(h) { return [1, 3, 5].map(function (i) { return parseInt(h.slice(i, i + 2), 16); }); }
  function toHex(a) {
    return '#' + a.map(function (v) {
      v = Math.round(Math.max(0, Math.min(255, v)));
      return (v < 16 ? '0' : '') + v.toString(16);
    }).join('');
  }
  function mix(a, b, t) {
    var A = rgb(a), B = rgb(b);
    return toHex(A.map(function (v, i) { return v + (B[i] - v) * t; }));
  }

  function geo(p, pose) {
    var cx = 32;
    var rx = 15.5, ry = 13;
    var cy = pose === 'sit' ? 19 : 20;
    var headBottom = cy + ry;
    return {
      cx: cx, cy: cy, rx: rx, ry: ry, T: cy - ry, B: headBottom,
      eyeY: cy + 1.4, eyeDX: 6.1, mouthY: cy + 7.2,
      bodyTop: headBottom - 1, bw: 27
    };
  }

  /* ── 耳朵 / 角 / 呆毛（头后面） ─────── */
  function ears(p, g) {
    var cx = g.cx, T = g.T, out = '', inner = '';
    if (p.sp === 'cat') {
      out = '<path d="M' + (cx - 13) + ' ' + (T + 5.5) + ' L' + (cx - 10.4) + ' ' + (T - 6.4) + ' L' + (cx - 2.2) + ' ' + (T + 3.6) + ' Z" fill="' + p.fur + '" stroke="' + INK + '" stroke-width="2" stroke-linejoin="round"/>' +
        '<path d="M' + (cx + 13) + ' ' + (T + 5.5) + ' L' + (cx + 10.4) + ' ' + (T - 6.4) + ' L' + (cx + 2.2) + ' ' + (T + 3.6) + ' Z" fill="' + p.fur + '" stroke="' + INK + '" stroke-width="2" stroke-linejoin="round"/>';
      inner = '<path d="M' + (cx - 10.6) + ' ' + (T + 3.2) + ' L' + (cx - 9.4) + ' ' + (T - 3) + ' L' + (cx - 5.2) + ' ' + (T + 2.4) + ' Z" fill="' + mix(p.fur, '#FFFFFF', .45) + '"/>' +
        '<path d="M' + (cx + 10.6) + ' ' + (T + 3.2) + ' L' + (cx + 9.4) + ' ' + (T - 3) + ' L' + (cx + 5.2) + ' ' + (T + 2.4) + ' Z" fill="' + mix(p.fur, '#FFFFFF', .45) + '"/>';
    } else if (p.sp === 'rabbit') {
      out = '<ellipse cx="' + (cx - 7) + '" cy="' + (T - 5) + '" rx="4.8" ry="10.8" fill="' + p.fur + '" stroke="' + INK + '" stroke-width="2" transform="rotate(-8 ' + (cx - 7) + ' ' + (T - 5) + ')"/>' +
        '<ellipse cx="' + (cx + 7.4) + '" cy="' + (T - 3.4) + '" rx="4.8" ry="10.8" fill="' + p.fur + '" stroke="' + INK + '" stroke-width="2" transform="rotate(26 ' + (cx + 7.4) + ' ' + (T - 3.4) + ')"/>';
      inner = '<ellipse cx="' + (cx - 7) + '" cy="' + (T - 5) + '" rx="1.9" ry="7.4" fill="' + mix(p.fur, '#FFFFFF', .5) + '" transform="rotate(-8 ' + (cx - 7) + ' ' + (T - 5) + ')"/>' +
        '<ellipse cx="' + (cx + 8.4) + '" cy="' + (T - 3.8) + '" rx="1.9" ry="7.4" fill="' + mix(p.fur, '#FFFFFF', .5) + '" transform="rotate(26 ' + (cx + 8.4) + ' ' + (T - 3.8) + ')"/>';
    } else if (p.sp === 'bear') {
      out = '<circle cx="' + (cx - 11.4) + '" cy="' + (T + 3.4) + '" r="5.8" fill="' + p.fur + '" stroke="' + INK + '" stroke-width="2"/>' +
        '<circle cx="' + (cx + 11.4) + '" cy="' + (T + 3.4) + '" r="5.8" fill="' + p.fur + '" stroke="' + INK + '" stroke-width="2"/>';
      inner = '<circle cx="' + (cx - 11.4) + '" cy="' + (T + 3.4) + '" r="2.6" fill="' + mix(p.fur, '#FFFFFF', .4) + '"/>' +
        '<circle cx="' + (cx + 11.4) + '" cy="' + (T + 3.4) + '" r="2.6" fill="' + mix(p.fur, '#FFFFFF', .4) + '"/>';
    } else if (p.sp === 'dog') {
      out = '<path d="M' + (cx - 13.6) + ' ' + (T + 3) + ' Q' + (cx - 19.4) + ' ' + (T + 14) + ' ' + (cx - 12.4) + ' ' + (T + 22) +
        ' Q' + (cx - 8.4) + ' ' + (T + 18) + ' ' + (cx - 8.4) + ' ' + (T + 6) + ' Z" fill="' + p.fur + '" stroke="' + INK + '" stroke-width="2" stroke-linejoin="round"/>' +
        '<path d="M' + (cx + 13.6) + ' ' + (T + 3) + ' Q' + (cx + 19.4) + ' ' + (T + 14) + ' ' + (cx + 12.4) + ' ' + (T + 22) +
        ' Q' + (cx + 8.4) + ' ' + (T + 18) + ' ' + (cx + 8.4) + ' ' + (T + 6) + ' Z" fill="' + p.fur + '" stroke="' + INK + '" stroke-width="2" stroke-linejoin="round"/>';
    } else if (p.sp === 'fox') {
      out = '<path d="M' + (cx - 14.4) + ' ' + (T + 7) + ' L' + (cx - 11.6) + ' ' + (T - 11.6) + ' L' + (cx - 2) + ' ' + (T + 3.2) + ' Z" fill="' + p.fur + '" stroke="' + INK + '" stroke-width="2" stroke-linejoin="round"/>' +
        '<path d="M' + (cx + 14.4) + ' ' + (T + 7) + ' L' + (cx + 11.6) + ' ' + (T - 11.6) + ' L' + (cx + 2) + ' ' + (T + 3.2) + ' Z" fill="' + p.fur + '" stroke="' + INK + '" stroke-width="2" stroke-linejoin="round"/>';
      inner = '<path d="M' + (cx - 11.4) + ' ' + (T + 3.6) + ' L' + (cx - 10) + ' ' + (T - 6.4) + ' L' + (cx - 5.2) + ' ' + (T + 1.6) + ' Z" fill="' + CREAM + '"/>' +
        '<path d="M' + (cx + 11.4) + ' ' + (T + 3.6) + ' L' + (cx + 10) + ' ' + (T - 6.4) + ' L' + (cx + 5.2) + ' ' + (T + 1.6) + ' Z" fill="' + CREAM + '"/>';
    } else if (p.sp === 'sheep') {
      out = '<path d="M' + (cx - 12.4) + ' ' + (T + 2) + ' a6.4 6.4 0 1 0 6.4 6.4 a4.4 4.4 0 1 0 -6.4 -6.4 Z" fill="' + mix(p.acc, '#FFFFFF', .2) + '" stroke="' + INK + '" stroke-width="2"/>' +
        '<path d="M' + (cx + 12.4) + ' ' + (T + 2) + ' a6.4 6.4 0 1 1 -6.4 6.4 a4.4 4.4 0 1 1 6.4 -6.4 Z" fill="' + mix(p.acc, '#FFFFFF', .2) + '" stroke="' + INK + '" stroke-width="2"/>';
      inner = '<path d="M' + (cx - 15) + ' ' + (T + 1.6) + ' q3 -5.6 6.4 -2.4 q3.2 -4.4 6.6 -1.2 q3.4 -3.6 6.6 .6 q3.4 -2.6 6.4 1.6" fill="' + CREAM + '" stroke="' + INK + '" stroke-width="2" stroke-linejoin="round"/>';
    } else if (p.sp === 'raccoon') {
      out = '<circle cx="' + (cx - 11.6) + '" cy="' + (T + 3) + '" r="5" fill="' + p.fur + '" stroke="' + INK + '" stroke-width="2"/>' +
        '<circle cx="' + (cx + 11.6) + '" cy="' + (T + 3) + '" r="5" fill="' + p.fur + '" stroke="' + INK + '" stroke-width="2"/>';
      inner = '<circle cx="' + (cx - 11.6) + '" cy="' + (T + 3) + '" r="2.2" fill="' + mix(p.fur, '#FFFFFF', .4) + '"/>' +
        '<circle cx="' + (cx + 11.6) + '" cy="' + (T + 3) + '" r="2.2" fill="' + mix(p.fur, '#FFFFFF', .4) + '"/>';
    } else {
      out = '<path d="M' + (cx - 2) + ' ' + (T + 3) + ' q-4.6 -9.6 -7.6 -12.4 q5.4 1 8.6 8.2 Z" fill="' + p.fur + '" stroke="' + INK + '" stroke-width="2" stroke-linejoin="round"/>' +
        '<path d="M' + (cx) + ' ' + (T + 2.4) + ' q0 -10 1.2 -14.4 q2.6 5 1.6 14.4 Z" fill="' + p.fur + '" stroke="' + INK + '" stroke-width="2" stroke-linejoin="round"/>' +
        '<path d="M' + (cx + 2.6) + ' ' + (T + 3) + ' q5 -8.4 8.4 -10.6 q-3.6 5.6 -6.6 11.6 Z" fill="' + p.fur + '" stroke="' + INK + '" stroke-width="2" stroke-linejoin="round"/>';
    }
    return { out: out, inner: inner };
  }

  /* ── 尾巴（身体后面） ───────────────── */
  function tail(p, g) {
    var cx = g.cx;
    if (p.sp === 'cat') {
      return '<path d="M' + (cx + 11) + ' 58 Q' + (cx + 23) + ' 56 ' + (cx + 22) + ' 46 Q' + (cx + 21.4) + ' 40 ' + (cx + 17) + ' 41" fill="none" stroke="' + INK + '" stroke-width="8.4" stroke-linecap="round"/>' +
        '<path d="M' + (cx + 11) + ' 58 Q' + (cx + 23) + ' 56 ' + (cx + 22) + ' 46 Q' + (cx + 21.4) + ' 40 ' + (cx + 17) + ' 41" fill="none" stroke="' + p.fur + '" stroke-width="4.4" stroke-linecap="round"/>';
    }
    if (p.sp === 'rabbit' || p.sp === 'bear' || p.sp === 'sheep') {
      return '<circle cx="' + (cx + 12.6) + '" cy="57" r="4.6" fill="' + mix(p.fur, '#FFFFFF', .28) + '" stroke="' + INK + '" stroke-width="2"/>';
    }
    if (p.sp === 'dog') {
      return '<path d="M' + (cx + 11.6) + ' 56 Q' + (cx + 21) + ' 54 ' + (cx + 20) + ' 46" fill="none" stroke="' + INK + '" stroke-width="7.2" stroke-linecap="round"/>' +
        '<path d="M' + (cx + 11.6) + ' 56 Q' + (cx + 21) + ' 54 ' + (cx + 20) + ' 46" fill="none" stroke="' + p.fur + '" stroke-width="3.2" stroke-linecap="round"/>';
    }
    if (p.sp === 'fox') {
      return '<path d="M' + (cx + 10) + ' 60 Q' + (cx + 26) + ' 56 ' + (cx + 24) + ' 38 Q' + (cx + 18) + ' 42 ' + (cx + 16) + ' 52 Z" fill="' + p.fur + '" stroke="' + INK + '" stroke-width="2" stroke-linejoin="round"/>' +
        '<path d="M' + (cx + 22.6) + ' 42 Q' + (cx + 23.6) + ' 36 ' + (cx + 24) + ' 38 Q' + (cx + 22) + ' 38 ' + (cx + 21) + ' 40 Z" fill="' + CREAM + '"/>';
    }
    if (p.sp === 'raccoon') {
      return '<path d="M' + (cx + 10.6) + ' 60 Q' + (cx + 24) + ' 58 ' + (cx + 23) + ' 40" fill="none" stroke="' + INK + '" stroke-width="9" stroke-linecap="round"/>' +
        '<path d="M' + (cx + 10.6) + ' 60 Q' + (cx + 24) + ' 58 ' + (cx + 23) + ' 40" fill="none" stroke="' + p.fur + '" stroke-width="5" stroke-linecap="round"/>' +
        '<path d="M' + (cx + 19.6) + ' 51.6 l4.6 .8 M' + (cx + 22.4) + ' 44.6 l1.2 4.2" stroke="' + mix(p.fur, '#2E2A33', .55) + '" stroke-width="4.4" stroke-linecap="round"/>';
    }
    if (p.sp === 'bird') {
      return '<path d="M' + (cx + 8) + ' 62 l10 4 M' + (cx + 8) + ' 64 l8 7 M' + (cx + 9) + ' 60 l11 1" stroke="' + INK + '" stroke-width="4.4" stroke-linecap="round"/>' +
        '<path d="M' + (cx + 8) + ' 62 l10 4 M' + (cx + 8) + ' 64 l8 7 M' + (cx + 9) + ' 60 l11 1" stroke="' + p.fur + '" stroke-width="2" stroke-linecap="round"/>';
    }
    return '';
  }

  /* ── 脸 ───────────────────────────── */
  function face(p, g, state, detail) {
    var cx = g.cx, eyeY = g.eyeY, dx = g.eyeDX, mY = g.mouthY;
    var e1 = cx - dx, e2 = cx + dx;
    var out = '';

    function eye(x, r) {
      r = r || 3.4;
      var gl = detail ? '<circle cx="' + (x - 1.2) + '" cy="' + (eyeY - 1.3) + '" r=".9" fill="#fff" opacity=".95"/>' : '';
      return '<g class="eye"><circle cx="' + x + '" cy="' + eyeY + '" r="' + r + '" fill="' + INK + '"/>' + gl + '</g>';
    }
    function xeye(x) {
      return '<g class="eye"><path d="M' + (x - 2.9) + ' ' + (eyeY - 2.9) + 'L' + (x + 2.9) + ' ' + (eyeY + 2.9) +
        'M' + (x + 2.9) + ' ' + (eyeY - 2.9) + 'L' + (x - 2.9) + ' ' + (eyeY + 2.9) + '" stroke="' + INK +
        '" stroke-width="2.4" stroke-linecap="round"/></g>';
    }
    var mIdle = '<path d="M' + (cx - 2.6) + ' ' + mY + ' q1.3 1.5 2.6 0 q1.3 1.5 2.6 0" fill="none" stroke="' + INK + '" stroke-width="1.8" stroke-linecap="round"/>';
    var mFlat = '<path d="M' + (cx - 2.4) + ' ' + mY + ' h4.8" fill="none" stroke="' + INK + '" stroke-width="2" stroke-linecap="round"/>';
    var mO = '<ellipse cx="' + cx + '" cy="' + mY + '" rx="2.6" ry="3" fill="' + INK + '"/>';
    var mSmile = '<path d="M' + (cx - 4.6) + ' ' + (mY - 1.4) + ' q4.6 7 9.2 0 z" fill="' + INK + '"/>' +
      (detail ? '<path d="M' + (cx - 2) + ' ' + (mY + 2.2) + ' q2 2.4 4 0 z" fill="#F2768B"/>' : '');
    var mWavy = '<path d="M' + (cx - 3.6) + ' ' + mY + ' q1.8 -1.8 3.6 0 q1.8 1.8 3.6 0" fill="none" stroke="' + INK + '" stroke-width="1.9" stroke-linecap="round"/>';
    var blush = detail ? '<ellipse cx="' + (cx - 10.6) + '" cy="' + (eyeY + 4.6) + '" rx="3.2" ry="1.7" fill="#FF8FA8" opacity=".45"/>' +
      '<ellipse cx="' + (cx + 10.6) + '" cy="' + (eyeY + 4.6) + '" rx="3.2" ry="1.7" fill="#FF8FA8" opacity=".45"/>' : '';

    var muzzle = '<ellipse cx="' + cx + '" cy="' + (mY - 1.6) + '" rx="6.6" ry="4.4" fill="' + CREAM + '" opacity=".92"/>';
    if (p.sp === 'bird') muzzle = '';
    var nose = '<path d="M' + (cx - 1.6) + ' ' + (mY - 3.2) + ' q1.6 -1.5 3.2 0 q-1.6 2.4 -3.2 0 z" fill="' + INK + '"/>';

    if (state === 'idle') {
      out = muzzle + nose + eye(e1) + eye(e2) + mIdle;
    } else if (state === 'working') {
      out = muzzle + nose + eye(e1, 2.2) + eye(e2, 2.2) + mFlat;
    } else if (state === 'waiting') {
      out = muzzle + nose + eye(e1, 3.9) + eye(e2, 3.9) + mO;
    } else if (state === 'done') {
      out = muzzle + nose + eye(e1, 4.3) + eye(e2, 4.3) + mSmile + blush;
    } else if (state === 'error') {
      out = muzzle + xeye(e1) + xeye(e2) + mWavy +
        '<path d="M' + (cx + 13.4) + ' ' + (eyeY - 6) + ' q3 4.2 0 6 q-3 -2 0 -6 z" fill="#6FB7E8" stroke="' + INK + '" stroke-width="1.2"/>';
    } else if (state === 'failed') {
      out = '';
    } else {
      out = muzzle + '<path d="M' + (e1 - 2.8) + ' ' + eyeY + 'h5.6M' + (e2 - 2.8) + ' ' + eyeY + 'h5.6" stroke="' + INK +
        '" stroke-width="2.2" stroke-linecap="round" opacity=".55"/>' +
        '<path d="M' + (cx - 2.4) + ' ' + mY + ' h4.8" fill="none" stroke="' + INK + '" stroke-width="1.8" stroke-linecap="round" opacity=".5"/>';
    }
    if (p.sp === 'bird' && state !== 'failed') {
      out += '<path d="M' + (cx - 2.8) + ' ' + (mY - 3.4) + ' l5.6 0 l-2.8 5.2 z" fill="' + p.acc + '" stroke="' + INK + '" stroke-width="1.7" stroke-linejoin="round"/>';
    }
    return out;
  }

  /* ── 身体 ─────────────────────────── */
  function torso(p, g, pose) {
    var cx = g.cx;
    if (pose === 'sit') {
      return '<path d="M' + (cx - 13.5) + ' 66 L' + (cx - 12) + ' 38 Q' + cx + ' 29.4 ' + (cx + 12) + ' 38 L' + (cx + 13.5) + ' 66 Z"' +
        ' fill="' + p.fur + '" stroke="' + INK + '" stroke-width="2" stroke-linejoin="round"/>';
    }
    return '<path d="M' + (cx - 12.6) + ' 70 L' + (cx - 11.6) + ' 39 Q' + cx + ' 31.6 ' + (cx + 11.6) + ' 39 L' + (cx + 12.6) + ' 70 Z"' +
      ' fill="' + p.fur + '" stroke="' + INK + '" stroke-width="2" stroke-linejoin="round"/>';
  }

  function belly(p, g, pose) {
    var cx = g.cx;
    if (pose === 'sit') {
      return '<ellipse cx="' + cx + '" cy="50.6" rx="6.4" ry="7.6" fill="' + CREAM + '" opacity=".72"/>';
    }
    return '<ellipse cx="' + cx + '" cy="53" rx="7" ry="8.6" fill="' + CREAM + '" opacity=".85"/>';
  }

  function collar(p, g) {
    var cx = g.cx;
    return '<path d="M' + (cx - 11.4) + ' 32.6 Q' + cx + ' 37.6 ' + (cx + 11.4) + ' 32.6 L' + (cx + 11.4) + ' 35.4 Q' + cx + ' 40.4 ' + (cx - 11.4) + ' 35.4 Z"' +
      ' fill="' + p.main + '" stroke="' + INK + '" stroke-width="2" stroke-linejoin="round"/>' +
      '<circle cx="' + cx + '" cy="38.6" r="3" fill="' + p.acc + '" stroke="' + INK + '" stroke-width="1.8"/>';
  }

  function arms(p, g, pose) {
    var cx = g.cx, out = '';
    if (pose === 'sit') {
      out = '<path d="M' + (cx - 11.6) + ' 43 Q' + (cx - 15.4) + ' 50 ' + (cx - 11.8) + ' 55.4" fill="none" stroke="' + INK + '" stroke-width="8" stroke-linecap="round"/>' +
        '<path d="M' + (cx - 11.6) + ' 43 Q' + (cx - 15.4) + ' 50 ' + (cx - 11.8) + ' 55.4" fill="none" stroke="' + p.fur + '" stroke-width="4" stroke-linecap="round"/>' +
        '<path d="M' + (cx + 11.6) + ' 43 Q' + (cx + 15.4) + ' 50 ' + (cx + 11.8) + ' 55.4" fill="none" stroke="' + INK + '" stroke-width="8" stroke-linecap="round"/>' +
        '<path d="M' + (cx + 11.6) + ' 43 Q' + (cx + 15.4) + ' 50 ' + (cx + 11.8) + ' 55.4" fill="none" stroke="' + p.fur + '" stroke-width="4" stroke-linecap="round"/>' +
        '<g class="hand-l"><circle cx="' + (cx - 11.8) + '" cy="56" r="3.6" fill="' + CREAM + '" stroke="' + INK + '" stroke-width="2"/></g>' +
        '<g class="hand-r"><circle cx="' + (cx + 11.8) + '" cy="56" r="3.6" fill="' + CREAM + '" stroke="' + INK + '" stroke-width="2"/></g>';
    } else {
      out = '<path d="M' + (cx - 11.4) + ' 44 Q' + (cx - 15.6) + ' 52 ' + (cx - 13.6) + ' 60" fill="none" stroke="' + INK + '" stroke-width="7.6" stroke-linecap="round"/>' +
        '<path d="M' + (cx - 11.4) + ' 44 Q' + (cx - 15.6) + ' 52 ' + (cx - 13.6) + ' 60" fill="none" stroke="' + p.fur + '" stroke-width="3.6" stroke-linecap="round"/>' +
        '<path d="M' + (cx + 11.4) + ' 44 Q' + (cx + 15.6) + ' 52 ' + (cx + 13.6) + ' 60" fill="none" stroke="' + INK + '" stroke-width="7.6" stroke-linecap="round"/>' +
        '<path d="M' + (cx + 11.4) + ' 44 Q' + (cx + 15.6) + ' 52 ' + (cx + 13.6) + ' 60" fill="none" stroke="' + p.fur + '" stroke-width="3.6" stroke-linecap="round"/>';
    }
    return out;
  }

  function wing(p, g) {
    if (p.sp !== 'bird') return '';
    var cx = g.cx;
    return '<path d="M' + (cx - 13.2) + ' 44 q-3.6 5.6 .8 9.6 q4.4 -2 4.8 -8.6 Z" fill="' + mix(p.fur, '#FFFFFF', .3) + '" stroke="' + INK + '" stroke-width="2" stroke-linejoin="round"/>';
  }

  function legs(p, g) {
    var cx = g.cx;
    return '<g class="leg-l"><rect x="' + (cx - 8.4) + '" y="66" width="7" height="19" rx="3.4" fill="' + p.fur + '" stroke="' + INK + '" stroke-width="2"/></g>' +
      '<g class="leg-r"><rect x="' + (cx + 1.4) + '" y="66" width="7" height="19" rx="3.4" fill="' + p.fur + '" stroke="' + INK + '" stroke-width="2"/></g>' +
      '<ellipse cx="' + (cx - 4.9) + '" cy="85.4" rx="5" ry="2.8" fill="' + mix(p.main, '#FFFFFF', .15) + '" stroke="' + INK + '" stroke-width="1.8"/>' +
      '<ellipse cx="' + (cx + 4.9) + '" cy="85.4" rx="5" ry="2.8" fill="' + mix(p.main, '#FFFFFF', .15) + '" stroke="' + INK + '" stroke-width="1.8"/>';
  }

  function sit(id, state, detail) {
    var p = P[id], g = geo(p, 'sit');
    var cx = g.cx;
    var E = ears(p, g);
    var chairFill = mix(p.main, '#FFFFFF', .82);
    var chairLine = mix(p.main, '#4A3A2E', .5);
    var chair = '<rect class="furn" x="' + (cx - 15.6) + '" y="27" width="31.2" height="37" rx="11" fill="' + chairFill +
      '" stroke="' + chairLine + '" stroke-width="2"/>';
    var desk = '<rect class="furn" x="1" y="59.6" width="62" height="7" rx="2.6" fill="' + DESK + '" stroke="' + DESK_LINE + '" stroke-width="2"/>';

    var head = '<ellipse cx="' + cx + '" cy="' + g.cy + '" rx="' + g.rx + '" ry="' + g.ry + '" fill="' + p.fur + '" stroke="' + INK + '" stroke-width="2"/>' +
      '<path d="M' + (cx - 11.6) + ' ' + (g.cy - 5.2) + ' a 12.4 12.4 0 0 1 8.6 -5.6" fill="none" stroke="' + mix(p.fur, '#FFFFFF', .55) + '" stroke-width="3.6" stroke-linecap="round" opacity=".7"/>';
    var core = tail(p, g) + E.out + torso(p, g, 'sit') + belly(p, g, 'sit') + arms(p, g, 'sit') + wing(p, g) + collar(p, g) + head + E.inner + face(p, g, state, detail);

    var lean = state === 'working' ? 'rotate(-2.4 32 62)' : state === 'error' ? 'translate(0 1.2) rotate(1.8 32 62)' : '';
    if (lean) core = '<g transform="' + lean + '">' + core + '</g>';
    var kk = p.k || 1;
    core = '<g transform="translate(32 64) scale(' + kk + ') translate(-32 -64)">' + core + '</g>';

    var ring = '', ghost = '';
    if (state === 'provisioning' || state === 'failed') {
      var col = state === 'failed' ? '#9A8F82' : '#4176E6';
      ring = state === 'provisioning'
        ? '<circle class="ring" cx="' + cx + '" cy="' + g.cy + '" r="' + (g.rx + 5.4) + '" fill="none" stroke="#4176E6" stroke-width="2" stroke-dasharray="6 4.6" opacity=".9"/>' : '';
      ghost = '<ellipse cx="' + cx + '" cy="' + g.cy + '" rx="' + g.rx + '" ry="' + g.ry + '" fill="none" stroke="' + col + '" stroke-width="2" stroke-dasharray="4 3.2"/>' +
        '<path d="M' + (cx - 13.5) + ' 64 L' + (cx - 12) + ' 38 Q' + cx + ' 29.4 ' + (cx + 12) + ' 38 L' + (cx + 13.5) + ' 64' +
        '" fill="none" stroke="' + col + '" stroke-width="2" stroke-dasharray="4 3.2" stroke-linejoin="round"/>';
    }

    var fig = ring + '<g class="fig" ' + (state === 'failed' ? 'opacity=".34" style="filter:grayscale(.65)"' :
      state === 'provisioning' ? 'opacity=".72"' : '') + '>' + core + '</g>' + desk + ghost;

    return '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' + chair + fig + '</svg>';
  }

  function stand(id, state, detail) {
    var p = P[id], g = geo(p, 'stand');
    var cx = g.cx;
    var E = ears(p, g);
    var head = '<ellipse cx="' + cx + '" cy="' + g.cy + '" rx="' + g.rx + '" ry="' + g.ry + '" fill="' + p.fur + '" stroke="' + INK + '" stroke-width="2"/>';
    var core = tail(p, g) + E.out + legs(p, g) + torso(p, g, 'stand') + belly(p, g, 'stand') + arms(p, g, 'stand') + wing(p, g) + collar(p, g) + head + E.inner + face(p, g, state, detail);
    return '<svg viewBox="0 0 64 90" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><g class="fig">' + core + '</g></svg>';
  }

  function sprite(id, state, o) {
    o = o || {};
    var detail = o.detail === undefined ? 1 : o.detail;
    if (o.pose === 'stand') return stand(id, state || 'idle', detail);
    return sit(id, state || 'idle', detail);
  }

  return { sprite: sprite, note: function (id) { return NOTE[id] || ''; } };
})();
