/* env.js — 실행 환경 감지와 진입 배너
 *
 * 왜 필요한가:
 *   친구들은 링크를 카톡·인스타 등으로 받아 그 앱의 '인앱 브라우저' 로 연다.
 *   인앱 브라우저는 localStorage 가 세션이 끝나면 날아가거나 아예 막혀서,
 *   기록해도 다음에 열면 사라진다. 사용자는 이유를 모른 채 '앱이 이상하다' 고 느낀다.
 *   → 인앱을 감지해 경고하고, 바깥 브라우저로 나가는 길을 준다.
 *
 *   또 홈 화면에 추가하지 않으면 iOS 7일 정리 정책의 보호를 못 받는다.
 *   → 일반 브라우저인데 설치 안 했으면 '홈 화면에 추가' 를 안내한다.
 *
 * 감지 함수는 userAgent 를 인자로 받는 순수 함수라 여러 문자열로 테스트할 수 있다.
 */

window.FitLog = window.FitLog || {};

(function (FitLog) {
  'use strict';

  /* 인앱 브라우저 userAgent 특징.
     순서 주의: 더 구체적인 패턴을 먼저 둔다. Line 은 단어 'line' 오탐을 막으려 'Line/' 로. */
  var IN_APP = [
    { key: 'kakao',     label: '카카오톡',   re: /KAKAOTALK/i },
    { key: 'instagram', label: '인스타그램', re: /Instagram/i },
    { key: 'line',      label: '라인',       re: /Line\//i },
    { key: 'naver',     label: '네이버 앱',  re: /NAVER\(inapp/i },
    { key: 'facebook',  label: '페이스북',   re: /FB(AN|AV|_IAB)/i }
  ];

  /** userAgent 로 인앱 브라우저를 판별. 아니면 key: null. */
  function detectInApp(uaArg) {
    var ua = uaArg === undefined
      ? (navigator && navigator.userAgent) || ''
      : (uaArg || '');

    for (var i = 0; i < IN_APP.length; i++) {
      if (IN_APP[i].re.test(ua)) {
        return { key: IN_APP[i].key, label: IN_APP[i].label };
      }
    }
    return { key: null, label: null };
  }

  /** 홈 화면에 추가해서 앱처럼 실행 중인지 (사용자 지시의 isStandalone). */
  function isStandalone() {
    var displayMode = !!(window.matchMedia &&
      window.matchMedia('(display-mode: standalone)').matches);
    return displayMode || window.navigator.standalone === true;
  }

  /** 카톡 인앱을 바깥 브라우저로 튕겨 여는 스킴 URL. */
  function kakaoExternalUrl(href) {
    var url = href || location.href;
    return 'kakaotalk://web/openExternal?url=' + encodeURIComponent(url);
  }

  FitLog.env = {
    IN_APP: IN_APP,
    detectInApp: detectInApp,
    isStandalone: isStandalone,
    kakaoExternalUrl: kakaoExternalUrl,
    mountBanner: mountBanner
  };

  /* ---------- 배너 ----------
     우선순위대로 하나만 띄운다: 인앱 경고 > 저장 불가 > 홈 화면 안내.
     인앱이면 저장도 대개 막히므로, 더 구체적인 인앱 배너 하나로 합친다.

     @param {{storageOk:function, copyText:function}} deps
       storageOk() → 저장 가능 여부, copyText(text) → 클립보드 복사(성공 여부 반환) */
  function mountBanner(deps) {
    deps = deps || {};

    var inApp = detectInApp();
    if (inApp.key) {
      document.body.appendChild(inAppBanner(inApp, deps));
      return 'inapp';
    }

    // 인앱이 아닌데 저장이 막힌 경우 (사파리 시크릿 탭 등)
    if (deps.storageOk && !deps.storageOk()) {
      document.body.appendChild(storageBanner());
      return 'storage';
    }

    // 일반 브라우저인데 홈 화면에 추가하지 않았으면 안내 (닫을 수 있음)
    if (!isStandalone()) {
      document.body.appendChild(installBanner());
      return 'install';
    }

    return 'none';
  }

  /* --- DOM 헬퍼 (env.js 는 ui.js 보다 먼저 로드될 수 있어 자체 구현) --- */

  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function button(label, className, onClick) {
    var b = make('button', className, label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  /* --- 1. 인앱 경고 (빨강, 못 닫음) --- */

  function inAppBanner(inApp, deps) {
    var bar = make('div', 'env-bar env-bar-danger');

    bar.appendChild(make('p', 'env-msg',
      inApp.label + ' 안에서는 기록이 저장 안 돼. 브라우저에서 다시 열어줘.'));

    var actions = make('div', 'env-actions');

    function copyButton() {
      return button('주소 복사', 'env-btn', function (e) {
        var okCopy = deps.copyText
          ? deps.copyText(location.href)
          : fallbackCopy(location.href);
        e.target.textContent = okCopy ? '복사됐어! 브라우저에 붙여넣어' : '복사 실패';
      });
    }

    if (inApp.key === 'kakao') {
      // 카톡 전용 스킴으로 바깥 브라우저 열기 시도. 카카오가 막았을 수 있어
      // 복사 버튼을 폴백으로 나란히 둔다 — 셋 중 하나는 반드시 통하게.
      actions.appendChild(button('브라우저로 열기', 'env-btn', function () {
        location.href = kakaoExternalUrl();
      }));
    }
    actions.appendChild(copyButton());

    bar.appendChild(actions);
    bar.appendChild(make('p', 'env-hint',
      inApp.key === 'kakao'
        ? '안 열리면 오른쪽 아래 ≡ → "다른 브라우저로 열기" 를 눌러도 돼.'
        : '오른쪽 위 ⋮ 또는 공유 버튼에서 "브라우저로 열기" 를 눌러도 돼.'));

    return bar;
  }

  /* --- 2. 저장 불가 (빨강, 못 닫음) --- */

  function storageBanner() {
    var bar = make('div', 'env-bar env-bar-danger');
    bar.appendChild(make('p', 'env-msg',
      '이 화면에서는 기록이 저장 안 돼. ' +
      '사파리 시크릿 탭이면 일반 탭에서 다시 열어줘.'));
    return bar;
  }

  /* --- 3. 홈 화면 추가 안내 (노랑, 닫을 수 있음) --- */

  function installBanner() {
    var bar = make('div', 'env-bar env-bar-tip');

    bar.appendChild(make('p', 'env-msg',
      '홈 화면에 추가하면 앱처럼 열리고 기록도 더 안전해. ' +
      '공유 버튼 → "홈 화면에 추가".'));

    var close = button('✕', 'env-close', function () {
      if (bar.parentNode) bar.parentNode.removeChild(bar);
    });
    close.setAttribute('aria-label', '안내 닫기');
    bar.appendChild(close);

    return bar;
  }

  /* --- clipboard 폴백 (share.js 가 없을 때도 최소 동작) --- */

  function fallbackCopy(text) {
    var box = document.createElement('textarea');
    box.value = text;
    box.style.position = 'fixed';
    box.style.left = '-9999px';
    document.body.appendChild(box);
    var ok = false;
    try {
      box.select();
      box.setSelectionRange(0, text.length);
      ok = document.execCommand('copy');
    } catch (e) { ok = false; }
    document.body.removeChild(box);
    return ok;
  }
})(window.FitLog);
