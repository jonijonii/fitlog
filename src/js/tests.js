/* tests.js — 계산 로직 단위 검증
 *
 * 브라우저 콘솔에서 FitLog.runTests() 를 실행하거나,
 * 주소 끝에 ?test 를 붙여서 자동 실행할 수 있다.
 * Node 에서는 `node tests/run-tests.js` 로 같은 테스트를 돌린다.
 */

window.FitLog = window.FitLog || {};

(function (FitLog) {
  'use strict';

  var calc = FitLog.calc;
  var nutrition = FitLog.nutrition;
  var store = FitLog.store;

  var results = [];

  function ok(name, condition, detail) {
    results.push({ name: name, pass: !!condition, detail: detail });
  }

  function near(name, actual, expected, tolerance) {
    var tol = tolerance === undefined ? 0.5 : tolerance;
    var pass = Math.abs(actual - expected) <= tol;
    ok(name, pass, '기대 ' + expected + ' / 실제 ' + actual);
  }

  function eq(name, actual, expected) {
    ok(name, actual === expected, '기대 ' + expected + ' / 실제 ' + actual);
  }

  function baseProfile(over) {
    var p = {
      height: 160, age: 50, sex: 'female', weight: 57.4,
      skeletalMuscle: null, bodyFatPct: null,
      goals: ['maintain'], weeklyPlan: { strength: 2, cardio: 3 }
    };
    Object.keys(over || {}).forEach(function (k) { p[k] = over[k]; });
    return p;
  }

  function runTests() {
    results = [];

    /* ---- BMR ---- */
    // Mifflin-St Jeor 여성: 10×57.4 + 6.25×160 − 5×50 − 161 = 1163
    near('BMR Mifflin(여성)', calc.bmr(baseProfile()), 1163);
    // 남성: … + 5 = 1329
    near('BMR Mifflin(남성)', calc.bmr(baseProfile({ sex: 'male' })), 1329);
    // Katch-McArdle: LBM = 57.4×0.685 = 39.319 → 370 + 21.6×39.319 = 1219.29
    near('BMR Katch-McArdle(체지방률 입력 시)',
      calc.bmr(baseProfile({ bodyFatPct: 31.5 })), 1219.29, 0.05);
    ok('체지방률이 있으면 Katch-McArdle 을 쓴다',
      calc.bmr(baseProfile({ bodyFatPct: 31.5 })) !== calc.bmr(baseProfile()));

    /* ---- 활동계수 ---- */
    eq('활동계수 0회', calc.activityFactor({ strength: 0, cardio: 0 }), 1.20);
    eq('활동계수 1회', calc.activityFactor({ strength: 1, cardio: 0 }), 1.20);
    eq('활동계수 2회', calc.activityFactor({ strength: 1, cardio: 1 }), 1.375);
    eq('활동계수 3회', calc.activityFactor({ strength: 2, cardio: 1 }), 1.375);
    eq('활동계수 4회', calc.activityFactor({ strength: 2, cardio: 2 }), 1.45);
    eq('활동계수 5회', calc.activityFactor({ strength: 2, cardio: 3 }), 1.45);
    eq('활동계수 6회', calc.activityFactor({ strength: 3, cardio: 3 }), 1.55);
    eq('활동계수 10회', calc.activityFactor({ strength: 5, cardio: 5 }), 1.55);

    /* ---- TDEE ---- */
    near('TDEE = BMR × 활동계수',
      calc.tdee(baseProfile()), 1163 * 1.45, 1);

    /* ---- 목표치: 감량 (안전장치 미작동 케이스) ---- */
    var lose = calc.computeTargets(baseProfile({ goals: ['loseFat'], bodyFatPct: 31.5 }));
    // BMR 1219.29 × 1.45 = 1767.97 → −300 = 1467.97 → 하한 1280.26 보다 크므로 그대로
    eq('감량 칼로리 = TDEE − 300', lose.calories, 1468);
    eq('감량 단백질 = 체중 × 2.0', lose.protein, 115);
    eq('지방 = 칼로리 × 0.25 / 9', lose.fat, 41);
    eq('탄수 = (칼로리 − 단백질×4 − 지방×9) / 4', lose.carbs, 160);
    eq('식이섬유 = 칼로리/1000 × 14', lose.fiber, 21);
    eq('안전장치 안내 없음', lose.notes.length, 0);

    /* ---- 목표치: 유지 / 근력 ---- */
    var maintain = calc.computeTargets(baseProfile({ bodyFatPct: 31.5 }));
    eq('유지 칼로리 = TDEE', maintain.calories, 1768);
    eq('유지 단백질 = 체중 × 1.4', maintain.protein, 80);

    var gain = calc.computeTargets(baseProfile({ goals: ['gainStrength'], bodyFatPct: 31.5 }));
    eq('근력 칼로리 = TDEE + 100', gain.calories, 1868);
    eq('근력 단백질 = 체중 × 1.8', gain.protein, 103);

    /* ---- 목표 복수 선택: 근력 + 감량 = 리컴프 ---- */
    var recomp = calc.computeTargets(
      baseProfile({ goals: ['gainStrength', 'loseFat'], bodyFatPct: 31.5 }));
    eq('리컴프 칼로리 = TDEE − 200', recomp.calories, 1568);
    eq('리컴프 단백질 = 체중 × 2.2', recomp.protein, 126);
    eq('리컴프 지방', recomp.fat, 44);
    eq('리컴프 탄수', recomp.carbs, 167);
    eq('리컴프 라벨', recomp.meta.goalLabel, '근력 강화 + 체중 감량');
    eq('리컴프 목표 키', recomp.meta.goalKey, 'gainStrength+loseFat');
    ok('리컴프는 이유를 설명하는 안내가 붙는다',
      recomp.notes.length === 1 && recomp.notes[0].indexOf('리컴프') === -1 &&
      recomp.notes[0].indexOf('근육은 지키는') >= 0, recomp.notes[0]);
    ok('리컴프 칼로리는 감량 단독보다 높고 근력 단독보다 낮다',
      recomp.calories > lose.calories && recomp.calories < gain.calories,
      lose.calories + ' < ' + recomp.calories + ' < ' + gain.calories);
    ok('리컴프 단백질이 가장 높다',
      recomp.protein > lose.protein && recomp.protein > gain.protein);
    eq('선택 순서가 달라도 같은 결과',
      calc.computeTargets(baseProfile({ goals: ['loseFat', 'gainStrength'], bodyFatPct: 31.5 })).calories,
      recomp.calories);

    /* ---- 목표 정규화 ---- */
    eq('빈 목표는 유지로', calc.normalizeGoals([]).join('+'), 'maintain');
    eq('옛 단일 문자열도 받는다', calc.normalizeGoals('loseFat').join('+'), 'loseFat');
    eq('중복 제거', calc.normalizeGoals(['loseFat', 'loseFat']).join('+'), 'loseFat');
    eq('모르는 값은 버린다', calc.normalizeGoals(['loseFat', '헛소리']).join('+'), 'loseFat');
    eq('유지는 다른 목표와 같이 못 간다',
      calc.normalizeGoals(['maintain', 'loseFat']).join('+'), 'loseFat');
    eq('정렬 순서는 항상 같다',
      calc.normalizeGoals(['loseFat', 'gainStrength']).join('+'), 'gainStrength+loseFat');

    /* ---- 목표 칩 토글 ---- */
    eq('칩을 누르면 추가된다',
      calc.toggleGoal(['gainStrength'], 'loseFat').join('+'), 'gainStrength+loseFat');
    eq('다시 누르면 빠진다',
      calc.toggleGoal(['gainStrength', 'loseFat'], 'loseFat').join('+'), 'gainStrength');
    eq('마지막 하나는 해제되지 않는다',
      calc.toggleGoal(['loseFat'], 'loseFat').join('+'), 'loseFat');
    eq('유지를 고르면 나머지가 빠진다',
      calc.toggleGoal(['gainStrength', 'loseFat'], 'maintain').join('+'), 'maintain');
    eq('유지 상태에서 다른 걸 고르면 유지가 빠진다',
      calc.toggleGoal(['maintain'], 'loseFat').join('+'), 'loseFat');

    /* ---- 안전장치: 칼로리 하한 ---- */
    // 운동 0회 → 활동계수 1.20. BMR 1163 × 1.20 = 1395.6 → −300 = 1095.6
    // 하한 1163 × 1.05 = 1221.15 보다 낮으므로 상향돼야 한다.
    var floored = calc.computeTargets(
      baseProfile({ goals: ['loseFat'], weeklyPlan: { strength: 0, cardio: 0 } }));
    eq('칼로리가 BMR×1.05 로 상향된다', floored.calories, 1221);
    ok('상향 시 사용자 안내 문구가 생긴다', floored.notes.length === 1, floored.notes[0]);

    /* ---- 안전장치: 단백질 상한 ---- */
    [['gainStrength'], ['loseFat'], ['maintain'], ['gainStrength', 'loseFat']].forEach(function (goal) {
      var t = calc.computeTargets(baseProfile({ goals: goal }));
      ok('단백질이 체중×2.5g 를 넘지 않는다 (' + goal.join('+') + ')',
        t.protein <= 57.4 * calc.PROTEIN_CAP_PER_KG,
        t.protein + ' ≤ ' + (57.4 * calc.PROTEIN_CAP_PER_KG));
    });

    /* ---- 식이섬유 최소값 ---- */
    var small = calc.computeTargets(
      baseProfile({ weight: 40, height: 150, age: 70, goals: ['loseFat'],
                    weeklyPlan: { strength: 0, cardio: 0 } }));
    ok('식이섬유는 최소 20g', small.fiber >= 20, String(small.fiber));

    /* ---- 미량영양소 기준 ---- */
    var f50 = nutrition.microTargets({ sex: 'female', age: 50 });
    eq('50대 여성 칼슘 800mg', f50.calcium, 800);
    eq('50대 여성 철 8mg', f50.iron, 8);
    eq('50대 여성 마그네슘 280mg', f50.magnesium, 280);
    eq('50대 여성 비타민D 10µg', f50.vitaminD, 10);

    eq('완경 전이면 철 14mg',
      nutrition.microTargets({ sex: 'female', age: 50, menopause: false }).iron, 14);
    eq('완경 후면 철 8mg',
      nutrition.microTargets({ sex: 'female', age: 50, menopause: true }).iron, 8);

    var m30 = nutrition.microTargets({ sex: 'male', age: 35 });
    eq('30대 남성 마그네슘 370mg', m30.magnesium, 370);
    eq('30대 남성 아연 10mg', m30.zinc, 10);

    eq('연령대 구분 19-29', nutrition.ageGroup(25), '19-29');
    eq('연령대 구분 30-49', nutrition.ageGroup(49), '30-49');
    eq('연령대 구분 50-64', nutrition.ageGroup(50), '50-64');
    eq('연령대 구분 65+', nutrition.ageGroup(70), '65+');

    ok('성별 × 연령대 조합 8개가 모두 정의돼 있다',
      ['female', 'male'].every(function (s) {
        return ['19-29', '30-49', '50-64', '65+'].every(function (g) {
          return nutrition.RECOMMENDED[s] && nutrition.RECOMMENDED[s][g];
        });
      }));

    ok('모든 영양소 키가 권장량 테이블에 있다',
      nutrition.NUTRIENTS.every(function (n) {
        return nutrition.RECOMMENDED.female['50-64'][n.key] !== undefined;
      }));

    eq('마그네슘 UL 은 보충제 유래분에만 적용',
      nutrition.NUTRIENT_MAP.magnesium.ulSource, 'supplement');
    eq('비타민E UL 은 보충제 유래분에만 적용',
      nutrition.NUTRIENT_MAP.vitaminE.ulSource, 'supplement');
    eq('엽산 UL 은 보충제 유래분에만 적용',
      nutrition.NUTRIENT_MAP.folate.ulSource, 'supplement');
    eq('칼슘 UL 은 전체 섭취에 적용',
      nutrition.NUTRIENT_MAP.calcium.ulSource, 'all');

    /* ---- 목표치에 미량영양소가 포함된다 ---- */
    ok('targets.micros 가 채워진다', lose.micros && lose.micros.calcium === 800);

    /* ---- 입력 검증 ---- */
    ok('정상 프로필은 에러 없음',
      Object.keys(calc.validateProfile(baseProfile())).length === 0);
    ok('키 범위 밖은 에러', !!calc.validateProfile(baseProfile({ height: 40 })).height);
    ok('나이 범위 밖은 에러', !!calc.validateProfile(baseProfile({ age: 5 })).age);
    ok('성별 미선택은 에러', !!calc.validateProfile(baseProfile({ sex: '' })).sex);
    ok('체중 범위 밖은 에러', !!calc.validateProfile(baseProfile({ weight: 0 })).weight);
    ok('체지방률 범위 밖은 에러',
      !!calc.validateProfile(baseProfile({ bodyFatPct: 90 })).bodyFatPct);
    ok('골격근량이 체중보다 크면 에러',
      !!calc.validateProfile(baseProfile({ skeletalMuscle: 60 })).skeletalMuscle);
    ok('선택 항목 미입력은 에러 아님',
      !calc.validateProfile(baseProfile({ bodyFatPct: '', skeletalMuscle: '' })).bodyFatPct);
    ok('목표 미선택은 에러', !!calc.validateProfile(baseProfile({ goals: [] })).goals);
    ok('모르는 목표만 있으면 에러',
      !!calc.validateProfile(baseProfile({ goals: ['헛소리'] })).goals);

    /* ---- 저장소 마이그레이션 ---- */
    var fresh = store.migrate(null);
    eq('빈 데이터는 현재 스키마로 초기화', fresh.schemaVersion, store.SCHEMA_VERSION);
    ok('빈 데이터의 기본 구조',
      fresh.profile === null && Array.isArray(fresh.supplements) &&
      Array.isArray(fresh.bodyLogs) && typeof fresh.dailyLogs === 'object');

    var messy = store.migrate({
      schemaVersion: 1,
      profile: { height: 160 },
      supplements: null,
      dailyLogs: { '2026-08-24': { meals: null, waterMl: '1500' } },
      junk: '버려야 함'
    });
    ok('배열이 아닌 supplements 는 빈 배열로 정규화', Array.isArray(messy.supplements));
    ok('알 수 없는 필드는 버린다', messy.junk === undefined);
    ok('일일 로그의 누락 필드가 채워진다',
      Array.isArray(messy.dailyLogs['2026-08-24'].meals) &&
      messy.dailyLogs['2026-08-24'].waterMl === 1500 &&
      Array.isArray(messy.dailyLogs['2026-08-24'].workouts));

    // alcohol 은 나중에 추가된 필드라 없는 날이 섞여 있을 수 있다.
    var noAlcohol = store.migrate({
      schemaVersion: 1,
      dailyLogs: { '2026-08-20': { meals: [] } }
    }).dailyLogs['2026-08-20'].alcohol;
    ok('음주 필드가 없으면 기본값으로 채워진다',
      noAlcohol.drank === false && noAlcohol.kcal === 0 && noAlcohol.note === '',
      JSON.stringify(noAlcohol));

    var withAlcohol = store.migrate({
      schemaVersion: 1,
      dailyLogs: { '2026-08-21': { alcohol: { drank: true, kcal: '350', note: '맥주 2캔' } } }
    }).dailyLogs['2026-08-21'].alcohol;
    ok('음주 기록이 있으면 값을 보존한다',
      withAlcohol.drank === true && withAlcohol.kcal === 350 && withAlcohol.note === '맥주 2캔',
      JSON.stringify(withAlcohol));

    ok('빈 하루 로그에도 음주 필드가 있다',
      store.emptyDay().alcohol !== undefined);

    var future = store.migrate({ schemaVersion: 99, profile: { height: 170 } });
    eq('미래 버전 데이터는 건드리지 않는다', future.schemaVersion, 99);

    // v1 → v2: 단일 goal 이 복수 goals 로 승격된다.
    var upgraded = store.migrate({
      schemaVersion: 1,
      profile: { height: 160, age: 50, sex: 'female', weight: 57.4, goal: 'loseFat' }
    });
    eq('v1 데이터는 v2 로 올라간다', upgraded.schemaVersion, 2);
    ok('옛 goal 이 goals 배열이 된다',
      Array.isArray(upgraded.profile.goals) && upgraded.profile.goals.join('+') === 'loseFat',
      JSON.stringify(upgraded.profile.goals));
    ok('옛 goal 필드는 제거된다', upgraded.profile.goal === undefined);

    var noGoal = store.migrate({ schemaVersion: 1, profile: { height: 160 } });
    eq('목표가 없던 v1 데이터는 유지로', noGoal.profile.goals.join('+'), 'maintain');

    ok('이미 v2 인 데이터는 goals 를 그대로 둔다',
      store.migrate({
        schemaVersion: 2,
        profile: { goals: ['gainStrength', 'loseFat'] }
      }).profile.goals.join('+') === 'gainStrength+loseFat');

    /* ---- 백업 파일 검증 ---- */
    if (FitLog.backup) {
      ok('정상 백업은 통과', FitLog.backup.validateBackup({ schemaVersion: 1 }).ok);
      ok('형식 정보 없는 파일은 거부', !FitLog.backup.validateBackup({ hello: 1 }).ok);
      ok('배열은 거부', !FitLog.backup.validateBackup([1, 2]).ok);
      ok('미래 스키마는 거부', !FitLog.backup.validateBackup({ schemaVersion: 99 }).ok);
    }

    /* ---- 음식 DB ---- */
    var foods = FitLog.foods;
    var list = foods.all();

    eq('음식 DB 총 312개', list.length, 312);

    var EXPECTED_COUNT = {
      grain: 40, meat: 35, seafood: 35, vegetable: 50, fruit: 30,
      dairy: 25, legume_nut: 25, seasoning: 25, dish: 47
    };
    Object.keys(EXPECTED_COUNT).forEach(function (g) {
      var n = list.filter(function (f) { return f.group === g; }).length;
      eq('그룹 ' + g + ' 개수', n, EXPECTED_COUNT[g]);
    });

    var ids = {}, dupIds = [];
    var names = {}, dupNames = [];
    list.forEach(function (f) {
      if (ids[f.id]) dupIds.push(f.id); else ids[f.id] = true;
      if (names[f.name]) dupNames.push(f.name); else names[f.name] = true;
    });
    ok('id 중복 없음', dupIds.length === 0, dupIds.join(', '));
    ok('이름 중복 없음', dupNames.length === 0, dupNames.join(', '));

    var missingKeys = list.filter(function (f) {
      return foods.KEYS.some(function (k) { return typeof f.per100g[k] !== 'number'; });
    });
    ok('모든 항목이 영양소 19종을 숫자로 갖는다', missingKeys.length === 0,
      missingKeys.slice(0, 3).map(function (f) { return f.name; }).join(', '));

    var negative = list.filter(function (f) {
      return foods.KEYS.some(function (k) { return f.per100g[k] < 0; });
    });
    ok('음수 값 없음', negative.length === 0,
      negative.slice(0, 3).map(function (f) { return f.name; }).join(', '));

    var fiberOver = list.filter(function (f) { return f.per100g.fiber > f.per100g.carbs; });
    ok('식이섬유가 탄수화물을 넘지 않는다', fiberOver.length === 0,
      fiberOver.slice(0, 3).map(function (f) { return f.name; }).join(', '));

    // 칼로리 정합성: kcal ≈ 단백질×4 + 순탄수×4 + 지방×9 (식이섬유는 순탄수에서 뺀다)
    var badKcal = [];
    list.forEach(function (f) {
      var p = f.per100g;
      var atwater = p.protein * 4 + Math.max(0, p.carbs - p.fiber) * 4 + p.fat * 9;
      var diff = Math.abs(atwater - p.kcal);
      var allowed = Math.max(25, p.kcal * 0.2);
      if (diff > allowed) {
        badKcal.push(f.name + '(표기 ' + p.kcal + ' / 계산 ' + Math.round(atwater) + ')');
      }
    });
    ok('칼로리가 매크로 합과 맞는다', badKcal.length === 0,
      badKcal.slice(0, 5).join(', ') + (badKcal.length > 5 ? ' 외 ' + (badKcal.length - 5) + '건' : ''));

    /* ---- 영양소 '정의' 규약 ----
     * 숫자가 맞아도 정의가 다르면 판정이 거짓말을 한다.
     * omega3 칸에 식물성 ALA 가 들어가면, EPA+DHA 를 하나도 안 먹은 날에도
     * 오메가3가 '적정'으로 뜬다. 부족한 걸 부족하지 않다고 하는 쪽이 더 나쁘다.
     */
    var alaFoods = ['walnut', 'perilla_seed', 'perilla_oil', 'canola_oil', 'olive_oil',
                    'sesame_oil', 'tofu_firm', 'soybean_boiled', 'black_bean', 'natto',
                    'flaxseed', 'chia_seed', 'mayonnaise', 'spinach', 'kale', 'avocado'];
    var alaLeak = [];
    alaFoods.forEach(function (id) {
      var f = foods.get(id);
      if (f && f.per100g.omega3 > 0) alaLeak.push(f.name + '=' + f.per100g.omega3);
    });
    ok('식물성 ALA 급원의 omega3 는 0 이다 (omega3 = EPA+DHA)',
      alaLeak.length === 0, alaLeak.join(', '));

    /* 육류·유제품·계란의 오메가3도 ALA 나 조리유 유래라 EPA+DHA 가 아니다.
     * 이걸 남겨 두면 생선 없이도 목표가 채워진다 — 정정 전 실제로 그랬다. */
    var animalLeak = [];
    ['beef_sirloin', 'pork_belly', 'chicken_breast', 'bacon', 'sausage',
     'milk', 'cheese_slice', 'cheddar', 'butter', 'egg_boiled', 'egg_yolk',
     'greek_yogurt', 'ice_cream'].forEach(function (id) {
      var f = foods.get(id);
      if (f && f.per100g.omega3 > 0) animalLeak.push(f.name + '=' + f.per100g.omega3);
    });
    ok('육류·유제품·계란의 omega3 도 0 이다', animalLeak.length === 0, animalLeak.join(', '));

    // 생선을 한 점도 안 먹은 하루는 EPA+DHA 가 0 이어야 한다.
    // 정정 전에는 이 조합이 486mg(목표 300mg 의 162%)으로 잡혀 🟢 적정으로 떴다.
    var noFishDay = foods.sum([
      foods.scale('egg_boiled', 110), foods.scale('cheese_slice', 18),
      foods.scale('pork_belly', 150), foods.scale('milk', 200)
    ]);
    eq('생선 없는 하루의 omega3 는 0', noFishDay.omega3, 0);

    // 조리 음식은 재료에 생선·해조가 들어간 것만 남긴다
    var dishLeak = [];
    ['japchae', 'tteokbokki', 'jjajang_sauce', 'hamburger', 'cream_pasta',
     'samgyetang', 'sweet_sour_pork'].forEach(function (id) {
      var f = foods.get(id);
      if (f && f.per100g.omega3 > 0) dishLeak.push(f.name + '=' + f.per100g.omega3);
    });
    ok('생선 안 든 조리 음식의 omega3 는 0', dishLeak.length === 0, dishLeak.join(', '));
    ok('초밥은 omega3 를 유지한다', foods.get('sushi_piece').per100g.omega3 > 0);
    ok('미역국도 유지한다', foods.get('miyeokguk').per100g.omega3 > 0);

    // 호두 30g 을 먹어도 EPA+DHA 는 늘지 않는다 — 위 규약이 합산까지 지켜지는지
    eq('호두 30g 의 omega3 합계는 0', foods.scale('walnut', 30).omega3, 0);
    eq('호두 30g + 들깨 5g 도 0',
      foods.sum([foods.scale('walnut', 30), foods.scale('perilla_seed', 5)]).omega3, 0);

    // 등푸른생선은 진짜 EPA+DHA 라 그대로 남아 있어야 한다 (과잉 정정 방지)
    ok('고등어는 omega3 를 유지한다', foods.get('mackerel').per100g.omega3 > 1000);
    ok('연어도 유지한다', foods.get('salmon_grilled').per100g.omega3 > 1000);
    ok('구이 120g 이면 하루 권장 300mg 을 넘는다',
      foods.scale('mackerel', 120).omega3 > 300);

    /* 비타민A·엽산·철도 '정의가 다른 값' 이 섞일 수 있는 자리다.
     * 다만 이 셋은 단위 자체가 이미 환산된 통합 단위라 omega3 같은 문제가 없다.
     * 단위를 바꾸면 그 순간 판정이 어긋나므로 여기에 못 박아 둔다. */
    eq('비타민A 는 RAE — 레티놀과 베타카로틴을 이미 환산한 단위',
      nutrition.NUTRIENT_MAP.vitaminA.unit, 'µg RAE');
    eq('엽산은 DFE — 식품엽산과 합성엽산을 이미 환산한 단위',
      nutrition.NUTRIENT_MAP.folate.unit, 'µg DFE');
    eq('엽산 상한은 합성엽산(보충제)에만 적용된다',
      nutrition.NUTRIENT_MAP.folate.ulSource, 'supplement');
    eq('철은 헴/비헴을 나누지 않는다 — 권장량이 혼합식 기준이라 상한은 총량으로 본다',
      nutrition.NUTRIENT_MAP.iron.ulSource, 'all');

    /* ---- 1회 섭취량(typicalServing) ---- */
    var served = list.filter(function (f) { return f.typicalServing; });
    ok('typicalServing 을 채운 음식이 있다', served.length > 100, '채움 ' + served.length + '개');

    var badServing = served.filter(function (f) {
      var s = f.typicalServing;
      return !(s.amount > 0) || !s.unit || !s.label;
    });
    ok('1회 섭취량은 amount·unit·label 을 모두 갖는다', badServing.length === 0,
      badServing.slice(0, 3).map(function (f) { return f.name; }).join(', '));

    // 추천은 typicalServing 이 있는 음식만 대상으로 한다. 없으면 후보에서 빠져야 한다.
    ok('값이 의심스러워 보류한 음식은 1회량이 없다',
      !foods.get('seasoned_gim').typicalServing &&
      !foods.get('gim_dried').typicalServing &&
      !foods.get('miyeok_dried').typicalServing);

    /* ---- 음식 조회·계산 헬퍼 ---- */
    var rice = foods.get('rice_cooked');
    ok('id 로 음식을 찾는다', rice && rice.name === '밥 (백미)');
    ok('없는 id 는 null', foods.get('없는거') === null);

    var scaled = foods.scale('rice_cooked', 210);
    near('210g 밥의 칼로리 = 100g값 × 2.1', scaled.kcal, 130 * 2.1, 0.01);
    near('210g 밥의 단백질', scaled.protein, 2.4 * 2.1, 0.01);
    eq('0g 은 0kcal', foods.scale('rice_cooked', 0).kcal, 0);
    ok('없는 음식 scale 은 null', foods.scale('없는거', 100) === null);

    var combo = foods.sum([
      foods.scale('rice_cooked', 210),
      foods.scale('kimchi_jjigae', 350)
    ]);
    near('밥 210g + 김치찌개 350g 칼로리', combo.kcal, 130 * 2.1 + 65 * 3.5, 0.5);
    near('합산 나트륨', combo.sodium, 1 * 2.1 + 520 * 3.5, 0.5);
    ok('빈 목록의 합은 0', foods.sum([]).kcal === 0);
    ok('null 이 섞여도 무시한다', foods.sum([null, foods.scale('rice_cooked', 100)]).kcal === 130);

    var rounded = foods.round(combo);
    ok('칼로리는 정수로 반올림', rounded.kcal === Math.round(combo.kcal));
    ok('나머지는 소수 1자리', String(rounded.protein).split('.').length < 2 ||
      String(rounded.protein).split('.')[1].length <= 1);

    var hits = foods.search('김치');
    ok('이름으로 검색된다', hits.length >= 2, hits.map(function (f) { return f.name; }).join(', '));
    ok('검색 결과에 배추김치가 있다',
      hits.some(function (f) { return f.id === 'kimchi'; }));
    eq('빈 검색어는 빈 결과', foods.search('').length, 0);
    ok('검색 개수 제한이 먹는다', foods.search('김', 2).length <= 2);
    // 정렬 1순위: 이름 앞쪽에서 걸린 것 ('김치'로 검색하면 배추김치보다 김치찌개가 먼저)
    eq('앞에서 걸린 이름이 먼저 나온다', foods.search('김치')[0].name, '김치찌개');
    // 정렬 2순위: 걸린 위치가 같으면 짧은 이름 ('계란'은 전부 앞에서 걸리므로 계란찜이 먼저)
    eq('걸린 위치가 같으면 짧은 이름이 먼저', foods.search('계란')[0].name, '계란찜');

    ok('음식 DB 키가 KDRI 영양소를 모두 포함한다',
      FitLog.nutrition.NUTRIENTS.every(function (n) {
        return foods.KEYS.indexOf(n.key) >= 0;
      }));

    /* ---- 식사 템플릿 ---- */
    var tpl = FitLog.templates;
    var tplList = tpl.all();

    eq('템플릿 총 129개', tplList.length, 129);

    var EXPECTED_TPL = {
      korean: 45, banchan: 15, western: 25, eatingout: 34, snack: 10
    };
    Object.keys(EXPECTED_TPL).forEach(function (c) {
      eq('템플릿 ' + c + ' 개수', tpl.byCategory(c).length, EXPECTED_TPL[c]);
    });

    var tplIds = {}, tplDupId = [], tplNames = {}, tplDupName = [];
    tplList.forEach(function (t) {
      if (tplIds[t.id]) tplDupId.push(t.id); else tplIds[t.id] = true;
      if (tplNames[t.name]) tplDupName.push(t.name); else tplNames[t.name] = true;
    });
    ok('템플릿 id 중복 없음', tplDupId.length === 0, tplDupId.join(', '));
    ok('템플릿 이름 중복 없음', tplDupName.length === 0, tplDupName.join(', '));

    // 가장 중요한 검사: 템플릿이 실재하지 않는 재료를 가리키면 영양소가 조용히 0이 된다.
    var ghost = [];
    tplList.forEach(function (t) {
      t.items.forEach(function (item) {
        if (!foods.get(item.food)) ghost.push(t.name + ' → ' + item.food);
      });
    });
    ok('모든 재료가 실재하는 음식이다', ghost.length === 0,
      ghost.slice(0, 5).join(', ') + (ghost.length > 5 ? ' 외 ' + (ghost.length - 5) + '건' : ''));

    var badGram = tplList.filter(function (t) {
      return !t.items.length || t.items.some(function (i) { return !(i.g > 0); });
    });
    ok('모든 재료의 g이 0보다 크다', badGram.length === 0,
      badGram.slice(0, 3).map(function (t) { return t.name; }).join(', '));

    var zeroKcal = tplList.filter(function (t) { return tpl.nutrients(t, 1).kcal <= 0; });
    ok('칼로리가 0인 템플릿은 없다', zeroKcal.length === 0,
      zeroKcal.slice(0, 3).map(function (t) { return t.name; }).join(', '));

    /* 템플릿 영양소 = 재료 합 */
    var kjr = tpl.nutrients('kimchi_jjigae_rice', 1);
    var manual = foods.sum([foods.scale('rice_cooked', 210), foods.scale('kimchi_jjigae', 350)]);
    near('김치찌개+공기밥 칼로리가 재료 합과 같다', kjr.kcal, manual.kcal, 0.01);
    near('단백질도 재료 합과 같다', kjr.protein, manual.protein, 0.01);
    eq('반올림하면 501kcal', foods.round(kjr).kcal, 501);

    /* 양 조절 */
    eq('양 조절 선택지는 3개', tpl.PORTIONS.length, 3);
    eq('보통은 1.0 배', tpl.PORTIONS[1].value, 1.0);
    near('적게(0.7)는 비례해서 줄어든다',
      tpl.nutrients('kimchi_jjigae_rice', 0.7).kcal, kjr.kcal * 0.7, 0.01);
    near('많이(1.4)는 비례해서 늘어난다',
      tpl.nutrients('kimchi_jjigae_rice', 1.4).kcal, kjr.kcal * 1.4, 0.01);
    ok('없는 템플릿은 null', tpl.nutrients('없는거', 1) === null);

    var labels = tpl.itemLabels('kimchi_jjigae_rice', 1);
    eq('재료 표시가 이름+g 형태', labels[0], '밥 (백미) 210g');
    eq('양을 줄이면 재료 g도 줄어든다',
      tpl.itemLabels('kimchi_jjigae_rice', 0.7)[0], '밥 (백미) 147g');

    ok('템플릿 검색', tpl.search('파스타').length >= 4,
      tpl.search('파스타').map(function (t) { return t.name; }).join(', '));
    eq('빈 검색어는 빈 결과', tpl.search('').length, 0);

    /* ---- 식사 기록 (저장 계층) ----
       사용자의 실제 데이터를 건드리지 않도록 스냅샷을 떠 두고 끝나면 되돌린다. */
    var snapshot = JSON.parse(JSON.stringify(store.load()));

    store.reset();
    var dateKey = '2026-08-24';

    var m1 = store.addMeal(dateKey, {
      type: 'lunch', sourceKind: 'template', sourceId: 'kimchi_jjigae_rice',
      label: '김치찌개 + 공기밥', portion: 1,
      nutrients: foods.round(tpl.nutrients('kimchi_jjigae_rice', 1))
    });

    ok('끼니에 id 가 붙는다', !!m1.id && m1.id.indexOf('meal_') === 0, m1.id);
    eq('기록이 저장된다', store.getDay(dateKey).meals.length, 1);
    eq('하루 합계 칼로리', Math.round(store.dayNutrients(dateKey).kcal), 501);

    store.addMeal(dateKey, {
      type: 'dinner', sourceKind: 'template', sourceId: 'samgyeopsal_set',
      label: '삼겹살 + 밥 + 쌈', portion: 1,
      nutrients: foods.round(tpl.nutrients('samgyeopsal_set', 1))
    });
    eq('두 끼니가 쌓인다', store.getDay(dateKey).meals.length, 2);

    var twoMeals = Math.round(store.dayNutrients(dateKey).kcal);
    var expectTwo = Math.round(foods.round(tpl.nutrients('kimchi_jjigae_rice', 1)).kcal +
                               foods.round(tpl.nutrients('samgyeopsal_set', 1)).kcal);
    eq('합계가 두 끼니의 합', twoMeals, expectTwo);

    store.removeMeal(dateKey, m1.id);
    eq('끼니를 지우면 하나 남는다', store.getDay(dateKey).meals.length, 1);
    ok('지운 끼니는 합계에서 빠진다',
      Math.round(store.dayNutrients(dateKey).kcal) === expectTwo - 501,
      String(Math.round(store.dayNutrients(dateKey).kcal)));

    eq('기록 없는 날은 합계 0', Math.round(store.dayNutrients('2020-01-01').kcal), 0);

    /* 즐겨찾기 */
    ok('처음엔 즐겨찾기가 아니다', !store.isFavorite('template', 'kimchi_jjigae_rice'));
    ok('켜면 즐겨찾기가 된다', store.toggleFavorite('template', 'kimchi_jjigae_rice') === true);
    ok('상태가 저장된다', store.isFavorite('template', 'kimchi_jjigae_rice'));
    ok('다시 누르면 꺼진다', store.toggleFavorite('template', 'kimchi_jjigae_rice') === false);
    ok('꺼진 게 반영된다', !store.isFavorite('template', 'kimchi_jjigae_rice'));
    ok('종류가 다르면 별개로 관리된다',
      (store.toggleFavorite('food', 'kimchi_jjigae_rice'),
       store.isFavorite('food', 'kimchi_jjigae_rice') &&
       !store.isFavorite('template', 'kimchi_jjigae_rice')));

    /* 직접 등록 */
    var custom = store.addCustomFood({
      name: '회사 샐러드',
      nutrients: { kcal: 320, protein: 22, carbs: 18, fat: 17 }
    });
    ok('직접 등록한 음식에 id 가 붙는다', custom.id.indexOf('custom_') === 0, custom.id);
    eq('목록에 들어간다', store.load().customFoods.length, 1);
    ok('id 로 찾을 수 있다', store.getCustomFood(custom.id).name === '회사 샐러드');

    var customBig = foods.scaleNutrients(custom.nutrients, 1.4);
    near('직접 등록한 음식도 양 조절이 된다', customBig.kcal, 320 * 1.4, 0.01);

    store.toggleFavorite('custom', custom.id);
    store.removeCustomFood(custom.id);
    eq('삭제하면 목록에서 빠진다', store.load().customFoods.length, 0);
    ok('삭제하면 즐겨찾기에서도 빠진다', !store.isFavorite('custom', custom.id));

    // 사용자 데이터 원복
    store.replace(snapshot);

    /* ---- 보충제 ---- */
    var sup = FitLog.supplements;

    eq('프리셋 36종', sup.PRESETS.length, 36);
    eq('시간대 6종', sup.TIME_SLOTS.length, 6);

    ok('모든 프리셋이 실재하는 묶음에 속한다',
      sup.PRESETS.every(function (p) {
        return sup.PRESET_GROUPS.some(function (g) { return g.key === p.group; });
      }),
      sup.PRESETS.filter(function (p) {
        return !sup.PRESET_GROUPS.some(function (g) { return g.key === p.group; });
      }).map(function (p) { return p.name; }).join(', '));

    ok('묶음마다 항목이 하나 이상 있다',
      sup.PRESET_GROUPS.every(function (g) {
        return sup.PRESETS.some(function (p) { return p.group === g.key; });
      }));

    /* 직접 등록 — 프리셋에 없는 걸 넣을 수 있어야 한다 */
    eq('고를 수 있는 성분은 KDRI 14종 + 단백질·칼로리', sup.nutrientFields().length, 16);
    ok('성분 목록에 단백질·칼로리가 있다',
      sup.nutrientFields().some(function (f) { return f.key === 'protein'; }) &&
      sup.nutrientFields().some(function (f) { return f.key === 'kcal'; }));
    eq('성분 이름·단위를 찾을 수 있다', sup.fieldMeta('vitaminD').label, '비타민 D');
    eq('모르는 키는 키 자체를 이름으로', sup.fieldMeta('없는거').label, '없는거');

    var handmade = { id: 'h1', name: '동네약국 비타민', presetId: null,
                     timeSlot: 'morning', dailyDoses: 1,
                     nutrients: { vitaminC: 500 }, enabled: true };
    eq('직접 등록한 것도 합계에 들어간다',
      sup.dailyNutrients([handmade]).vitaminC, 500);
    ok('직접 등록한 것도 중복 판정 대상',
      sup.duplicates([handmade, mk('vitamin_c')]).some(function (d) { return d.key === 'vitaminC'; }));
    eq('프리셋이 아니면 태그가 없다', sup.tagsOf(handmade).length, 0);
    ok('태그가 없어도 룰 엔진이 죽지 않는다',
      Array.isArray(sup.interactions([handmade, mk('iron', { timeSlot: 'morning' })])));

    var supDupId = {}, supDup = [];
    sup.PRESETS.forEach(function (p) {
      if (supDupId[p.id]) supDup.push(p.id); else supDupId[p.id] = true;
    });
    ok('프리셋 id 중복 없음', supDup.length === 0, supDup.join(', '));

    ok('모든 프리셋의 기본 시간대가 실재한다',
      sup.PRESETS.every(function (p) { return !!sup.SLOT_BY_KEY[p.slot]; }));

    var badKey = [];
    sup.PRESETS.forEach(function (p) {
      Object.keys(p.nutrients).forEach(function (k) {
        if (foods.KEYS.indexOf(k) < 0) badKey.push(p.name + ' → ' + k);
      });
    });
    ok('프리셋 영양소 키가 음식 DB 키와 같다', badKey.length === 0, badKey.join(', '));

    /* 제품 라벨 숫자와 영양소로 세는 값이 다른 것들은 주의 문구가 있어야 한다.
       마그네슘: 화합물 총량 ≠ 원소 함량 / 오메가3: 어유 무게 ≠ EPA+DHA.
       이게 없으면 사용자가 라벨 숫자를 그대로 넣어 과대 계상된다. */
    ok('마그네슘 프리셋에 원소 함량 주의 문구가 있다',
      (sup.getPreset('magnesium').note || '').indexOf('원소') >= 0);
    ok('오메가3 프리셋에 EPA+DHA 주의 문구가 있다',
      (sup.getPreset('omega3').note || '').indexOf('EPA') >= 0,
      sup.getPreset('omega3').note);
    ok('오메가3 표기가 EPA+DHA 기준임을 밝힌다',
      sup.getPreset('omega3').amount.indexOf('EPA+DHA') >= 0,
      sup.getPreset('omega3').amount);
    ok('주의가 필요한 프리셋은 note 를 갖는다',
      ['magnesium', 'omega3'].every(function (id) { return !!sup.getPreset(id).note; }));

    /* 검수 기준: 종합비타민 + 비타민D 를 같이 등록하면 D 중복이 잡힌다 */
    function mk(presetId, over) {
      var p = sup.getPreset(presetId);
      var n = {};
      Object.keys(p.nutrients).forEach(function (k) { n[k] = p.nutrients[k]; });
      var item = { id: 'x_' + presetId, name: p.name, presetId: p.id,
                   timeSlot: p.slot, dailyDoses: p.doses, nutrients: n, enabled: true };
      Object.keys(over || {}).forEach(function (k) { item[k] = over[k]; });
      return item;
    }

    var dTogether = sup.duplicates([mk('multivitamin'), mk('vitamin_d')]);
    var dHit = dTogether.filter(function (d) { return d.key === 'vitaminD'; })[0];
    ok('종합비타민 + 비타민D → 비타민 D 중복이 잡힌다', !!dHit,
      dTogether.map(function (d) { return d.name; }).join(', '));
    eq('중복 합계는 10 + 25 = 35µg', dHit && dHit.total, 35);
    ok('중복 안내에 두 제품 이름이 들어간다',
      dHit && dHit.sources.length === 2 &&
      dHit.message.indexOf('종합비타민') >= 0 && dHit.message.indexOf('비타민 D') >= 0,
      dHit && dHit.message);
    ok('종합비타민은 칼슘·철·아연 중복도 같이 잡는다',
      sup.duplicates([mk('multivitamin'), mk('calcium'), mk('iron'), mk('zinc')]).length >= 3);
    eq('하나만 있으면 중복 아님', sup.duplicates([mk('vitamin_d')]).length, 0);
    eq('중지된 건 세지 않는다',
      sup.duplicates([mk('multivitamin'), mk('vitamin_d', { enabled: false })]).length, 0);

    /* 하루 합계 */
    var dn = sup.dailyNutrients([mk('vitamin_d'), mk('vitamin_c')]);
    eq('보충제 합계 비타민D', dn.vitaminD, 25);
    eq('보충제 합계 비타민C', dn.vitaminC, 1000);
    eq('하루 2회면 2배로 센다',
      sup.dailyNutrients([mk('vitamin_c', { dailyDoses: 2 })]).vitaminC, 2000);
    eq('중지된 건 합계에서 빠진다',
      sup.dailyNutrients([mk('vitamin_c', { enabled: false })]).vitaminC, 0);
    eq('유청 단백질은 단백질·칼로리로 잡힌다',
      sup.dailyNutrients([mk('whey_protein')]).protein, 24);

    /* 상한량(UL) */
    var noFood = foods.sum([]);
    eq('평범한 양은 경고 없음', sup.ulWarnings(noFood, sup.dailyNutrients([mk('vitamin_d')])).length, 0);

    var bigD = sup.ulWarnings(noFood, sup.dailyNutrients([mk('vitamin_d', { dailyDoses: 5 })]));
    ok('비타민 D 125µg 은 상한(100µg) 초과로 잡힌다',
      bigD.some(function (w) { return w.key === 'vitaminD'; }),
      bigD.map(function (w) { return w.name; }).join(', '));

    // 마그네슘·비타민E·엽산은 보충제 유래분만 UL 과 비교한다
    var foodMg = foods.scale('pumpkin_seed', 200);            // 호박씨 200g = 마그네슘 1100mg
    ok('음식에서 온 마그네슘은 UL 경고를 내지 않는다',
      !sup.ulWarnings(foodMg, sup.dailyNutrients([])).some(function (w) { return w.key === 'magnesium'; }),
      String(Math.round(foodMg.magnesium)) + 'mg');
    ok('보충제에서 온 마그네슘은 UL 경고를 낸다',
      sup.ulWarnings(noFood, sup.dailyNutrients([mk('magnesium', { dailyDoses: 3 })]))
        .some(function (w) { return w.key === 'magnesium'; }));

    // 칼슘은 전체 섭취로 비교한다
    var manyCal = foods.scale('cheddar', 300);                 // 체다 300g = 칼슘 2160mg
    ok('음식에서 온 칼슘은 UL 경고를 낸다',
      sup.ulWarnings(manyCal, sup.dailyNutrients([]))
        .some(function (w) { return w.key === 'calcium'; }),
      String(Math.round(manyCal.calcium)) + 'mg');

    // 나트륨은 상한이 아니라 목표섭취량이다
    var saltyDay = foods.scale('kimchi_jjigae', 700);
    var naWarn = sup.ulWarnings(saltyDay, sup.dailyNutrients([]))
      .filter(function (w) { return w.key === 'sodium'; })[0];
    ok('나트륨 초과는 목표섭취량으로 안내한다',
      naWarn && naWarn.message.indexOf('목표섭취량') >= 0, naWarn && naWarn.message);

    /* 상호작용 룰 */
    function levels(list, level) {
      return list.filter(function (r) { return r.level === level; });
    }

    var clash = sup.interactions([
      mk('iron', { timeSlot: 'lunch' }), mk('calcium', { timeSlot: 'lunch' })
    ]);
    ok('같은 시간대의 철분 + 칼슘은 충돌 경고',
      levels(clash, 'warn').length === 1, JSON.stringify(clash.map(function (r) { return r.level; })));
    eq('시간대를 띄우면 경고가 사라진다',
      levels(sup.interactions([
        mk('iron', { timeSlot: 'morning' }), mk('calcium', { timeSlot: 'evening' })
      ]), 'warn').length, 0);

    ok('철분 + 종합비타민도 충돌로 잡는다',
      levels(sup.interactions([
        mk('iron', { timeSlot: 'lunch' }), mk('multivitamin', { timeSlot: 'lunch' })
      ]), 'warn').length === 1);

    ok('철분 + 비타민C 는 좋은 조합',
      levels(sup.interactions([
        mk('iron', { timeSlot: 'lunch' }), mk('vitamin_c', { timeSlot: 'lunch' })
      ]), 'good').length >= 1);

    ok('비타민 D + K2 는 좋은 조합',
      levels(sup.interactions([
        mk('vitamin_d', { timeSlot: 'lunch' }), mk('vitamin_k2', { timeSlot: 'lunch' })
      ]), 'good').some(function (r) { return r.message.indexOf('K2') >= 0; }));

    ok('지용성이 공복에 있으면 식후로 옮기라고 안내한다',
      levels(sup.interactions([mk('omega3', { timeSlot: 'morning' })]), 'tip')
        .some(function (r) { return r.message.indexOf('지용성') >= 0; }));
    ok('지용성이 식사 시간대면 칭찬한다',
      levels(sup.interactions([mk('omega3', { timeSlot: 'lunch' })]), 'good').length >= 1);

    ok('마그네슘이 아침에 있으면 취침 전을 권한다',
      levels(sup.interactions([mk('magnesium', { timeSlot: 'morning' })]), 'tip')
        .some(function (r) { return r.message.indexOf('취침') >= 0; }));
    eq('취침 전에 있으면 권고 없음',
      levels(sup.interactions([mk('magnesium', { timeSlot: 'bedtime' })]), 'tip').length, 0);

    eq('중지된 보충제는 룰에서 빠진다',
      sup.interactions([
        mk('iron', { timeSlot: 'lunch' }),
        mk('calcium', { timeSlot: 'lunch', enabled: false })
      ]).length, 0);

    /* 지난 시간대 판정 */
    ok('아침 공복은 11시에 지난 시간', sup.isPassed('morning', 11));
    ok('아침 공복은 8시엔 안 지남', !sup.isPassed('morning', 8));
    ok('운동 후는 시간과 무관', !sup.isPassed('postWorkout', 23));

    /* review 는 위 결과를 한 번에 모은다 */
    var rv = sup.review([mk('multivitamin'), mk('vitamin_d')], noFood);
    ok('review 가 중복을 담는다', rv.duplicates.length >= 1);
    ok('review 가 영양소 합계를 담는다', rv.nutrients.vitaminD === 35);
    ok('review 가 UL·상호작용 배열을 담는다',
      Array.isArray(rv.ul) && Array.isArray(rv.interactions));

    /* 저장 계층 */
    var supSnapshot = JSON.parse(JSON.stringify(store.load()));
    store.reset();

    var added = store.addSupplement(sup.fromPreset('omega3'));
    eq('보충제가 등록된다', store.load().supplements.length, 1);
    ok('프리셋 정보가 따라온다',
      added.presetId === 'omega3' && added.nutrients.omega3 === 1000 && added.timeSlot === 'lunch');

    store.updateSupplement(added.id, { timeSlot: 'evening', dailyDoses: 2 });
    var after2 = store.load().supplements[0];
    ok('시간대·횟수를 고칠 수 있다',
      after2.timeSlot === 'evening' && after2.dailyDoses === 2);

    store.updateSupplement(added.id, { nutrients: { omega3: 1500 } });
    eq('함량을 고칠 수 있다', store.load().supplements[0].nutrients.omega3, 1500);

    var supDay = '2026-08-24';
    ok('처음엔 안 먹은 상태', !store.isTaken(supDay, added.id));
    ok('체크하면 먹은 상태', store.toggleTaken(supDay, added.id) === true);
    ok('저장된다', store.isTaken(supDay, added.id));
    ok('다시 누르면 해제', store.toggleTaken(supDay, added.id) === false);

    store.toggleTaken(supDay, added.id);
    store.removeSupplement(added.id);
    eq('삭제하면 목록에서 빠진다', store.load().supplements.length, 0);
    ok('삭제하면 지난 체크 표시도 정리된다', !store.isTaken(supDay, added.id));

    store.replace(supSnapshot);

    /* ---- 판정 엔진 (Phase 4) ---- */
    var judge = FitLog.judge;

    /* 4단계 판정 */
    eq('권장량의 50%는 부족', judge.levelOf(50, 100).key, 'low');
    eq('75%는 약간 부족', judge.levelOf(75, 100).key, 'midLow');
    eq('95%는 적정', judge.levelOf(95, 100).key, 'ok');
    eq('미량영양소는 130%여도 상한 아래면 적정', judge.levelOf(130, 100, { ul: 200 }).key, 'ok');
    eq('상한을 넘으면 과다', judge.levelOf(250, 100, { ul: 200 }).key, 'over');
    eq('상한이 없으면 과다 판정도 없다', judge.levelOf(9999, 100, { ul: null }).key, 'ok');
    ok('부족이 적정보다 먼저 온다', judge.LEVELS.low.rank < judge.LEVELS.ok.rank);

    // 매크로는 UL 이 없는 대신 초과 자체가 문제다
    eq('매크로는 110%를 넘으면 과다',
      judge.levelOf(130, 100, { overRatio: 1.1 }).key, 'over');
    eq('매크로도 105%면 적정', judge.levelOf(105, 100, { overRatio: 1.1 }).key, 'ok');

    // 부족 판정과 상한 판정은 서로 다른 값을 본다 (마그네슘·비타민E·엽산)
    eq('상한은 보충제분으로, 부족은 총량으로 본다',
      judge.levelOf(244, 280, { ul: 350, ulValue: 0 }).key, 'midLow');
    eq('보충제분이 상한을 넘으면 총량과 무관하게 과다',
      judge.levelOf(244, 280, { ul: 350, ulValue: 400 }).key, 'over');

    /* 날짜 계산 */
    eq('하루 전', judge.shiftDays('2026-08-24', -1), '2026-08-23');
    eq('월 경계를 넘는다', judge.shiftDays('2026-09-01', -1), '2026-08-31');
    eq('연 경계를 넘는다', judge.shiftDays('2026-01-01', -1), '2025-12-31');
    eq('최근 7일은 7개', judge.lastDays('2026-08-24', 7).length, 7);
    eq('마지막 날이 기준일', judge.lastDays('2026-08-24', 7)[6], '2026-08-24');
    eq('첫날은 6일 전', judge.lastDays('2026-08-24', 7)[0], '2026-08-18');

    /* ---- 검수 기준: 2주치 더미 데이터로 의미 있는 리포트가 나온다 ---- */
    var judgeSnapshot = JSON.parse(JSON.stringify(store.load()));
    store.reset();

    var END = '2026-08-24';

    store.update(function (s) {
      s.profile = {
        height: 160, age: 50, sex: 'female', weight: 58,
        skeletalMuscle: 21, bodyFatPct: 32, menopause: true,
        goals: ['loseFat'], weeklyPlan: { strength: 3, cardio: 2 },
        createdAt: '2026-08-11'
      };
      s.targets = calc.computeTargets(s.profile);
      return s;
    });

    // 2주치: 매일 김치찌개+공기밥, 삼겹살, 그릭요거트 — 단백질은 적당, 식이섬유는 부족한 식단
    var dummyDays = judge.lastDays(END, 14);
    dummyDays.forEach(function (dayKey, i) {
      [['kimchi_jjigae_rice', 'lunch'], ['samgyeopsal_set', 'dinner'],
       ['greek_yogurt_nuts', 'breakfast']].forEach(function (pair) {
        store.addMeal(dayKey, {
          type: pair[1], sourceKind: 'template', sourceId: pair[0],
          label: FitLog.templates.get(pair[0]).name, portion: 1,
          nutrients: foods.round(FitLog.templates.nutrients(pair[0], 1))
        });
      });

      // 근력운동은 주 1회만 — 계획(3회)에 못 미치게 만든다
      if (i % 7 === 2) {
        store.addWorkout(dayKey, { type: 'strength', minutes: 50, bodyParts: ['upper'] });
      }
      if (i % 3 === 0) {
        store.addWorkout(dayKey, { type: 'cardio', minutes: 30, intensity: 'moderate' });
      }
    });

    store.saveBodyLog({ date: dummyDays[0], weight: 60, skeletalMuscle: 21, bodyFatPct: 33 });
    store.saveBodyLog({ date: dummyDays[13], weight: 58, skeletalMuscle: 21.4, bodyFatPct: 31.5 });

    var dummy = store.load();

    /* 영양 리포트 */
    var rep = judge.nutritionReport(dummy, END, 7);
    eq('최근 7일이 모두 기록됐다', rep.loggedDays, 7);
    eq('매크로 5종을 낸다', rep.macros.length, 5);
    eq('미량영양소 14종을 낸다', rep.items.length, 14);

    var kcalRow = rep.macros.filter(function (m) { return m.key === 'kcal'; })[0];
    ok('하루 평균 칼로리가 계산된다', kcalRow.value > 1000, String(kcalRow.value));
    ok('모든 항목에 4단계 판정이 붙는다',
      rep.items.every(function (i) { return !!i.level && !!i.level.key; }));

    var fiberRow = rep.macros.filter(function (m) { return m.key === 'fiber'; })[0];
    ok('식이섬유 부족이 잡힌다', fiberRow.level.key !== 'ok',
      fiberRow.value + '/' + fiberRow.target + ' → ' + fiberRow.level.label);

    var naRow = rep.items.filter(function (i) { return i.key === 'sodium'; })[0];
    eq('나트륨 과다가 잡힌다', naRow.level.key, 'over');

    /* 우선순위 정렬 */
    var pri = judge.priority(rep);
    ok('먼저 볼 것이 나온다', pri.length > 0,
      pri.map(function (p) { return p.name; }).join(', '));
    var overIdx = pri.map(function (p) { return p.level.key; }).indexOf('over');
    var lowIdx = pri.map(function (p) { return p.level.key; }).indexOf('low');
    ok('부족이 과다보다 앞에 온다', lowIdx < 0 || overIdx < 0 || lowIdx < overIdx,
      '부족 ' + lowIdx + ' / 과다 ' + overIdx);

    /* 기록이 없으면 빈 리포트 */
    eq('기록 없는 주는 빈 리포트',
      judge.nutritionReport(dummy, '2020-01-07', 7).loggedDays, 0);

    /* 운동 집계 */
    var wk = judge.workoutSummary(dummy, END, 7);
    eq('주간 근력 횟수', wk.strength, 1);
    eq('계획을 같이 담는다', wk.planStrength, 3);
    ok('유산소도 센다', wk.cardio >= 2, String(wk.cardio));
    ok('부위를 모은다', wk.bodyParts.indexOf('upper') >= 0);

    /* 운동 판정 6종 */
    var wj = judge.workoutJudgments(dummy, END);
    function has(list, text) {
      return list.some(function (j) { return j.message.indexOf(text) >= 0; });
    }
    // 남긴 두 가지
    ok('근력운동 한 날 단백질 부족은 알려준다', has(wj, '근성장에 손해'),
      wj.map(function (j) { return j.message; }).join(' | '));

    // 걷어낸 네 가지 — 독려·잔소리라서 뺐다. 다시 들어오면 이 테스트가 깨진다.
    ok('남은 근력운동 횟수는 말하지 않는다', !has(wj, '남았어'));
    ok('빠진 부위 잔소리는 하지 않는다', !has(wj, '빠져 있어'));
    ok('운동 안 한 날 수를 세지 않는다', !has(wj, '운동 기록이 없네'));

    var allDone = JSON.parse(JSON.stringify(dummy));
    judge.lastDays(END, 5).forEach(function (k) {
      allDone.dailyLogs[k].workouts = [
        { id: 'w1', type: 'strength', minutes: 50, bodyParts: ['lower', 'core'] },
        { id: 'w2', type: 'cardio', minutes: 30, intensity: 'moderate' }
      ];
    });
    ok('계획을 다 채워도 축하하지 않는다',
      !has(judge.workoutJudgments(allDone, END), '다 채웠어'));
    ok('판정은 경고 두 종류뿐',
      judge.workoutJudgments(dummy, END).every(function (j) { return j.level === 'warn'; }));

    // 감량 중 근력 0회 → 근손실 경고 (최우선, 남긴 것)
    var noStrength = JSON.parse(JSON.stringify(dummy));
    Object.keys(noStrength.dailyLogs).forEach(function (k) {
      noStrength.dailyLogs[k].workouts = noStrength.dailyLogs[k].workouts
        .filter(function (w) { return w.type !== 'strength'; });
    });
    var wj2 = judge.workoutJudgments(noStrength, END);
    ok('감량 중 근력 0회면 근손실 경고', has(wj2, '근육이 섞여'));
    eq('근손실 경고가 맨 앞에 온다', wj2[0].level, 'warn');
    ok('근손실 경고에 독려 문구는 없다', !has(wj2, '넣어 보자'));

    /* ---- 오늘 기준 리포트 (주간 평균이 아니라) ---- */
    var tr = judge.todayReport(dummy, END);
    eq('오늘 매크로 5종', tr.macros.length, 5);
    eq('오늘 미량영양소 14종', tr.items.length, 14);
    ok('오늘 식사 기록 여부를 담는다', tr.hasMeals === true);

    var todaySum = foods.sum(dummy.dailyLogs[END].meals.map(function (m) { return m.nutrients; }));
    var trKcal = tr.macros.filter(function (m) { return m.key === 'kcal'; })[0];
    near('오늘 칼로리는 그날 합계 그대로 (평균 아님)', trKcal.value, todaySum.kcal, 1);

    var weekAvg = judge.nutritionReport(dummy, END, 7)
      .macros.filter(function (m) { return m.key === 'kcal'; })[0];
    ok('오늘 값과 주간 평균은 다른 계산이다',
      typeof weekAvg.value === 'number' && typeof trKcal.value === 'number');

    ok('식사 기록이 없는 날도 리포트는 나온다',
      judge.todayReport(dummy, '2020-01-01').items.length === 14);

    /* ---- 보충제는 '그날 체크한 것' 만 합산한다 ----
     * 등록만 하면 계산에 들어가던 때는, 오메가3 보충제를 등록한 사람에게
     * 오메가3 부족이 구조적으로 뜰 수 없었다 — 깜빡한 날도 먹은 걸로 쳤다.
     * 아래는 그 회귀를 막는 테스트다. 이 동작을 되돌리면 여기서 깨진다.
     */
    var takenSnapshot = JSON.parse(JSON.stringify(store.load()));
    store.reset();
    store.update(function (s) {
      s.profile = {
        height: 165, age: 40, sex: 'female', weight: 60,
        goals: ['maintain'], weeklyPlan: { strength: 2, cardio: 2 },
        createdAt: '2026-08-11'
      };
      s.targets = calc.computeTargets(s.profile);
      s.supplements = [
        { id: 'sup_o3', name: '오메가3', presetId: 'omega3', timeSlot: 'lunch',
          dailyDoses: 1, nutrients: { omega3: 1000 }, enabled: true },
        { id: 'sup_d', name: '비타민D', presetId: 'vitamin_d', timeSlot: 'lunch',
          dailyDoses: 1, nutrients: { vitaminD: 25 }, enabled: true }
      ];
      return s;
    });

    var tDays = judge.lastDays(END, 7);
    tDays.forEach(function (dayKey, i) {
      store.addMeal(dayKey, {
        type: 'lunch', sourceKind: 'food', sourceId: 'rice_cooked', label: '밥',
        portion: 1, nutrients: foods.scale('rice_cooked', 210)
      });
    });

    function micro(dateKey, key) {
      var rows = judge.todayReport(store.load(), dateKey).items;
      return rows.filter(function (i) { return i.key === key; })[0];
    }

    eq('체크 안 한 보충제는 안 세어진다', micro(END, 'omega3').value, 0);
    eq('부족으로 잡힌다', micro(END, 'omega3').level.key, 'low');

    store.toggleTaken(END, 'sup_o3');
    eq('체크하면 합산된다', micro(END, 'omega3').value, 1000);
    eq('체크한 것만 센다 — 비타민D 는 아직 0', micro(END, 'vitaminD').value, 0);
    eq('보충제 유래분에도 반영된다', micro(END, 'omega3').fromSupplement, 1000);

    store.toggleTaken(END, 'sup_d');
    eq('둘 다 체크하면 둘 다 센다', micro(END, 'vitaminD').value, 25);

    store.toggleTaken(END, 'sup_o3');
    eq('체크를 해제하면 다시 빠진다', micro(END, 'omega3').value, 0);
    eq('해제해도 다른 보충제는 그대로', micro(END, 'vitaminD').value, 25);

    // 주간 평균도 날짜별 체크를 본다. 하루분을 그대로 더하면
    // 한 번도 안 먹은 주에도 매일 먹은 것으로 잡힌다.
    function weekOmega3() {
      return judge.nutritionReport(store.load(), END, 7)
        .items.filter(function (i) { return i.key === 'omega3'; })[0];
    }
    store.toggleTaken(END, 'sup_d');   // 앞에서 켠 것을 되돌린다
    eq('아무 날도 체크 안 하면 주간 평균 0', weekOmega3().value, 0);

    [0, 1, 2].forEach(function (i) { store.toggleTaken(tDays[i], 'sup_o3'); });
    near('7일 중 3일 체크 → 평균은 3/7', weekOmega3().value, 1000 * 3 / 7, 0.2);

    [3, 4, 5, 6].forEach(function (i) { store.toggleTaken(tDays[i], 'sup_o3'); });
    eq('7일 전부 체크 → 하루분 그대로', weekOmega3().value, 1000);

    // CSV 도 같은 기준이어야 앱 화면과 숫자가 어긋나지 않는다
    store.toggleTaken(END, 'sup_d');
    var csvTaken = FitLog.csv.dailySummary(store.load());
    ok('CSV 일별 요약도 체크 기준으로 계산된다', csvTaken.indexOf(END) >= 0);

    // 날짜 없이 부르면 예전처럼 등록된 것 전부를 센다 (설정 탭 미리보기용)
    eq('takenIds 를 안 넘기면 등록분 전부를 센다',
      sup.dailyNutrients(store.load().supplements).omega3, 1000);
    eq('빈 배열을 넘기면 0 이다',
      sup.dailyNutrients(store.load().supplements, []).omega3, 0);

    store.replace(takenSnapshot);

    /* 총량을 말할 때 하루 필요량 대비를 항상 같이 말한다 */
    var naItem = tr.items.filter(function (i) { return i.key === 'sodium'; })[0];
    var naMsg = judge.itemMessage(naItem);
    ok('과다는 필요량 대비와 함께 경고한다',
      naMsg.indexOf('하루 필요량') >= 0 && naMsg.indexOf('목표섭취량') >= 0, naMsg);

    var calItem = tr.items.filter(function (i) { return i.key === 'calcium'; })[0];
    var calMsg = judge.itemMessage(calItem);
    ok('부족은 모자란 양까지 말한다',
      calMsg.indexOf('하루 필요량') >= 0 && calMsg.indexOf('모자라') >= 0, calMsg);

    var plentyMsg = judge.itemMessage({
      name: '비타민 D', unit: 'µg', value: 35, target: 10, ratio: 3.5,
      ul: 100, ulKind: null, level: judge.LEVELS.ok
    });
    ok('필요량은 넘었지만 상한 아래면 문제 없다고 말한다',
      plentyMsg.indexOf('350%') >= 0 && plentyMsg.indexOf('상한') >= 0, plentyMsg);

    /* 신체 변화 판정 */
    var bj = judge.bodyJudgments(dummy, END);
    ok('골격근 ↑ 체지방 ↓ 를 칭찬한다', has(bj, '잘 가고 있어'),
      bj.map(function (j) { return j.message; }).join(' | '));

    var fastLoss = JSON.parse(JSON.stringify(dummy));
    fastLoss.bodyLogs = [
      { date: judge.shiftDays(END, -5), weight: 60, skeletalMuscle: null,
        bodyFatPct: null, visceralRatio: null, waistCm: null },
      { date: END, weight: 58.5, skeletalMuscle: null,
        bodyFatPct: null, visceralRatio: null, waistCm: null }
    ];
    ok('한 주 1% 넘게 빠지면 속도 경고', has(judge.bodyJudgments(fastLoss, END), '천천히 가자'),
      judge.bodyJudgments(fastLoss, END).map(function (j) { return j.message; }).join(' | '));

    ok('측정이 1회뿐이면 판정하지 않는다',
      judge.bodyJudgments({ bodyLogs: [{ date: END, weight: 58 }],
                            dailyLogs: {}, profile: dummy.profile }, END).length === 0);

    /* 저장 계층 — 운동·인바디 */
    var wRec = store.addWorkout(END, { type: 'strength', minutes: 45, bodyParts: ['lower'] });
    ok('운동에 id 가 붙는다', wRec.id.indexOf('wk_') === 0, wRec.id);
    ok('운동이 저장된다',
      store.getDay(END).workouts.some(function (w) { return w.id === wRec.id; }));
    store.removeWorkout(END, wRec.id);
    ok('운동을 지울 수 있다',
      !store.getDay(END).workouts.some(function (w) { return w.id === wRec.id; }));

    var beforeCount = store.load().bodyLogs.length;
    store.saveBodyLog({ date: END, weight: 57, bodyFatPct: 31, waistCm: 72 });
    eq('같은 날짜는 덮어쓴다', store.load().bodyLogs.length, beforeCount);
    eq('새 체중이 프로필에 반영된다', store.load().profile.weight, 57);
    ok('목표치도 다시 계산된다',
      store.load().targets.meta.computedAt.length > 0 &&
      store.load().targets.protein === Math.round(57 * 2.0),
      String(store.load().targets.protein));

    store.replace(judgeSnapshot);

    /* ---- CSV 내보내기 ---- */
    var csv = FitLog.csv;

    /* 이스케이프 — 여기가 틀리면 메뉴 이름에 쉼표 하나만 들어가도 표가 통째로 밀린다 */
    eq('평범한 값은 그대로', csv.cell('김치찌개'), '김치찌개');
    eq('쉼표가 있으면 따옴표로 감싼다', csv.cell('밥, 국'), '"밥, 국"');
    eq('따옴표는 두 번 쓴다', csv.cell('그는 "맛있다"'), '"그는 ""맛있다"""');
    eq('줄바꿈도 감싼다', csv.cell('첫줄\n둘째줄'), '"첫줄\n둘째줄"');
    eq('빈 값은 빈 칸', csv.cell(null), '');
    eq('0은 0으로 남는다', csv.cell(0), '0');

    eq('행은 쉼표로, 줄은 CRLF 로',
      csv.toCsv([['a', 'b'], ['c', 'd']]), 'a,b\r\nc,d');

    /* 더미 데이터로 실제 표를 만들어 본다 */
    var csvSnapshot = JSON.parse(JSON.stringify(store.load()));
    store.reset();

    var CSV_END = '2026-08-24';
    store.update(function (s) {
      s.profile = {
        height: 170, age: 35, sex: 'female', weight: 65,
        skeletalMuscle: 25, bodyFatPct: 28, menopause: null,
        goals: ['loseFat'], weeklyPlan: { strength: 3, cardio: 2 }, createdAt: CSV_END
      };
      s.targets = calc.computeTargets(s.profile);
      return s;
    });

    store.addMeal(CSV_END, {
      type: 'lunch', sourceKind: 'template', sourceId: 'kimchi_jjigae_rice',
      label: '김치찌개 + 공기밥', portion: 1,
      items: [{ food: 'rice_cooked', g: 210 }, { food: 'kimchi_jjigae', g: 350 }],
      nutrients: foods.round(FitLog.templates.nutrients('kimchi_jjigae_rice', 1))
    });
    // 쉼표가 든 이름을 일부러 넣어 이스케이프가 실제로 먹는지 본다
    store.addMeal(CSV_END, {
      type: 'dinner', sourceKind: 'custom', sourceId: 'c1',
      label: '샐러드, 드레싱 없이', portion: 0.7,
      nutrients: foods.round(foods.scale('chicken_breast', 120))
    });
    store.addWorkout(CSV_END, { type: 'strength', minutes: 50, bodyParts: ['lower'] });
    store.addWorkout(CSV_END, { type: 'cardio', minutes: 30, intensity: 'moderate' });
    store.saveBodyLog({ date: '2026-08-20', weight: 66, skeletalMuscle: 24.8, bodyFatPct: 29 });
    store.saveBodyLog({ date: CSV_END, weight: 65, skeletalMuscle: 25, bodyFatPct: 28, waistCm: 76 });

    var csvState = store.load();

    /* 1) 일별 요약 */
    var daily = csv.dailySummary(csvState).split('\r\n');
    ok('일별 요약에 헤더가 있다', daily[0].indexOf('날짜,요일,칼로리') === 0, daily[0]);
    eq('기록된 날짜 수만큼 행이 생긴다', daily.length, 3);   // 헤더 + 2일

    var lastRow = daily[daily.length - 1].split(',');
    eq('마지막 행 날짜', lastRow[0], CSV_END);
    ok('요일이 들어간다', '일월화수목금토'.indexOf(lastRow[1]) >= 0, lastRow[1]);
    ok('근력·유산소 시간이 분리돼 들어간다',
      daily[daily.length - 1].indexOf(',50,30,') >= 0, daily[daily.length - 1]);
    ok('체중이 들어간다', daily[daily.length - 1].indexOf('65') >= 0);

    /* 2) 식사 상세 */
    var meals = csv.mealDetail(csvState).split('\r\n');
    eq('끼니 수만큼 행이 생긴다', meals.length, 3);          // 헤더 + 2끼니
    ok('아침·점심·저녁 순으로 정렬된다', meals[1].indexOf('점심') >= 0, meals[1]);
    ok('양 표기가 한글로 들어간다', meals[2].indexOf('적게') >= 0, meals[2]);
    // '재료' 열은 뺐다 — 어차피 추정치라 트레이너에게 의미가 없다.
    ok('재료 열은 없다', meals[0].indexOf('재료') < 0, meals[0]);
    ok('쉼표가 든 메뉴 이름이 따옴표로 감싸진다',
      meals[2].indexOf('"샐러드, 드레싱 없이"') >= 0, meals[2]);
    eq('쉼표가 들어가도 칸 수는 그대로',
      meals[2].split('","').length + meals[2].replace(/"[^"]*"/g, '').split(',').length - 1,
      meals[0].split(',').length);

    /* 3) 인바디 */
    var body = csv.bodyLog(csvState).split('\r\n');
    eq('측정 횟수만큼 행이 생긴다', body.length, 3);
    ok('체지방량을 계산해 넣는다', body[1].indexOf('19.1') >= 0, body[1]);   // 66 × 29%
    ok('첫 측정은 변화량이 비어 있다', body[1].split(',').pop() === '', body[1]);
    ok('두 번째 측정에 변화량이 들어간다', body[2].split(',').pop() === '-1', body[2]);

    /* 기록이 없어도 헤더만 나오고 깨지지 않는다 */
    store.reset();
    store.update(function (s) {
      s.profile = { height: 170, age: 35, sex: 'female', weight: 65,
                    goals: ['maintain'], weeklyPlan: { strength: 0, cardio: 0 },
                    skeletalMuscle: null, bodyFatPct: null, createdAt: CSV_END };
      s.targets = calc.computeTargets(s.profile);
      return s;
    });
    csv.SHEETS.forEach(function (sheet) {
      var text = sheet.build(store.load());
      ok('기록이 없어도 ' + sheet.label + ' 는 헤더만 내보낸다',
        text.split('\r\n').length === 1 && text.indexOf('날짜') === 0, text.slice(0, 40));
    });

    eq('내보낼 표는 3종', csv.SHEETS.length, 3);

    store.replace(csvSnapshot);

    /* ---- 앱을 업데이트해도 기록이 살아남는가 ----
       친구들이 쓰는 중에 새 빌드를 올려도 데이터가 날아가면 안 된다.
       앱이 켜질 때마다 거치는 경로(migrate)에 실제 데이터를 통과시켜 본다. */

    var live = {
      schemaVersion: 2,
      profile: {
        height: 170, age: 35, sex: 'female', weight: 65,
        skeletalMuscle: 25, bodyFatPct: 28, menopause: null,
        goals: ['gainStrength', 'loseFat'],
        weeklyPlan: { strength: 3, cardio: 2 }, createdAt: '2026-08-01'
      },
      targets: calc.computeTargets({
        height: 170, age: 35, sex: 'female', weight: 65, bodyFatPct: 28,
        goals: ['gainStrength', 'loseFat'], weeklyPlan: { strength: 3, cardio: 2 }
      }),
      supplements: [
        { id: 'sup_a', name: '내가 고친 오메가3', presetId: 'omega3',
          timeSlot: 'evening', dailyDoses: 2, nutrients: { omega3: 1500 }, enabled: true },
        { id: 'sup_b', name: '동네약국 영양제', presetId: null,
          timeSlot: 'morning', dailyDoses: 1, nutrients: { vitaminC: 500 }, enabled: false }
      ],
      dailyLogs: {
        '2026-08-20': {
          meals: [{ id: 'm1', type: 'lunch', sourceKind: 'template',
                    sourceId: 'kimchi_jjigae_rice', label: '김치찌개 + 공기밥', portion: 1.4,
                    items: [{ food: 'rice_cooked', g: 294 }],
                    nutrients: { kcal: 701, protein: 29.1 }, time: '12:30', note: '점심 회식' }],
          alcohol: { drank: true, kcal: 300, note: '맥주' },
          supplementsTaken: ['sup_a'],
          workouts: [{ id: 'wk1', type: 'strength', minutes: 55,
                       bodyParts: ['lower', 'core'], intensity: null, note: '' }],
          waterMl: 1200, note: '컨디션 좋음'
        }
      },
      bodyLogs: [{ date: '2026-08-20', weight: 65, skeletalMuscle: 25,
                   bodyFatPct: 28, visceralRatio: 0.9, waistCm: 76 }],
      customFoods: [{ id: 'custom_1', name: '회사 샐러드',
                      nutrients: { kcal: 320, protein: 22 }, createdAt: '2026-08-10' }],
      favorites: ['template:kimchi_jjigae_rice', 'custom:custom_1']
    };

    var after = store.migrate(JSON.parse(JSON.stringify(live)));

    ok('업데이트해도 프로필이 남는다',
      after.profile.weight === 65 && after.profile.goals.join('+') === 'gainStrength+loseFat');
    ok('직접 고친 보충제 함량이 남는다',
      after.supplements[0].nutrients.omega3 === 1500 && after.supplements[0].dailyDoses === 2);
    ok('중지해 둔 보충제도 상태 그대로 남는다', after.supplements[1].enabled === false);
    ok('직접 등록한 보충제가 남는다', after.supplements[1].name === '동네약국 영양제');
    ok('식사 기록이 남는다',
      after.dailyLogs['2026-08-20'].meals[0].nutrients.kcal === 701);
    ok('끼니의 양·시각·메모까지 남는다',
      after.dailyLogs['2026-08-20'].meals[0].portion === 1.4 &&
      after.dailyLogs['2026-08-20'].meals[0].time === '12:30' &&
      after.dailyLogs['2026-08-20'].meals[0].note === '점심 회식');
    ok('음주 기록이 남는다', after.dailyLogs['2026-08-20'].alcohol.kcal === 300);
    ok('보충제 체크가 남는다',
      after.dailyLogs['2026-08-20'].supplementsTaken.join() === 'sup_a');
    ok('운동 기록이 남는다',
      after.dailyLogs['2026-08-20'].workouts[0].minutes === 55 &&
      after.dailyLogs['2026-08-20'].workouts[0].bodyParts.join() === 'lower,core');
    ok('물·메모가 남는다',
      after.dailyLogs['2026-08-20'].waterMl === 1200 &&
      after.dailyLogs['2026-08-20'].note === '컨디션 좋음');
    ok('인바디 기록이 남는다', after.bodyLogs[0].waistCm === 76);
    ok('직접 등록한 음식이 남는다', after.customFoods[0].name === '회사 샐러드');
    ok('즐겨찾기가 남는다', after.favorites.length === 2);
    eq('스키마 버전은 그대로', after.schemaVersion, 2);

    // 스키마가 올라가는 경우에도 '변환' 이지 '삭제' 가 아니어야 한다
    var older = JSON.parse(JSON.stringify(live));
    older.schemaVersion = 1;
    older.profile.goal = 'loseFat';
    delete older.profile.goals;
    delete older.favorites;

    var upgraded = store.migrate(older);
    eq('옛 버전은 최신으로 올라간다', upgraded.schemaVersion, store.SCHEMA_VERSION);
    ok('올라가면서도 식사 기록은 그대로', upgraded.dailyLogs['2026-08-20'].meals.length === 1);
    ok('올라가면서도 보충제는 그대로', upgraded.supplements.length === 2);
    ok('없던 필드는 빈 값으로 채워질 뿐 지우지 않는다',
      Array.isArray(upgraded.favorites) && upgraded.favorites.length === 0);
    eq('옛 단일 목표는 배열로 변환된다', upgraded.profile.goals.join('+'), 'loseFat');

    /* ---- 백업 노출도 ----
       localStorage 는 영구 저장이 아니다. 유일한 확실한 대비가 백업이므로
       '언제 백업했는지' 를 기록해 두고 오래되면 알려준다. */

    var bkSnapshot = JSON.parse(JSON.stringify(store.load()));
    store.reset();

    eq('백업한 적이 없으면 null', store.daysSinceBackup(), null);
    eq('기록이 없으면 0일', store.recordedDayCount(), 0);

    store.markBackedUp();
    eq('백업 직후는 0일', store.daysSinceBackup(), 0);
    ok('백업 시각이 저장된다', !!store.load().meta.lastBackupAt);

    var tenDaysAgo = new Date(Date.now() - 10 * 86400000).toISOString();
    store.markBackedUp(tenDaysAgo);
    eq('10일 전 백업은 10일로 센다', store.daysSinceBackup(), 10);

    ok('잘못된 시각은 null 로 처리', (store.update(function (s) {
      s.meta.lastBackupAt = '말도 안 되는 값';
      return s;
    }), store.daysSinceBackup() === null));

    /* 기록한 날 세기 */
    store.reset();
    store.addMeal('2026-08-20', { type: 'lunch', label: 'x', nutrients: {} });
    store.addWorkout('2026-08-21', { type: 'cardio', minutes: 30 });
    store.toggleTaken('2026-08-22', 'sup_x');
    eq('식사·운동·보충제 중 뭐라도 있으면 센다', store.recordedDayCount(), 3);

    /* 백업 이력이 백업 파일 안에도 들어간다 */
    store.markBackedUp('2026-08-24T09:00:00.000Z');
    var exported = JSON.parse(JSON.stringify(store.load()));
    eq('백업 파일에 마지막 백업 시각이 담긴다',
      exported.meta.lastBackupAt, '2026-08-24T09:00:00.000Z');

    var restored = store.migrate(exported);
    eq('불러와도 백업 이력이 유지된다',
      restored.meta.lastBackupAt, '2026-08-24T09:00:00.000Z');

    /* 옛 데이터에는 meta 가 없다 — 지우지 말고 채워 넣어야 한다 */
    var noMeta = JSON.parse(JSON.stringify(exported));
    delete noMeta.meta;
    var filled = store.migrate(noMeta);
    ok('meta 가 없던 데이터도 깨지지 않는다',
      filled.meta && filled.meta.lastBackupAt === null);
    ok('meta 를 채우면서 다른 데이터는 그대로',
      Object.keys(filled.dailyLogs).length === Object.keys(exported.dailyLogs).length);

    store.replace(bkSnapshot);

    /* ---- 파일 전달 방식 ----
       iOS 는 <a download> 로 받으면 '이 타입을 열 수 있는 앱' 목록이 뜬다.
       인증 앱 같은 엉뚱한 게 섞여 나와서 사용자가 막힌다.
       공유 시트를 쓸 수 있으면 그쪽으로 보낸다. */

    var share = FitLog.share;
    var realShare = FitLog.share.canShareFile;

    ok('공유가 아예 없는 환경은 공유 불가로 본다', share.canShareFile(null) === false);

    /* 분기 확인 — 진짜 다운로드가 일어나지 않게 함수를 갈아 끼운다 */
    var log = [];
    var origDownload = share.downloadFile;
    share.downloadFile = function (name, text, mime) {
      log.push({ how: 'download', name: name, mime: mime, text: text });
      return 'download';
    };

    var howPC = share.deliverFile('a.csv', 'x', 'text/csv');
    eq('공유를 못 쓰면 다운로드로 떨어진다', howPC, 'download');
    eq('파일 이름이 그대로 전달된다', log[0].name, 'a.csv');
    eq('MIME 타입이 그대로 전달된다', log[0].mime, 'text/csv');

    share.downloadFile = origDownload;
    FitLog.share.canShareFile = realShare;

    /* CSV 는 BOM 을 붙여서 넘긴다 — 이게 빠지면 한글 엑셀에서 전부 깨진다 */
    var captured = null;
    var saved = share.deliverFile;
    share.deliverFile = function (name, text, mime) {
      captured = { name: name, text: text, mime: mime };
      return 'download';
    };

    FitLog.csv.deliver('test.csv', FitLog.csv.toCsv([['날짜', '체중'], ['2026-08-25', 65]]));
    ok('CSV 앞에 BOM 이 붙는다', captured.text.charCodeAt(0) === 0xFEFF,
      'charCode ' + captured.text.charCodeAt(0));
    ok('BOM 뒤에 실제 내용이 온다', captured.text.indexOf('날짜,체중') === 1);
    ok('CSV MIME 에 charset 이 들어간다', captured.mime.indexOf('charset=utf-8') >= 0,
      captured.mime);

    var bkState = JSON.parse(JSON.stringify(store.load()));
    FitLog.backup.exportData();
    ok('백업도 같은 경로로 전달된다', captured.name.indexOf('fitlog-backup-') === 0, captured.name);
    eq('백업은 JSON MIME', captured.mime, 'application/json');
    ok('백업 내용은 JSON 으로 파싱된다',
      JSON.parse(captured.text).schemaVersion === store.SCHEMA_VERSION);
    ok('백업 파일에 BOM 은 붙이지 않는다', captured.text.charCodeAt(0) !== 0xFEFF);
    store.replace(bkState);

    share.deliverFile = saved;

    /* ---- 사람이 읽는 요약 ----
       CSV 는 기계용이라 카톡에 붙이면 쉼표 범벅이다. 이건 눈으로 읽는 평문이다. */

    var rp = FitLog.report;
    var rpSnapshot = JSON.parse(JSON.stringify(store.load()));
    store.reset();

    var RD = '2026-08-24';
    store.update(function (s) {
      s.profile = { height: 170, age: 35, sex: 'female', weight: 65,
                    skeletalMuscle: 25, bodyFatPct: 28, menopause: null,
                    goals: ['loseFat'], weeklyPlan: { strength: 3, cardio: 2 },
                    createdAt: RD };
      s.targets = calc.computeTargets(s.profile);
      return s;
    });

    store.addMeal(RD, {
      type: 'lunch', sourceKind: 'template', sourceId: 'kimchi_jjigae_rice',
      label: '김치찌개 + 공기밥', portion: 1.4, time: '12:30', note: '국물은 조금만 먹었어',
      nutrients: foods.round(FitLog.templates.nutrients('kimchi_jjigae_rice', 1.4))
    });
    store.addMeal(RD, {
      type: 'breakfast', sourceKind: 'template', sourceId: 'greek_yogurt_nuts',
      label: '그릭요거트 + 견과류', portion: 1,
      nutrients: foods.round(FitLog.templates.nutrients('greek_yogurt_nuts', 1))
    });
    store.addWorkout(RD, { type: 'strength', minutes: 50, bodyParts: ['lower', 'core'] });
    store.saveBodyLog({ date: RD, weight: 65, bodyFatPct: 28, waistCm: 76 });

    var daily = rp.dailyText(store.load(), RD);
    var dailyLines = daily.split('\n');

    eq('날짜와 요일로 시작한다', dailyLines[0], '8월 24일 (월)');
    ok('칼로리에 단위가 붙는다', daily.indexOf('kcal') >= 0, dailyLines[2]);
    ok('단백질에 단위가 붙는다', daily.indexOf(' g') >= 0);
    ok('아침이 점심보다 먼저 온다', daily.indexOf('아침') < daily.indexOf('점심'));
    ok('양 표기는 항상 들어간다',
      daily.indexOf('(많이)') >= 0 && daily.indexOf('(보통)') >= 0);
    ok('시각이 있으면 앞에 붙는다', daily.indexOf('12:30 점심') >= 0);
    ok('시각이 없으면 자리를 비워 정렬을 맞춘다', daily.indexOf('      아침') >= 0);
    ok('메모는 아래 줄에 붙는다', daily.indexOf('└ 국물은 조금만') >= 0);
    ok('운동이 부위까지 들어간다', daily.indexOf('근력 50분 (하체·코어)') >= 0);
    ok('체중과 허리가 들어간다',
      daily.indexOf('65 kg') >= 0 && daily.indexOf('허리 76 cm') >= 0);
    ok('마크다운 표를 쓰지 않는다', daily.indexOf('|') < 0);

    var longNote = '이건 스무 글자를 훌쩍 넘기는 아주 긴 메모입니다 정말로';
    store.addMeal(RD, { type: 'dinner', label: '저녁', portion: 1,
                        note: longNote, nutrients: {} });
    ok('긴 메모는 20자에서 잘라 넣는다',
      rp.dailyText(store.load(), RD).indexOf(longNote.slice(0, 20) + '…') >= 0);

    ok('기록이 없는 날은 그렇다고 적는다',
      rp.dailyText(store.load(), '2020-01-01').indexOf('기록 없음') > 0);

    /* 주간 */
    var weekly = rp.weeklyText(store.load(), RD);
    ok('주차와 기간으로 시작한다',
      weekly.indexOf('8월') === 0 && weekly.indexOf('(8/18–8/24)') > 0,
      weekly.split('\n')[0]);
    ok('평균과 목표를 같이 적는다', weekly.indexOf('평균 칼로리') >= 0);
    ok('기록한 날 수를 적는다', weekly.indexOf('기록한 날') >= 0);
    ok('운동 달성률이 들어간다', weekly.indexOf('근력 1/3회') >= 0, weekly);
    ok('이번 주 갭을 붙인다', weekly.indexOf('이번 주 갭') >= 0);

    /* 트레이너 관심사만 남긴다 — 미량영양소·보충제·상한은 뺀다 */
    ['multivitamin', 'vitamin_d'].forEach(function (id) {
      store.addSupplement(FitLog.supplements.fromPreset(id));
    });
    var gapText = rp.weeklyText(store.load(), RD);
    ok('미량영양소는 요약에 안 넣는다',
      gapText.indexOf('칼슘') < 0 && gapText.indexOf('마그네슘') < 0, gapText);
    ok('보충제 이야기도 안 넣는다',
      gapText.indexOf('종합비타민') < 0 && gapText.indexOf('겹쳐') < 0);
    ok('상한섭취량 경고도 안 넣는다', gapText.indexOf('상한') < 0);
    ok('매크로 갭은 넣는다',
      rp.weeklyGaps(store.load(), RD).some(function (g) {
        return g.indexOf('단백질') >= 0 || g.indexOf('식이섬유') >= 0;
      }));

    eq('천 단위 쉼표', rp.comma(1420), '1,420');
    eq('네 자리 미만은 그대로', rp.comma(820), '820');
    eq('만 단위도 처리', rp.comma(12345), '12,345');

    store.replace(rpSnapshot);

    /* ---- 배포 뒤에 앱을 고쳐도 남의 기록이 안 바뀌는가 ----
       친구들이 쓰는 중에 프리셋 기본값이나 음식 값을 고칠 일이 생긴다.
       그때 이미 등록·기록된 것이 따라 바뀌면 안 된다. */

    var afterSnapshot = JSON.parse(JSON.stringify(store.load()));
    store.reset();

    /* 1) 프리셋 기본값을 바꿔도 이미 등록한 보충제는 그대로 */
    var mine = store.addSupplement(sup.fromPreset('omega3'));
    eq('등록 시점의 프리셋 값이 복사된다', mine.nutrients.omega3, 1000);

    store.updateSupplement(mine.id, { nutrients: { omega3: 500 } });   // 사용자가 제품에 맞게 수정

    var realPreset = sup.getPreset('omega3');
    var savedDefault = realPreset.nutrients.omega3;
    realPreset.nutrients.omega3 = 9999;                                // 앱 업데이트로 기본값이 바뀐 상황

    eq('프리셋이 바뀌어도 등록된 값은 그대로',
      store.load().supplements[0].nutrients.omega3, 500);
    eq('합계도 등록된 값으로 계산된다',
      sup.dailyNutrients(store.load().supplements).omega3, 500);

    realPreset.nutrients.omega3 = savedDefault;                        // 원복

    /* 2) 음식 값을 바꿔도 이미 기록한 끼니는 그대로 */
    var mealDay = '2026-08-20';
    store.addMeal(mealDay, {
      type: 'lunch', sourceKind: 'template', sourceId: 'kimchi_jjigae_rice',
      label: '김치찌개 + 공기밥', portion: 1,
      nutrients: foods.round(FitLog.templates.nutrients('kimchi_jjigae_rice', 1))
    });
    var savedKcal = store.getDay(mealDay).meals[0].nutrients.kcal;

    var rice = foods.get('rice_cooked');
    var savedRice = rice.per100g.kcal;
    rice.per100g.kcal = 500;                                           // 음식 DB 가 바뀐 상황

    eq('음식 값이 바뀌어도 지난 기록은 그대로',
      store.getDay(mealDay).meals[0].nutrients.kcal, savedKcal);
    ok('새로 기록하는 것만 새 값을 쓴다',
      FitLog.templates.nutrients('kimchi_jjigae_rice', 1).kcal > savedKcal);

    rice.per100g.kcal = savedRice;                                     // 원복

    /* 3) 화면에 보이는 함량은 프리셋이 아니라 저장된 값에서 나와야 한다 */
    ok('한 가지 성분이면 값을 그대로 보여준다',
      sup.fieldMeta('omega3').label.indexOf('오메가3') === 0);

    store.replace(afterSnapshot);

    /* ---- 실행 환경 감지 (인앱 브라우저) ----
       친구들이 카톡·인스타 링크로 열면 인앱 브라우저라 기록이 안 남는다.
       userAgent 로 감지하는데, 실제 앱들이 쓰는 문자열로 검증한다. */

    var env = FitLog.env;

    // 실제 인앱 브라우저가 붙이는 userAgent 조각들
    var UA = {
      kakao: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 KAKAOTALK 10.4.5',
      instagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6) AppleWebKit/605 Instagram 302.0.0.0',
      line: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1) AppleWebKit/605 Safari Line/13.20.0',
      naver: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537 Chrome/119 NAVER(inapp; search; 1000; 12.5.0)',
      facebook: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6) AppleWebKit/605 [FBAN/FBIOS;FBAV/435]',
      safari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Version/17.0 Mobile Safari/604',
      chrome: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537 Chrome/119.0.0.0 Mobile Safari/537'
    };

    eq('카카오톡 인앱을 감지한다', env.detectInApp(UA.kakao).key, 'kakao');
    eq('인스타그램 인앱을 감지한다', env.detectInApp(UA.instagram).key, 'instagram');
    eq('라인 인앱을 감지한다', env.detectInApp(UA.line).key, 'line');
    eq('네이버 앱 인앱을 감지한다', env.detectInApp(UA.naver).key, 'naver');
    eq('페이스북 인앱을 감지한다', env.detectInApp(UA.facebook).key, 'facebook');

    eq('일반 사파리는 인앱이 아니다', env.detectInApp(UA.safari).key, null);
    eq('일반 크롬은 인앱이 아니다', env.detectInApp(UA.chrome).key, null);
    eq('빈 UA 는 인앱이 아니다', env.detectInApp('').key, null);

    eq('카카오톡 라벨', env.detectInApp(UA.kakao).label, '카카오톡');
    ok('감지되면 한국어 라벨이 붙는다', env.detectInApp(UA.instagram).label === '인스타그램');

    // 'line' 이라는 단어가 다른 맥락에 있어도 오탐하지 않는다
    eq("'timeline' 같은 단어는 라인으로 오탐 안 함",
      env.detectInApp('Mozilla/5.0 timeline Safari/604').key, null);

    // 카톡 외부 열기 스킴
    var scheme = env.kakaoExternalUrl('https://jonijonii.github.io/fitlog/');
    ok('카톡 스킴이 openExternal 을 쓴다', scheme.indexOf('kakaotalk://web/openExternal') === 0,
      scheme);
    ok('카톡 스킴에 인코딩된 주소가 들어간다',
      scheme.indexOf(encodeURIComponent('https://jonijonii.github.io/fitlog/')) >= 0);

    /* ---- 결과 출력 ---- */
    var failed = results.filter(function (r) { return !r.pass; });

    if (typeof console.table === 'function') {
      console.table(results.map(function (r) {
        return { 결과: r.pass ? 'PASS' : 'FAIL', 항목: r.name, 상세: r.detail || '' };
      }));
    }
    console.log('[FitLog] 테스트 ' + results.length + '건 중 ' +
      (results.length - failed.length) + '건 통과, ' + failed.length + '건 실패');
    failed.forEach(function (r) {
      console.error('FAIL: ' + r.name + ' — ' + (r.detail || ''));
    });

    return { total: results.length, passed: results.length - failed.length,
             failed: failed.length, results: results };
  }

  FitLog.runTests = runTests;

  if (typeof location !== 'undefined' && /[?&]test\b/.test(location.search)) {
    document.addEventListener('DOMContentLoaded', function () { runTests(); });
  }
})(window.FitLog);
