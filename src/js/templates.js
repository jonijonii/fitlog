/* templates.js — 식사 템플릿 (129개)
 *
 * 템플릿은 영양소를 직접 갖지 않는다. foods.js 의 재료 조합만 갖고,
 * 영양소는 재료에서 합산해 계산한다. 재료 g은 1인분(portion 1.0) 기준이다.
 *
 * 1인분 기준량은 CLAUDE.md 의 표를 따른다:
 *   공기밥 210g / 찌개·국 350g / 면류 200g / 삼겹살·목살 200g /
 *   살코기 150g / 닭가슴살 120g / 생선구이 120g / 나물 60g / 김치 40g
 *
 * 주의: '칼국수·물냉면·떡국·쌀국수'는 면 포함 한 그릇이라 면을 따로 넣지 않는다.
 *       '짜장소스·짬뽕 국물·건더기·카레 (소스)'는 소스만이라 밥·면을 따로 넣는다.
 */

window.FitLog = window.FitLog || {};

(function (FitLog) {
  'use strict';

  /* 양 조절 — 기록할 때 이 셋 중 하나를 고른다 */
  var PORTIONS = [
    { value: 0.7, label: '적게' },
    { value: 1.0, label: '보통' },
    { value: 1.4, label: '많이' }
  ];

  var CATEGORY_LABEL = {
    korean: '한식 백반·일품',
    banchan: '집밥 (밥 + 반찬)',
    western: '양식·간편식',
    eatingout: '외식',
    snack: '아침·간식'
  };

  /* 행 형식: [id, 이름, [[음식id, g], ...]] */
  var RAW = {

    /* ---------- 한식 백반·일품 (45) ---------- */
    korean: [
      ['kimchi_jjigae_rice',  '김치찌개 + 공기밥',      [['rice_cooked',210],['kimchi_jjigae',350]]],
      ['doenjang_jjigae_rice','된장찌개 + 공기밥',      [['rice_cooked',210],['doenjang_jjigae',350],['kimchi',40]]],
      ['sundubu_rice',        '순두부찌개 + 공기밥',    [['rice_cooked',210],['sundubu_jjigae',350]]],
      ['budae_jjigae_rice',   '부대찌개 + 공기밥',      [['rice_cooked',210],['budae_jjigae',350]]],
      ['galbitang_rice',      '갈비탕 + 공기밥',        [['rice_cooked',210],['galbitang',400],['kkakdugi',40]]],
      ['seolleongtang_rice',  '설렁탕 + 공기밥',        [['rice_cooked',210],['seolleongtang',400],['kkakdugi',40]]],
      ['samgyetang_set',      '삼계탕',                 [['samgyetang',500]]],
      ['yukgaejang_rice',     '육개장 + 공기밥',        [['rice_cooked',210],['yukgaejang',400]]],
      ['miyeokguk_rice',      '미역국 + 공기밥',        [['rice_cooked',210],['miyeokguk',300],['kimchi',40]]],
      ['kongnamulguk_rice',   '콩나물국 + 공기밥',      [['rice_cooked',210],['kongnamulguk',300],['kimchi',40]]],
      ['tteokguk_set',        '떡국',                   [['tteokguk',500]]],
      ['kalguksu_set',        '칼국수',                 [['kalguksu',500],['kimchi',40]]],
      ['bibimbap',            '비빔밥',                 [['rice_cooked',210],['bibimbap_topping',200],['egg_fried',55]]],
      ['jeyuk_rice',          '제육볶음 + 공기밥',      [['rice_cooked',210],['jeyuk',180],['lettuce',40]]],
      ['bulgogi_rice',        '불고기 + 공기밥',        [['rice_cooked',210],['bulgogi_beef',180],['kimchi',40]]],
      ['dakgalbi_rice',       '닭갈비 + 공기밥',        [['rice_cooked',210],['dakgalbi',250]]],
      ['jjimdak_rice',        '찜닭 + 공기밥',          [['rice_cooked',210],['jjimdak',300]]],
      ['galbijjim_rice',      '갈비찜 + 공기밥',        [['rice_cooked',210],['galbijjim',200]]],
      ['samgyeopsal_set',     '삼겹살 + 밥 + 쌈',       [['pork_belly',200],['rice_cooked',210],['lettuce',50],['ssamjang',20]]],
      ['samgyeopsal_only',    '삼겹살 (밥 없이)',       [['pork_belly',200],['lettuce',60],['ssamjang',20]]],
      ['bossam_set',          '수육(보쌈) + 밥',        [['pork_bossam',180],['rice_cooked',210],['kimchi',60]]],
      ['galbi_gui_rice',      '소갈비구이 + 공기밥',    [['beef_short_rib',180],['rice_cooked',210],['kimchi',40]]],
      ['deungsim_rice',       '소고기 등심구이 + 공기밥',[['beef_sirloin',150],['rice_cooked',210],['lettuce',40],['ssamjang',15]]],
      ['mokssal_set',         '목살구이 + 밥 + 쌈',     [['pork_neck',200],['rice_cooked',210],['lettuce',50],['ssamjang',20]]],
      ['gukbap_pork_set',     '돼지국밥',               [['gukbap_pork',600]]],
      ['sundae_gukbap_set',   '순댓국',                 [['sundae_gukbap',600]]],
      ['naengmyeon_set',      '물냉면',                 [['naengmyeon_bowl',550]]],
      ['bibim_naengmyeon',    '비빔냉면',               [['naengmyeon_noodle',200],['gochujang',30],['cucumber',40],['egg_boiled',30]]],
      ['japchae_rice',        '잡채 + 공기밥',          [['japchae',200],['rice_cooked',210]]],
      ['gimbap_set',          '김밥 1줄',               [['gimbap_roll',230]]],
      ['gimbap_tuna',         '참치김밥 1줄',           [['gimbap_roll',200],['tuna_canned',40],['mayonnaise',10]]],
      ['mandu_steamed',       '찐만두 (6개)',           [['mandu_skin',60],['pork_ground',60],['cabbage_napa',40],['tofu_firm',20],['green_onion',10]]],
      ['tteokbokki_set',      '떡볶이 1인분',           [['tteokbokki',300]]],
      ['tteokbokki_sundae',   '떡볶이 + 순대',          [['tteokbokki',250],['blood_sausage',100]]],
      ['sundubu_gyeran_rice', '순두부찌개 + 계란찜 + 밥',[['rice_cooked',210],['sundubu_jjigae',300],['gyeran_jjim',80]]],
      ['dwaeji_galbi_rice',   '돼지갈비 + 공기밥',      [['pork_rib',200],['rice_cooked',210],['kimchi',40]]],
      ['godeungeo_baekban',   '고등어구이 백반',        [['mackerel',120],['rice_cooked',210],['doenjang_jjigae',200],['kimchi',40]]],
      ['galchi_baekban',      '갈치구이 백반',          [['hairtail',120],['rice_cooked',210],['kimchi',40],['spinach',50]]],
      ['gulbi_baekban',       '굴비구이 백반',          [['gulbi',100],['rice_cooked',210],['doenjang_jjigae',200]]],
      ['jeonbokjuk',          '전복죽',                 [['porridge_abalone',400]]],
      ['hobakjuk',            '호박죽',                 [['porridge_pumpkin',400]]],
      ['kongnamul_bibimbap',  '콩나물비빔밥',           [['rice_cooked',210],['bean_sprout',100],['gochujang',25],['sesame_oil',5],['egg_fried',55]]],
      ['mapo_tofu_rice',      '마파두부 덮밥',          [['rice_cooked',210],['mapo_tofu',200]]],
      ['kimchi_fried_rice',   '김치볶음밥',             [['fried_rice',350]]],
      ['gyeran_bap',          '계란밥',                 [['rice_cooked',210],['egg_fried',100],['soy_sauce',8],['sesame_oil',5]]]
    ],

    /* ---------- 집밥: 밥 + 반찬 조합 (15) ---------- */
    banchan: [
      ['bap_saengseon_namul',   '밥 + 생선구이 + 나물',      [['rice_cooked',210],['mackerel',100],['spinach',60],['kimchi',40]]],
      ['bap_gyeran_gim',        '밥 + 계란말이 + 김',        [['rice_cooked',210],['egg_fried',90],['seasoned_gim',5],['kimchi',40]]],
      ['bap_dubu_namul',        '밥 + 두부부침 + 나물',      [['rice_cooked',210],['tofu_firm',120],['chwinamul',60],['kimchi',40]]],
      ['bap_jeyuk_sangchu',     '밥 + 제육 + 상추',          [['rice_cooked',210],['jeyuk',150],['lettuce',50]]],
      ['bap_bulgogi_namul',     '밥 + 불고기 + 나물',        [['rice_cooked',210],['bulgogi_beef',150],['bean_sprout',60],['kimchi',40]]],
      ['bap_gyeranjjim_gim',    '밥 + 계란찜 + 김',          [['rice_cooked',210],['gyeran_jjim',120],['seasoned_gim',5],['kimchi',40]]],
      ['bap_godeungeo_kongnamul','밥 + 고등어 + 콩나물무침', [['rice_cooked',210],['mackerel',110],['bean_sprout',70],['kimchi',40]]],
      ['bap_dakgasumsal_namul', '밥 + 닭가슴살 + 나물',      [['rice_cooked',210],['chicken_breast',120],['spinach',60],['kimchi',40]]],
      ['hyeonmi_dubu_namul',    '현미밥 + 두부 + 나물',      [['rice_brown',210],['tofu_firm',120],['spinach',60],['kimchi',40]]],
      ['japgok_saengseon',      '잡곡밥 + 생선 + 나물',      [['rice_multigrain',210],['cod',120],['chwinamul',60],['kimchi',40]]],
      ['bap_ojingeo_namul',     '밥 + 오징어볶음 + 나물',    [['rice_cooked',210],['squid_boiled',120],['gochujang',20],['bean_sprout',60]]],
      ['bap_gim_gyeran',        '밥 + 김 + 계란후라이',      [['rice_cooked',210],['seasoned_gim',6],['egg_fried',55],['kimchi',40]]],
      ['bap_doenjang_namul3',   '밥 + 된장국 + 나물 3종',    [['rice_cooked',210],['doenjang_jjigae',250],['spinach',50],['bean_sprout',50],['kimchi',40]]],
      ['bap_miyeokguk_gyeran',  '밥 + 미역국 + 계란찜',      [['rice_cooked',210],['miyeokguk',300],['gyeran_jjim',100]]],
      ['hyeonmi_dak_brocoli',   '현미밥 + 닭가슴살 + 브로콜리',[['rice_brown',210],['chicken_breast',150],['broccoli',100]]]
    ],

    /* ---------- 양식·간편식 (25) ---------- */
    western: [
      ['cream_pasta_set',   '크림 파스타',            [['cream_pasta',350]]],
      ['tomato_pasta_set',  '토마토 파스타',          [['tomato_pasta',350]]],
      ['oil_pasta_set',     '오일 파스타',            [['pasta_oil',350]]],
      ['rose_pasta_set',    '로제 파스타',            [['pasta_rose',350]]],
      ['pasta_tuna',        '참치 파스타',            [['pasta_cooked',200],['tuna_canned',80],['olive_oil',10],['cherry_tomato',60]]],
      ['sandwich_ham_set',  '햄치즈 샌드위치',        [['sandwich_ham_cheese',200]]],
      ['sandwich_egg',      '계란 샌드위치',          [['bread_white',80],['egg_boiled',100],['mayonnaise',15],['lettuce',20]]],
      ['toast_butter_honey','토스트 + 버터 + 꿀',     [['bread_white',60],['butter',10],['honey',10]]],
      ['toast_egg_cheese',  '토스트 + 계란 + 치즈',   [['bread_white',60],['egg_fried',55],['cheese_slice',20]]],
      ['avocado_toast',     '아보카도 토스트',        [['bread_whole',60],['avocado',70],['egg_fried',55]]],
      ['french_toast',      '프렌치토스트',           [['bread_white',60],['egg_boiled',50],['milk',50],['butter',8],['honey',10]]],
      ['gyeran_toast',      '계란 토스트',            [['bread_white',60],['egg_fried',80],['cabbage',40],['ketchup',10],['butter',8]]],
      ['pancake_set',       '팬케이크 + 시럽',        [['pancake',150],['honey',20],['butter',10]]],
      ['bagel_cream_cheese','베이글 + 크림치즈',      [['bagel',90],['cream_cheese',30]]],
      ['salad_chicken',     '닭가슴살 샐러드',        [['chicken_breast',120],['lettuce',60],['cherry_tomato',80],['paprika',40],['olive_oil',10]]],
      ['salad_tuna',        '참치 샐러드',            [['tuna_canned',100],['lettuce',60],['cucumber',50],['cherry_tomato',60],['olive_oil',8]]],
      ['cereal_milk',       '시리얼 + 우유',          [['cereal_corn',40],['milk',200]]],
      ['granola_yogurt',    '그래놀라 + 요거트',      [['granola',40],['greek_yogurt',150]]],
      ['oatmeal_banana',    '오트밀 + 바나나 + 아몬드',[['oatmeal_cooked',250],['banana',100],['almond',15]]],
      ['omelet_cheese',     '치즈 오믈렛',            [['egg_fried',110],['cheese_slice',20],['butter',5]]],
      ['steak_salad',       '스테이크 + 샐러드',      [['beef_sirloin',180],['lettuce',50],['cherry_tomato',60],['olive_oil',8]]],
      ['chicken_potato',    '닭가슴살 + 감자 + 브로콜리',[['chicken_breast',150],['potato',150],['broccoli',80]]],
      ['tortilla_wrap',     '또띠아 랩',              [['tortilla',70],['chicken_breast',100],['lettuce',30],['paprika',30],['mayonnaise',10]]],
      ['burger_home',       '홈메이드 버거',          [['bun_burger',80],['beef_ground',100],['cheese_slice',20],['lettuce',20],['ketchup',15]]],
      ['salmon_rice_bowl',  '연어 덮밥',              [['rice_cooked',210],['salmon_grilled',120],['seasoned_gim',3]]]
    ],

    /* ---------- 외식 (34) — 한중일·양식·베트남 ---------- */
    eatingout: [
      ['chicken_seasoned_set','양념치킨 1인분',      [['chicken_seasoned',250]]],
      ['chicken_soy_set',    '간장치킨 1인분',       [['chicken_soy',250]]],
      ['chicken_fried_set',  '후라이드치킨 1인분',   [['chicken_fried',250]]],
      ['pizza_combi_2',      '피자 2조각 (콤비네이션)',[['pizza_slice',200]]],
      ['pizza_pepperoni_2',  '페퍼로니 피자 2조각',  [['pizza_pepperoni',200]]],
      ['burger_set',         '햄버거 세트',          [['hamburger',220],['french_fries',115]]],
      ['burger_only',        '햄버거 단품',          [['hamburger',220]]],
      ['jjajangmyeon',       '짜장면',               [['noodle_wheat',250],['jjajang_sauce',200]]],
      ['jjamppong',          '짬뽕',                 [['noodle_wheat',250],['jjamppong_soup',400]]],
      ['tangsuyuk',          '탕수육 1인분',         [['sweet_sour_pork',200]]],
      ['jjajang_tangsu',     '짜장면 + 탕수육',      [['noodle_wheat',250],['jjajang_sauce',200],['sweet_sour_pork',120]]],
      ['donkatsu_set',       '돈까스 정식',          [['pork_cutlet',200],['rice_cooked',210],['cabbage',60]]],
      ['sushi_set',          '초밥 10피스',          [['sushi_piece',250]]],
      ['gukbap_out',         '돼지국밥 + 반찬',      [['gukbap_pork',600],['kkakdugi',50]]],
      ['sundae_gukbap_out',  '순댓국 + 반찬',        [['sundae_gukbap',600],['kkakdugi',50]]],
      ['pho_bowl',           '쌀국수 1그릇',         [['pho_beef',600]]],
      ['naengmyeon_out',     '물냉면 (외식)',        [['naengmyeon_bowl',600]]],
      ['samgyetang_out',     '삼계탕 (외식)',        [['samgyetang',600]]],
      ['galbitang_out',      '갈비탕 (외식)',        [['galbitang',500],['rice_cooked',210],['kkakdugi',40]]],
      ['bibimbap_out',       '비빔밥 (외식)',        [['rice_cooked',250],['bibimbap_topping',220],['egg_fried',55]]],
      ['kimbap_tteokbokki',  '김밥 + 떡볶이',        [['gimbap_roll',200],['tteokbokki',200]]],
      ['dakgalbi_out',       '닭갈비 (외식)',        [['dakgalbi',350],['rice_cooked',150]]],
      ['samgyeopsal_out',    '삼겹살 외식',          [['pork_belly',250],['rice_cooked',210],['lettuce',60],['ssamjang',25],['kimchi',50]]],
      ['galbi_out',          '소갈비 외식',          [['beef_short_rib',250],['rice_cooked',210],['kimchi',50]]],
      ['sandwich_cafe',      '샌드위치 (카페)',      [['sandwich_ham_cheese',250]]],

      /* 일식 */
      ['ramen_out',          '라멘',                 [['ramen_bowl',600]]],
      ['udon_out',           '우동',                 [['udon_bowl',600]]],
      ['gyudon',             '규동 (소고기덮밥)',    [['rice_cooked',250],['gyudon_topping',180]]],
      ['katsudon',           '가츠동',               [['rice_cooked',250],['katsudon_topping',200]]],
      ['hoedeopbap',         '회덮밥',               [['rice_cooked',210],['flatfish',100],['salmon_sashimi',50],['bibimbap_topping',100],['gochujang',25]]],
      ['salmon_sushi',       '연어초밥 8피스',       [['sushi_piece',200]]],

      /* 베트남 */
      ['buncha',             '분짜',                 [['buncha_set',400]]],
      ['banh_mi_set',        '반미',                 [['banh_mi',250]]],
      ['spring_roll_set',    '짜조 (스프링롤)',      [['spring_roll',150]]]
    ],

    /* ---------- 아침·간식 (10) ---------- */
    snack: [
      ['greek_yogurt_nuts', '그릭요거트 + 견과류',   [['greek_yogurt',150],['almond',20],['walnut',10]]],
      ['boiled_eggs',       '삶은 계란 2개',         [['egg_boiled',110]]],
      ['banana_milk',       '바나나 + 우유',         [['banana',100],['milk',200]]],
      ['fruit_plate',       '과일 한 접시',          [['apple',120],['tangerine',80],['strawberry',60]]],
      ['nuts_mix',          '견과류 한 줌',          [['almond',15],['walnut',10],['cashew',10]]],
      ['yogurt_fruit_nut',  '요거트 + 과일 + 견과',  [['yogurt_plain',150],['blueberry',60],['walnut',15]]],
      ['sweet_potato_snack','고구마 2개',            [['sweet_potato',200]]],
      ['tofu_snack',        '두부 반 모',            [['tofu_firm',150]]],
      ['bread_red_bean_one','단팥빵 1개',            [['bread_red_bean',90]]],
      ['ice_cream_cup',     '아이스크림 1컵',        [['ice_cream',120]]]
    ]
  };

  /* ---------- 조회·계산 ---------- */

  var LIST = [];
  var BY_ID = {};

  function build() {
    LIST = [];
    BY_ID = {};

    Object.keys(RAW).forEach(function (category) {
      RAW[category].forEach(function (row) {
        var tpl = {
          id: row[0],
          name: row[1],
          category: category,
          baseServing: '1인분',
          items: row[2].map(function (pair) {
            return { food: pair[0], g: pair[1] };
          })
        };
        LIST.push(tpl);
        BY_ID[tpl.id] = tpl;
      });
    });
  }

  function all() { return LIST; }

  function get(id) { return BY_ID[id] || null; }

  function byCategory(category) {
    return LIST.filter(function (t) { return t.category === category; });
  }

  /**
   * 템플릿의 영양소. 재료를 portion 배수로 늘려 합산한다.
   * @param {object|string} idOrTemplate
   * @param {number} portion 적게 0.7 / 보통 1.0 / 많이 1.4
   */
  function nutrients(idOrTemplate, portion) {
    var tpl = typeof idOrTemplate === 'string' ? get(idOrTemplate) : idOrTemplate;
    if (!tpl) return null;

    var ratio = portion === undefined ? 1 : Number(portion);
    var parts = tpl.items.map(function (item) {
      return FitLog.foods.scale(item.food, item.g * ratio);
    });
    return FitLog.foods.sum(parts);
  }

  /** 재료를 '밥 (백미) 210g' 형태의 문자열 배열로 */
  function itemLabels(idOrTemplate, portion) {
    var tpl = typeof idOrTemplate === 'string' ? get(idOrTemplate) : idOrTemplate;
    if (!tpl) return [];

    var ratio = portion === undefined ? 1 : Number(portion);
    return tpl.items.map(function (item) {
      var food = FitLog.foods.get(item.food);
      return (food ? food.name : item.food) + ' ' + Math.round(item.g * ratio) + 'g';
    });
  }

  /** 이름 부분일치 검색. foods.search 와 같은 정렬 규칙. */
  function search(query, limit) {
    var q = String(query || '').trim();
    if (!q) return [];

    var hits = LIST.filter(function (t) { return t.name.indexOf(q) >= 0; });
    hits.sort(function (a, b) {
      var ai = a.name.indexOf(q), bi = b.name.indexOf(q);
      if (ai !== bi) return ai - bi;
      return a.name.length - b.name.length;
    });
    return limit ? hits.slice(0, limit) : hits;
  }

  build();

  FitLog.templates = {
    PORTIONS: PORTIONS,
    CATEGORY_LABEL: CATEGORY_LABEL,
    all: all,
    get: get,
    byCategory: byCategory,
    nutrients: nutrients,
    itemLabels: itemLabels,
    search: search
  };
})(window.FitLog);
