// ========== TEACHER ADMIN JS ==========
const DB = FIREBASE_CONFIG.databaseURL;

async function forceDownload(url, filename) {
    try {
        const res = await fetch(url);
        const blob = await res.blob();
        const forcedBlob = new Blob([blob], { type: 'application/octet-stream' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(forcedBlob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
    } catch(e) {
        window.open(url, '_blank');
    }
}

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
            const inTime  = inRec  ? (inRec.check_time.includes(' ')  ? inRec.check_time.split(' ')[1].slice(0,5)  : inRec.check_time.slice(0,5))  : '--';
            const outTime = outRec ? (outRec.check_time.includes(' ') ? outRec.check_time.split(' ')[1].slice(0,5) : outRec.check_time.slice(0,5)) : '--';
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
        const response = await fetch('https://web-production-a3f18.up.railway.app/api/remind_late', {
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
        let cls;
        if (editingDates.has(ds)) cls='school';
        else if (dow===0||dow===6) cls='weekend';
        else cls='normal';
        const onclick = `onclick="toggleDate('${ds}')"`;
        html+=`<div class="cal-day ${cls}" ${onclick}>${d}</div>`;
    }
    document.getElementById('schedule-cal').innerHTML = html;
    const monthPrefix = `${schedYear}-${String(schedMonth).padStart(2,'0')}-`;
    const monthCount = [...editingDates].filter(d => d.startsWith(monthPrefix)).length;
    document.getElementById('school-count').textContent = monthCount;
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
let lvDateCounts = {}; // { 'YYYY-MM-DD': count }
async function loadTeacherLeaveT() {
    document.getElementById('lv-tbody').innerHTML = '<tr><td colspan="5" class="loading-msg">載入中...</td></tr>';
    const now = new Date();
    if (!lvDpYear) {
        lvDpYear = now.getFullYear(); lvDpMonth = now.getMonth()+1;
        lvDpSelected = now.toISOString().split('T')[0];
    }
    renderLvDatePickerCal();
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
        // 計算每天請假人數（全不篩選，供月曆標注用）
        lvDateCounts = {};
        allLeaves.forEach(l => { if (l.date) lvDateCounts[l.date] = (lvDateCounts[l.date]||0)+1; });
        const sel = document.getElementById('lv-stu');
        const cur = sel.value;
        sel.innerHTML = '<option value="">全部</option>';
        [...new Set(allLeaves.map(l=>l.name))].sort().forEach(n=>{
            sel.innerHTML += `<option value="${n}">${n}</option>`;
        });
        sel.value = cur;
        renderLvDatePickerCal(); // 資料載入後重新畫月曆（帶請假人數標注）
        renderLeaveT();
    } catch(e) {
        document.getElementById('lv-tbody').innerHTML = `<tr><td colspan="5" style="color:var(--red);text-align:center;padding:24px">${e.message}</td></tr>`;
    }
}
function renderLeaveT() {
    const fs = document.getElementById('lv-stu').value;
    let list = allLeaves;
    if (fs) list = list.filter(l=>l.name===fs);
    if (lvDpSelected) list = list.filter(l=>l.date===lvDpSelected);
    document.getElementById('lv-summary').textContent = `共 ${list.length} 筆`;
    document.getElementById('lv-tbody').innerHTML = list.length ? list.map(l=>{
        const dt = l.submitted_at ? new Date(l.submitted_at).toLocaleString('zh-TW',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '--';
        return `<tr><td>${l.name}</td><td>${l.class_name}</td><td>${l.date}</td><td>${l.reason}</td><td>${dt}</td></tr>`;
    }).join('') : '<tr><td colspan="5" class="empty-msg">無符合記錄</td></tr>';
}

// ===== 作業管理 =====
let allHomeworks = [];
async function loadTeacherHomeworkT() {
    renderHwDatePickerCal(); // 同步最新上課日色彩
    const dateInput = hwDpSelected;
    
    if (!dateInput) {
        document.getElementById('hw-tbody').innerHTML = '<tr><td colspan="7" class="empty-msg">請選擇日期</td></tr>';
        return;
    }

    document.getElementById('hw-tbody').innerHTML = '<tr><td colspan="7" class="loading-msg">載入中...</td></tr>';
    try {
        const [studentsData, allHomeworks] = await Promise.all([
            fbGet('students'),
            fbGet('students')
        ]);

        // 構建學生列表
        const students = [];
        const homeworkMap = {}; // { cardUid -> [hw文件列表] }
        
        if (studentsData) {
            for (const [uid, stu] of Object.entries(studentsData)) {
                if (uid.startsWith('-') || !stu?.name) continue;
                students.push({
                    card_uid: uid,
                    name: stu.name || '?',
                    class_name: stu.class_name || '?',
                    student_id: stu.student_id || '?'
                });

                // 整理該學生的作業
                if (stu.homeworks && typeof stu.homeworks === 'object') {
                    homeworkMap[uid] = [];
                    for (const [hwKey, hw] of Object.entries(stu.homeworks)) {
                        if (!hw || typeof hw !== 'object') continue;
                        if (hw.date === dateInput) {
                            homeworkMap[uid].push(hw);
                        }
                    }
                }
            }
        }

        students.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        // 統計
        const submitted = students.filter(s => homeworkMap[s.card_uid]?.length > 0).length;
        const notSubmitted = students.length - submitted;
        
        document.getElementById('hw-summary').textContent = 
            `日期: ${dateInput} | 共 ${students.length} 人 | 已繳 ${submitted} | 未繳 ${notSubmitted}`;

        // 列表
        let html = '';
        for (const stu of students) {
            const hws = homeworkMap[stu.card_uid] || [];
            const status = hws.length > 0 ? '✅ 已交' : '❌ 未交';
            const statusBadge = hws.length > 0 
                ? '<span class="badge badge-green">✅ 已交</span>'
                : '<span class="badge badge-red">❌ 未交</span>';
            
            if (hws.length > 0) {
                // 有繳交作業，按行顯示
                for (const hw of hws) {
                    const filename = hw.filename || '(無名檔案)';
                    const submitTime = hw.submitted_at ? new Date(hw.submitted_at).toLocaleString('zh-TW', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '--';
                    const dlBtn = hw.downloadUrl 
                        ? `<a href="javascript:void(0)" onclick="forceDownload('${hw.downloadUrl}', '${filename.replace(/'/g, '')}')" class="btn btn-sm btn-blue">⬇️ 下載</a>`
                        : '';
                    html += `<tr>
                        <td>${stu.name}</td>
                        <td>${stu.class_name}</td>
                        <td>${stu.card_uid}</td>
                        <td>${statusBadge}</td>
                        <td>${filename}</td>
                        <td>${submitTime}</td>
                        <td>${dlBtn}</td>
                    </tr>`;
                }
            } else {
                // 未繳交
                html += `<tr>
                    <td>${stu.name}</td>
                    <td>${stu.class_name}</td>
                    <td>${stu.card_uid}</td>
                    <td>${statusBadge}</td>
                    <td>-</td>
                    <td>-</td>
                    <td>-</td>
                </tr>`;
            }
        }

        document.getElementById('hw-tbody').innerHTML = html || '<tr><td colspan="7" class="empty-msg">無學生</td></tr>';
    } catch(e) {
        document.getElementById('hw-tbody').innerHTML = `<tr><td colspan="7" style="color:var(--red);text-align:center;padding:24px">${e.message}</td></tr>`;
    }
}

// ===== 日期選擇器 =====
let dpYear, dpMonth, dpSelected;

function renderDatePickerCal() {
    const title = `${dpYear}年${dpMonth}月`;
    document.getElementById('date-picker-title').textContent = title;
    const daysInMonth = new Date(dpYear, dpMonth, 0).getDate();
    const firstDay = new Date(dpYear, dpMonth-1, 1).getDay();
    const todayStr = new Date().toISOString().split('T')[0];
    const weekLabels = ['日','一','二','三','四','五','六'];
    let html = weekLabels.map(w=>`<div class="cal-header">${w}</div>`).join('');
    for (let i=0;i<firstDay;i++) html+='<div class="cal-day empty"></div>';
    for (let d=1;d<=daysInMonth;d++) {
        const ds = `${dpYear}-${String(dpMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const dow = new Date(ds+'T00:00:00').getDay();
        let cls;
        if (classDatesSet.has(ds)) cls = 'school';
        else if (dow===0||dow===6) cls = 'weekend';
        else cls = 'normal';
        if (ds === dpSelected) cls += ' dp-sel';
        if (ds === todayStr) cls += ' dp-today';
        html += `<div class="cal-day ${cls}" onclick="datePickerSelect('${ds}')">${d}</div>`;
    }
    document.getElementById('date-picker-cal').innerHTML = html;
}
function datePickerMonth(delta) {
    dpMonth += delta;
    if (dpMonth < 1) { dpMonth = 12; dpYear--; }
    if (dpMonth > 12) { dpMonth = 1; dpYear++; }
    renderDatePickerCal();
}
function datePickerSelect(ds) {
    dpSelected = ds;
    document.getElementById('t-date').value = ds;
    const [y,m,d] = ds.split('-');
    document.getElementById('date-picker-selected').textContent = `${y}年${parseInt(m)}月${parseInt(d)}日`;
    renderDatePickerCal();
    loadTodayT();
}
function datePickerSetToday() {
    const today = new Date();
    dpYear = today.getFullYear(); dpMonth = today.getMonth()+1;
    datePickerSelect(today.toISOString().split('T')[0]);
}

// ===== 請假 日期選擇器 =====
let lvDpYear, lvDpMonth, lvDpSelected;

function renderLvDatePickerCal() {
    const title = `${lvDpYear}年${lvDpMonth}月`;
    document.getElementById('lv-dp-title').textContent = title;
    const daysInMonth = new Date(lvDpYear, lvDpMonth, 0).getDate();
    const firstDay = new Date(lvDpYear, lvDpMonth-1, 1).getDay();
    const todayStr = new Date().toISOString().split('T')[0];
    const weekLabels = ['日','一','二','三','四','五','六'];
    let html = weekLabels.map(w=>`<div class="cal-header">${w}</div>`).join('');
    for (let i=0;i<firstDay;i++) html+='<div class="cal-day empty"></div>';
    for (let d=1;d<=daysInMonth;d++) {
        const ds = `${lvDpYear}-${String(lvDpMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const dow = new Date(ds+'T00:00:00').getDay();
        let cls;
        if (classDatesSet.has(ds)) cls = 'school';
        else if (dow===0||dow===6) cls = 'weekend';
        else cls = 'normal';
        if (ds === lvDpSelected) cls += ' dp-sel';
        if (ds === todayStr) cls += ' dp-today';
        const leaveCount = lvDateCounts[ds] || 0;
        const countHtml = leaveCount > 0 ? `<span class="cal-day-count">${leaveCount}人請假</span>` : '';
        html += `<div class="cal-day ${cls}" onclick="lvDatePickerSelect('${ds}')">${d}${countHtml}</div>`;
    }
    document.getElementById('lv-dp-cal').innerHTML = html;
}
function lvDatePickerMonth(delta) {
    lvDpMonth += delta;
    if (lvDpMonth < 1) { lvDpMonth = 12; lvDpYear--; }
    if (lvDpMonth > 12) { lvDpMonth = 1; lvDpYear++; }
    renderLvDatePickerCal();
}
function lvDatePickerSelect(ds) {
    lvDpSelected = ds;
    const [y,m,d] = ds.split('-');
    document.getElementById('lv-dp-selected').textContent = `${y}年${parseInt(m)}月${parseInt(d)}日`;
    renderLvDatePickerCal();
    renderLeaveT();
}
function lvDatePickerSetToday() {
    const today = new Date();
    lvDpYear = today.getFullYear(); lvDpMonth = today.getMonth()+1;
    lvDatePickerSelect(today.toISOString().split('T')[0]);
}

// ===== 作業 日期選擇器 =====
let hwDpYear, hwDpMonth, hwDpSelected;

function renderHwDatePickerCal() {
    const title = `${hwDpYear}年${hwDpMonth}月`;
    document.getElementById('hw-dp-title').textContent = title;
    const daysInMonth = new Date(hwDpYear, hwDpMonth, 0).getDate();
    const firstDay = new Date(hwDpYear, hwDpMonth-1, 1).getDay();
    const todayStr = new Date().toISOString().split('T')[0];
    const weekLabels = ['日','一','二','三','四','五','六'];
    let html = weekLabels.map(w=>`<div class="cal-header">${w}</div>`).join('');
    for (let i=0;i<firstDay;i++) html+='<div class="cal-day empty"></div>';
    for (let d=1;d<=daysInMonth;d++) {
        const ds = `${hwDpYear}-${String(hwDpMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const dow = new Date(ds+'T00:00:00').getDay();
        let cls;
        if (classDatesSet.has(ds)) cls = 'school';
        else if (dow===0||dow===6) cls = 'weekend';
        else cls = 'normal';
        if (ds === hwDpSelected) cls += ' dp-sel';
        if (ds === todayStr) cls += ' dp-today';
        html += `<div class="cal-day ${cls}" onclick="hwDatePickerSelect('${ds}')">${d}</div>`;
    }
    document.getElementById('hw-dp-cal').innerHTML = html;
}
function hwDatePickerMonth(delta) {
    hwDpMonth += delta;
    if (hwDpMonth < 1) { hwDpMonth = 12; hwDpYear--; }
    if (hwDpMonth > 12) { hwDpMonth = 1; hwDpYear++; }
    renderHwDatePickerCal();
}
function hwDatePickerSelect(ds) {
    hwDpSelected = ds;
    document.getElementById('hw-date-filter').value = ds;
    const [y,m,d] = ds.split('-');
    document.getElementById('hw-dp-selected').textContent = `${y}年${parseInt(m)}月${parseInt(d)}日`;
    renderHwDatePickerCal();
    loadHomeworkInfo(ds);
    loadTeacherHomeworkT();
}
function hwDatePickerSetToday() {
    const today = new Date();
    hwDpYear = today.getFullYear(); hwDpMonth = today.getMonth()+1;
    hwDatePickerSelect(today.toISOString().split('T')[0]);
}

// ===== 作業資訊（老師設定）=====
let hwInfoData = null;

async function loadHomeworkInfo(date) {
    if (!date) return;
    const titleEl = document.getElementById('hw-title-disp');
    const attachEl = document.getElementById('hw-attach-disp');
    const titleInput = document.getElementById('hw-info-title');
    try {
        const info = await fbGet(`homework_info/${date}`).catch(()=>null);
        hwInfoData = info || null;
        if (info && info.title) {
            titleEl.textContent = info.title;
            titleEl.className = 'hw-title-bar';
            titleInput.value = info.title;
        } else {
            titleEl.textContent = '（尚未設定作業名稱）';
            titleEl.className = 'hw-title-bar empty';
            titleInput.value = '';
        }
        if (info && info.attachment_name && info.attachment_url) {
            attachEl.innerHTML = `📎 附件：<a href="${info.attachment_url}" target="_blank" style="color:var(--accent)">${info.attachment_name}</a>`;
        } else {
            attachEl.textContent = '';
        }
        document.getElementById('hw-attach-name-prev').textContent = '未選擇';
        document.getElementById('hw-attach-file').value = '';
    } catch(e) { console.error('載入作業資訊失敗', e); }
}

function hwPreviewFile(input) {
    document.getElementById('hw-attach-name-prev').textContent = input.files[0] ? input.files[0].name : '未選擇';
}

async function saveHomeworkInfo() {
    const date = hwDpSelected;
    if (!date) { showToast('請先選擇日期'); return; }
    const title = document.getElementById('hw-info-title').value.trim();
    if (!title) { showToast('請輸入作業名稱'); return; }
    const statusEl = document.getElementById('hw-info-status');
    const btn = document.querySelector('#hw-edit-details .btn-primary');
    btn.disabled = true; statusEl.textContent = '儲存中...'; statusEl.style.color = 'var(--muted)';
    try {
        const fileInput = document.getElementById('hw-attach-file');
        const file = fileInput.files[0];
        let attachment_url = hwInfoData?.attachment_url || null;
        let attachment_name = hwInfoData?.attachment_name || null;
        if (file) {
            statusEl.textContent = '上傳附件中...';
            const res = await uploadTeacherAttachment(file, date);
            attachment_url = res.url; attachment_name = res.name;
        }
        const info = { title, updated_at: new Date().toISOString() };
        if (attachment_url) { info.attachment_url = attachment_url; info.attachment_name = attachment_name; }
        await fbPut(`homework_info/${date}`, info);
        hwInfoData = info;
        document.getElementById('hw-title-disp').textContent = title;
        document.getElementById('hw-title-disp').className = 'hw-title-bar';
        if (attachment_name) {
            document.getElementById('hw-attach-disp').innerHTML = `📎 附件：<a href="${attachment_url}" target="_blank" style="color:var(--accent)">${attachment_name}</a>`;
        }
        statusEl.textContent = '✅ 已儲存'; statusEl.style.color = 'var(--green)';
        fileInput.value = ''; document.getElementById('hw-attach-name-prev').textContent = '未選擇';
        showToast('✅ 作業資訊已更新');
    } catch(e) {
        statusEl.textContent = '❌ ' + e.message; statusEl.style.color = 'var(--red)';
    }
    btn.disabled = false;
}

async function uploadTeacherAttachment(file, date) {
    const storageBucket = FIREBASE_CONFIG.storageBucket;
    if (!storageBucket) throw new Error('未設定 Firebase storageBucket');
    const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const path = `homework_attachments/${date}/${safeName}`;
    const encodedPath = encodeURIComponent(path);
    const r = await fetch(
        `https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o?name=${encodedPath}&uploadType=media`,
        { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file }
    );
    if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(e.error?.message || `上傳失敗 (${r.status})`); }
    const data = await r.json();
    return {
        url: `https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o/${encodedPath}?alt=media&token=${data.downloadTokens}`,
        name: file.name
    };
}

// ===== INIT =====
(async function init() {
    const today = new Date();
    dpYear = today.getFullYear(); dpMonth = today.getMonth()+1;
    dpSelected = today.toISOString().split('T')[0];
    lvDpYear = today.getFullYear(); lvDpMonth = today.getMonth()+1;
    lvDpSelected = today.toISOString().split('T')[0];
    hwDpYear = today.getFullYear(); hwDpMonth = today.getMonth()+1;
    hwDpSelected = today.toISOString().split('T')[0];
    const todayLabel = today.toLocaleDateString('zh-TW', { year:'numeric', month:'long', day:'numeric' });
    document.getElementById('t-date').value = dpSelected;
    document.getElementById('date-picker-selected').textContent = todayLabel;
    document.getElementById('lv-dp-selected').textContent = todayLabel;
    document.getElementById('hw-dp-selected').textContent = todayLabel;
    document.getElementById('hw-date-filter').value = hwDpSelected;
    document.getElementById('m-month').value = today.toISOString().slice(0,7);
    document.getElementById('pin-input').addEventListener('keypress', e=>{ if(e.key==='Enter') doLogin(); });
    await loadClassDates();
    renderDatePickerCal();
    renderLvDatePickerCal();
    renderHwDatePickerCal();
    loadHomeworkInfo(hwDpSelected);
    // Bypass login: always enter app so teachers don't need to input password
    enterApp();
})();
