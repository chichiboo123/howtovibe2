/**
 * 바이브코딩 : 포스트시즌 — 네트워킹 공동 아이디어 게시판 (Code.gs)
 *
 * 연수 사이트(GitHub Pages)의 '네트워킹 → 나누기' 단계에 iframe으로 들어가는 게시판입니다.
 * 참가자는 '기획서'를 붙여넣어 공유하고, 모두의 기획을 카드로 봅니다.
 *
 * 처음 한 번: 함수 목록에서 setup → ▷ 실행 → 권한 허용
 * 설정(선택): 프로젝트 설정 → 스크립트 속성
 *   SHEET_ID   게시글을 저장할 스프레드시트 ID (시트에 붙은 프로젝트라면 비워 둬도 됩니다)
 *   POST_CODE  게시 코드. 정해 두면 이 코드를 아는 사람만 글을 올릴 수 있습니다.
 *
 * 교사는 스프레드시트 'posts' 시트의 status 칸을 '숨김'으로 바꿔 글을 내릴 수 있습니다.
 * 올린 사람은 같은 브라우저에서 자기 글을 수정·삭제할 수 있습니다. (글을 올릴 때 받은 '수정 열쇠'로 확인)
 */

var SHEET_NAME = 'posts';
var HEADERS = ['id', 'createdAt', 'appName', 'who', 'problem', 'experience', 'blocks', 'directions', 'raw', 'status', 'hash', 'keyHash', 'updatedAt', 'appUrl', 'author'];
var COL = { status: 10, hash: 11, keyHash: 12, updatedAt: 13, appUrl: 14, author: 15 };   // 새 열은 맨 뒤에만 추가
var STATUS_OPEN = '공개';
var STATUS_HIDDEN = '숨김';
var STATUS_DELETED = '삭제';   // 올린 사람이 지운 글. 줄은 남겨 두고 게시판에서만 뺍니다

var MAX_RAW = 3000;      // 붙여넣는 기획 원문 최대 글자 수
var MAX_POSTS = 300;     // 게시판에 보여 줄 최대 글 수 (최신순)
var MAX_AUTHOR = 40;     // 작성자 이름 또는 별명 (선택)
var LIMIT = { appName: 60, who: 60, problem: 500, experience: 500, blocks: 160, directions: 160 };

/* 기획서(b_plan)의 항목 이름 → 저장할 칸 */
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
  setStatusRule_(sh);
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
    if (!r[0] || !isOpen_(r)) continue;
    out.push(toPost_(r));
  }
  return out;
}

/**
 * 새 글 저장. 글과 함께 '수정 열쇠'를 돌려줍니다.
 * 열쇠는 올린 사람의 브라우저에만 남고, 시트에는 열쇠의 해시만 저장합니다.
 */
function addPost(raw, code, appUrl, author) {
  var need = getPostCode_();
  if (need && String(code || '').trim() !== need) throw new Error('게시 코드가 맞지 않습니다. 진행하는 선생님께 확인해 주세요.');
  var v = checkPlan_(raw, appUrl);
  author = cleanAuthor_(author);
  var key = Utilities.getUuid() + Utilities.getUuid();
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = getSheet_();
    if (findDuplicate_(sh, v.hash, '')) throw new Error('이미 공유된 글입니다.');
    var now = new Date().toISOString();
    var row = [
      Utilities.getUuid(), now,
      v.f.appName, v.f.who, v.f.problem, v.f.experience, v.f.blocks, v.f.directions,
      v.raw, STATUS_OPEN, v.hash, hash_(key), '', v.appUrl, author
    ];
    sh.appendRow(row.map(safeCell_));
    return { post: toPost_(row), key: key };   // 저장 전 값 그대로 (txt_ 가 ' 없는 글자로 돌려줍니다)
  } finally {
    lock.releaseLock();
  }
}

