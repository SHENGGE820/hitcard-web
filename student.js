// ===== 學生版邏輯 =====
const DB_URL = FIREBASE_CONFIG.databaseURL;

let currentStudent = null; // { card_uid, name, student_id, class_name }
let foundStudents = [];    // 搜尋到的學生列表（處理同名）
let isFirstLogin = false;  // 第一次登入（尚未設密碼）

// ===== 工具函數 =====

async function sha256(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function firebaseGet(path) {
    const r = await fetch(`${DB_URL}/${path}.json`);
    if (!r.ok) throw new Error(`Firebase GET failed: ${r.status}`);
    return await r.json();
}

async function firebasePut(path, data) {
    const r = await fetch(`${DB_URL}/${path}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    if (!r.ok) throw new Error(`Firebase PUT failed: ${r.status}`);
    return await r.json();
}

async function firebasePost(path, data) {
    const r = await fetch(`${DB_URL}/${path}.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    if (!r.ok) throw new Error(`Firebase POST failed: ${r.status}`);
    return await r.json();
}

function showError(msg) {
    const el = document.getElementById('error-msg');
    el.textContent = msg;
    el.style.display = 'block';
}

function clearError() {
    document.getElementById('error-msg').style.display = 'none';
}

function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 3000);
}

function setStep(n) {
    [1,2,3].forEach(i => {
        document.getElementById(`step-${i}`).style.display = i === n ? 'block' : 'none';
        const dot = document.getElementById(`dot-${i}`);
        dot.classList.toggle('active', i <= n);
    });
    clearError();
}

function goBack() {
    const visible = [1,2,3].find(i => document.getElementById(`step-${i}`).style.display !== 'none');
    if (visible > 1) setStep(visible - 1);
}

// ===== 登入流程 =====

// Step 1: 用名字找學生
async function stepFindStudent() {
    const name = document.getElementById('input-name').value.trim();
    if (!name) { showError('請輸入姓名'); return; }

    clearError();
    const btn = document.querySelector('#step-1 .btn-primary');
    btn.disabled = true;
    btn.textContent = '搜尋中...';

    try {
        const students = await firebaseGet('students');
        if (!students) { showError('找不到學生資料，請確認姓名'); btn.disabled = false; btn.textContent = '下一步'; return; }

        // 找名字匹配的學生（只找扁平結構，key 不以 - 開頭）
        foundStudents = [];
        for (const [cardUid, data] of Object.entries(students)) {
            if (cardUid.startsWith('-')) continue;
            if (typeof data === 'object' && data.name === name) {
                foundStudents.push({ card_uid: cardUid, ...data });
            }
        }

        if (foundStudents.length === 0) {
            showError('找不到這個名字，請確認姓名是否正確');
            btn.disabled = false; btn.textContent = '下一步';
            return;
        }

        // 進入 Step 2
        renderStudentConfirm();
        setStep(2);

    } catch (e) {
        showError('連線失敗，請稍後再試');
    }
    btn.disabled = false;
    btn.textContent = '下一步';
}

function renderStudentConfirm() {
    const box = document.getElementById('student-confirm-box');
    const idWrap = document.getElementById('step2-studentid-wrap');

    if (foundStudents.length === 1) {
        const s = foundStudents[0];
        box.innerHTML = `
            <div class="student-confirm">
                <div class="name">👤 ${s.name}</div>
                <div class="info">學號：${s.student_id || '（未設定）'} ｜ 班級：${s.class_name || '（未設定）'}</div>
            </div>
            <p style="font-size:14px; color:#94a3b8; text-align:center; margin-bottom:16px">是你嗎？</p>
        `;
        idWrap.style.display = 'none';
        document.getElementById('btn-confirm').textContent = '確認是我';
    } else {
        // 同名多人，需要輸入學號
        box.innerHTML = `
            <p style="font-size:14px; color:#94a3b8; margin-bottom:16px">找到 ${foundStudents.length} 個同名學生，請輸入學號確認身份</p>
        `;
        idWrap.style.display = 'block';
        document.getElementById('btn-confirm').textContent = '確認';
    }
}

