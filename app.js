// 全局变量
let allStudents = [];
let allAttendance = [];
let currentDate = new Date().toISOString().split('T')[0];
let currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM 格式
let CLASS_SCHEDULE = { dates: [] }; // 上課日期配置

// 初始化
document.addEventListener('DOMContentLoaded', async function() {
    // 显示伺服器信息
    displayServerInfo();
    
    // 设置日期选择器的默认值为今天
    document.getElementById('dateInput').valueAsDate = new Date();
    
    // 设置月份选择器的默认值为当月
    document.getElementById('monthInput').value = currentMonth;
    
    // 加載上課日期配置
    await loadClassSchedule();
    
    // 初始化本地 API 連接檢查
    checkApiConnection();
    
    // 加载数据
    loadData();
});

// 切换标签页
function switchTab(tabName) {
    // 隐藏所有标签页内容
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // 移除所有标签按钮的激活状态
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // 显示选中的标签页
    document.getElementById(tabName).classList.add('active');
    
    // 激活对应的按钮
    event.target.classList.add('active');
}

// 顯示伺服器信息
function displayServerInfo() {
    const serverInfoElement = document.getElementById('server-info');
    if (serverInfoElement) {
        serverInfoElement.textContent = `📡 直連 Firebase 雲端資料庫`;
        serverInfoElement.style.color = '#10b981';
    }
}

// 檢查 Firebase 連接
async function checkApiConnection() {
    try {
        const response = await fetch(getStudentsUrl());
        if (response.ok) {
            updateStatus('✓ Firebase 已連接', true);
        } else if (response.status === 401 || response.status === 403) {
            updateStatus('✗ Firebase 權限不足 - 請調整安全規則', false);
            console.error('Firebase 規則未允許讀取，請前往 Firebase Console → Realtime Database → 規則，將 .read 設為 true');
        } else {
            updateStatus('⚠ Firebase 連接異常', false);
        }
    } catch (error) {
        updateStatus('✗ Firebase 連接失敗 - 請檢查網路', false);
        console.error('Firebase 連接失敗:', error);
    }
}

// 更新狀態文本
function updateStatus(text, isConnected) {
    const statusText = document.getElementById('status-text');
    statusText.textContent = text;
    statusText.style.color = isConnected ? '#10b981' : '#ef4444';
}

// 加載上課日期配置
async function loadClassSchedule() {
    try {
        // 優先從 Firebase 讀取（教師可在後台修改）
        const fbResp = await fetch(`${FIREBASE_CONFIG.databaseURL}/class_schedule.json`);
        if (fbResp.ok) {
            const fbData = await fbResp.json();
            if (fbData?.class_dates?.length > 0) {
                CLASS_SCHEDULE = { dates: fbData.class_dates };
                console.log(`[INFO] 從 Firebase 取得 ${CLASS_SCHEDULE.dates.length} 個上課日期`);
                return;
            }
        }
    } catch(e) { /* fallback */ }
    try {
        // Fallback: 靜態 JSON 檔
        const response = await fetch(`./class_schedule.json?t=${Date.now()}`);
        if (response.ok) {
            const data = await response.json();
            if (data?.class_dates) {
                CLASS_SCHEDULE = { dates: data.class_dates };
            } else if (Array.isArray(data)) {
                CLASS_SCHEDULE = { dates: data };
            } else {
                CLASS_SCHEDULE = { dates: [] };
            }
            console.log(`[INFO] 從 JSON 檔取得 ${CLASS_SCHEDULE.dates.length} 個上課日期`);
        } else {
            CLASS_SCHEDULE = { dates: [] };
        }
    } catch (error) {
        CLASS_SCHEDULE = { dates: [] };
        console.warn('[WARN] 上課日期載入失敗:', error.message);
    }
}