/** 올린 사람의 글 수정: 같은 규칙으로 다시 읽어 저장합니다 */
function updatePost(id, key, raw, appUrl, author) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = getSheet_();
    var r = findOwnRow_(sh, id, key);
    // 예전 화면에서 링크 인자 없이 수정해도 이미 저장된 주소를 지우지 않습니다.
    var v = checkPlan_(raw, appUrl === undefined ? txt_(sh.getRange(r, COL.appUrl).getValues()[0][0]) : appUrl);
    // 이전 화면의 수정 요청에는 작성자 인자가 없으므로 기존 이름을 유지합니다.
    author = cleanAuthor_(author === undefined ? txt_(sh.getRange(r, COL.author).getValues()[0][0]) : author);
    if (findDuplicate_(sh, v.hash, String(id))) throw new Error('같은 글이 이미 게시판에 있습니다.');
    sh.getRange(r, 3, 1, 7).setValues([[v.f.appName, v.f.who, v.f.problem, v.f.experience, v.f.blocks, v.f.directions, v.raw].map(safeCell_)]);
    sh.getRange(r, COL.hash).setValue(safeCell_(v.hash));
    sh.getRange(r, COL.updatedAt).setValue(safeCell_(new Date().toISOString()));
    sh.getRange(r, COL.appUrl).setValue(safeCell_(v.appUrl));
    sh.getRange(r, COL.author).setValue(safeCell_(author));
    return toPost_(sh.getRange(r, 1, 1, HEADERS.length).getValues()[0]);
  } finally {
    lock.releaseLock();
  }
}

/** 올린 사람의 글 삭제: status를 '삭제'로 바꿔 게시판에서 뺍니다 (교사는 시트에서 볼 수 있음) */
function deletePost(id, key) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = getSheet_();
    var r = findOwnRow_(sh, id, key);
    // 예전 setup이 만든 '공개, 숨김'만 허용하는 규칙이면 '삭제'를 쓸 수 없으니 먼저 고칩니다
    if (!ruleAllowsDelete_(sh, r)) setStatusRule_(sh);
    sh.getRange(r, COL.status).setValue(safeCell_(STATUS_DELETED));
    sh.getRange(r, COL.updatedAt).setValue(safeCell_(new Date().toISOString()));
    return true;
  } finally {
    lock.releaseLock();
  }
}

/* ───────── 기획서 읽기 ───────── */

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

/** status 열(J)의 드롭다운: 공개 / 숨김 / 삭제 */
function setStatusRule_(sh) {
  sh.getRange(2, COL.status, Math.max(sh.getMaxRows() - 1, 1), 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList([STATUS_OPEN, STATUS_HIDDEN, STATUS_DELETED], true).setAllowInvalid(false).build());
}

/** 이 줄의 status 칸 규칙이 '삭제'를 받아 주는지 (규칙이 없으면 받아 줌) */
function ruleAllowsDelete_(sh, r) {
  var rule = sh.getRange(r, COL.status).getDataValidation();
  if (!rule) return true;
  if (rule.getCriteriaType() !== SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) return false;
  return (rule.getCriteriaValues()[0] || []).indexOf(STATUS_DELETED) !== -1;
}

/** 기획서는 항목별로, 나머지는 자유 글로 받습니다. 링크도 중복 판단에 포함합니다. */
function checkPlan_(raw, appUrl) {
  raw = clean_(raw, MAX_RAW + 1);
  if (!raw) throw new Error('나누고 싶은 글이나 기획 내용을 적어 주세요.');
  if (raw.length > MAX_RAW) throw new Error('글이 너무 깁니다. ' + MAX_RAW + '자 이하로 줄여 주세요.');
  var f = parsePlan_(raw);
  if (!f.appName) {
    f = { appName: raw.split('\n')[0].slice(0, LIMIT.appName), who: '', problem: '', experience: '', blocks: '', directions: '' };
  }
  appUrl = cleanAppUrl_(appUrl);
  // 링크가 없는 기존 기획서는 이전 해시와 같아 중복 검사가 계속 작동합니다.
  var duplicateText = raw.replace(/\s+/g, ' ').trim() + (appUrl ? '\n[appUrl] ' + appUrl : '');
  return { raw: raw, f: f, appUrl: appUrl, hash: hash_(duplicateText) };
}