async function stepConfirmStudent() {
    clearError();

    if (foundStudents.length === 1) {
        currentStudent = foundStudents[0];
    } else {
        const inputId = document.getElementById('input-student-id').value.trim();
        if (!inputId) { showError('請輸入學號'); return; }
        currentStudent = foundStudents.find(s => s.student_id === inputId);
        if (!currentStudent) { showError('學號不符，請重新確認'); return; }
    }

    // 檢查是否已有密碼
    try {
        const pwData = await firebaseGet(`students/${currentStudent.card_uid}/password`);
        isFirstLogin = !pwData;

        if (isFirstLogin) {
            document.getElementById('step3-label').textContent = `歡迎，${currentStudent.name}！請設定你的登入密碼`;
            document.getElementById('pw-label').textContent = '設定密碼';
            document.getElementById('pw-confirm-wrap').style.display = 'block';
            document.querySelector('#step-3 .btn-primary').textContent = '設定密碼並登入';
        } else {
            document.getElementById('step3-label').textContent = `歡迎回來，${currentStudent.name}！`;
            document.getElementById('pw-label').textContent = '密碼';
            document.getElementById('pw-confirm-wrap').style.display = 'none';
            document.querySelector('#step-3 .btn-primary').textContent = '登入';
        }

        setStep(3);
    } catch (e) {
        showError('連線失敗，請稍後再試');
    }
}

async function stepLogin() {
    clearError();
    const pw = document.getElementById('input-pw').value;
    if (!pw || pw.length < 4) { showError('密碼至少 4 個字元'); return; }

    const btn = document.querySelector('#step-3 .btn-primary');
    btn.disabled = true;
    btn.textContent = '處理中...';

    try {
        const hash = await sha256(pw);

        if (isFirstLogin) {
            // 設定密碼
            const confirm = document.getElementById('input-pw-confirm').value;
            if (pw !== confirm) { showError('兩次密碼不一致'); btn.disabled = false; btn.textContent = '設定密碼並登入'; return; }
            await firebasePut(`students/${currentStudent.card_uid}/password`, hash);
        } else {
            // 驗證密碼
            const storedHash = await firebaseGet(`students/${currentStudent.card_uid}/password`);
            if (hash !== storedHash) { showError('密碼錯誤'); btn.disabled = false; btn.textContent = '登入'; return; }
        }

        // 登入成功
        sessionStorage.setItem('student', JSON.stringify(currentStudent));
        enterMainPage();

    } catch (e) {
        showError('連線失敗，請稍後再試');
    }
    btn.disabled = false;
}

// ===== 主頁面 =====

function enterMainPage() {
    document.getElementById('login-page').style.display = 'none';
    document.getElementById('main-page').style.display = 'block';

    document.getElementById('top-name').textContent = currentStudent.name;
    document.getElementById('top-class').textContent = currentStudent.class_name || '學生';

    // 設定今天日期
    const today = new Date();
    const todayStr = today.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
    document.getElementById('today-date').textContent = todayStr;

    const hour = today.getHours();
    const greeting = hour < 12 ? '早安！' : hour < 18 ? '午安！' : '晚安！';
    document.getElementById('today-greeting').textContent = `${greeting}${currentStudent.name}`;

    // 設定月份選擇器預設值
    document.getElementById('month-input').value = today.toISOString().slice(0, 7);

    // 設定請假日期預設值
    document.getElementById('leave-date').value = today.toISOString().split('T')[0];

    loadTodayAttendance();
    loadWeekAttendance();
    loadLeaveList();
    loadHomeworkList();
    loadMonthly();
}

function logout() {
    sessionStorage.removeItem('student');
    currentStudent = null;
    document.getElementById('main-page').style.display = 'none';
    document.getElementById('login-page').style.display = 'flex';
    document.getElementById('input-name').value = '';
    document.getElementById('input-pw').value = '';
    setStep(1);
}

function switchTab(tabId, btn) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    btn.classList.add('active');
}

// ===== 今日打卡 =====