// 加載數據
async function loadData() {
    showLoading();
    try {
        // 並行加載學生和打卡數據
        const [studentsResponse, attendanceResponse] = await Promise.all([
            fetch(getStudentsUrl()),
            fetch(getAttendanceUrl())
        ]);
        
        if (!studentsResponse.ok || !attendanceResponse.ok) {
            showError('無法加載數據，請檢查本地 API 伺服器是否運行');
            return;
        }
        
        const studentsData = await studentsResponse.json();
        const attendanceData = await attendanceResponse.json();
        
        // 解析學生資料：Firebase 以 card_uid 為 key，需手動帶入
        allStudents = [];
        if (studentsData && typeof studentsData === 'object') {
            for (const [cardUid, student] of Object.entries(studentsData)) {
                // 有些學生可能是巢狀結構（用 push() 存入），跳過
                if (typeof student !== 'object' || student === null) continue;
                // 如果是扁平物件 (有 name 欄位)，直接使用
                if (student.name) {
                    allStudents.push({ ...student, card_uid: cardUid });
                } else {
                    // 巢狀結構：學生資料在子節點中
                    for (const [subKey, subStudent] of Object.entries(student)) {
                        if (typeof subStudent === 'object' && subStudent !== null && subStudent.name) {
                            allStudents.push({ ...subStudent, card_uid: cardUid });
                            break; // 只取最新一筆
                        }
                    }
                }
            }
        }
        
        // 解析出缺席記錄
        allAttendance = attendanceData ? Object.values(attendanceData) : [];
        
        // 查詢今天的數據
        queryByDate();
        
        showSuccess(`✓ 已加載 ${allStudents.length} 個學生，${allAttendance.length} 筆記錄`);
        
    } catch (error) {
        console.error('加載數據失敗:', error);
        showError('加載數據失敗：' + error.message);
    }
}

// 按日期查詢
function queryByDate() {
    const dateInput = document.getElementById('dateInput');
    currentDate = dateInput.value;
    
    // 過濾當日打卡記錄（使用 date 欄位而不是 check_time）
    const todayAttendance = allAttendance.filter(record => {
        if (!record.date) return false;
        return record.date === currentDate;
    });
    
    // 構建學生打卡對應表
    const attendanceMap = {};
    for (const record of todayAttendance) {
        const key = record.card_uid;
        if (!attendanceMap[key]) {
            attendanceMap[key] = [];
        }
        attendanceMap[key].push(record);
    }
    
    // 生成表格
    displayStudentTable(allStudents, attendanceMap);
    
    // 更新統計信息
    updateStatistics(allStudents, attendanceMap);
}

// 刷新數據
function refreshData() {
    loadData();
}

// 顯示加載中
function showLoading() {
    const tbody = document.getElementById('studentTable');
    tbody.innerHTML = '<tr><td colspan="6" class="loading">載入中</td></tr>';
}

// 顯示錯誤
function showError(message) {
    const messageDiv = document.getElementById('message');
    messageDiv.innerHTML = `<div class="error">❌ ${message}</div>`;
    setTimeout(() => {
        messageDiv.innerHTML = '';
    }, 5000);
}

// 顯示成功
function showSuccess(message) {
    const messageDiv = document.getElementById('message');
    messageDiv.innerHTML = `<div class="success">${message}</div>`;
    setTimeout(() => {
        messageDiv.innerHTML = '';
    }, 3000);
}

