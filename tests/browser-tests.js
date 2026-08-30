/* browser-tests.js — jsdom 으로 dist/index.html 을 띄워 실제로 클릭한다.
 *
 *   node build.js && node tests/browser-tests.js
 *
 * 왜 필요한가: run-tests.js 는 계산만 확인한다. 버튼이 실제로 붙어 있는지,
 * 눌렀을 때 저장까지 가는지는 화면을 띄워야 알 수 있다.
 * (Phase 7 검증 ⑥ — '버튼은 실제로 동작해야 한다. 텍스트만 보여주면 읽고 넘긴다')
 *
 * jsdom 을 믿지 말 것: [hidden] 우선순위를 실제 브라우저와 다르게 계산한다.
 * 화면에 보이느냐가 걸린 문제는 run-tests.js 의 CSS 검사가 소스를 직접 본다.
 * 여기서 확인하는 건 '눌렀을 때 데이터가 바뀌느냐' 다.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let jsdom;
try {
  jsdom = require('jsdom');
} catch (e) {
  console.error('[FitLog] jsdom 이 없다. npm install jsdom --no-save 후 다시 실행할 것.');
  process.exitCode = 1;
  return;
}

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src', 'js');
const DIST = path.join(ROOT, 'dist', 'index.html');

if (!fs.existsSync(DIST)) {
  console.error('[FitLog] dist/index.html 이 없다. 먼저 node build.js 를 실행할 것.');
  process.exitCode = 1;
  return;
}

/* ---------- 결과 집계 ---------- */

const results = [];
function ok(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail || '' });
}
function eq(name, actual, expected) {
  ok(name, actual === expected, `기대 ${expected} / 실제 ${actual}`);
}

/* ---------- 1. 넣어 둘 상태를 만든다 ----------
 * 온보딩을 클릭으로 통과시키는 대신, 앱이 읽는 저장소를 미리 채운다.
 * 여기서 확인하려는 건 온보딩이 아니라 주간 탭의 제안 카드다.
 */

function seedState() {
  const FILES = ['env.js', 'store.js', 'nutrition.js', 'foods.js', 'templates.js',
                 'supplements.js', 'calc.js', 'judge.js', 'suggest.js',
                 'share.js', 'backup.js', 'csv.js', 'report.js'];

  const box = { console };
  box.navigator = { userAgent: '', standalone: false };
  box.matchMedia = () => ({ matches: false });

  const mem = new Map();
  box.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { mem.set(k, String(v)); },
    removeItem: (k) => { mem.delete(k); }
  };
  box.window = box;
  box.globalThis = box;
  vm.createContext(box);

  for (const file of FILES) {
    vm.runInContext(fs.readFileSync(path.join(SRC, file), 'utf8'), box, { filename: file });
  }

  const F = box.window.FitLog;
  const state = F.store.load();
  state.profile = {
    height: 165, age: 40, sex: 'female', weight: 60,
    goals: ['maintain'], weeklyPlan: { strength: 2, cardio: 2 },
    createdAt: '2026-08-01'
  };
  state.targets = F.calc.computeTargets(state.profile);
  F.store.replace(state);

  // 최근 7일 내내 밥만 먹은 기록 — 미량영양소가 넓게 모자라 제안 카드가 뜬다
  const today = F.store.todayKey();
  F.judge.lastDays(today, 7).forEach(function (key) {
    F.store.addMeal(key, {
      type: 'lunch', sourceKind: 'food', sourceId: 'rice_cooked', label: '밥 (백미)',
      portion: 1, nutrients: F.foods.round(F.foods.scale('rice_cooked', 210))
    });
  });

  let raw = null;
  mem.forEach((value, key) => { if (key.indexOf('fitlog') === 0) raw = { key, value }; });
  return raw;
}

const seed = seedState();
ok('저장소에 넣을 상태를 만들었다', !!seed, seed ? seed.key : '없음');

/* ---------- 2. 화면을 띄운다 ---------- */

