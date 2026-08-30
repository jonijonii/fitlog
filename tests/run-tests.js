/* run-tests.js — Node 에서 계산 로직 단위 테스트를 실행한다.
 *
 *   node tests/run-tests.js
 *
 * DOM 없이 돌아가는 모듈(store / nutrition / calc / backup)만 로드한다.
 * 브라우저에서는 같은 테스트를 FitLog.runTests() 로 실행할 수 있다.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src', 'js');
const FILES = ['env.js', 'store.js', 'nutrition.js', 'foods.js', 'templates.js',
               'supplements.js', 'calc.js', 'judge.js', 'suggest.js', 'share.js', 'backup.js', 'csv.js', 'report.js', 'tests.js'];

const sandbox = { console };

// env.js 의 감지 함수는 navigator/matchMedia 를 본다. 감지는 인자로 UA 를 받는
// 순수 함수라 테스트엔 영향 없지만, 로드 시점에 참조가 없으면 안 되므로 최소 스텁을 둔다.
sandbox.navigator = { userAgent: '', standalone: false };
sandbox.matchMedia = () => ({ matches: false });

// 브라우저의 localStorage 대신 쓸 최소 구현. 저장 계층을 실제로 태워 보기 위한 것.
const mem = new Map();
sandbox.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const file of FILES) {
  const code = fs.readFileSync(path.join(SRC, file), 'utf8');
  vm.runInContext(code, sandbox, { filename: file });
}

const summary = sandbox.window.FitLog.runTests();

/* ---------- ES5 정적 검사 ----------
 * 이 앱은 구형 모바일 브라우저에서도 돌아야 한다. ES6+ 문법이나 내장 함수가 하나 섞이면
 * 그 파일 전체가 파싱/실행에 실패하고, 사용자에게는 '버튼이 안 눌린다'로만 보인다.
 * (실제로 padStart 하나 때문에 온보딩 마지막 단계가 멈춘 적이 있다.)
 */