// 顯示學生表格
function displayStudentTable(students, attendanceMap) {
    const tbody = document.getElementById('studentTable');
    
    if (students.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #999;">無學生數據</td></tr>';
        return;
    }
    
    let html = '';
    
    for (const student of students) {
        const cardUid = student.card_uid;
        const records = attendanceMap[cardUid] || [];
        
        // 查找上課和下課記錄
        const checkInRecord = records.find(r => r.check_type === 'check_in');
        const checkOutRecord = records.find(r => r.check_type === 'check_out');
        
        // 確定狀態
        let status = '未上課';
        let statusClass = 'absent';
        
        if (checkInRecord && checkOutRecord) {
            status = '已上下課';
            statusClass = 'check-out';
        } else if (checkInRecord) {
            status = '上課中';
            statusClass = 'check-in';
        }
        
        html += `
            <tr>
                <td><strong>${student.name || '無名'}</strong></td>
                <td>${student.card_uid}</td>
                <td>${student.class_name || '-'}</td>
                <td>${checkInRecord ? checkInRecord.check_time : '-'}</td>
                <td>${checkOutRecord ? checkOutRecord.check_time : '-'}</td>
                <td><span class="status-badge ${statusClass}">${status}</span></td>
            </tr>
        `;
    }
    
    tbody.innerHTML = html;
}

// 更新統計信息
function updateStatistics(students, attendanceMap) {
    const totalStudents = students.length;
    let presentCount = 0;  // 既有上課打卡也有下課打卡（已出席）
    let absentCount = 0;   // 未上課
    
    for (const student of students) {
        const cardUid = student.card_uid;
        const records = attendanceMap[cardUid] || [];
        const checkInRecord = records.find(r => r.check_type === 'check_in');
        const checkOutRecord = records.find(r => r.check_type === 'check_out');
        
        if (checkInRecord && checkOutRecord) {
            presentCount++;  // 既有上課打卡也有下課打卡
        } else if (!checkInRecord) {
            absentCount++;   // 未上課
        }
        // 只上課未下課的不計入"出席"也不計入"缺席"
    }
    
    // 更新 DOM
    document.getElementById('totalStudents').textContent = totalStudents;
    document.getElementById('checkInCount').textContent = presentCount;
    document.getElementById('absentCount').textContent = absentCount;
}

// 錯誤處理
window.addEventListener('error', (event) => {
    console.error('應用錯誤:', event.error);
});

// ============ 當月統計功能 ============

async function loadMonthlyStats() {
    const monthInput = document.getElementById('monthInput');
    const selectedMonth = monthInput.value; // YYYY-MM 格式
    
    if (!selectedMonth) {
        showError('請選擇月份');
        return;
    }
    
    try {
        // 在計算前重新加載最新的上課日期配置（確保使用最新的配置）
        await loadClassSchedule();
        
        console.log(`DEBUG: 已加載 ${CLASS_SCHEDULE.dates.length} 個上課日期`);
        if (CLASS_SCHEDULE.dates.length > 0) {
            console.log(`DEBUG: 樣本日期: ${CLASS_SCHEDULE.dates.slice(0, 3)}`);
        }
        
        // 構建該月份的日期範圍
        const [year, month] = selectedMonth.split('-');
        const daysInMonth = new Date(year, month, 0).getDate();
        const startDate = `${selectedMonth}-01`;
        const endDate = `${selectedMonth}-${String(daysInMonth).padStart(2, '0')}`;
        
        // 加載該月份的出缺席數據
        console.log(`[INFO] 加載 ${selectedMonth} 的出缺席數據: ${startDate} 至 ${endDate}`);
        const monthlyAttendanceResponse = await fetch(getAttendanceRangeUrl(startDate, endDate));
        
        if (!monthlyAttendanceResponse.ok) {
            showError('無法加載該月份的出缺席數據');
            return;
        }
        
        const monthlyAttendanceData = await monthlyAttendanceResponse.json();
        // Firebase 返回全部記錄，在前端篩選日期範圍
        let monthlyAttendance = monthlyAttendanceData ? Object.values(monthlyAttendanceData) : [];
        monthlyAttendance = monthlyAttendance.filter(record => {
            const d = record.date || (record.check_time ? record.check_time.split(' ')[0] : null);
            return d && d >= startDate && d <= endDate;
        });
        
        console.log(`[INFO] 已加載 ${monthlyAttendance.length} 筆出缺席記錄 (${startDate} ~ ${endDate})`);
        
        // 獲取該月的統計數據，使用新加載的月份數據
        const monthlyData = calculateMonthlyStatsWithData(selectedMonth, monthlyAttendance);
        displayMonthlyStats(monthlyData, selectedMonth);
    } catch (error) {
        console.error('加載統計失敗:', error);
        showError('加載統計失敗: ' + error.message);
    }
}

