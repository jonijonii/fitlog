/* make-icons.js — 앱 아이콘 PNG 생성
 *
 *   node tools/make-icons.js
 *
 * 왜 PNG 인가: iOS 의 apple-touch-icon 은 SVG 를 받지 않는다. 홈 화면에 추가했을 때
 * 아이콘이 나오려면 PNG 여야 한다. 외부 라이브러리 없이 픽셀을 직접 그리고 PNG 로 인코딩한다.
 *
 * 그림: 어두운 배경 위의 진행 링 — 앱의 칼로리·단백질 링과 같은 모양.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'src', 'icons');

const BG = [17, 24, 39];        // #111827
const TRACK = [42, 51, 70];     // 링의 빈 부분
const ARC = [91, 140, 255];     // #5b8cff 채워진 부분

/* ---------- PNG 인코딩 ---------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, pixels) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 2;    // color type 2 = truecolor RGB
  ihdr[10] = 0;   // deflate
  ihdr[11] = 0;   // adaptive filter
  ihdr[12] = 0;   // no interlace

  // 각 줄 앞에 필터 바이트(0 = None)를 붙인다
  const raw = Buffer.alloc(size * (size * 3 + 1));
  let at = 0;
  for (let y = 0; y < size; y++) {
    raw[at++] = 0;
    for (let x = 0; x < size; x++) {
      const p = (y * size + x) * 3;
      raw[at++] = pixels[p];
      raw[at++] = pixels[p + 1];
      raw[at++] = pixels[p + 2];
    }
  }

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------- 그리기 ---------- */

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t)
  ];
}

function drawIcon(size) {
  const px = Buffer.alloc(size * size * 3);
  const c = (size - 1) / 2;

  // maskable 아이콘은 가장자리가 잘릴 수 있어서 링을 안쪽에 둔다
  const rOut = size * 0.36;
  const rIn = size * 0.24;
  const sweep = 0.72;                    // 링의 72% 를 채운다 — '진행 중' 느낌
  const AA = size * 0.02;                // 계단현상을 줄이기 위한 경계 흐림 폭

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - c, dy = y - c;
      const r = Math.sqrt(dx * dx + dy * dy);

      let color = BG;

      // 링 두께 안쪽인지 (경계는 부드럽게 섞는다)
      const inner = Math.min(1, Math.max(0, (r - rIn) / AA));
      const outer = Math.min(1, Math.max(0, (rOut - r) / AA));
      const onRing = Math.min(inner, outer);

      if (onRing > 0) {
        // 12시 방향에서 시계방향으로 진행
        let ang = Math.atan2(dy, dx) + Math.PI / 2;
        if (ang < 0) ang += Math.PI * 2;
        const t = ang / (Math.PI * 2);

        color = mix(BG, t <= sweep ? ARC : TRACK, onRing);
      }

      const p = (y * size + x) * 3;
      px[p] = color[0];
      px[p + 1] = color[1];
      px[p + 2] = color[2];
    }
  }

  return encodePNG(size, px);
}

/* ---------- 실행 ---------- */

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

[180, 192, 512].forEach((size) => {
  const file = path.join(OUT, 'icon-' + size + '.png');
  fs.writeFileSync(file, drawIcon(size));
  console.log('  ' + path.relative(path.join(__dirname, '..'), file) +
    ' (' + (fs.statSync(file).size / 1024).toFixed(1) + 'KB)');
});

console.log('아이콘 3개 생성 완료 (180=iOS 홈화면, 192/512=PWA)');
