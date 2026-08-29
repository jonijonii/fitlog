/* calc.js — BMR / TDEE / 목표치 계산
 *
 * 순수 함수만 둔다. DOM·localStorage 를 건드리지 않으므로 콘솔에서 단독 검증 가능.
 */

window.FitLog = window.FitLog || {};

(function (FitLog) {
  'use strict';

  /* 목표는 복수 선택이다. '현재 유지'만 단독 선택. */
  var GOAL_OPTIONS = [
    { value: 'gainStrength', label: '근력 강화' },
    { value: 'loseFat',      label: '체중 감량' },
    { value: 'maintain',     label: '현재 유지' }
  ];

  var GOAL_ORDER = ['gainStrength', 'loseFat', 'maintain'];

  /* 조합별 칼로리·단백질 규칙. 키는 정규화된 목표 배열을 '+' 로 이은 값. */
  var GOAL_RULES = {
    'gainStrength': {
      label: '근력 강화', kcalDelta: +100, proteinPerKg: 1.8, proteinRange: [1.6, 2.0]
    },
    'loseFat': {
      label: '체중 감량', kcalDelta: -300, proteinPerKg: 2.0, proteinRange: [1.8, 2.2]
    },
    'maintain': {
      label: '현재 유지', kcalDelta: 0, proteinPerKg: 1.4, proteinRange: [1.2, 1.6]
    },
    // 리컴프: 칼로리는 살짝만 줄이고 단백질을 최대로 올려 근육을 지키면서 체지방을 뺀다.
    'gainStrength+loseFat': {
      label: '근력 강화 + 체중 감량', kcalDelta: -200, proteinPerKg: 2.2, proteinRange: [2.0, 2.4],
      note: '근력 강화랑 체중 감량을 같이 골랐네. 칼로리는 조금만 줄이고 단백질을 높게 잡았어. ' +
            '체중은 천천히 빠지지만 근육은 지키는 방향이야.'
    }
  };

  /** 목표 배열 정규화 — 옛 단일 문자열도 받아준다. 항상 최소 1개를 보장. */
  function normalizeGoals(goals) {
    var list = Array.isArray(goals) ? goals : (goals ? [goals] : []);

    var seen = {};
    list = list.filter(function (g) {
      if (GOAL_ORDER.indexOf(g) < 0 || seen[g]) return false;
      seen[g] = true;
      return true;
    });

    // '현재 유지'는 다른 목표와 같이 갈 수 없다.
    if (list.length > 1) list = list.filter(function (g) { return g !== 'maintain'; });
    if (!list.length) list = ['maintain'];

    return list.sort(function (a, b) {
      return GOAL_ORDER.indexOf(a) - GOAL_ORDER.indexOf(b);
    });
  }

  /** 칩 토글용. 마지막 하나는 해제되지 않는다(목표 없는 상태 방지). */
  function toggleGoal(goals, value) {
    var list = normalizeGoals(goals);
    var at = list.indexOf(value);

    if (at >= 0) {
      if (list.length === 1) return list;
      list = list.slice();
      list.splice(at, 1);
    } else if (value === 'maintain') {
      list = ['maintain'];
    } else {
      list = list.concat(value);
    }
    return normalizeGoals(list);
  }

  /** 정규화된 목표 배열 → 적용할 규칙 */
  function goalRule(goals) {
    var list = normalizeGoals(goals);
    return GOAL_RULES[list.join('+')] || GOAL_RULES.maintain;
  }

  var PROTEIN_CAP_PER_KG = 2.5;   // 단백질 상한
  var CALORIE_FLOOR_RATIO = 1.05; // 목표 칼로리 하한 = BMR × 1.05
  var FAT_RATIO = 0.25;           // 총칼로리 중 지방 비율

  function round(n, digits) {
    var f = Math.pow(10, digits || 0);
    return Math.round(n * f) / f;
  }

  /**
   * 기초대사량.
   * 체지방률이 있으면 Katch-McArdle(제지방량 기반, 더 정확),
   * 없으면 Mifflin-St Jeor.
   */
  function bmr(profile) {
    var weight = Number(profile.weight);
    var height = Number(profile.height);
    var age = Number(profile.age);
    var bf = profile.bodyFatPct;

    if (bf !== null && bf !== undefined && bf !== '' && Number(bf) > 0) {
      var lbm = weight * (1 - Number(bf) / 100);
      return 370 + 21.6 * lbm;
    }

    var base = 10 * weight + 6.25 * height - 5 * age;
    return profile.sex === 'male' ? base + 5 : base - 161;
  }

  /** 주간 운동 횟수(근력+유산소) → 활동계수 */
  function activityFactor(weeklyPlan) {
    var plan = weeklyPlan || {};
    var sessions = (Number(plan.strength) || 0) + (Number(plan.cardio) || 0);
    if (sessions <= 1) return 1.20;
    if (sessions <= 3) return 1.375;
    if (sessions <= 5) return 1.45;
    return 1.55;
  }

  /** 총소비열량 */
  function tdee(profile) {
    return bmr(profile) * activityFactor(profile.weeklyPlan);
  }

  /**
   * 프로필 → 목표치 전체.
   * 반환값의 notes 는 사용자에게 보여줄 안내 문구 배열(안전장치가 작동한 이유 설명).
   */
  function computeTargets(profile) {
    var goals = normalizeGoals(profile.goals || profile.goal);
    var goal = goalRule(goals);
    var weight = Number(profile.weight);

    var bmrVal = bmr(profile);
    var tdeeVal = bmrVal * activityFactor(profile.weeklyPlan);
    var notes = [];

    if (goal.note) notes.push(goal.note);

    // --- 칼로리 (하한 안전장치) ---
    var calories = tdeeVal + goal.kcalDelta;
    var floor = bmrVal * CALORIE_FLOOR_RATIO;
    if (calories < floor) {
      calories = floor;
      notes.push('목표 칼로리가 기초대사량에 너무 가까워서 ' + Math.round(floor) +
                 'kcal로 올렸어. 이보다 적게 먹으면 근육이 빠지고 대사도 떨어져.');
    }
    calories = Math.round(calories);

    // --- 단백질 (상한 캡) ---
    var protein = weight * goal.proteinPerKg;
    var proteinCap = weight * PROTEIN_CAP_PER_KG;
    if (protein > proteinCap) {
      protein = proteinCap;
      notes.push('단백질 목표는 체중 1kg당 ' + PROTEIN_CAP_PER_KG + 'g까지만 잡았어.');
    }
    protein = Math.round(protein);

    // --- 나머지 매크로 ---
    var fat = Math.round(calories * FAT_RATIO / 9);
    var carbs = Math.round((calories - protein * 4 - fat * 9) / 4);
    if (carbs < 0) {
      carbs = 0;
      notes.push('지금 칼로리로는 단백질·지방 목표를 채우면 탄수화물 여유가 없어. ' +
                 '목표나 활동량을 다시 확인해 봐.');
    }

    var fiber = Math.max(20, Math.round(calories / 1000 * 14));

    return {
      calories: calories,
      protein: protein,
      carbs: carbs,
      fat: fat,
      fiber: fiber,
      micros: FitLog.nutrition.microTargets(profile),
      meta: {
        bmr: Math.round(bmrVal),
        tdee: Math.round(tdeeVal),
        bmrMethod: (profile.bodyFatPct > 0) ? 'Katch-McArdle' : 'Mifflin-St Jeor',
        activityFactor: activityFactor(profile.weeklyPlan),
        goals: goals,
        goalKey: goals.join('+'),
        goalLabel: goal.label,
        proteinRange: goal.proteinRange,
        computedAt: new Date().toISOString()
      },
      notes: notes
    };
  }

  /** 프로필 입력 검증. 반환값은 필드별 에러 메시지 맵(비어 있으면 통과). */
  function validateProfile(p) {
    var errors = {};
    var h = Number(p.height), a = Number(p.age), w = Number(p.weight);

    if (!h || h < 100 || h > 230) errors.height = '키는 100~230cm 사이로 입력해.';
    if (!a || a < 19 || a > 100) errors.age = '나이는 19~100세 사이로 입력해.';
    if (p.sex !== 'female' && p.sex !== 'male') errors.sex = '성별을 골라줘.';
    if (!w || w < 30 || w > 250) errors.weight = '체중은 30~250kg 사이로 입력해.';

    var goals = Array.isArray(p.goals) ? p.goals : (p.goal ? [p.goal] : []);
    if (!goals.filter(function (g) { return GOAL_ORDER.indexOf(g) >= 0; }).length) {
      errors.goals = '목표를 하나 이상 골라줘.';
    }

    if (p.bodyFatPct !== null && p.bodyFatPct !== undefined && p.bodyFatPct !== '') {
      var bf = Number(p.bodyFatPct);
      if (isNaN(bf) || bf < 3 || bf > 70) errors.bodyFatPct = '체지방률은 3~70% 사이로 입력해.';
    }
    if (p.skeletalMuscle !== null && p.skeletalMuscle !== undefined && p.skeletalMuscle !== '') {
      var sm = Number(p.skeletalMuscle);
      if (isNaN(sm) || sm < 5 || sm > 80) errors.skeletalMuscle = '골격근량은 5~80kg 사이로 입력해.';
      else if (w && sm >= w) errors.skeletalMuscle = '골격근량이 체중보다 클 순 없어.';
    }

    return errors;
  }

  FitLog.calc = {
    GOAL_OPTIONS: GOAL_OPTIONS,
    GOAL_RULES: GOAL_RULES,
    PROTEIN_CAP_PER_KG: PROTEIN_CAP_PER_KG,
    CALORIE_FLOOR_RATIO: CALORIE_FLOOR_RATIO,
    round: round,
    normalizeGoals: normalizeGoals,
    toggleGoal: toggleGoal,
    goalRule: goalRule,
    bmr: bmr,
    activityFactor: activityFactor,
    tdee: tdee,
    computeTargets: computeTargets,
    validateProfile: validateProfile
  };
})(window.FitLog);
