/* 方向 A · 圆角小人 —— 纯 SVG，64 网格，主形 2 单位描边 */
window.ART = (function () {
  'use strict';

  var INK = '#2C2531';
  var SKIN = '#FFE3CD', SKIN_D = '#F6C5A4', SKIN_HI = '#FFF4E8', SKIN_LINE = '#D89A78';
  var DESK = '#F3E7D5', DESK_LINE = '#CBB79A';

  var BUILD = {
    slim:  { w: 21,   asp: 0.94 },
    std:   { w: 24,   asp: 0.87 },
    chub:  { w: 25.5, asp: 0.82 },
    bulky: { w: 27.5, asp: 0.78 }
  };

  var P = {
    pm: { build: 'std',   hair: '#4A382E', look: 'ahoge',  main: '#EF6B45', acc: '#F6B23E', prop: 'note',  k: 1 },
    fe: { build: 'std',   hair: '#303449', look: 'phones', main: '#3E86F5', acc: '#38C8E8', prop: 'none',  k: 1 },
    be: { build: 'bulky', hair: '#5A4433', look: 'bandana',   main: '#7A5AE0', acc: '#B9A6FF', prop: 'mug', jaw: 0.20, k: 1.05 },
    rv: { build: 'slim',  hair: '#6B4A3C', look: 'bob',    main: '#12A594', acc: '#7FE0CE', prop: 'lens', jaw: 0.44, k: 0.90 },
    rs: { build: 'slim',  hair: '#5A3B2A', look: 'buns',   main: '#E0A22A', acc: '#FFD98A', prop: 'books', k: 0.86 },
    ds: { build: 'slim',  hair: '#4A2E3A', look: 'beret',  main: '#E85D9E', acc: '#FFC2DC', prop: 'brush', k: 0.98 },
    op: { build: 'chub',  hair: '#33322C', look: 'cap',    main: '#2E9E6B', acc: '#9BE3BC', prop: 'wrench', k: 1.02 },
    wr: { build: 'std',   hair: '#463024', look: 'bun',    main: '#B4552F', acc: '#E8C173', prop: 'pen',   k: 0.94 }
  };

  var NOTE = {
    pm: '侧分短发 + 呆毛 + 便签板',
    fe: '耳机 + 高马尾 + 青色耳罩',
    be: '板寸 + 方下巴 + 马克杯',
    rv: '蘑菇头 + 放大镜 + 细身',
    rs: '双丸子 + 书堆 + 小个子',
    ds: '贝雷帽 + 画笔 + 桃粉',
    op: '棒球帽 + 扳手 + 松绿',
    wr: '丸子头 + 围巾 + 钢笔'
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
    var B = BUILD[p.build];
    var bw = B.w * (pose === 'stand' ? 0.96 : 1);
    var hw = bw * 1.15;
    var hh = hw * B.asp;
    var cx = 32;
    var headBottom = pose === 'sit' ? 30 : 32;
    var T = headBottom - hh;
    return {
      cx: cx, L: cx - hw / 2, R: cx + hw / 2, T: T, B: T + hh,
      hw: hw, hh: hh, bw: bw, jaw: p.jaw || 0.38,
      eyeY: T + hh * 0.63, eyeDX: hw * 0.205,
      mouthY: T + hh * 0.895, browY: T + hh * 0.63 - 4.4
    };
  }

  /* ── 头发 ─────────────────────────── */
  function hair(p, g, detail) {
    var L = g.L, R = g.R, T = g.T, hh = g.hh, cx = g.cx;
    var hair = p.hair, hd = mix(hair, '#000000', 0.22);
    var dome = 'M' + (L - 1.4) + ' ' + (T + hh * 0.80) +
      ' Q' + (L - 1.8) + ' ' + (T - 2.2) + ' ' + cx + ' ' + (T - 2.2) +
      ' Q' + (R + 1.8) + ' ' + (T - 2.2) + ' ' + (R + 1.4) + ' ' + (T + hh * 0.80) + ' Z';
    var fringe = 'M' + (L - 1.2) + ' ' + (T + hh * 0.56) +
      ' Q' + (L - 1.2) + ' ' + (T - 1.8) + ' ' + cx + ' ' + (T - 1.8) +
      ' Q' + (R + 1.2) + ' ' + (T - 1.8) + ' ' + (R + 1.2) + ' ' + (T + hh * 0.56) +
      ' Q' + (R - 2) + ' ' + (T + hh * 0.39) + ' ' + (cx + 1) + ' ' + (T + hh * 0.41) +
      ' Q' + (cx - 3.4) + ' ' + (T + hh * 0.36) + ' ' + (L + 2) + ' ' + (T + hh * 0.50) + ' Z';
    var sweep = 'M' + (L - 1.2) + ' ' + (T + hh * 0.58) +
      ' Q' + (L - 1) + ' ' + (T - 2) + ' ' + (cx - 1) + ' ' + (T - 2) +
      ' Q' + (R + 1.4) + ' ' + (T - 2) + ' ' + (R + 1.2) + ' ' + (T + hh * 0.42) +
      ' Q' + (R - 1) + ' ' + (T + hh * 0.36) + ' ' + (cx + 3.5) + ' ' + (T + hh * 0.31) +
      ' Q' + (cx - 4) + ' ' + (T + hh * 0.28) + ' ' + (L + 1) + ' ' + (T + hh * 0.48) + ' Z';

    var back = '<path d="' + dome + '" fill="' + hair + '" stroke="' + hd + '" stroke-width="2" stroke-linejoin="round"/>';
    var front = '<path d="' + fringe + '" fill="' + hair + '" stroke="' + hd + '" stroke-width="2" stroke-linejoin="round"/>';
    var extra = '';

    if (p.look === 'ahoge') {
      front = '<path d="' + sweep + '" fill="' + hair + '" stroke="' + hd + '" stroke-width="2" stroke-linejoin="round"/>';
      extra = '<path d="M' + (cx - 2.4) + ' ' + (T + 1.6) +
        ' C' + (cx - 6.8) + ' ' + (T - 2) + ' ' + (cx - 6.6) + ' ' + (T - 6.2) + ' ' + (cx - 2) + ' ' + (T - 6.4) +
        ' C' + (cx - 1.4) + ' ' + (T - 3.2) + ' ' + (cx - 0.4) + ' ' + (T - 1) + ' ' + (cx + 0.6) + ' ' + (T + 1.4) + ' Z"' +
        ' fill="' + hair + '" stroke="' + hd + '" stroke-width="2" stroke-linejoin="round"/>';
    } else if (p.look === 'phones') {
      front = '<path d="' + sweep + '" fill="' + hair + '" stroke="' + hd + '" stroke-width="2" stroke-linejoin="round"/>';
      back += '<path d="M' + (R - 1) + ' ' + (T + hh * 0.42) +
        ' Q' + (R + 11.6) + ' ' + (T + hh * 0.24) + ' ' + (R + 9.6) + ' ' + (T + hh * 0.70) +
        ' Q' + (R + 8.4) + ' ' + (T + hh * 0.98) + ' ' + (R + 1.6) + ' ' + (T + hh * 0.86) +
        ' Q' + (R + 5) + ' ' + (T + hh * 0.62) + ' ' + (R - 1) + ' ' + (T + hh * 0.42) + ' Z"' +
        ' fill="' + hair + '" stroke="' + hd + '" stroke-width="2" stroke-linejoin="round"/>';
      extra = '<path d="M' + (L - 1.6) + ' ' + (T + hh * 0.44) + ' Q' + cx + ' ' + (T - 5.6) + ' ' + (R + 1.6) + ' ' + (T + hh * 0.44) + '"' +
        ' fill="none" stroke="' + p.acc + '" stroke-width="3.6" stroke-linecap="round"/>' +
        '<rect x="' + (L - 6) + '" y="' + (T + hh * 0.32) + '" width="6" height="10" rx="3" fill="' + p.acc + '" stroke="' + mix(p.acc, '#2B2530', .48) + '" stroke-width="2"/>' +
        '<rect x="' + (R) + '" y="' + (T + hh * 0.32) + '" width="6" height="10" rx="3" fill="' + p.acc + '" stroke="' + mix(p.acc, '#2B2530', .48) + '" stroke-width="2"/>';
    } else if (p.look === 'bandana') {
      var bd = mix(p.acc, '#2B2530', .42);
      back = '<path d="M' + (L + 0.4) + ' ' + (T + hh * 0.44) +
        ' L' + (L + 0.4) + ' ' + (T + 2.4) + ' Q' + (L + 0.4) + ' ' + (T - 1.2) + ' ' + (L + 4) + ' ' + (T - 1.2) +
        ' L' + (R - 4) + ' ' + (T - 1.2) + ' Q' + (R - 0.4) + ' ' + (T - 1.2) + ' ' + (R - 0.4) + ' ' + (T + 2.4) +
        ' L' + (R - 0.4) + ' ' + (T + hh * 0.44) + ' Q' + cx + ' ' + (T + hh * 0.26) + ' ' + (L + 0.4) + ' ' + (T + hh * 0.44) + ' Z"' +
        ' fill="' + hair + '" stroke="' + hd + '" stroke-width="2" stroke-linejoin="round"/>';
      front = '<path d="M' + (L + 0.2) + ' ' + (T + hh * 0.34) +
        ' Q' + (L + 0.2) + ' ' + (T - 1.2) + ' ' + cx + ' ' + (T - 1.2) +
        ' Q' + (R - 0.2) + ' ' + (T - 1.2) + ' ' + (R - 0.2) + ' ' + (T + hh * 0.34) + ' Z"' +
        ' fill="' + hair + '" stroke="' + hd + '" stroke-width="2" stroke-linejoin="round"/>';
      extra = '<path d="M' + (L - 1.2) + ' ' + (T + hh * 0.24) + ' Q' + cx + ' ' + (T + hh * 0.12) + ' ' + (R + 1.2) + ' ' + (T + hh * 0.24) +
        ' L' + (R + 1.2) + ' ' + (T + hh * 0.40) + ' Q' + cx + ' ' + (T + hh * 0.28) + ' ' + (L - 1.2) + ' ' + (T + hh * 0.40) + ' Z"' +
        ' fill="' + p.acc + '" stroke="' + bd + '" stroke-width="2" stroke-linejoin="round"/>' +
        '<path d="M' + (L - 1.4) + ' ' + (T + hh * 0.26) + ' Q' + (L - 10.4) + ' ' + (T + hh * 0.16) + ' ' + (L - 9.6) + ' ' + (T + hh * 0.42) +
        ' Q' + (L - 5) + ' ' + (T + hh * 0.32) + ' ' + (L - 1.8) + ' ' + (T + hh * 0.38) + ' Z"' +
        ' fill="' + p.acc + '" stroke="' + bd + '" stroke-width="2" stroke-linejoin="round"/>' +
        '<path d="M' + (L - 1.6) + ' ' + (T + hh * 0.34) + ' Q' + (L - 6.4) + ' ' + (T + hh * 0.44) + ' ' + (L - 5.6) + ' ' + (T + hh * 0.62) +
        ' Q' + (L - 3.4) + ' ' + (T + hh * 0.5) + ' ' + (L - 1.2) + ' ' + (T + hh * 0.46) + ' Z"' +
        ' fill="' + mix(p.acc, '#000000', .08) + '" stroke="' + bd + '" stroke-width="2" stroke-linejoin="round"/>';
    } else if (p.look === 'bob') {
      back = '<rect x="' + (L - 3.6) + '" y="' + (T + hh * 0.24) + '" width="7" height="' + (hh * 0.78) + '" rx="3.5" fill="' + hair + '" stroke="' + hd + '" stroke-width="2"/>' +
        '<rect x="' + (R - 3.4) + '" y="' + (T + hh * 0.24) + '" width="7" height="' + (hh * 0.78) + '" rx="3.5" fill="' + hair + '" stroke="' + hd + '" stroke-width="2"/>' +
        '<path d="' + dome + '" fill="' + hair + '" stroke="' + hd + '" stroke-width="2" stroke-linejoin="round"/>';
      front = '<path d="' + fringe + '" fill="' + hair + '" stroke="' + hd + '" stroke-width="2" stroke-linejoin="round"/>';
    } else if (p.look === 'buns') {
      extra = '<circle cx="' + (L + 1.8) + '" cy="' + (T + 1.2) + '" r="5.2" fill="' + hair + '" stroke="' + hd + '" stroke-width="2"/>' +
        '<circle cx="' + (R - 1.8) + '" cy="' + (T + 1.2) + '" r="5.2" fill="' + hair + '" stroke="' + hd + '" stroke-width="2"/>';
    } else if (p.look === 'beret') {
      extra = '<g transform="rotate(-14 ' + cx + ' ' + (T + 1.2) + ')">' +
        '<ellipse cx="' + cx + '" cy="' + (T + 1.2) + '" rx="' + (g.hw * 0.64) + '" ry="5.6" fill="' + p.acc + '" stroke="' + mix(p.acc, '#2B2530', .42) + '" stroke-width="2"/>' +
        '<path d="M' + (cx + 3) + ' ' + (T - 3.8) + ' l1.6 -3.6" stroke="' + mix(p.acc, '#2B2530', .42) + '" stroke-width="2.2" stroke-linecap="round"/></g>';
      front = '<path d="' + sweep + '" fill="' + hair + '" stroke="' + hd + '" stroke-width="2" stroke-linejoin="round"/>';
    } else if (p.look === 'cap') {
      var capC = mix(p.acc, p.main, 0.5), capD = mix(capC, '#2B2530', 0.44);
      back = '<path d="' + dome + '" fill="' + hair + '" stroke="' + hd + '" stroke-width="2" stroke-linejoin="round"/>';
      front = '<path d="M' + (L - 0.6) + ' ' + (T + hh * 0.42) +
        ' Q' + (L - 0.6) + ' ' + (T - 2.8) + ' ' + cx + ' ' + (T - 2.8) +
        ' Q' + (R + 0.6) + ' ' + (T - 2.8) + ' ' + (R + 0.6) + ' ' + (T + hh * 0.42) + ' Z"' +
        ' fill="' + capC + '" stroke="' + capD + '" stroke-width="2" stroke-linejoin="round"/>' +
        '<path d="M' + (R - 1.6) + ' ' + (T + hh * 0.36) +
        ' Q' + (R + 10.6) + ' ' + (T + hh * 0.28) + ' ' + (R + 13) + ' ' + (T + hh * 0.46) +
        ' Q' + (R + 11.4) + ' ' + (T + hh * 0.57) + ' ' + (R + 2.6) + ' ' + (T + hh * 0.52) +
        ' L' + (R - 1.6) + ' ' + (T + hh * 0.47) + ' Z"' +
        ' fill="' + mix(capC, '#000000', .18) + '" stroke="' + capD + '" stroke-width="2" stroke-linejoin="round"/>' +
        '<circle cx="' + cx + '" cy="' + (T - 2.8) + '" r="1.7" fill="' + capD + '"/>';
    } else if (p.look === 'bun') {
      extra = '<circle cx="' + (cx - 2.8) + '" cy="' + (T - 0.2) + '" r="5.6" fill="' + hair + '" stroke="' + hd + '" stroke-width="2"/>' +
        '<path d="M' + (cx - 6) + ' ' + (T - 3.4) + ' q2.8 -2 5.4 -.4" fill="none" stroke="' + hd + '" stroke-width="1.5" opacity=".55"/>';
      front = '<path d="' + fringe + '" fill="' + hair + '" stroke="' + hd + '" stroke-width="2" stroke-linejoin="round"/>';
    }

    var hi = detail ? '<path d="M' + (L + 2.4) + ' ' + (T + hh * 0.30) + ' Q' + (cx - 2) + ' ' + (T + 1.4) + ' ' + (cx + hh * 0.34) + ' ' + (T + hh * 0.12) + '" fill="none" stroke="' + mix(hair, '#FFFFFF', .38) + '" stroke-width="2.2" stroke-linecap="round" opacity=".55"/>' : '';
    return { back: back, front: front, extra: extra + hi };
  }

  /* ── 脸 ───────────────────────────── */
  function face(p, g, state, detail) {
    var cx = g.cx, eyeY = g.eyeY, dx = g.eyeDX, mY = g.mouthY;
    var e1 = cx - dx, e2 = cx + dx;
    var out = '';

    function eye(x, ry, rx) {
      ry = ry || 3.7; rx = rx || 3.1;
      var gl = detail ? '<circle cx="' + (x - 1.1) + '" cy="' + (eyeY - 1.35) + '" r=".82" fill="#fff" opacity=".92"/>' : '';
      return '<g class="eye"><ellipse cx="' + x + '" cy="' + eyeY + '" rx="' + rx + '" ry="' + ry + '" fill="' + INK + '"/>' + gl + '</g>';
    }
    function xeye(x) {
      return '<g class="eye"><path d="M' + (x - 2.6) + ' ' + (eyeY - 2.6) + 'L' + (x + 2.6) + ' ' + (eyeY + 2.6) +
        'M' + (x + 2.6) + ' ' + (eyeY - 2.6) + 'L' + (x - 2.6) + ' ' + (eyeY + 2.6) + '" stroke="' + INK +
        '" stroke-width="2.2" stroke-linecap="round"/></g>';
    }
    function brow(x, tilt, dy) {
      var y = g.browY + (dy || 0);
      return '<path d="M' + (x - 2.6) + ' ' + y + ' q2.6 -1.2 5.2 0" fill="none" stroke="' + p.hair +
        '" stroke-width="1.9" stroke-linecap="round" transform="rotate(' + (tilt || 0) + ' ' + x + ' ' + y + ')"/>';
    }
    var mIdle = '<path d="M' + (cx - 2.4) + ' ' + mY + ' q2.4 1.6 4.8 0" fill="none" stroke="' + INK + '" stroke-width="2" stroke-linecap="round"/>';
    var mFlat = '<path d="M' + (cx - 2.1) + ' ' + mY + ' h4.2" fill="none" stroke="' + INK + '" stroke-width="2" stroke-linecap="round"/>';
    var mO = '<circle cx="' + cx + '" cy="' + mY + '" r="2" fill="none" stroke="' + INK + '" stroke-width="1.9"/>';
    var mSmile = '<path d="M' + (cx - 3.2) + ' ' + (mY - 1) + ' q3.2 4.8 6.4 0 z" fill="' + INK + '"/>' +
      (detail ? '<path d="M' + (cx - 1.5) + ' ' + (mY + 1.3) + ' q1.5 1.7 3 0 z" fill="#F2768B"/>' : '');
    var mWavy = '<path d="M' + (cx - 3.1) + ' ' + mY + ' q1.55 -1.6 3.1 0 q1.55 1.6 3.1 0" fill="none" stroke="' + INK + '" stroke-width="1.9" stroke-linecap="round"/>';
    var nose = detail ? '<path d="M' + cx + ' ' + (eyeY + 3.1) + ' q1.1 .9 0 1.9" fill="none" stroke="' + SKIN_LINE + '" stroke-width="1.5" stroke-linecap="round" opacity=".55"/>' : '';
    var blush = detail ? '<ellipse cx="' + (cx - g.hw * 0.31) + '" cy="' + (eyeY + 4.5) + '" rx="3.1" ry="1.6" fill="#FF9A9A" opacity=".42"/>' +
      '<ellipse cx="' + (cx + g.hw * 0.31) + '" cy="' + (eyeY + 4.5) + '" rx="3.1" ry="1.6" fill="#FF9A9A" opacity=".42"/>' : '';

    if (state === 'idle') {
      out = eye(e1) + eye(e2) + brow(e1, 0) + brow(e2, 0) + nose + mIdle;
    } else if (state === 'working') {
      out = eye(e1, 2.9) + eye(e2, 2.9) + brow(e1, 8) + brow(e2, -8) + nose + mFlat;
    } else if (state === 'waiting') {
      out = eye(e1 + 1.2) + eye(e2 + 1.2) + brow(e1, -12) + brow(e2, 7, -.6) + nose + mO;
    } else if (state === 'done') {
      out = eye(e1, 4.2) + eye(e2, 4.2) + brow(e1, -4, -1) + brow(e2, 4, -1) + nose + mSmile + blush;
    } else if (state === 'error') {
      out = xeye(e1) + xeye(e2) + brow(e1, -9, -1) + brow(e2, 9, -1) + mWavy +
        '<path d="M' + (g.R - 1) + ' ' + (eyeY - 5.4) + ' q2.8 3.8 0 5.4 q-2.8 -1.8 0 -5.4 z" fill="#6FB7E8" opacity=".9"/>';
    } else if (state === 'failed') {
      out = '';
    } else {
      out = '<path d="M' + (e1 - 2.5) + ' ' + eyeY + 'h5M' + (e2 - 2.5) + ' ' + eyeY + 'h5" stroke="' + INK +
        '" stroke-width="2" stroke-linecap="round" opacity=".5"/>' +
        '<path d="M' + (cx - 2) + ' ' + mY + ' h4" fill="none" stroke="' + INK + '" stroke-width="1.6" stroke-linecap="round" opacity=".45"/>';
    }
    return out;
  }

  /* ── 道具 ─────────────────────────── */
  function props(p, g, detail) {
    var L = g.L, R = g.R, T = g.T, hh = g.hh, cx = g.cx, y = T + hh * 0.64;
    var ink = '#9A8668';
    if (p.prop === 'note') {
      return '<g transform="translate(' + (L - 12) + ',' + (y - 3.6) + ') rotate(-8)">' +
        '<rect width="9.6" height="12.4" rx="1.8" fill="#FFF8E8" stroke="' + ink + '" stroke-width="1.8"/>' +
        '<path d="M2 4.6h5.2M2 7.8h3.8" stroke="' + ink + '" stroke-width="1.4" stroke-linecap="round"/>' +
        '<path d="M3.2 0.2v2.2" stroke="' + ink + '" stroke-width="1.8" stroke-linecap="round"/></g>';
    }
    if (p.prop === 'lens') {
      return '<circle cx="' + (R + 4.6) + '" cy="' + y + '" r="5.6" fill="' + p.acc + '" fill-opacity=".38" stroke="' + mix(p.acc, '#2B2530', .52) + '" stroke-width="2.2"/>' +
        '<path d="M' + (R + 8.4) + ' ' + (y + 3.8) + ' l3.8 4.6" stroke="' + mix(p.acc, '#2B2530', .52) + '" stroke-width="2.8" stroke-linecap="round"/>';
    }
    if (p.prop === 'books') {
      var y0 = 50;
      return '<rect x="' + (L - 12.4) + '" y="' + y0 + '" width="11.6" height="3.6" rx="1.3" fill="' + p.acc + '" stroke="' + ink + '" stroke-width="1.6"/>' +
        '<rect x="' + (L - 11.4) + '" y="' + (y0 + 3.4) + '" width="10.4" height="3.4" rx="1.3" fill="' + mix(p.acc, '#FFFFFF', .42) + '" stroke="' + ink + '" stroke-width="1.6"/>' +
        '<rect x="' + (L - 12.8) + '" y="' + (y0 + 6.6) + '" width="11.8" height="3.4" rx="1.3" fill="' + mix(p.main, '#FFFFFF', .2) + '" stroke="' + ink + '" stroke-width="1.6"/>';
    }
    if (p.prop === 'brush') {
      return '<path d="M' + (R + 0.8) + ' ' + (T + hh * 0.9) + ' L' + (R + 8.4) + ' ' + (T + hh * 0.42) + '" stroke="' + mix(p.acc, '#2B2530', .38) + '" stroke-width="2.8" stroke-linecap="round"/>' +
        '<path d="M' + (R + 6.8) + ' ' + (T + hh * 0.5) + ' l3.8 -4.2 l1.8 4.2 z" fill="' + p.main + '" stroke="' + mix(p.main, '#2B2530', .38) + '" stroke-width="1.5"/>';
    }
    if (p.prop === 'wrench') {
      return '<path d="M' + (R + 1) + ' ' + (T + hh * 0.92) + ' L' + (R + 7.4) + ' ' + (T + hh * 0.48) + '" stroke="#B9C2C8" stroke-width="3.2" stroke-linecap="round"/>' +
        '<path d="M' + (R + 5.4) + ' ' + (T + hh * 0.46) + ' a3.2 3.2 0 1 0 4.2 3" fill="none" stroke="#B9C2C8" stroke-width="2.6" stroke-linecap="round"/>';
    }
    if (p.prop === 'mug') {
      return '<rect x="' + (R + 0.2) + '" y="51.6" width="8.4" height="7.6" rx="1.8" fill="#FFF7EB" stroke="' + ink + '" stroke-width="1.8"/>' +
        '<path d="M' + (R + 8.6) + ' 53.8 q2.8 .2 2.6 2.6 q-.2 2.2 -2.6 2.1" fill="none" stroke="' + ink + '" stroke-width="1.7"/>' +
        '<path d="M' + (R + 2.2) + ' 50.8 q1.4 -2 0 -3.6" fill="none" stroke="' + ink + '" stroke-width="1.4" opacity=".5" stroke-linecap="round"/>';
    }
    if (p.prop === 'pen') {
      return '<path d="M' + (L - 3.4) + ' ' + (T + hh * 0.66) + ' l5.2 -7.2" stroke="' + mix(p.acc, '#2B2530', .3) + '" stroke-width="2.6" stroke-linecap="round"/>' +
        '<path d="M' + (L + 2.4) + ' ' + (T + hh * 0.42) + ' l2.2 -1.6" stroke="' + mix(p.acc, '#2B2530', .5) + '" stroke-width="2.2" stroke-linecap="round"/>' +
        '<circle cx="' + (L - 3.6) + '" cy="' + (T + hh * 0.67) + '" r="1.7" fill="' + mix(p.acc, '#2B2530', .3) + '"/>';
    }
    return '';
  }

  /* ── 坐姿 ─────────────────────────── */
  function sit(id, state, detail, opts) {
    opts = opts || {};
    var p = P[id], g = geo(p, 'sit');
    var cx = g.cx, L = g.L, R = g.R, T = g.T, hh = g.hh, bw = g.bw;
    var mainD = mix(p.main, '#241B2E', .40);
    var mainL = mix(p.main, '#FFFFFF', .26);
    var chairFill = mix(p.main, '#FFFFFF', .80);
    var chairLine = mix(p.main, '#4A3A2E', .52);
    var k = p.k || 1;
    var bodyPath = 'M' + (cx - bw / 2) + ' 66 L' + (cx - bw / 2) + ' 43 Q' + (cx - bw / 2) + ' 33 ' + (cx - bw / 2 + 8) + ' 33' +
      ' L' + (cx + bw / 2 - 8) + ' 33 Q' + (cx + bw / 2) + ' 33 ' + (cx + bw / 2) + ' 43 L' + (cx + bw / 2) + ' 66 Z';

    var defs = '<defs>' +
      '<linearGradient id="b-' + id + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + mainL + '"/><stop offset="1" stop-color="' + p.main + '"/></linearGradient>' +
      '<linearGradient id="s-' + id + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + SKIN_HI + '"/><stop offset="1" stop-color="' + SKIN + '"/></linearGradient>' +
      '<clipPath id="cb-' + id + '"><path d="' + bodyPath + '"/></clipPath>' +
      '<clipPath id="ch-' + id + '"><rect x="' + L + '" y="' + T + '" width="' + g.hw + '" height="' + hh +
      '" rx="' + (g.hw * g.jaw) + '" ry="' + (hh * g.jaw) + '"/></clipPath></defs>';

    var chair = opts.chair === false ? '' :
      '<rect class="furn" x="' + (cx - bw / 2 - 7) + '" y="27" width="' + (bw + 14) + '" height="37" rx="10" fill="' + chairFill +
      '" stroke="' + chairLine + '" stroke-width="2"/>' +
      '<path d="M' + (cx - bw / 2 - 3.4) + ' 32.4 h' + (bw + 6.8) + '" stroke="' + chairLine + '" stroke-width="1.8" opacity=".4"/>';
    var chairShadow = '<ellipse cx="' + cx + '" cy="41" rx="' + (bw / 2 + 4.6) + '" ry="9" fill="#241B2E" opacity=".07"/>';

    var body = '<path d="' + bodyPath + '" fill="url(#b-' + id + ')" stroke="' + mainD + '" stroke-width="2" stroke-linejoin="round"/>' +
      '<ellipse cx="' + (cx - bw / 2 + 1.6) + '" cy="35.6" rx="' + (bw * 0.66) + '" ry="9.6" fill="#FFFFFF" opacity=".15" clip-path="url(#cb-' + id + ')"/>' +
      '<path d="M' + (cx - bw / 2 + 5) + ' 51.4 q3.2 2.6 6.6 .6" fill="none" stroke="' + mainD + '" stroke-width="1.4" opacity=".45" stroke-linecap="round"/>' +
      '<path d="M' + (cx - 9.2) + ' 43.6 h7.4 v5.6 q0 1.5 -1.7 1.5 h-4 q-1.7 0 -1.7 -1.5 Z" fill="' + mix(p.main, '#000000', .10) +
      '" stroke="' + mainD + '" stroke-width="1.5" stroke-linejoin="round"/>' +
      '<path d="M' + (cx - 9.2) + ' 43.6 h7.4" stroke="' + mainD + '" stroke-width="1.5"/>' +
      '<path d="M' + (cx - 5.8) + ' 33 Q' + cx + ' 36.8 ' + (cx + 5.8) + ' 33" fill="none" stroke="' + mainD + '" stroke-width="1.8" stroke-linecap="round"/>';

    var neck = '<path d="M' + (cx - 3.2) + ' 27.4 h6.4 v7.4 q0 2.2 -3.2 2.2 q-3.2 0 -3.2 -2.2 Z" fill="' + SKIN +
      '" stroke="' + SKIN_LINE + '" stroke-width="1.5"/>' +
      '<path d="M' + (cx - 2.8) + ' 29.6 q2.8 1.8 5.6 0" fill="none" stroke="' + SKIN_LINE + '" stroke-width="1.2" opacity=".5"/>';

    function hand(side, hx) {
      var hy = 55.4;
      return '<g class="' + (side < 0 ? 'hand-l' : 'hand-r') + '">' +
        '<path d="M' + (hx - 2.6) + ' ' + (hy - 2.8) + ' q0 -1.8 2.6 -1.8 q2.6 0 2.6 1.8 l.4 3.1 q0 2.3 -3 2.3 q-3 0 -3 -2.3 Z"' +
        ' fill="url(#s-' + id + ')" stroke="' + SKIN_LINE + '" stroke-width="1.5" stroke-linejoin="round"/>' +
        '<circle cx="' + (hx + side * 2.8) + '" cy="' + (hy - 0.4) + '" r="1.35" fill="' + SKIN + '" stroke="' + SKIN_LINE + '" stroke-width="1.2"/></g>';
    }
    function arm(side) {
      var sx = cx + side * (bw / 2 - 0.4), ex = cx + side * (bw / 2 + 1.8), hx = cx + side * 9.4;
      var upper = 'M' + (sx - 3.4) + ' 34.6 L' + (sx + 3.4) + ' 34.6 L' + (ex + 3) + ' 43.8 L' + (ex - 3) + ' 43.8 Z';
      var fore = 'M' + ex + ' 43.4 L' + hx + ' 53.6';
      return '<path d="' + upper + '" fill="' + p.main + '" stroke="' + mainD + '" stroke-width="2" stroke-linejoin="round"/>' +
        '<path d="' + fore + '" stroke="' + SKIN_LINE + '" stroke-width="6" stroke-linecap="round"/>' +
        '<path d="' + fore + '" stroke="url(#s-' + id + ')" stroke-width="3.6" stroke-linecap="round"/>' +
        hand(side, hx);
    }

    var ears = '<circle cx="' + (L + 0.6) + '" cy="' + (T + hh * 0.58) + '" r="3.3" fill="url(#s-' + id + ')" stroke="' + SKIN_LINE + '" stroke-width="1.6"/>' +
      '<circle cx="' + (R - 0.6) + '" cy="' + (T + hh * 0.58) + '" r="3.3" fill="url(#s-' + id + ')" stroke="' + SKIN_LINE + '" stroke-width="1.6"/>';
    var head = '<rect x="' + L + '" y="' + T + '" width="' + g.hw + '" height="' + hh + '" rx="' + (g.hw * g.jaw) + '" ry="' + (hh * g.jaw) +
      '" fill="url(#s-' + id + ')" stroke="' + SKIN_LINE + '" stroke-width="2"/>' +
      '<ellipse cx="' + (L + g.hw * 0.32) + '" cy="' + (T + hh * 0.28) + '" rx="' + (g.hw * 0.36) + '" ry="' + (hh * 0.32) +
      '" fill="#FFFFFF" opacity=".26" clip-path="url(#ch-' + id + ')"/>';

    var H = hair(p, g, detail);
    var F = face(p, g, state, detail);

    var scarf = '';
    if (p.look === 'bun') {
      scarf = '<path d="M' + (cx - bw / 2 - 1.2) + ' 32.4 Q' + cx + ' 37.4 ' + (cx + bw / 2 + 1.2) + ' 32.4' +
        ' L' + (cx + bw / 2 + 1.2) + ' 36 Q' + cx + ' 40.8 ' + (cx - bw / 2 - 1.2) + ' 36 Z" fill="' + p.acc +
        '" stroke="' + mix(p.acc, '#2B2530', .4) + '" stroke-width="2" stroke-linejoin="round"/>' +
        '<path d="M' + (cx - bw / 2 - 1.2) + ' 34.4 Q' + (cx - bw / 2 - 8) + ' 39 ' + (cx - bw / 2 - 6.4) + ' 49' +
        ' L' + (cx - bw / 2 - 2.2) + ' 47 Z" fill="' + p.acc + '" stroke="' + mix(p.acc, '#2B2530', .4) + '" stroke-width="2" stroke-linejoin="round"/>';
    }

    var headGroup = H.back + ears + head + H.front + F + H.extra + scarf;
    var tilt = state === 'waiting' ? '<g transform="rotate(-6 ' + cx + ' ' + g.B + ')">' + headGroup + '</g>' : headGroup;

    var desk = '<rect class="furn" x="1" y="59.6" width="62" height="7" rx="2.6" fill="' + DESK + '" stroke="' + DESK_LINE + '" stroke-width="2"/>';

    var lean = state === 'working' ? 'rotate(-2.6 32 62)' : state === 'error' ? 'translate(0 1.2) rotate(1.8 32 62)' : '';
    var core = neck + body + arm(-1) + arm(1) + tilt;
    if (lean) core = '<g transform="' + lean + '">' + core + '</g>';
    core = '<g transform="translate(32 64) scale(' + k + ') translate(-32 -64)">' + core + '</g>';
    var deskAndProps = desk + props(p, g, detail);

    var ring = '';
    var ghost = '';
    if (state === 'provisioning' || state === 'failed') {
      var col = state === 'failed' ? '#9A8F82' : '#4176E6';
      ring = state === 'provisioning'
        ? '<circle class="ring" cx="32" cy="' + (T + hh / 2) + '" r="' + (g.hw / 2 + 5) + '" fill="none" stroke="#4176E6" stroke-width="2" stroke-dasharray="6 4.6" opacity=".9"/>'
        : '';
      ghost = '<rect x="' + L + '" y="' + T + '" width="' + g.hw + '" height="' + hh + '" rx="' + (g.hw * g.jaw) + '" ry="' + (hh * g.jaw) +
        '" fill="none" stroke="' + col + '" stroke-width="2" stroke-dasharray="4 3.2"/>' +
        '<path d="' + bodyPath + '" fill="none" stroke="' + col + '" stroke-width="2" stroke-dasharray="4 3.2" stroke-linejoin="round"/>';
    }

    var fig = ring + chairShadow + '<g class="fig" ' + (state === 'failed' ? 'opacity=".34" style="filter:grayscale(.65)"' :
      state === 'provisioning' ? 'opacity=".72"' : '') + '>' + core + '</g>' + deskAndProps + ghost;

    return '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' + defs + chair + fig + '</svg>';
  }

  /* ── 站姿 ─────────────────────────── */
  function stand(id, state, detail) {
    var p = P[id], g = geo(p, 'stand');
    var cx = g.cx, L = g.L, R = g.R, T = g.T, hh = g.hh, bw = g.bw;
    var mainD = mix(p.main, '#241B2E', .40);
    var mainL = mix(p.main, '#FFFFFF', .26);
    var pants = mix(p.main, '#2B2530', .52);
    var pantsD = mix(p.main, '#2B2530', .68);

    var defs = '<defs>' +
      '<linearGradient id="b-' + id + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + mainL + '"/><stop offset="1" stop-color="' + p.main + '"/></linearGradient>' +
      '<linearGradient id="s-' + id + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + SKIN_HI + '"/><stop offset="1" stop-color="' + SKIN + '"/></linearGradient></defs>';

    var legs = '<g class="leg-l"><rect x="' + (cx - 6.4) + '" y="58" width="5.8" height="27" rx="2.9" fill="' + pants + '" stroke="' + pantsD + '" stroke-width="2"/></g>' +
      '<g class="leg-r"><rect x="' + (cx + 0.6) + '" y="58" width="5.8" height="27" rx="2.9" fill="' + pants + '" stroke="' + pantsD + '" stroke-width="2"/></g>' +
      '<ellipse cx="' + (cx - 3.5) + '" cy="85.8" rx="4.6" ry="2.5" fill="' + mix(p.main, '#2B2530', .72) + '" stroke="' + pantsD + '" stroke-width="1.6"/>' +
      '<ellipse cx="' + (cx + 3.5) + '" cy="85.8" rx="4.6" ry="2.5" fill="' + mix(p.main, '#2B2530', .72) + '" stroke="' + pantsD + '" stroke-width="1.6"/>';

    var body = '<path d="M' + (cx - bw / 2 + 1) + ' 64 L' + (cx - bw / 2 + 1) + ' 41 Q' + (cx - bw / 2 + 1) + ' 32.4 ' + (cx - bw / 2 + 7) + ' 32.4' +
      ' L' + (cx + bw / 2 - 7) + ' 32.4 Q' + (cx + bw / 2 - 1) + ' 32.4 ' + (cx + bw / 2 - 1) + ' 41 L' + (cx + bw / 2 - 1) + ' 64 Z"' +
      ' fill="url(#b-' + id + ')" stroke="' + mainD + '" stroke-width="2" stroke-linejoin="round"/>';

    var arms = '<path d="M' + (cx - bw / 2 + 2.4) + ' 38 Q' + (cx - bw / 2 - 1.8) + ' 47 ' + (cx - bw / 2 - 0.8) + ' 56" fill="none" stroke="' + mainD + '" stroke-width="8.4" stroke-linecap="round"/>' +
      '<path d="M' + (cx - bw / 2 + 2.4) + ' 38 Q' + (cx - bw / 2 - 1.8) + ' 47 ' + (cx - bw / 2 - 0.8) + ' 56" fill="none" stroke="' + p.main + '" stroke-width="5.6" stroke-linecap="round"/>' +
      '<path d="M' + (cx + bw / 2 - 2.4) + ' 38 Q' + (cx + bw / 2 + 1.8) + ' 47 ' + (cx + bw / 2 + 0.8) + ' 56" fill="none" stroke="' + mainD + '" stroke-width="8.4" stroke-linecap="round"/>' +
      '<path d="M' + (cx + bw / 2 - 2.4) + ' 38 Q' + (cx + bw / 2 + 1.8) + ' 47 ' + (cx + bw / 2 + 0.8) + ' 56" fill="none" stroke="' + p.main + '" stroke-width="5.6" stroke-linecap="round"/>';

    var hands = '<circle cx="' + (cx - bw / 2 - 0.8) + '" cy="56.4" r="3.1" fill="' + SKIN + '" stroke="' + SKIN_LINE + '" stroke-width="1.6"/>' +
      '<circle cx="' + (cx + bw / 2 + 0.8) + '" cy="56.4" r="3.1" fill="' + SKIN + '" stroke="' + SKIN_LINE + '" stroke-width="1.6"/>';

    var neck = '<rect x="' + (cx - 4) + '" y="' + (g.B - 3) + '" width="8" height="6" rx="3" fill="' + SKIN_D + '"/>';
    var ears = '<circle cx="' + (L + 0.6) + '" cy="' + (T + hh * 0.58) + '" r="3.3" fill="' + SKIN + '" stroke="' + SKIN_LINE + '" stroke-width="1.6"/>' +
      '<circle cx="' + (R - 0.6) + '" cy="' + (T + hh * 0.58) + '" r="3.3" fill="' + SKIN + '" stroke="' + SKIN_LINE + '" stroke-width="1.6"/>';
    var head = '<rect x="' + L + '" y="' + T + '" width="' + g.hw + '" height="' + hh + '" rx="' + (g.hw * g.jaw) + '" ry="' + (hh * g.jaw) +
      '" fill="url(#s-' + id + ')" stroke="' + SKIN_LINE + '" stroke-width="2"/>';

    var H = hair(p, g, detail);
    var F = face(p, g, state, detail);

    var core = legs + body + arms + hands + neck + H.back + ears + head + H.front + F + H.extra;
    return '<svg viewBox="0 0 64 90" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' + defs +
      '<g class="fig">' + core + '</g></svg>';
  }

  function sprite(id, state, o) {
    o = o || {};
    var detail = o.detail === undefined ? 1 : o.detail;
    if (o.pose === 'stand') return stand(id, state || 'idle', detail);
    return sit(id, state || 'idle', detail, o);
  }

  return { sprite: sprite, note: function (id) { return NOTE[id] || ''; } };
})();