function calculateMonthlyStats(monthStr) {
    // monthStr 格式：YYYY-MM
    const [year, month] = monthStr.split('-');
    
    // 獲取該月的所有日期
    const daysInMonth = new Date(year, month, 0).getDate();
    const monthStart = `${monthStr}-01`;
    const monthEnd = `${monthStr}-${String(daysInMonth).padStart(2, '0')}`;
    
    // 過濾該月的打卡記錄（使用 date 欄位，不是 check_time）
    const monthlyAttendance = allAttendance.filter(record => {
        if (!record.date) return false;
        return record.date >= monthStart && record.date <= monthEnd;
    });
    
    // 為每個學生構建統計
    const studentStats = {};
    
    for (const student of allStudents) {
        const cardUid = student.card_uid;
        const studentRecords = monthlyAttendance.filter(r => r.card_uid === cardUid);
        
        // 統計出席日期
        // 先根據日期分組該學生的所有打卡記錄
        const dateRecords = {};
        for (const record of studentRecords) {
            const date = record.check_time.split(' ')[0];
            if (!dateRecords[date]) {
                dateRecords[date] = { check_in: false, check_out: false };
            }
            if (record.check_type === 'check_in') {
                dateRecords[date].check_in = true;
            } else if (record.check_type === 'check_out') {
                dateRecords[date].check_out = true;
            }
        }
        
        // 只有既有上課打卡也有下課打卡的日期才算出席
        const attendanceDates = {};
        for (const [date, records] of Object.entries(dateRecords)) {
            if (records.check_in && records.check_out) {
                attendanceDates[date] = true;
            }
        }
        
        // 計算該月的應上課日數
        const schoolDays = getMonthSchoolDays(parseInt(monthStr.split('-')[0]), parseInt(monthStr.split('-')[1]));
        
        // 生成該月所有日期的考勤情況
        const dayStats = {};
        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${monthStr}-${String(day).padStart(2, '0')}`;
            
            // 檢查是否在上課日期配置中
            if (CLASS_SCHEDULE.dates.length > 0) {
                // 使用配置的上課日期
                if (CLASS_SCHEDULE.dates.includes(dateStr)) {
                    dayStats[dateStr] = attendanceDates[dateStr] ? 'present' : 'absent';
                } else {
                    dayStats[dateStr] = 'not_school_day'; // 非上課日期
                }
            } else {
                // 使用預設的週一至週六
                const dayOfWeek = new Date(dateStr).getDay();
                if (dayOfWeek === 0) {
                    dayStats[dateStr] = 'weekend';
                } else {
                    dayStats[dateStr] = attendanceDates[dateStr] ? 'present' : 'absent';
                }
            }
        }
        
        const presentDays = Object.values(dayStats).filter(s => s === 'present').length;
        const absentDays = Object.values(dayStats).filter(s => s === 'absent').length;
        
        studentStats[cardUid] = {
            name: student.name,
            cardUid: student.card_uid,
            className: student.class_name,
            presentDays: presentDays,
            absentDays: absentDays,
            totalSchoolDays: schoolDays,
            dayStats: dayStats,
            attendanceDates: Object.keys(attendanceDates).sort()
        };
    }
    
    return studentStats;
}

// 使用提供的月份數據計算統計（用於查詢特定月份）
function calculateMonthlyStatsWithData(monthStr, monthlyAttendance) {
    // monthStr 格式：YYYY-MM
    const [year, month] = monthStr.split('-');
    
    // 獲取該月的所有日期
    const daysInMonth = new Date(year, month, 0).getDate();
    
    // 為每個學生構建統計
    const studentStats = {};
    
    for (const student of allStudents) {
        const cardUid = student.card_uid;
        const studentRecords = monthlyAttendance.filter(r => r.card_uid === cardUid);
        
        console.log(`[DEBUG] 學生 ${student.name} (${cardUid}): 有 ${studentRecords.length} 筆紀錄`);
        
        // 統計出席日期
        // 先根據日期分組該學生的所有打卡記錄
        const dateRecords = {};
        for (const record of studentRecords) {
            // 使用 record.date 欄位（由 API 返回）
            const date = record.date || record.check_time.split(' ')[0];
            if (!dateRecords[date]) {
                dateRecords[date] = { check_in: false, check_out: false };
            }
            if (record.check_type === 'check_in') {
                dateRecords[date].check_in = true;
            } else if (record.check_type === 'check_out') {
                dateRecords[date].check_out = true;
            }
        }
        
        // 只有既有上課打卡也有下課打卡的日期才算出席
        const attendanceDates = {};
        for (const [date, records] of Object.entries(dateRecords)) {
            if (records.check_in && records.check_out) {
                attendanceDates[date] = true;
            }
        }
        
        // 計算該月的應上課日數
        const schoolDays = getMonthSchoolDays(parseInt(year), parseInt(month));
        
        // 生成該月所有日期的考勤情況
        const dayStats = {};
        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${monthStr}-${String(day).padStart(2, '0')}`;
            
            // 檢查是否在上課日期配置中
            if (CLASS_SCHEDULE.dates.length > 0) {
                // 使用配置的上課日期
                if (CLASS_SCHEDULE.dates.includes(dateStr)) {
                    dayStats[dateStr] = attendanceDates[dateStr] ? 'present' : 'absent';
                } else {
                    dayStats[dateStr] = 'not_school_day'; // 非上課日期
                }
            } else {
                // 使用預設的週一至週六
                const dayOfWeek = new Date(dateStr).getDay();
                if (dayOfWeek === 0) {
                    dayStats[dateStr] = 'weekend';
                } else {
                    dayStats[dateStr] = attendanceDates[dateStr] ? 'present' : 'absent';
                }
            }
        }
        
        const presentDays = Object.values(dayStats).filter(s => s === 'present').length;
        const absentDays = Object.values(dayStats).filter(s => s === 'absent').length;
        
        console.log(`[DEBUG] 學生 ${student.name}: 出席${presentDays}天，缺席${absentDays}天，應上課${schoolDays}天`);
        
        studentStats[cardUid] = {
            name: student.name,
            cardUid: student.card_uid,
            className: student.class_name,
            presentDays: presentDays,
            absentDays: absentDays,
            totalSchoolDays: schoolDays,
            dayStats: dayStats,
            attendanceDates: Object.keys(attendanceDates).sort()
        };
    }
    
    return studentStats;
}