const dom = new jsdom.JSDOM(fs.readFileSync(DIST, 'utf8'), {
  url: 'https://example.org/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  beforeParse(window) {
    // 앱이 부팅하며 읽을 저장소를 미리 채운다
    window.localStorage.setItem(seed.key, seed.value);
    // 서비스워커·공유 API 는 jsdom 에 없다. 앱이 없어도 돌아가야 정상이다.
    window.matchMedia = window.matchMedia || function () {
      return { matches: false, addListener() {}, removeListener() {} };
    };
    // jsdom 에는 scrollTo 가 없다. 앱은 탭이 바뀔 때 맨 위로 올린다.
    window.scrollTo = function () {};
  }
});

const win = dom.window;
const doc = win.document;

function run() {
  const F = win.FitLog;
  ok('앱이 부팅했다', !!F && !!F.router);
  ok('온보딩을 건너뛰고 앱 화면이 켜졌다', doc.getElementById('app').hidden === false);

  /* ---------- 3. 주간 탭으로 이동 ---------- */

  const weekTab = doc.querySelector('.tab[data-tab="week"]');
  ok('주간 탭이 있다', !!weekTab);
  win.location.hash = '#week';
  F.router.render();

  const cards = Array.prototype.slice.call(doc.querySelectorAll('.card-title'));
  const suggestTitle = cards.filter((c) => c.textContent.indexOf('뭘 먹으면') >= 0)[0];
  ok('주간 탭에 제안 카드가 그려졌다', !!suggestTitle,
    cards.map((c) => c.textContent).join(' / '));

  const items = doc.querySelectorAll('.suggest-item');
  ok('음식 카드가 하나 이상 있다', items.length > 0, items.length + '개');
  ok('4~6개만 노출한다', items.length <= 6, items.length + '개');

  const first = items[0];
  ok('음식 이름이 보인다', !!first.querySelector('.suggest-name').textContent);
  ok('1회 섭취량이 보인다',
    first.querySelector('.suggest-serving').textContent.indexOf('(') >= 0,
    first.querySelector('.suggest-serving').textContent);
  ok('커버 영양소 뱃지가 보인다',
    first.querySelector('.suggest-covers').textContent.indexOf('채움') >= 0,
    first.querySelector('.suggest-covers').textContent);

  /* ---------- 4. [오늘 기록] 을 실제로 누른다 ---------- */

  const todayKey = F.store.todayKey();
  const before = F.store.getDay(todayKey).meals.length;
  const beforeReport = F.judge.nutritionReport(F.store.load(), todayKey, 7);

  const buttons = Array.prototype.slice.call(first.querySelectorAll('.suggest-btn'));
  const logBtn = buttons.filter((b) => b.textContent === '오늘 기록')[0];
  const favBtn = buttons.filter((b) => b.textContent.indexOf('즐겨찾기') >= 0)[0];
  ok('[오늘 기록] 버튼이 있다', !!logBtn);
  ok('[즐겨찾기 추가] 버튼이 있다', !!favBtn);

  const pickedName = first.querySelector('.suggest-name').textContent;
  logBtn.dispatchEvent(new win.Event('click', { bubbles: true }));

  const after = F.store.getDay(todayKey).meals;
  eq('오늘 끼니가 하나 늘었다', after.length, before + 1);

  const added = after[after.length - 1];
  eq('간식으로 들어간다', added.type, 'snack');
  eq('누른 음식이 들어갔다', added.label, pickedName);
  ok('영양소가 1회 섭취량 기준으로 계산돼 저장됐다',
    (added.nutrients.kcal || 0) > 0, JSON.stringify(added.nutrients.kcal));

  /* 추가 후 판정이 다시 계산되는지 — 화면이 새로 그려졌고 숫자가 움직였다 */
  const afterReport = F.judge.nutritionReport(F.store.load(), todayKey, 7);
  const movedKey = added.sourceId;
  ok('추가 후 주간 판정이 다시 계산된다',
    JSON.stringify(afterReport.avg) !== JSON.stringify(beforeReport.avg),
    movedKey);

  const redrawn = doc.querySelectorAll('.suggest-item');
  ok('버튼을 누른 뒤 화면이 다시 그려졌다', redrawn.length >= 0 && redrawn[0] !== first);

  /* ---------- 5. [즐겨찾기 추가] 를 실제로 누른다 ---------- */

  const items2 = doc.querySelectorAll('.suggest-item');
  ok('다시 그린 뒤에도 카드가 있다', items2.length > 0, items2.length + '개');

  const row2 = items2[0];
  const fav2 = Array.prototype.slice.call(row2.querySelectorAll('.suggest-btn'))
    .filter((b) => b.textContent.indexOf('즐겨찾기') >= 0)[0];
  const favId = F.suggest.build(F.store.load(), todayKey, 7).foods[0].id;

  ok('누르기 전에는 즐겨찾기가 아니다', F.store.isFavorite('food', favId) === false, favId);
  fav2.dispatchEvent(new win.Event('click', { bubbles: true }));
  ok('누르면 즐겨찾기에 들어간다', F.store.isFavorite('food', favId) === true, favId);
  eq('버튼 글자가 자기 자리에서 바뀐다', fav2.textContent, '즐겨찾기 됨');

  // 목록이 통째로 다시 그려지지 않았는지 (스크롤·포커스가 날아가면 안 된다)
  ok('즐겨찾기는 전체 재렌더 없이 처리된다',
    doc.querySelectorAll('.suggest-item')[0] === row2);

  fav2.dispatchEvent(new win.Event('click', { bubbles: true }));
  ok('다시 누르면 빠진다', F.store.isFavorite('food', favId) === false);
  eq('글자도 되돌아온다', fav2.textContent, '즐겨찾기 추가');

  /* ---------- 6. 기록이 3일 미만이면 안내 문구만 ----------
   * 0일이 아니라 2일로 본다. 기록이 아예 없으면 주간 탭이 앞에서
   * '며칠 기록하면 평균이 나와' 로 끝나서 제안 카드까지 가지도 않는다.
   */
  const fresh = F.store.load();
  const keepDays = F.judge.lastDays(todayKey, 7).slice(-2);
  const trimmed = {};
  keepDays.forEach((k) => { if (fresh.dailyLogs[k]) trimmed[k] = fresh.dailyLogs[k]; });
  fresh.dailyLogs = trimmed;
  F.store.replace(fresh);
  F.router.render();

  eq('주간 기록을 2일로 줄였다',
    F.judge.nutritionReport(F.store.load(), todayKey, 7).loggedDays, 2);

  const fewTitle = Array.prototype.slice.call(doc.querySelectorAll('.card-title'))
    .filter((c) => c.textContent.indexOf('뭘 먹으면') >= 0)[0];
  if (fewTitle) {
    const note = fewTitle.parentNode.querySelector('.card-note');
    ok('기록 2일이면 음식 카드 대신 안내 문구만',
      !!note && note.textContent.indexOf('기록이 더 쌓이면') >= 0,
      note ? note.textContent : '문구 없음');
  } else {
    ok('기록 2일이면 음식 카드 대신 안내 문구만', false, '카드가 아예 없다');
  }
  eq('기록이 적으면 음식 카드는 0개', doc.querySelectorAll('.suggest-item').length, 0);

  report();
}

function report() {
  const failed = results.filter((r) => !r.pass);
  results.forEach((r) => {
    if (!r.pass) console.error('  ✗ ' + r.name + (r.detail ? ' — ' + r.detail : ''));
  });
  console.log(`\n[FitLog] 브라우저 테스트 ${results.length}건 중 ` +
    `${results.length - failed.length}건 통과, ${failed.length}건 실패`);
  if (failed.length) process.exitCode = 1;
}

win.addEventListener('load', () => {
  try {
    run();
  } catch (e) {
    console.error('[FitLog] 브라우저 테스트가 예외로 멈췄다:\n', e);
    process.exitCode = 1;
  }
});
