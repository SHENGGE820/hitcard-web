// ========== TEACHER ADMIN JS ==========
const DB = FIREBASE_CONFIG.databaseURL;

// ===== Firebase helpers =====
async function fbGet(path) {
    const r = await fetch(`${DB}/${path}.json`);
    if (!r.ok) throw new Error(`GET ${path} failed ${r.status}`);
    return r.json();
}
async function fbPut(path, data) {
    const r = await fetch(`${DB}/${path}.json`, {
        method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data)
    });
    if (!r.ok) throw new Error(`PUT ${path} failed ${r.status}`);
    return r.json();
}
async function fbPatch(path, data) {
    const r = await fetch(`${DB}/${path}.json`, {
        method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data)
    });
    if (!r.ok) throw new Error(`PATCH ${path} failed ${r.status}`);
    return r.json();
}
async function fbDelete(path) {
    const r = await fetch(`${DB}/${path}.json`, { method: 'DELETE' });
    if (!r.ok) throw new Error(`DELETE ${path} failed ${r.status}`);
}
async function sha256(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg; el.style.display = 'block';
    clearTimeout(el._t); el._t = setTimeout(()=>el.style.display='none', 3000);
}

// ===== Auth =====
async function initAuth() {
    const pinHash = await fbGet('teacher_config/pin_hash').catch(()=>null);
    if (!pinHash) {
        document.getElementById('login-desc').textContent = '第一次使用，請設定教師密碼';
        document.getElementById('first-time-hint').style.display = 'block';
    }
}
async function doLogin() {
    const pin = document.getElementById('pin-input').value;
    const errEl = document.getElementById('login-error');
    if (!pin || pin.length < 4) { errEl.textContent = '密碼至少 4 個字元'; return; }
    errEl.textContent = '';
    const hash = await sha256(pin);
    try {
        const stored = await fbGet('teacher_config/pin_hash').catch(()=>null);
        if (!stored) {
            await fbPut('teacher_config/pin_hash', hash);
            sessionStorage.setItem('teacher_auth', hash);
            enterApp();
        } else if (hash === stored) {
            sessionStorage.setItem('teacher_auth', hash);
            enterApp();
        } else {
            errEl.textContent = '密碼錯誤';
        }
    } catch(e) { errEl.textContent = '連線失敗，請稍後再試'; }
}
function enterApp() {
    document.getElementById('login-overlay').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    document.getElementById('app').style.flexDirection = 'column';
    loadTodayT();
}
function logout() {
    sessionStorage.removeItem('teacher_auth');
    location.reload();
}
function openChangePinModal() {
    document.getElementById('cp-old').value = '';
    document.getElementById('cp-new').value = '';
    document.getElementById('cp-confirm').value = '';
    document.getElementById('cp-err').textContent = '';
    document.getElementById('change-pin-overlay').style.display = 'flex';
    setTimeout(()=>document.getElementById('cp-old').focus(), 100);
}
function closeChangePinModal() {
    document.getElementById('change-pin-overlay').style.display = 'none';
}
async function changePin() {
    const errEl = document.getElementById('cp-err');
    const oldVal = document.getElementById('cp-old').value;
    const newVal = document.getElementById('cp-new').value;
    const confirmVal = document.getElementById('cp-confirm').value;
    errEl.textContent = '';
    if (!oldVal) { errEl.textContent = '請輸入現有密碼'; return; }
    if (!newVal || newVal.length < 4) { errEl.textContent = '新密碼至少 4 個字元'; return; }
    if (newVal !== confirmVal) { errEl.textContent = '兩次新密碼不一致'; return; }
    try {
        const oldHash = await sha256(oldVal);
        const stored = await fbGet('teacher_config/pin_hash').catch(()=>null);
        if (oldHash !== stored) { errEl.textContent = '現有密碼錯誤'; return; }
        const newHash = await sha256(newVal);
        await fbPut('teacher_config/pin_hash', newHash);
        sessionStorage.setItem('teacher_auth', newHash);
        closeChangePinModal();
        showToast('密碼已更新');
    } catch(e) { errEl.textContent = '更新失敗：' + e.message; }
}

