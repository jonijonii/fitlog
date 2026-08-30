/* judge.js — 판정 엔진 (영양 4단계 · 운동 · 신체 변화)
 *
 * 순수 계산만 한다. DOM 을 건드리지 않으므로 콘솔에서 단독 검증할 수 있다.
 *
 * 일간 수치는 하루하루 편차가 커서 그대로 보면 오해를 부른다.
 * 그래서 메인 리포트는 전부 '주간 평균' 기준이다.
 */

window.FitLog = window.FitLog || {};

(function (FitLog) {
  'use strict';

  /* ---------- 영양 4단계 ---------- */

  var LEVELS = {
    low:    { key: 'low',    label: '부족',      mark: '🔴', rank: 0 },
    midLow: { key: 'midLow', label: '약간 부족',  mark: '🟡', rank: 1 },
    ok:     { key: 'ok',     label: '적정',      mark: '🟢', rank: 2 },
    over:   { key: 'over',   label: '과다',      mark: '🟠', rank: 3 }
  };

  /**
   * 섭취량을 4단계로 나눈다.
   *
   * 미량영양소와 매크로는 '과다' 의 뜻이 다르다:
   *   - 미량영양소는 권장량을 좀 넘어도 문제가 아니고, 진짜 경계선은 상한섭취량(UL)이다.
   *     110~UL 구간을 과다로 부르면 매일 거짓 경고가 뜬다. → ul 로 판정한다.
   *   - 매크로(칼로리·지방 등)는 UL 이라는 개념이 없고 초과 자체가 문제다. → overRatio 로 판정한다.
   *
   * 또 하나: 부족 판정과 상한 판정은 서로 다른 값을 본다.
   * 마그네슘·비타민E·엽산은 상한을 보충제 유래분으로만 따지지만,
   * 부족한지는 음식까지 합친 총량으로 봐야 한다. 그래서 ulValue 를 따로 받는다.
   *
   * @param {number} value 총 섭취량 (부족 판정에 쓴다)
   * @param {number} target 권장량
   * @param {{ul?:number, ulValue?:number, overRatio?:number}} opts
   */
  function levelOf(value, target, opts) {
    var o = opts || {};
    var v = Number(value) || 0;
    var t = Number(target) || 0;

    var ulValue = o.ulValue === undefined || o.ulValue === null ? v : Number(o.ulValue);
    if (o.ul && ulValue > o.ul) return LEVELS.over;

    if (!t) return LEVELS.ok;

    var ratio = v / t;
    if (ratio < 0.7) return LEVELS.low;
    if (ratio < 0.9) return LEVELS.midLow;
    if (o.overRatio && ratio > o.overRatio) return LEVELS.over;
    return LEVELS.ok;
  }

  // 매크로에서 이 배수를 넘으면 과다로 본다 (스펙의 '적정 90~110%').
  var MACRO_OVER = 1.1;

  /* ---------- 날짜 유틸 ---------- */

  function shiftDays(dateKey, delta) {
    var parts = dateKey.split('-');
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    d.setDate(d.getDate() + delta);
    return FitLog.store.todayKey(d);
  }

  /** endDateKey 를 마지막 날로 하는 연속 날짜 목록 (과거 → 최근) */
  function lastDays(endDateKey, count) {
    var out = [];
    for (var i = count - 1; i >= 0; i--) out.push(shiftDays(endDateKey, -i));
    return out;
  }

  /* ---------- 주간 영양 리포트 ---------- */

  /**
   * 기록이 있는 날만 평균을 낸다.
   * 기록이 없는 날은 '안 먹은 날' 이 아니라 '안 적은 날' 이라서,
   * 0 으로 넣고 평균을 내면 실제보다 훨씬 부족하게 나온다.
   */
  function nutritionReport(state, endDateKey, dayCount) {
    var days = lastDays(endDateKey || FitLog.store.todayKey(), dayCount || 7);
    var targets = state.targets;

    var logged = [];
    days.forEach(function (key) {
      var log = state.dailyLogs[key];
      if (log && log.meals.length) logged.push(key);
    });

    if (!logged.length) {
      return { days: days, loggedDays: 0, items: [], macros: [], avg: null };
    }

    // 하루치 합계를 모아 평균낸다.
    var sums = FitLog.foods.sum(logged.map(function (key) {
      return FitLog.foods.sum(state.dailyLogs[key].meals.map(function (m) {
        return m.nutrients;
      }));
    }));

    // 보충제도 날마다 다르다 — 그날 체크한 것만 세서 같이 평균낸다.
    // 하루분을 그대로 더하면 한 번도 안 먹은 주에도 매일 먹은 것으로 잡힌다.
    var suppSums = FitLog.foods.sum(logged.map(function (key) {
      return FitLog.supplements.dailyNutrients(
        state.supplements, state.dailyLogs[key].supplementsTaken);
    }));

    var avg = {};
    Object.keys(sums).forEach(function (k) { avg[k] = sums[k] / logged.length; });

    var supp = {};
    Object.keys(suppSums).forEach(function (k) { supp[k] = suppSums[k] / logged.length; });

    // 단백질은 보충제(유청·콜라겐)에서도 오므로 매크로에 더해 준다.
    var avgWithSupp = {};
    Object.keys(avg).forEach(function (k) {
      avgWithSupp[k] = avg[k] + (Number(supp[k]) || 0);
    });
    avgWithSupp.protein = avg.protein + (Number(supp.protein) || 0);

    var macros = [
      { key: 'kcal', name: '칼로리', unit: 'kcal', value: avgWithSupp.kcal, target: targets.calories },
      { key: 'protein', name: '단백질', unit: 'g', value: avgWithSupp.protein, target: targets.protein },
      { key: 'carbs', name: '탄수화물', unit: 'g', value: avgWithSupp.carbs, target: targets.carbs },
      { key: 'fat', name: '지방', unit: 'g', value: avgWithSupp.fat, target: targets.fat },
      { key: 'fiber', name: '식이섬유', unit: 'g', value: avgWithSupp.fiber, target: targets.fiber }
    ].map(function (m) {
      m.value = Math.round(m.value * 10) / 10;
      m.ratio = m.target ? m.value / m.target : 0;
      m.level = levelOf(m.value, m.target, { overRatio: MACRO_OVER });
      return m;
    });

    var items = FitLog.nutrition.NUTRIENTS.map(function (n) {
      // 마그네슘·비타민E·엽산은 UL 을 보충제 유래분으로만 따진다.
      var forUL = n.ulSource === 'supplement' ? (Number(supp[n.key]) || 0) : avgWithSupp[n.key];
      var target = targets.micros[n.key];
      var value = Math.round(avgWithSupp[n.key] * 10) / 10;

      return {
        key: n.key,
        name: n.name,
        unit: n.unit,
        value: value,
        target: target,
        ratio: target ? value / target : 0,
        // 부족 판정은 총량으로, 상한 판정은 forUL 로 — 둘은 다른 값이다.
        level: levelOf(value, target, { ul: n.ul, ulValue: forUL }),
        fromSupplement: Math.round((Number(supp[n.key]) || 0) * 10) / 10
      };
    });

    return { days: days, loggedDays: logged.length, avg: avgWithSupp, macros: macros, items: items };
  }

  /**
   * 우선순위 정렬: 단백질 → 식이섬유 → 부족한 미량영양소 → 과다.
   * 리포트에서 '먼저 봐야 할 것' 순서다.
   */
  function priority(report) {
    var out = [];
    if (!report.macros.length) return out;

    function macro(key) {
      return report.macros.filter(function (m) { return m.key === key; })[0];
    }

    var protein = macro('protein');
    if (protein && protein.level.rank < LEVELS.ok.rank) out.push(protein);

    var fiber = macro('fiber');
    if (fiber && fiber.level.rank < LEVELS.ok.rank) out.push(fiber);

    report.items.forEach(function (item) {
      if (item.level.key === 'low') out.push(item);
    });
    report.items.forEach(function (item) {
      if (item.level.key === 'over') out.push(item);
    });

    return out;
  }

  /**
   * 오늘 하루치 리포트.
   *
   * 주간 평균은 '요즘 어떤가' 를 보는 것이고, 오늘 화면에서 알고 싶은 건
   * '지금 뭐가 모자라고 뭐가 넘쳤나' 다. 그래서 오늘 카드는 이 함수를 쓴다.
   *
   * 보충제는 **그날 체크한 것만** 합산한다. 아침에는 아직 아무것도 체크가 안 돼 있어서
   * 보충제로 채우는 영양소가 부족으로 뜬다 — 의도한 동작이다.
   * 체크를 안 했으면 안 먹은 것이고, 실제로 깜빡했을 수도 있다.
   */
  function todayReport(state, dateKey) {
    var key = dateKey || FitLog.store.todayKey();
    var day = FitLog.store.getDay(key);
    var targets = state.targets;

    var food = FitLog.foods.sum(day.meals.map(function (m) { return m.nutrients; }));
    // 그날 체크한 보충제만 센다. 등록만 해둔 것은 안 먹은 것으로 본다.
    var supp = FitLog.supplements.dailyNutrients(state.supplements, day.supplementsTaken);

    var total = {};
    FitLog.foods.KEYS.forEach(function (k) {
      total[k] = (Number(food[k]) || 0) + (Number(supp[k]) || 0);
    });
    total.protein = (Number(food.protein) || 0) + (Number(supp.protein) || 0);

    var macros = [
      { key: 'kcal', name: '칼로리', unit: 'kcal', target: targets.calories },
      { key: 'protein', name: '단백질', unit: 'g', target: targets.protein },
      { key: 'carbs', name: '탄수화물', unit: 'g', target: targets.carbs },
      { key: 'fat', name: '지방', unit: 'g', target: targets.fat },
      { key: 'fiber', name: '식이섬유', unit: 'g', target: targets.fiber }
    ].map(function (m) {
      m.value = Math.round((total[m.key] || 0) * 10) / 10;
      m.ratio = m.target ? m.value / m.target : 0;
      m.level = levelOf(m.value, m.target, { overRatio: MACRO_OVER });
      return m;
    });

    var items = FitLog.nutrition.NUTRIENTS.map(function (n) {
      var forUL = n.ulSource === 'supplement' ? (Number(supp[n.key]) || 0) : total[n.key];
      var target = targets.micros[n.key];
      var value = Math.round((total[n.key] || 0) * 10) / 10;

      return {
        key: n.key,
        name: n.name,
        unit: n.unit,
        value: value,
        target: target,
        ratio: target ? value / target : 0,
        ul: n.ul,
        ulKind: n.ulKind || null,
        level: levelOf(value, target, { ul: n.ul, ulValue: forUL }),
        fromFood: Math.round((Number(food[n.key]) || 0) * 10) / 10,
        fromSupplement: Math.round((Number(supp[n.key]) || 0) * 10) / 10
      };
    });

    return { date: key, hasMeals: day.meals.length > 0, macros: macros, items: items };
  }

  /**
   * 영양소 한 항목을 '지금 얼마나 먹었고 하루 필요량 대비 어떤지' 한 문장으로.
   * 이름 뒤에 조사를 붙이지 않는다 — '비타민 D' 처럼 영문으로 끝나는 이름이 많다.
   */
  function itemMessage(item) {
    var pct = Math.round(item.ratio * 100);
    var head = item.name + ' — 오늘 ' + item.value + item.unit + ', 하루 필요량(' +
      item.target + item.unit + ')의 ' + pct + '%';

    if (item.level.key === 'over') {
      var limitName = item.ulKind === 'goal' ? '목표섭취량' : '상한섭취량';
      return head + '. ' + limitName + '(' + item.ul + item.unit + ')을 넘었어. ' +
        (item.ulKind === 'goal'
          ? '짠 음식을 줄이는 게 좋아.'
          : '제품 함량 확인해 보고, 계속 이 수준이면 전문가랑 상의해 봐.');
    }

    if (item.ratio > 1 && item.ul) {
      return head + '야. 상한(' + item.ul + item.unit + ') 아래라 당장 문제는 아니야.';
    }
    if (item.ratio > 1) return head + '야.';

    var short = Math.round((item.target - item.value) * 10) / 10;
    return head + '. ' + short + item.unit + ' 모자라.';
  }

  /* ---------- 주간 운동 집계 ---------- */

  function workoutSummary(state, endDateKey, dayCount) {
    var days = lastDays(endDateKey || FitLog.store.todayKey(), dayCount || 7);
    var plan = state.profile.weeklyPlan;
    var strength = 0, cardio = 0, minutes = 0;
    var bodyParts = {};
    var activeDays = {};

    days.forEach(function (key) {
      var log = state.dailyLogs[key];
      if (!log) return;
      log.workouts.forEach(function (w) {
        if (w.type === 'strength') strength += 1; else cardio += 1;
        minutes += Number(w.minutes) || 0;
        activeDays[key] = true;
        (w.bodyParts || []).forEach(function (p) { bodyParts[p] = true; });
      });
    });

    return {
      days: days,
      strength: strength,
      cardio: cardio,
      minutes: minutes,
      planStrength: plan.strength,
      planCardio: plan.cardio,
      bodyParts: Object.keys(bodyParts),
      activeDays: Object.keys(activeDays).length
    };
  }

  /** 오늘 기준 연속 휴식 일수 (오늘 포함하지 않고 어제부터 센다) */
  function restStreak(state, endDateKey) {
    var streak = 0;
    for (var i = 1; i <= 30; i++) {
      var key = shiftDays(endDateKey, -i);
      var log = state.dailyLogs[key];
      if (log && log.workouts.length) break;
      streak += 1;
    }
    return streak;
  }

  var BODY_PARTS = [
    { key: 'upper', label: '상체' },
    { key: 'lower', label: '하체' },
    { key: 'core',  label: '코어' },
    { key: 'back',  label: '등' }
  ];

  /* ---------- 운동 판정 ----------
   *
   * 처음엔 6종이었는데 4종을 걷어냈다. 사용자 요청:
   * "운동에 대해 독려하는 내용은 빼줘. 필요한 정보만 받고 싶어."
   *
   * 뺀 것 — '근력운동 N회 남았어'(잔소리), '하체·코어가 빠져 있어'(잔소리),
   *         'N일째 운동 기록이 없네'(잔소리), '계획 다 채웠어'(칭찬).
   *   계획 대비 횟수는 주간 탭에 '근력 1/3회' 라는 숫자로 이미 있다. 문장으로 또 말할 이유가 없다.
   *
   * 남긴 것 — 둘 다 '모르면 손해 보는 사실' 이다:
   *   1) 감량 중 근력운동 0회 → 빠지는 무게에 근육이 섞인다
   *   2) 근력운동 한 날 단백질 부족 → 그날 운동이 근성장으로 안 이어진다
   */

  function workoutJudgments(state, endDateKey) {
    var today = endDateKey || FitLog.store.todayKey();
    var week = workoutSummary(state, today, 7);
    var goals = FitLog.calc.normalizeGoals(state.profile.goals);
    var out = [];

    if (goals.indexOf('loseFat') >= 0 && week.strength === 0) {
      out.push({
        level: 'warn',
        message: '이번 주 근력운동이 0회야. 체중을 줄이는 중에 근력운동이 없으면 ' +
          '빠지는 무게에 근육이 섞여.'
      });
    }

    var shortDays = [];
    week.days.forEach(function (key) {
      var log = state.dailyLogs[key];
      if (!log || !log.meals.length) return;
      if (!log.workouts.some(function (w) { return w.type === 'strength'; })) return;

      var eaten = FitLog.foods.sum(log.meals.map(function (m) { return m.nutrients; }));
      if (eaten.protein < state.targets.protein * 0.8) shortDays.push(key);
    });
    if (shortDays.length) {
      out.push({
        level: 'warn',
        // 이건 최근 7일을 본 판정이다. '이번 주' 를 빼면 오늘 얘기로 읽혀서
        // 오늘 아무것도 안 먹은 날에도 방금 생긴 경고처럼 보인다.
        message: '이번 주에 근력운동 한 날 단백질이 부족했어 (' + shortDays.length + '일). ' +
          '운동한 날 단백질이 모자라면 근성장에 손해야.'
      });
    }

    return out;
  }

  /* ---------- 신체 변화 판정 ---------- */

  function sortedBodyLogs(state) {
    return state.bodyLogs.slice().sort(function (a, b) {
      return a.date < b.date ? -1 : 1;
    });
  }

  function bodyJudgments(state, endDateKey) {
    var today = endDateKey || FitLog.store.todayKey();
    var logs = sortedBodyLogs(state).filter(function (l) { return l.date <= today; });
    var out = [];
    if (logs.length < 2) return out;

    var latest = logs[logs.length - 1];

    // 최근 7일 안의 이전 측정과 비교해 감량 속도를 본다
    var weekAgo = shiftDays(today, -7);
    var prior = logs.filter(function (l) { return l.date <= latest.date && l.date >= weekAgo; });
    if (prior.length >= 2) {
      var first = prior[0];
      var drop = first.weight - latest.weight;
      if (drop > first.weight * 0.01) {
        out.push({
          level: 'warn',
          message: '한 주에 ' + (Math.round(drop * 10) / 10) + 'kg 빠졌어. ' +
            '몸무게의 1%를 넘는 속도라 근육까지 빠질 수 있어. 조금 천천히 가자.'
        });
      }
    }

    // 4주간 체중 변화가 거의 없는데 근력운동은 계속한 경우
    var fourWeekAgo = shiftDays(today, -28);
    var older = logs.filter(function (l) { return l.date <= fourWeekAgo; });
    if (older.length) {
      var past = older[older.length - 1];
      var diff = Math.abs(latest.weight - past.weight);
      var kept = workoutSummary(state, today, 28).strength >= 4;

      if (diff < past.weight * 0.01 && kept) {
        out.push({
          level: 'tip',
          message: '4주째 몸무게는 거의 그대로야. 근력운동을 계속했으니 ' +
            '저울은 그대로여도 체성분이 바뀌는 중일 수 있어. 허리둘레를 확인해 봐.'
        });
      }
    }

    // 골격근량이 늘고 체지방률이 줄었으면 칭찬
    var withBody = logs.filter(function (l) {
      return l.skeletalMuscle !== null && l.bodyFatPct !== null;
    });
    if (withBody.length >= 2) {
      var a = withBody[0], b = withBody[withBody.length - 1];
      if (b.skeletalMuscle > a.skeletalMuscle && b.bodyFatPct < a.bodyFatPct) {
        out.push({
          level: 'good',
          message: '골격근량은 늘고 체지방률은 줄었어 (' +
            a.skeletalMuscle + '→' + b.skeletalMuscle + 'kg, ' +
            a.bodyFatPct + '→' + b.bodyFatPct + '%). 잘 가고 있어.'
        });
      }
    }

    return out;
  }

  FitLog.judge = {
    LEVELS: LEVELS,
    BODY_PARTS: BODY_PARTS,
    levelOf: levelOf,
    shiftDays: shiftDays,
    lastDays: lastDays,
    nutritionReport: nutritionReport,
    todayReport: todayReport,
    itemMessage: itemMessage,
    priority: priority,
    workoutSummary: workoutSummary,
    restStreak: restStreak,
    workoutJudgments: workoutJudgments,
    bodyJudgments: bodyJudgments
  };
})(window.FitLog);
