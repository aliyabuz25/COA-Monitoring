/**
 * COA-e | Enterprise Compliance Monitor - Logic Controller
 */

/* --- Configuration --- */
const CONFIG = {
    API_DB_ENDPOINT: '/api/db',
    DATE_OPTIONS: { weekday: 'short', year: 'numeric', month: 'long', day: 'numeric' },
    MIN_PASSWORD_LENGTH: 6,
    MAX_TOASTS: 4,
    UPLOAD_ALLOWED_EXTENSIONS: ['pdf', 'xlsx', 'csv']
};

/* --- Global State --- */
let store = {
    users: [],
    reports: [],
    inbox: [],
    audit: [],
    session: null
};
let commitQueue = Promise.resolve();

/* --- Utilities --- */
function normalizeText(value = '') {
    return String(value).trim().replace(/\s+/g, ' ');
}

function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function defaultStore() {
    return {
        users: [{ username: 'kellie', password: 'kellie2004', role: 'admin', unit: 'System HQ' }],
        reports: [],
        inbox: [],
        audit: [],
        session: null
    };
}

function normalizeLoadedStore(payload) {
    const base = defaultStore();
    if (!payload || typeof payload !== 'object') return base;

    const users = Array.isArray(payload.users) ? payload.users : base.users;
    const reports = Array.isArray(payload.reports) ? payload.reports : [];
    const inbox = Array.isArray(payload.inbox) ? payload.inbox : [];
    const audit = Array.isArray(payload.audit) ? payload.audit : [];
    const session = payload.session && typeof payload.session === 'object' ? payload.session : null;

    const safeUsers = users.length ? users : base.users;
    if (!safeUsers.some(u => u.username === 'kellie')) {
        safeUsers.push({ username: 'kellie', password: 'kellie2004', role: 'admin', unit: 'System HQ' });
    }

    const safeSession = session && safeUsers.some(u => u.username === session.username) ? session : null;

    return {
        users: safeUsers,
        reports,
        inbox,
        audit,
        session: safeSession
    };
}

function formatDateTime(input = new Date()) {
    return new Date(input).toLocaleString('en-US');
}

function generateReportId() {
    let id = Math.floor(Math.random() * 9000) + 1000;
    while (store.reports.some(r => r.id === id)) {
        id = Math.floor(Math.random() * 9000) + 1000;
    }
    return id;
}

function isValidUploadFile(file) {
    const extension = file.name.split('.').pop().toLowerCase();
    return CONFIG.UPLOAD_ALLOWED_EXTENSIONS.includes(extension);
}

function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('File read failed'));
        reader.readAsDataURL(file);
    });
}

function getFileExtension(filename = '') {
    const idx = String(filename).lastIndexOf('.');
    return idx >= 0 ? String(filename).slice(idx + 1).toLowerCase() : '';
}

function decodeDataUrlText(dataUrl) {
    const [meta, data = ''] = String(dataUrl).split(',', 2);
    if (!meta) return '';
    if (meta.includes(';base64')) return atob(data);
    return decodeURIComponent(data);
}