async function loadTodayAttendance() {
    const today = new Date().toISOString().split('T')[0];
    try {
        const all = await firebaseGet('attendance');
        if (!all) return;

        const todayRecords = Object.values(all).filter(r =>
            r.card_uid?.toUpperCase() === currentStudent.card_uid?.toUpperCase() && r.date === today
        );

        const checkIn = todayRecords.find(r => r.check_type === 'check_in');
        const checkOut = todayRecords.find(r => r.check_type === 'check_out');

        if (checkIn) {
            document.getElementById('checkin-icon').textContent = '✅';
            document.getElementById('checkin-time').textContent = checkIn.check_time.split(' ')[1]?.slice(0, 5) || checkIn.check_time;
            document.getElementById('checkin-time').className = 'time';
        } else {
            document.getElementById('checkin-icon').textContent = '⏰';
            document.getElementById('checkin-time').textContent = '未打卡';
            document.getElementById('checkin-time').className = 'time absent';
        }

        if (checkOut) {
            document.getElementById('checkout-icon').textContent = '✅';
            document.getElementById('checkout-time').textContent = checkOut.check_time.split(' ')[1]?.slice(0, 5) || checkOut.check_time;
            document.getElementById('checkout-time').className = 'time';
        } else {
            document.getElementById('checkout-icon').textContent = '🏁';
            document.getElementById('checkout-time').textContent = '未打卡';
            document.getElementById('checkout-time').className = 'time absent';
        }
    } catch (e) { console.error('載入今日打卡失敗', e); }
}

async function loadWeekAttendance() {
    const today = new Date();
    const days = [];
    // 顯示最近 7 天
    for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        days.push(d.toISOString().split('T')[0]);
    }

    try {
        const all = await firebaseGet('attendance');
        const myRecords = all ? Object.values(all).filter(r =>
            r.card_uid?.toUpperCase() === currentStudent.card_uid?.toUpperCase()
        ) : [];
        const leaveData = await firebaseGet(`students/${currentStudent.card_uid}/leave_requests`);
        const leaveKeys = leaveData ? Object.values(leaveData).map(l => l.date) : [];

        const container = document.getElementById('week-list');
        container.innerHTML = '';

        for (const dateStr of days) {
            const dayRecords = myRecords.filter(r => r.date === dateStr);
            const checkIn = dayRecords.find(r => r.check_type === 'check_in');
            const checkOut = dayRecords.find(r => r.check_type === 'check_out');
            const isLeave = leaveKeys.includes(dateStr);

            const dateObj = new Date(dateStr + 'T00:00:00');
            const label = dateObj.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric', weekday: 'short' });

            let statusIcon, statusText, statusColor;
            if (isLeave) {
                statusIcon = '📋'; statusText = '請假'; statusColor = '#93c5fd';
            } else if (checkIn && checkOut) {
                statusIcon = '✅'; statusText = '出席'; statusColor = '#6ee7b7';
            } else if (checkIn || checkOut) {
                statusIcon = '⚠️'; statusText = '部分打卡'; statusColor = '#fbbf24';
            } else {
                statusIcon = '❌'; statusText = '未打卡'; statusColor = '#fca5a5';
            }

            container.innerHTML += `
                <div class="leave-item">
                    <div>
                        <div class="date">${label}</div>
                        <div class="reason" style="color:#64748b">
                            ${checkIn ? '上課 ' + (checkIn.check_time.split(' ')[1]?.slice(0,5) || '') : ''}
                            ${checkOut ? '・下課 ' + (checkOut.check_time.split(' ')[1]?.slice(0,5) || '') : ''}
                        </div>
                    </div>
                    <span class="badge" style="background:#1e293b; color:${statusColor}">${statusIcon} ${statusText}</span>
                </div>
            `;
        }
    } catch (e) { console.error('載入本週出席失敗', e); }
}

// ===== 月統計 =====

