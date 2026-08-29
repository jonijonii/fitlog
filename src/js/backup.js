/* backup.js — 데이터 내보내기 / 불러오기 (기기 변경 대비) */

window.FitLog = window.FitLog || {};

(function (FitLog) {
  'use strict';

  var store = FitLog.store;

  function fileName() {
    return 'fitlog-backup-' + store.todayKey() + '.json';
  }

  /** 현재 데이터를 JSON 파일로 다운로드 */
  function exportData() {
    // 내보낸 시각을 먼저 남긴다 — 그래야 백업 파일 안에도 '언제 백업한 것' 인지가 들어간다
    var at = store.markBackedUp();
    var payload = JSON.parse(JSON.stringify(store.load()));
    payload.exportedAt = at;

    // iOS 에서는 공유 시트로 넘긴다. 다운로드 방식은 홈 화면 앱 안에서
    // 엉뚱한 앱 목록이 뜨고 '파일에 저장' 을 찾기 어렵다.
    FitLog.share.deliverFile(
      fileName(), JSON.stringify(payload, null, 2), 'application/json');

    return payload;
  }

  /**
   * 백업 파일 형식 검사. 잘못된 파일로 기존 데이터를 날리지 않도록 먼저 걸러낸다.
   * @returns {{ok:boolean, reason?:string}}
   */
  function validateBackup(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, reason: 'FitLog 백업 파일이 아닌 것 같아.' };
    }
    if (!('schemaVersion' in data)) {
      return { ok: false, reason: 'FitLog 백업 파일이 아닌 것 같아. (형식 정보 없음)' };
    }
    if (Number(data.schemaVersion) > store.SCHEMA_VERSION) {
      return { ok: false, reason: '더 새 버전에서 만든 백업이야. 앱을 최신으로 업데이트하고 다시 해 봐.' };
    }
    if (data.profile && typeof data.profile !== 'object') {
      return { ok: false, reason: '백업 파일의 프로필 정보가 깨졌어.' };
    }
    return { ok: true };
  }

  /**
   * 파일을 읽어 데이터를 교체한다.
   * @param {File} file
   * @param {(err:Error|null, state?:object)=>void} done
   */
  function importFile(file, done) {
    if (!file) { done(new Error('파일을 골라줘.')); return; }

    var reader = new FileReader();
    reader.onerror = function () { done(new Error('파일을 읽지 못했어.')); };
    reader.onload = function () {
      var data;
      try {
        data = JSON.parse(String(reader.result));
      } catch (e) {
        done(new Error('JSON 형식이 아니야.'));
        return;
      }
      var check = validateBackup(data);
      if (!check.ok) { done(new Error(check.reason)); return; }

      var state = store.replace(data);
      done(null, state);
    };
    reader.readAsText(file, 'utf-8');
  }

  FitLog.backup = {
    fileName: fileName,
    exportData: exportData,
    validateBackup: validateBackup,
    importFile: importFile
  };
})(window.FitLog);