// ===== Tabs =====
function switchTab(id, btn) {
    document.querySelectorAll('.tab-content').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.nav-tab').forEach(b=>b.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    btn.classList.add('active');
}

// ===== 載入上課日（全域）=====
let classDatesSet = new Set();
async function loadClassDates() {
    try {
        const fbData = await fbGet('class_schedule').catch(()=>null);
        if (fbData?.class_dates?.length > 0) {
            classDatesSet = new Set(fbData.class_dates);
            return;
        }
        // fallback to JSON file
        const r = await fetch('./class_schedule.json');
        if (r.ok) {
            const d = await r.json();
            classDatesSet = new Set(d.class_dates || []);
        }
    } catch(e) { classDatesSet = new Set(); }
}

// ===== 今日出席 =====
async function loadTodayT() {
    const date = document.getElementById('t-date').value;
    if (!date) return;
    document.getElementById('today-tbody').innerHTML = '<tr><td colspan="6" class="loading-msg">載入中...</td></tr>';
    try {
        const [studentsData, attendanceData] = await Promise.all([
            fbGet('students'),
            fbGet('attendance')
        ]);
        const students = [];
        if (studentsData) {
            for (const [uid, d] of Object.entries(studentsData)) {
                if (uid.startsWith('-') || !d?.name) continue;
                students.push({card_uid: uid, ...d});
            }
        }
        students.sort((a,b)=>(a.name||'').localeCompare(b.name||''));

        const allAtt = attendanceData ? Object.values(attendanceData) : [];
        const dayRecs = allAtt.filter(r => r.date === date);

        let present=0, absent=0, checkOut=0;
        let html = '';
        for (const stu of students) {
            const recs = dayRecs.filter(r => r.card_uid?.toUpperCase() === stu.card_uid?.toUpperCase());
            const inRec  = recs.find(r=>r.check_type==='check_in');
            const outRec = recs.find(r=>r.check_type==='check_out');
            const inTime  = inRec?.check_time?.split(' ')[1]?.slice(0,5) || '--';
            const outTime = outRec?.check_time?.split(' ')[1]?.slice(0,5) || '--';
            let badge;
            if (inRec && outRec) { badge=`<span class="badge badge-green">✓ 出席</span>`; present++; checkOut++; }
            else if (inRec)      { badge=`<span class="badge badge-blue">→ 上課中</span>`; present++; }
            else                 { badge=`<span class="badge badge-red">✗ 未到</span>`; absent++; }
            html += `<tr>
                <td>${stu.name}</td><td>${stu.class_name||'--'}</td><td>${stu.student_id||'--'}</td>
                <td>${inTime}</td><td>${outTime}</td><td>${badge}</td>
            </tr>`;
        }
        document.getElementById('today-tbody').innerHTML = html || '<tr><td colspan="6" class="empty-msg">無資料</td></tr>';
        document.getElementById('ts-total').textContent  = students.length;
        document.getElementById('ts-in').textContent     = present;
        document.getElementById('ts-absent').textContent = absent;
        document.getElementById('ts-out').textContent    = checkOut;
    } catch(e) {
        document.getElementById('today-tbody').innerHTML = `<tr><td colspan="6" style="color:var(--red);text-align:center;padding:24px">${e.message}</td></tr>`;
    }
}

