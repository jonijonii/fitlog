/* sheet.js — 음식 선택 시트 (검색 · 템플릿 · 단품 · 즐겨찾기 · 직접 등록)
 *
 * 기록은 3탭 안에 끝나야 한다:
 *   [+] → 항목 → 양(적게/보통/많이)   ← 세 번째 탭에서 바로 저장되고 시트가 닫힌다
 */

window.FitLog = window.FitLog || {};

(function (FitLog) {
  'use strict';

  var el = FitLog.ui.el;
  var clear = FitLog.ui.clear;
  var store = FitLog.store;
  var foods = FitLog.foods;
  var templates = FitLog.templates;

  var MEAL_LABEL = {
    breakfast: '아침', lunch: '점심', dinner: '저녁', snack: '간식'
  };

  var TABS = [
    { key: 'fav',       label: '즐겨찾기' },
    { key: 'korean',    label: '한식' },
    { key: 'banchan',   label: '집밥' },
    { key: 'western',   label: '양식' },
    { key: 'eatingout', label: '외식' },
    { key: 'snack',     label: '간식' },
    { key: 'food',      label: '단품' },
    { key: 'custom',    label: '직접 등록' }
  ];

  var root = null;
  var ctx = { mealType: 'lunch', onSaved: null };
  var tab = 'korean';
  var query = '';
  var expanded = null;      // 'kind:id'

  /* ---------- 항목 추상화 ---------- */

  function templateEntry(t) {
    return {
      kind: 'template', id: t.id, name: t.name,
      detail: templates.itemLabels(t, 1).join(' · '),
      nutrientsAt: function (p) { return templates.nutrients(t, p); },
      amountAt: function () { return ''; },
      items: t.items
    };
  }

  function foodEntry(f) {
    return {
      kind: 'food', id: f.id, name: f.name,
      detail: foods.GROUP_LABEL[f.group] + ' · 100g 기준',
      nutrientsAt: function (p) { return foods.scale(f, 100 * p); },
      amountAt: function (p) { return Math.round(100 * p) + 'g'; },
      items: null
    };
  }

  function customEntry(c) {
    return {
      kind: 'custom', id: c.id, name: c.name,
      detail: '직접 등록 · 1회분',
      nutrientsAt: function (p) { return foods.scaleNutrients(c.nutrients, p); },
      amountAt: function () { return ''; },
      items: null
    };
  }

  function entryOf(kind, id) {
    if (kind === 'template') { var t = templates.get(id); return t ? templateEntry(t) : null; }
    if (kind === 'food') { var f = foods.get(id); return f ? foodEntry(f) : null; }
    var c = store.getCustomFood(id);
    return c ? customEntry(c) : null;
  }

  /* ---------- 목록 만들기 ---------- */

  function currentEntries() {
    if (query) {
      return [].concat(
        templates.search(query, 20).map(templateEntry),
        store.load().customFoods
          .filter(function (c) { return c.name.indexOf(query) >= 0; })
          .map(customEntry),
        foods.search(query, 20).map(foodEntry)
      );
    }

    if (tab === 'fav') {
      return store.load().favorites
        .map(function (key) {
          var at = key.indexOf(':');
          return entryOf(key.slice(0, at), key.slice(at + 1));
        })
        .filter(Boolean);
    }

    if (tab === 'food') {
      // 검색어 없이 단품 300여 개를 전부 뿌리면 못 쓴다. 그룹별 앞부분만 보여주고 검색을 유도.
      var byGroup = [];
      Object.keys(foods.GROUP_LABEL).forEach(function (g) {
        byGroup = byGroup.concat(
          foods.all().filter(function (f) { return f.group === g; }).slice(0, 6)
        );
      });
      return byGroup.map(foodEntry);
    }

    if (tab === 'custom') return store.load().customFoods.map(customEntry);

    return templates.byCategory(tab).map(templateEntry);
  }

  /* ---------- 저장 ---------- */

  function save(entry, portion) {
    var n = entry.nutrientsAt(portion);

    store.addMeal(store.todayKey(), {
      type: ctx.mealType,
      sourceKind: entry.kind,
      sourceId: entry.id,
      label: entry.name,
      portion: portion,
      items: entry.items ? entry.items.map(function (i) {
        return { food: i.food, g: Math.round(i.g * portion) };
      }) : null,
      nutrients: foods.round(n)
    });

    var label = templates.PORTIONS.filter(function (p) { return p.value === portion; })[0];
    FitLog.ui.toast(entry.name + ' ' + (label ? label.label : '') + ' 기록했어');

    close();
    if (ctx.onSaved) ctx.onSaved();
  }

  /* ---------- 렌더 ---------- */

  function render() {
    var body = clear(root.querySelector('.sheet-body'));

    if (tab === 'custom' && !query) {
      body.appendChild(customForm());
    }

    var entries = currentEntries();

    if (!entries.length) {
      body.appendChild(el('p', { class: 'sheet-empty', text: emptyMessage() }));
      return;
    }

    entries.forEach(function (entry) { body.appendChild(entryRow(entry)); });
  }

  function emptyMessage() {
    if (query) return '"' + query + '" 로 찾은 게 없어. 직접 등록 탭에서 추가할 수 있어.';
    if (tab === 'fav') return '즐겨찾기가 비었어. 항목 옆 ☆ 를 누르면 여기 모여.';
    if (tab === 'custom') return '직접 등록한 음식이 아직 없어.';
    return '항목이 없어.';
  }

  function entryRow(entry) {
    var key = entry.kind + ':' + entry.id;
    var isOpen = expanded === key;
    var base = foods.round(entry.nutrientsAt(1));

    var row = el('div', { class: 'pick' + (isOpen ? ' pick-open' : '') });

    var head = el('button', { type: 'button', class: 'pick-head' }, [
      el('span', { class: 'pick-name', text: entry.name }),
      el('span', { class: 'pick-macro',
        text: base.kcal + 'kcal · 단백질 ' + base.protein + 'g' })
    ]);
    head.addEventListener('click', function () {
      expanded = isOpen ? null : key;
      render();
    });

    var star = el('button', {
      type: 'button',
      class: 'pick-star',
      'aria-label': entry.name + ' 즐겨찾기',
      'aria-pressed': String(store.isFavorite(entry.kind, entry.id)),
      text: store.isFavorite(entry.kind, entry.id) ? '★' : '☆'
    });
    star.addEventListener('click', function (e) {
      e.stopPropagation();
      store.toggleFavorite(entry.kind, entry.id);
      render();
    });

    row.appendChild(el('div', { class: 'pick-row' }, [head, star]));

    if (isOpen) {
      var detail = el('div', { class: 'pick-detail' });
      if (entry.detail) detail.appendChild(el('p', { class: 'pick-items', text: entry.detail }));

      var portions = el('div', { class: 'portion-row' });
      templates.PORTIONS.forEach(function (p) {
        var n = foods.round(entry.nutrientsAt(p.value));
        var amount = entry.amountAt(p.value);
        var btn = el('button', { type: 'button', class: 'portion-btn' }, [
          el('strong', { text: p.label }),
          el('span', { text: (amount ? amount + ' · ' : '') + n.kcal + 'kcal' })
        ]);
        btn.addEventListener('click', function () { save(entry, p.value); });
        portions.appendChild(btn);
      });

      detail.appendChild(portions);
      row.appendChild(detail);
    }

    return row;
  }

  /* ---------- 직접 등록 폼 ---------- */

  function customForm() {
    var draft = { name: '', kcal: '', protein: '', carbs: '', fat: '', sodium: '' };
    var errorBox = el('div');

    function field(label, key, unit, required) {
      var input = el('input', {
        type: key === 'name' ? 'text' : 'number',
        inputmode: key === 'name' ? null : 'decimal',
        step: 'any'
      });
      input.addEventListener('input', function () { draft[key] = input.value; });

      return el('div', { class: 'field' }, [
        el('label', { class: 'field-label',
          text: label + (required ? '' : ' (선택)') }),
        unit
          ? el('div', { class: 'suffix' }, [input, el('span', { text: unit })])
          : input
      ]);
    }

    function submit() {
      clear(errorBox);
      var name = String(draft.name).trim();
      var kcal = Number(draft.kcal);
      var protein = Number(draft.protein);

      var errors = [];
      if (!name) errors.push('이름을 적어줘.');
      if (!draft.kcal || isNaN(kcal) || kcal < 0 || kcal > 3000) errors.push('칼로리를 0~3000 사이로 적어줘.');
      if (draft.protein === '' || isNaN(protein) || protein < 0 || protein > 300) errors.push('단백질을 0~300g 사이로 적어줘.');

      if (errors.length) {
        errors.forEach(function (m) { errorBox.appendChild(el('p', { class: 'error-text', text: m })); });
        return;
      }

      var nutrients = {};
      foods.KEYS.forEach(function (k) { nutrients[k] = 0; });
      nutrients.kcal = kcal;
      nutrients.protein = protein;
      nutrients.carbs = Number(draft.carbs) || 0;
      nutrients.fat = Number(draft.fat) || 0;
      nutrients.sodium = Number(draft.sodium) || 0;

      store.addCustomFood({ name: name, nutrients: nutrients });
      FitLog.ui.toast('"' + name + '" 등록했어. 이제 검색에도 나와.');
      render();
    }

    return el('div', { class: 'custom-form' }, [
      el('p', { class: 'sheet-hint',
        text: '한 번 먹는 양 기준으로 적어줘. 이름·칼로리·단백질만 있으면 돼.' }),
      field('이름', 'name', null, true),
      el('div', { class: 'field-inline' }, [
        field('칼로리', 'kcal', 'kcal', true),
        field('단백질', 'protein', 'g', true)
      ]),
      el('div', { class: 'field-inline' }, [
        field('탄수화물', 'carbs', 'g', false),
        field('지방', 'fat', 'g', false)
      ]),
      field('나트륨', 'sodium', 'mg', false),
      errorBox,
      el('button', { class: 'btn btn-primary btn-block', type: 'button',
                     text: '등록하기', onclick: submit })
    ]);
  }

  /* ---------- 열기 / 닫기 ---------- */

  function build() {
    root = el('div', { class: 'sheet', hidden: true }, [
      el('div', { class: 'sheet-scrim' }),
      el('div', { class: 'sheet-panel', role: 'dialog', 'aria-modal': 'true' }, [
        el('div', { class: 'sheet-head' }, [
          el('h2', { class: 'sheet-title', id: 'sheetTitle' }),
          el('button', { class: 'sheet-close', type: 'button', 'aria-label': '닫기', text: '✕' })
        ]),
        el('div', { class: 'sheet-search' }, [
          el('input', { type: 'search', placeholder: '음식 이름으로 검색',
                        'aria-label': '음식 검색' })
        ]),
        el('div', { class: 'sheet-tabs' }),
        el('div', { class: 'sheet-body' })
      ])
    ]);

    root.querySelector('.sheet-scrim').addEventListener('click', close);
    root.querySelector('.sheet-close').addEventListener('click', close);

    var input = root.querySelector('.sheet-search input');
    input.addEventListener('input', function () {
      query = input.value.trim();
      expanded = null;
      renderTabs();
      render();
    });

    document.body.appendChild(root);
  }

  function renderTabs() {
    var bar = clear(root.querySelector('.sheet-tabs'));
    bar.hidden = !!query;
    if (query) return;

    TABS.forEach(function (t) {
      var btn = el('button', {
        type: 'button',
        class: 'sheet-tab',
        'aria-pressed': String(tab === t.key),
        text: t.label
      });
      btn.addEventListener('click', function () {
        tab = t.key;
        expanded = null;
        renderTabs();
        render();
      });
      bar.appendChild(btn);
    });
  }

  function open(mealType, onSaved) {
    if (!root) build();

    ctx.mealType = mealType;
    ctx.onSaved = onSaved;
    tab = mealType === 'snack' ? 'snack' : 'korean';
    query = '';
    expanded = null;

    root.querySelector('#sheetTitle').textContent =
      (MEAL_LABEL[mealType] || '식사') + ' 기록하기';
    root.querySelector('.sheet-search input').value = '';

    root.hidden = false;
    document.body.classList.add('sheet-open');

    renderTabs();
    render();
    root.querySelector('.sheet-body').scrollTop = 0;
  }

  function close() {
    if (!root) return;
    root.hidden = true;
    document.body.classList.remove('sheet-open');
  }

  FitLog.sheet = { open: open, close: close, MEAL_LABEL: MEAL_LABEL };
})(window.FitLog);