const BANNED_SYNTAX = [
  [/=>/, '화살표 함수'],
  [/`/, '템플릿 리터럴'],
  [/\bconst\s+\w/, 'const'],
  [/\blet\s+\w/, 'let'],
  [/\?\./, '옵셔널 체이닝'],
  [/\?\?/, 'null 병합 연산자'],
  [/\bclass\s+\w/, 'class'],
  [/\basync\s/, 'async'],
  [/\.\.\./, '스프레드']
];

const BANNED_BUILTINS = [
  ['.padStart(', 'String.padStart (ES2017)'],
  ['.padEnd(', 'String.padEnd (ES2017)'],
  ['.trimStart(', 'String.trimStart (ES2019)'],
  ['.trimEnd(', 'String.trimEnd (ES2019)'],
  ['.flat(', 'Array.flat (ES2019)'],
  ['.flatMap(', 'Array.flatMap (ES2019)'],
  ['Object.entries(', 'Object.entries (ES2017)'],
  ['Object.values(', 'Object.values (ES2017)'],
  ['Object.assign(', 'Object.assign (ES2015)'],
  ['Array.from(', 'Array.from (ES2015)']
];

/** 주석을 걷어낸다. 주석 안의 화살표·백틱까지 잡으면 오탐이 난다. */
function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// Node 에서 로드하는 파일만이 아니라 src/js 전체를 검사한다.
// DOM 을 쓰는 파일(views·sheet·app)은 여기서만 걸러낼 수 있다.
const ALL_FILES = fs.readdirSync(SRC).filter((f) => f.slice(-3) === '.js').sort();
const es5Problems = [];

for (const file of ALL_FILES) {
  const code = stripComments(fs.readFileSync(path.join(SRC, file), 'utf8'));

  BANNED_SYNTAX.forEach(([re, name]) => {
    if (re.test(code)) es5Problems.push(`${file}: ${name}`);
  });
  BANNED_BUILTINS.forEach(([needle, name]) => {
    if (code.indexOf(needle) >= 0) es5Problems.push(`${file}: ${name}`);
  });
}

/* ---------- CSS 검사 ----------
 * el.hidden = true 는 브라우저 기본 스타일([hidden]{display:none})에 의존한다.
 * 그런데 작성자 스타일은 기본 스타일을 무조건 이기므로, .onboarding{display:flex} 같은
 * 규칙 하나가 hidden 을 무력화한다. 이 경우 JS 는 정상 동작하고 화면만 안 바뀌어서
 * 에러도 안 남는다 — jsdom 은 기본 스타일 우선순위를 다르게 계산해서 이걸 못 잡는다.
 * 그래서 전역 방어 규칙이 살아 있는지 소스에서 직접 확인한다.
 */

const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'app.css'), 'utf8');
const cssProblems = [];

if (!/\[hidden\]\s*\{[^}]*display:\s*none\s*!important/.test(css)) {
  cssProblems.push('전역 [hidden]{display:none !important} 규칙이 없다 — hidden 으로 숨기는 요소가 안 사라질 수 있다');
}

if (cssProblems.length) {
  console.error('\n[FitLog] CSS 검사 실패:');
  cssProblems.forEach((p) => console.error('  ✗ ' + p));
} else {
  console.log('[FitLog] CSS 검사 통과 — hidden 방어 규칙 있음');
}

/* ---------- 배포 묶음 검사 ----------
 * 서비스워커는 인라인할 수 없어서 dist 가 여러 파일이 된다.
 * 파일 하나가 빠지거나 캐시 버전이 안 맞으면 오프라인이 조용히 안 되거나,
 * 옛 화면이 계속 뜬다. 빌드 결과를 직접 확인한다.
 */

const DIST = path.join(__dirname, '..', 'dist');
const deployProblems = [];

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  deployProblems.push('dist/index.html 이 없다 — 먼저 node build.js 를 실행할 것');
} else {
  const distHtml = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');

  [['<link rel="manifest"', 'manifest 링크'],
   ['apple-mobile-web-app-capable', 'iOS 전체화면 메타'],
   ['apple-touch-icon', 'iOS 홈화면 아이콘'],
   ['viewport-fit=cover', '노치 대응 viewport']].forEach(([needle, name]) => {
    if (distHtml.indexOf(needle) < 0) deployProblems.push(`dist/index.html 에 ${name} 이 없다`);
  });

  ['sw.js', 'manifest.webmanifest', 'icons/icon-180.png',
   'icons/icon-192.png', 'icons/icon-512.png'].forEach((rel) => {
    if (!fs.existsSync(path.join(DIST, rel))) deployProblems.push(`dist/${rel} 이 없다`);
  });

  // 캐시 버전이 앱 빌드 번호와 같아야 새 배포가 반영된다
  const appBuild = (fs.readFileSync(path.join(SRC, 'app.js'), 'utf8')
    .match(/var BUILD = '([^']+)'/) || [])[1];

  if (fs.existsSync(path.join(DIST, 'sw.js'))) {
    const distSw = fs.readFileSync(path.join(DIST, 'sw.js'), 'utf8');
    if (distSw.indexOf('__BUILD__') >= 0) {
      deployProblems.push('dist/sw.js 의 __BUILD__ 가 치환되지 않았다');
    }
    if (appBuild && distSw.indexOf("'" + appBuild + "'") < 0) {
      deployProblems.push(`dist/sw.js 의 캐시 버전이 앱 빌드(${appBuild})와 다르다 — 다시 빌드할 것`);
    }

    // 서비스워커가 캐시하려는 파일이 실제로 있는지
    const shell = (distSw.match(/var SHELL = \[([\s\S]*?)\]/) || [])[1] || '';
    shell.split(',').forEach((raw) => {
      const rel = raw.replace(/['"\s]/g, '').replace(/^\.\//, '');
      if (!rel || rel === '') return;
      if (!fs.existsSync(path.join(DIST, rel))) {
        deployProblems.push(`sw.js 가 캐시하려는 ${rel} 이 dist 에 없다`);
      }
    });
  }

  if (fs.existsSync(path.join(DIST, 'manifest.webmanifest'))) {
    try {
      const mf = JSON.parse(fs.readFileSync(path.join(DIST, 'manifest.webmanifest'), 'utf8'));
      ['name', 'short_name', 'start_url', 'display', 'icons'].forEach((key) => {
        if (!mf[key]) deployProblems.push(`manifest 에 ${key} 가 없다`);
      });
      if (mf.display !== 'standalone') {
        deployProblems.push(`manifest display 가 standalone 이 아니다 (${mf.display}) — 전체화면으로 안 뜬다`);
      }
      (mf.icons || []).forEach((icon) => {
        const rel = String(icon.src).replace(/^\.\//, '');
        if (!fs.existsSync(path.join(DIST, rel))) {
          deployProblems.push(`manifest 가 가리키는 ${rel} 이 없다`);
        }
      });
      if (!(mf.icons || []).some((i) => String(i.purpose || '').indexOf('maskable') >= 0)) {
        deployProblems.push('manifest 에 maskable 아이콘이 없다 — 안드로이드에서 잘려 보인다');
      }
    } catch (e) {
      deployProblems.push('manifest 가 올바른 JSON 이 아니다: ' + e.message);
    }
  }
}

if (deployProblems.length) {
  console.error('\n[FitLog] 배포 검사 실패:');
  deployProblems.forEach((p) => console.error('  ✗ ' + p));
} else {
  console.log('[FitLog] 배포 검사 통과 — PWA 묶음 정상');
}

if (es5Problems.length) {
  console.error('\n[FitLog] ES5 검사 실패 — 구형 브라우저에서 죽을 수 있는 코드:');
  es5Problems.forEach((p) => console.error('  ✗ ' + p));
} else {
  console.log('[FitLog] ES5 검사 통과 — 검사한 파일 ' + ALL_FILES.length + '개');
}

/* ---------- 영양 데이터 sanity 검사 (Phase 7 ①) ----------
 * typicalServing 을 채운 음식을 훑어 '그럴듯하게 틀린 숫자'를 찾는다.
 *
 * 이건 테스트 실패가 아니라 '확인 필요' 목록이다 — 빌드를 막지 않는다.
 * 걸린 값을 임의로 고치지 말고 사람이 보고 판단할 것.
 * (영양 데이터는 애초에 추정치라, 자동으로 참/거짓을 가릴 수 있는 종류가 아니다.)
 */

const foodsApi = sandbox.window.FitLog.foods;
const allFoods = foodsApi.all();
const servedFoods = allFoods.filter((f) => f.typicalServing);
const sanityNotes = [];

/* (1) 1회 섭취량이 상식적인가.
 * 그룹마다 한 번에 먹는 양의 폭이 다르다 (양념 몇 g ~ 과일 한 개 300g).
 * 아래 범위는 '정답'이 아니라 '이 밖이면 사람이 다시 봐야 한다' 는 경계다.
 * 잡으려는 것: 바나나 500g, 김 100g 같은 항목.
 */
const SERVING_RANGE = {
  grain:      [20, 300],
  meat:       [20, 250],
  seafood:    [2, 250],    // 마른 김 2g ~ 생선구이 200g 까지 한 그룹에 있다
  vegetable:  [3, 200],
  fruit:      [10, 300],
  dairy:      [5, 250],
  legume_nut: [3, 200],
  seasoning:  [1, 50],
  dish:       [30, 400]
};
/* 1회분 열량 상한도 그룹마다 다르다.
 * 처음엔 400kcal 하나로 뒀는데, 채소 기준이라 고기 주요리가 전부 걸렸다 —
 * 삼겹살 200g(760kcal)은 '양 조절' 표에 있는 정상 1인분이다.
 * 하한 3kcal 은 공통 (양념 몇 g 도 통과해야 한다). */
const SERVING_KCAL_MIN = 3;
const SERVING_KCAL_MAX = {
  grain: 500, meat: 900, seafood: 500, vegetable: 300, fruit: 300,
  dairy: 400, legume_nut: 300, seasoning: 200, dish: 900
};

servedFoods.forEach((food) => {
  const srv = food.typicalServing;
  const range = SERVING_RANGE[food.group];
  const kcal = food.per100g.kcal * srv.amount / 100;

  if (range && (srv.amount < range[0] || srv.amount > range[1])) {
    sanityNotes.push(`[1회량] ${food.name}(${food.id}) ${srv.amount}${srv.unit} — `
      + `${food.group} 그룹 상식 범위 ${range[0]}~${range[1]}g 밖`);
  }
  const kcalMax = SERVING_KCAL_MAX[food.group] || 500;
  if (kcal < SERVING_KCAL_MIN || kcal > kcalMax) {
    sanityNotes.push(`[1회량] ${food.name}(${food.id}) ${srv.amount}${srv.unit} = `
      + `${Math.round(kcal)}kcal — ${food.group} 1회분 열량 ${SERVING_KCAL_MIN}~${kcalMax}kcal 밖`);
  }

  // 말린 것은 부피가 크고 가벼워서 한 번에 많이 못 먹는다. 김 100g(50장쯤) 같은 값을 잡는다.
  // 그램 범위만으로는 안 걸린다 — 김 100g 은 180kcal 이라 열량 검사도 통과한다.
  if (food.per100g.fiber >= 15 && srv.amount > 30) {
    sanityNotes.push(`[1회량] ${food.name}(${food.id}) ${srv.amount}${srv.unit} — `
      + `말린 식품(식이섬유 ${food.per100g.fiber}g/100g)치고 양이 많다`);
  }
});

/* (2) 100g당 열량이 매크로 합산과 맞는가.
 * kcal ≈ 탄수×4 + 단백질×4 + 지방×9. ±20% 이상 어긋나면 입력 실수를 의심한다.
 * 절대 차이가 15kcal 미만이면 넘긴다 — 저열량 채소는 조금만 틀려도 %가 크게 튄다.
 *
 * 식이섬유는 탄수에 포함돼 있는데 열량은 거의 안 낸다. 그래서 김·미역처럼 섬유가 많은
 * 항목은 이 식으로는 늘 어긋난다. 목록에서 빼지 않고 '섬유 빼면 맞음' 이라고 적어 둔다 —
 * 조용히 넘기면 진짜 입력 실수가 같은 이유로 묻힌다.
 */
servedFoods.forEach((food) => {
  const p = food.per100g;
  const macroKcal = p.carbs * 4 + p.protein * 4 + p.fat * 9;
  const diff = macroKcal - p.kcal;

  if (Math.abs(diff) < 15) return;
  if (p.kcal > 0 && Math.abs(diff) / p.kcal < 0.2) return;

  // 식이섬유를 열량 없는 탄수로 보면 오차가 사라지는지
  const netKcal = (p.carbs - p.fiber) * 4 + p.protein * 4 + p.fat * 9;
  const explained = p.kcal > 0 && Math.abs(netKcal - p.kcal) / p.kcal < 0.2;

  sanityNotes.push(`[열량] ${food.name}(${food.id}) 표기 ${p.kcal}kcal / `
    + `매크로 합산 ${Math.round(macroKcal)}kcal (${diff > 0 ? '+' : ''}${Math.round(diff)})`
    + (explained ? ` — 식이섬유 ${p.fiber}g 빼면 ${Math.round(netKcal)}kcal 로 맞음` : ''));
});

/* (3) 어떤 영양소가 같은 식품군 평균의 5배를 넘는가.
 * 평균은 그룹 전체(typicalServing 없는 것 포함)로 낸다 — 표본이 클수록 튀는 값이 드러난다.
 * 진짜로 높은 항목(호두의 오메가3 등)도 걸리지만, 자릿수 실수도 여기서 걸린다.
 *
 * 단, '평균의 5배'만 보면 버섯 비타민D 0.2µg(그룹 평균 0.0) 같은 것까지 걸린다.
 * 배수는 커도 몸에 들어오는 양은 없는 것이나 마찬가지라 목록만 길어진다.
 * 그래서 실효성 문턱을 같이 둔다 — 1회 섭취량 기준으로 의미 있는 양일 때만 적는다.
 */

// 미량영양소는 하루 권장량의 5% 이상을 실제로 공급할 때만 본다.
// 기준 프로필은 검사용 성인값이다 (특정 사람의 수치가 아니다).
const REF_DRI = sandbox.window.FitLog.nutrition.microTargets({ sex: 'female', age: 35 });

// 매크로는 권장량 표가 없어서 절대량으로 문턱을 둔다 (100g 기준).
const MACRO_FLOOR = { kcal: 150, protein: 5, carbs: 15, fat: 5, fiber: 2 };

function isMaterial(key, per100gValue, servingGrams) {
  if (MACRO_FLOOR[key] !== undefined) return per100gValue >= MACRO_FLOOR[key];
  const dri = REF_DRI[key];
  if (!dri) return true;                       // 권장량이 없는 영양소는 그대로 본다
  return (per100gValue * servingGrams / 100) >= dri * 0.05;
}
const groupMean = {};
allFoods.forEach((food) => {
  const g = groupMean[food.group] || (groupMean[food.group] = { n: 0, sum: {} });
  g.n += 1;
  foodsApi.KEYS.forEach((key) => {
    g.sum[key] = (g.sum[key] || 0) + (Number(food.per100g[key]) || 0);
  });
});

servedFoods.forEach((food) => {
  const g = groupMean[food.group];
  const spikes = [];

  foodsApi.KEYS.forEach((key) => {
    const mean = g.sum[key] / g.n;
    const value = Number(food.per100g[key]) || 0;
    if (mean <= 0 || value <= 0) return;
    if (value <= mean * 5) return;
    if (!isMaterial(key, value, food.typicalServing.amount)) return;
    spikes.push(`${key} ${value}(평균 ${mean.toFixed(1)})`);
  });

  if (spikes.length) {
    sanityNotes.push(`[돌출] ${food.name}(${food.id}) — ` + spikes.join(', '));
  }
});

/* (4) CLAUDE.md '양 조절' 절의 1인분 표와 어긋나는가.
 * 표에 값이 있는 항목은 표를 따라야 한다. 표를 고쳤으면 여기도 같이 고칠 것.
 */
const PORTION_TABLE = {
  // 공기밥 210g
  rice_cooked: 210, rice_brown: 210, rice_multigrain: 210, rice_black: 210,
  // 면류 (삶은 것) 200g
  noodle_wheat: 200, noodle_ramen: 200, noodle_udon: 200, noodle_soba: 200,
  noodle_glass: 200, noodle_rice: 200, pasta_cooked: 200,
  jjolmyeon_noodle: 200, naengmyeon_noodle: 200,
  // 삼겹살·목살 구이 200g
  pork_belly: 200, pork_neck: 200,
  // 소·돼지 살코기 150g
  beef_sirloin: 150, beef_lean: 150, pork_loin: 150, pork_shoulder: 150,
  // 닭가슴살 120g
  chicken_breast: 120,
  // 생선구이 (고등어·갈치) 120g
  mackerel: 120, hairtail: 120,
  // 계란 1개 55g
  egg_boiled: 55, egg_fried: 55,
  // 나물·반찬 1접시 60g
  spinach: 60, bean_sprout: 60, mung_sprout: 60,
  bracken: 60, chwinamul: 60, water_parsley: 60,
  // 김치 1접시 40g
  kimchi: 40, kkakdugi: 40
};

Object.keys(PORTION_TABLE).forEach((id) => {
  const food = foodsApi.get(id);
  if (!food || !food.typicalServing) return;   // 아직 안 채운 항목은 넘긴다
  if (food.typicalServing.amount !== PORTION_TABLE[id]) {
    sanityNotes.push(`[1인분표] ${food.name}(${id}) ${food.typicalServing.amount}g — `
      + `표 기준 ${PORTION_TABLE[id]}g 와 다르다`);
  }
});

console.log(`\n[FitLog] 영양 데이터 sanity 검사 — typicalServing ${servedFoods.length}개 / 전체 ${allFoods.length}개`);
if (sanityNotes.length) {
  console.log(`  확인 필요 ${sanityNotes.length}건 (빌드는 막지 않는다. 값은 사람이 보고 고칠 것)`);
  sanityNotes.forEach((note) => console.log('  · ' + note));
} else {
  console.log('  확인 필요 항목 없음');
}

if (summary.failed > 0 || es5Problems.length || cssProblems.length || deployProblems.length) {
  process.exitCode = 1;
}
