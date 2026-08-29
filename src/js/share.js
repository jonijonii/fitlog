/* share.js — 만든 파일을 사용자에게 건네는 방법
 *
 * 왜 이 파일이 따로 있나:
 *   <a download> 방식은 iOS, 특히 홈 화면에 추가한 앱 안에서 어색하다.
 *   파일을 받으면 iOS 가 '이 타입을 열 수 있다고 등록한 앱' 을 전부 나열하는데,
 *   거기에 인증 앱 같은 엉뚱한 것들이 섞여 나온다 (PASS 등).
 *   사용자는 "왜 이게 나오지?" 하고 막힌다.
 *
 *   Web Share API 로 넘기면 iOS 기본 공유 시트가 뜬다 —
 *   '파일에 저장', 메일, 카카오톡처럼 사람이 아는 선택지가 나온다.
 *   지원하지 않는 브라우저(대부분의 PC)에서는 기존 다운로드로 떨어진다.
 */

window.FitLog = window.FitLog || {};

(function (FitLog) {
  'use strict';

  /** <a download> 로 내려받기 — PC 와 구형 브라우저용 */
  function downloadFile(fileName, text, mime) {
    var blob = new Blob([text], { type: mime });
    var url = URL.createObjectURL(blob);

    var a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    return 'download';
  }

  function canShareFile(file) {
    return !!(file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] }));
  }

  /**
   * 파일을 건넨다. 가능하면 공유 시트, 아니면 다운로드.
   *
   * 반드시 버튼 클릭 안에서 동기적으로 불러야 한다 —
   * 중간에 비동기 작업이 끼면 사용자 제스처가 풀려 공유 시트가 안 뜬다.
   *
   * @returns {'share'|'download'}
   */
  function deliverFile(fileName, text, mime, onDone) {
    var file = null;
    try {
      file = new File([text], fileName, { type: mime });
    } catch (e) {
      file = null;                      // File 생성자가 없는 구형 브라우저
    }

    // 아래 두 호출은 일부러 내보낸 객체를 거친다.
    // 내부 함수를 직접 부르면 테스트에서 갈아 끼울 수가 없어
    // 두 갈래(공유 시트 / 다운로드)를 각각 확인할 방법이 없어진다.
    if (!FitLog.share.canShareFile(file)) {
      var how = FitLog.share.downloadFile(fileName, text, mime);
      if (onDone) onDone(how);
      return how;
    }

    navigator.share({ files: [file], title: fileName })
      .then(function () { if (onDone) onDone('share'); })
      .catch(function (err) {
        // 사용자가 공유 시트를 닫은 것뿐이면 다운로드로 또 괴롭히지 않는다.
        if (err && err.name === 'AbortError') {
          if (onDone) onDone('cancelled');
          return;
        }
        downloadFile(fileName, text, mime);
        if (onDone) onDone('download');
      });

    return 'share';
  }

  /**
   * 표를 클립보드에 복사한다.
   *
   * 파일로 주고받는 게 폰에서는 늘 성가시다 — 공유 시트에 낯선 앱이 섞여 나오고,
   * 저장한 뒤 다시 찾아 열어야 한다. 복사해서 카톡·메일·구글시트에 바로 붙여넣는 쪽이
   * 오히려 빠를 때가 많아서 선택지로 같이 둔다.
   *
   * @returns {boolean} 복사 성공 여부
   */
  function copyText(text) {
    // 최신 방식 — 보안 컨텍스트(HTTPS)에서만 동작한다
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)['catch'](function () { legacyCopy(text); });
      return true;
    }
    return legacyCopy(text);
  }

  /** 구형 브라우저용 — 화면 밖 textarea 를 만들어 선택 후 복사 */
  function legacyCopy(text) {
    var box = document.createElement('textarea');
    box.value = text;
    box.setAttribute('readonly', '');
    box.style.position = 'fixed';
    box.style.left = '-9999px';
    document.body.appendChild(box);

    var ok = false;
    try {
      box.select();
      box.setSelectionRange(0, text.length);   // iOS 는 select() 만으로는 부족하다
      ok = document.execCommand('copy');
    } catch (e) {
      ok = false;
    }

    document.body.removeChild(box);
    return ok;
  }

  FitLog.share = {
    deliverFile: deliverFile,
    copyText: copyText,
    downloadFile: downloadFile,
    canShareFile: canShareFile
  };
})(window.FitLog);