/* --- Elements Map --- */
const DOM = {
    screens: {
        auth: document.getElementById('authScreen'),
        dashboard: document.getElementById('dashboardScreen')
    },
    auth: {
        loginForm: document.getElementById('loginForm')
    },
    dashboard: {
        adminNav: document.getElementById('adminNavSection'),
        adminPanel: document.getElementById('adminControls'),
        userDisplay: document.getElementById('displayName'),
        roleDisplay: document.getElementById('displayRole'),
        logout: document.getElementById('logoutBtn'),
        date: document.getElementById('currentDate'),
        navItems: document.querySelectorAll('.nav-item')
    },
    stats: {
        total: document.getElementById('statTotal'),
        pending: document.getElementById('statPending'),
        completed: document.getElementById('statCompleted'),
        messages: document.getElementById('statMessages')
    },
    data: {
        reportsBody: document.getElementById('reportsBody'),
        inboxList: document.getElementById('inboxList'),
        auditList: document.getElementById('auditLogList'),
        reportSelect: document.getElementById('reportUnitSelect'),
        reminderSelect: document.getElementById('reminderUnitSelect')
    },
    modal: {
        overlay: document.getElementById('uploadModal'),
        close: document.getElementById('closeModal'),
        cancel: document.getElementById('cancelUpload'),
        confirm: document.getElementById('confirmUpload'),
        dropZone: document.getElementById('dropZone'),
        fileInput: document.getElementById('fileInput'),
        preview: document.getElementById('selectedFileName'),
        filename: document.getElementById('fileNameText')
    },
    docModal: {
        overlay: document.getElementById('docModal'),
        close: document.getElementById('closeDocModal'),
        closeFooter: document.getElementById('closeDocFooterBtn'),
        title: document.getElementById('docModalTitle'),
        content: document.getElementById('docModalContent'),
        download: document.getElementById('docDownloadLink')
    },
    actions: {
        addReport: document.getElementById('addReportBtn'),
        sendReminder: document.getElementById('sendReminderBtn'),
        openAddUnit: document.getElementById('openAddUnitModal'),
        saveUnit: document.getElementById('saveUnitBtn')
    },
    unitModal: {
        overlay: document.getElementById('unitModal'),
        form: document.getElementById('unitForm'),
        title: document.getElementById('unitModalTitle'),
        name: document.getElementById('unitName'),
        pass: document.getElementById('unitPassword'),
        role: document.getElementById('unitRole'),
        editOriginal: document.getElementById('editOriginalUsername')
    }
};

/* --- Initialization --- */
async function init() {
    try {
        await loadData();
        setupEventListeners();

        // Set current date
        DOM.dashboard.date.innerText = new Date().toLocaleDateString('en-US', CONFIG.DATE_OPTIONS);

        if (store.session) {
            launchDashboard();
        }
    } catch (err) {
        console.error('Initialization failed', err);
        toast('System initialization failed. Please refresh.', 'error');
    }
}

