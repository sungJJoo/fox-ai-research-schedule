/**
 * FOX AI 연구소 담당표 - Google Apps Script 백엔드
 *
 * 이 파일은 백업용입니다. 실제 실행은 Google Apps Script 편집기 안에서 이루어집니다.
 *
 * 스프레드시트: https://docs.google.com/spreadsheets/d/1JqEEkUFPM2kVNhesqyEeXePtPhmFy9NIiOe0uga8R2w/edit
 *
 * 배포 방법 (변경 후):
 *   1) 이 파일 전체 내용 복사
 *   2) GAS 편집기 (script.google.com)에서 코드 덮어쓰기
 *   3) 저장 (Ctrl+S)
 *   4) 배포 → 배포 관리 → 연필 아이콘 → 버전 "새 버전" 선택 → 배포
 *   5) URL이 변경되면 index.html의 API_URL 갱신 + 커밋/push
 *
 * 시트 구조:
 *   - 담당표:    A1:F4 = 3주 순환 스케줄 (헤더 + 3주 데이터)
 *                A7:F  = 업무 리스트 (헤더 + 업무행들)
 *                       A=업무, B=담당, C=마감기한, D=세부사항, E=완료(TRUE/FALSE), F=완료시각
 *   - 멤버:      이름 | 역할 | 색상 (Apps Script가 없으면 자동 생성)
 *   - 근무일정:  날짜행 + 멤버행 반복 (시간/휴무/연차/반차/공휴일)
 *   - 완료 업무: 업무 | 담당 | 마감기한 | 세부사항 | 완료시각 (자동 생성)
 *
 * 액션:
 *   GET /                              → schedule, tasks, members, workSchedule, completedTasks, recurringTasks, v
 *   GET ?action=getHash                → { v } 만 (가벼운 변경 감지 핑)
 *   GET ?action=setComplete&row=N&value=true/false
 *   GET ?action=addTask&name=&assignee=&deadline=&detail=
 *   GET ?action=updateTask&row=N&name=&assignee=&deadline=&detail=
 *   GET ?action=deleteTask&row=N
 *   GET ?action=addCompletedTask&name=&assignee=&deadline=&detail=&completedAt=
 *   GET ?action=addRecurringTask&name=&assignee=&deadline=&detail=
 *   GET ?action=updateRecurringTask&row=N&name=&assignee=&deadline=&detail=
 *   GET ?action=deleteRecurringTask&row=N
 *   GET ?action=setRecurringComplete&row=N&value=true/false
 *   GET ?action=addMember&name=&role=&color=
 *   GET ?action=updateMember&original=&name=&role=&color=
 *   GET ?action=deleteMember&name=
 */

/**
 * 변경 버전 카운터 — 모든 mutation 액션 끝에서 호출
 * 클라이언트는 ?action=getHash로 이 값만 받아 변경 감지
 */
function bumpVersion() {
  PropertiesService.getScriptProperties().setProperty('v', String(Date.now()));
}
function currentVersion() {
  return PropertiesService.getScriptProperties().getProperty('v') || '0';
}