// ===== 月統計 =====
async function loadMonthlyT() {
    const monthStr = document.getElementById('m-month').value;
    if (!monthStr) return;
    const container = document.getElementById('monthly-container');
    container.innerHTML = '<div class="loading-msg" style="grid-column:1/-1">載入中...</div>';
    try {
        await loadClassDates();
        const [studentsData, attendanceData] = await Promise.all([
            fbGet('students'),
            fbGet('attendance')
        ]);
        const students = [];
        if (studentsData) {
            for (const [uid,d] of Object.entries(studentsData)) {
                if (uid.startsWith('-')||!d?.name) continue;
                students.push({card_uid:uid,...d});
            }
        }
        students.sort((a,b)=>(a.name||'').localeCompare(b.name||''));
        const [y,m] = monthStr.split('-').map(Number);
        const daysInMonth = new Date(y,m,0).getDate();
        const start = `${monthStr}-01`, end = `${monthStr}-${String(daysInMonth).padStart(2,'0')}`;
        const today = new Date().toISOString().split('T')[0];
        const allAtt = attendanceData ? Object.values(attendanceData).filter(r=>r.date>=start&&r.date<=end) : [];

        let html = '';
        for (const stu of students) {
            const recs = allAtt.filter(r=>r.card_uid?.toUpperCase()===stu.card_uid?.toUpperCase());
            const dateMap = {};
            for (const r of recs) {
                if (!dateMap[r.date]) dateMap[r.date]={in:false,out:false};
                if (r.check_type==='check_in')  dateMap[r.date].in=true;
                if (r.check_type==='check_out') dateMap[r.date].out=true;
            }
            let present=0, absent=0, total=0;
            let badges='';
            for (let d=1;d<=daysInMonth;d++) {
                const ds = `${monthStr}-${String(d).padStart(2,'0')}`;
                const isSchool = classDatesSet.size>0 ? classDatesSet.has(ds) : new Date(ds+'T00:00:00').getDay()!==0;
                if (!isSchool || ds>today) continue;
                total++;
                const v = dateMap[ds];
                if (v?.in&&v?.out) { present++; badges+=`<span style="display:inline-block;padding:3px 7px;background:#064e3b;color:#6ee7b7;border-radius:5px;font-size:12px;margin:2px">${d}✓</span>`; }
                else               { absent++;  badges+=`<span style="display:inline-block;padding:3px 7px;background:#450a0a;color:#fca5a5;border-radius:5px;font-size:12px;margin:2px">${d}✗</span>`; }
            }
            const rate = total>0 ? ((present/total)*100).toFixed(1) : '0';
            html += `<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:18px">
                <div style="font-size:16px;font-weight:700;margin-bottom:4px">${stu.name}</div>
                <div style="font-size:12px;color:var(--muted);margin-bottom:12px">${stu.class_name||''} ${stu.student_id?'· '+stu.student_id:''}</div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin-bottom:12px">
                    <div style="text-align:center"><div style="font-size:20px;font-weight:700;color:var(--blue)">${total}</div><div style="font-size:11px;color:var(--muted)">應上課</div></div>
                    <div style="text-align:center"><div style="font-size:20px;font-weight:700;color:var(--green)">${present}</div><div style="font-size:11px;color:var(--muted)">出席</div></div>
                    <div style="text-align:center"><div style="font-size:20px;font-weight:700;color:var(--red)">${absent}</div><div style="font-size:11px;color:var(--muted)">缺席</div></div>
                    <div style="text-align:center"><div style="font-size:20px;font-weight:700;color:var(--yellow)">${rate}%</div><div style="font-size:11px;color:var(--muted)">出席率</div></div>
                </div>
                <div style="font-size:12px;color:var(--muted);margin-bottom:6px">各日考勤</div>
                <div style="display:flex;flex-wrap:wrap;gap:3px">${badges||'<span style="color:var(--muted);font-size:12px">無記錄</span>'}</div>
            </div>`;
        }
        container.innerHTML = html || '<div class="empty-msg" style="grid-column:1/-1">該月份無學生資料</div>';
    } catch(e) {
        container.innerHTML = `<div style="color:var(--red);padding:24px;grid-column:1/-1">${e.message}</div>`;
    }
}

// ===== 學生管理 =====
let allStudentsList = [];
let editingUid = null;