/* --- Data Layer --- */
async function loadData() {
    try {
        const response = await fetch(CONFIG.API_DB_ENDPOINT, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        store = normalizeLoadedStore(payload);
    } catch (err) {
        console.error('Database load failed', err);
        store = normalizeLoadedStore(null);
        toast('Database unavailable. Using fallback session.', 'error');
    }
}

function commit() {
    commitQueue = commitQueue
        .then(async () => {
            const response = await fetch(CONFIG.API_DB_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(store)
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
        })
        .catch((err) => {
            console.error('Database save failed', err);
            toast('Data could not be saved to JSON database.', 'error');
        });

    return commitQueue;
}

function log(action, details = '') {
    const actor = store.session ? store.session.username : 'System';
    store.audit.unshift({
        id: Date.now(),
        actor,
        action,
        details,
        timestamp: formatDateTime()
    });
    // Keep audit log manageable
    if (store.audit.length > 200) store.audit.pop();
    commit();
    if (store.session) updateDashboard();
}

/* --- Authentication --- */
function setupEventListeners() {
    setupPasswordToggles();
    setupModalDismissals();
    setupUploadInteractions();

    // Login
    DOM.auth.loginForm.onsubmit = (e) => {
        e.preventDefault();
        const userIn = normalizeText(document.getElementById('loginUsername').value);
        const passIn = document.getElementById('loginPassword').value;

        if (!userIn || !passIn) return toast('Error: Username and password are required', 'error');

        const found = store.users.find(u => u.username.toLowerCase() === userIn.toLowerCase() && u.password === passIn);

        if (found) {
            store.session = found;
            commit();
            log('Login', 'User accessed the system');
            launchDashboard();
            toast(`Success: Welcome back, ${found.username}`);
        } else {
            toast('Error: Invalid credentials', 'error');
        }
    };

    // Dashboard Actions
    DOM.dashboard.logout.onclick = () => {
        log('Logout', 'User signed out');
        store.session = null;
        commit();
        location.reload();
    };

    // Admin Actions
    DOM.actions.addReport.onclick = createReport;
    DOM.actions.sendReminder.onclick = sendReminder;

    // Modal
    DOM.modal.close.onclick = closeModal;
    DOM.modal.cancel.onclick = closeModal;
    DOM.modal.fileInput.onchange = handleFileSelect;
    DOM.modal.confirm.onclick = handleFileUpload;
    DOM.docModal.close.onclick = closeDocumentModal;
    DOM.docModal.closeFooter.onclick = closeDocumentModal;

    // Unit Actions
    DOM.actions.openAddUnit.onclick = () => openUnitModal();
    DOM.actions.saveUnit.onclick = saveUnit;

    // Navbar Nav (Simple Tab Switcher)
    DOM.dashboard.navItems.forEach(item => {
        item.onclick = (e) => {
            e.preventDefault();
            const viewId = item.getAttribute('data-view');
            switchView(viewId);

            const active = document.querySelector('.nav-item.active');
            if (active) active.classList.remove('active');
            item.classList.add('active');
        };
    });
}

function setupUploadInteractions() {
    const zone = DOM.modal.dropZone;
    if (!zone) return;

    zone.onclick = () => DOM.modal.fileInput.click();

    ['dragenter', 'dragover'].forEach(evt => {
        zone.addEventListener(evt, (e) => {
            e.preventDefault();
            zone.classList.add('is-dragging');
        });
    });

    ['dragleave', 'drop'].forEach(evt => {
        zone.addEventListener(evt, (e) => {
            e.preventDefault();
            zone.classList.remove('is-dragging');
        });
    });

    zone.addEventListener('drop', (e) => {
        const file = e.dataTransfer?.files?.[0];
        if (!file) return;
        try {
            const transfer = new DataTransfer();
            transfer.items.add(file);
            DOM.modal.fileInput.files = transfer.files;
        } catch (_err) {
            // Fallback for environments without DataTransfer constructor support.
            handleFileSelect({ target: { files: [file] } });
            return;
        }
        handleFileSelect({ target: DOM.modal.fileInput });
    });
}

function setupModalDismissals() {
    window.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (!DOM.modal.overlay.classList.contains('hidden')) closeModal();
        if (!DOM.unitModal.overlay.classList.contains('hidden')) closeUnitModal();
        if (!DOM.docModal.overlay.classList.contains('hidden')) closeDocumentModal();
    });

    DOM.modal.overlay.addEventListener('click', (e) => {
        if (e.target === DOM.modal.overlay) closeModal();
    });

    DOM.unitModal.overlay.addEventListener('click', (e) => {
        if (e.target === DOM.unitModal.overlay) closeUnitModal();
    });

    DOM.docModal.overlay.addEventListener('click', (e) => {
        if (e.target === DOM.docModal.overlay) closeDocumentModal();
    });
}

function setupPasswordToggles() {
    document.querySelectorAll('.password-toggle').forEach(btn => {
        btn.onclick = () => {
            const targetId = btn.getAttribute('data-target');
            const input = document.getElementById(targetId);
            if (!input) return;

            const isHidden = input.type === 'password';
            input.type = isHidden ? 'text' : 'password';
            btn.innerHTML = isHidden ? '<i class="ri-eye-off-line"></i>' : '<i class="ri-eye-line"></i>';
            btn.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
        };
    });
}

function switchView(viewId) {
    // Hide all sections
    document.querySelectorAll('.view-section').forEach(s => s.classList.add('hidden'));

    // Show target section
    const target = document.getElementById(viewId);
    if (target) {
        target.classList.remove('hidden');

        // Update Title
        const labels = {
            'section-overview': 'Dashboard Overview',
            'section-reports': 'Compliance Reports Registry',
            'section-inbox': 'Communication Feed',
            'section-audit': 'System Audit Trail',
            'section-units': 'Units Management'
        };
        document.getElementById('pageTitle').innerText = labels[viewId] || 'Dashboard';
    }

    updateDashboard();
}

