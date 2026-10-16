/**
 * 바이브코딩 : 포스트시즌 — 네트워킹 공동 아이디어 게시판 (Code.gs)
 *
 * 연수 사이트(GitHub Pages)의 '네트워킹 → 나누기' 단계에 iframe으로 들어가는 게시판입니다.
 * 참가자는 '기획 한 장 요약'을 붙여넣어 공유하고, 모두의 기획을 카드로 봅니다.
 *
 * 처음 한 번: 함수 목록에서 setup → ▷ 실행 → 권한 허용
 * 설정(선택): 프로젝트 설정 → 스크립트 속성
 *   SHEET_ID   게시글을 저장할 스프레드시트 ID (시트에 붙은 프로젝트라면 비워 둬도 됩니다)
 *   POST_CODE  게시 코드. 정해 두면 이 코드를 아는 사람만 글을 올릴 수 있습니다.
 *
 * 교사는 스프레드시트 'posts' 시트의 status 칸을 '숨김'으로 바꿔 글을 내릴 수 있습니다.
 */

var SHEET_NAME = 'posts';
var HEADERS = ['id', 'createdAt', 'appName', 'who', 'problem', 'experience', 'blocks', 'directions', 'raw', 'status', 'hash'];
var STATUS_OPEN = '공개';
var STATUS_HIDDEN = '숨김';

var MAX_RAW = 3000;      // 붙여넣는 기획 원문 최대 글자 수
var MAX_POSTS = 300;     // 게시판에 보여 줄 최대 글 수 (최신순)
var LIMIT = { appName: 60, who: 60, problem: 500, experience: 500, blocks: 160, directions: 160 };

/* 기획 한 장 요약(b_plan)의 항목 이름 → 저장할 칸 */
var LABELS = {
  '앱 이름': 'appName',
  '누가': 'who',
  '아쉬운 점': 'problem',
  '학생 경험': 'experience',
  '기능 블록': 'blocks',
  '넓어지는 쪽': 'directions'
};

/* ───────── 화면 ───────── */
function doGet(e) {
  var p = (e && e.parameter) || {};
  var t = template_();
  t.embed = p.embed === '1';
  t.theme = p.theme === 'dark' ? 'dark' : 'light';
  // 높이를 알려 줄 연수 사이트 주소. https://주소 모양일 때만 받습니다.
  t.parentOrigin = /^https:\/\/[a-z0-9.-]+(:\d{1,5})?$/i.test(p.parent || '') ? p.parent : '';
  return t.evaluate()
    .setTitle('우리의 앱 아이디어')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    // 연수 사이트 안에 iframe으로 넣기 위해 필요합니다. (README의 '보안' 참고)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** 화면 파일은 'Index'로 만들라고 안내하지만, 실습처럼 소문자 'index'로 만들어도 찾습니다 */
function template_() {
  try { return HtmlService.createTemplateFromFile('Index'); }
  catch (err) {
    try { return HtmlService.createTemplateFromFile('index'); }
    catch (err2) { throw new Error("화면 파일을 찾지 못했습니다. 편집기에서 HTML 파일 이름이 'Index'인지 확인하고, 배포 관리 → 새 버전으로 다시 배포해 주세요."); }
  }
}

/* ───────── 처음 한 번 실행 ───────── */
function setup() {
  var sh = getSheet_();
  var st = sh.getRange(2, 10, Math.max(sh.getMaxRows() - 1, 1), 1);
  st.setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList([STATUS_OPEN, STATUS_HIDDEN], true).setAllowInvalid(false).build());
  Logger.log('준비 완료 — 시트: ' + sh.getParent().getName() + ' / ' + SHEET_NAME +
    (getPostCode_() ? ' · 게시 코드 사용 중' : ' · 게시 코드 없음(누구나 게시)'));
}

/* ───────── 화면에서 부르는 함수 ───────── */

/** 게시판 설정: 게시 코드가 필요한지 */
function getConfig() {
  return { codeRequired: !!getPostCode_(), maxRaw: MAX_RAW };
}

/** 공개된 글 목록 (최신순) */
function listPosts() {
  var sh = getSheet_();
  var n = sh.getLastRow() - 1;
  if (n < 1) return [];
  var rows = sh.getRange(2, 1, n, HEADERS.length).getValues();
  var out = [];
  for (var i = rows.length - 1; i >= 0 && out.length < MAX_POSTS; i--) {
    var r = rows[i];
    if (txt_(r[9]).trim() === STATUS_HIDDEN || !r[0]) continue;
    out.push(toPost_(r));
  }
  return out;
}