async function loadMonthly() {
    const monthStr = document.getElementById('month-input').value;
    if (!monthStr) return;

    const [year, month] = monthStr.split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    const startDate = `${monthStr}-01`;
    const endDate   = `${monthStr}-${String(daysInMonth).padStart(2, '0')}`;

    document.getElementById('monthly-calendar').innerHTML = '<div class="loading-center"><span class="spinner"></span>載入中...</div>';

    try {
        const [allAttendance, leaveData, scheduleData] = await Promise.all([
            firebaseGet('attendance'),
            firebaseGet(`students/${currentStudent.card_uid}/leave_requests`),
            // 優先從 Firebase 讀上課日（教師可從後台修改）
            firebaseGet('class_schedule').catch(()=>null)
        ]);

        // fallback to static JSON if Firebase has no data
        let schedJson = scheduleData;
        if (!schedJson?.class_dates?.length) {
            schedJson = await fetch(`./class_schedule.json?t=${Date.now()}`).then(r=>r.ok?r.json():null).catch(()=>null);
        }

        // 篩出本人本月記錄（card_uid 不區分大小寫）
        const myRecords = allAttendance ? Object.values(allAttendance).filter(r =>
            r.card_uid?.toUpperCase() === currentStudent.card_uid?.toUpperCase() &&
            r.date >= startDate && r.date <= endDate
        ) : [];

        console.log('[月統計] card_uid:', currentStudent.card_uid, '| 本月筆數:', myRecords.length);
        if (myRecords.length === 0 && allAttendance) {
            const s = Object.values(allAttendance)[0];
            console.log('[月統計] 出勤記錄範例 card_uid:', s?.card_uid);
        }

        const leaveKeys = leaveData ? Object.values(leaveData).map(l => l.date) : [];
        const classDates = schedJson?.class_dates || [];
        const today = new Date().toISOString().split('T')[0];

        // === 跟老師版相同：先按日期分組，上下課都到才算出席 ===
        const dateRecords = {};
        for (const r of myRecords) {
            const d = r.date || r.check_time?.split(' ')[0];
            if (!d) continue;
            if (!dateRecords[d]) dateRecords[d] = { check_in: false, check_out: false };
            if (r.check_type === 'check_in')  dateRecords[d].check_in  = true;
            if (r.check_type === 'check_out') dateRecords[d].check_out = true;
        }
        const attendedDates = new Set(
            Object.entries(dateRecords).filter(([, v]) => v.check_in && v.check_out).map(([k]) => k)
        );

        // 逐日計算 dayStatus
        let presentDays = 0, absentDays = 0, leaveDays = 0, totalDays = 0;
        const dayStatus = {};

        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${monthStr}-${String(d).padStart(2, '0')}`;
            const dow = new Date(dateStr + 'T00:00:00').getDay();
            const isSchoolDay = classDates.length > 0
                ? classDates.includes(dateStr)
                : (dow !== 0 && dow !== 6);

            if (!isSchoolDay)    { dayStatus[dateStr] = 'not-school'; continue; }
            if (dateStr > today) { dayStatus[dateStr] = 'future';     continue; }

            totalDays++;
            const isLeave = leaveKeys.includes(dateStr);
            if (isLeave)                        { leaveDays++;   dayStatus[dateStr] = 'leave'; }
            else if (attendedDates.has(dateStr)) { presentDays++; dayStatus[dateStr] = 'present'; }
            else                                 { absentDays++;  dayStatus[dateStr] = 'absent'; }
        }

        const rate = totalDays > 0 ? ((presentDays / totalDays) * 100).toFixed(1) : '0';

        document.getElementById('stat-present').textContent = presentDays;
        document.getElementById('stat-absent').textContent  = absentDays;
        document.getElementById('stat-total').textContent   = totalDays;
        document.getElementById('stat-rate').textContent    = rate + '%';

        renderCalendar(year, month, daysInMonth, dayStatus);

    } catch (e) { console.error('載入月統計失敗', e); }
}

function renderCalendar(year, month, daysInMonth, dayStatus) {
    // === 日曆格 ===
    const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
    let calHtml = weekDays.map(d => `<div class="cal-header">${d}</div>`).join('');
    const firstDay = new Date(year, month - 1, 1).getDay();
    for (let i = 0; i < firstDay; i++) calHtml += '<div class="cal-day empty"></div>';
    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        calHtml += `<div class="cal-day ${dayStatus[dateStr] || 'not-school'}">${d}</div>`;
    }

    // === 每日色塊（跟老師版一樣）===
    let badgeHtml = '';
    for (const [dateStr, status] of Object.entries(dayStatus).sort()) {
        if (status === 'not-school' || status === 'future') continue;
        const day = parseInt(dateStr.split('-')[2]);
        if (status === 'present') badgeHtml += `<span class="date-badge present" title="${dateStr}">${day}✓</span>`;
        else if (status === 'absent') badgeHtml += `<span class="date-badge absent" title="${dateStr}">${day}✗</span>`;
        else if (status === 'leave')  badgeHtml += `<span class="date-badge leave"  title="${dateStr}">${day}假</span>`;
    }

    const container = document.getElementById('monthly-calendar');
    container.innerHTML = `
        <div class="calendar-grid">${calHtml}</div>
        <div style="display:flex; gap:10px; margin-top:14px; flex-wrap:wrap; font-size:12px; color:#64748b;">
            <span><span style="color:#6ee7b7">■</span> 出席</span>
            <span><span style="color:#fca5a5">■</span> 缺席</span>
            <span><span style="color:#93c5fd">■</span> 請假</span>
        </div>
        ${badgeHtml ? `
        <div style="margin-top:16px;">
            <div style="font-size:13px; color:#94a3b8; margin-bottom:8px;">各日期考勤</div>
            <div style="display:flex; flex-wrap:wrap; gap:6px;">${badgeHtml}</div>
        </div>` : ''}
    `;
}

// ===== 請假 =====

async function submitLeave() {
    const date = document.getElementById('leave-date').value;
    const reason = document.getElementById('leave-reason').value.trim();

    if (!date) { showToast('請選擇請假日期'); return; }

    const key = `leave_${date}`;
    try {
        await firebasePut(`students/${currentStudent.card_uid}/leave_requests/${key}`, {
            date,
            reason: reason || '（未填寫原因）',
            submitted_at: new Date().toISOString(),
            status: 'approved'
        });
        showToast('✅ 請假申請已送出');
        document.getElementById('leave-reason').value = '';
        loadLeaveList();
        loadWeekAttendance();
    } catch (e) {
        showToast('❌ 送出失敗，請稍後再試');
    }
}

async function loadLeaveList() {
    try {
        const data = await firebaseGet(`students/${currentStudent.card_uid}/leave_requests`);
        const container = document.getElementById('leave-list');

        if (!data) {
            container.innerHTML = '<div class="empty-state"><div class="icon">📋</div><p>還沒有請假記錄</p></div>';
            return;
        }

        const leaves = Object.values(data).sort((a, b) => b.date.localeCompare(a.date));
        container.innerHTML = leaves.map(l => `
            <div class="leave-item">
                <div>
                    <div class="date">📅 ${l.date}</div>
                    <div class="reason">${l.reason}</div>
                </div>
                <span class="badge approved">✓ 生效</span>
            </div>
        `).join('');
    } catch (e) { console.error('載入請假記錄失敗', e); }
}

// ===== 作業 =====

async function submitHomework() {
    const title = document.getElementById('hw-title').value.trim();
    const link = document.getElementById('hw-link').value.trim();

    if (!title) { showToast('請填寫作業名稱'); return; }
    if (!link) { showToast('請填寫作業連結'); return; }
    if (!link.startsWith('http')) { showToast('請輸入有效的網址（以 http 開頭）'); return; }

    const key = `hw_${Date.now()}`;
    try {
        await firebasePut(`students/${currentStudent.card_uid}/homeworks/${key}`, {
            title,
            link,
            submitted_at: new Date().toISOString()
        });
        showToast('✅ 作業已繳交');
        document.getElementById('hw-title').value = '';
        document.getElementById('hw-link').value = '';
        loadHomeworkList();
    } catch (e) {
        showToast('❌ 繳交失敗，請稍後再試');
    }
}

async function loadHomeworkList() {
    try {
        const data = await firebaseGet(`students/${currentStudent.card_uid}/homeworks`);
        const container = document.getElementById('hw-list');

        if (!data) {
            container.innerHTML = '<div class="empty-state"><div class="icon">📚</div><p>還沒有繳交記錄</p></div>';
            return;
        }

        const hws = Object.values(data).sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
        container.innerHTML = hws.map(h => `
            <div class="hw-item">
                <div class="title">📄 ${h.title}</div>
                <div class="meta">繳交時間：${new Date(h.submitted_at).toLocaleString('zh-TW')}</div>
                <a href="${h.link}" target="_blank">🔗 查看檔案</a>
            </div>
        `).join('');
    } catch (e) { console.error('載入作業記錄失敗', e); }
}

// ===== 初始化 =====
(function init() {
    // 檢查是否已登入（session）
    const stored = sessionStorage.getItem('student');
    if (stored) {
        currentStudent = JSON.parse(stored);
        enterMainPage();
    }

    // Enter 鍵送出
    document.getElementById('input-name').addEventListener('keypress', e => {
        if (e.key === 'Enter') stepFindStudent();
    });
    document.getElementById('input-pw').addEventListener('keypress', e => {
        if (e.key === 'Enter') stepLogin();
    });
})();