/* --- Dashboard Engine --- */
function launchDashboard() {
    DOM.screens.auth.classList.add('hidden');
    DOM.screens.dashboard.classList.remove('hidden');

    const user = store.session;
    DOM.dashboard.userDisplay.innerText = user.username;
    DOM.dashboard.roleDisplay.innerText = user.role === 'admin' ? 'Administrator' : 'Compliance Unit';

    // Role Based Controls
    if (user.role === 'admin') {
        DOM.dashboard.adminNav.classList.remove('hidden');
        DOM.dashboard.adminPanel.classList.remove('hidden');
        populateSelectors();
    }

    updateDashboard();
}

function updateDashboard() {
    if (!store.session) return;
    renderStats();
    renderReports();
    renderInbox();
    if (store.session.role === 'admin') {
        renderAudit();
        renderUnits();
    }
}

function renderStats() {
    const role = store.session.role;
    const myReports = role === 'admin' ? store.reports : store.reports.filter(r => r.unit === store.session.unit);

    const total = myReports.length;
    const pending = myReports.filter(r => r.status === 'pending').length;
    const completed = myReports.filter(r => r.status === 'completed').length;

    const myMessages = store.inbox.filter(m => m.to === store.session.unit || store.session.role === 'admin');

    DOM.stats.total.innerText = total;
    DOM.stats.pending.innerText = pending;
    DOM.stats.completed.innerText = completed;
    DOM.stats.messages.innerText = myMessages.length;

    // Sidebar Badges
    const pendingBadge = document.getElementById('pendingCountBadge');
    if (pendingBadge) {
        pendingBadge.innerText = pending;
        pendingBadge.style.display = pending > 0 ? 'block' : 'none';
    }
}

function renderReports() {
    const role = store.session.role;
    const data = role === 'admin' ? store.reports : store.reports.filter(r => r.unit === store.session.unit);

    DOM.data.reportsBody.innerHTML = data.length ? data.map(r => `
        <tr>
            <td data-label="ID Ref"><strong>#${r.id}</strong></td>
            <td data-label="Unit">${escapeHtml(r.unit)}</td>
            <td data-label="Deadline">${escapeHtml(r.dueDate)}</td>
            <td data-label="Status"><span class="status status-${escapeHtml(r.status)}">${escapeHtml(r.status)}</span></td>
            <td data-label="Docs">
                ${r.file && r.fileData
            ? `<button class="btn btn-sm btn-outline" onclick="openDocument('${r.id}')"><i class="ri-eye-line"></i> ${escapeHtml(r.file)}</button>`
            : r.file
                ? `<span style="color:var(--slate-600)"><i class="ri-file-line"></i> ${escapeHtml(r.file)}</span>`
                : '<span style="color:var(--slate-400)">-</span>'}
            </td>
            <td data-label="Actions">
                <div class="table-actions">
                    ${role === 'unit' && r.status === 'pending'
            ? `<button class="btn btn-sm btn-outline" onclick="openUpload('${r.id}')"><i class="ri-upload-2-line"></i> Upload</button>`
            : ''}
                    ${role === 'admin'
            ? `<button class="btn btn-sm btn-outline" style="color:var(--danger)" onclick="deleteReport(${r.id})"><i class="ri-delete-bin-line"></i></button>`
            : ''}
                    ${r.status === 'completed' && role === 'unit' ? '<button class="btn btn-sm btn-outline" disabled><i class="ri-check-line"></i> Done</button>' : ''}
                </div>
            </td>
        </tr>
    `).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--slate-400);padding:20px;">No records found</td></tr>';
}

window.deleteReport = (id) => {
    if (!confirm('Are you sure you want to remove this report requirement?')) return;
    store.reports = store.reports.filter(r => r.id != id);
    commit();
    updateDashboard();
    toast('Report requirement deleted');
    log('Security', `Report requirement #${id} deleted by admin`);
};

