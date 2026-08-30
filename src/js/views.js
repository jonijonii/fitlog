/* views.js — 탭 화면 4개 (오늘 / 주간 / 인바디 / 설정) */

window.FitLog = window.FitLog || {};

(function (FitLog) {
  'use strict';

  var ui = FitLog.ui;
  var el = ui.el;
  var store = FitLog.store;
  var calc = FitLog.calc;

  var SEX_LABEL = { female: '여성', male: '남성' };

  function soon(text) {
    return el('p', { class: 'notice notice-info', text: text });
  }

  /* ---------- 탭 1: 오늘 ---------- */

  var MEAL_TYPES = [
    { key: 'breakfast', label: '아침' },
    { key: 'lunch', label: '점심' },
    { key: 'dinner', label: '저녁' },
    { key: 'snack', label: '간식' }
  ];

  function today() {
    var state = store.load();
    var t = state.targets;
    var day = store.getDay();
    var eaten = FitLog.foods.round(store.dayNutrients());
    var wrap = el('div');

    wrap.appendChild(el('h1', { class: 'screen-title', text: '오늘' }));
    wrap.appendChild(el('p', { class: 'screen-sub', text: store.todayKey() }));

    wrap.appendChild(ui.card(null, [
      el('div', { class: 'rings' }, [
        ui.progressRing({ label: '칼로리', value: eaten.kcal, target: t.calories, unit: 'kcal' }),
        ui.progressRing({ label: '단백질', value: eaten.protein, target: t.protein, unit: 'g' })
      ]),
      el('div', { class: 'macro-row' }, [
        macroCell('탄수', eaten.carbs, t.carbs, 'g'),
        macroCell('지방', eaten.fat, t.fat, 'g'),
        macroCell('식이섬유', eaten.fiber, t.fiber, 'g'),
        macroCell('나트륨', Math.round(eaten.sodium), 2300, 'mg')
      ])
    ]));

    wrap.appendChild(mealsCard(day));

    wrap.appendChild(supplementsCard(state, day));

    wrap.appendChild(workoutCard(day));

    wrap.appendChild(alertsCard(state));

    wrap.appendChild(summaryCard('기록 보내기', {
      date: true,
      build: function (dateKey) { return FitLog.report.dailyText(store.load(), dateKey); },
      hint: '먹은 것·운동·체중을 읽기 좋은 글로 복사해. 날짜를 바꾸면 지난 기록도 볼 수 있어. ' +
            '트레이너에게 보내거나 AI에 붙여넣어도 돼.'
    }));

    wrap.appendChild(ui.disclaimer());
    return wrap;
  }

  /* 트레이너에게 보낼 요약.
     복사만 시키면 뭐가 나갈지 모르는 채로 붙여넣게 된다. 미리 보여준다. */
  function summaryCard(title, opts) {
    var picked = opts.date ? store.todayKey() : null;

    var preview = el('pre', { class: 'summary-preview' });

    function build() {
      return opts.build(picked);
    }
    function refresh() {
      preview.textContent = build();
    }

    var head = [];

    if (opts.date) {
      // 지난 날짜도 볼 수 있어야 한다. 어제 기록을 아침에 보내는 일이 흔하다.
      var input = el('input', {
        type: 'date', value: picked, max: store.todayKey(), 'aria-label': '볼 날짜'
      });
      input.addEventListener('change', function () {
        picked = input.value || store.todayKey();
        refresh();
      });

      function jump(dayOffset) {
        picked = FitLog.judge.shiftDays(store.todayKey(), dayOffset);
        input.value = picked;
        refresh();
      }

      var yesterday = el('button', { class: 'btn', type: 'button', text: '어제' });
      yesterday.addEventListener('click', function () { jump(-1); });

      var todayBtn = el('button', { class: 'btn', type: 'button', text: '오늘' });
      todayBtn.addEventListener('click', function () { jump(0); });

      head.push(el('div', { class: 'field-inline' }, [yesterday, todayBtn]));
      head.push(el('div', { class: 'field' }, [input]));
    }

    refresh();

    var copyBtn = el('button', { class: 'btn btn-primary btn-block', type: 'button',
                                 text: '요약 복사' });
    copyBtn.addEventListener('click', function () {
      var done = FitLog.share.copyText(build());
      ui.toast(done ? '복사했어. 카톡이나 메일에 붙여넣기 해.'
                    : '복사가 안 됐어. 설정에서 파일로 받아줘.');
    });

    return ui.card(title, head.concat([
      preview,
      copyBtn,
      el('p', { class: 'card-note', text: opts.hint })
    ]));
  }

  /* 시간대별 보충제 체크리스트 */
  function supplementsCard(state, day) {
    var sup = FitLog.supplements;
    var active = state.supplements.filter(function (s) { return s.enabled !== false; });

    if (!active.length) {
      return ui.card('보충제', [
        el('p', { class: 'card-note',
          text: '아직 등록한 보충제가 없어. 설정 탭에서 추가하면 여기 체크리스트가 생겨.' })
      ]);
    }

    var taken = day.supplementsTaken.length;
    var card = ui.card('보충제 ' + taken + '/' + active.length, []);
    var slots = sup.bySlot(active);

    sup.TIME_SLOTS.forEach(function (slot) {
      var here = slots[slot.key];
      if (!here.length) return;

      var passed = sup.isPassed(slot.key);
      card.appendChild(el('div', { class: 'slot-head' }, [
        el('span', { class: 'slot-label', text: slot.label }),
        passed ? el('span', { class: 'slot-passed', text: '지난 시간' }) : null
      ]));

      here.forEach(function (item) {
        card.appendChild(supplementRow(item, passed));
      });
    });

    return card;
  }

  /* 화면에 보이는 함량은 반드시 사용자가 저장한 값에서 나와야 한다.
     프리셋 라벨(preset.amount)을 그대로 쓰면, 사용자가 함량을 고쳤거나
     내가 프리셋 기본값을 바꿨을 때 표시가 실제 계산값과 어긋난다. */
  function supplementAmountText(item, preset) {
    var sup = FitLog.supplements;
    var keys = Object.keys(item.nutrients || {});

    if (!keys.length) return preset ? preset.amount : '함량 미입력';

    // 성분이 많으면(종합비타민 등) 다 늘어놓을 수 없다
    if (keys.length > 2) return '성분 ' + keys.length + '종';

    return keys.map(function (k) {
      var meta = sup.fieldMeta(k);
      return meta.label + ' ' + item.nutrients[k] + meta.unit;
    }).join(' · ');
  }

  function supplementRow(item, slotPassed) {
    var on = store.isTaken(store.todayKey(), item.id);
    var preset = item.presetId ? FitLog.supplements.getPreset(item.presetId) : null;

    // 지난 시간대인데 아직 안 먹었으면 연하게 강조한다 (재촉이 아니라 눈에 띄게만).
    var missed = slotPassed && !on;

    var btn = el('button', {
      type: 'button',
      class: 'sup-item' + (on ? ' sup-on' : '') + (missed ? ' sup-missed' : ''),
      'aria-pressed': String(on)
    }, [
      el('span', { class: 'sup-check', text: on ? '✓' : '' }),
      el('span', { class: 'sup-body' }, [
        el('span', { class: 'sup-name', text: item.name }),
        el('span', { class: 'sup-amount',
          text: supplementAmountText(item, preset) +
                (item.dailyDoses > 1 ? ' · 하루 ' + item.dailyDoses + '회' : '') })
      ])
    ]);

    btn.addEventListener('click', function () {
      store.toggleTaken(store.todayKey(), item.id);
      FitLog.router.render();
    });

    return btn;
  }

  /* 운동 기록 — 근력/유산소 버튼을 누르면 입력 폼이 펼쳐진다 */
  function workoutCard(day) {
    var card = ui.card('운동', []);
    var formSlot = el('div');

    function openForm(type) {
      ui.clear(formSlot);
      formSlot.appendChild(workoutForm(type, function () {
        FitLog.router.render();
      }));
    }

    var strengthBtn = el('button', { class: 'btn btn-block', type: 'button', text: '근력운동 기록' });
    strengthBtn.addEventListener('click', function () { openForm('strength'); });

    var cardioBtn = el('button', { class: 'btn btn-block', type: 'button', text: '유산소 기록' });
    cardioBtn.addEventListener('click', function () { openForm('cardio'); });

    card.appendChild(el('div', { class: 'field-inline' }, [strengthBtn, cardioBtn]));
    card.appendChild(formSlot);

    day.workouts.forEach(function (w) { card.appendChild(workoutRow(w)); });

    if (!day.workouts.length) {
      card.appendChild(el('p', { class: 'card-note', text: '오늘은 아직 운동 기록이 없어.' }));
    }

    return card;
  }

  function workoutForm(type, onSaved) {
    var draft = { minutes: type === 'strength' ? 60 : 30, bodyParts: [], intensity: 'moderate' };

    var minutes = el('input', { type: 'number', inputmode: 'numeric', step: '5',
                                min: '1', max: '600', value: draft.minutes });
    minutes.addEventListener('input', function () { draft.minutes = minutes.value; });

    var fields = [
      el('div', { class: 'field' }, [
        el('label', { class: 'field-label', text: '시간' }),
        el('div', { class: 'suffix' }, [minutes, el('span', { text: '분' })])
      ])
    ];

    if (type === 'strength') {
      var chips = el('div', { class: 'chips' });
      FitLog.judge.BODY_PARTS.forEach(function (part) {
        var btn = el('button', { type: 'button', class: 'chip',
                                 'aria-pressed': 'false', text: part.label });
        btn.addEventListener('click', function () {
          var at = draft.bodyParts.indexOf(part.key);
          var on = at < 0;
          if (on) draft.bodyParts.push(part.key); else draft.bodyParts.splice(at, 1);
          btn.setAttribute('aria-pressed', String(on));
        });
        chips.appendChild(btn);
      });
      fields.push(el('div', { class: 'field' }, [
        el('label', { class: 'field-label', text: '부위 (여러 개 가능)' }), chips,
        el('p', { class: 'field-hint', text: '부위를 남겨두면 빠진 부위를 알려줄 수 있어.' })
      ]));
    } else {
      var intens = el('div', { class: 'chips' });
      [{ k: 'light', l: '가볍게' }, { k: 'moderate', l: '보통' }, { k: 'hard', l: '빡세게' }]
        .forEach(function (opt) {
          var btn = el('button', { type: 'button', class: 'chip',
                                   'aria-pressed': String(opt.k === 'moderate'), text: opt.l });
          btn.addEventListener('click', function () {
            draft.intensity = opt.k;
            [].forEach.call(intens.children, function (c) {
              c.setAttribute('aria-pressed', String(c === btn));
            });
          });
          intens.appendChild(btn);
        });
      fields.push(el('div', { class: 'field' }, [
        el('label', { class: 'field-label', text: '강도' }), intens
      ]));
    }

    var saveBtn = el('button', { class: 'btn btn-primary btn-block', type: 'button', text: '저장' });
    saveBtn.addEventListener('click', function () {
      var m = Number(draft.minutes);
      if (!m || m <= 0 || m > 600) { ui.toast('시간을 1~600분 사이로 적어줘.'); return; }

      store.addWorkout(store.todayKey(), {
        type: type,
        minutes: m,
        bodyParts: draft.bodyParts,
        intensity: type === 'cardio' ? draft.intensity : null
      });
      ui.toast('운동 기록했어');
      onSaved();
    });

    fields.push(saveBtn);
    return el('div', { class: 'workout-form' }, fields);
  }

  function workoutRow(w) {
    var parts = (w.bodyParts || []).map(function (key) {
      var hit = FitLog.judge.BODY_PARTS.filter(function (p) { return p.key === key; })[0];
      return hit ? hit.label : key;
    }).join('·');

    var del = el('button', { type: 'button', class: 'meal-del',
                             'aria-label': '운동 기록 삭제', text: '✕' });
    del.addEventListener('click', function () {
      store.removeWorkout(store.todayKey(), w.id);
      ui.toast('지웠어');
      FitLog.router.render();
    });

    return el('div', { class: 'meal-item' }, [
      el('div', { class: 'meal-item-main' }, [
        el('span', { class: 'meal-label',
          text: (w.type === 'strength' ? '근력운동' : '유산소') + (parts ? ' · ' + parts : '') })
      ]),
      el('span', { class: 'meal-item-kcal', text: w.minutes + '분' }),
      del
    ]);
  }

  /* 오늘의 알림 — 오늘 기준으로 '지금 알아야 할 것' 만 담는다.
   *
   * 원래는 주간 평균 부족분과 운동 독려 문구까지 넣었는데 걷어냈다. 사용자 피드백:
   *   "일주일 평균 말고 오늘 양만 말해줘", "운동 독려는 빼줘. 필요한 정보만 받고 싶어."
   * 그래서 여기는 오늘치 숫자 + 넘거나 모자란 것만 남기고,
   * 보충제 배치 조언(칭찬·시간대 권고)은 정작 고칠 수 있는 설정 탭으로 옮겼다.
   */
  function alertsCard(state) {
    var judge = FitLog.judge;
    var report = judge.todayReport(state, store.todayKey());
    var review = FitLog.supplements.review(state.supplements, null, state.targets.micros);
    var items = [];

    // 1) 운동 — 남긴 두 가지는 모르면 손해 보는 사실이다
    judge.workoutJudgments(state).forEach(function (j) {
      items.push({ level: j.level, text: j.message });
    });

    // 2) 신체 변화 — 경고만. 칭찬은 인바디 탭 '변화 판정' 에 있다
    judge.bodyJudgments(state).forEach(function (j) {
      if (j.level === 'warn') items.push({ level: 'warn', text: j.message });
    });

    // 3) 오늘 매크로 — 넘거나 모자란 것만
    report.macros.forEach(function (m) {
      if (m.level.key === 'ok') return;
      var pct = Math.round(m.ratio * 100);
      var over = m.level.key === 'over';
      items.push({
        level: over ? 'warn' : 'info',
        text: m.name + ' — 오늘 ' + m.value + m.unit + ', 목표(' + m.target + m.unit + ')의 ' +
          pct + '%' + (over ? '. 넘었어.'
                            : '. ' + (Math.round((m.target - m.value) * 10) / 10) + m.unit + ' 모자라.')
      });
    });

    // 4) 오늘 미량영양소 — 부족·과다만. 총량과 함께 하루 필요량 대비를 항상 같이 말한다
    report.items.forEach(function (item) {
      if (item.level.key === 'over') items.push({ level: 'warn', text: judge.itemMessage(item) });
    });
    report.items.forEach(function (item) {
      if (item.level.key === 'low') items.push({ level: 'info', text: judge.itemMessage(item) });
    });

    // 5) 보충제 성분 중복 — 합계가 하루 필요량의 몇 배인지까지
    review.duplicates.forEach(function (d) { items.push({ level: 'info', text: d.message }); });

    // 6) 백업 — 독려가 아니라 '기록이 통째로 사라질 수 있다' 는 사실이다.
    //    오래됐을 때만 한 줄 띄운다.
    if (backupNeeded()) {
      var days = store.daysSinceBackup();
      items.push({
        level: 'warn',
        text: (days === null ? '아직 백업한 적이 없어.' : '백업한 지 ' + days + '일 됐어.') +
          ' 기록은 이 브라우저에만 있어서 지워지면 복구가 안 돼. 설정에서 백업 파일을 받아 둬.'
      });
    }

    if (!items.length) {
      return ui.card('오늘의 알림', [
        el('p', { class: 'card-note',
          text: report.hasMeals ? '오늘은 넘치거나 모자란 게 없어.'
                                : '식사를 기록하면 오늘 부족한 게 뭔지 알려줄게.' })
      ]);
    }

    return ui.card('오늘의 알림', items.map(function (item) {
      return el('p', { class: 'alert alert-' + item.level, text: item.text });
    }));
  }

  /* ---------- 탭 2: 주간 ---------- */

  function week() {
    var state = store.load();
    var judge = FitLog.judge;
    var today = store.todayKey();
    var wrap = el('div');

    wrap.appendChild(el('h1', { class: 'screen-title', text: '주간' }));
    wrap.appendChild(el('p', { class: 'screen-sub', text: '최근 7일 평균 기준' }));

    var wk = judge.workoutSummary(state, today, 7);
    wrap.appendChild(ui.card('주간 운동', [
      el('div', { class: 'rows' }, [
        ui.row('근력', wk.strength + ' / ' + wk.planStrength + '회'),
        ui.row('유산소', wk.cardio + ' / ' + wk.planCardio + '회'),
        ui.row('총 운동 시간', wk.minutes + '분')
      ])
    ]));

    wrap.appendChild(bodyTrendCard(state, today, 28));

    var report = judge.nutritionReport(state, today, 7);

    if (!report.loggedDays) {
      wrap.appendChild(ui.card('영양 리포트', [
        el('p', { class: 'card-note',
          text: '최근 7일에 식사 기록이 없어. 며칠 기록하면 여기에 평균이 나와.' })
      ]));
      wrap.appendChild(ui.disclaimer());
      return wrap;
    }

    var macroCard = ui.card('매크로 (하루 평균)', []);
    macroCard.appendChild(el('p', { class: 'field-hint',
      text: report.loggedDays + '일치 기록의 평균이야.' }));
    report.macros.forEach(function (m) { macroCard.appendChild(ui.nutrientBar(m)); });
    wrap.appendChild(macroCard);

    var top = judge.priority(report);
    if (top.length) {
      wrap.appendChild(ui.card('먼저 볼 것', top.slice(0, 5).map(function (item) {
        return el('p', { class: 'alert alert-' + (item.level.key === 'over' ? 'warn' : 'info'),
          text: item.level.mark + ' ' + item.name + ' — ' +
                item.value + ' / ' + item.target + item.unit +
                ' (' + Math.round(item.ratio * 100) + '%)' });
      })));
    }

    var microCard = ui.card('미량영양소 (하루 평균)', []);
    report.items.forEach(function (item) { microCard.appendChild(ui.nutrientBar(item)); });
    microCard.appendChild(el('p', { class: 'card-note',
      text: '마그네슘·비타민 E·엽산은 상한량을 보충제 유래분으로만 따져.' }));
    wrap.appendChild(microCard);

    var suggestCard = suggestionCard(state, today);
    if (suggestCard) wrap.appendChild(suggestCard);

    wrap.appendChild(summaryCard('이번 주 요약 보내기', {
      date: false,
      build: function () { return FitLog.report.weeklyText(store.load(), store.todayKey()); },
      hint: '평균·운동 달성·체중 변화와 이번 주 갭을 한 장으로 복사해. 미량영양소나 보충제는 안 들어가.'
    }));

    wrap.appendChild(ui.disclaimer());
    return wrap;
  }

  /* ---------- 부족 영양소 음식 제안 (Phase 7) ----------
   *
   * 계산은 suggest.js 가 한다. 여기는 그리기만.
   * 억지로 뭔가 추천하지 않는다 — 부족한 게 없으면 null 을 돌려 카드 자체를 안 그린다.
   */
  function suggestionCard(state, today) {
    var plan = FitLog.suggest.build(state, today, 7);
    if (!plan.show) return null;

    if (plan.kind === 'tooFewDays') {
      return ui.card('뭘 먹으면 채워질까', [
        el('p', { class: 'card-note', text: plan.message })
      ]);
    }

    var card = ui.card('뭘 먹으면 채워질까', []);

    // 보충제로 먹고 있는데도 부족한 것 — 음식 카드 위에 붙인다
    plan.notes.forEach(function (note) {
      card.appendChild(el('p', { class: 'alert alert-tip', text: note.message }));
    });

    if (plan.foods.length) {
      // '이번 주' 를 밝힌다. 최근 7일을 본 판정이라 안 밝히면 방금 생긴 일처럼 읽힌다.
      var gapNames = plan.gaps.map(function (g) {
        return FitLog.suggest.plain(g.name);
      }).join(' · ');
      card.appendChild(el('p', { class: 'field-hint',
        text: '이번 주 ' + FitLog.suggest.withParticle(gapNames, '이', '가') +
              ' 모자랐어. 1회 섭취량 기준이야.' }));

      var list = el('div', { class: 'suggest-list' });
      plan.foods.forEach(function (item) { list.appendChild(suggestRow(item)); });
      card.appendChild(list);
    }

    // 커버할 음식이 없는 것 — 부정확한 제안을 하느니 사실만 알린다
    plan.uncovered.forEach(function (note) {
      card.appendChild(el('p', { class: 'alert alert-info', text: note.message }));
    });

    // 과다는 음식을 추천하지 않고 행동 제안 한 줄만
    plan.overs.forEach(function (note) {
      card.appendChild(el('p', { class: 'alert alert-warn', text: note.message }));
    });

    return card;
  }

  function suggestRow(item) {
    var covers = item.covers.map(function (c) {
      return FitLog.suggest.plain(c.name);
    }).join(' · ');

    var fav = el('button', {
      type: 'button', class: 'btn btn-ghost suggest-btn',
      text: store.isFavorite('food', item.id) ? '즐겨찾기 됨' : '즐겨찾기 추가'
    });
    // 목록 안의 버튼은 자기 상태만 갱신한다. 전체를 다시 그리면 스크롤이 튄다.
    fav.addEventListener('click', function () {
      var on = store.toggleFavorite('food', item.id);
      fav.textContent = on ? '즐겨찾기 됨' : '즐겨찾기 추가';
      ui.toast(on ? '즐겨찾기에 넣었어' : '즐겨찾기에서 뺐어');
    });

    var log = el('button', {
      type: 'button', class: 'btn btn-primary suggest-btn', text: '오늘 기록'
    });
    log.addEventListener('click', function () {
      var food = FitLog.foods.get(item.id);
      store.addMeal(store.todayKey(), {
        type: 'snack',
        sourceKind: 'food',
        sourceId: item.id,
        label: food.name,
        portion: 1,
        items: null,
        nutrients: FitLog.foods.round(
          FitLog.foods.scale(item.id, item.serving.amount))
      });
      ui.toast(food.name + ' 기록했어');
      // 판정을 다시 계산해야 한다 — 방금 넣은 게 반영된 화면을 봐야 한다
      FitLog.router.render();
    });

    return el('div', { class: 'suggest-item' }, [
      el('div', { class: 'suggest-head' }, [
        el('span', { class: 'suggest-name', text: item.name }),
        el('span', { class: 'suggest-serving',
          text: item.serving.label + ' (' + item.serving.amount + item.serving.unit + ')' })
      ]),
      el('div', { class: 'suggest-meta', text: item.kcal + 'kcal' }),
      el('div', { class: 'suggest-covers', text: covers + ' 채움' }),
      el('div', { class: 'suggest-actions' }, [fav, log])
    ]);
  }

  /* 체중·허리둘레 라인 차트 */
  function bodyTrendCard(state, today, dayCount) {
    var logs = state.bodyLogs.filter(function (l) { return l.date <= today; });

    if (logs.length < 2) {
      return ui.card('체중 추이', [
        el('p', { class: 'card-note',
          text: '측정 기록이 2회 이상 쌓이면 그래프가 그려져. 인바디 탭에서 기록할 수 있어.' })
      ]);
    }

    var days = FitLog.judge.lastDays(today, dayCount);
    var byDate = {};
    logs.forEach(function (l) { byDate[l.date] = l; });

    function pick(field) {
      return days.map(function (d) {
        var log = byDate[d];
        return log && log[field] !== null && log[field] !== undefined ? log[field] : null;
      });
    }

    var chart = ui.lineChart({
      labels: days,
      height: 150,
      series: [
        { name: '체중 (kg)', values: pick('weight'), axis: 'left' },
        { name: '허리 (cm)', values: pick('waistCm'), axis: 'right' }
      ]
    });

    var card = ui.card('체중 추이 (' + dayCount + '일)', []);
    if (chart) card.appendChild(chart);

    var first = logs[0], last = logs[logs.length - 1];
    var diff = Math.round((last.weight - first.weight) * 10) / 10;
    card.appendChild(ui.row('기간 변화',
      first.weight + ' → ' + last.weight + 'kg (' + (diff > 0 ? '+' : '') + diff + ')'));

    return card;
  }

  /* ---------- 탭 3: 인바디 ---------- */

  function inbody() {
    var state = store.load();
    var logs = state.bodyLogs.slice().sort(function (a, b) {
      return a.date < b.date ? 1 : -1;
    });
    var wrap = el('div');

    wrap.appendChild(el('h1', { class: 'screen-title', text: '인바디' }));
    wrap.appendChild(el('p', { class: 'screen-sub', text: '체성분 측정 기록' }));

    wrap.appendChild(bodyLogForm());

    if (!logs.length) {
      wrap.appendChild(ui.card(null, [
        el('p', { class: 'card-note', text: '아직 측정 기록이 없어. 위에서 기록해 보자.' })
      ]));
      wrap.appendChild(ui.disclaimer());
      return wrap;
    }

    var latest = logs[0];
    var prev = logs[1];

    wrap.appendChild(ui.card('최근 측정 (' + latest.date + ')', [
      el('div', { class: 'rows' }, [
        changeRow('체중', latest.weight, prev && prev.weight, 'kg'),
        changeRow('골격근량', latest.skeletalMuscle, prev && prev.skeletalMuscle, 'kg'),
        changeRow('체지방률', latest.bodyFatPct, prev && prev.bodyFatPct, '%'),
        changeRow('복부지방률', latest.visceralRatio, prev && prev.visceralRatio, ''),
        changeRow('허리둘레', latest.waistCm, prev && prev.waistCm, 'cm')
      ]),
      prev ? el('p', { class: 'card-note', text: prev.date + ' 측정과 비교한 값이야.' }) : null
    ]));

    /* 골격근량 ↑ / 체지방량 ↓ 이중 축 차트 */
    var asc = logs.slice().reverse();
    var haveBody = asc.filter(function (l) {
      return l.skeletalMuscle !== null || l.bodyFatPct !== null;
    });

    if (haveBody.length >= 2) {
      var labels = asc.map(function (l) { return l.date; });
      var chart = ui.lineChart({
        labels: labels,
        height: 160,
        series: [
          { name: '골격근량 (kg)',
            values: asc.map(function (l) { return l.skeletalMuscle; }), axis: 'left' },
          { name: '체지방량 (kg)',
            values: asc.map(function (l) {
              return l.bodyFatPct === null ? null
                : Math.round(l.weight * l.bodyFatPct) / 100;
            }), axis: 'right' }
        ]
      });
      var chartCard = ui.card('체성분 추이', []);
      if (chart) chartCard.appendChild(chart);
      chartCard.appendChild(el('p', { class: 'card-note',
        text: '체지방량 = 체중 × 체지방률. 근육이 늘고 지방이 줄면 두 선이 벌어져.' }));
      wrap.appendChild(chartCard);
    }

    /* 판정 */
    var judgments = FitLog.judge.bodyJudgments(state);
    if (judgments.length) {
      wrap.appendChild(ui.card('변화 판정', judgments.map(function (j) {
        return el('p', { class: 'alert alert-' + j.level, text: j.message });
      })));
    }

    /* 기록 목록 */
    var listCard = ui.card('측정 기록 ' + logs.length + '회', []);
    logs.forEach(function (log) {
      var del = el('button', { type: 'button', class: 'meal-del',
                               'aria-label': log.date + ' 기록 삭제', text: '✕' });
      del.addEventListener('click', function () {
        if (!confirm(log.date + ' 측정 기록을 지울까?')) return;
        store.removeBodyLog(log.date);
        ui.toast('지웠어');
        FitLog.router.render();
      });

      listCard.appendChild(el('div', { class: 'meal-item' }, [
        el('div', { class: 'meal-item-main' }, [
          el('span', { class: 'meal-label', text: log.date })
        ]),
        el('span', { class: 'meal-item-kcal',
          text: log.weight + 'kg' +
                (log.bodyFatPct !== null ? ' · 체지방 ' + log.bodyFatPct + '%' : '') }),
        del
      ]));
    });
    wrap.appendChild(listCard);

    wrap.appendChild(ui.disclaimer());
    return wrap;
  }

  /* 이전 측정 대비 변화량을 같이 보여준다 */
  function changeRow(name, value, prevValue, unit) {
    if (value === null || value === undefined) return ui.row(name, '—');

    var text = value + (unit ? ' ' + unit : '');
    if (prevValue !== null && prevValue !== undefined) {
      var diff = Math.round((value - prevValue) * 10) / 10;
      if (diff !== 0) text += '  (' + (diff > 0 ? '+' : '') + diff + ')';
    }
    return ui.row(name, text);
  }

  /* 측정 기록 입력 폼 */
  function bodyLogForm() {
    var draft = { date: store.todayKey(), weight: '', skeletalMuscle: '',
                  bodyFatPct: '', visceralRatio: '', waistCm: '' };
    var errorBox = el('div');

    function field(label, key, unit, type) {
      var input = el('input', {
        type: type || 'number',
        inputmode: type ? null : 'decimal',
        step: type ? null : 'any',
        value: draft[key]
      });
      input.addEventListener('input', function () { draft[key] = input.value; });

      return el('div', { class: 'field' }, [
        el('label', { class: 'field-label', text: label }),
        unit ? el('div', { class: 'suffix' }, [input, el('span', { text: unit })]) : input
      ]);
    }

    function submit() {
      ui.clear(errorBox);
      var w = Number(draft.weight);

      if (!draft.weight || isNaN(w) || w < 30 || w > 250) {
        errorBox.appendChild(el('p', { class: 'error-text', text: '체중을 30~250kg 사이로 입력해.' }));
        return;
      }
      if (draft.bodyFatPct !== '') {
        var bf = Number(draft.bodyFatPct);
        if (isNaN(bf) || bf < 3 || bf > 70) {
          errorBox.appendChild(el('p', { class: 'error-text', text: '체지방률은 3~70% 사이로 입력해.' }));
          return;
        }
      }
      if (draft.skeletalMuscle !== '' && Number(draft.skeletalMuscle) >= w) {
        errorBox.appendChild(el('p', { class: 'error-text', text: '골격근량이 체중보다 클 순 없어.' }));
        return;
      }

      store.saveBodyLog(draft);
      ui.toast('기록했어. 목표치도 새 체중으로 다시 계산했어.');
      FitLog.router.render();
    }

    return ui.card('측정 기록하기', [
      field('날짜', 'date', null, 'date'),
      el('div', { class: 'field-inline' }, [
        field('체중', 'weight', 'kg'),
        field('골격근량', 'skeletalMuscle', 'kg')
      ]),
      el('div', { class: 'field-inline' }, [
        field('체지방률', 'bodyFatPct', '%'),
        field('복부지방률', 'visceralRatio', '')
      ]),
      field('허리둘레', 'waistCm', 'cm'),
      el('p', { class: 'field-hint', text: '체중만 있어도 돼. 같은 날짜에 또 넣으면 덮어써.' }),
      errorBox,
      el('button', { class: 'btn btn-primary btn-block', type: 'button',
                     text: '저장', onclick: submit })
    ]);
  }

  /* 섭취 / 목표 한 칸. 목표를 넘으면 색으로 표시한다. */
  function macroCell(name, value, target, unit) {
    var over = target > 0 && value > target;
    return el('div', { class: 'macro-cell' + (over ? ' macro-over' : '') }, [
      el('span', { class: 'macro-name', text: name }),
      el('span', { class: 'macro-val', text: value + ' / ' + target + unit })
    ]);
  }

  /* 끼니별 기록 카드 — 각 끼니에 + 버튼이 붙어 선택 시트를 연다. */
  function mealsCard(day) {
    var card = ui.card('식사', []);

    MEAL_TYPES.forEach(function (type) {
      var meals = day.meals.filter(function (m) { return m.type === type.key; });
      var kcal = Math.round(meals.reduce(function (sum, m) {
        return sum + (Number(m.nutrients.kcal) || 0);
      }, 0));

      var addBtn = el('button', {
        type: 'button', class: 'meal-add',
        'aria-label': type.label + ' 기록 추가', text: '＋'
      });
      addBtn.addEventListener('click', function () {
        FitLog.sheet.open(type.key, function () { FitLog.router.render(); });
      });

      card.appendChild(el('div', { class: 'meal-head' }, [
        el('span', { class: 'meal-type', text: type.label }),
        el('span', { class: 'meal-kcal', text: meals.length ? kcal + 'kcal' : '기록 없음' }),
        addBtn
      ]));

      meals.forEach(function (meal) { card.appendChild(mealRow(meal)); });
    });

    return card;
  }

  function mealRow(meal) {
    var portion = FitLog.templates.PORTIONS.filter(function (p) {
      return p.value === meal.portion;
    })[0];

    var del = el('button', {
      type: 'button', class: 'meal-del',
      'aria-label': meal.label + ' 삭제', text: '✕'
    });
    del.addEventListener('click', function () {
      store.removeMeal(store.todayKey(), meal.id);
      ui.toast('지웠어');
      FitLog.router.render();
    });

    return el('div', { class: 'meal-item' }, [
      el('div', { class: 'meal-item-main' }, [
        el('span', { class: 'meal-label', text: meal.label }),
        portion && portion.value !== 1
          ? el('span', { class: 'meal-portion', text: portion.label })
          : null
      ]),
      el('span', { class: 'meal-item-kcal',
        text: Math.round(meal.nutrients.kcal || 0) + 'kcal · 단백질 ' +
              (Math.round((meal.nutrients.protein || 0) * 10) / 10) + 'g' }),
      del
    ]);
  }

  function fmt(v, unit) {
    if (v === null || v === undefined || v === '') return '—';
    return v + (unit ? ' ' + unit : '');
  }

  /* ---------- 탭 4: 설정 ---------- */

  function settings() {
    var state = store.load();
    var p = state.profile;
    var t = state.targets;
    var wrap = el('div');

    wrap.appendChild(el('h1', { class: 'screen-title', text: '설정' }));
    wrap.appendChild(el('p', { class: 'screen-sub', text: '프로필이랑 데이터를 관리해.' }));

    /* 현재 목표치 */
    wrap.appendChild(ui.card('현재 하루 목표', [
      el('div', { class: 'rows' }, [
        ui.row('칼로리', t.calories + ' kcal'),
        ui.row('단백질', t.protein + ' g'),
        ui.row('탄수화물', t.carbs + ' g'),
        ui.row('지방', t.fat + ' g'),
        ui.row('식이섬유', t.fiber + ' g'),
        ui.row('목표', t.meta.goalLabel),
        ui.row('기초대사량', t.meta.bmr + ' kcal (' + t.meta.bmrMethod + ')'),
        ui.row('총소비열량', t.meta.tdee + ' kcal (활동계수 ×' + t.meta.activityFactor + ')')
      ])
    ]));

    /* 프로필 수정 */
    wrap.appendChild(profileCard(p));

    /* 보충제 */
    wrap.appendChild(supplementManageCard(state));

    /* 데이터 — 용도가 다른 두 가지를 섞어 두면 친구들이 헷갈린다. 나눠서 설명한다. */
    // 표마다 두 갈래를 준다: 파일로 받기 / 복사해서 바로 붙여넣기.
    // 폰에서 파일 주고받기가 성가실 때 복사가 더 빠르다.
    var csvRows = FitLog.csv.SHEETS.map(function (sheet) {
      var fileBtn = el('button', { class: 'btn', type: 'button', text: '파일로 받기' });
      fileBtn.addEventListener('click', function () {
        FitLog.csv.exportSheet(sheet.key, function (how) {
          if (how === 'cancelled') return;
          ui.toast(how === 'share'
            ? '공유 창에서 "파일에 저장" 을 고르면 돼.'
            : sheet.label + ' 파일 저장했어.');
        });
      });

      var copyBtn = el('button', { class: 'btn', type: 'button', text: '복사' });
      copyBtn.addEventListener('click', function () {
        var text = sheet.build(store.load());
        var done = FitLog.share.copyText(text);
        ui.toast(done
          ? sheet.label + ' 복사했어. 카톡·메일·구글시트에 붙여넣기 해.'
          : '복사가 안 됐어. 파일로 받기를 써줘.');
      });

      return el('div', { class: 'sheet-row' }, [
        el('span', { class: 'sheet-name', text: sheet.label }),
        fileBtn, copyBtn
      ]);
    });

    wrap.appendChild(ui.card('엑셀로 보기 (CSV)', [
      el('p', { class: 'card-note',
        text: '엑셀·구글시트에서 열리는 표야. 기록을 훑어보거나 트레이너에게 보낼 때 써.' }),
      el('div', {}, csvRows),
      el('p', { class: 'card-note',
        text: '"파일로 받기" 는 공유 창이 뜨는데, 앱 목록에 낯선 게 섞여 나와도 정상이야. ' +
              '거기서 "파일에 저장" 을 고르면 파일 앱에 들어가. ' +
              '그게 번거로우면 "복사" 를 눌러서 카톡이나 구글시트에 바로 붙여넣어도 돼. ' +
              '사람이 읽기 좋은 요약은 오늘 탭·주간 탭 아래쪽에 따로 있어.' })
    ]));

    wrap.appendChild(ui.card('백업 (기기 변경용)', [
      el('div', { class: 'btn-stack' }, [
        el('button', {
          class: 'btn btn-block', type: 'button', text: '백업 파일 내보내기',
          onclick: function () {
            FitLog.backup.exportData();
            ui.toast('백업 파일 저장했어.');
          }
        }),
        el('button', {
          class: 'btn btn-block', type: 'button', text: '백업 파일 불러오기',
          onclick: openImport
        }),
        el('button', {
          class: 'btn btn-block btn-danger', type: 'button', text: '전체 초기화',
          onclick: resetAll
        })
      ]),
      backupStatusNote(),
      el('p', { class: 'card-note',
        text: '폰을 바꾸거나 주소가 달라질 때 쓰는 파일이야. 열어볼 필요 없고, ' +
              '새 기기에서 불러오기만 하면 기록이 그대로 옮겨져. ' +
              '위의 CSV 는 보기용이라 되돌릴 수 없으니 이건 따로 챙겨둬.' })
    ]));

    /* 앱 정보 */
    wrap.appendChild(ui.card('앱 정보', [
      el('div', { class: 'rows' }, [
        ui.row('데이터 형식', 'v' + store.SCHEMA_VERSION),
        ui.row('빌드', FitLog.app.BUILD),
        ui.row('영구 저장', FitLog.app.storageStatusText()),
        ui.row('마지막 백업', backupAgeText()),
        ui.row('시작한 날', p.createdAt)
      ]),
      el('p', { class: 'card-note',
        text: '영양성분은 일반적인 조리 기준 추정치라 실제랑 차이가 있을 수 있어.' })
    ]));

    wrap.appendChild(ui.disclaimer());
    return wrap;
  }

  /* 프로필 수정 카드 — 저장 시 목표치를 다시 계산하고 변경 내역을 안내한다. */
  function profileCard(p) {
    var draft = {
      height: p.height, age: p.age, sex: p.sex, weight: p.weight,
      skeletalMuscle: p.skeletalMuscle === null ? '' : p.skeletalMuscle,
      bodyFatPct: p.bodyFatPct === null ? '' : p.bodyFatPct,
      goals: calc.normalizeGoals(p.goals),
      weeklyPlan: { strength: p.weeklyPlan.strength, cardio: p.weeklyPlan.cardio },
      menopause: p.menopause === undefined ? null : p.menopause
    };

    var errorBox = el('div');

    function num(key, unit, stepAttr) {
      var input = el('input', {
        type: 'number', inputmode: 'decimal', step: stepAttr || 'any', value: draft[key]
      });
      input.addEventListener('input', function () { draft[key] = input.value; });
      return el('div', { class: 'suffix' }, [input, el('span', { text: unit })]);
    }

    function labeled(label, node) {
      return el('div', { class: 'field' }, [
        el('label', { class: 'field-label', text: label }), node
      ]);
    }

    function chips(options, current, onPick) {
      var group = el('div', { class: 'chips' });
      var buttons = [];
      options.forEach(function (opt) {
        var btn = el('button', {
          type: 'button', class: 'chip',
          'aria-pressed': String(current === opt.value), text: opt.label
        });
        btn.addEventListener('click', function () {
          buttons.forEach(function (b) { b.setAttribute('aria-pressed', String(b === btn)); });
          onPick(opt.value);
        });
        buttons.push(btn);
        group.appendChild(btn);
      });
      return group;
    }

    function counter(label, key) {
      var val = el('span', { class: 'counter-val', text: draft.weeklyPlan[key] + '회' });
      function bump(d) {
        draft.weeklyPlan[key] = Math.max(0, Math.min(14, Number(draft.weeklyPlan[key]) + d));
        val.textContent = draft.weeklyPlan[key] + '회';
      }
      return labeled(label, el('div', { class: 'counter' }, [
        el('button', { type: 'button', class: 'counter-btn', text: '−',
                       'aria-label': label + ' 줄이기', onclick: function () { bump(-1); } }),
        val,
        el('button', { type: 'button', class: 'counter-btn', text: '+',
                       'aria-label': label + ' 늘리기', onclick: function () { bump(1); } })
      ]));
    }

    function save() {
      ui.clear(errorBox);
      var errors = calc.validateProfile(draft);
      var keys = Object.keys(errors);
      if (keys.length) {
        keys.forEach(function (k) {
          errorBox.appendChild(el('p', { class: 'error-text', text: errors[k] }));
        });
        return;
      }

      var before = store.load().targets;

      var next = {
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
        createdAt: p.createdAt
      };
      if (next.sex === 'female' && next.age >= 45) next.menopause = draft.menopause;

      var targets = calc.computeTargets(next);

      store.update(function (state) {
        state.profile = next;
        state.targets = targets;
        return state;
      });

      var dKcal = targets.calories - before.calories;
      var dProtein = targets.protein - before.protein;
      ui.toast('저장했어. 칼로리 ' + signed(dKcal) + 'kcal, 단백질 ' + signed(dProtein) + 'g');

      FitLog.router.render();
    }

    return ui.card('프로필', [
      labeled('키', num('height', 'cm', '0.1')),
      labeled('나이', num('age', '세', '1')),
      labeled('성별', chips(
        [{ label: '여성', value: 'female' }, { label: '남성', value: 'male' }],
        draft.sex, function (v) { draft.sex = v; })),
      labeled('체중', num('weight', 'kg', '0.1')),
      labeled('골격근량 (선택)', num('skeletalMuscle', 'kg', '0.1')),
      labeled('체지방률 (선택)', num('bodyFatPct', '%', '0.1')),
      labeled('목표 (여러 개 고를 수 있어)',
        ui.goalChips(draft.goals, function (goals) { draft.goals = goals; })),
      counter('주간 근력운동 계획', 'strength'),
      counter('주간 유산소 계획', 'cardio'),
      errorBox,
      el('button', { class: 'btn btn-primary btn-block', type: 'button',
                     text: '저장하고 목표 다시 계산', onclick: save })
    ]);
  }

  function signed(n) { return (n > 0 ? '+' : '') + n; }

  /* 백업 노출도 — localStorage 는 영구 저장이 아니라서 이게 유일한 확실한 대비다 */
  var BACKUP_STALE_DAYS = 14;

  function backupAgeText() {
    var days = store.daysSinceBackup();
    if (days === null) return '한 번도 안 함';
    if (days === 0) return '오늘';
    return days + '일 전';
  }

  function backupNeeded() {
    var days = store.daysSinceBackup();
    var recorded = store.recordedDayCount();
    if (recorded < 3) return false;                 // 잃을 게 별로 없으면 재촉하지 않는다
    if (days === null) return true;
    return days >= BACKUP_STALE_DAYS;
  }

  function backupStatusNote() {
    var days = store.daysSinceBackup();

    if (!backupNeeded()) {
      return el('p', { class: 'card-note',
        text: '마지막 백업: ' + backupAgeText() +
              ' · 기록된 날: ' + store.recordedDayCount() + '일' });
    }

    return el('p', { class: 'alert alert-warn',
      text: (days === null
        ? '아직 백업한 적이 없어. '
        : '백업한 지 ' + days + '일 됐어. ') +
        '브라우저 기록을 지우거나 한동안 앱을 안 열면 기록이 사라질 수 있어. ' +
        '지금 백업 파일을 받아서 파일 앱이나 메일에 저장해 둬.' });
  }

  /* 보충제 등록·수정·삭제·일시중지 */
  function supplementManageCard(state) {
    var sup = FitLog.supplements;
    var card = ui.card('보충제', []);

    /* 자주 쓰는 것 고르기 — 종류별로 묶어서 보여준다 */
    var select = el('select', { 'aria-label': '추가할 보충제 선택' });
    select.appendChild(el('option', { value: '', text: '자주 쓰는 것에서 고르기…' }));

    sup.PRESET_GROUPS.forEach(function (group) {
      var inGroup = sup.PRESETS.filter(function (p) { return p.group === group.key; });
      if (!inGroup.length) return;

      var box = el('optgroup', { label: group.label });
      inGroup.forEach(function (preset) {
        var already = state.supplements.some(function (s) { return s.presetId === preset.id; });
        box.appendChild(el('option', {
          value: preset.id,
          text: preset.name + ' (' + preset.amount + ')' + (already ? ' — 등록됨' : '')
        }));
      });
      select.appendChild(box);
    });

    var addBtn = el('button', { class: 'btn btn-primary', type: 'button', text: '추가' });
    addBtn.addEventListener('click', function () {
      if (!select.value) { ui.toast('먼저 보충제를 골라줘.'); return; }
      var item = sup.fromPreset(select.value);
      store.addSupplement(item);
      ui.toast(item.name + ' 추가했어.');
      FitLog.router.render();
    });

    card.appendChild(el('div', { class: 'field-inline' }, [select, addBtn]));

    // 함량 주의가 필요한 것(오메가3·마그네슘)은 고르는 순간 알려준다.
    // 등록한 뒤 펼쳐야만 보이면 이미 잘못된 값으로 넣은 다음이다.
    var noteSlot = el('div');
    card.appendChild(noteSlot);

    select.addEventListener('change', function () {
      ui.clear(noteSlot);
      var picked = select.value ? sup.getPreset(select.value) : null;
      if (picked && picked.note) {
        noteSlot.appendChild(el('p', { class: 'notice notice-warn', text: picked.note }));
      }
    });

    /* 목록에 없으면 직접 등록 — 이게 없으면 이 목록이 곧 '먹을 수 있는 것의 전부'가 된다 */
    var formSlot = el('div');
    var openBtn = el('button', { class: 'btn btn-block', type: 'button',
                                 text: '목록에 없어? 직접 등록하기' });
    openBtn.addEventListener('click', function () {
      if (formSlot.firstChild) { ui.clear(formSlot); openBtn.textContent = '목록에 없어? 직접 등록하기'; return; }
      formSlot.appendChild(customSupplementForm());
      openBtn.textContent = '직접 등록 닫기';
    });
    card.appendChild(openBtn);
    card.appendChild(formSlot);

    /* 배치 조언 — 시간대를 고칠 수 있는 이 자리에 둔다 (오늘 탭에서는 뺐다) */
    var advice = sup.interactions(state.supplements);
    if (advice.length) {
      advice.forEach(function (a) {
        card.appendChild(el('p', { class: 'alert alert-' + a.level, text: a.message }));
      });
    }

    /* 등록된 목록 */
    if (!state.supplements.length) {
      card.appendChild(el('p', { class: 'card-note',
        text: '등록한 보충제가 없어. 위에서 골라 추가해줘.' }));
      return card;
    }

    state.supplements.forEach(function (item) {
      card.appendChild(supplementEditRow(item));
    });

    return card;
  }

  /* 프리셋에 없는 보충제를 직접 등록한다 */
  function customSupplementForm() {
    var sup = FitLog.supplements;
    var draft = { name: '', timeSlot: 'morning', dailyDoses: 1 };
    var errorBox = el('div');

    var nameInput = el('input', { type: 'text', placeholder: '' });
    nameInput.addEventListener('input', function () { draft.name = nameInput.value; });

    var slotSelect = el('select', { 'aria-label': '시간대' });
    sup.TIME_SLOTS.forEach(function (slot) {
      slotSelect.appendChild(el('option', { value: slot.key, text: slot.label }));
    });
    slotSelect.addEventListener('change', function () { draft.timeSlot = slotSelect.value; });

    var doseInput = el('input', { type: 'number', inputmode: 'numeric', step: '1',
                                  min: '1', max: '6', value: '1' });
    doseInput.addEventListener('input', function () { draft.dailyDoses = doseInput.value; });

    function submit() {
      ui.clear(errorBox);
      var name = String(draft.name).trim();
      if (!name) {
        errorBox.appendChild(el('p', { class: 'error-text', text: '이름을 적어줘.' }));
        return;
      }

      store.addSupplement({
        name: name,
        presetId: null,
        timeSlot: draft.timeSlot,
        dailyDoses: Math.max(1, Math.min(6, Number(draft.dailyDoses) || 1)),
        nutrients: {},
        enabled: true
      });

      ui.toast('"' + name + '" 등록했어. 성분은 아래에서 추가할 수 있어.');
      FitLog.router.render();
    }

    return el('div', { class: 'custom-sup' }, [
      el('p', { class: 'field-hint',
        text: '제품 이름과 먹는 시간만 있으면 돼. 성분 함량은 등록한 다음 목록에서 넣을 수 있어.' }),
      el('div', { class: 'field' }, [
        el('label', { class: 'field-label', text: '이름' }), nameInput
      ]),
      el('div', { class: 'field-inline' }, [
        el('div', { class: 'field' }, [
          el('label', { class: 'field-label', text: '시간대' }), slotSelect
        ]),
        el('div', { class: 'field' }, [
          el('label', { class: 'field-label', text: '하루 횟수' }), doseInput
        ])
      ]),
      errorBox,
      el('button', { class: 'btn btn-primary btn-block', type: 'button',
                     text: '등록하기', onclick: submit })
    ]);
  }

  /* 보충제에 성분을 새로 추가한다 (프리셋에 없던 성분이나, 직접 등록한 제품용) */
  function addNutrientControl(item) {
    var sup = FitLog.supplements;
    var existing = Object.keys(item.nutrients || {});

    var pick = el('select', { 'aria-label': '추가할 성분' });
    pick.appendChild(el('option', { value: '', text: '성분 고르기…' }));
    sup.nutrientFields().forEach(function (field) {
      if (existing.indexOf(field.key) >= 0) return;
      pick.appendChild(el('option', { value: field.key,
                                      text: field.label + ' (' + field.unit + ')' }));
    });

    var amount = el('input', { type: 'number', inputmode: 'decimal', step: 'any',
                               'aria-label': '함량' });

    var btn = el('button', { class: 'btn', type: 'button', text: '성분 추가' });
    btn.addEventListener('click', function () {
      if (!pick.value) { ui.toast('성분을 골라줘.'); return; }
      var v = Number(amount.value);
      if (!amount.value || isNaN(v) || v <= 0) { ui.toast('함량을 숫자로 적어줘.'); return; }

      var patch = {};
      existing.forEach(function (k) { patch[k] = item.nutrients[k]; });
      patch[pick.value] = v;

      store.updateSupplement(item.id, { nutrients: patch });
      FitLog.router.render();
    });

    return el('div', { class: 'field' }, [
      el('label', { class: 'field-label', text: '성분 추가' }),
      el('div', { class: 'field-inline' }, [pick, amount]),
      btn
    ]);
  }

  function supplementEditRow(item) {
    var sup = FitLog.supplements;
    var preset = item.presetId ? sup.getPreset(item.presetId) : null;
    var open = false;

    var body = el('div', { class: 'sup-edit-body', hidden: true });

    var head = el('button', { type: 'button', class: 'sup-edit-head' }, [
      el('span', { class: 'sup-edit-name' + (item.enabled === false ? ' sup-off' : ''),
                   text: item.name + (item.enabled === false ? ' (중지됨)' : '') }),
      el('span', { class: 'sup-edit-slot',
                   text: sup.SLOT_BY_KEY[item.timeSlot].label })
    ]);
    head.addEventListener('click', function () {
      open = !open;
      body.hidden = !open;
    });

    /* 시간대 */
    var slotSelect = el('select', { 'aria-label': item.name + ' 시간대' });
    sup.TIME_SLOTS.forEach(function (slot) {
      slotSelect.appendChild(el('option', {
        value: slot.key, text: slot.label, selected: slot.key === item.timeSlot
      }));
    });
    slotSelect.addEventListener('change', function () {
      store.updateSupplement(item.id, { timeSlot: slotSelect.value });
      FitLog.router.render();
    });
    body.appendChild(el('div', { class: 'field' }, [
      el('label', { class: 'field-label', text: '시간대' }), slotSelect
    ]));

    /* 하루 횟수 */
    var doses = el('input', { type: 'number', inputmode: 'numeric', step: '1',
                              min: '1', max: '6', value: item.dailyDoses });
    doses.addEventListener('change', function () {
      var v = Math.max(1, Math.min(6, Number(doses.value) || 1));
      doses.value = v;
      store.updateSupplement(item.id, { dailyDoses: v });
      FitLog.router.render();
    });
    body.appendChild(el('div', { class: 'field' }, [
      el('label', { class: 'field-label', text: '하루 횟수' }), doses
    ]));

    /* 함량 수정 — 제품마다 다르니까 고칠 수 있어야 한다 */
    var keys = Object.keys(item.nutrients || {});

    if (keys.length) {
      body.appendChild(el('p', { class: 'field-hint', text: '제품 표기 함량에 맞게 고쳐도 돼.' }));

      keys.forEach(function (key) {
        var meta = sup.fieldMeta(key);

        var input = el('input', { type: 'number', inputmode: 'decimal', step: 'any',
                                  value: item.nutrients[key], 'aria-label': meta.label });
        input.addEventListener('change', function () {
          var patch = {};
          keys.forEach(function (k) { patch[k] = item.nutrients[k]; });
          patch[key] = Number(input.value) || 0;
          store.updateSupplement(item.id, { nutrients: patch });
          FitLog.router.render();
        });

        var drop = el('button', { type: 'button', class: 'nut-del',
                                  'aria-label': meta.label + ' 성분 빼기', text: '✕' });
        drop.addEventListener('click', function () {
          var patch = {};
          keys.forEach(function (k) { if (k !== key) patch[k] = item.nutrients[k]; });
          store.updateSupplement(item.id, { nutrients: patch });
          FitLog.router.render();
        });

        body.appendChild(el('div', { class: 'nut-row' }, [
          el('span', { class: 'nut-label', text: meta.label + ' (' + meta.unit + ')' }),
          input, drop
        ]));
      });
    } else {
      body.appendChild(el('p', { class: 'field-hint',
        text: '아직 성분이 없어. 아래에서 추가하면 하루 합계와 상한량 판정에 반영돼.' }));
    }

    body.appendChild(addNutrientControl(item));

    if (preset && preset.note) {
      body.appendChild(el('p', { class: 'notice notice-warn', text: preset.note }));
    }

    /* 일시중지 / 삭제 */
    var toggleBtn = el('button', {
      class: 'btn', type: 'button',
      text: item.enabled === false ? '다시 사용' : '일시중지'
    });
    toggleBtn.addEventListener('click', function () {
      store.updateSupplement(item.id, { enabled: item.enabled === false });
      FitLog.router.render();
    });

    var delBtn = el('button', { class: 'btn btn-danger', type: 'button', text: '삭제' });
    delBtn.addEventListener('click', function () {
      if (!confirm(item.name + '을 지울까? 지난 기록의 체크 표시도 같이 지워져.')) return;
      store.removeSupplement(item.id);
      ui.toast('지웠어');
      FitLog.router.render();
    });

    body.appendChild(el('div', { class: 'field-inline' }, [toggleBtn, delBtn]));

    return el('div', { class: 'sup-edit' }, [head, body]);
  }

  /* ---------- 데이터 불러오기 / 초기화 ---------- */

  function openImport() {
    var input = document.getElementById('importFile');
    input.value = '';
    input.onchange = function () {
      var file = input.files && input.files[0];
      if (!file) return;
      if (!confirm('불러오면 지금 이 기기의 기록이 백업 파일 내용으로 바뀌어. 계속할까?')) return;

      FitLog.backup.importFile(file, function (err) {
        if (err) { ui.toast('못 불러왔어: ' + err.message); return; }
        ui.toast('불러왔어.');
        FitLog.app.boot();
      });
    };
    input.click();
  }

  function resetAll() {
    if (!confirm('모든 기록을 지워. 되돌릴 수 없어. 계속할까?')) return;
    if (!confirm('정말 지울까? 먼저 데이터를 내보내 두는 걸 권해.')) return;
    store.reset();
    FitLog.app.boot();
  }

  FitLog.views = { today: today, week: week, inbody: inbody, settings: settings };
})(window.FitLog);