async function loadStudentMgmt() {
    document.getElementById('student-tbody').innerHTML = '<tr><td colspan="5" class="loading-msg">載入中...</td></tr>';
    try {
        const data = await fbGet('students');
        allStudentsList = [];
        if (data) {
            for (const [uid,d] of Object.entries(data)) {
                if (uid.startsWith('-')||!d||typeof d!=='object') continue;
                allStudentsList.push({card_uid:uid, name:d.name||'', student_id:d.student_id||'', class_name:d.class_name||''});
            }
        }
        allStudentsList.sort((a,b)=>a.name.localeCompare(b.name));
        filterStudents();
    } catch(e) {
        document.getElementById('student-tbody').innerHTML = `<tr><td colspan="5" style="color:var(--red);text-align:center;padding:24px">${e.message}</td></tr>`;
    }
}
function filterStudents() {
    const q = document.getElementById('student-search').value.trim().toLowerCase();
    const list = q ? allStudentsList.filter(s=>
        s.name.toLowerCase().includes(q) || s.card_uid.toLowerCase().includes(q) || s.student_id.toLowerCase().includes(q)
    ) : allStudentsList;
    if (!list.length) {
        document.getElementById('student-tbody').innerHTML = '<tr><td colspan="5" class="empty-msg">沒有符合的學生</td></tr>';
        return;
    }
    document.getElementById('student-tbody').innerHTML = list.map(s=>`
        <tr>
            <td><strong>${s.name}</strong></td>
            <td style="font-family:monospace;color:var(--muted)">${s.card_uid}</td>
            <td>${s.student_id||'--'}</td>
            <td>${s.class_name||'--'}</td>
            <td>
                <button class="btn btn-ghost btn-sm" onclick='openStudentModal(${JSON.stringify(s)})'>✏️ 編輯</button>
                <button class="btn btn-yellow btn-sm" style="margin-left:6px" onclick='notifyLate("${s.card_uid}","${s.name}")'>⏰ 遲到提醒</button>
                <button class="btn btn-red btn-sm" style="margin-left:6px" onclick='askDelete("${s.card_uid}","${s.name}")'>🗑️ 刪除</button>
            </td>
        </tr>
    `).join('');
}
function openStudentModal(student=null) {
    editingUid = student?.card_uid || null;
    document.getElementById('modal-title').textContent = student ? '編輯學生' : '新增學生';
    document.getElementById('f-carduid').value = student?.card_uid || '';
    document.getElementById('f-carduid').readOnly = !!student;
    document.getElementById('f-carduid').style.opacity = student ? '.5' : '1';
    document.getElementById('f-name').value   = student?.name || '';
    document.getElementById('f-sid').value    = student?.student_id || '';
    document.getElementById('f-class').value  = student?.class_name || '';
    document.getElementById('student-modal').classList.add('open');
    document.getElementById('f-name').focus();
}
function closeStudentModal() { document.getElementById('student-modal').classList.remove('open'); }
async function notifyLate(cardUid, studentName) {
    try {
        const response = await fetch('/hitcard-web/api/remind_late', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ card_uid: cardUid.toUpperCase(), name: studentName })
        });
        const result = await response.json();
        if (result.success) {
            showToast(`✅ 已通知 ${studentName} 遲到`);
        } else {
            showToast(`❌ 通知失敗: ${result.error || '未知錯誤'}`);
        }
    } catch(e) {
        showToast(`❌ 通知出錯: ${e.message}`);
    }
}
async function saveStudent() {
    const uid   = document.getElementById('f-carduid').value.trim().toUpperCase();
    const name  = document.getElementById('f-name').value.trim();
    const sid   = document.getElementById('f-sid').value.trim();
    const cls   = document.getElementById('f-class').value.trim();
    if (!uid)  { showToast('請輸入卡號 UID'); return; }
    if (!name) { showToast('請輸入姓名'); return; }
    try {
        const existing = await fbGet(`students/${uid}`).catch(()=>null);
        const payload = { name, student_id:sid, class_name:cls };
        if (!existing) payload.created_at = new Date().toISOString();
        await fbPatch(`students/${uid}`, payload);
        showToast(editingUid ? '✅ 學生資料已更新' : '✅ 學生已新增');
        closeStudentModal();
        loadStudentMgmt();
    } catch(e) { showToast('❌ 儲存失敗：'+e.message); }
}
let deleteUid = null;
function askDelete(uid, name) {
    deleteUid = uid;
    document.getElementById('del-msg').textContent = `確定要刪除學生「${name}」（卡號：${uid}）嗎？此操作無法復原。`;
    document.getElementById('del-modal').classList.add('open');
}
function closeDelModal() { document.getElementById('del-modal').classList.remove('open'); deleteUid=null; }
async function confirmDelete() {
    if (!deleteUid) return;
    try {
        await fbDelete(`students/${deleteUid}`);
        showToast('✅ 學生已刪除');
        closeDelModal();
        loadStudentMgmt();
    } catch(e) { showToast('❌ 刪除失敗：'+e.message); }
}

