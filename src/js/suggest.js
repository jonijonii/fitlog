/* suggest.js — 부족 영양소를 채울 음식 제안 (Phase 7)
 *
 * 주간 리포트에서 부족(🔴/🟡)으로 나온 영양소를 채울 수 있는 음식을 고른다.
 * 새 데이터 테이블은 만들지 않는다 — 기존 음식 DB(foods.js)를 역조회한다.
 *
 * 이 모듈은 계산만 한다. 그리기는 views.js 가 맡는다 (7-3).
 *
 * 지켜야 할 두 가지:
 *
 * 1. **커버 판정은 목표치와 같은 정의의 값만 인정한다.**
 *    음식의 어떤 성분이 그 영양소의 권장량 정의와 다르면 커버로 세지 않는다.
 *    "숫자는 맞는데 의미가 다른" 값이 추천을 왜곡한다.
 *    실제로 그랬다 — 호두의 오메가3 9,000mg 은 식물성 ALA 인데 KDRI 충분섭취량
 *    300mg 은 EPA+DHA 기준이라, 그대로 두면 '오메가3 부족? 호두 먹어' 가 나왔다.
 *    이건 foods.js 의 데이터 규약으로 해결했고(식물성 ALA = 0), tests.js 가 지킨다.
 *    새 영양소를 넣을 때 같은 함정을 확인할 것.
 *
 * 2. **부정확한 제안을 하느니 안 한다.**
 *    커버할 음식이 없으면 억지로 채우지 않고 부족 사실만 알린다.
 *    부족 영양소가 없으면 카드 자체를 안 그린다.
 */

window.FitLog = window.FitLog || {};

