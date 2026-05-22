const DAYS_KO  = ['월','화','수','목','금'];
const DAYS_EN  = ['Mon','Tue','Wed','Thu','Fri'];
const DAYS_ALL = ['월','화','수','목','금','토'];
const API_URL  = 'https://script.google.com/macros/s/AKfycbxwORlFY6OBJCNKQr0NAD48De04wvBLmCGCcm6KElQyfPc4lMccMfm9EwquH5tpgyvf/exec';
const ANCHOR   = new Date(2026,3,27);
const THIRTY_MIN_MS = 30 * 60 * 1000;

const COLOR_SLOTS = [
  {key:'ysh',name:'청록'}, {key:'psj',name:'주황'}, {key:'kkh',name:'회색'},
  {key:'c4', name:'보라'}, {key:'c5', name:'파랑'}, {key:'c6', name:'분홍'},
  {key:'c7', name:'에메랄드'}, {key:'c8', name:'레드'},
];

let PERSON = {};
let MEMBERS_LIST = [];
let overdueTasksCache = [];
let pendingReload = false;     // 모달 닫을 때 전체 새로고침 필요 여부
const taskTimers = {};

// 완료 업무 상태
let COMPLETED_TASKS = [];
let completedFilter = { member: 'all', period: 'all' };
let completedCollapsed = true;

// 반복 업무 상태
let RECURRING_TASKS = [];

function midnight(d){const c=new Date(d);c.setHours(0,0,0,0);return c;}
function getMonday(d){const c=midnight(d),w=c.getDay();c.setDate(c.getDate()+(w===0?-6:1-w));return c;}
function addDays(d,n){const c=new Date(d);c.setDate(c.getDate()+n);return c;}
function sameDay(a,b){return a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();}
function fmt(d){return `${d.getMonth()+1}/${d.getDate()}`;}
function fmtFull(d){const w=['일','월','화','수','목','금','토'][d.getDay()];return `${d.getFullYear()}. ${d.getMonth()+1}. ${d.getDate()} (${w})`;}
function parseDate(v){
  if(!v) return null;
  if(v instanceof Date) return midnight(v);
  const s=String(v).trim();
  if(!s||s==='-') return null;
  if(s.includes('T')||/^\d{4}-/.test(s)){const d=new Date(s);return isNaN(d)?null:midnight(d);}
  const p=s.split('/');
  if(p.length===2){const d=new Date(new Date().getFullYear(),+p[0]-1,+p[1]);return isNaN(d)?null:midnight(d);}
  if(p.length===3){const d=new Date(+p[2],+p[0]-1,+p[1]);return isNaN(d)?null:midnight(d);}
  return null;
}

function buildPerson(membersList){
  const obj = {};
  membersList.forEach(m => {
    const full = String(m['이름']||'').trim();
    if(!full) return;
    const short = full.length>=2 ? full.slice(-2) : full;
    obj[full] = {
      full, short,
      cls:  String(m['색상']||'ysh').trim(),
      role: String(m['역할']||'').trim(),
    };
  });
  return obj;
}

function renderMembersBar(){
  const bar = document.getElementById('membersBar');
  bar.innerHTML = Object.values(PERSON).map(p => `
    <div class="member">
      <div class="av av-${p.cls}">${p.short}</div>
      <div><div class="m-name">${p.full}</div><div class="m-role">${p.role}</div></div>
    </div>`).join('');
}

function renderVal(val){
  const s=String(val||'').trim();
  if(!s) return `<span style="color:var(--faint)">—</span>`;
  if(s==='공휴일') return `<span class="s-공휴일">공휴일</span>`;
  if(s==='휴무')   return `<span class="s-휴무">휴무</span>`;
  if(s==='연차')   return `<span class="s-연차">연차</span>`;
  if(s.includes('반차')) return `<span class="s-반차">${s}</span>`;
  if(/\d{1,2}:\d{2}/.test(s)) return `<span class="time-range">${s}</span>`;
  return `<span style="font-size:12px">${s}</span>`;
}

async function loadData(force){
  // force=true: 명시적 갱신(저장/삭제 등) - 인디케이터 표시
  // force=false 또는 생략: 폴링 - 변경 있을 때만 다시 그림
  if(force) updatePollIndicator('updating');
  try{
    const res  = await fetch(API_URL);
    const data = await res.json();
    MEMBERS_LIST = data.members || [];
    PERSON       = buildPerson(MEMBERS_LIST);
    if(data.v) lastServerVersion = data.v;  // 서버 버전 동기화

    const tasks         = data.tasks || [];
    const completedList = data.completedTasks || [];
    const recurringList = data.recurringTasks || [];
    const newHash       = hashTasks(tasks) + '|' + (data.workSchedule||[]).length + '|' + completedList.length + '|' + hashTasks(recurringList);

    // 폴링이고 변경 없으면 렌더 스킵
    if(!force && newHash === lastDataHash){
      updatePollIndicator(pollEnabled ? 'idle' : 'paused');
      return;
    }
    lastDataHash = newHash;

    currentTasksCache = tasks;
    renderMembersBar();
    buildCalendar(data.schedule||[]);
    buildTasks(tasks);
    buildRecurring(recurringList);
    buildCompleted(completedList);
    buildWork(data.workSchedule||[]);
    updatePollIndicator(pollEnabled ? 'idle' : 'paused');
  }catch(err){
    console.error(err);
    if(force){
      document.getElementById('calRoot').innerHTML='<div class="loading">데이터를 불러오지 못했습니다.</div>';
      document.getElementById('workTableWrap').innerHTML='<div class="empty-state">근무일정을 불러오지 못했습니다.</div>';
      document.getElementById('leaveList').innerHTML='<div class="empty-state">연차계획을 불러오지 못했습니다.</div>';
    }
    updatePollIndicator('error');
  }
}

function buildCalendar(schedule){
  const cal=document.getElementById('calRoot');
  cal.innerHTML='';
  const today=midnight(new Date()),tMon=getMonday(today);
  const diff=Math.round((tMon-midnight(ANCHOR))/864e5);
  const wkIdx=((Math.floor(diff/7)%3)+3)%3;
  const c1Mon=addDays(tMon,-wkIdx*7);
  document.getElementById('todayBadge').textContent=`오늘 ${fmtFull(today)} · ${wkIdx+1}주차`;

  const head=document.createElement('div');
  head.className='cal-head';
  head.innerHTML='<div class="ch-corner"></div>'+
    DAYS_KO.map((ko,i)=>`<div class="ch-day"><div class="d-en">${DAYS_EN[i]}</div><span class="d-ko">${ko}</span></div>`).join('');
  cal.appendChild(head);

  for(let wk=0;wk<3;wk++){
    const mon=addDays(c1Mon,wk*7);
    const row=document.createElement('div');
    row.className='cal-row';
    let h=`<div class="row-lbl"><div class="lbl-w">WK</div><div class="lbl-n">${wk+1}</div></div>`;
    for(let d=0;d<5;d++){
      const date=addDays(mon,d),isT=sameDay(date,today);
      const dayKey=['월','화','수','목','금'][d];
      const p=PERSON[schedule[wk]?.[dayKey]];
      if(!p){h+=`<div class="cal-cell ${isT?'today':''}"><div class="cell-date">${fmt(date)}</div></div>`;continue;}
      h+=`<div class="cal-cell ${isT?'today':''}">
        <div class="cell-date">${fmt(date)}</div>
        ${isT?'<div class="today-dot">TODAY</div>':''}
        <div class="ev ev-${p.cls}">
          <div class="ev-av eav-${p.cls}">${p.short}</div>
          <div class="ev-name">${p.full}</div>
        </div>
      </div>`;
    }
    row.innerHTML=h;
    cal.appendChild(row);
  }
}

