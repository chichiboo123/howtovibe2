// In-memory Google service adapters let Node execute the real Code.gs functions.
// This verifies application logic without contacting a deployed board or sheet.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
function createRuntime(options = {}) {
  const rows = options.rows ? structuredClone(options.rows) : [];
  const range = (row, col, height = 1, width = 1) => ({
    getDataValidation: () => null,
    getValues: () => Array.from({length: height}, (_, y) => Array.from({length: width}, (_, x) => rows[row + y - 1]?.[col + x - 1] ?? '')),
    setValues(values) {
      if (values.length !== height || values.some(v => v.length !== width)) throw new Error('Invalid range dimensions');
      values.forEach((valuesRow, y) => valuesRow.forEach((value, x) => { rows[row + y - 1] ||= []; rows[row + y - 1][col + x - 1] = value; }));
      return this;
    },
    setValue(value) { return this.setValues([[value]]); },
    setFontWeight() { return this; },
    setDataValidation() { return this; }
  });
  const sheet = {
    getRange: range, getLastRow: () => rows.length, getMaxRows: () => 1000,
    appendRow: row => rows.push([...row]), setFrozenRows() {}, getParent: () => ({getName: () => 'Test board'})
  };
  let exists = rows.length > 0;
  const spreadsheet = {getSheetByName: () => exists ? sheet : null, insertSheet: () => { exists = true; return sheet; }};
  const properties = {POST_CODE: options.postCode || ''};
  const locks = {active: 0};
  const validation = {requireValueInList() { return this; }, setAllowInvalid() { return this; }, build() { return this; }};
  const context = {
    PropertiesService: {getScriptProperties: () => ({getProperty: k => properties[k] || null})},
    SpreadsheetApp: {getActiveSpreadsheet: () => spreadsheet, openById: () => spreadsheet, newDataValidation: () => validation},
    LockService: {getScriptLock: () => ({waitLock() { locks.active++; }, releaseLock() { locks.active--; }})},
    Utilities: {getUuid: crypto.randomUUID, DigestAlgorithm: {SHA_256: 'sha256'}, Charset: {UTF_8: 'utf8'}, computeDigest: (_, text) => [...crypto.createHash('sha256').update(text).digest()]},
    Logger: {log() {}}
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8'), context, {filename: 'Code.gs'});
  return {api: context, rows, locks};
}
module.exports = {createRuntime};
