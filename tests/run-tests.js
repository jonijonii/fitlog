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
               'supplements.js', 'calc.js', 'judge.js', 'share.js', 'backup.js', 'csv.js', 'report.js', 'tests.js'];

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

if (summary.failed > 0 || es5Problems.length || cssProblems.length || deployProblems.length) {
  process.exitCode = 1;
}