function displayMonthlyStats(studentStats, monthStr) {
    const container = document.getElementById('monthlyStatsContainer');
    
    if (Object.keys(studentStats).length === 0) {
        container.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: #999; padding: 40px;">該月份無數據</div>';
        return;
    }
    
    // 按學生名稱排序
    const sortedStudents = Object.values(studentStats).sort((a, b) => 
        a.name.localeCompare(b.name)
    );
    
    let html = '';
    for (const student of sortedStudents) {
        const attendanceRate = student.totalSchoolDays > 0 
            ? ((student.presentDays / student.totalSchoolDays) * 100).toFixed(1)
            : '0';
        
        // 格式化打卡日期列表
        const datesHtml = formatAttendanceDates(student.dayStats);
        
        html += `
            <div class="student-stat-card">
                <div class="name">${student.name}</div>
                <div class="card-uid">卡號: ${student.cardUid}</div>
                
                <div class="stat-row">
                    <span class="stat-label">班級</span>
                    <span class="stat-value">${student.className || '-'}</span>
                </div>
                
                <div class="stat-row">
                    <span class="stat-label">總上課日數</span>
                    <span class="stat-value present">${student.totalSchoolDays}</span>
                </div>
                
                <div class="stat-row">
                    <span class="stat-label">出席天數</span>
                    <span class="stat-value present">${student.presentDays}</span>
                </div>
                
                <div class="stat-row">
                    <span class="stat-label">缺席天數</span>
                    <span class="stat-value absent">${student.absentDays}</span>
                </div>
                
                <div class="stat-row">
                    <span class="stat-label">出席率</span>
                    <span class="stat-value present">${attendanceRate}%</span>
                </div>
                
                <div class="attendance-dates">
                    <span class="label">各日期考勤：</span>
                    <div class="date-list">
                        ${datesHtml}
                    </div>
                </div>
            </div>
        `;
    }
    
    container.innerHTML = html;
}