function renderInbox() {
    const role = store.session.role;
    const myMsgs = role === 'admin' ? store.inbox : store.inbox.filter(m => m.to === store.session.unit || m.to === 'all');

    // Update Badge
    const badge = document.getElementById('notifBadge');
    if (myMsgs.length > 0) {
        badge.innerText = myMsgs.length;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }

    DOM.data.inboxList.innerHTML = myMsgs.length ? myMsgs.map(m => `
        <div class="feed-item">
            <i class="ri-notification-3-line feed-icon"></i>
            <div class="feed-content">
                <h4>${role === 'admin' ? `Notice to ${escapeHtml(m.to)}` : 'Admin Notice'}</h4>
                <p>${escapeHtml(m.msg)}</p>
                <span class="feed-time">${escapeHtml(m.time)}</span>
            </div>
        </div>
    `).join('') : '<div style="padding:20px;text-align:center;color:var(--slate-400)">All caught up!</div>';
}

function renderAudit() {
    if (!DOM.data.auditList) return;
    DOM.data.auditList.innerHTML = store.audit.map(a => `
        <div class="audit-item">
            <span class="audit-action">${escapeHtml(a.actor)}: ${escapeHtml(a.action)}</span>
            <span class="audit-meta">${escapeHtml(a.timestamp)}</span>
        </div>
    `).join('') || '<div style="padding:20px;text-align:center;color:var(--slate-400)">No logs yet.</div>';
}

function renderUnits() {
    const tbody = document.getElementById('unitsBody');
    if (!tbody) return;

    const units = store.users.map(u => `
        <tr>
            <td data-label="Unit Name"><strong>${escapeHtml(u.username)}</strong></td>
            <td data-label="Role"><span class="badge" style="background:${u.role === 'admin' ? 'var(--danger)' : 'var(--primary)'}; color:white;">${u.role.toUpperCase()}</span></td>
            <td data-label="Status"><span class="status status-completed">Active</span></td>
            <td data-label="Actions">
                ${u.username === 'kellie' ? '<span style="color:var(--slate-400)">System Owner</span>' : `
                    <div class="table-actions">
                        <button class="btn btn-sm btn-outline" onclick="openUnitModal(decodeURIComponent('${encodeURIComponent(u.username)}'))">
                            <i class="ri-edit-line"></i> Edit
                        </button>
                        <button class="btn btn-sm btn-outline" style="color:var(--danger)" onclick="deleteUser(decodeURIComponent('${encodeURIComponent(u.username)}'))">
                            <i class="ri-delete-bin-line"></i>
                        </button>
                    </div>
                `}
            </td>
        </tr>
    `).join('');

    tbody.innerHTML = units || '<tr><td colspan="4" style="text-align:center;">No units found</td></tr>';
}

/* --- Unit Management --- */
window.openUnitModal = (username = null) => {
    const isEdit = !!username;
    DOM.unitModal.title.innerHTML = isEdit ? '<i class="ri-edit-line"></i> Edit Unit' : '<i class="ri-user-add-line"></i> Add New Unit';
    DOM.unitModal.editOriginal.value = username || '';

    if (isEdit) {
        const user = store.users.find(u => u.username === username);
        if (!user) {
            toast('Error: Selected user could not be found', 'error');
            return;
        }
        DOM.unitModal.name.value = user.username;
        DOM.unitModal.pass.value = user.password;
        DOM.unitModal.role.value = user.role;
    } else {
        DOM.unitModal.form.reset();
        DOM.unitModal.editOriginal.value = '';
    }

    DOM.unitModal.overlay.classList.remove('hidden');
};

window.closeUnitModal = () => {
    DOM.unitModal.overlay.classList.add('hidden');
};

