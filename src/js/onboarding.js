/* onboarding.js — 첫 실행 마법사 (기본정보 → 인바디 → 목표 → 보충제 → 요약) */

window.FitLog = window.FitLog || {};

(function (FitLog) {
  'use strict';

  var el = FitLog.ui.el;
  var clear = FitLog.ui.clear;
  var calc = FitLog.calc;
  var store = FitLog.store;

  var STEPS = [
    { key: 'basic',   title: '기본 정보',    desc: '목표 칼로리 계산에 꼭 필요한 값이야.', skip: false },
    { key: 'inbody',  title: '인바디 수치',  desc: '있으면 더 정확하게 계산해. 없으면 건너뛰어도 돼.', skip: true },
    { key: 'goal',    title: '목표와 운동 계획', desc: '무리하지 않는 선에서 정하자. 나중에 바꿀 수 있어.', skip: false },
    { key: 'supp',    title: '보충제',       desc: '먹는 보충제를 등록해 두면 영양소 합산에 반영돼.', skip: true },
    { key: 'summary', title: '이렇게 계산했어', desc: '', skip: false }
  ];

  var draft = null;
  var stepIndex = 0;
  var errors = {};
  var onDone = null;

  /* ---------- 진입점 ---------- */

  function start(callback) {
    onDone = callback;
    draft = {
      height: '', age: '', sex: '', weight: '',
      skeletalMuscle: '', bodyFatPct: '',
      menopause: null,
      supplements: [],
      goals: ['maintain'],
      weeklyPlan: { strength: 2, cardio: 3 }
    };
    stepIndex = 0;
    errors = {};

    document.getElementById('onboarding').hidden = false;
    document.getElementById('app').hidden = true;

    document.getElementById('obBack').onclick = back;
    document.getElementById('obNext').onclick = next;
    document.getElementById('obSkip').onclick = function () { go(stepIndex + 1); };

    render();
  }

  /* ---------- 이동 ---------- */

  function go(index) {
    stepIndex = Math.max(0, Math.min(STEPS.length - 1, index));
    errors = {};
    render();
    document.querySelector('.ob-body').scrollTop = 0;
  }

  function back() {
    if (stepIndex === 0) return;
    go(stepIndex - 1);
  }

  function next() {
    var key = STEPS[stepIndex].key;

    if (key === 'basic') {
      errors = pick(calc.validateProfile(draft), ['height', 'age', 'sex', 'weight']);
      if (Object.keys(errors).length) { render(); return; }
    }

    if (key === 'inbody') {
      errors = pick(calc.validateProfile(draft), ['skeletalMuscle', 'bodyFatPct']);
      if (Object.keys(errors).length) { render(); return; }
    }

    if (key === 'summary') { finish(); return; }

    go(stepIndex + 1);
  }

  function pick(obj, keys) {
    var out = {};
    keys.forEach(function (k) { if (obj[k]) out[k] = obj[k]; });
    return out;
  }

  function finish() {
    var profile = {
      height: Number(draft.height),
      age: Number(draft.age),
      sex: draft.sex,
      weight: Number(draft.weight),
      skeletalMuscle: draft.skeletalMuscle === '' ? null : Number(draft.skeletalMuscle),
      bodyFatPct: draft.bodyFatPct === '' ? null : Number(draft.bodyFatPct),
      goals: calc.normalizeGoals(draft.goals),
      weeklyPlan: {
        strength: Number(draft.weeklyPlan.strength),
        cardio: Number(draft.weeklyPlan.cardio)
      },
      createdAt: store.todayKey()
    };
    if (showMenopauseField()) profile.menopause = draft.menopause;

    var targets = calc.computeTargets(profile);

    store.update(function (state) {
      state.profile = profile;
      state.targets = targets;

      // 온보딩에서 고른 보충제를 프리셋 기본값으로 등록한다.
      draft.supplements.forEach(function (presetId) {
        var item = FitLog.supplements.fromPreset(presetId);
        if (item) state.supplements.push(item);
      });

      // 인바디 값을 입력했다면 첫 측정 기록으로 남긴다.
      if (profile.skeletalMuscle !== null || profile.bodyFatPct !== null) {
        state.bodyLogs.push({
          date: profile.createdAt,
          weight: profile.weight,
          skeletalMuscle: profile.skeletalMuscle,
          bodyFatPct: profile.bodyFatPct,
          visceralRatio: null,
          waistCm: null
        });
      }
      return state;
    });

    document.getElementById('onboarding').hidden = true;
    document.getElementById('app').hidden = false;
    if (onDone) onDone();
  }

  /* ---------- 렌더 ---------- */

  function render() {
    var step = STEPS[stepIndex];

    var bar = clear(document.getElementById('obSteps'));
    STEPS.forEach(function (_, i) {
      bar.appendChild(el('i', { class: i <= stepIndex ? 'on' : '' }));
    });

    document.getElementById('obTitle').textContent = step.title;
    document.getElementById('obDesc').textContent = step.desc;

    document.getElementById('obBack').hidden = stepIndex === 0;
    document.getElementById('obSkip').hidden = !step.skip;
    document.getElementById('obNext').textContent =
      step.key === 'summary' ? '시작하기' : '다음';

    var body = clear(document.getElementById('obBody'));
    body.appendChild(({
      basic: renderBasic,
      inbody: renderInbody,
      goal: renderGoal,
      supp: renderSupp,
      summary: renderSummary
    })[step.key]());
  }

  function field(label, node, hint, errorKey) {
    return el('div', { class: 'field' }, [
      el('label', { class: 'field-label', text: label }),
      node,
      hint ? el('p', { class: 'field-hint', text: hint }) : null,
      errors[errorKey] ? el('p', { class: 'error-text', text: errors[errorKey] }) : null
    ]);
  }

  function numInput(key, placeholder, step) {
    var input = el('input', {
      type: 'number',
      inputmode: 'decimal',
      step: step || 'any',
      placeholder: placeholder || '',
      value: draft[key]
    });
    input.addEventListener('input', function () {
      draft[key] = input.value;
      // 나이에 따라 완경 질문 노출이 달라진다. 전체 재렌더는 입력 포커스를 잃게 하므로
      // 해당 영역만 갈아 끼운다.
      if (key === 'age') syncMenopause();
    });
    return el('div', { class: 'suffix' }, [input]);
  }

  function suffixed(key, placeholder, unit, stepAttr) {
    var wrap = numInput(key, placeholder, stepAttr);
    wrap.appendChild(el('span', { text: unit }));
    return wrap;
  }

  /** 단일 선택 칩. 선택 상태는 그룹 내부에서 갱신하므로 전체 재렌더가 필요 없다. */
  function chipGroup(options, currentValue, onPick) {
    var group = el('div', { class: 'chips' });
    var buttons = [];

    options.forEach(function (opt) {
      var btn = el('button', {
        type: 'button',
        class: 'chip',
        'aria-pressed': String(currentValue === opt.value),
        text: opt.label
      });
      btn.addEventListener('click', function () {
        buttons.forEach(function (b) {
          b.setAttribute('aria-pressed', String(b === btn));
        });
        onPick(opt.value);
      });
      buttons.push(btn);
      group.appendChild(btn);
    });

    return group;
  }

  function counter(label, key) {
    var val = el('span', { class: 'counter-val', text: draft.weeklyPlan[key] + '회' });

    function bump(delta) {
      var v = Math.max(0, Math.min(14, draft.weeklyPlan[key] + delta));
      draft.weeklyPlan[key] = v;
      val.textContent = v + '회';
    }

    return el('div', { class: 'field' }, [
      el('label', { class: 'field-label', text: label }),
      el('div', { class: 'counter' }, [
        el('button', { type: 'button', class: 'counter-btn', 'aria-label': label + ' 줄이기',
                       text: '−', onclick: function () { bump(-1); } }),
        val,
        el('button', { type: 'button', class: 'counter-btn', 'aria-label': label + ' 늘리기',
                       text: '+', onclick: function () { bump(1); } })
      ])
    ]);
  }

  function showMenopauseField() {
    return draft.sex === 'female' && Number(draft.age) >= 45;
  }

  /* ---------- 단계별 화면 ---------- */

  /** 완경 질문 영역만 다시 그린다 (여성 + 45세 이상일 때만 노출). */
  function syncMenopause() {
    var slot = document.getElementById('menopauseSlot');
    if (!slot) return;
    clear(slot);
    if (!showMenopauseField()) return;

    slot.appendChild(field('완경 여부 (선택)',
      chipGroup(
        [{ label: '완경 전', value: false },
         { label: '완경 후', value: true },
         { label: '답하지 않음', value: null }],
        draft.menopause,
        function (v) { draft.menopause = v; }
      ),
      '철분 권장량이 달라져서 물어봐. 답 안 해도 괜찮아.'));
  }

  function renderBasic() {
    var wrap = el('div');

    wrap.appendChild(field('키', suffixed('height', '', 'cm', '0.1'), null, 'height'));
    wrap.appendChild(field('나이', suffixed('age', '', '세', '1'), null, 'age'));

    wrap.appendChild(field('성별',
      chipGroup(
        [{ label: '여성', value: 'female' }, { label: '남성', value: 'male' }],
        draft.sex,
        function (v) { draft.sex = v; syncMenopause(); }
      ),
      '기초대사량 공식이랑 영양소 권장량이 달라져서 필요해.', 'sex'));

    wrap.appendChild(field('체중', suffixed('weight', '', 'kg', '0.1'), null, 'weight'));

    var slot = el('div', { id: 'menopauseSlot' });
    wrap.appendChild(slot);
    setTimeout(syncMenopause, 0);

    return wrap;
  }

  function renderInbody() {
    var wrap = el('div');
    wrap.appendChild(el('p', { class: 'notice notice-info',
      text: '체지방률을 넣으면 제지방량 기반 공식(Katch-McArdle)으로 더 정확하게 계산해.' }));
    wrap.appendChild(field('골격근량 (선택)', suffixed('skeletalMuscle', '', 'kg', '0.1'),
      null, 'skeletalMuscle'));
    wrap.appendChild(field('체지방률 (선택)', suffixed('bodyFatPct', '', '%', '0.1'),
      null, 'bodyFatPct'));
    return wrap;
  }

  function renderGoal() {
    var wrap = el('div');

    wrap.appendChild(field('목표 (여러 개 고를 수 있어)',
      FitLog.ui.goalChips(draft.goals, function (goals) { draft.goals = goals; }),
      '근력 강화 + 체중 감량을 같이 고르면 리컴프(근육 지키면서 체지방 빼기)로 계산해. ' +
      '현재 유지는 단독으로만 골라져.'));

    wrap.appendChild(counter('주간 근력운동 계획', 'strength'));
    wrap.appendChild(counter('주간 유산소 계획', 'cardio'));

    wrap.appendChild(el('p', { class: 'field-hint',
      text: '주간 운동 횟수는 활동계수(소비 칼로리 보정값)에 반영돼.' }));

    return wrap;
  }

  function renderSupp() {
    var sup = FitLog.supplements;
    var wrap = el('div');

    wrap.appendChild(el('p', { class: 'field-hint',
      text: '먹는 걸 골라줘. 시간대는 기본값으로 들어가고 나중에 설정에서 바꿀 수 있어.' }));

    sup.PRESETS.forEach(function (preset) {
      var on = draft.supplements.indexOf(preset.id) >= 0;

      var check = el('span', { class: 'sup-check', text: on ? '✓' : '' });
      var btn = el('button', {
        type: 'button',
        class: 'sup-item' + (on ? ' sup-on' : ''),
        'aria-pressed': String(on)
      }, [
        check,
        el('span', { class: 'sup-body' }, [
          el('span', { class: 'sup-name', text: preset.name }),
          el('span', { class: 'sup-amount',
            text: preset.amount + ' · ' + sup.SLOT_BY_KEY[preset.slot].label })
        ])
      ]);

      // 목록이 길어서 전체 재렌더를 하면 스크롤이 맨 위로 튄다. 버튼만 바꾼다.
      btn.addEventListener('click', function () {
        var at = draft.supplements.indexOf(preset.id);
        var nowOn;
        if (at >= 0) { draft.supplements.splice(at, 1); nowOn = false; }
        else { draft.supplements.push(preset.id); nowOn = true; }

        btn.className = 'sup-item' + (nowOn ? ' sup-on' : '');
        btn.setAttribute('aria-pressed', String(nowOn));
        check.textContent = nowOn ? '✓' : '';
      });

      wrap.appendChild(btn);
    });

    return wrap;
  }

  function renderSummary() {
    var profile = {
      height: Number(draft.height), age: Number(draft.age), sex: draft.sex,
      weight: Number(draft.weight),
      bodyFatPct: draft.bodyFatPct === '' ? null : Number(draft.bodyFatPct),
      goals: draft.goals,
      weeklyPlan: draft.weeklyPlan,
      menopause: showMenopauseField() ? draft.menopause : null
    };
    var t = calc.computeTargets(profile);
    var ui = FitLog.ui;

    var wrap = el('div');

    wrap.appendChild(ui.card('하루 목표', [
      el('div', { class: 'rows' }, [
        ui.row('칼로리', t.calories + ' kcal'),
        ui.row('단백질', t.protein + ' g'),
        ui.row('탄수화물', t.carbs + ' g'),
        ui.row('지방', t.fat + ' g'),
        ui.row('식이섬유', t.fiber + ' g')
      ])
    ]));

    wrap.appendChild(ui.card('계산 근거', [
      el('div', { class: 'rows' }, [
        ui.row('기초대사량 (BMR)', t.meta.bmr + ' kcal'),
        ui.row('계산식', t.meta.bmrMethod),
        ui.row('활동계수', '×' + t.meta.activityFactor),
        ui.row('총소비열량 (TDEE)', t.meta.tdee + ' kcal'),
        ui.row('목표', t.meta.goalLabel),
        ui.row('등록할 보충제', draft.supplements.length + '개')
      ])
    ]));

    t.notes.forEach(function (note) {
      wrap.appendChild(el('p', { class: 'notice notice-warn', text: note }));
    });

    wrap.appendChild(ui.disclaimer());
    return wrap;
  }

  FitLog.onboarding = { start: start, STEPS: STEPS };
})(window.FitLog);