function formatAttendanceDates(dayStats) {
    let html = '';
    
    // 只顯示上課日期（在 CLASS_SCHEDULE.dates 中的日期）
    for (const [date, status] of Object.entries(dayStats).sort()) {
        const day = date.split('-')[2];
        
        // 只顯示上課日期和周末，跳過非上課日期
        if (status === 'not_school_day') {
            continue; // 不顯示非上課日期
        } else if (status === 'weekend') {
            html += `<span class="date-badge" title="${date} (週末)">${day}(周末)</span>`;
        } else if (status === 'present') {
            html += `<span class="date-badge present" title="${date}">${day}✓</span>`;
        } else if (status === 'absent') {
            html += `<span class="date-badge absent" title="${date}">${day}✗</span>`;
        }
    }
    return html;
}

// ===== 作業繳交（教師版） =====

let allHomeworks = []; // [{ studentName, className, card_uid, title, link, submitted_at }]

async function loadTeacherHomework() {
    const tbody = document.getElementById('hw-tbody');
    tbody.innerHTML = '<tr><td colspan="5" class="loading">載入中...</td></tr>';

    try {
        // 先確保學生資料已載入
        if (allStudents.length === 0) await loadData();

        const studentsResp = await fetch(`${FIREBASE_CONFIG.databaseURL}/students.json`);
        const studentsData = await studentsResp.json();

        allHomeworks = [];

        if (studentsData) {
            for (const [cardUid, studentData] of Object.entries(studentsData)) {
                if (cardUid.startsWith('-') || !studentData || typeof studentData !== 'object') continue;
                if (!studentData.homeworks) continue;

                const studentName = studentData.name || '未知';
                const className = studentData.class_name || '未知班級';

                for (const [hwKey, hw] of Object.entries(studentData.homeworks)) {
                    if (!hw || typeof hw !== 'object') continue;
                    allHomeworks.push({
                        card_uid: cardUid,
                        studentName,
                        className,
                        title: hw.title || '（未填名稱）',
                        link: hw.link || '',
                        submitted_at: hw.submitted_at || ''
                    });
                }
            }
        }

        // 排序：最新在前
        allHomeworks.sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));

        // 填入學生篩選下拉
        const sel = document.getElementById('hw-filter-student');
        const currentVal = sel.value;
        sel.innerHTML = '<option value="">全部學生</option>';
        const names = [...new Set(allHomeworks.map(h => h.studentName))].sort();
        names.forEach(n => {
            const opt = document.createElement('option');
            opt.value = n;
            opt.textContent = n;
            sel.appendChild(opt);
        });
        sel.value = currentVal;

        renderHomework();

    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="5" style="color:#fca5a5; text-align:center;">載入失敗：${e.message}</td></tr>`;
    }
}

function renderHomework() {
    const filterStudent = document.getElementById('hw-filter-student').value;
    const filterKeyword = document.getElementById('hw-filter-keyword').value.trim().toLowerCase();

    let list = allHomeworks;
    if (filterStudent) list = list.filter(h => h.studentName === filterStudent);
    if (filterKeyword) list = list.filter(h => h.title.toLowerCase().includes(filterKeyword));

    document.getElementById('hw-summary').textContent = `共 ${list.length} 筆繳交記錄`;

    const tbody = document.getElementById('hw-tbody');
    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#64748b; padding:30px;">沒有符合的作業記錄</td></tr>';
        return;
    }

    tbody.innerHTML = list.map(h => {
        const dt = h.submitted_at ? new Date(h.submitted_at).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '--';
        return `<tr>
            <td>${h.studentName}</td>
            <td>${h.className}</td>
            <td>${h.title}</td>
            <td>${dt}</td>
            <td>${h.link ? `<a href="${h.link}" target="_blank" style="color:#60a5fa;">🔗 開啟</a>` : '（無連結）'}</td>
        </tr>`;
    }).join('');
}

// ===== 請假管理（教師版） =====

let allLeaves = []; // [{ studentName, className, card_uid, date, reason, submitted_at }]

async function loadTeacherLeave() {
    const tbody = document.getElementById('lv-tbody');
    tbody.innerHTML = '<tr><td colspan="5" class="loading">載入中...</td></tr>';

    // 預設月份為當月
    const monthInput = document.getElementById('lv-filter-month');
    if (!monthInput.value) monthInput.value = new Date().toISOString().slice(0, 7);

    try {
        const studentsResp = await fetch(`${FIREBASE_CONFIG.databaseURL}/students.json`);
        const studentsData = await studentsResp.json();

        allLeaves = [];

        if (studentsData) {
            for (const [cardUid, studentData] of Object.entries(studentsData)) {
                if (cardUid.startsWith('-') || !studentData || typeof studentData !== 'object') continue;
                if (!studentData.leave_requests) continue;

                const studentName = studentData.name || '未知';
                const className = studentData.class_name || '未知班級';

                for (const [lvKey, lv] of Object.entries(studentData.leave_requests)) {
                    if (!lv || typeof lv !== 'object') continue;
                    allLeaves.push({
                        card_uid: cardUid,
                        studentName,
                        className,
                        date: lv.date || '',
                        reason: lv.reason || '（未填寫）',
                        submitted_at: lv.submitted_at || ''
                    });
                }
            }
        }

        // 排序：日期最新在前
        allLeaves.sort((a, b) => b.date.localeCompare(a.date));

        // 填入學生篩選下拉
        const sel = document.getElementById('lv-filter-student');
        const currentVal = sel.value;
        sel.innerHTML = '<option value="">全部學生</option>';
        const names = [...new Set(allLeaves.map(l => l.studentName))].sort();
        names.forEach(n => {
            const opt = document.createElement('option');
            opt.value = n;
            opt.textContent = n;
            sel.appendChild(opt);
        });
        sel.value = currentVal;

        renderLeave();

    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="5" style="color:#fca5a5; text-align:center;">載入失敗：${e.message}</td></tr>`;
    }
}

function renderLeave() {
    const filterStudent = document.getElementById('lv-filter-student').value;
    const filterMonth = document.getElementById('lv-filter-month').value; // YYYY-MM

    let list = allLeaves;
    if (filterStudent) list = list.filter(l => l.studentName === filterStudent);
    if (filterMonth) list = list.filter(l => l.date.startsWith(filterMonth));

    document.getElementById('lv-summary').textContent = `共 ${list.length} 筆請假記錄`;

    const tbody = document.getElementById('lv-tbody');
    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#64748b; padding:30px;">沒有符合的請假記錄</td></tr>';
        return;
    }

    tbody.innerHTML = list.map(l => {
        const dt = l.submitted_at ? new Date(l.submitted_at).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '--';
        return `<tr>
            <td>${l.studentName}</td>
            <td>${l.className}</td>
            <td>${l.date}</td>
            <td>${l.reason}</td>
            <td>${dt}</td>
        </tr>`;
    }).join('');
}
