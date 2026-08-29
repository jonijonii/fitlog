/* csv.js — 기록을 엑셀에서 열 수 있는 CSV 로 내보낸다
 *
 * JSON 백업과 용도가 다르다:
 *   - JSON: 기기를 바꿀 때 그대로 복원하기 위한 파일. 사람이 열어볼 것이 아니다.
 *   - CSV : 사람이 엑셀에서 보고, 트레이너에게 보내기 위한 표. 되돌릴 수는 없다.
 * 그래서 둘 중 하나를 없애지 않고 나란히 둔다.
 *
 * ⚠️ 한글 CSV 는 BOM 이 없으면 엑셀에서 글자가 깨진다. 앞에 ﻿ 를 반드시 붙일 것.
 */

window.FitLog = window.FitLog || {};

(function (FitLog) {
  'use strict';

  var store = FitLog.store;
  var DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

  /** 쉼표·따옴표·줄바꿈이 든 값은 따옴표로 감싸고 내부 따옴표는 두 번 쓴다 (RFC 4180) */
  function cell(value) {
    if (value === null || value === undefined) return '';
    var s = String(value);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function toCsv(rows) {
    return rows.map(function (row) {
      return row.map(cell).join(',');
    }).join('\r\n');
  }

  function round1(n) {
    return Math.round((Number(n) || 0) * 10) / 10;
  }

  function dayName(dateKey) {
    var p = dateKey.split('-');
    return DAY_NAMES[new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getDay()];
  }

  /** 기록이 있는 날짜를 과거 → 최근 순으로 */
  function recordedDates(state) {
    var seen = {};
    Object.keys(state.dailyLogs).forEach(function (d) {
      var log = state.dailyLogs[d];
      if (log.meals.length || log.workouts.length || log.supplementsTaken.length) seen[d] = true;
    });
    state.bodyLogs.forEach(function (l) { seen[l.date] = true; });

    return Object.keys(seen).sort();
  }

  /* ---------- 1. 일별 요약 ---------- */

  function dailySummary(state) {
    var targets = state.targets;
    var supp = FitLog.supplements.dailyNutrients(state.supplements);
    var activeSupps = state.supplements.filter(function (s) { return s.enabled !== false; }).length;

    var bodyByDate = {};
    state.bodyLogs.forEach(function (l) { bodyByDate[l.date] = l; });

    var rows = [[
      '날짜', '요일',
      '칼로리', '목표칼로리', '달성률(%)',
      '단백질(g)', '목표단백질(g)',
      '탄수화물(g)', '지방(g)', '식이섬유(g)', '나트륨(mg)',
      '식사수', '근력운동(분)', '유산소(분)',
      '보충제체크', '보충제등록수',
      '체중(kg)', '골격근량(kg)', '체지방률(%)', '허리둘레(cm)',
      '메모'
    ]];

    recordedDates(state).forEach(function (date) {
      var log = state.dailyLogs[date] || store.emptyDay();
      var food = FitLog.foods.sum(log.meals.map(function (m) { return m.nutrients; }));

      // 보충제는 매일 먹는 전제라 그날 하나라도 체크했으면 하루분을 더한다
      var tookAny = log.supplementsTaken.length > 0;
      var kcal = round1(food.kcal + (tookAny ? supp.kcal : 0));
      var protein = round1(food.protein + (tookAny ? supp.protein : 0));

      var strengthMin = 0, cardioMin = 0;
      log.workouts.forEach(function (w) {
        if (w.type === 'strength') strengthMin += Number(w.minutes) || 0;
        else cardioMin += Number(w.minutes) || 0;
      });

      var body = bodyByDate[date] || {};

      rows.push([
        date, dayName(date),
        kcal, targets.calories, targets.calories ? Math.round(kcal / targets.calories * 100) : '',
        protein, targets.protein,
        round1(food.carbs), round1(food.fat), round1(food.fiber), Math.round(food.sodium),
        log.meals.length, strengthMin, cardioMin,
        log.supplementsTaken.length, activeSupps,
        body.weight === undefined ? '' : body.weight,
        body.skeletalMuscle === undefined || body.skeletalMuscle === null ? '' : body.skeletalMuscle,
        body.bodyFatPct === undefined || body.bodyFatPct === null ? '' : body.bodyFatPct,
        body.waistCm === undefined || body.waistCm === null ? '' : body.waistCm,
        log.note || ''
      ]);
    });

    return toCsv(rows);
  }

  /* ---------- 2. 식사 상세 ---------- */

  var MEAL_LABEL = { breakfast: '아침', lunch: '점심', dinner: '저녁', snack: '간식' };
  var MEAL_ORDER = ['breakfast', 'lunch', 'dinner', 'snack'];

  function portionLabel(p) {
    var hit = FitLog.templates.PORTIONS.filter(function (x) { return x.value === p; })[0];
    return hit ? hit.label : String(p);
  }

  function mealDetail(state) {
    var rows = [[
      '날짜', '요일', '끼니', '메뉴', '양', '시각',
      '칼로리', '단백질(g)', '탄수화물(g)', '지방(g)', '식이섬유(g)', '나트륨(mg)',
      '메모'
    ]];

    recordedDates(state).forEach(function (date) {
      var log = state.dailyLogs[date];
      if (!log || !log.meals.length) return;

      log.meals.slice().sort(function (a, b) {
        return MEAL_ORDER.indexOf(a.type) - MEAL_ORDER.indexOf(b.type);
      }).forEach(function (meal) {
        var n = meal.nutrients || {};

        rows.push([
          date, dayName(date),
          MEAL_LABEL[meal.type] || meal.type,
          meal.label,
          portionLabel(meal.portion),
          meal.time || '',
          Math.round(n.kcal || 0), round1(n.protein), round1(n.carbs),
          round1(n.fat), round1(n.fiber), Math.round(n.sodium || 0),
          meal.note || ''
        ]);
      });
    });

    return toCsv(rows);
  }

  /* ---------- 3. 인바디 기록 ---------- */

  function bodyLog(state) {
    var rows = [[
      '날짜', '요일', '체중(kg)', '골격근량(kg)', '체지방률(%)', '체지방량(kg)',
      '복부지방률', '허리둘레(cm)', '체중변화(kg)'
    ]];

    var logs = state.bodyLogs.slice().sort(function (a, b) {
      return a.date < b.date ? -1 : 1;
    });

    logs.forEach(function (l, i) {
      var fatMass = (l.bodyFatPct === null || l.bodyFatPct === undefined)
        ? '' : round1(l.weight * l.bodyFatPct / 100);
      var diff = i === 0 ? '' : round1(l.weight - logs[i - 1].weight);

      rows.push([
        l.date, dayName(l.date), l.weight,
        l.skeletalMuscle === null ? '' : l.skeletalMuscle,
        l.bodyFatPct === null ? '' : l.bodyFatPct,
        fatMass,
        l.visceralRatio === null ? '' : l.visceralRatio,
        l.waistCm === null ? '' : l.waistCm,
        diff
      ]);
    });

    return toCsv(rows);
  }

  /* ---------- 다운로드 ---------- */

  function deliver(fileName, text, onDone) {
    // BOM 이 없으면 한글 엑셀에서 전부 깨져 보인다. 이게 이 함수의 핵심이다.
    return FitLog.share.deliverFile(
      fileName, '﻿' + text, 'text/csv;charset=utf-8;', onDone);
  }

  var SHEETS = [
    { key: 'daily',  label: '일별 요약',   file: '일별요약',   build: dailySummary },
    { key: 'meals',  label: '식사 상세',   file: '식사상세',   build: mealDetail },
    { key: 'body',   label: '인바디 기록', file: '인바디기록', build: bodyLog }
  ];

  function exportSheet(key, onDone) {
    var sheet = SHEETS.filter(function (s) { return s.key === key; })[0];
    if (!sheet) return null;

    var text = sheet.build(store.load());
    deliver('fitlog-' + sheet.file + '-' + store.todayKey() + '.csv', text, onDone);
    return text;
  }

  FitLog.csv = {
    SHEETS: SHEETS,
    cell: cell,
    toCsv: toCsv,
    deliver: deliver,
    dailySummary: dailySummary,
    mealDetail: mealDetail,
    bodyLog: bodyLog,
    exportSheet: exportSheet
  };
})(window.FitLog);