function saveUnit() {
    const originalUsername = DOM.unitModal.editOriginal.value;
    const name = normalizeText(DOM.unitModal.name.value);
    const pass = DOM.unitModal.pass.value;
    const role = DOM.unitModal.role.value;

    if (!name || !pass) return toast('Error: All fields are required', 'error');
    if (name.length < 3) return toast('Error: Username must be at least 3 characters', 'error');
    if (pass.length < CONFIG.MIN_PASSWORD_LENGTH) {
        return toast(`Error: Password must be at least ${CONFIG.MIN_PASSWORD_LENGTH} characters`, 'error');
    }

    // Check for duplicate if creating or changing name
    if (name !== originalUsername && store.users.some(u => u.username.toLowerCase() === name.toLowerCase())) {
        return toast('Error: Username already exists', 'error');
    }

    if (originalUsername) {
        // Update
        const index = store.users.findIndex(u => u.username === originalUsername);
        if (index === -1) {
            return toast('Error: Target user not found', 'error');
        }
        store.users[index] = { ...store.users[index], username: name, password: pass, role, unit: role === 'admin' ? 'System HQ' : name };
        toast('Unit updated successfully');
        log('Security', `User/Unit ${name} modified by admin`);
    } else {
        // Create
        store.users.push({ username: name, password: pass, role, unit: role === 'admin' ? 'System HQ' : name });
        toast('New unit added successfully');
        log('Security', `New unit ${name} created by admin`);
    }

    commit();
    updateDashboard();
    closeUnitModal();
    if (store.session.role === 'admin') populateSelectors(); // Update the dropdowns
}

window.deleteUser = (username) => {
    if (username === 'kellie') return toast('Cannot delete system owner', 'error');
    if (store.session?.username === username) return toast('Error: Cannot delete the active account', 'error');
    if (!confirm(`Are you sure you want to delete unit: ${username}?`)) return;

    store.users = store.users.filter(u => u.username !== username);
    commit();
    updateDashboard();
    if (store.session.role === 'admin') populateSelectors();
    toast(`Unit ${username} removed`);
    log('Security', `User/Unit ${username} deleted by admin`);
};

/* --- Actions --- */
function populateSelectors() {
    // Filter for non-admin users or users specifically marked as 'unit'
    const units = store.users.filter(u => u.role !== 'admin');

    const unitOptions = units.map(u => {
        const label = u.unit || u.username;
        return `<option value="${escapeHtml(label)}">${escapeHtml(label)}</option>`;
    }).join('');

    if (DOM.data.reportSelect) {
        DOM.data.reportSelect.innerHTML = unitOptions || '<option value="" disabled selected>No compliance units found</option>';
        DOM.actions.addReport.disabled = !unitOptions;
    }
    if (DOM.data.reminderSelect) {
        DOM.data.reminderSelect.innerHTML = `<option value="all">Broadcast to All</option>` + unitOptions;
    }
}

function createReport() {
    const unit = DOM.data.reportSelect.value;
    const date = document.getElementById('reportDueDate').value;

    if (!unit || !date) return toast('Error: Missing fields', 'error');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dueDate = new Date(date);
    if (Number.isNaN(dueDate.getTime())) return toast('Error: Invalid date selected', 'error');
    if (dueDate < today) return toast('Error: Due date cannot be in the past', 'error');

    store.reports.unshift({
        id: generateReportId(),
        unit,
        dueDate: date,
        status: 'pending',
        file: null
    });

    commit();
    updateDashboard();
    document.getElementById('reportDueDate').value = '';
    toast('Report requirement assigned successfully');
    log('Assign', `Created report task for ${unit}`);
}

function sendReminder() {
    const unit = DOM.data.reminderSelect.value;
    const msg = normalizeText(document.getElementById('reminderMessage').value);

    if (!unit || !msg) return toast('Error: Missing content', 'error');
    if (msg.length < 4) return toast('Error: Message is too short', 'error');

    store.inbox.unshift({
        to: unit,
        msg,
        time: formatDateTime()
    });

    commit();
    updateDashboard(); // Admin might want to see it in audit or separate sent box?
    document.getElementById('reminderMessage').value = '';
    toast(`Alert sent to ${unit}`);
    log('Communication', `Sent alert to ${unit}`);
}

/* --- Modal Logic --- */
let activeReportId = null;
let selectedUploadFile = null;
let activeDocumentReportId = null;

