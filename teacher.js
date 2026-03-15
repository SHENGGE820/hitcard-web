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

// (rest of file is identical to web_deploy/teacher.js)
