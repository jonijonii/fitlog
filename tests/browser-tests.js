/* browser-tests.js — jsdom 으로 dist/index.html 을 띄워 실제로 클릭한다.
 *
 *   node build.js && node tests/browser-tests.js
 *
 * 왜 필요한가: run-tests.js 는 계산만 확인한다. 계산이 실제로 화면까지 닿는지는
 * 띄워 봐야 알 수 있다 — 함수가 맞아도 안 불리면 사용자에게는 아무것도 안 보인다.
 *
 * jsdom 을 믿지 말 것: [hidden] 우선순위를 실제 브라우저와 다르게 계산한다.
 * 화면에 보이느냐가 걸린 문제는 run-tests.js 의 CSS 검사가 소스를 직접 본다.
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
  // 성분이 비어 있는 보충제. 설정 탭의 '성분 추가' 를 눌러 볼 대상이다
  // (코엔자임Q10 처럼 KDRI 목록에 없는 프리셋은 nutrients 가 비어 있다).
  state.supplements = [
    { id: 'sup_q10', name: '코엔자임Q10', presetId: 'coq10', timeSlot: 'lunch',
      dailyDoses: 1, nutrients: {}, enabled: true }
  ];
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

  /* ---------- 4. 읽을 수 있는 문장이 나오는가 ----------
   * 버튼도 카드도 없다. 다음 주 식단을 고를 때 참고할 정보만 있으면 된다:
   *   "이번 주엔 칼륨과 칼슘이 부족하네. 칼륨은 감자, 고구마, 시금치로 보충할 수 있어."
   */
  const todayKey = F.store.todayKey();
  const card = suggestTitle.parentNode;

  const headline = card.querySelector('.suggest-headline');
  ok('첫 줄에 뭐가 부족한지 나온다', !!headline, headline ? headline.textContent : '없음');
  ok('이번 주라고 밝힌다',
    headline.textContent.indexOf('이번 주엔') === 0, headline.textContent);
  ok('부족하다고 말한다',
    headline.textContent.indexOf('부족하네') > 0, headline.textContent);

  const lines = Array.prototype.slice.call(card.querySelectorAll('.suggest-line'));
  ok('영양소별로 한 줄씩 나온다', lines.length > 0, lines.length + '줄');
  lines.forEach((line) => {
    ok('보충할 수 있다고 맺는다', line.textContent.indexOf('보충할 수 있어.') > 0,
      line.textContent);
    ok('괄호 설명은 문장에 안 들어간다', line.textContent.indexOf('(') < 0,
      line.textContent);
  });

  const plan = F.suggest.build(F.store.load(), todayKey, 7);
  eq('화면 줄 수가 계산 결과와 같다', lines.length, plan.lines.length);
  ok('부족 영양소는 모두 다뤄진다',
    plan.lines.length + plan.uncovered.length === plan.gaps.length,
    plan.gaps.map((g) => g.key).join(', '));

  /* ---------- 5. 정보만 준다 — 버튼은 두지 않는다 ----------
   * 기록 버튼을 달았다가 뺀 자리다. 목적이 '기록' 이 아니라 '참고' 라서다.
   */
  eq('제안 카드에 버튼이 없다', card.querySelectorAll('button').length, 0);
  eq('음식 카드도 없다', card.querySelectorAll('.suggest-item').length, 0);

  const beforeMeals = F.store.getDay(todayKey).meals.length;
  eq('화면을 봐도 기록이 늘지 않는다',
    F.store.getDay(todayKey).meals.length, beforeMeals);

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
    ok('기록 2일이면 제안 대신 안내 문구만',
      !!note && note.textContent.indexOf('기록이 더 쌓이면') >= 0,
      note ? note.textContent : '문구 없음');
  } else {
    ok('기록 2일이면 제안 대신 안내 문구만', false, '카드가 아예 없다');
  }
  eq('기록이 적으면 제안 문장은 0줄', doc.querySelectorAll('.suggest-line').length, 0);

  /* ---------- 7. 설정 → 보충제 성분 추가 ----------
   * '성분 추가가 안 된다' 는 신고를 받은 자리다. 값은 정상 저장되고 있었는데,
   * 재렌더로 펼친 패널이 접히고 토스트도 없어서 아무 일도 안 난 것처럼 보였다.
   * 저장만 확인하면 이 버그를 못 잡는다 — 화면이 어떻게 되는지까지 봐야 한다.
   */
  win.location.hash = '#settings';
  F.router.render();

  const heads = Array.prototype.slice.call(doc.querySelectorAll('.sup-edit-head'));
  const q10Head = heads.filter((h) => h.textContent.indexOf('코엔자임') >= 0)[0];
  ok('설정에 보충제 편집 행이 있다', !!q10Head,
    heads.map((h) => h.textContent.trim()).join(' | '));

  const q10Body = q10Head.parentNode.querySelector('.sup-edit-body');
  ok('처음엔 접혀 있다', q10Body.hidden === true);
  q10Head.dispatchEvent(new win.Event('click', { bubbles: true }));
  ok('누르면 펼쳐진다', q10Body.hidden === false);

  const pick = Array.prototype.slice.call(q10Body.querySelectorAll('select'))
    .filter((x) => x.getAttribute('aria-label') === '추가할 성분')[0];
  const amountInput = Array.prototype.slice.call(q10Body.querySelectorAll('input'))
    .filter((x) => x.getAttribute('aria-label') === '함량')[0];
  const addBtn = Array.prototype.slice.call(q10Body.querySelectorAll('button'))
    .filter((x) => x.textContent === '성분 추가')[0];

  ok('성분 고르기 목록이 있다', !!pick && pick.options.length > 1,
    pick ? pick.options.length + '개' : '없음');
  ok('함량 칸이 있다', !!amountInput);
  ok('성분 추가 버튼이 있다', !!addBtn);

  pick.value = 'vitaminC';
  amountInput.value = '500';
  addBtn.dispatchEvent(new win.Event('click', { bubbles: true }));

  const q10After = F.store.load().supplements.filter((x) => x.id === 'sup_q10')[0];
  eq('성분이 저장된다', q10After.nutrients.vitaminC, 500);

  const bodyAfter = Array.prototype.slice.call(doc.querySelectorAll('.sup-edit-head'))
    .filter((h) => h.textContent.indexOf('코엔자임') >= 0)[0]
    .parentNode.querySelector('.sup-edit-body');
  ok('추가한 뒤에도 패널이 열려 있다 — 접히면 안 된 줄 안다',
    bodyAfter.hidden === false);
  ok('추가했다고 알려 준다',
    (doc.getElementById('toast').textContent || '').indexOf('추가했어') >= 0,
    doc.getElementById('toast').textContent);

  const rows = Array.prototype.slice.call(bodyAfter.querySelectorAll('.nut-label'));
  ok('추가한 성분이 목록에 보인다',
    rows.some((r) => r.textContent.indexOf('비타민 C') >= 0),
    rows.map((r) => r.textContent).join(', '));

  // 같은 성분을 또 고를 수 없어야 한다
  const pick2 = Array.prototype.slice.call(bodyAfter.querySelectorAll('select'))
    .filter((x) => x.getAttribute('aria-label') === '추가할 성분')[0];
  ok('이미 넣은 성분은 목록에서 빠진다',
    Array.prototype.slice.call(pick2.options)
      .every((o) => o.value !== 'vitaminC'));

  // 빼기도 되는지
  const del = bodyAfter.querySelector('.nut-del');
  ok('성분 빼기 버튼이 있다', !!del);
  del.dispatchEvent(new win.Event('click', { bubbles: true }));
  eq('빼면 사라진다',
    F.store.load().supplements.filter((x) => x.id === 'sup_q10')[0].nutrients.vitaminC,
    undefined);

  /* ---------- 8. 오늘 탭 링에 보충제가 반영되는가 ----------
   * 신고: "보충제에서 단백질 파우더를 먹으면 맨 위 칼로리·단백질 대시보드에 포함이 안 돼."
   * 링은 끼니만 세고 아래 알림 카드는 보충제를 세고 있어서, 한 화면에 숫자가 두 개였다.
   * 단위 테스트는 views.js 를 못 본다 — 이건 띄워야 잡힌다.
   */
  const st8 = F.store.load();
  st8.supplements = [{ id: 'w1', name: '유청 단백질', presetId: 'whey_protein',
                       timeSlot: 'postWorkout', dailyDoses: 1,
                       nutrients: { protein: 24, kcal: 120 }, enabled: true }];
  st8.dailyLogs = {};
  F.store.replace(st8);

  const dayKey = F.store.todayKey();
  F.store.addMeal(dayKey, {
    type: 'lunch', sourceKind: 'food', sourceId: 'rice_cooked', label: '밥 (백미)',
    portion: 1, nutrients: F.foods.round(F.foods.scale('rice_cooked', 210))
  });

  function ringLabels() {
    win.location.hash = '#today';
    F.router.render();
    return Array.prototype.slice.call(doc.querySelectorAll('svg[role="img"]'))
      .map((n) => n.getAttribute('aria-label'));
  }

  const before8 = ringLabels();
  ok('오늘 탭에 칼로리·단백질 링이 있다', before8.length >= 2, before8.join(' / '));
  const proteinBefore = before8.filter((l) => l.indexOf('단백질') === 0)[0];

  F.store.toggleTaken(dayKey, 'w1');
  const after8 = ringLabels();
  const proteinAfter = after8.filter((l) => l.indexOf('단백질') === 0)[0];
  const kcalAfter = after8.filter((l) => l.indexOf('칼로리') === 0)[0];

  ok('보충제를 체크하면 단백질 링이 움직인다', proteinBefore !== proteinAfter,
    proteinBefore + '  ->  ' + proteinAfter);
  ok('단백질 24g 이 더해진다', proteinAfter.indexOf('29') >= 0, proteinAfter);
  ok('칼로리 120kcal 도 더해진다', kcalAfter.indexOf('393') >= 0, kcalAfter);

  // 링이 끼니 합보다 큰 이유를 화면에서 설명하는지
  const notes = Array.prototype.slice.call(doc.querySelectorAll('.card-note'))
    .map((n) => n.textContent);
  ok('보충제 몫을 설명하는 줄이 있다',
    notes.some((t) => t.indexOf('체크한 보충제에서') >= 0), notes.join(' | '));

  F.store.toggleTaken(dayKey, 'w1');
  const back8 = ringLabels().filter((l) => l.indexOf('단백질') === 0)[0];
  eq('체크를 풀면 원래대로', back8, proteinBefore);

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