function buildTasks(tasks){
  const today=midnight(new Date());
  const root=document.getElementById('taskList');
  root.innerHTML='';

  overdueTasksCache = tasks.filter(t => {
    if(t['완료']) return false;
    const dl = parseDate(t['마감기한']);
    return dl && dl < today;
  });

  const btn = document.getElementById('overdueBtn');
  const cnt = document.getElementById('overdueCount');
  if(overdueTasksCache.length > 0){btn.style.display='flex';cnt.textContent=overdueTasksCache.length;}
  else{btn.style.display='none';}

  const now = Date.now();
  tasks = tasks.filter(t => {
    if(!t['완료']) return true;
    if(!t['완료시각']) return false;
    return (now - t['완료시각']) < THIRTY_MIN_MS;
  });

  if(!tasks.length){root.innerHTML='<div class="empty-state">등록된 업무가 없습니다.</div>';return;}

  tasks.sort((a,b)=>{
    if(a['완료']!==b['완료']) return a['완료']?1:-1;
    const da=parseDate(a['마감기한']),db=parseDate(b['마감기한']);
    return (!da||!db)?0:da-db;
  });

  tasks.forEach(task=>{
    const dl   = parseDate(task['마감기한']);
    const done = !!task['완료'];
    const row  = task['row'];

    let state='', badge='';
    if(!done && dl){
      const diff = Math.floor((dl-today)/86400000);
      badge = buildCountdownBadge(diff);
      if(diff === 0)      state = 'urgent';
      else if(diff < 0)   state = 'overdue';
    }
    if(done) state='done';

    const el=document.createElement('div');
    el.className=`task-item ${state}`;
    el.dataset.row=row;
    el.innerHTML=`
      <div class="task-check ${done?'checked':''}" title="완료 토글">
        <svg viewBox="0 0 12 12"><polyline points="1.5,6 4.5,9.5 10.5,2.5"/></svg>
      </div>
      <div class="task-body">
        <div class="task-top">
          <div class="task-name">${task['업무']}${badge}</div>
          <div class="task-deadline">${dl?fmt(dl):'-'}</div>
        </div>
        <div class="task-manager">담당 · ${task['담당']}</div>
        <div class="task-desc">${task['세부사항']||''}</div>
      </div>
      <div class="task-actions">
        <button class="task-action-btn" title="수정" onclick="event.stopPropagation();openTaskModal(${row})">
          <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="task-action-btn btn-del" title="삭제" onclick="event.stopPropagation();deleteTaskRow(${row},'${(task['업무']||'').replace(/'/g,'')}')">
          <svg viewBox="0 0 24 24"><polyline points="3,6 5,6 21,6"/><path d="M19,6 l-1,14 a2,2 0 0 1 -2,2 H8 a2,2 0 0 1 -2,-2 L5,6"/><path d="M10 11v6M14 11v6"/></svg>
        </button>
      </div>`;

    const checkEl = el.querySelector('.task-check');
    checkEl.onclick = () => toggleTask(checkEl, el, row, done);
    root.appendChild(el);
  });

  // 마감 임박 알림 발송 (있다면)
  fireDeadlineNotifications(tasks);
}

function buildCountdownBadge(diff){
  if(diff < 0)       return `<span class="dcount-badge dcount-overdue">${Math.abs(diff)}일 지남</span>`;
  if(diff === 0)     return `<span class="dcount-badge dcount-today">TODAY</span>`;
  if(diff === 1)     return `<span class="dcount-badge dcount-warn">D-1</span>`;
  if(diff === 2)     return `<span class="dcount-badge dcount-warn">D-2</span>`;
  if(diff <= 4)      return `<span class="dcount-badge dcount-soon">D-${diff}</span>`;
  if(diff <= 7)      return `<span class="dcount-badge dcount-week">D-${diff}</span>`;
  return                    `<span class="dcount-badge dcount-far">D-${diff}</span>`;
}

async function toggleTask(checkEl, itemEl, row, currentDone){
  checkEl.classList.add('loading-spin');
  checkEl.style.pointerEvents='none';
  const newValue = !currentDone;
  try{
    const res  = await fetch(`${API_URL}?action=setComplete&row=${row}&value=${newValue}`);
    const json = await res.json();
    if(!json.ok) throw new Error('error');

    checkEl.classList.remove('loading-spin');
    checkEl.style.pointerEvents='';

    if(newValue){
      checkEl.classList.add('checked');
      itemEl.classList.remove('urgent','overdue');
      itemEl.classList.add('done');
      taskTimers[row] = setTimeout(()=>{
        itemEl.style.transition='opacity .6s';
        itemEl.style.opacity='0';
        setTimeout(()=>itemEl.remove(), 650);
        showToast('완료 항목이 자동 삭제되었습니다');
      }, THIRTY_MIN_MS);
    }else{
      checkEl.classList.remove('checked');
      itemEl.classList.remove('done');
      if(taskTimers[row]){clearTimeout(taskTimers[row]);delete taskTimers[row];}
    }

    itemEl.dataset.done = newValue?'true':'false';
    checkEl.onclick = () => toggleTask(checkEl, itemEl, row, newValue);
    showToast(newValue?'✓ 완료 처리 — 30분 후 자동 삭제':'↩ 완료 취소 · 시각 기록 삭제됨');
  }catch(err){
    console.error(err);
    checkEl.classList.remove('loading-spin');
    checkEl.style.pointerEvents='';
    showToast('⚠ 시트 반영 실패 — Apps Script 재배포 확인', true);
  }
}

function openOverdueModal(){
  const today = midnight(new Date());
  document.getElementById('overdueModalBody').innerHTML = overdueTasksCache.map(task=>{
    const dl = parseDate(task['마감기한']);
    const daysAgo = dl ? Math.abs(Math.floor((dl-today)/86400000)) : 0;
    return `<div class="modal-task">
      <div class="modal-task-top">
        <div class="modal-task-name">${task['업무']}</div>
        <div class="modal-days-ago">${daysAgo}일 초과</div>
      </div>
      <div class="modal-task-meta">담당 · <strong>${task['담당']}</strong> &nbsp;·&nbsp; 기한 ${task['마감기한']}</div>
      ${task['세부사항']?`<div class="modal-task-desc">${task['세부사항']}</div>`:''}
    </div>`;
  }).join('');
  document.getElementById('overdueOverlay').classList.add('show');
  document.getElementById('overdueModal').classList.add('show');
}
function closeOverdueModal(){
  document.getElementById('overdueOverlay').classList.remove('show');
  document.getElementById('overdueModal').classList.remove('show');
}

// ── 설정 모달 ──
let editingMemberIdx = -1;

function openSettings(){
  editingMemberIdx = -1;
  renderSettings();
  document.getElementById('settingsOverlay').classList.add('show');
  document.getElementById('settingsModal').classList.add('show');
}

async function closeSettings(){
  document.getElementById('settingsOverlay').classList.remove('show');
  document.getElementById('settingsModal').classList.remove('show');
  // 이름 변경이 있었던 경우에만 전체 새로고침
  if(pendingReload){
    pendingReload = false;
    await loadData();
  }
}