window.openDocument = (id) => {
    const report = store.reports.find(r => String(r.id) === String(id));
    if (!report || !report.file || !report.fileData) {
        return toast('Error: Document is not available', 'error');
    }

    activeDocumentReportId = id;
    DOM.docModal.title.innerHTML = `<i class="ri-file-text-line"></i> ${escapeHtml(report.file)}`;
    DOM.docModal.download.href = report.fileData;
    DOM.docModal.download.setAttribute('download', report.file);

    const ext = getFileExtension(report.file);
    if (ext === 'pdf') {
        DOM.docModal.content.innerHTML = `<iframe class="doc-modal-frame" src="${report.fileData}" title="${escapeHtml(report.file)}"></iframe>`;
    } else if (ext === 'csv') {
        const rawCsv = decodeDataUrlText(report.fileData);
        DOM.docModal.content.innerHTML = `<textarea class="doc-modal-csv" readonly></textarea>`;
        const ta = DOM.docModal.content.querySelector('textarea');
        if (ta) ta.value = rawCsv;
    } else {
        DOM.docModal.content.innerHTML = `
            <div class="doc-modal-fallback">
                <p><strong>Preview is not supported for this file type.</strong></p>
                <p style="margin-top:8px;">Use the Download button to open this file on your device.</p>
            </div>
        `;
    }

    DOM.docModal.overlay.classList.remove('hidden');
};

function closeDocumentModal() {
    DOM.docModal.overlay.classList.add('hidden');
    DOM.docModal.content.innerHTML = '';
    DOM.docModal.download.href = '#';
    DOM.docModal.download.removeAttribute('download');
    activeDocumentReportId = null;
}

window.openUpload = (id) => {
    const report = store.reports.find(r => String(r.id) === String(id));
    if (!report) return toast('Error: Report record not found', 'error');

    activeReportId = id;
    selectedUploadFile = null;
    DOM.modal.overlay.classList.remove('hidden');
};

function closeModal() {
    DOM.modal.overlay.classList.add('hidden');
    DOM.modal.preview.classList.add('hidden');
    DOM.modal.fileInput.value = '';
    activeReportId = null;
    selectedUploadFile = null;
}

function handleFileSelect(e) {
    const file = e?.target?.files?.[0] || null;
    if (!file) return;

    if (!isValidUploadFile(file)) {
        DOM.modal.fileInput.value = '';
        selectedUploadFile = null;
        DOM.modal.preview.classList.add('hidden');
        return toast('Error: Only PDF, XLSX, CSV files are allowed', 'error');
    }

    selectedUploadFile = file;
    DOM.modal.filename.innerText = file.name;
    DOM.modal.preview.classList.remove('hidden');
}

async function handleFileUpload() {
    if (!activeReportId) return toast('Error: No active report selected', 'error');

    const file = DOM.modal.fileInput.files[0] || selectedUploadFile;
    if (!file) return toast('Please select a file', 'error');
    if (!isValidUploadFile(file)) return toast('Error: Unsupported file type', 'error');

    const report = store.reports.find(r => r.id == activeReportId);
    if (report) {
        try {
            const fileData = await readFileAsDataURL(file);
            report.status = 'completed';
            report.file = file.name;
            report.fileData = fileData;
            report.fileType = file.type || '';
            commit();
            updateDashboard();
            closeModal();
            toast('Document submitted successfully');
            log('Submission', `File ${file.name} uploaded for Ref #${report.id}`);
        } catch (err) {
            console.error(err);
            toast('Error: File could not be processed', 'error');
        }
    } else {
        toast('Error: Report not found during upload', 'error');
        closeModal();
    }
}

/* --- Utils --- */
function toast(msg, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    while (container.childElementCount >= CONFIG.MAX_TOASTS) {
        container.removeChild(container.firstElementChild);
    }

    const el = document.createElement('div');
    el.className = `toast toast-${type}`;

    const icon = document.createElement('i');
    icon.className = type === 'success' ? 'ri-checkbox-circle-line' : 'ri-error-warning-line';
    const text = document.createTextNode(` ${msg}`);
    el.appendChild(icon);
    el.appendChild(text);

    container.appendChild(el);
    setTimeout(() => el.remove(), 4000);
}

// Start
document.addEventListener('DOMContentLoaded', () => {
    void init();
});