/** 공유 링크는 웹 주소만 받습니다. 서버에서 주소를 열거나 내용을 가져오지는 않습니다. */
function cleanAppUrl_(value) {
  var url = String(value == null ? '' : value).trim();
  if (!url) return '';
  if (url.length > 2000 || /[\s<>"'\\]/.test(url) || !/^https?:\/\/[^\s/?#@:\\]+(?::\d{1,5})?(?:[/?#][^\s\\]*)?$/i.test(url)) {
    throw new Error('앱 주소는 http:// 또는 https://로 시작하는 웹 주소를 2000자 이내로 넣어 주세요.');
  }
  return url;
}

function cleanAuthor_(value) {
  var author = clean_(String(value == null ? '' : value).replace(/\s+/g, ' '), MAX_AUTHOR + 1);
  if (author.length > MAX_AUTHOR) throw new Error('작성자 이름 또는 별명은 ' + MAX_AUTHOR + '자 이내로 적어 주세요.');
  return author;
}

/** 게시판에 보이는 글인지 ('숨김'·'삭제'가 아니면 보입니다) */
function isOpen_(r) {
  var st = txt_(r[COL.status - 1]).trim();
  return st !== STATUS_HIDDEN && st !== STATUS_DELETED;
}

/** 지우지 않은 글 가운데 같은 기획이 있는지 (exceptId: 수정 중인 자기 글은 빼고) */
function findDuplicate_(sh, hash, exceptId) {
  var n = sh.getLastRow() - 1;
  if (n < 1) return false;
  var rows = sh.getRange(2, 1, n, COL.hash).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (txt_(rows[i][COL.hash - 1]) === hash && txt_(rows[i][COL.status - 1]).trim() !== STATUS_DELETED && txt_(rows[i][0]) !== exceptId) return true;
  }
  return false;
}

/** id의 줄을 찾고, 수정 열쇠가 맞는지 확인해 줄 번호를 돌려줍니다 */
function findOwnRow_(sh, id, key) {
  id = String(id || ''); key = String(key || '');
  var n = sh.getLastRow() - 1;
  if (!id || !key || n < 1) throw new Error('이 글을 찾지 못했습니다.');
  var rows = sh.getRange(2, 1, n, HEADERS.length).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (txt_(rows[i][0]) !== id) continue;
    if (!isOpen_(rows[i])) throw new Error('이미 내려간 글입니다.');
    var kh = txt_(rows[i][COL.keyHash - 1]);
    if (!kh || kh !== hash_(key)) throw new Error('이 글을 고칠 권한이 없습니다. 글을 올린 브라우저에서만 수정·삭제할 수 있습니다.');
    return i + 2;
  }
  throw new Error('이 글을 찾지 못했습니다.');
}
function getSheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  var ss = id ? SpreadsheetApp.openById(id.trim()) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('스프레드시트를 찾지 못했습니다. 스크립트 속성 SHEET_ID를 확인해 주세요.');
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else if (sh.getRange(1, 1, 1, HEADERS.length).getValues()[0].join('|') !== HEADERS.join('|')) {
    // 새 열은 맨 뒤에만 추가합니다. 기존 게시물·수정 열쇠·상태는 그대로 둡니다.
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
  }
  return sh;
}

function getPostCode_() {
  return String(PropertiesService.getScriptProperties().getProperty('POST_CODE') || '').trim();
}

function toPost_(r) {
  var appUrl = '';
  try { appUrl = cleanAppUrl_(txt_(r[COL.appUrl - 1])); } catch (err) {} // 시트에서 직접 넣은 잘못된 주소도 노출하지 않음
  return {
    id: txt_(r[0]), createdAt: txt_(r[1]),
    appName: txt_(r[2]), who: txt_(r[3]), problem: txt_(r[4]),
    experience: txt_(r[5]), blocks: txt_(r[6]), directions: txt_(r[7]), raw: txt_(r[8]),
    updatedAt: txt_(r[COL.updatedAt - 1]),
    kind: parsePlan_(txt_(r[8])).appName ? 'plan' : 'text', appUrl: appUrl,
    author: txt_(r[COL.author - 1])
    // 수정 열쇠의 해시(keyHash)와 중복 확인 값은 보내지 않습니다
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
