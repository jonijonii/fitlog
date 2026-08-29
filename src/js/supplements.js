/* supplements.js — 보충제 프리셋 카탈로그 + 상호작용 룰 엔진 + 상한량(UL) 판정
 *
 * 영양소 키와 단위는 foods.js 와 똑같이 맞춘다. 그래야 음식 + 보충제 합산이 그냥 더하기가 된다.
 *   calcium·iron·magnesium·zinc·vitaminC·potassium·sodium·omega3   mg
 *   vitaminA(µg RAE)·vitaminD·vitaminK·vitaminB12·folate(µg DFE)   µg
 *   vitaminE                                                       mg α-TE
 *   protein g / kcal                                               (단백질 보충제용)
 *
 * 함량은 시중 제품의 흔한 값이다. 제품마다 다르므로 등록할 때 수정할 수 있어야 한다.
 */

window.FitLog = window.FitLog || {};

(function (FitLog) {
  'use strict';

  /* ---------- 시간대 ---------- */

  // endHour: 이 시각이 지나면 '지난 시간대'로 본다. 운동 후는 시간과 무관하므로 null.
  var TIME_SLOTS = [
    { key: 'morning',     label: '아침 공복', fasting: true,  withMeal: false, endHour: 10 },
    { key: 'lunch',       label: '점심',      fasting: false, withMeal: true,  endHour: 14 },
    { key: 'afternoon',   label: '오후',      fasting: false, withMeal: false, endHour: 17 },
    { key: 'evening',     label: '저녁',      fasting: false, withMeal: true,  endHour: 21 },
    { key: 'bedtime',     label: '취침 전',   fasting: false, withMeal: false, endHour: null },
    { key: 'postWorkout', label: '운동 후',   fasting: false, withMeal: false, endHour: null }
  ];

  /** 지금 시각 기준으로 이미 지난 시간대인지 */
  function isPassed(slotKey, hour) {
    var slot = SLOT_BY_KEY[slotKey];
    if (!slot || slot.endHour === null) return false;
    var h = hour === undefined ? new Date().getHours() : hour;
    return h >= slot.endHour;
  }

  var SLOT_BY_KEY = {};
  TIME_SLOTS.forEach(function (s) { SLOT_BY_KEY[s.key] = s; });

  /** 직접 등록·성분 추가에서 고를 수 있는 항목. KDRI 영양소 + 단백질·칼로리. */
  function nutrientFields() {
    var out = FitLog.nutrition.NUTRIENTS.map(function (n) {
      return { key: n.key, label: n.name, unit: n.unit };
    });
    out.push({ key: 'protein', label: '단백질', unit: 'g' });
    out.push({ key: 'kcal', label: '칼로리', unit: 'kcal' });
    return out;
  }

  function fieldMeta(key) {
    var hits = nutrientFields().filter(function (f) { return f.key === key; });
    return hits[0] || { key: key, label: key, unit: '' };
  }

  /* 프리셋 묶음 — 목록이 길어서 고를 때 그룹으로 나눈다 */
  var PRESET_GROUPS = [
    { key: 'vitamin', label: '비타민·미네랄' },
    { key: 'omega',   label: '오메가·지용성' },
    { key: 'protein', label: '단백질·운동' },
    { key: 'sleep',   label: '수면·컨디션' },
    { key: 'other',   label: '기타' }
  ];

  /* ---------- 프리셋 ----------
   * 이건 '자주 쓰이는 것들의 카탈로그'지 누구의 복용 목록이 아니다.
   * 여기 없는 건 직접 등록으로 넣을 수 있어야 한다 — 그게 없으면
   * 이 목록이 곧 '먹을 수 있는 것의 전부'가 되어 버린다.
   *
   * tags 는 룰 엔진이 읽는다:
   *   fatSoluble  지용성 — 식사와 함께 먹어야 흡수된다
   *   sedative    졸음을 유발할 수 있음 — 아침보다 취침 전
   *   iron        철분 공급원
   *   ironBlocker 철분 흡수를 방해함 (칼슘·마그네슘·아연)
   *   ironHelper  철분 흡수를 도움 (비타민C)
   */
  var PRESETS = [
    { id: 'tmg', group: 'other', name: 'TMG (베타인)', amount: '1,000 mg', slot: 'morning',
      doses: 1, tags: [], nutrients: {} },

    { id: 'nmn', group: 'other', name: 'NMN', amount: '300 mg', slot: 'morning',
      doses: 1, tags: [], nutrients: {} },

    { id: 'probiotics', group: 'other', name: '프로바이오틱스', amount: '제품 기준', slot: 'morning',
      doses: 1, tags: [], nutrients: {} },

    { id: 'multivitamin', group: 'vitamin', name: '종합비타민', amount: '대표 성분값', slot: 'lunch',
      doses: 1, tags: ['ironBlocker'],
      nutrients: { vitaminA: 700, vitaminD: 10, vitaminE: 11, vitaminK: 50,
                   vitaminC: 100, vitaminB12: 6, folate: 400,
                   calcium: 200, iron: 8, magnesium: 100, zinc: 8 } },

    { id: 'vitamin_d', group: 'vitamin', name: '비타민 D', amount: '1,000 IU (25 µg)', slot: 'lunch',
      doses: 1, tags: ['fatSoluble'], nutrients: { vitaminD: 25 } },

    { id: 'vitamin_k2', group: 'vitamin', name: '비타민 K2', amount: '100 µg', slot: 'lunch',
      doses: 1, tags: ['fatSoluble'], nutrients: { vitaminK: 100 } },

    { id: 'lutein', group: 'omega', name: '루테인', amount: '20 mg', slot: 'lunch',
      doses: 1, tags: ['fatSoluble'], nutrients: {} },

    { id: 'omega3', group: 'omega', name: '오메가3', amount: 'EPA+DHA 1,000 mg', slot: 'lunch',
      doses: 1, tags: ['fatSoluble'], nutrients: { omega3: 1000 },
      note: '제품 앞면의 "오메가3 1,000mg" 은 보통 어유 전체 무게야. ' +
            '영양소로 세는 건 그중 EPA+DHA 뿐이라 실제로는 더 적을 수 있어. ' +
            '뒷면에서 EPA 와 DHA 를 찾아 더한 값으로 고쳐줘 (예: EPA 300 + DHA 200 → 500).' },

    { id: 'coq10', group: 'omega', name: '코엔자임Q10', amount: '100 mg', slot: 'lunch',
      doses: 1, tags: ['fatSoluble'], nutrients: {} },

    { id: 'zinc', group: 'vitamin', name: '아연', amount: '15 mg', slot: 'lunch',
      doses: 1, tags: ['ironBlocker'], nutrients: { zinc: 15 } },

    { id: 'iron', group: 'vitamin', name: '철분', amount: '25 mg', slot: 'morning',
      doses: 1, tags: ['iron'], nutrients: { iron: 25 } },

    { id: 'vitamin_c', group: 'vitamin', name: '비타민 C', amount: '1,000 mg', slot: 'lunch',
      doses: 1, tags: ['ironHelper'], nutrients: { vitaminC: 1000 } },

    { id: 'calcium', group: 'vitamin', name: '칼슘', amount: '500 mg', slot: 'evening',
      doses: 1, tags: ['ironBlocker'], nutrients: { calcium: 500 } },

    { id: 'magnesium', group: 'vitamin', name: '마그네슘 (트레온산)', amount: '원소 Mg 144 mg', slot: 'bedtime',
      doses: 1, tags: ['ironBlocker', 'sedative'], nutrients: { magnesium: 144 },
      note: '제품 표기 총량(예: 트레온산마그네슘 2,000mg)과 원소 마그네슘 함량은 달라. 원소 함량 기준으로 넣어줘.' },

    { id: 'l_theanine', group: 'sleep', name: 'L-테아닌', amount: '200 mg', slot: 'bedtime',
      doses: 1, tags: ['sedative'], nutrients: {} },

    { id: 'collagen', group: 'other', name: '콜라겐', amount: '5,000 mg', slot: 'bedtime',
      doses: 1, tags: [], nutrients: { protein: 5, kcal: 20 } },

    { id: 'whey_protein', group: 'protein', name: '유청 단백질 파우더', amount: '단백질 24 g / 120 kcal',
      slot: 'postWorkout', doses: 1, tags: [], nutrients: { protein: 24, kcal: 120 } },

    { id: 'creatine', group: 'protein', name: '크레아틴 모노하이드레이트', amount: '5 g', slot: 'postWorkout',
      doses: 1, tags: [], nutrients: {} },

    { id: 'inositol', group: 'other', name: '이노시톨', amount: '2,000 mg × 2회', slot: 'morning',
      doses: 2, tags: [], nutrients: {} },

    { id: 'vitamin_b_complex', group: 'vitamin', name: '비타민 B 컴플렉스', amount: '제품 기준',
      slot: 'lunch', doses: 1, tags: [], nutrients: { vitaminB12: 12, folate: 400 } },

    { id: 'folate', group: 'vitamin', name: '엽산', amount: '400 µg', slot: 'lunch',
      doses: 1, tags: [], nutrients: { folate: 400 } },

    { id: 'vitamin_e', group: 'vitamin', name: '비타민 E', amount: '400 IU (268 mg α-TE)',
      slot: 'lunch', doses: 1, tags: ['fatSoluble'], nutrients: { vitaminE: 268 } },

    { id: 'vitamin_a', group: 'vitamin', name: '비타민 A', amount: '700 µg RAE', slot: 'lunch',
      doses: 1, tags: ['fatSoluble'], nutrients: { vitaminA: 700 } },

    { id: 'multimineral', group: 'vitamin', name: '멀티미네랄', amount: '대표 성분값', slot: 'evening',
      doses: 1, tags: ['ironBlocker'], nutrients: { calcium: 250, magnesium: 150, zinc: 8 } },

    { id: 'selenium', group: 'vitamin', name: '셀레늄', amount: '200 µg', slot: 'lunch',
      doses: 1, tags: [], nutrients: {} },

    { id: 'evening_primrose', group: 'omega', name: '감마리놀렌산 (달맞이꽃)', amount: '1,000 mg',
      slot: 'lunch', doses: 1, tags: ['fatSoluble'], nutrients: {} },

    { id: 'saw_palmetto', group: 'omega', name: '쏘팔메토', amount: '320 mg', slot: 'lunch',
      doses: 1, tags: ['fatSoluble'], nutrients: {} },

    { id: 'bcaa', group: 'protein', name: 'BCAA', amount: '5 g', slot: 'postWorkout',
      doses: 1, tags: [], nutrients: {} },

    { id: 'arginine', group: 'protein', name: '아르기닌', amount: '3,000 mg', slot: 'postWorkout',
      doses: 1, tags: [], nutrients: {} },

    { id: 'milk_thistle', group: 'other', name: '밀크씨슬', amount: '실리마린 130 mg',
      slot: 'lunch', doses: 1, tags: [], nutrients: {} },

    { id: 'glucosamine', group: 'other', name: '글루코사민', amount: '1,500 mg', slot: 'lunch',
      doses: 1, tags: [], nutrients: {} },

    { id: 'msm', group: 'other', name: 'MSM', amount: '1,500 mg', slot: 'lunch',
      doses: 1, tags: [], nutrients: {} },

    { id: 'red_ginseng', group: 'other', name: '홍삼', amount: '제품 기준', slot: 'morning',
      doses: 1, tags: [], nutrients: {} },

    { id: 'ginkgo_extract', group: 'other', name: '은행잎 추출물', amount: '120 mg', slot: 'lunch',
      doses: 1, tags: [], nutrients: {} },

    { id: 'melatonin', group: 'sleep', name: '멜라토닌', amount: '3 mg', slot: 'bedtime',
      doses: 1, tags: ['sedative'], nutrients: {} },

    { id: 'ashwagandha', group: 'sleep', name: '아슈와간다', amount: '600 mg', slot: 'bedtime',
      doses: 1, tags: ['sedative'], nutrients: {} }
  ];

  var PRESET_BY_ID = {};
  PRESETS.forEach(function (p) { PRESET_BY_ID[p.id] = p; });

  function getPreset(id) { return PRESET_BY_ID[id] || null; }

  /** 프리셋 → 사용자 보충제 항목 */
  function fromPreset(id) {
    var preset = getPreset(id);
    if (!preset) return null;

    var nutrients = {};
    Object.keys(preset.nutrients).forEach(function (k) { nutrients[k] = preset.nutrients[k]; });

    return {
      id: FitLog.store.newId('sup'),
      name: preset.name,
      presetId: preset.id,
      timeSlot: preset.slot,
      dailyDoses: preset.doses,
      nutrients: nutrients,
      enabled: true
    };
  }

  function tagsOf(sup) {
    var preset = sup.presetId ? getPreset(sup.presetId) : null;
    return preset ? preset.tags : [];
  }

  function hasTag(sup, tag) { return tagsOf(sup).indexOf(tag) >= 0; }

  /** 하루치 보충제 영양소 합계. dailyDoses 를 곱한다. */
  function dailyNutrients(supplements) {
    var total = {};
    FitLog.foods.KEYS.forEach(function (k) { total[k] = 0; });
    total.protein = total.protein || 0;

    (supplements || []).forEach(function (sup) {
      if (!sup || sup.enabled === false) return;
      var doses = Number(sup.dailyDoses) || 1;
      Object.keys(sup.nutrients || {}).forEach(function (k) {
        total[k] = (total[k] || 0) + (Number(sup.nutrients[k]) || 0) * doses;
      });
    });

    return total;
  }

  /* ---------- 성분 중복 ----------
     종합비타민에 이미 비타민 D 가 들어 있는데 비타민 D 를 따로 먹는 경우처럼,
     같은 영양소를 두 개 이상에서 받고 있으면 알려준다. UL 을 넘지 않아도 알 가치가 있다. */

  /**
   * @param {object[]} supplements
   * @param {object} [microTargets] 있으면 '하루 필요량의 몇 배' 까지 알려준다.
   *   합계 숫자만 던지면 그게 많은 건지 적은 건지 알 수 없다는 피드백을 반영한 것.
   */
  function duplicates(supplements, microTargets) {
    var active = (supplements || []).filter(function (s) { return s && s.enabled !== false; });
    var targets = microTargets || {};
    var out = [];

    FitLog.nutrition.NUTRIENTS.forEach(function (n) {
      var sources = active.filter(function (s) {
        return Number((s.nutrients || {})[n.key]) > 0;
      });
      if (sources.length < 2) return;

      var total = sources.reduce(function (sum, s) {
        return sum + Number(s.nutrients[n.key]) * (Number(s.dailyDoses) || 1);
      }, 0);

      var rounded = Math.round(total * 10) / 10;
      var target = Number(targets[n.key]) || 0;

      // 보충제·영양소 이름은 '비타민 D', 'K2' 처럼 영문/숫자로 끝나는 게 많다.
      // 이름 바로 뒤에 은/는·이/가를 붙이면 조사가 틀리므로, 이름 뒤에는 항상 구분자를 둔다.
      var msg = sources.map(function (s) { return s.name; }).join(', ') +
        ' — 여기에 ' + n.name + ' 성분이 겹쳐. 보충제에서만 하루 ' + rounded + n.unit;

      if (target) {
        msg += ', 하루 필요량(' + target + n.unit + ')의 ' +
          Math.round((total / target) * 10) / 10 + '배';
      }

      if (n.ul && n.ulSource === 'supplement' && total > n.ul) {
        msg += '. 상한섭취량(' + n.ul + n.unit + ')을 넘었어 — 제품 함량 확인해 봐.';
      } else if (n.ul && total > n.ul) {
        msg += '. 보충제만으로 상한(' + n.ul + n.unit + ')을 넘어 — 제품 함량 확인해 봐.';
      } else if (n.ul) {
        msg += '. 상한 ' + n.ul + n.unit + ' 아래야.';
      } else {
        msg += '.';
      }

      out.push({
        key: n.key,
        name: n.name,
        unit: n.unit,
        total: rounded,
        target: target || null,
        sources: sources.map(function (s) { return s.name; }),
        message: msg
      });
    });

    return out;
  }

  /* ---------- 상한량(UL) 판정 ----------
     마그네슘·비타민E·엽산은 UL 이 보충제 유래분에만 적용된다.
     나머지는 음식 + 보충제 합산으로 본다. */

  function ulWarnings(foodNutrients, supplementNutrients) {
    var food = foodNutrients || {};
    var supp = supplementNutrients || {};
    var out = [];

    FitLog.nutrition.NUTRIENTS.forEach(function (n) {
      if (!n.ul) return;

      var fromFood = Number(food[n.key]) || 0;
      var fromSupp = Number(supp[n.key]) || 0;
      var checked = n.ulSource === 'supplement' ? fromSupp : fromFood + fromSupp;
      if (checked <= n.ul) return;

      var isGoal = n.ulKind === 'goal';
      var limitName = isGoal ? '목표섭취량' : '상한섭취량';
      var rounded = Math.round(checked * 10) / 10;

      out.push({
        key: n.key,
        name: n.name,
        unit: n.unit,
        value: rounded,
        ul: n.ul,
        source: n.ulSource,
        message: n.name + ' 섭취량이 ' + limitName + '(' + n.ul + n.unit + ')을 넘었어. ' +
          (n.ulSource === 'supplement'
            ? '보충제에서만 ' + rounded + n.unit + '이야. 제품 함량 확인해 보고, '
            : '오늘 합계가 ' + rounded + n.unit + '이야. ') +
          (isGoal ? '짠 음식을 조금 줄여 보는 게 좋아.'
                  : '계속 이 수준이면 전문가랑 상의해 봐.')
      });
    });

    return out;
  }

  /* ---------- 상호작용 룰 엔진 ---------- */

  function bySlot(supplements) {
    var map = {};
    TIME_SLOTS.forEach(function (s) { map[s.key] = []; });

    (supplements || []).forEach(function (sup) {
      if (!sup || sup.enabled === false) return;
      if (!map[sup.timeSlot]) map[sup.timeSlot] = [];
      map[sup.timeSlot].push(sup);
    });

    return map;
  }

  function names(list) {
    return list.map(function (s) { return s.name; }).join(', ');
  }

  /**
   * 배치를 보고 충돌·좋은 조합·시간대 권고를 만든다.
   * @returns {{level:'warn'|'good'|'tip', message:string}[]}
   */
  function interactions(supplements) {
    var slots = bySlot(supplements);
    var out = [];

    TIME_SLOTS.forEach(function (slot) {
      var here = slots[slot.key];
      if (!here.length) return;

      var irons = here.filter(function (s) { return hasTag(s, 'iron'); });
      var blockers = here.filter(function (s) { return hasTag(s, 'ironBlocker'); });
      var helpers = here.filter(function (s) { return hasTag(s, 'ironHelper'); });

      // 충돌: 철분 ↔ 칼슘·마그네슘·아연·종합비타민 (흡수 경쟁)
      if (irons.length && blockers.length) {
        out.push({
          level: 'warn',
          message: slot.label + ' — ' + names(irons) + ' + ' + names(blockers) +
            ' 이 둘은 서로 흡수를 방해해. 2시간 이상 띄우는 게 좋아.'
        });
      }

      // 좋은 조합: 철분 + 비타민C
      if (irons.length && helpers.length) {
        out.push({
          level: 'good',
          message: slot.label + ' — ' + names(irons) + ' + ' + names(helpers) +
            ' 조합 좋아. 비타민 C가 철분 흡수를 도와줘.'
        });
      }

      // 좋은 조합: 비타민 D + K2
      var hasD = here.some(function (s) { return s.presetId === 'vitamin_d'; });
      var hasK2 = here.some(function (s) { return s.presetId === 'vitamin_k2'; });
      if (hasD && hasK2) {
        out.push({
          level: 'good',
          message: slot.label + ' — 비타민 D + K2 같이 뒀네. 칼슘 대사에 서로 도움이 돼.'
        });
      }

      var fatSoluble = here.filter(function (s) { return hasTag(s, 'fatSoluble'); });

      // 시간대 권고: 지용성이 공복에 있으면 식후로
      if (fatSoluble.length && slot.fasting) {
        out.push({
          level: 'tip',
          message: names(fatSoluble) + ' — 지용성이라 공복엔 잘 흡수되지 않아. ' +
            '점심이나 저녁 식후로 옮기는 게 좋아.'
        });
      }

      // 좋은 조합: 지용성 + 식사
      if (fatSoluble.length && slot.withMeal) {
        out.push({
          level: 'good',
          message: names(fatSoluble) + ' — ' + slot.label + ' 식사와 같이 둔 건 잘한 배치야. ' +
            '지방과 같이 먹어야 흡수돼.'
        });
      }

      // 시간대 권고: 졸음 유발 성분이 아침에 있으면 취침 전으로
      var sedatives = here.filter(function (s) { return hasTag(s, 'sedative'); });
      if (sedatives.length && (slot.key === 'morning' || slot.key === 'lunch')) {
        out.push({
          level: 'tip',
          message: names(sedatives) + ' — 졸릴 수 있어. 취침 전으로 옮기면 수면에도 도움이 돼.'
        });
      }
    });

    return out;
  }

  /** 오늘 화면에 띄울 것 전부를 한 번에 계산한다. */
  function review(supplements, foodNutrients, microTargets) {
    var supp = dailyNutrients(supplements);
    return {
      nutrients: supp,
      duplicates: duplicates(supplements, microTargets),
      ul: ulWarnings(foodNutrients, supp),
      interactions: interactions(supplements)
    };
  }

  FitLog.supplements = {
    TIME_SLOTS: TIME_SLOTS,
    SLOT_BY_KEY: SLOT_BY_KEY,
    isPassed: isPassed,
    PRESET_GROUPS: PRESET_GROUPS,
    PRESETS: PRESETS,
    nutrientFields: nutrientFields,
    fieldMeta: fieldMeta,
    getPreset: getPreset,
    fromPreset: fromPreset,
    tagsOf: tagsOf,
    dailyNutrients: dailyNutrients,
    duplicates: duplicates,
    ulWarnings: ulWarnings,
    interactions: interactions,
    bySlot: bySlot,
    review: review
  };
})(window.FitLog);