// ===== 上課日管理 =====
let schedYear, schedMonth;
let editingDates = new Set();

async function loadScheduleMgmt() {
    const now = new Date();
    schedYear = now.getFullYear(); schedMonth = now.getMonth()+1;
    await reloadScheduleDates();
    renderScheduleCal();
}
async function reloadScheduleDates() {
    await loadClassDates();
    editingDates = new Set(classDatesSet);
}
function scheduleMonth(delta) {
    schedMonth += delta;
    if (schedMonth < 1) { schedMonth=12; schedYear--; }
    if (schedMonth > 12) { schedMonth=1; schedYear++; }
    renderScheduleCal();
}
function renderScheduleCal() {
    const title = `${schedYear}年${schedMonth}月`;
    document.getElementById('schedule-title').textContent = title;
    const daysInMonth = new Date(schedYear, schedMonth, 0).getDate();
    const firstDay = new Date(schedYear, schedMonth-1, 1).getDay();
    const today = new Date().toISOString().split('T')[0];
    const weekLabels = ['日','一','二','三','四','五','六'];
    let html = weekLabels.map(w=>`<div class="cal-header">${w}</div>`).join('');
    for (let i=0;i<firstDay;i++) html+='<div class="cal-day empty"></div>';
    for (let d=1;d<=daysInMonth;d++) {
        const ds = `${schedYear}-${String(schedMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const dow = new Date(ds+'T00:00:00').getDay();
        const isPast = ds < today;
        let cls;
        if (editingDates.has(ds)) cls='school';
        else if (dow===0||dow===6) cls='weekend';
        else if (isPast) cls='past';
        else cls='normal';
        const onclick = (cls==='school'||cls==='normal') ? `onclick="toggleDate('${ds}')"` : '';
        html+=`<div class="cal-day ${cls}" ${onclick}>${d}</div>`;
    }
    document.getElementById('schedule-cal').innerHTML = html;
    document.getElementById('school-count').textContent = editingDates.size;
}
function toggleDate(ds) {
    if (editingDates.has(ds)) editingDates.delete(ds);
    else editingDates.add(ds);
    renderScheduleCal();
}
async function saveSchedule() {
    const statusEl = document.getElementById('save-status');
    statusEl.textContent = '儲存中...';
    statusEl.style.color = 'var(--muted)';
    const sorted = [...editingDates].sort();
    try {
        await fbPut('class_schedule', {
            class_dates: sorted,
            total_days: sorted.length,
            updated_at: new Date().toISOString()
        });
        classDatesSet = new Set(sorted);
        statusEl.textContent = `✅ 已儲存（${sorted.length} 個上課日）`;
        statusEl.style.color = 'var(--green)';
        showToast('✅ 上課日已更新到 Firebase');
    } catch(e) {
        statusEl.textContent = '❌ 儲存失敗：'+e.message;
        statusEl.style.color = 'var(--red)';
    }
}

// ===== 請假管理 =====
let allLeaves = [];
async function loadTeacherLeaveT() {
    document.getElementById('lv-tbody').innerHTML = '<tr><td colspan="5" class="loading-msg">載入中...</td></tr>';
    const now = new Date();
    document.getElementById('lv-month').value = now.toISOString().slice(0,7);
    try {
        const data = await fbGet('students');
        allLeaves = [];
        if (data) {
            for (const [uid,stu] of Object.entries(data)) {
                if (uid.startsWith('-')||!stu||!stu.leave_requests) continue;
                for (const lv of Object.values(stu.leave_requests)) {
                    if (!lv||typeof lv!=='object') continue;
                    allLeaves.push({ name:stu.name||'?', class_name:stu.class_name||'', date:lv.date||'', reason:lv.reason||'', submitted_at:lv.submitted_at||'' });
                }
            }
        }
        allLeaves.sort((a,b)=>b.date.localeCompare(a.date));
        const sel = document.getElementById('lv-stu');
        const cur = sel.value;
        sel.innerHTML = '<option value="">全部</option>';
        [...new Set(allLeaves.map(l=>l.name))].sort().forEach(n=>{
            sel.innerHTML += `<option value="${n}">${n}</option>`;
        });
        sel.value = cur;
        renderLeaveT();
    } catch(e) {
        document.getElementById('lv-tbody').innerHTML = `<tr><td colspan="5" style="color:var(--red);text-align:center;padding:24px">${e.message}</td></tr>`;
    }
}
function renderLeaveT() {
    const fs = document.getElementById('lv-stu').value;
    const fm = document.getElementById('lv-month').value;
    let list = allLeaves;
    if (fs) list = list.filter(l=>l.name===fs);
    if (fm) list = list.filter(l=>l.date.startsWith(fm));
    document.getElementById('lv-summary').textContent = `共 ${list.length} 筆`;
    document.getElementById('lv-tbody').innerHTML = list.length ? list.map(l=>{
        const dt = l.submitted_at ? new Date(l.submitted_at).toLocaleString('zh-TW',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '--';
        return `<tr><td>${l.name}</td><td>${l.class_name}</td><td>${l.date}</td><td>${l.reason}</td><td>${dt}</td></tr>`;
    }).join('') : '<tr><td colspan="5" class="empty-msg">無符合記錄</td></tr>';
}

// ===== 作業管理 =====
let allHomeworks = [];
async function loadTeacherHomeworkT() {
    document.getElementById('hw-tbody').innerHTML = '<tr><td colspan="5" class="loading-msg">載入中...</td></tr>';
    try {
        const data = await fbGet('students');
        allHomeworks = [];
        if (data) {
            for (const [uid,stu] of Object.entries(data)) {
                if (uid.startsWith('-')||!stu||!stu.homeworks) continue;
                for (const hw of Object.values(stu.homeworks)) {
                    if (!hw||typeof hw!=='object') continue;
                    allHomeworks.push({ name:stu.name||'?', class_name:stu.class_name||'', title:hw.title||'', link:hw.link||'', submitted_at:hw.submitted_at||'' });
                }
            }
        }
        allHomeworks.sort((a,b)=>b.submitted_at.localeCompare(a.submitted_at));
        const sel = document.getElementById('hw-stu');
        const cur = sel.value;
        sel.innerHTML = '<option value="">全部</option>';
        [...new Set(allHomeworks.map(h=>h.name))].sort().forEach(n=>{
            sel.innerHTML += `<option value="${n}">${n}</option>`;
        });
        sel.value = cur;
        renderHomeworkT();
    } catch(e) {
        document.getElementById('hw-tbody').innerHTML = `<tr><td colspan="5" style="color:var(--red);text-align:center;padding:24px">${e.message}</td></tr>`;
    }
}
function renderHomeworkT() {
    const fs = document.getElementById('hw-stu').value;
    const fk = document.getElementById('hw-kw').value.trim().toLowerCase();
    let list = allHomeworks;
    if (fs) list = list.filter(h=>h.name===fs);
    if (fk) list = list.filter(h=>h.title.toLowerCase().includes(fk));
    document.getElementById('hw-summary').textContent = `共 ${list.length} 筆`;
    document.getElementById('hw-tbody').innerHTML = list.length ? list.map(h=>{
        const dt = h.submitted_at ? new Date(h.submitted_at).toLocaleString('zh-TW',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '--';
        return `<tr><td>${h.name}</td><td>${h.class_name}</td><td>${h.title}</td><td>${dt}</td>
            <td>${h.link?`<a href="${h.link}" target="_blank" style="color:#60a5fa">🔗 開啟</a>`:'--'}</td></tr>`;
    }).join('') : '<tr><td colspan="5" class="empty-msg">無符合記錄</td></tr>';
}

// ===== INIT =====
(function init() {
    // 設定預設日期（無論是否已登入都要設）
    document.getElementById('t-date').valueAsDate = new Date();
    document.getElementById('m-month').value = new Date().toISOString().slice(0,7);
    document.getElementById('pin-input').addEventListener('keypress', e=>{ if(e.key==='Enter') doLogin(); });

    if (sessionStorage.getItem('teacher_auth')) {
        enterApp(); return;
    }
    initAuth();
})();
