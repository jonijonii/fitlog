/* report.js — 사람이 읽는 요약 텍스트
 *
 * CSV 는 기계가 읽는 형식이라 카톡에 붙여넣으면 쉼표 범벅으로 보인다.
 * 여기서 만드는 건 트레이너가 눈으로 훑거나 AI 에 그대로 넣을 수 있는 평문이다.
 *
 * 규칙 (CLAUDE.md '공유 기능 상세'):
 *   - 마크다운 아닌 플레인 텍스트. 이모지는 쓰지 않는다 (AI 파싱을 방해한다)
 *   - 단위를 항상 붙인다 (98g, 1,420kcal)
 *   - 양 표기(적게/보통/많이)는 필수 — 사진 없이 판단할 유일한 단서다
 *   - 시각·메모는 있을 때만 쓰고, 없으면 줄을 당겨 붙인다 (빈칸을 남기지 않는다)
 *   - 미량영양소·보충제·상한량은 넣지 않는다 (트레이너 관심사가 아닌 개인 관리 영역)
 */

window.FitLog = window.FitLog || {};

(function (FitLog) {
  'use strict';

  var store = FitLog.store;
  var DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
  var MEAL_LABEL = { breakfast: '아침', lunch: '점심', dinner: '저녁', snack: '간식' };
  var MEAL_ORDER = ['breakfast', 'lunch', 'dinner', 'snack'];
  var NOTE_MAX = 20;

  /** 1420 → "1,420" */
  function comma(n) {
    var s = String(Math.round(Number(n) || 0));
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function one(n) {
    return Math.round((Number(n) || 0) * 10) / 10;
  }

  function parts(dateKey) {
    var p = dateKey.split('-');
    return { y: Number(p[0]), m: Number(p[1]), d: Number(p[2]) };
  }

  function dayName(dateKey) {
    var p = parts(dateKey);
    return DAY_NAMES[new Date(p.y, p.m - 1, p.d).getDay()];
  }

  function shortDate(dateKey) {
    var p = parts(dateKey);
    return p.m + '/' + p.d;
  }

  function portionLabel(p) {
    var hit = FitLog.templates.PORTIONS.filter(function (x) { return x.value === p; })[0];
    return hit ? hit.label : String(p);
  }

  function bodyPartText(list) {
    return (list || []).map(function (key) {
      var hit = FitLog.judge.BODY_PARTS.filter(function (b) { return b.key === key; })[0];
      return hit ? hit.label : key;
    }).join('·');
  }

  /* ---------- 하루 요약 ---------- */

  function dailyText(state, dateKey) {
    var key = dateKey || store.todayKey();
    var day = store.getDay(key);
    var t = state.targets;
    var p = parts(key);

    var eaten = FitLog.foods.sum(day.meals.map(function (m) { return m.nutrients; }));
    var lines = [];

    lines.push(p.m + '월 ' + p.d + '일 (' + dayName(key) + ')');
    lines.push('');
    lines.push('칼로리  ' + comma(eaten.kcal) + ' / ' + comma(t.calories) + ' kcal');
    lines.push('단백질  ' + one(eaten.protein) + ' / ' + t.protein + ' g');
    lines.push('탄수 ' + one(eaten.carbs) + 'g · 지방 ' + one(eaten.fat) +
               'g · 식이섬유 ' + one(eaten.fiber) + 'g');

    if (day.meals.length) {
      lines.push('');
      day.meals.slice().sort(function (a, b) {
        return MEAL_ORDER.indexOf(a.type) - MEAL_ORDER.indexOf(b.type);
      }).forEach(function (meal) {
        // 시각이 없으면 그 자리를 공백으로 맞춰 끼니 이름이 세로로 정렬되게 한다
        var when = meal.time ? meal.time : '     ';
        lines.push(when + ' ' + (MEAL_LABEL[meal.type] || meal.type) + '  ' +
                   meal.label + ' (' + portionLabel(meal.portion) + ')');

        if (meal.note) {
          var note = meal.note.length > NOTE_MAX
            ? meal.note.slice(0, NOTE_MAX) + '…' : meal.note;
          lines.push('       └ ' + note);
        }
      });
    }

    var tail = [];

    if (day.workouts.length) {
      var bits = day.workouts.map(function (w) {
        var name = w.type === 'strength' ? '근력' : '유산소';
        var where = bodyPartText(w.bodyParts);
        return name + ' ' + w.minutes + '분' + (where ? ' (' + where + ')' : '');
      });
      tail.push('운동  ' + bits.join(', '));
    }

    var body = state.bodyLogs.filter(function (l) { return l.date === key; })[0];
    if (body) {
      tail.push('체중  ' + body.weight + ' kg' +
        (body.waistCm ? ' · 허리 ' + body.waistCm + ' cm' : ''));
    }

    if (day.waterMl) tail.push('물    ' + comma(day.waterMl) + ' ml');

    if (day.alcohol && day.alcohol.drank) {
      tail.push('음주  ' + (day.alcohol.note || '있음') +
        (day.alcohol.kcal ? ' (' + comma(day.alcohol.kcal) + 'kcal)' : ''));
    }

    if (tail.length) {
      lines.push('');
      lines = lines.concat(tail);
    }

    if (!day.meals.length && !tail.length) {
      lines.push('');
      lines.push('기록 없음');
    }

    return lines.join('\n');
  }

  /* ---------- 주간 요약 ---------- */

  /** 트레이너가 볼 것만 남긴다 — 미량영양소·보충제는 뺀다 */
  function weeklyGaps(state, endKey) {
    var judge = FitLog.judge;
    var report = judge.nutritionReport(state, endKey, 7);
    var out = [];

    report.macros.forEach(function (m) {
      if (m.level.key === 'ok') return;
      out.push(m.name + ' — 평균 ' + m.value + m.unit +
        ', 목표의 ' + Math.round(m.ratio * 100) + '%');
    });

    judge.workoutJudgments(state, endKey).forEach(function (j) {
      out.push(j.message);
    });

    judge.bodyJudgments(state, endKey).forEach(function (j) {
      if (j.level === 'warn') out.push(j.message);
    });

    return out;
  }

  function weeklyText(state, endDateKey) {
    var endKey = endDateKey || store.todayKey();
    var judge = FitLog.judge;
    var days = judge.lastDays(endKey, 7);
    var startKey = days[0];
    var t = state.targets;
    var p = parts(endKey);

    var report = judge.nutritionReport(state, endKey, 7);
    var wk = judge.workoutSummary(state, endKey, 7);

    var lines = [];
    lines.push(p.m + '월 ' + Math.ceil(p.d / 7) + '주차 (' +
      shortDate(startKey) + '–' + shortDate(endKey) + ')');
    lines.push('');

    if (!report.loggedDays) {
      lines.push('이번 주 식사 기록 없음');
    } else {
      var kcal = report.macros.filter(function (m) { return m.key === 'kcal'; })[0];
      var prot = report.macros.filter(function (m) { return m.key === 'protein'; })[0];

      lines.push('평균 칼로리  ' + comma(kcal.value) + ' / ' + comma(t.calories) + ' kcal');
      lines.push('평균 단백질  ' + prot.value + ' / ' + t.protein + ' g');
      lines.push('기록한 날    ' + report.loggedDays + '일 / 7일');
    }

    lines.push('');
    lines.push('근력 ' + wk.strength + '/' + wk.planStrength + '회 · 유산소 ' +
      wk.cardio + '/' + wk.planCardio + '회 · 총 ' + wk.minutes + '분');

    // 체중·허리는 이번 주 안의 처음과 마지막 측정을 비교한다
    var inWeek = state.bodyLogs.filter(function (l) {
      return l.date >= startKey && l.date <= endKey;
    });
    if (inWeek.length >= 2) {
      var a = inWeek[0], b = inWeek[inWeek.length - 1];
      var diff = one(b.weight - a.weight);
      lines.push('체중 ' + a.weight + ' → ' + b.weight + ' kg (' +
        (diff > 0 ? '+' : '') + diff + ')');
      if (a.waistCm && b.waistCm) {
        lines.push('허리 ' + a.waistCm + ' → ' + b.waistCm + ' cm');
      }
    } else if (inWeek.length === 1) {
      lines.push('체중 ' + inWeek[0].weight + ' kg');
    }

    var gaps = weeklyGaps(state, endKey);
    if (gaps.length) {
      lines.push('');
      lines.push('이번 주 갭');
      gaps.forEach(function (g) { lines.push('· ' + g); });
    }

    return lines.join('\n');
  }

  FitLog.report = {
    dailyText: dailyText,
    weeklyText: weeklyText,
    weeklyGaps: weeklyGaps,
    comma: comma
  };
})(window.FitLog);
