/* nutrition.js — 한국인 영양소 섭취기준(KDRIs) 테이블
 *
 * 출처: 2020 한국인 영양소 섭취기준 (보건복지부·한국영양학회) 성인 구간 값을 정리한 것.
 * 값은 권장섭취량(RNI) 또는 충분섭취량(AI) 기준이며, 프로젝트 스펙의 표를 우선한다.
 * 실제 섭취 판단은 의료적 조언이 아니라 참고용 지표다.
 */

window.FitLog = window.FitLog || {};

(function (FitLog) {
  'use strict';

  /* 영양소 메타 — 표시 이름, 단위, 상한(UL), UL 적용 대상 */
  var NUTRIENTS = [
    { key: 'calcium',   name: '칼슘',        unit: 'mg', ul: 2000, ulSource: 'all' },
    { key: 'iron',      name: '철',          unit: 'mg', ul: 45,   ulSource: 'all' },
    { key: 'magnesium', name: '마그네슘',    unit: 'mg', ul: 350,  ulSource: 'supplement' },
    { key: 'zinc',      name: '아연',        unit: 'mg', ul: 35,   ulSource: 'all' },
    { key: 'vitaminA',  name: '비타민 A',    unit: 'µg RAE', ul: 3000, ulSource: 'all' },
    { key: 'vitaminD',  name: '비타민 D',    unit: 'µg', ul: 100,  ulSource: 'all' },
    { key: 'vitaminE',  name: '비타민 E',    unit: 'mg α-TE', ul: 540, ulSource: 'supplement' },
    { key: 'vitaminK',  name: '비타민 K',    unit: 'µg', ul: null, ulSource: null },
    { key: 'vitaminC',  name: '비타민 C',    unit: 'mg', ul: 2000, ulSource: 'all' },
    { key: 'vitaminB12',name: '비타민 B12',  unit: 'µg', ul: null, ulSource: null },
    { key: 'folate',    name: '엽산',        unit: 'µg DFE', ul: 1000, ulSource: 'supplement' },
    { key: 'potassium', name: '칼륨',        unit: 'mg', ul: null, ulSource: null },
    { key: 'sodium',    name: '나트륨',      unit: 'mg', ul: 2300, ulSource: 'all', ulKind: 'goal' },
    { key: 'omega3',    name: '오메가3 (EPA+DHA)', unit: 'mg', ul: null, ulSource: null }
  ];

  var NUTRIENT_MAP = {};
  NUTRIENTS.forEach(function (n) { NUTRIENT_MAP[n.key] = n; });

  /* 연령대 구분: 19–29 / 30–49 / 50–64 / 65+ */
  function ageGroup(age) {
    var a = Number(age) || 0;
    if (a < 30) return '19-29';
    if (a < 50) return '30-49';
    if (a < 65) return '50-64';
    return '65+';
  }

  /* 권장/충분 섭취량 — [성별][연령대] */
  var RECOMMENDED = {
    female: {
      '19-29': { calcium: 700, iron: 14, magnesium: 280, zinc: 8, vitaminA: 650, vitaminD: 10,
                 vitaminE: 12, vitaminK: 65, vitaminC: 100, vitaminB12: 2.4, folate: 400,
                 potassium: 3500, sodium: 1500, omega3: 300 },
      '30-49': { calcium: 700, iron: 14, magnesium: 280, zinc: 8, vitaminA: 650, vitaminD: 10,
                 vitaminE: 12, vitaminK: 65, vitaminC: 100, vitaminB12: 2.4, folate: 400,
                 potassium: 3500, sodium: 1500, omega3: 300 },
      '50-64': { calcium: 800, iron: 8, magnesium: 280, zinc: 8, vitaminA: 600, vitaminD: 10,
                 vitaminE: 12, vitaminK: 65, vitaminC: 100, vitaminB12: 2.4, folate: 400,
                 potassium: 3500, sodium: 1500, omega3: 300 },
      '65+':   { calcium: 800, iron: 7, magnesium: 280, zinc: 7, vitaminA: 600, vitaminD: 15,
                 vitaminE: 12, vitaminK: 65, vitaminC: 100, vitaminB12: 2.4, folate: 400,
                 potassium: 3500, sodium: 1300, omega3: 300 }
    },
    male: {
      '19-29': { calcium: 800, iron: 10, magnesium: 360, zinc: 10, vitaminA: 800, vitaminD: 10,
                 vitaminE: 12, vitaminK: 75, vitaminC: 100, vitaminB12: 2.4, folate: 400,
                 potassium: 3500, sodium: 1500, omega3: 300 },
      '30-49': { calcium: 800, iron: 10, magnesium: 370, zinc: 10, vitaminA: 800, vitaminD: 10,
                 vitaminE: 12, vitaminK: 75, vitaminC: 100, vitaminB12: 2.4, folate: 400,
                 potassium: 3500, sodium: 1500, omega3: 300 },
      '50-64': { calcium: 750, iron: 10, magnesium: 370, zinc: 9, vitaminA: 750, vitaminD: 10,
                 vitaminE: 12, vitaminK: 75, vitaminC: 100, vitaminB12: 2.4, folate: 400,
                 potassium: 3500, sodium: 1500, omega3: 300 },
      '65+':   { calcium: 700, iron: 9, magnesium: 370, zinc: 9, vitaminA: 700, vitaminD: 15,
                 vitaminE: 12, vitaminK: 75, vitaminC: 100, vitaminB12: 2.4, folate: 400,
                 potassium: 3500, sodium: 1300, omega3: 300 }
    }
  };

  /**
   * 미량영양소 권장량 산출.
   * 완경 전 여성은 철 권장량이 높다(월경 손실 보전). profile.menopause 로 분기.
   * @param {{sex:string, age:number, menopause?:boolean}} profile
   */
  function microTargets(profile) {
    var sex = profile && profile.sex === 'male' ? 'male' : 'female';
    var group = ageGroup(profile && profile.age);
    var base = RECOMMENDED[sex][group];

    var out = {};
    Object.keys(base).forEach(function (k) { out[k] = base[k]; });

    if (sex === 'female') {
      // 45세 이상에서만 완경 여부를 입력받는다. 미입력이면 연령대 기본값을 그대로 쓴다.
      if (profile.menopause === false) out.iron = 14;
      else if (profile.menopause === true) out.iron = 8;
    }

    return out;
  }

  FitLog.nutrition = {
    NUTRIENTS: NUTRIENTS,
    NUTRIENT_MAP: NUTRIENT_MAP,
    RECOMMENDED: RECOMMENDED,
    ageGroup: ageGroup,
    microTargets: microTargets
  };
})(window.FitLog);
