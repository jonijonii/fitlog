/* ui.js — 공통 UI 헬퍼 (DOM 생성, 토스트, SVG 진행 링) */

window.FitLog = window.FitLog || {};

(function (FitLog) {
  'use strict';

  /** el('div', {class:'card'}, [자식...]) 형태의 간단한 DOM 빌더 */
  function el(tag, attrs, children) {
    var node = document.createElement(tag);

    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var val = attrs[key];
        if (val === null || val === undefined || val === false) return;
        if (key === 'class') node.className = val;
        else if (key === 'text') node.textContent = val;
        else if (key === 'html') node.innerHTML = val;
        else if (key.indexOf('on') === 0 && typeof val === 'function') {
          node.addEventListener(key.slice(2).toLowerCase(), val);
        } else if (key === 'dataset') {
          Object.keys(val).forEach(function (d) { node.dataset[d] = val[d]; });
        } else {
          node.setAttribute(key, val === true ? '' : val);
        }
      });
    }

    appendAll(node, children);
    return node;
  }

  function appendAll(node, children) {
    if (children === null || children === undefined) return;
    if (!Array.isArray(children)) children = [children];
    children.forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === 'string' || typeof c === 'number'
        ? document.createTextNode(String(c))
        : c);
    });
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  /* ---------- 토스트 ---------- */

  var toastTimer = null;

  function toast(message) {
    var box = document.getElementById('toast');
    if (!box) return;
    box.textContent = message;
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.hidden = true; }, 2600);
  }

  /* ---------- 진행 링 (SVG 직접 생성) ---------- */

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function svgEl(tag, attrs) {
    var node = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    return node;
  }

  /**
   * 진행 링. value/target 비율만큼 채운다.
   * @param {{label:string, value:number, target:number, unit:string, size?:number}} opts
   */
  function progressRing(opts) {
    var size = opts.size || 108;
    var stroke = 10;
    var r = (size - stroke) / 2;
    var c = 2 * Math.PI * r;
    var target = Number(opts.target) || 0;
    var value = Number(opts.value) || 0;
    var ratio = target > 0 ? Math.min(value / target, 1) : 0;

    var svg = svgEl('svg', {
      width: size, height: size, viewBox: '0 0 ' + size + ' ' + size,
      role: 'img',
      'aria-label': opts.label + ' ' + value + ' / ' + target + opts.unit
    });

    svg.appendChild(svgEl('circle', {
      class: 'ring-track', cx: size / 2, cy: size / 2, r: r,
      fill: 'none', 'stroke-width': stroke
    }));

    svg.appendChild(svgEl('circle', {
      class: 'ring-fill', cx: size / 2, cy: size / 2, r: r,
      fill: 'none', 'stroke-width': stroke,
      'stroke-dasharray': c,
      'stroke-dashoffset': c * (1 - ratio),
      transform: 'rotate(-90 ' + (size / 2) + ' ' + (size / 2) + ')'
    }));

    var remain = Math.max(0, Math.round(target - value));
    var mid = svgEl('text', { class: 'ring-center', x: size / 2, y: size / 2 });
    mid.textContent = remain + opts.unit;
    svg.appendChild(mid);

    var sub = svgEl('text', { class: 'ring-center-sub', x: size / 2, y: size / 2 + 16 });
    sub.textContent = '남음';
    svg.appendChild(sub);

    return el('div', { class: 'ring-item' }, [
      svg,
      el('div', { class: 'ring-name', text: opts.label }),
      el('div', { class: 'ring-val', text: Math.round(value) + ' / ' + Math.round(target) + opts.unit })
    ]);
  }

  /**
   * 목표 선택 칩 (복수 선택). 선택 상태는 그룹 안에서 관리하고 변경분만 콜백으로 넘긴다.
   * @param {string[]} initial
   * @param {(goals:string[])=>void} onChange
   */
  function goalChips(initial, onChange) {
    var calc = FitLog.calc;
    var goals = calc.normalizeGoals(initial);
    var group = el('div', { class: 'chips' });
    var buttons = {};

    function sync() {
      calc.GOAL_OPTIONS.forEach(function (opt) {
        buttons[opt.value].setAttribute('aria-pressed', String(goals.indexOf(opt.value) >= 0));
      });
    }

    calc.GOAL_OPTIONS.forEach(function (opt) {
      var btn = el('button', { type: 'button', class: 'chip', text: opt.label });
      btn.addEventListener('click', function () {
        goals = calc.toggleGoal(goals, opt.value);
        sync();
        onChange(goals);
      });
      buttons[opt.value] = btn;
      group.appendChild(btn);
    });

    sync();
    return group;
  }

  /**
   * 라인 차트. 외부 라이브러리 없이 SVG 를 직접 만든다.
   * 값이 없는 날(null)은 선을 잇지 않고 건너뛴다 — 매일 재는 게 아니기 때문.
   *
   * @param {{labels:string[], series:{name,values,axis,color}[], height?:number}} opts
   *   series[].axis: 'left'(기본) | 'right' — 단위가 다른 두 값을 같이 그릴 때 쓴다
   */
  function lineChart(opts) {
    var labels = opts.labels || [];
    var series = (opts.series || []).filter(function (s) {
      return s.values.some(function (v) { return v !== null && v !== undefined; });
    });
    if (!series.length || labels.length < 2) return null;

    var W = 320, H = opts.height || 150;
    var padL = 34, padR = 34, padT = 12, padB = 22;
    var innerW = W - padL - padR;
    var innerH = H - padT - padB;

    // 축별로 값 범위를 따로 잡는다
    var range = {};
    ['left', 'right'].forEach(function (axis) {
      var vals = [];
      series.forEach(function (s) {
        if ((s.axis || 'left') !== axis) return;
        s.values.forEach(function (v) { if (v !== null && v !== undefined) vals.push(Number(v)); });
      });
      if (!vals.length) return;

      var min = Math.min.apply(null, vals);
      var max = Math.max.apply(null, vals);
      if (min === max) { min -= 1; max += 1; }          // 값이 하나뿐이면 납작해지지 않게
      var margin = (max - min) * 0.15;
      range[axis] = { min: min - margin, max: max + margin };
    });

    var svg = svgEl('svg', {
      viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H,
      class: 'chart', role: 'img',
      'aria-label': series.map(function (s) { return s.name; }).join(', ') + ' 추이'
    });

    function xAt(i) {
      return padL + (labels.length === 1 ? innerW / 2 : innerW * i / (labels.length - 1));
    }
    function yAt(v, axis) {
      var r = range[axis];
      return padT + innerH * (1 - (v - r.min) / (r.max - r.min));
    }

    // 가로 눈금 3줄
    [0, 0.5, 1].forEach(function (t) {
      svg.appendChild(svgEl('line', {
        class: 'chart-grid',
        x1: padL, x2: W - padR,
        y1: padT + innerH * t, y2: padT + innerH * t
      }));
    });

    series.forEach(function (s, si) {
      var axis = s.axis || 'left';
      if (!range[axis]) return;

      // null 을 만나면 선을 끊는다
      var d = '', pen = false;
      s.values.forEach(function (v, i) {
        if (v === null || v === undefined) { pen = false; return; }
        var cmd = pen ? 'L' : 'M';
        d += cmd + xAt(i).toFixed(1) + ' ' + yAt(Number(v), axis).toFixed(1) + ' ';
        pen = true;
      });

      svg.appendChild(svgEl('path', {
        class: 'chart-line chart-line-' + si, d: d.trim(), fill: 'none'
      }));

      s.values.forEach(function (v, i) {
        if (v === null || v === undefined) return;
        svg.appendChild(svgEl('circle', {
          class: 'chart-dot chart-dot-' + si,
          cx: xAt(i).toFixed(1), cy: yAt(Number(v), axis).toFixed(1), r: 2.5
        }));
      });

      // 축 값 범위 표기 (왼쪽/오른쪽)
      var r = range[axis];
      var tx = axis === 'left' ? 2 : W - padR + 4;
      [[r.max, padT + 4], [r.min, padT + innerH]].forEach(function (pair) {
        var label = svgEl('text', { class: 'chart-axis', x: tx, y: pair[1] });
        label.textContent = Math.round(pair[0] * 10) / 10;
        svg.appendChild(label);
      });
    });

    // 처음·마지막 날짜만 표기 (좁은 화면에서 다 넣으면 겹친다)
    [[0, padL, 'start'], [labels.length - 1, W - padR, 'end']].forEach(function (spec) {
      var t = svgEl('text', {
        class: 'chart-axis', x: spec[1], y: H - 6, 'text-anchor': spec[2]
      });
      t.textContent = labels[spec[0]].slice(5);
      svg.appendChild(t);
    });

    var box = el('div', { class: 'chart-box' }, [svg]);

    if (series.length > 1) {
      box.appendChild(el('div', { class: 'chart-legend' },
        series.map(function (s, si) {
          return el('span', { class: 'chart-key' }, [
            el('i', { class: 'chart-swatch chart-swatch-' + si }),
            s.name
          ]);
        })));
    }

    return box;
  }

  /** 영양소 한 줄 — 이름 · 막대 · 값. 4단계 색상은 level.key 로 정한다. */
  function nutrientBar(item) {
    var pct = Math.max(0, Math.min(item.ratio || 0, 1.5)) / 1.5 * 100;

    return el('div', { class: 'nbar' }, [
      el('div', { class: 'nbar-head' }, [
        el('span', { class: 'nbar-name', text: item.name }),
        el('span', { class: 'nbar-val',
          text: item.value + ' / ' + item.target + item.unit })
      ]),
      el('div', { class: 'nbar-track' }, [
        // 100% 지점 표시 — 목표선이 어디인지 보여야 막대가 의미를 갖는다
        el('i', { class: 'nbar-goal' }),
        el('i', { class: 'nbar-fill nbar-' + item.level.key,
                  style: 'width:' + pct.toFixed(1) + '%' })
      ])
    ]);
  }

  /** key : value 한 줄 */
  function row(key, value) {
    return el('div', { class: 'row' }, [
      el('span', { class: 'row-key', text: key }),
      el('span', { class: 'row-val', text: value })
    ]);
  }

  function card(title, children) {
    return el('div', { class: 'card' },
      [title ? el('h2', { class: 'card-title', text: title }) : null].concat(children || []));
  }

  function disclaimer() {
    return el('p', { class: 'disclaimer' },
      '이 앱은 건강 기록 도구야. 의학적 조언이 아니니까 ' +
      '건강 상태나 먹는 약이 있으면 전문가랑 상의해.');
  }

  FitLog.ui = {
    el: el,
    clear: clear,
    appendAll: appendAll,
    toast: toast,
    goalChips: goalChips,
    progressRing: progressRing,
    lineChart: lineChart,
    nutrientBar: nutrientBar,
    row: row,
    card: card,
    disclaimer: disclaimer
  };
})(window.FitLog);