function renderSettings(){
  const body = document.getElementById('settingsBody');
  const usedColors = MEMBERS_LIST.map(m=>String(m['색상']||'').trim());

  let html = `<div class="settings-section">
    <div class="settings-section-label">멤버 관리 (${MEMBERS_LIST.length}명)</div>`;

  MEMBERS_LIST.forEach((m, idx) => {
    const cls = String(m['색상']||'ysh').trim();
    const name = String(m['이름']||'').trim();
    const role = String(m['역할']||'').trim();
    const short = name.length>=2 ? name.slice(-2) : name;

    if(editingMemberIdx === idx){
      html += `<div class="member-edit">
        <div class="field">
          <label class="field-label">이름</label>
          <input class="field-input" id="editName" value="${name}" maxlength="8"/>
        </div>
        <div class="field">
          <label class="field-label">역할</label>
          <input class="field-input" id="editRole" value="${role}" maxlength="10"/>
        </div>
        <div class="field">
          <label class="field-label">색상</label>
          <div class="color-grid" id="editColorGrid">
            ${COLOR_SLOTS.map(c => `
              <div class="color-swatch cs-${c.key} ${c.key===cls?'selected':''}"
                   data-color="${c.key}" title="${c.name}"
                   onclick="selectColor('${c.key}')"></div>`).join('')}
          </div>
        </div>
        <div class="form-actions">
          <button class="btn-secondary" onclick="cancelEdit()">취소</button>
          <button class="btn-primary" id="saveBtn" onclick="saveMemberEdit(${idx},'${name}')">저장</button>
        </div>
      </div>`;
    } else {
      html += `<div class="member-row">
        <div class="av av-${cls}">${short}</div>
        <div class="member-row-info">
          <div class="member-row-name">${name}</div>
          <div class="member-row-role">${role || '—'}</div>
        </div>
        <div class="member-row-actions">
          <button class="btn-icon" title="수정" onclick="startEdit(${idx})">
            <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-icon btn-del" title="삭제" onclick="deleteMember(${idx},'${name}')">
            <svg viewBox="0 0 24 24"><polyline points="3,6 5,6 21,6"/><path d="M19,6 l-1,14 a2,2 0 0 1 -2,2 H8 a2,2 0 0 1 -2,-2 L5,6"/><path d="M10 11v6M14 11v6"/></svg>
          </button>
        </div>
      </div>`;
    }
  });

  if(editingMemberIdx === -2){
    const availColor = COLOR_SLOTS.find(c => !usedColors.includes(c.key))?.key || 'ysh';
    html += `<div class="member-edit">
      <div class="field">
        <label class="field-label">이름</label>
        <input class="field-input" id="editName" placeholder="이름 입력" maxlength="8"/>
      </div>
      <div class="field">
        <label class="field-label">역할</label>
        <input class="field-input" id="editRole" placeholder="역할 (예: 연구원)" maxlength="10"/>
      </div>
      <div class="field">
        <label class="field-label">색상</label>
        <div class="color-grid" id="editColorGrid">
          ${COLOR_SLOTS.map(c => `
            <div class="color-swatch cs-${c.key} ${c.key===availColor?'selected':''}"
                 data-color="${c.key}" title="${c.name}"
                 onclick="selectColor('${c.key}')"></div>`).join('')}
        </div>
      </div>
      <div class="form-actions">
        <button class="btn-secondary" onclick="cancelEdit()">취소</button>
        <button class="btn-primary" id="saveBtn" onclick="saveMemberAdd()">추가</button>
      </div>
    </div>`;
  } else {
    html += `<button class="btn-add-member" onclick="startAdd()">
      <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      멤버 추가
    </button>`;
  }

  html += `</div>`;

  body.innerHTML = html;
}

function startEdit(idx){editingMemberIdx=idx;renderSettings();}
function startAdd(){editingMemberIdx=-2;renderSettings();}
function cancelEdit(){editingMemberIdx=-1;renderSettings();}

function selectColor(key){
  document.querySelectorAll('#editColorGrid .color-swatch').forEach(el=>{
    el.classList.toggle('selected', el.dataset.color===key);
  });
}

function getSelectedColor(){
  const sel = document.querySelector('#editColorGrid .color-swatch.selected');
  return sel ? sel.dataset.color : 'ysh';
}

function setSaveBtnLoading(loading){
  const btn = document.getElementById('saveBtn');
  if(!btn) return;
  btn.disabled = loading;
  btn.textContent = loading ? '저장 중...' : btn.textContent;
}

async function saveMemberAdd(){
  const name  = document.getElementById('editName').value.trim();
  const role  = document.getElementById('editRole').value.trim();
  const color = getSelectedColor();
  if(!name){showToast('이름을 입력해주세요', true); return;}

  const btn = document.getElementById('saveBtn');
  btn.disabled = true; btn.textContent = '추가 중...';

  try{
    const res = await fetch(`${API_URL}?action=addMember&name=${encodeURIComponent(name)}&role=${encodeURIComponent(role)}&color=${color}`);
    const json = await res.json();
    if(!json.ok) throw new Error(json.error||'error');

    // 로컬 상태만 즉시 업데이트 (loadData 호출 안 함)
    MEMBERS_LIST.push({'이름':name,'역할':role,'색상':color});
    PERSON = buildPerson(MEMBERS_LIST);
    renderMembersBar();

    editingMemberIdx = -1;
    renderSettings();
    showToast('✓ 멤버가 추가되었습니다');
  }catch(err){
    btn.disabled = false; btn.textContent = '추가';
    showToast('⚠ 추가 실패: '+err.message, true);
  }
}

async function saveMemberEdit(idx, originalName){
  const name  = document.getElementById('editName').value.trim();
  const role  = document.getElementById('editRole').value.trim();
  const color = getSelectedColor();
  if(!name){showToast('이름을 입력해주세요', true); return;}

  const btn = document.getElementById('saveBtn');
  btn.disabled = true; btn.textContent = '저장 중...';

  try{
    const res = await fetch(`${API_URL}?action=updateMember&original=${encodeURIComponent(originalName)}&name=${encodeURIComponent(name)}&role=${encodeURIComponent(role)}&color=${color}`);
    const json = await res.json();
    if(!json.ok) throw new Error(json.error||'error');

    // 로컬 상태만 즉시 업데이트
    MEMBERS_LIST[idx] = {'이름':name,'역할':role,'색상':color};
    PERSON = buildPerson(MEMBERS_LIST);
    renderMembersBar();

    // 이름이 바뀌었을 때만 모달 닫을 때 전체 새로고침 예약
    if(originalName !== name) pendingReload = true;

    editingMemberIdx = -1;
    renderSettings();
    showToast('✓ 저장되었습니다');
  }catch(err){
    btn.disabled = false; btn.textContent = '저장';
    showToast('⚠ 저장 실패: '+err.message, true);
  }
}

async function deleteMember(idx, name){
  if(!confirm(`${name}님을 멤버에서 제외하시겠습니까?\n시트의 다른 데이터(담당표, 근무일정)는 그대로 유지됩니다.`)) return;

  try{
    const res = await fetch(`${API_URL}?action=deleteMember&name=${encodeURIComponent(name)}`);
    const json = await res.json();
    if(!json.ok) throw new Error(json.error||'error');

    // 로컬 상태만 즉시 업데이트
    MEMBERS_LIST.splice(idx, 1);
    PERSON = buildPerson(MEMBERS_LIST);
    renderMembersBar();

    renderSettings();
    showToast('✓ 멤버가 제외되었습니다');
  }catch(err){
    showToast('⚠ 삭제 실패: '+err.message, true);
  }
}

