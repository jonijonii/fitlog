/* build.js — src/ 를 단일 dist/index.html 로 병합한다.
 *
 *   node build.js
 *
 * 외부 빌드 도구 없이 CSS/JS 를 인라인 삽입만 한다.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const SIZE_BUDGET = 500 * 1024; // 목표 크기 500KB

/* 배포본에서 뺀다. 테스트는 개발용이라 사용자 폰에 실어 보낼 이유가 없다.
   (54KB — 번들에서 가장 큰 파일이었다. 검증은 node tests/run-tests.js 로 한다.) */
const EXCLUDE = ['js/tests.js'];

function read(rel) {
  return fs.readFileSync(path.join(SRC, rel), 'utf8');
}

/** 인라인 <script> 안에서 문서를 조기 종료시키지 않도록 방어 */
function guardScript(code) {
  return code.replace(/<\/script/gi, '<\\/script');
}

/** app.js 의 BUILD 상수를 읽는다. 서비스워커 캐시 이름에 쓴다. */
function buildVersion() {
  const app = read('js/app.js');
  const hit = app.match(/var BUILD = '([^']+)'/);
  if (!hit) throw new Error('app.js 에서 BUILD 를 찾지 못했습니다.');
  return hit[1];
}

/**
 * 배포에 필요한 곁다리 파일을 dist 로 옮긴다.
 *
 * 서비스워커는 인라인할 수 없다 — 같은 출처의 별도 파일이어야 등록된다.
 * 그래서 dist 는 index.html 하나가 아니라 묶음이 된다.
 * (index.html 만 따로 열어도 앱은 그대로 동작한다. 오프라인 기능만 빠진다.)
 */
function copyAssets(version) {
  const copied = [];

  // sw.js — 캐시 이름에 빌드 번호를 박아 넣는다
  const sw = read('sw.js').replace(/__BUILD__/g, version);
  fs.writeFileSync(path.join(DIST, 'sw.js'), sw, 'utf8');
  copied.push('sw.js');

  fs.copyFileSync(path.join(SRC, 'manifest.webmanifest'),
                  path.join(DIST, 'manifest.webmanifest'));
  copied.push('manifest.webmanifest');

  const iconSrc = path.join(SRC, 'icons');
  const iconOut = path.join(DIST, 'icons');
  if (!fs.existsSync(iconOut)) fs.mkdirSync(iconOut, { recursive: true });

  fs.readdirSync(iconSrc).forEach((file) => {
    fs.copyFileSync(path.join(iconSrc, file), path.join(iconOut, file));
    copied.push('icons/' + file);
  });

  // GitHub Pages 가 _ 로 시작하는 경로를 Jekyll 로 처리하지 않게 막는다
  fs.writeFileSync(path.join(DIST, '.nojekyll'), '', 'utf8');
  copied.push('.nojekyll');

  return copied;
}

function build() {
  let html = read('index.html');
  const inlined = [];
  const excluded = [];

  // <link rel="stylesheet" href="..."> → <style>
  html = html.replace(
    /[ \t]*<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>\s*/gi,
    (match, href) => {
      const css = read(href);
      inlined.push(href);
      return `<style>\n${css}\n</style>\n`;
    }
  );

  // <script src="..."></script> → <script>...</script>
  html = html.replace(
    /[ \t]*<script[^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>\s*/gi,
    (match, src) => {
      if (EXCLUDE.indexOf(src) >= 0) {
        excluded.push(src);
        return '';
      }
      const js = read(src);
      inlined.push(src);
      return `<script>\n${guardScript(js)}\n</script>\n`;
    }
  );

  if (!fs.existsSync(DIST)) fs.mkdirSync(DIST, { recursive: true });

  const out = path.join(DIST, 'index.html');
  fs.writeFileSync(out, html, 'utf8');

  const bytes = Buffer.byteLength(html, 'utf8');
  const kb = (bytes / 1024).toFixed(1);

  const version = buildVersion();
  const copied = copyAssets(version);

  // 배포되는 것만 센다. dist/.git 은 GitHub Pages 가 서빙하지 않는다.
  const shipped = ['index.html'].concat(copied)
    .filter((f) => f !== '.nojekyll')
    .reduce((sum, f) => sum + fs.statSync(path.join(DIST, f)).size, 0);

  console.log(`인라인 삽입: ${inlined.length}개` +
    (excluded.length ? ` (제외: ${excluded.join(', ')})` : ''));
  console.log(`출력: ${path.relative(ROOT, out)} (${kb}KB)  빌드 ${version}`);
  console.log(`배포 합계: ${(shipped / 1024).toFixed(1)}KB / 목표 ${SIZE_BUDGET / 1024}KB`);

  if (/<script[^>]*src=|<link[^>]*rel=["']stylesheet["']/i.test(html)) {
    console.error('경고: 인라인되지 않은 외부 참조가 남아 있습니다.');
    process.exitCode = 1;
    return;
  }

  if (bytes > SIZE_BUDGET) {
    console.error(`경고: 목표 크기 ${SIZE_BUDGET / 1024}KB 를 넘었습니다.`);
    process.exitCode = 1;
  }
}

build();