(function (FitLog) {
  'use strict';

  /* 1회 섭취량이 하루 필요량의 이 비율 이상이면 그 영양소를 '커버' 한 것으로 본다.
     15% 는 '한 접시로 눈에 띄게 채워진다' 는 뜻이고, 더 낮추면 아무거나 다 걸린다. */
  var COVER_RATIO = 0.15;

  var TOP_GAPS = 3;      // 부족 영양소는 상위 3개만 본다
  var MAX_CARDS = 6;     // 최종 노출 4~6개
  var HIGH_KCAL = 250;   // loseFat 일 때 이 위는 하단으로 (제외하지는 않는다)
  var MIN_DAYS = 3;      // 주간 기록이 이보다 적으면 판정 신뢰도가 낮다

  /* 추천 대상 매크로. 칼로리는 뺀다 — '칼로리를 채우라' 는 제안은 쓸모가 없고,
     감량 중인 사람에게는 정반대 조언이 된다. */
  var MACRO_KEYS = ['protein', 'fiber'];

  var LOW_LEVELS = ['low', 'midLow'];

  /* 음식으로 채우기 어려운 영양소의 급원 힌트.
     조성 사실만 적는다 — 효능 주장은 넣지 않는다 ('칼륨 많아' ✅ / '혈압에 좋아' ❌). */
  var SOURCE_HINT = {
    omega3: '등푸른생선',
    vitaminD: '등푸른생선이나 계란 노른자',
    vitaminB12: '고기·생선·유제품',
    calcium: '유제품이나 뼈째 먹는 생선'
  };

  /* 과다(🟠)일 때의 행동 제안. 음식을 추천하지 않고 이 한 줄만 보여준다. */
  var OVER_NOTE = {
    sodium: '국물을 남기거나 김치 양을 줄여 봐.',
    kcal: '간식이나 음료부터 줄여 보는 사람이 많아.',
    carbs: '밥·면 양을 조금 줄여 봐.',
    fat: '튀김이나 고기 비계 쪽을 줄여 보면 돼.',
    protein: '문제 되는 수준은 아니야.',
    fiber: '속이 불편하면 조금 줄여 봐.'
  };

  function isLow(level) {
    return level && LOW_LEVELS.indexOf(level.key) >= 0;
  }

  /* ---------- 조사 ----------
   * '비타민 D은(는)' 처럼 괄호를 노출하면 문장이 딱딱해진다 — 이 앱은 반말로 말한다.
   * 받침 유무로 고른다. 한글은 유니코드로 계산하고, 숫자·알파벳은 읽는 소리로 판단한다
   * ('비타민 B12' 는 '십이' 로 읽어 받침이 없고, '오메가3' 는 '삼' 이라 받침이 있다).
   */
  var JONG_DIGIT = { '0': 1, '1': 1, '3': 1, '6': 1, '7': 1, '8': 1 };  // 영·일·삼·육·칠·팔
  var JONG_ALPHA = { l: 1, m: 1, n: 1, r: 1 };                          // 엘·엠·엔·알

  /* 숫자로 끝나는 이름은 읽는 소리가 갈린다. 규칙으로 못 맞히므로 실제로 쓰는 것만 못 박는다.
     '오메가3' 는 '오메가쓰리' 라 받침이 없다 — '삼' 으로 읽으면 '오메가3은' 이 되는데,
     이 앱이 쓰는 문장은 '오메가3는 …' 이다.
     숫자로 끝나는 이름을 새로 넣으면 여기도 같이 넣을 것. */
  var JONG_OVERRIDE = { '오메가3': false, '비타민 B12': false };

  /** 문장에 넣을 이름. 끝의 괄호 설명은 뗀다 ('오메가3 (EPA+DHA)' → '오메가3'). */
  function plain(word) {
    return String(word === undefined || word === null ? '' : word)
      .replace(/\s*\([^)]*\)\s*$/, '');
  }

  function hasJong(word) {
    var w = plain(word);
    if (!w) return false;
    if (JONG_OVERRIDE[w] !== undefined) return JONG_OVERRIDE[w];

    var ch = w.charAt(w.length - 1);
    var code = w.charCodeAt(w.length - 1);

    if (code >= 0xAC00 && code <= 0xD7A3) return (code - 0xAC00) % 28 !== 0;
    if (ch >= '0' && ch <= '9') return !!JONG_DIGIT[ch];
    if (/[a-zA-Z]/.test(ch)) return !!JONG_ALPHA[ch.toLowerCase()];
    return false;
  }

  /** 예: withParticle('오메가3 (EPA+DHA)', '은', '는') → '오메가3는' */
  function withParticle(word, whenJong, whenNone) {
    return plain(word) + (hasJong(word) ? whenJong : whenNone);
  }

  /** 그 영양소의 하루 목표치. 매크로와 미량영양소가 다른 자리에 있다. */
  function targetOf(targets, key) {
    if (!targets) return 0;
    if (key === 'protein') return Number(targets.protein) || 0;
    if (key === 'fiber') return Number(targets.fiber) || 0;
    return Number(targets.micros && targets.micros[key]) || 0;
  }

  /**
   * 영양밀도 = 100kcal 당 함량.
   * 저장하지 않고 그때그때 계산한다 (저장하면 파일만 커진다).
   * 열량이 0 인 음식은 밀도를 정의할 수 없어 0 으로 둔다.
   */
  function density(food, key) {
    var kcal = Number(food.per100g.kcal) || 0;
    if (kcal <= 0) return 0;
    return (Number(food.per100g[key]) || 0) / kcal * 100;
  }

  /**
   * 주간 리포트에서 부족한 것을 부족한 순으로 모은다.
   * 부족 판정은 음식+보충제 **총량** 을 본다 (상한 판정과 다른 값이다 — judge.js 참고).
   */
  function gaps(report) {
    var out = [];
    if (!report) return out;

    (report.macros || []).forEach(function (m) {
      if (MACRO_KEYS.indexOf(m.key) < 0) return;
      if (!isLow(m.level)) return;
      out.push({
        key: m.key, name: m.name, unit: m.unit,
        value: m.value, target: m.target, ratio: m.ratio, level: m.level
      });
    });

    (report.items || []).forEach(function (it) {
      if (!isLow(it.level)) return;
      out.push({
        key: it.key, name: it.name, unit: it.unit,
        value: it.value, target: it.target, ratio: it.ratio, level: it.level
      });
    });

    // 부족한 정도가 큰 순 (ratio 가 작을수록 더 모자라다)
    out.sort(function (a, b) { return a.ratio - b.ratio; });
    return out.slice(0, TOP_GAPS);
  }

  /** 과다(🟠)로 나온 것. 여기엔 음식을 추천하지 않는다. */
  function overs(report) {
    var out = [];
    if (!report) return out;

    (report.macros || []).concat(report.items || []).forEach(function (row) {
      if (!row.level || row.level.key !== 'over') return;
      out.push({
        key: row.key, name: row.name, unit: row.unit,
        value: row.value, target: row.target, ratio: row.ratio,
        // '이번 주' 를 반드시 밝힌다. 최근 7일을 본 판정이라 안 밝히면
        // 방금 생긴 일처럼 읽힌다 (CLAUDE.md 'UI 재렌더 규칙' 3번).
        message: '이번 주 ' + withParticle(row.name, '이', '가') + ' 목표보다 높았어. ' +
          (OVER_NOTE[row.key] || '이번 주 기록을 한 번 훑어봐.')
      });
    });

    return out;
  }

  /** 그 영양소를 보충제로 받고 있는가 (등록 기준 — 체크 여부와 별개다). */
  function hasSupplementFor(state, key) {
    return (state.supplements || []).some(function (sup) {
      if (!sup || sup.enabled === false) return false;
      return (Number(sup.nutrients && sup.nutrients[key]) || 0) > 0;
    });
  }

  /**
   * 음식 DB 를 순회하며 커버리지 점수를 매긴다.
   *
   * 1차 정렬: 커버한 영양소 개수 (많을수록 위)
   * 2차 정렬: 커버 영양소들의 평균 영양밀도
   * loseFat 이면 1회량 250kcal 초과 음식을 **하단으로 내린다** (제외하지 않는다).
   *
   * @param {Object=} opts  limit — 최대 개수 / foods — 후보 목록을 직접 넘길 때.
   *   foods 를 받는 이유는 정렬 규칙만 따로 확인하기 위해서다.
   *   실제 DB 에 마침 그런 음식이 있느냐와 정렬이 맞느냐는 다른 문제다.
   */
  function candidates(state, gapList, opts) {
    var o = opts || {};
    var pool = o.foods || FitLog.foods.all();
    var targets = state.targets;
    var goals = (state.profile && state.profile.goals) || [];
    // goals 는 배열이다 — goal === 'loseFat' 같은 단일 비교를 쓰지 말 것.
    var loseFat = goals.indexOf('loseFat') >= 0;

    var cards = [];

    pool.forEach(function (food) {
      var srv = food.typicalServing;
      if (!srv) return;   // 1회 섭취량이 없으면 후보가 아니다

      var covers = [];
      var densitySum = 0;

      gapList.forEach(function (gap) {
        var need = targetOf(targets, gap.key);
        if (!need) return;

        var amount = (Number(food.per100g[gap.key]) || 0) * srv.amount / 100;
        if (amount < need * COVER_RATIO) return;

        covers.push({
          key: gap.key,
          name: gap.name,
          unit: gap.unit,
          amount: Math.round(amount * 10) / 10,
          pct: amount / need
        });
        densitySum += density(food, gap.key);
      });

      if (!covers.length) return;

      var kcal = (Number(food.per100g.kcal) || 0) * srv.amount / 100;

      cards.push({
        id: food.id,
        name: food.name,
        group: food.group,
        serving: srv,
        kcal: Math.round(kcal),
        covers: covers,
        coverCount: covers.length,
        avgDensity: densitySum / covers.length,
        heavy: loseFat && kcal > HIGH_KCAL
      });
    });

    cards.sort(function (a, b) {
      if (a.heavy !== b.heavy) return a.heavy ? 1 : -1;      // 무거운 것은 아래로
      if (b.coverCount !== a.coverCount) return b.coverCount - a.coverCount;
      return b.avgDensity - a.avgDensity;
    });

    var limit = o.limit === undefined ? MAX_CARDS : o.limit;
    return limit > 0 ? cards.slice(0, limit) : cards;   // limit 0 이면 전부
  }

  function coversKey(card, key) {
    return card.covers.some(function (c) { return c.key === key; });
  }

  function countKeys(obj) {
    return Object.keys(obj).length;
  }

  /**
   * 커버할 음식이 없는 영양소에 붙일 한 줄.
   * 부정확한 제안을 하느니 안 한다 — 음식 카드 없이 사실만 알린다.
   * 제품·용량·브랜드는 말하지 않고, '이런 선택지가 있다' 까지만.
   */
  function uncoveredNote(state, gap) {
    if (hasSupplementFor(state, gap.key)) {
      return { key: gap.key, message: takingButShort(gap) };
    }

    var hint = SOURCE_HINT[gap.key];
    return {
      key: gap.key,
      message: withParticle(gap.name, '은', '는') + ' 음식으로 채우기 어려운 영양소야.' +
        (hint ? ' ' + withParticle(hint, '을', '를') +
          ' 자주 안 먹으면 보충제로 채우는 사람이 많아.' : '')
    };
  }

  /** 보충제로 먹고 있는데도 부족할 때의 한 줄. 두 자리에서 같은 문구를 쓴다. */
  function takingButShort(gap) {
    return withParticle(gap.name, '은', '는') +
      ' 보충제로 먹고 있는데도 부족하게 나왔어. 이번 주 복용 체크를 확인해 봐.';
  }

  /**
   * 보충제로 먹고 있는데도 부족한 영양소 안내.
   * 음식 제안은 그대로 보여주되 카드 위에 이 줄을 붙인다.
   */
  function supplementNotes(state, gapList) {
    var out = [];
    gapList.forEach(function (gap) {
      if (!hasSupplementFor(state, gap.key)) return;
      out.push({ key: gap.key, message: takingButShort(gap) });
    });
    return out;
  }

  /**
   * 주간 탭에 그릴 것 전부를 한 번에 계산한다.
   *
   * kind 로 무엇을 그릴지 나뉜다:
   *   'tooFewDays' — 기록이 3일 미만. 안내 문구만
   *   'none'       — 부족도 과다도 없음. 아무것도 그리지 않는다 (show: false)
   *   'suggest'    — 음식 카드 + (있으면) 안내 줄
   */
  function build(state, endDateKey, dayCount) {
    var report = FitLog.judge.nutritionReport(state, endDateKey, dayCount || 7);

    // 기록이 적으면 판정 신뢰도가 낮다. 억지로 뭔가 추천하지 않는다.
    // ('주간 평균은 기록이 있는 날만 나눈다' 는 규칙과 같은 이유다)
    if (report.loggedDays < MIN_DAYS) {
      return {
        show: true, kind: 'tooFewDays', loggedDays: report.loggedDays,
        message: '기록이 더 쌓이면 제안해 줄게.',
        gaps: [], overs: [], foods: [], notes: [], uncovered: []
      };
    }

    var gapList = gaps(report);
    var overList = overs(report);

    if (!gapList.length && !overList.length) {
      return {
        show: false, kind: 'none', loggedDays: report.loggedDays,
        gaps: [], overs: [], foods: [], notes: [], uncovered: []
      };
    }

    // 먼저 후보 전체를 순위대로 뽑는다. 잘라낸 뒤에 커버 여부를 따지면 안 된다 —
    // 상위 6개에 못 든 것까지 '음식으로 채우기 어렵다' 고 말하게 되는데, 그건 거짓말이다.
    var ranked = gapList.length ? candidates(state, gapList, { limit: 0 }) : [];

    /* 부족 영양소마다 대표 한 개는 자리를 준다.
     * 안 그러면 '2개 커버' 음식들이 여섯 자리를 다 먹고,
     * 채울 음식이 분명히 있는 영양소가 화면에서 통째로 빠진다.
     * (실제로 그랬다 — 비타민 E 는 아몬드로 채워지는데 생선 카드에 밀려 사라졌다) */
    var seen = {};
    gapList.forEach(function (gap) {
      if (countKeys(seen) >= MAX_CARDS) return;
      for (var i = 0; i < ranked.length; i++) {
        if (seen[ranked[i].id]) continue;
        if (coversKey(ranked[i], gap.key)) { seen[ranked[i].id] = true; return; }
      }
    });

    for (var j = 0; j < ranked.length && countKeys(seen) < MAX_CARDS; j++) {
      seen[ranked[j].id] = true;
    }

    // 표시 순서는 원래 순위를 따른다. 대표를 먼저 고른 건 자리 확보지 순서 규칙이 아니다.
    var foodCards = ranked.filter(function (card) { return seen[card.id]; });

    // 후보 전체를 봐도 못 채우는 것만 문구로 알린다
    var coveredKeys = {};
    ranked.forEach(function (card) {
      card.covers.forEach(function (c) { coveredKeys[c.key] = true; });
    });

    var uncovered = [];
    gapList.forEach(function (gap) {
      if (coveredKeys[gap.key]) return;
      uncovered.push(uncoveredNote(state, gap));
    });

    return {
      show: true,
      kind: 'suggest',
      loggedDays: report.loggedDays,
      gaps: gapList,
      overs: overList,
      foods: foodCards,
      notes: supplementNotes(state, gapList),
      uncovered: uncovered
    };
  }

  FitLog.suggest = {
    COVER_RATIO: COVER_RATIO,
    TOP_GAPS: TOP_GAPS,
    MAX_CARDS: MAX_CARDS,
    HIGH_KCAL: HIGH_KCAL,
    MIN_DAYS: MIN_DAYS,
    density: density,
    targetOf: targetOf,
    plain: plain,
    hasJong: hasJong,
    withParticle: withParticle,
    gaps: gaps,
    overs: overs,
    candidates: candidates,
    hasSupplementFor: hasSupplementFor,
    build: build
  };
})(window.FitLog);