/** 새 글 저장 */
function addPost(raw, code) {
  raw = clean_(raw, MAX_RAW + 1);
  if (!raw) throw new Error('기획 내용을 붙여넣어 주세요.');
  if (raw.length > MAX_RAW) throw new Error('기획이 너무 깁니다. ' + MAX_RAW + '자 이하로 줄여 주세요.');

  var need = getPostCode_();
  if (need && String(code || '').trim() !== need) throw new Error('게시 코드가 맞지 않습니다. 진행하는 선생님께 확인해 주세요.');

  var f = parsePlan_(raw);
  if (!f.appName) throw new Error("'[앱 이름]'을 찾지 못했습니다. 2단계의 '기획 한 장 요약'을 그대로 붙여넣어 주세요.");

  var hash = hash_(raw.replace(/\s+/g, ' ').trim());
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = getSheet_();
    var n = sh.getLastRow() - 1;
    if (n > 0) {
      var hashes = sh.getRange(2, 11, n, 1).getValues();
      for (var i = 0; i < hashes.length; i++) {
        if (hashes[i][0] === hash) throw new Error('이미 공유된 기획입니다.');
      }
    }
    var row = [
      Utilities.getUuid(), new Date().toISOString(),
      f.appName, f.who, f.problem, f.experience, f.blocks, f.directions,
      raw, STATUS_OPEN, hash
    ];
    sh.appendRow(row.map(safeCell_));
    return toPost_(row);   // 저장 전 값 그대로 (txt_ 가 ' 없는 글자로 돌려줍니다)
  } finally {
    lock.releaseLock();
  }
}

/* ───────── 기획 한 장 요약 읽기 ───────── */

/**
 * '[항목] 내용' 줄을 기준으로 나눕니다. 항목 없이 이어지는 줄은 앞 항목에 붙입니다.
 * 고르지 않은 기능의 항목은 없을 수 있습니다.
 */
function parsePlan_(raw) {
  var f = { appName: '', who: '', problem: '', experience: '', blocks: '', directions: '' };
  var key = null;
  raw.split('\n').forEach(function (line) {
    var m = line.match(/^\s*\[([^\]]{1,20})\]\s?(.*)$/);
    if (m) {
      key = LABELS[m[1].trim()] || null;   // 모르는 항목은 원문에만 남깁니다
      if (key) f[key] = m[2].trim();
    } else if (key && line.trim()) {
      f[key] += (f[key] ? '\n' : '') + line.trim();
    }
  });
  Object.keys(f).forEach(function (k) { f[k] = f[k].slice(0, LIMIT[k]); });
  return f;
}

/* ───────── 도우미 ───────── */
function getSheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  var ss = id ? SpreadsheetApp.openById(id.trim()) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('스프레드시트를 찾지 못했습니다. 스크립트 속성 SHEET_ID를 확인해 주세요.');
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function getPostCode_() {
  return String(PropertiesService.getScriptProperties().getProperty('POST_CODE') || '').trim();
}

function toPost_(r) {
  return {
    id: txt_(r[0]), createdAt: txt_(r[1]),
    appName: txt_(r[2]), who: txt_(r[3]), problem: txt_(r[4]),
    experience: txt_(r[5]), blocks: txt_(r[6]), directions: txt_(r[7]), raw: txt_(r[8])
  };
}

/** 시트에서 읽은 값을 글자로 (교사가 손으로 고친 칸이 날짜 등으로 바뀌어 있어도) */
function txt_(v) {
  if (v instanceof Date) return v.toISOString();
  v = String(v == null ? '' : v);
  return v.charAt(0) === "'" ? v.slice(1) : v;
}

/** 줄바꿈은 살리고 보이지 않는 제어 문자는 지웁니다 */
function clean_(v, max) {
  return String(v == null ? '' : v)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '')
    .trim().slice(0, max);
}

/**
 * 모든 값을 '글자'로 저장합니다. 맨 앞의 ' 는 시트에서 '이 칸은 글자'라는 표시라
 * 값에는 남지 않습니다. =, +, -, @ 로 시작하는 글이 수식으로 실행되지 않고,
 * 시각·ID가 날짜나 숫자로 바뀌지도 않습니다.
 */
function safeCell_(v) {
  return "'" + String(v);
}

function hash_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}

// ───────── Code.gs 끝 (이 줄까지 붙여넣어야 합니다) ─────────
