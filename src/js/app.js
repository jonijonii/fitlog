/* app.js — 부팅과 해시 라우팅 */

window.FitLog = window.FitLog || {};

(function (FitLog) {
  'use strict';

  var store = FitLog.store;
  var ui = FitLog.ui;

  var TABS = ['today', 'week', 'inbody', 'settings'];
  var DEFAULT_TAB = 'today';

  // 빌드를 구분하는 표식. 폰이 캐시된 옛 버전을 잡고 있는지 설정 탭에서 확인할 수 있다.
  var BUILD = '2026-08-30.18';

  /* ---------- 에러 표시 ----------
     조용히 멈추는 게 가장 나쁘다. 잡히지 않은 예외를 화면에 띄워
     사용자가 그대로 읽어 전달할 수 있게 한다. 전역 핸들러 하나면 충분하므로
     개별 함수에 try/catch 를 덧대지 않는다. */

  window.addEventListener('error', function (e) {
    var err = e.error || e.message;
    var box = document.createElement('div');
    box.className = 'error-bar';
    box.textContent = '문제가 생겼어: ' + ((err && err.message) ? err.message : String(err)) +
      ' — 이 문장을 그대로 알려줘. 빌드 ' + BUILD;
    document.body.appendChild(box);
  });

  /* ---------- 저장 가능 여부 ----------
     사파리 사생활 보호 모드에서는 localStorage 쓰기가 막힌다. 저장 실패를 조용히 삼키면
     사용자는 기록이 사라지는 이유를 영영 모른다. 부팅할 때 한 번 확인해 알려준다. */

  function storageAvailable() {
    try {
      var probe = '__fitlog_probe__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return true;
    } catch (e) {
      return false;
    }
  }

  /* 진입 환경 배너 — 인앱 브라우저 경고 / 저장 불가 / 홈 화면 안내 중 하나.
     env.js 가 우선순위대로 하나만 띄운다. */
  function showEnvBanner() {
    FitLog.env.mountBanner({
      storageOk: storageAvailable,
      copyText: FitLog.share ? FitLog.share.copyText : null
    });
  }

  /* ---------- 영구 저장 요청 ----------
     브라우저는 저장 공간이 부족하거나 한동안 안 쓴 사이트의 데이터를 지울 수 있다.
     iOS 는 7일 미방문 사이트의 script-writable storage 를 정리하는 정책이 있고
     (홈 화면에 추가한 웹앱은 예외라고 알려져 있다), 이건 앱이 통제할 수 없다.
     navigator.storage.persist() 로 '지우지 말아 달라' 고 요청은 할 수 있다.
     브라우저가 거절해도 앱은 그대로 돌아가야 하므로 결과만 기록해 둔다. */

  var storageStatus = 'unknown';

  function requestPersistentStorage() {
    if (!navigator.storage || !navigator.storage.persist) {
      storageStatus = 'unsupported';
      return;
    }

    navigator.storage.persisted().then(function (already) {
      if (already) { storageStatus = 'granted'; return true; }
      return navigator.storage.persist().then(function (ok) {
        storageStatus = ok ? 'granted' : 'denied';
        return ok;
      });
    }).catch(function () { storageStatus = 'unsupported'; });
  }

  var STORAGE_LABEL = {
    granted: '허용됨 (브라우저가 함부로 지우지 않음)',
    denied: '미허용 (브라우저가 정리할 수 있음)',
    unsupported: '이 브라우저는 지원 안 함',
    unknown: '확인 중'
  };

  function storageStatusText() { return STORAGE_LABEL[storageStatus]; }

  /* ---------- 라우터 ---------- */

  function currentTab() {
    var hash = (location.hash || '').replace('#', '');
    return TABS.indexOf(hash) >= 0 ? hash : DEFAULT_TAB;
  }

  var lastTab = null;
  var renderedDate = null;

  function render() {
    if (!store.hasProfile()) return;

    var tab = currentTab();
    renderedDate = store.todayKey();

    // 체크박스 하나 눌러도 화면을 통째로 다시 그린다. 그때마다 맨 위로 올려버리면
    // 보충제 여러 개를 연달아 체크할 수가 없다. 탭이 바뀔 때만 위로 올린다.
    var sameTab = (tab === lastTab);
    var keepY = window.pageYOffset || document.documentElement.scrollTop || 0;

    var screen = ui.clear(document.getElementById('screen'));
    screen.appendChild(FitLog.views[tab]());

    window.scrollTo(0, sameTab ? keepY : 0);
    lastTab = tab;

    document.querySelectorAll('.tab').forEach(function (node) {
      node.setAttribute('aria-selected', String(node.dataset.tab === tab));
    });
  }

  function onHashChange() { render(); }

  /* ---------- 날짜가 바뀌었는지 ----------
     홈 화면에 추가한 앱은 껐다 켜지 않으면 계속 살아 있다. 자정을 넘겨도
     다시 그리지 않으면 '오늘' 탭이 어제 기록을 그대로 붙들고 있게 된다.
     앱이 다시 앞으로 나올 때마다 날짜를 확인한다. */

  function checkDateRollover() {
    if (!store.hasProfile()) return false;
    if (renderedDate === null) return false;
    if (renderedDate === store.todayKey()) return false;

    render();
    return true;
  }

  /* ---------- 부팅 ---------- */

  function boot() {
    showEnvBanner();

    var state = store.load();

    if (!store.hasProfile()) {
      FitLog.onboarding.start(function () {
        if (!location.hash) location.hash = '#' + DEFAULT_TAB;
        render();
      });
      return;
    }

    // 프로필은 있는데 목표치가 없거나 손상된 경우(구버전 백업 등) 다시 계산한다.
    if (!state.targets || !state.targets.meta) {
      store.update(function (s) {
        s.targets = FitLog.calc.computeTargets(s.profile);
        return s;
      });
    }

    document.getElementById('onboarding').hidden = true;
    document.getElementById('app').hidden = false;

    if (!location.hash) location.hash = '#' + DEFAULT_TAB;
    render();
  }

  /* ---------- 서비스워커 ----------
     보안 컨텍스트(HTTPS 또는 localhost)에서만 등록된다.
     집 와이파이의 http://192.168.x.x 나 file:// 에서는 실패하는데, 그건 정상이다.
     등록 실패해도 앱은 그대로 돌아가야 하므로 조용히 넘긴다. */

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (!window.isSecureContext) return;

    navigator.serviceWorker.register('sw.js').catch(function (e) {
      if (window.console && console.info) console.info('[FitLog] 오프라인 캐싱 미적용', e);
    });
  }

  window.addEventListener('hashchange', onHashChange);

  // 앱이 앞으로 나오는 경로가 여럿이라 셋 다 건다.
  // visibilitychange 는 홈 화면 앱을 다시 열 때, focus 는 브라우저 탭 전환,
  // pageshow 는 뒤로가기 캐시에서 복원될 때 각각 걸린다.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) checkDateRollover();
  });
  window.addEventListener('focus', checkDateRollover);
  window.addEventListener('pageshow', checkDateRollover);

  window.addEventListener('load', registerServiceWorker);
  window.addEventListener('load', requestPersistentStorage);
  document.addEventListener('DOMContentLoaded', boot);

  FitLog.router = {
    render: render,
    currentTab: currentTab,
    checkDateRollover: checkDateRollover,
    TABS: TABS
  };
  FitLog.app = { boot: boot, BUILD: BUILD, storageStatusText: storageStatusText };
})(window.FitLog);