document.addEventListener('keydown', e=>{
  if(e.key==='Escape'){closeOverdueModal();closeSettings();closeTaskModal();}
  // 단축키: N → 업무 추가 (입력 필드 포커스 중이면 무시)
  if(e.key==='n' || e.key==='N'){
    const t = e.target;
    if(t && (t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.tagName==='SELECT')) return;
    if(document.querySelector('.modal.show')) return;
    openTaskModal();
  }
});

// 탭이 다시 보일 때 해시 체크 (5분 이상 백그라운드였다면)
let lastVisibleTs = Date.now();
document.addEventListener('visibilitychange', () => {
  if(!document.hidden){
    const elapsed = Date.now() - lastVisibleTs;
    if(elapsed > 5*60*1000 && pollEnabled) checkVersionAndLoad();
    lastVisibleTs = Date.now();
  } else {
    lastVisibleTs = Date.now();
  }
});

function showToast(msg, isError=false){
  let t=document.getElementById('_toast');
  if(!t){
    t=document.createElement('div');t.id='_toast';
    t.style.cssText='position:fixed;bottom:28px;left:50%;transform:translateX(-50%) translateY(20px);background:#1c1c1e;color:#fff;font-size:13px;font-weight:600;font-family:\'Noto Sans KR\',sans-serif;padding:11px 22px;border-radius:999px;box-shadow:0 8px 28px rgba(0,0,0,.2);opacity:0;transition:opacity .25s,transform .25s;z-index:999;white-space:nowrap;pointer-events:none;';
    document.body.appendChild(t);
  }
  t.textContent=msg;
  t.style.background=isError?'#b91c1c':'#1c1c1e';
  t.style.opacity='1';t.style.transform='translateX(-50%) translateY(0)';
  clearTimeout(t._timer);
  t._timer=setTimeout(()=>{t.style.opacity='0';t.style.transform='translateX(-50%) translateY(20px)';},2500);
}

// ───────── 업무 CRUD 모달 ─────────
let editingTaskRow = null;     // null = 추가 모드, 숫자 = 수정 모드
let taskModalMode  = 'add';    // 'add' | 'edit' | 'completed-add'
let currentTasksCache = [];    // 수정 시 기존 값을 찾기 위한 캐시
let selectedAssignees = new Set();  // 담당자 다중 선택 상태

