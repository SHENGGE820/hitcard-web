// Firebase 配置 - 直接連 Firebase REST API（不需要本地伺服器）
const FIREBASE_CONFIG = {
    databaseURL: 'https://hitcard-system-default-rtdb.asia-southeast1.firebasedatabase.app',
};

// Firebase REST API 端點（瀏覽器可直連，前提是 Firebase 規則開放讀取）
function getStudentsUrl() {
    return `${FIREBASE_CONFIG.databaseURL}/students.json`;
}

function getAttendanceUrl(date = null) {
    return `${FIREBASE_CONFIG.databaseURL}/attendance.json`;
}

function getAttendanceByDateUrl(date) {
    return `${FIREBASE_CONFIG.databaseURL}/attendance.json`;
}

function getAttendanceRangeUrl(startDate, endDate) {
    return `${FIREBASE_CONFIG.databaseURL}/attendance.json`;
}

// 注意: loadClassSchedule() 已移至 app.js；不要在此定義

// 取得該月的上課日數
function getMonthSchoolDays(year, month) {
    const monthStr = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
    
    // CLASS_SCHEDULE 在 app.js 中定義
    if (typeof CLASS_SCHEDULE !== 'undefined' && CLASS_SCHEDULE.dates && CLASS_SCHEDULE.dates.length > 0) {
        // 從配置中計算該月的上課日數
        const monthDates = CLASS_SCHEDULE.dates.filter(d => d.startsWith(monthStr));
        return monthDates.length;
    }
    
    // 如果沒有配置，默認計算週一至週六
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    let count = 0;
    
    for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate() + 1)) {
        const dayOfWeek = d.getDay();
        if (dayOfWeek !== 0) { // 跳過週日
            count++;
        }
    }
    
    return count;
}