function doGet(e) {

  const action = e.parameter.action;
  const ss     = SpreadsheetApp.getActiveSpreadsheet();

  // ── 변경 감지용 가벼운 핑 (폴링이 이걸로 함) ──
  if (action === 'getHash') {
    return ContentService
      .createTextOutput(JSON.stringify({ v: currentVersion() }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // ── 멤버 시트 자동 생성 ──
  function ensureMemberSheet() {
    let ms = ss.getSheetByName('멤버');
    if (!ms) {
      ms = ss.insertSheet('멤버');
      ms.getRange(1, 1, 4, 3).setValues([
        ['이름', '역할', '색상'],
        ['윤승희', '팀장',   'ysh'],
        ['박성주', '연구원', 'psj'],
        ['김기환', '연구원', 'kkh'],
      ]);
      ms.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#f0ede8');
    }
    return ms;
  }

  // ── 완료 업무 아카이브 시트 자동 생성 ──
  function ensureCompletedSheet() {
    let cs = ss.getSheetByName('완료 업무');
    if (!cs) {
      cs = ss.insertSheet('완료 업무');
      cs.getRange(1, 1, 1, 5).setValues([
        ['업무', '담당', '마감기한', '세부사항', '완료시각']
      ]);
      cs.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#f0ede8');
      cs.setColumnWidth(1, 220);
      cs.setColumnWidth(2, 90);
      cs.setColumnWidth(3, 100);
      cs.setColumnWidth(4, 280);
      cs.setColumnWidth(5, 160);
    }
    return cs;
  }

  // ── 반복 업무 시트 자동 생성 (자동 삽입 X, 사용자가 수동 관리) ──
  function ensureRecurringSheet() {
    let rs = ss.getSheetByName('반복 업무');
    if (!rs) {
      rs = ss.insertSheet('반복 업무');
      rs.getRange(1, 1, 1, 6).setValues([
        ['업무', '담당', '마감기한', '세부사항', '완료', '완료시각']
      ]);
      rs.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#f0ede8');
      rs.setColumnWidth(1, 220);
      rs.setColumnWidth(2, 110);
      rs.setColumnWidth(3, 100);
      rs.setColumnWidth(4, 280);
      rs.setColumnWidth(5, 70);
      rs.setColumnWidth(6, 160);
    }
    return rs;
  }

  // ── 완료 토글 ──
  if (action === 'setComplete') {
    const sheet = ss.getSheetByName('담당표');
    const row   = parseInt(e.parameter.row);
    const value = e.parameter.value === 'true';

    sheet.getRange(row, 5).setValue(value);
    const tsCell = sheet.getRange(row, 6);
    if (value) {
      tsCell.setValue(new Date());
      tsCell.setNumberFormat('yyyy-MM-dd HH:mm:ss');
    } else {
      tsCell.clearContent();
    }

    bumpVersion();
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // ── 업무 추가 ──
  if (action === 'addTask') {
    const sheet = ss.getSheetByName('담당표');
    const name     = e.parameter.name     || '';
    const assignee = e.parameter.assignee || '';
    const deadline = e.parameter.deadline || '';
    const detail   = e.parameter.detail   || '';

    if (!name) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: '업무명 누락' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    let deadlineValue = '';
    if (deadline) {
      const d = new Date(deadline);
      if (!isNaN(d.getTime())) deadlineValue = d;
    }

    const lastRow = sheet.getLastRow();
    const newRow = Math.max(lastRow + 1, 8);

    sheet.getRange(newRow, 1, 1, 6).setValues([[name, assignee, deadlineValue, detail, false, '']]);

    if (deadlineValue) {
      sheet.getRange(newRow, 3).setNumberFormat('yyyy-MM-dd');
    }

    bumpVersion();
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, row: newRow }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // ── 업무 수정 ──
  if (action === 'updateTask') {
    const sheet = ss.getSheetByName('담당표');
    const row      = parseInt(e.parameter.row);
    const name     = e.parameter.name     || '';
    const assignee = e.parameter.assignee || '';
    const deadline = e.parameter.deadline || '';
    const detail   = e.parameter.detail   || '';

    if (!row || row < 8) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: '행 번호 오류' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    let deadlineValue = '';
    if (deadline) {
      const d = new Date(deadline);
      if (!isNaN(d.getTime())) deadlineValue = d;
    }

    // A~D만 업데이트 (완료/완료시각은 건드리지 않음)
    sheet.getRange(row, 1, 1, 4).setValues([[name, assignee, deadlineValue, detail]]);

    if (deadlineValue) {
      sheet.getRange(row, 3).setNumberFormat('yyyy-MM-dd');
    }

    bumpVersion();
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // ── 업무 삭제 ──
  if (action === 'deleteTask') {
    const sheet = ss.getSheetByName('담당표');
    const row = parseInt(e.parameter.row);

    if (!row || row < 8) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: '행 번호 오류' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    sheet.deleteRow(row);

    bumpVersion();
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // ── 완료 업무 수동 추가 ──
  if (action === 'addCompletedTask') {
    const cs = ensureCompletedSheet();
    const name        = e.parameter.name        || '';
    const assignee    = e.parameter.assignee    || '';
    const deadline    = e.parameter.deadline    || '';
    const detail      = e.parameter.detail      || '';
    const completedAt = e.parameter.completedAt || '';

    if (!name) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: '업무명 누락' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    let deadlineValue = '';
    if (deadline) {
      const d = new Date(deadline);
      if (!isNaN(d.getTime())) deadlineValue = d;
    }

    let completedAtValue = new Date();  // 기본값: 지금
    if (completedAt) {
      const d = new Date(completedAt);
      if (!isNaN(d.getTime())) completedAtValue = d;
    }

    cs.appendRow([name, assignee, deadlineValue, detail, completedAtValue]);
    const newRow = cs.getLastRow();
    cs.getRange(newRow, 5).setNumberFormat('yyyy-MM-dd HH:mm:ss');
    if (deadlineValue) cs.getRange(newRow, 3).setNumberFormat('yyyy-MM-dd');

    bumpVersion();
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, row: newRow }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // ── 반복 업무 추가 ──
  if (action === 'addRecurringTask') {
    const rs = ensureRecurringSheet();
    const name     = e.parameter.name     || '';
    const assignee = e.parameter.assignee || '';
    const deadline = e.parameter.deadline || '';
    const detail   = e.parameter.detail   || '';

    if (!name) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: '업무명 누락' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    let deadlineValue = '';
    if (deadline) {
      const d = new Date(deadline);
      if (!isNaN(d.getTime())) deadlineValue = d;
    }

    rs.appendRow([name, assignee, deadlineValue, detail, false, '']);
    const newRow = rs.getLastRow();
    if (deadlineValue) rs.getRange(newRow, 3).setNumberFormat('yyyy-MM-dd');

    bumpVersion();
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, row: newRow }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // ── 반복 업무 수정 ──
  if (action === 'updateRecurringTask') {
    const rs = ensureRecurringSheet();
    const row      = parseInt(e.parameter.row);
    const name     = e.parameter.name     || '';
    const assignee = e.parameter.assignee || '';
    const deadline = e.parameter.deadline || '';
    const detail   = e.parameter.detail   || '';

    if (!row || row < 2) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: '행 번호 오류' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    let deadlineValue = '';
    if (deadline) {
      const d = new Date(deadline);
      if (!isNaN(d.getTime())) deadlineValue = d;
    }

    // A~D만 업데이트 (완료/완료시각은 유지)
    rs.getRange(row, 1, 1, 4).setValues([[name, assignee, deadlineValue, detail]]);
    if (deadlineValue) rs.getRange(row, 3).setNumberFormat('yyyy-MM-dd');

    bumpVersion();
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // ── 반복 업무 삭제 ──
  if (action === 'deleteRecurringTask') {
    const rs = ensureRecurringSheet();
    const row = parseInt(e.parameter.row);
    if (!row || row < 2) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: '행 번호 오류' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    rs.deleteRow(row);
    bumpVersion();
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // ── 반복 업무 완료 토글 (자동 아카이브 없음, 상태만 변경) ──
  if (action === 'setRecurringComplete') {
    const rs = ensureRecurringSheet();
    const row = parseInt(e.parameter.row);
    const value = e.parameter.value === 'true';
    if (!row || row < 2) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: '행 번호 오류' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    rs.getRange(row, 5).setValue(value);
    const tsCell = rs.getRange(row, 6);
    if (value) {
      tsCell.setValue(new Date());
      tsCell.setNumberFormat('yyyy-MM-dd HH:mm:ss');
    } else {
      tsCell.clearContent();
    }
    bumpVersion();
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // ── 멤버 추가 ──
  if (action === 'addMember') {
    const ms    = ensureMemberSheet();
    const name  = e.parameter.name  || '';
    const role  = e.parameter.role  || '';
    const color = e.parameter.color || 'ysh';

    if (!name) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: '이름 누락' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    ms.appendRow([name, role, color]);
    bumpVersion();
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // ── 멤버 수정 (다른 시트 자동 반영) ──
  if (action === 'updateMember') {
    const ms       = ensureMemberSheet();
    const original = e.parameter.original || '';
    const name     = e.parameter.name     || '';
    const role     = e.parameter.role     || '';
    const color    = e.parameter.color    || 'ysh';

    // 1) 멤버 시트 업데이트
    const mdata = ms.getDataRange().getValues();
    let found = false;
    for (let i = 1; i < mdata.length; i++) {
      if (String(mdata[i][0]).trim() === original) {
        ms.getRange(i + 1, 1, 1, 3).setValues([[name, role, color]]);
        found = true;
        break;
      }
    }
    if (!found) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: '멤버 없음' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 2) 담당표 (A1:F4) 이름 일괄 치환
    const sheet = ss.getSheetByName('담당표');
    const sched = sheet.getRange('A1:F4').getValues();
    for (let i = 0; i < sched.length; i++) {
      for (let j = 0; j < sched[i].length; j++) {
        if (String(sched[i][j]).trim() === original) {
          sched[i][j] = name;
        }
      }
    }
    sheet.getRange('A1:F4').setValues(sched);

    // 3) 근무일정 시트 전체 이름 치환
    const wsheet = ss.getSheetByName('근무일정');
    if (wsheet) {
      const lastRow = wsheet.getLastRow();
      if (lastRow > 0) {
        const wdata = wsheet.getRange(1, 1, lastRow, 7).getValues();
        for (let i = 0; i < wdata.length; i++) {
          for (let j = 0; j < wdata[i].length; j++) {
            if (String(wdata[i][j]).trim() === original) {
              wdata[i][j] = name;
            }
          }
        }
        wsheet.getRange(1, 1, lastRow, 7).setValues(wdata);
      }
    }

    // 4) 완료 업무 아카이브에서도 담당자 이름 반영
    const csheet = ss.getSheetByName('완료 업무');
    if (csheet && csheet.getLastRow() > 1) {
      const cdata = csheet.getRange(2, 2, csheet.getLastRow() - 1, 1).getValues();
      let changed = false;
      for (let i = 0; i < cdata.length; i++) {
        if (String(cdata[i][0]).trim() === original) {
          cdata[i][0] = name;
          changed = true;
        }
      }
      if (changed) csheet.getRange(2, 2, cdata.length, 1).setValues(cdata);
    }

    // 5) 반복 업무에서도 담당자 이름 반영
    const rsheet = ss.getSheetByName('반복 업무');
    if (rsheet && rsheet.getLastRow() > 1) {
      const rdata = rsheet.getRange(2, 2, rsheet.getLastRow() - 1, 1).getValues();
      let changed = false;
      for (let i = 0; i < rdata.length; i++) {
        if (String(rdata[i][0]).trim() === original) {
          rdata[i][0] = name;
          changed = true;
        }
      }
      if (changed) rsheet.getRange(2, 2, rdata.length, 1).setValues(rdata);
    }

    bumpVersion();
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // ── 멤버 삭제 ──
  if (action === 'deleteMember') {
    const ms   = ensureMemberSheet();
    const name = e.parameter.name || '';
    const data = ms.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === name) {
        ms.deleteRow(i + 1);
        bumpVersion();
        return ContentService
          .createTextOutput(JSON.stringify({ ok: true }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }

    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: '멤버 없음' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // ── 기본 데이터 읽기 (action 없거나 매칭 안 됨) ──
  const sheet = ss.getSheetByName('담당표');
  const tz    = Session.getScriptTimeZone();
  const memberSheet = ensureMemberSheet();
  ensureCompletedSheet();
  ensureRecurringSheet();

  // 멤버 리스트
  const memRaw = memberSheet.getDataRange().getValues();
  const memHeaders = memRaw[0];
  const members = memRaw.slice(1).filter(r => r[0]).map(row => {
    const obj = {};
    memHeaders.forEach((h, i) => { obj[String(h)] = row[i]; });
    return obj;
  });

  const fmtDate = (v) => {
    if (!v && v !== 0) return '';
    if (typeof v === 'object' && v !== null && typeof v.getTime === 'function') {
      try { return Utilities.formatDate(v, tz, 'M/d'); } catch(e) {}
    }
    return String(v).trim();
  };

  const scheduleValues = sheet.getRange('A1:F4').getValues();
  const taskValues     = sheet.getRange('A7:F').getValues().filter(r => r[0]);

  // 근무일정 파싱 (날짜행 + 멤버행 반복 구조)
  const workSheet = ss.getSheetByName('근무일정');
  let workSchedule = [];

  if (workSheet && workSheet.getLastRow() > 3) {
    const raw = workSheet
      .getRange(1, 1, workSheet.getLastRow(), 7)
      .getDisplayValues();

    const isDateRow = (row) => {
      if (String(row[0] || '').trim() !== '') return false;
      return /^\d{1,2}\/\d{1,2}/.test(String(row[1] || '').trim());
    };

    let i = 0;
    while (i < raw.length) {
      if (isDateRow(raw[i])) {
        const dates = {
          '월': String(raw[i][1] || '').trim(),
          '화': String(raw[i][2] || '').trim(),
          '수': String(raw[i][3] || '').trim(),
          '목': String(raw[i][4] || '').trim(),
          '금': String(raw[i][5] || '').trim(),
          '토': String(raw[i][6] || '').trim(),
        };
        const mem = {};
        i++;
        while (i < raw.length && String(raw[i][0] || '').trim() !== '') {
          const name = String(raw[i][0]).trim();
          mem[name] = {
            '월': String(raw[i][1] || '').trim(),
            '화': String(raw[i][2] || '').trim(),
            '수': String(raw[i][3] || '').trim(),
            '목': String(raw[i][4] || '').trim(),
            '금': String(raw[i][5] || '').trim(),
            '토': String(raw[i][6] || '').trim(),
          };
          i++;
        }
        workSchedule.push({ dates, members: mem });
      } else {
        i++;
      }
    }
  }

  const headers = scheduleValues[0];
  const schedule = scheduleValues.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });

  const THIRTY_MIN = 30 * 60 * 1000;
  const now       = new Date().getTime();

  const tasks = taskValues
    .slice(1)
    .map((row, idx) => {
      const completedAt = (typeof row[5] === 'object' && row[5] !== null && typeof row[5].getTime === 'function')
        ? row[5].getTime() : null;
      return {
        row:       idx + 8,
        업무:      row[0],
        담당:      row[1],
        마감기한:  fmtDate(row[2]),
        세부사항:  row[3],
        완료:      row[4] === true || row[4] === 'TRUE',
        완료시각:  completedAt,
      };
    })
    .filter(task => {
      if (!task['완료']) return true;
      if (!task['완료시각']) return false;
      return (now - task['완료시각']) < THIRTY_MIN;
    });

  // 완료 업무 아카이브 읽기
  const completedSheet = ss.getSheetByName('완료 업무');
  let completedTasks = [];
  if (completedSheet && completedSheet.getLastRow() > 1) {
    const cRaw = completedSheet
      .getRange(2, 1, completedSheet.getLastRow() - 1, 5)
      .getValues();
    completedTasks = cRaw.filter(r => r[0]).map(row => {
      const completedAt = (typeof row[4] === 'object' && row[4] !== null && typeof row[4].getTime === 'function')
        ? row[4].getTime() : null;
      return {
        업무:     row[0],
        담당:     row[1],
        마감기한: fmtDate(row[2]),
        세부사항: row[3],
        완료시각: completedAt,
      };
    });
  }

  // 반복 업무 읽기
  const recurringSheet = ss.getSheetByName('반복 업무');
  let recurringTasks = [];
  if (recurringSheet && recurringSheet.getLastRow() > 1) {
    const rRaw = recurringSheet
      .getRange(2, 1, recurringSheet.getLastRow() - 1, 6)
      .getValues();
    recurringTasks = rRaw
      .map((row, idx) => {
        const completedAt = (typeof row[5] === 'object' && row[5] !== null && typeof row[5].getTime === 'function')
          ? row[5].getTime() : null;
        return {
          row:       idx + 2,
          업무:      row[0],
          담당:      row[1],
          마감기한:  fmtDate(row[2]),
          세부사항:  row[3],
          완료:      row[4] === true || row[4] === 'TRUE',
          완료시각:  completedAt,
        };
      })
      .filter(t => t['업무']);
  }

  return ContentService
    .createTextOutput(JSON.stringify({ members, schedule, tasks, workSchedule, completedTasks, recurringTasks, v: currentVersion() }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * 2시간 지난 완료 업무를 '완료 업무' 시트로 이동 후 담당표에서 제거
 * → installTrigger()로 1시간마다 자동 실행됨
 */
function cleanupCompleted() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('담당표');
  const last  = sheet.getLastRow();
  if (last < 8) return;

  let cs = ss.getSheetByName('완료 업무');
  if (!cs) {
    cs = ss.insertSheet('완료 업무');
    cs.getRange(1, 1, 1, 5).setValues([
      ['업무', '담당', '마감기한', '세부사항', '완료시각']
    ]);
    cs.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#f0ede8');
  }

  const data      = sheet.getRange(8, 1, last - 7, 6).getValues();
  const THIRTY_MIN = 30 * 60 * 1000;
  const now       = new Date().getTime();

  let changed = false;
  for (let i = data.length - 1; i >= 0; i--) {
    const isDone = data[i][4] === true || data[i][4] === 'TRUE';
    const ts     = (typeof data[i][5] === 'object' && data[i][5] !== null && typeof data[i][5].getTime === 'function')
      ? data[i][5].getTime() : null;
    if (isDone && ts && (now - ts) > THIRTY_MIN) {
      // 아카이브로 복사
      cs.appendRow([data[i][0], data[i][1], data[i][2], data[i][3], data[i][5]]);
      const newRow = cs.getLastRow();
      cs.getRange(newRow, 5).setNumberFormat('yyyy-MM-dd HH:mm:ss');
      if (data[i][2] instanceof Date) {
        cs.getRange(newRow, 3).setNumberFormat('yyyy-MM-dd');
      }
      // 담당표에서 삭제
      sheet.deleteRow(i + 8);
      changed = true;
    }
  }
  if (changed) bumpVersion();
}

/**
 * 15분마다 cleanupCompleted를 실행하는 트리거 설치
 * → GAS 편집기에서 직접 1회 실행 필요 (편집기 → installTrigger 선택 → 실행)
 * → 코드 업데이트 후에도 다시 한 번 실행해줘야 새 주기로 적용됨
 */
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'cleanupCompleted') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('cleanupCompleted').timeBased().everyMinutes(15).create();
}