// ── 담당자 picker ──
function renderAssigneePicker(){
  const root = document.getElementById('taskAssignee');
  if(!root) return;
  let html = '';

  // 전원 옵션
  const isAll = selectedAssignees.has('AI 연구원');
  html += `<button type="button" class="pick-chip ${isAll?'active':''}" onclick="toggleAssignee('AI 연구원')">AI 연구원 (전원)</button>`;

  // 구분선
  html += `<span class="pick-divider"></span>`;

  // 개별 멤버
  Object.values(PERSON).forEach(p => {
    const active = selectedAssignees.has(p.full);
    const safeName = p.full.replace(/'/g,'').replace(/"/g,'');
    html += `<button type="button" class="pick-chip ${active?'active':''}" onclick="toggleAssignee('${safeName}')">
      <span class="mini-av av-${p.cls}">${p.short}</span>${p.full}
    </button>`;
  });

  // PERSON에 없는 이름이 선택돼 있으면 (옛 데이터 등) 추가 표시
  selectedAssignees.forEach(name => {
    if(name === 'AI 연구원' || PERSON[name]) return;
    const safeName = name.replace(/'/g,'').replace(/"/g,'');
    html += `<button type="button" class="pick-chip active" onclick="toggleAssignee('${safeName}')">${name}</button>`;
  });

  root.innerHTML = html;
}

function toggleAssignee(name){
  if(name === 'AI 연구원'){
    if(selectedAssignees.has('AI 연구원')){
      selectedAssignees.delete('AI 연구원');
    } else {
      selectedAssignees.clear();
      selectedAssignees.add('AI 연구원');
    }
  } else {
    selectedAssignees.delete('AI 연구원'); // 개인 선택 시 전원 해제
    if(selectedAssignees.has(name)) selectedAssignees.delete(name);
    else selectedAssignees.add(name);
  }
  renderAssigneePicker();
}

function getAssigneeValue(){
  return Array.from(selectedAssignees).join(',');
}

function setAssigneeFromString(s){
  selectedAssignees = new Set();
  if(s){
    String(s).split(',').map(x => x.trim()).filter(Boolean).forEach(name => selectedAssignees.add(name));
  }
  renderAssigneePicker();
}

function openTaskModal(rowOrMode, extra){
  // rowOrMode: 'completed' | 'recurring' | 숫자(편집) | undefined(추가)
  // extra: 편집 모드일 때 'recurring' 이면 반복 업무 편집
  if(rowOrMode === 'completed'){
    taskModalMode  = 'completed-add';
    editingTaskRow = null;
  } else if(rowOrMode === 'recurring'){
    taskModalMode  = 'recurring-add';
    editingTaskRow = null;
  } else if(typeof rowOrMode === 'number'){
    taskModalMode  = (extra === 'recurring') ? 'recurring-edit' : 'edit';
    editingTaskRow = rowOrMode;
  } else {
    taskModalMode  = 'add';
    editingTaskRow = null;
  }

  const completedField = document.getElementById('taskCompletedField');
  const completedInput = document.getElementById('taskCompletedAt');
  const subEl          = document.getElementById('taskModalSub');
  const assigneeField  = document.getElementById('assigneeField');
  const deadlineField  = document.getElementById('deadlineField');
  const recurringDaysField = document.getElementById('recurringDaysField');

  // 반복 업무 모드면 담당/마감 숨기고 요일 입력 표시
  const isRecurring = (taskModalMode === 'recurring-add' || taskModalMode === 'recurring-edit');
  assigneeField.style.display      = isRecurring ? 'none'  : 'block';
  deadlineField.style.display      = isRecurring ? 'none'  : 'block';
  recurringDaysField.style.display = isRecurring ? 'block' : 'none';

  if(taskModalMode === 'edit'){
    const t = currentTasksCache.find(x => x.row === editingTaskRow);
    document.getElementById('taskModalTitle').textContent = '업무 수정';
    subEl.textContent = "시트 '담당표' 탭에 저장됩니다";
    document.getElementById('taskName').value     = t ? (t['업무']||'') : '';
    setAssigneeFromString(t ? (t['담당']||'') : '');
    document.getElementById('taskDeadline').value = t ? toDateInputValue(t['마감기한']) : '';
    document.getElementById('taskDetail').value   = t ? (t['세부사항']||'') : '';
    document.getElementById('taskDeleteBtn').style.display = 'inline-flex';
    completedField.style.display = 'none';
  } else if(taskModalMode === 'recurring-edit'){
    const t = RECURRING_TASKS.find(x => x.row === editingTaskRow);
    document.getElementById('taskModalTitle').textContent = '반복 업무 수정';
    subEl.textContent = "시트 '반복 업무' 탭에 저장됩니다";
    document.getElementById('taskName').value      = t ? (t['업무']||'') : '';
    document.getElementById('recDay-mon').value    = t ? (t['월']||'') : '';
    document.getElementById('recDay-tue').value    = t ? (t['화']||'') : '';
    document.getElementById('recDay-wed').value    = t ? (t['수']||'') : '';
    document.getElementById('recDay-thu').value    = t ? (t['목']||'') : '';
    document.getElementById('recDay-fri').value    = t ? (t['금']||'') : '';
    document.getElementById('recDay-sat').value    = t ? (t['토']||'') : '';
    document.getElementById('taskDetail').value    = t ? (t['세부사항']||'') : '';
    document.getElementById('taskDeleteBtn').style.display = 'inline-flex';
    completedField.style.display = 'none';
  } else if(taskModalMode === 'recurring-add'){
    document.getElementById('taskModalTitle').textContent = '반복 업무 추가';
    subEl.textContent = "시트 '반복 업무' 탭에 저장됩니다";
    document.getElementById('taskName').value      = '';
    ['mon','tue','wed','thu','fri','sat'].forEach(d => {
      document.getElementById('recDay-'+d).value = '';
    });
    document.getElementById('taskDetail').value    = '';
    document.getElementById('taskDeleteBtn').style.display = 'none';
    completedField.style.display = 'none';
  } else if(taskModalMode === 'completed-add'){
    document.getElementById('taskModalTitle').textContent = '완료 업무 추가';
    subEl.textContent = "이미 완료한 업무를 시트 '완료 업무' 탭에 직접 추가합니다";
    document.getElementById('taskName').value     = '';
    setAssigneeFromString('');
    document.getElementById('taskDeadline').value = '';
    document.getElementById('taskDetail').value   = '';
    document.getElementById('taskDeleteBtn').style.display = 'none';
    completedField.style.display = 'block';
    // 기본값 = 지금
    const now = new Date();
    const off = now.getTimezoneOffset();
    const local = new Date(now.getTime() - off*60*1000);
    completedInput.value = local.toISOString().slice(0,16);
  } else {
    document.getElementById('taskModalTitle').textContent = '업무 추가';
    subEl.textContent = "시트 '담당표' 탭 8행 이하에 저장됩니다";
    document.getElementById('taskName').value     = '';
    setAssigneeFromString('');
    document.getElementById('taskDeadline').value = '';
    document.getElementById('taskDetail').value   = '';
    document.getElementById('taskDeleteBtn').style.display = 'none';
    completedField.style.display = 'none';
  }

  document.getElementById('taskOverlay').classList.add('show');
  document.getElementById('taskModal').classList.add('show');
  setTimeout(() => document.getElementById('taskName').focus(), 100);

  // 🔥 사용자가 모달 채우는 동안 GAS 워밍업 (저장 시 콜드 스타트 회피)
  fetch(`${API_URL}?action=getHash`).catch(()=>{});
}

function closeTaskModal(){
  document.getElementById('taskOverlay').classList.remove('show');
  document.getElementById('taskModal').classList.remove('show');
  editingTaskRow = null;
}

function toDateInputValue(v){
  const d = parseDate(v);
  if(!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${dd}`;
}

// yyyy-mm-dd → "M/D" (GAS fmtDate 출력 형식과 맞춤)
function deadlineToShort(yyyymmdd){
  if(!yyyymmdd) return '';
  const parts = String(yyyymmdd).split('-');
  if(parts.length !== 3) return yyyymmdd;
  return `${parseInt(parts[1])}/${parseInt(parts[2])}`;
}

async function saveTask(){
  const name        = document.getElementById('taskName').value.trim();
  const assignee    = getAssigneeValue();
  const deadline    = document.getElementById('taskDeadline').value.trim();
  const detail      = document.getElementById('taskDetail').value.trim();
  const completedAt = document.getElementById('taskCompletedAt').value.trim();

  if(!name){ showToast('업무명을 입력해주세요', true); return; }
  if(taskModalMode === 'completed-add' && !completedAt){
    showToast('완료시각을 입력해주세요', true); return;
  }

  const btn = document.getElementById('taskSaveBtn');
  btn.disabled = true;
  const origText = btn.textContent;
  btn.textContent = '저장 중...';

  // 모달 닫고 진행 — 사용자는 빠르게 반응한다고 느낌
  const mode  = taskModalMode;
  const eRow  = editingTaskRow;
  closeTaskModal();

  try{
    // 반복 업무는 요일별 입력
    const isRecurring = (mode === 'recurring-add' || mode === 'recurring-edit');
    const recDays = isRecurring ? {
      mon: document.getElementById('recDay-mon').value.trim(),
      tue: document.getElementById('recDay-tue').value.trim(),
      wed: document.getElementById('recDay-wed').value.trim(),
      thu: document.getElementById('recDay-thu').value.trim(),
      fri: document.getElementById('recDay-fri').value.trim(),
      sat: document.getElementById('recDay-sat').value.trim(),
    } : null;

    let action;
    if(mode === 'completed-add')      action = 'addCompletedTask';
    else if(mode === 'recurring-add') action = 'addRecurringTask';
    else if(mode === 'recurring-edit')action = 'updateRecurringTask';
    else if(eRow)                     action = 'updateTask';
    else                              action = 'addTask';

    const params = new URLSearchParams({ action, name, detail });
    if(!isRecurring){
      params.set('assignee', assignee);
      params.set('deadline', deadline);
    }
    if(isRecurring){
      Object.entries(recDays).forEach(([k,v]) => params.set(k, v));
    }
    if(eRow) params.set('row', eRow);
    if(mode === 'completed-add') params.set('completedAt', completedAt);

    const res  = await fetch(`${API_URL}?${params.toString()}`);
    const json = await res.json();
    if(!json.ok) throw new Error(json.error || 'error');

    // 🚀 낙관적 UI 업데이트 — 전체 새로고침 없이 로컬 상태만 갱신
    if(mode === 'completed-add'){
      const ts = new Date(completedAt).getTime();
      COMPLETED_TASKS.unshift({
        업무: name, 담당: assignee,
        마감기한: deadlineToShort(deadline),
        세부사항: detail, 완료시각: ts,
      });
      buildCompleted(COMPLETED_TASKS);
    } else if(mode === 'recurring-add'){
      RECURRING_TASKS.push({
        row: json.row,
        업무: name,
        월: recDays.mon, 화: recDays.tue, 수: recDays.wed,
        목: recDays.thu, 금: recDays.fri, 토: recDays.sat,
        세부사항: detail,
      });
      buildRecurring(RECURRING_TASKS);
    } else if(mode === 'recurring-edit'){
      const idx = RECURRING_TASKS.findIndex(t => t.row === eRow);
      if(idx >= 0){
        RECURRING_TASKS[idx] = {
          ...RECURRING_TASKS[idx],
          업무: name,
          월: recDays.mon, 화: recDays.tue, 수: recDays.wed,
          목: recDays.thu, 금: recDays.fri, 토: recDays.sat,
          세부사항: detail,
        };
      }
      buildRecurring(RECURRING_TASKS);
    } else if(eRow){
      const idx = currentTasksCache.findIndex(t => t.row === eRow);
      if(idx >= 0){
        currentTasksCache[idx] = {
          ...currentTasksCache[idx],
          업무: name, 담당: assignee,
          마감기한: deadlineToShort(deadline),
          세부사항: detail,
        };
      }
      buildTasks(currentTasksCache);
    } else {
      // addTask — 서버가 반환한 행 번호 사용
      currentTasksCache.push({
        row: json.row,
        업무: name, 담당: assignee,
        마감기한: deadlineToShort(deadline),
        세부사항: detail,
        완료: false, 완료시각: null,
      });
      buildTasks(currentTasksCache);
    }

    const msg = (mode === 'completed-add')   ? '✓ 완료 업무가 추가되었습니다'
              : (mode === 'recurring-add')   ? '✓ 반복 업무가 추가되었습니다'
              : (mode === 'recurring-edit')  ? '✓ 반복 업무가 수정되었습니다'
              : eRow                          ? '✓ 업무가 수정되었습니다'
                                              : '✓ 업무가 추가되었습니다';
    showToast(msg);
  }catch(err){
    showToast('⚠ 저장 실패: ' + err.message + ' (새로고침 후 확인 필요)', true);
    // 실패 시 서버 진실로 복원
    loadData(true).catch(()=>{});
  }finally{
    btn.disabled = false;
    btn.textContent = origText;
  }
}

// 로컬 캐시에서 행 삭제 + 그 아래 행번호 −1 시프트 (시트 동작 모사)
function removeFromTaskCache(row){
  currentTasksCache = currentTasksCache
    .filter(t => t.row !== row)
    .map(t => t.row > row ? {...t, row: t.row - 1} : t);
  buildTasks(currentTasksCache);
}

async function deleteCurrentTask(){
  if(!editingTaskRow) return;
  const target = editingTaskRow;
  const isRecurring = (taskModalMode === 'recurring-edit');
  const list = isRecurring ? RECURRING_TASKS : currentTasksCache;
  const t = list.find(x => x.row === target);
  const taskName = t ? t['업무'] : '이 업무';
  if(!confirm(`'${taskName}'을(를) 삭제하시겠습니까?`)) return;

  closeTaskModal();
  if(isRecurring){
    RECURRING_TASKS = RECURRING_TASKS
      .filter(t => t.row !== target)
      .map(t => t.row > target ? {...t, row: t.row - 1} : t);
    buildRecurring(RECURRING_TASKS);
    showToast('✓ 반복 업무가 삭제되었습니다');
  } else {
    removeFromTaskCache(target);
    showToast('✓ 업무가 삭제되었습니다');
  }

  try{
    const apiAction = isRecurring ? 'deleteRecurringTask' : 'deleteTask';
    const res = await fetch(`${API_URL}?action=${apiAction}&row=${target}`);
    const json = await res.json();
    if(!json.ok) throw new Error(json.error || 'error');
  }catch(err){
    showToast('⚠ 삭제 실패 — 서버 동기화 중', true);
    loadData(true).catch(()=>{});
  }
}

async function deleteTaskRow(row, taskName){
  if(!confirm(`'${taskName}'을(를) 삭제하시겠습니까?`)) return;
  // 낙관적 제거
  removeFromTaskCache(row);
  showToast('✓ 업무가 삭제되었습니다');

  try{
    const res = await fetch(`${API_URL}?action=deleteTask&row=${row}`);
    const json = await res.json();
    if(!json.ok) throw new Error(json.error || 'error');
  }catch(err){
    showToast('⚠ 삭제 실패 — 서버 동기화 중', true);
    loadData(true).catch(()=>{});
  }
}

// ───────── 폴링 (자동 갱신, 해시 기반) ─────────
const POLL_INTERVAL = 30000;
let pollTimer = null;
let pollEnabled = true;
let lastDataHash = '';
let lastServerVersion = null;  // 서버가 반환한 v 값. getHash와 비교.

function startPolling(){
  stopPolling();
  pollTimer = setInterval(() => {
    if(document.hidden) return;                          // 탭 백그라운드면 건너뜀
    if(document.querySelector('.modal.show')) return;    // 모달 열려있으면 건너뜀
    if(editingMemberIdx >= 0 || editingMemberIdx === -2) return;
    checkVersionAndLoad();
  }, POLL_INTERVAL);
  pollEnabled = true;
  updatePollIndicator('idle');
}

// 가벼운 핑 → 버전 다를 때만 전체 데이터 갱신
async function checkVersionAndLoad(){
  try{
    const res = await fetch(`${API_URL}?action=getHash`);
    const json = await res.json();
    if(json.v !== lastServerVersion){
      // 변경 감지 → 전체 갱신
      await loadData(false);
    } else {
      // 변경 없음 → 아무것도 안 함
      updatePollIndicator(pollEnabled ? 'idle' : 'paused');
    }
  }catch(err){
    updatePollIndicator('error');
  }
}

function stopPolling(){
  if(pollTimer){ clearInterval(pollTimer); pollTimer = null; }
  pollEnabled = false;
  updatePollIndicator('paused');
}

function togglePolling(){
  if(pollEnabled) stopPolling();
  else startPolling();
}

function updatePollIndicator(state){
  const el  = document.getElementById('pollIndicator');
  const lbl = document.getElementById('pollLabel');
  if(!el) return;
  el.classList.remove('updating','paused','error');
  if(state === 'updating'){ el.classList.add('updating'); lbl.textContent = '갱신 중...'; }
  else if(state === 'paused'){ el.classList.add('paused'); lbl.textContent = '자동 갱신 OFF'; }
  else if(state === 'error'){ el.classList.add('error'); lbl.textContent = '연결 오류'; }
  else { lbl.textContent = '자동 갱신 ON · 30초'; }
}

function hashTasks(tasks){
  return tasks.map(t => `${t.row}|${t['업무']}|${t['담당']}|${t['마감기한']}|${t['완료']?1:0}`).join('||');
}

// ───────── 브라우저 알림 ─────────
const NOTIF_STORAGE_KEY = 'fox_notif_sent';

function refreshNotifBtn(){
  const btn = document.getElementById('notifBtn');
  const lbl = document.getElementById('notifLabel');
  if(!('Notification' in window)){
    btn.style.display = 'none';
    return;
  }
  btn.classList.remove('enabled','denied');
  if(Notification.permission === 'granted'){ btn.classList.add('enabled'); lbl.textContent = '알림 ON'; }
  else if(Notification.permission === 'denied'){ btn.classList.add('denied'); lbl.textContent = '알림 차단됨'; }
  else { lbl.textContent = '알림 사용'; }
}

async function requestNotifPermission(){
  if(!('Notification' in window)){ showToast('이 브라우저는 알림을 지원하지 않습니다', true); return; }
  if(Notification.permission === 'denied'){
    showToast('브라우저 설정에서 알림 허용을 다시 켜주세요', true);
    return;
  }
  if(Notification.permission === 'default'){
    const result = await Notification.requestPermission();
    refreshNotifBtn();
    if(result === 'granted') showToast('✓ 알림이 활성화되었습니다');
  }else{
    showToast('이미 알림이 활성화되어 있습니다');
  }
}

function getSentNotifs(){
  try { return JSON.parse(localStorage.getItem(NOTIF_STORAGE_KEY) || '{}'); }
  catch(e){ return {}; }
}
function saveSentNotifs(obj){
  try { localStorage.setItem(NOTIF_STORAGE_KEY, JSON.stringify(obj)); } catch(e){}
}
function todayKey(){
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
}

function fireDeadlineNotifications(tasks){
  if(!('Notification' in window) || Notification.permission !== 'granted') return;
  const today = midnight(new Date());
  const tKey = todayKey();
  const sent = getSentNotifs();

  // 오래된 기록 정리 (오늘 날짜 외 항목 삭제)
  Object.keys(sent).forEach(k => { if(sent[k] !== tKey) delete sent[k]; });

  tasks.forEach(t => {
    if(t['완료']) return;
    const dl = parseDate(t['마감기한']);
    if(!dl) return;
    const diff = Math.floor((dl-today)/86400000);
    if(diff !== 0) return;                  // 당일만 알림
    const key = `${t.row}_${tKey}`;
    if(sent[key]) return;                   // 이미 보냄

    try{
      new Notification('📌 오늘 마감 업무', {
        body: `${t['업무']} · 담당 ${t['담당']||'-'}`,
        tag:  `task-${t.row}`,
        icon: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2.5" fill="%231c1c1e"/></svg>',
      });
      sent[key] = tKey;
    }catch(e){ console.error(e); }
  });

  saveSentNotifs(sent);
}

// ───────── 반복 업무 리스트 (요일별 담당) ─────────
function buildRecurring(tasks){
  RECURRING_TASKS = tasks || [];

  const cntEl = document.getElementById('recurringCount');
  if(RECURRING_TASKS.length > 0){
    cntEl.style.display = 'inline-flex';
    cntEl.textContent = RECURRING_TASKS.length;
  } else {
    cntEl.style.display = 'none';
  }

  const root = document.getElementById('recurringList');
  root.innerHTML = '';
  if(!RECURRING_TASKS.length){
    root.innerHTML = '<div class="empty-state">반복 업무가 없습니다. + 버튼으로 추가하세요.</div>';
    return;
  }

  const todayDay = ['일','월','화','수','목','금','토'][new Date().getDay()];
  const dayKeys = ['월','화','수','목','금','토'];

  RECURRING_TASKS.forEach(task => {
    const row = task['row'];
    const safeName = (task['업무']||'').replace(/'/g,'');

    // 요일 칩 생성 (값이 있는 요일만)
    const chips = dayKeys.map(d => {
      const val = task[d];
      if(!val) return '';
      const isToday = d === todayDay;
      return `<span class="rec-day-chip ${isToday?'rec-day-today':''}">
        <span class="rec-day-label">${d}</span>
        <span class="rec-day-value">${val}</span>
      </span>`;
    }).filter(Boolean).join('');

    const el = document.createElement('div');
    el.className = 'task-item';
    el.dataset.row = row;
    el.innerHTML = `
      <div class="task-body">
        <div class="task-name">${task['업무']}</div>
        <div class="rec-days">${chips || '<span style="font-size:12px;color:var(--faint);">요일별 담당이 비어있어요</span>'}</div>
        ${task['세부사항']?`<div class="task-desc" style="margin-top:6px;">${task['세부사항']}</div>`:''}
      </div>
      <div class="task-actions">
        <button class="task-action-btn" title="수정" onclick="event.stopPropagation();openTaskModal(${row},'recurring')">
          <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="task-action-btn btn-del" title="삭제" onclick="event.stopPropagation();deleteRecurringTaskRow(${row},'${safeName}')">
          <svg viewBox="0 0 24 24"><polyline points="3,6 5,6 21,6"/><path d="M19,6 l-1,14 a2,2 0 0 1 -2,2 H8 a2,2 0 0 1 -2,-2 L5,6"/><path d="M10 11v6M14 11v6"/></svg>
        </button>
      </div>`;
    root.appendChild(el);
  });
}

async function deleteRecurringTaskRow(row, taskName){
  if(!confirm(`'${taskName}'을(를) 삭제하시겠습니까?`)) return;
  RECURRING_TASKS = RECURRING_TASKS
    .filter(t => t.row !== row)
    .map(t => t.row > row ? {...t, row: t.row - 1} : t);
  buildRecurring(RECURRING_TASKS);
  showToast('✓ 반복 업무가 삭제되었습니다');

  try{
    const res = await fetch(`${API_URL}?action=deleteRecurringTask&row=${row}`);
    const json = await res.json();
    if(!json.ok) throw new Error(json.error || 'error');
  }catch(err){
    showToast('⚠ 삭제 실패 — 서버 동기화 중', true);
    loadData(true).catch(()=>{});
  }
}

// ───────── 완료 업무 리스트 ─────────
function toggleCompleted(){
  completedCollapsed = !completedCollapsed;
  const content = document.getElementById('completedContent');
  const btn     = document.getElementById('completedCollapseBtn');
  const label   = document.getElementById('completedCollapseLabel');
  content.classList.toggle('collapsed', completedCollapsed);
  btn.classList.toggle('collapsed', completedCollapsed);
  label.textContent = completedCollapsed ? '펼치기' : '접기';
}

function buildCompleted(tasks){
  COMPLETED_TASKS = (tasks || []).map(t => ({
    업무:     t['업무'] || '',
    담당:     t['담당'] || '',
    마감기한: t['마감기한'] || '',
    세부사항: t['세부사항'] || '',
    완료시각: t['완료시각'] || null,
  })).sort((a,b) => (b.완료시각 || 0) - (a.완료시각 || 0));

  const cntEl = document.getElementById('completedCount');
  if(COMPLETED_TASKS.length > 0){
    cntEl.style.display = 'inline-flex';
    cntEl.textContent = COMPLETED_TASKS.length;
  } else {
    cntEl.style.display = 'none';
  }

  renderCompletedControls();
  renderCompletedList();
}

function getCompletedMemberNames(){
  const set = new Set();
  COMPLETED_TASKS.forEach(t => {
    if(!t.담당) return;
    // 콤마로 구분된 담당자 각각을 칩으로
    String(t.담당).split(',').map(x => x.trim()).filter(Boolean).forEach(n => set.add(n));
  });
  return Array.from(set);
}

function renderCompletedControls(){
  const memberNames = getCompletedMemberNames();
  const memberChips = ['<button class="filter-chip '+(completedFilter.member==='all'?'active':'')+'" onclick="setCompletedFilter(\'member\',\'all\')">전체</button>']
    .concat(memberNames.map(name => {
      const p = PERSON[name];
      const cls = p ? p.cls : 'kkh';
      const short = p ? p.short : (name.length>=2?name.slice(-2):name);
      const active = completedFilter.member === name ? 'active' : '';
      return `<button class="filter-chip ${active}" onclick="setCompletedFilter('member','${encodeURIComponent(name)}')">
        <span class="mini-av av-${cls}">${short}</span>${name}
      </button>`;
    })).join('');

  const periods = [
    {key:'all',    label:'전체'},
    {key:'week',   label:'이번 주'},
    {key:'month',  label:'이번 달'},
    {key:'7days',  label:'최근 7일'},
    {key:'30days', label:'최근 30일'},
  ];
  const periodChips = periods.map(p =>
    `<button class="filter-chip ${completedFilter.period===p.key?'active':''}" onclick="setCompletedFilter('period','${p.key}')">${p.label}</button>`
  ).join('');

  document.getElementById('completedControls').innerHTML = `
    <div class="filter-row">
      <span class="filter-label">담당자</span>
      ${memberChips}
    </div>
    <div class="filter-row">
      <span class="filter-label">기간</span>
      ${periodChips}
    </div>
  `;
}

function setCompletedFilter(type, value){
  if(type === 'member'){
    completedFilter.member = value === 'all' ? 'all' : decodeURIComponent(value);
  } else if(type === 'period'){
    completedFilter.period = value;
  }
  renderCompletedControls();
  renderCompletedList();
}

function getPeriodStart(key){
  const now = new Date();
  const today = midnight(now);
  if(key === 'week')   return getMonday(today);
  if(key === 'month')  return new Date(today.getFullYear(), today.getMonth(), 1);
  if(key === '7days')  return addDays(today, -6);
  if(key === '30days') return addDays(today, -29);
  return null;
}

function fmtDateTime(ts){
  if(!ts) return '-';
  const d = new Date(ts);
  const M = d.getMonth()+1, D = d.getDate();
  const h = String(d.getHours()).padStart(2,'0');
  const m = String(d.getMinutes()).padStart(2,'0');
  return `${M}/${D} ${h}:${m}`;
}

function compareTiming(deadlineStr, completedAt){
  if(!completedAt) return null;
  const dl = parseDate(deadlineStr);
  if(!dl) return null;
  const compDay = midnight(new Date(completedAt));
  const diff = Math.floor((compDay - dl) / 86400000);
  if(diff < 0)  return { type:'early', label:`${Math.abs(diff)}일 빠름`, cls:'timing-early' };
  if(diff === 0) return { type:'ontime', label:'당일 완료', cls:'timing-ontime' };
  return { type:'late', label:`${diff}일 지각`, cls:'timing-late' };
}

function renderCompletedList(){
  const root = document.getElementById('completedList');
  const start = getPeriodStart(completedFilter.period);
  const startTs = start ? start.getTime() : null;

  const filtered = COMPLETED_TASKS.filter(t => {
    if(completedFilter.member !== 'all'){
      // 콤마로 구분된 담당자 중 하나라도 일치하면 통과
      const assignees = String(t.담당 || '').split(',').map(x => x.trim());
      if(!assignees.includes(completedFilter.member)) return false;
    }
    if(startTs !== null){
      if(!t.완료시각) return false;
      if(t.완료시각 < startTs) return false;
    }
    return true;
  });

  if(!filtered.length){
    root.innerHTML = '<div class="empty-state">조건에 맞는 완료 업무가 없습니다.</div>';
    return;
  }

  root.innerHTML = filtered.map(t => {
    const p = PERSON[String(t.담당).trim()];
    const cls = p ? p.cls : 'kkh';
    const short = p ? p.short : (String(t.담당).length>=2 ? String(t.담당).slice(-2) : String(t.담당));
    const timing = compareTiming(t.마감기한, t.완료시각);
    const timingHtml = timing
      ? `<span class="timing-badge ${timing.cls}">${timing.label}</span>`
      : (t.마감기한 ? '' : '<span class="timing-badge timing-none">기한없음</span>');

    return `<div class="completed-item">
      <div class="completed-icon">
        <svg viewBox="0 0 12 12"><polyline points="1.5,6 4.5,9.5 10.5,2.5"/></svg>
      </div>
      <div class="completed-body">
        <div class="completed-top">
          <div class="completed-name">${t.업무}</div>
          <div class="completed-time">완료 ${fmtDateTime(t.완료시각)}</div>
        </div>
        <div class="completed-meta">
          <span><span class="mini-av av-${cls}">${short}</span><strong>${t.담당||'-'}</strong></span>
          <span>기한 · ${t.마감기한||'-'}</span>
          ${timingHtml}
        </div>
        ${t.세부사항?`<div class="completed-desc">${t.세부사항}</div>`:''}
      </div>
    </div>`;
  }).join('');
}

function buildWork(weeks){
  const workRoot  = document.getElementById('workTableWrap');
  const leaveRoot = document.getElementById('leaveList');

  if(!weeks||!weeks.length){
    workRoot.innerHTML='<div class="empty-state">근무일정 시트에 데이터를 입력해주세요.</div>';
    leaveRoot.innerHTML='<div class="empty-state">근무일정에서 자동으로 추출됩니다.</div>';
    return;
  }

  const today      = midnight(new Date());
  const leaveItems = [];
  let html = '';

  weeks.forEach((week, wi)=>{
    const memberNames = Object.keys(week.members);
    const containsToday = DAYS_ALL.some(d=>{
      const obj=parseDate(week.dates[d]);
      return obj&&sameDay(obj,today);
    });
    const dateFilled = DAYS_ALL.map(d=>week.dates[d]).filter(Boolean);
    const weekLabel  = dateFilled.length?`${dateFilled[0]} ~ ${dateFilled[dateFilled.length-1]}`:`${wi+1}주차`;

    html+=`<div class="week-block ${containsToday?'week-current':''}">
      <div class="week-label">${weekLabel}${containsToday?'<span class="now-badge">이번 주</span>':''}</div>
      <div class="work-table-wrap"><table class="work-table">
        <thead><tr>
          <th class="member-col"></th>
          ${DAYS_ALL.map(d=>{
            const ds=week.dates[d]||'';
            const dobj=parseDate(ds);
            const isT=dobj&&sameDay(dobj,today);
            return `<th class="${isT?'today-col':''}">${d}<span class="date-num ${isT?'today-num':''}">${ds}</span></th>`;
          }).join('')}
        </tr></thead>
        <tbody>
          ${memberNames.map(name=>{
            const p=PERSON[name];
            const sched=week.members[name]||{};
            return `<tr>
              <td class="member-col">${p?`<span class="mini-av av-${p.cls}">${p.short}</span>`:''}<span class="member-name">${name}</span></td>
              ${DAYS_ALL.map(d=>{
                const dobj=parseDate(week.dates[d]);
                const isT=dobj&&sameDay(dobj,today);
                const val=sched[d]||'';
                if(val==='연차'||val.includes('반차')){
                  leaveItems.push({name,date:dobj,type:val});
                }
                return `<td class="${isT?'today-cell':''}">${renderVal(val)}</td>`;
              }).join('')}
            </tr>`;
          }).join('')}
        </tbody>
      </table></div>
    </div>`;
  });

  workRoot.innerHTML=html;

  if(!leaveItems.length){
    leaveRoot.innerHTML='<div class="empty-state">등록된 연차·반차가 없습니다.</div>';
    return;
  }
  leaveItems.sort((a,b)=>a.date-b.date);
  leaveRoot.innerHTML='';
  leaveItems.forEach(item=>{
    const p=PERSON[item.name];
    const isPast=item.date&&item.date<today&&!sameDay(item.date,today);
    const daysUntil=item.date?Math.floor((item.date-today)/86400000):null;
    const isSoon=daysUntil!==null&&daysUntil>=0&&daysUntil<=7;
    const typeCls=item.type.includes('반차')?'type-반차':'type-연차';
    leaveRoot.innerHTML+=`<div class="leave-item ${isPast?'leave-past':isSoon?'leave-soon':''}">
      ${p?`<div class="leave-av av-${p.cls}">${p.short}</div>`
        :`<div class="leave-av" style="background:#f0ede8;color:var(--sub)">${String(item.name).slice(0,1)}</div>`}
      <div class="leave-body">
        <div>
          <span class="leave-who">${item.name}</span>
          <span class="leave-type-badge ${typeCls}">${item.type}</span>
          ${isSoon&&!isPast?`<span class="soon-badge">${daysUntil===0?'오늘':daysUntil+'일 후'}</span>`:''}
        </div>
        <div>
          <div class="leave-date">${item.date?fmt(item.date):''}</div>
        </div>
      </div>
    </div>`;
  });
}

// ───────── 다크 모드 ─────────
// 페이지 로드 직후 <head>의 인라인 스크립트가 이미 data-theme을 세팅함.
// 여기는 토글과 시스템 테마 변경 감지만 담당.
function toggleTheme(){
  const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const next = cur === 'dark' ? 'light' : 'dark';
  if(next === 'dark') document.documentElement.setAttribute('data-theme','dark');
  else                document.documentElement.removeAttribute('data-theme');
  try{ localStorage.setItem('fox_theme', next); }catch(e){}
  showToast(next === 'dark' ? '🌙 다크 모드' : '☀ 라이트 모드');
}

// 시스템 테마 변경 추적 — 사용자가 명시 설정 안 한 경우에만 따라감
if(window.matchMedia){
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = e => {
    if(localStorage.getItem('fox_theme')) return;  // 명시 저장 있으면 무시
    if(e.matches) document.documentElement.setAttribute('data-theme','dark');
    else          document.documentElement.removeAttribute('data-theme');
  };
  if(mq.addEventListener) mq.addEventListener('change', handler);
  else mq.addListener(handler);  // older browsers
}

// ───── 초기화 ─────
refreshNotifBtn();
loadData(true).then(() => { startPolling(); });
