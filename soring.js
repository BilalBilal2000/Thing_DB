/********************
   * In-memory DB (no localStorage)
   ********************/
const DB = {
    settings: {
        eventTitle: 'Think Big Science Carnival 2025',
        subtitle: 'Project Evaluation System',
        welcomeTitle: 'Welcome to Think Big Science Carnival 2025',
        welcomeBody: 'Please read the instructions. Click below to enter your basic details and start evaluating assigned projects.',
        logoUrl: 'https://dummyimage.com/128x128/1f2a52/ffffff&text=SE',
        adminPass: 'admin123', // used for local admin login convenience only (not for GAS)
        gasUrl: 'https://script.google.com/macros/s/AKfycbxo6yIKzMLVP4x3h0kewjpRGteOzBN_8Rq_JHCDse_9_wJR7CMqRIWbaKM0CxYh_TRR/exec'
    },
    evaluators: [],
    projects: [],
    panels: [],
    rubricDefs: [
        { key: 'problem', label: 'Problem Statement Clarity' },
        { key: 'originality', label: 'Originality' },
        { key: 'description', label: 'Project Description Quality' },
        { key: 'method', label: 'Methodology & Design' },
        { key: 'impact', label: 'Practical Application / Impact' },
        { key: 'presentation', label: 'Presentation & Q&A' }
    ],
    results: [],
    evaluatorState: {},
    lastSync: null
};

/********************
 * GAS API wrapper (client-side)
 ********************/
const GAS_API = {
    baseUrl: '',
    setBase(url) { this.baseUrl = url; },
    async _fetchJson(opt) {
        if (!this.baseUrl) throw new Error('GAS URL not configured');
        const res = await fetch(this.baseUrl, opt);
        const text = await res.text();
        try { return JSON.parse(text); } catch (e) { throw new Error('Invalid JSON from server'); }
    },
    async getData() {
        if (!this.baseUrl) throw new Error('GAS URL not configured');
        const url = this.baseUrl + '?action=getData';
        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to fetch data from GAS');
        return await res.json();
    },
    async adminLogin(password) {
        if (!this.baseUrl) throw new Error('GAS URL not configured');
        return await this._fetchJson({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'adminLogin', password })
        });
    },
    async pushBulk(data, token) {
        if (!this.baseUrl) throw new Error('GAS URL not configured');
        return await this._fetchJson({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'bulk', token: token || '', data })
        });
    },
    async pushResult(result) {
        if (!this.baseUrl) throw new Error('GAS URL not configured');
        return await this._fetchJson({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'result', data: result })
        });
    }
};

/********************
 * Admin session - token kept in memory
 ********************/
let ADMIN_SESSION_TOKEN = null;

async function attemptLoadFromGAS() {
    try {
        if (DB.settings.gasUrl) {
            GAS_API.setBase(DB.settings.gasUrl);
        }
        if (!GAS_API.baseUrl) return;
        UI.showLoading('Loading data from server...');
        const data = await GAS_API.getData();
        if (data) {
            // merge server data into DB (authoritative)
            DB.settings = Object.assign(DB.settings, data.settings || {});
            DB.evaluators = data.evaluators || [];
            DB.projects = data.projects || [];
            DB.panels = data.panels || [];
            DB.results = data.results || [];
            DB.evaluatorState = data.evaluatorState || {};
            DB.lastSync = Date.now();
        }
    } catch (err) {
        console.warn('GAS load failed:', err);
        // silent fallback to in-memory sample data
    } finally {
        UI.hideLoading();
    }
}

async function saveToGASAsBulk() {
    if (!DB.settings.gasUrl) { alert('Set GAS URL in Settings first'); return; }
    if (!ADMIN_SESSION_TOKEN) {
        const pass = prompt('Enter admin password to sync to Google Sheets (this is the GAS ADMIN_PASS you set in Script Properties):', '');
        if (!pass) return;
        try {
            UI.showLoading('Authorizing admin...');
            const login = await GAS_API.adminLogin(pass);
            UI.hideLoading();
            if (!login.ok) { alert('Admin login failed: ' + (login.error || '')); return; }
            ADMIN_SESSION_TOKEN = login.token;
        } catch (e) {
            UI.hideLoading();
            alert('Admin auth failed: ' + e.message);
            return;
        }
    }
    try {
        UI.showLoading('Syncing data to Google Sheets...');
        const res = await GAS_API.pushBulk({
            settings: DB.settings,
            evaluators: DB.evaluators,
            projects: DB.projects,
            panels: DB.panels,
            results: DB.results,
            evaluatorState: DB.evaluatorState
        }, ADMIN_SESSION_TOKEN);
        UI.hideLoading();
        if (res && res.ok) {
            DB.lastSync = Date.now();
            alert('✓ Data synced to Google Sheets');
        } else {
            throw new Error(res && res.error ? res.error : 'Unknown error');
        }
    } catch (err) {
        UI.hideLoading();
        console.error('Bulk sync failed', err);
        alert('Sync failed: ' + (err.message || err));
    }
}

async function saveResultToGAS(result) {
    // store in memory first
    const idx = DB.results.findIndex(r => r.id === result.id);
    if (idx >= 0) DB.results[idx] = result; else DB.results.push(result);
    try {
        if (DB.settings.gasUrl) {
            await GAS_API.pushResult(result);
        }
    } catch (err) {
        console.warn('Result push failed (will remain local in-memory):', err);
    }
}

/********************
 * Utilities
 ********************/
const U = {
    uid: (type = 'item') => {
        const prefix = { project: 'PRJ', evaluator: 'EVAL', panel: 'PNL', result: 'RES' }[type] || 'ID';
        let count = 0;
        if (type === 'project') count = DB.projects.length + 1;
        else if (type === 'evaluator') count = DB.evaluators.length + 1;
        else if (type === 'panel') count = DB.panels.length + 1;
        else if (type === 'result') count = DB.results.length + 1;
        const num = String(count).padStart(4, '0');
        return `${prefix}-${num}`;
    },
    el: (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild },
    fmtDate: (ts) => new Date(ts).toLocaleString(),
    download(name, obj) {
        const blob = new Blob([typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
    },
    csv(rows) {
        const keys = [...new Set(rows.flatMap(r => Object.keys(r)))];
        const esc = (v) => ('' + (v ?? '')).replaceAll('"', '""');
        const out = [keys.join(',')].concat(rows.map(r => keys.map(k => `"${esc(r[k])}"`).join(',')));
        return out.join('\n');
    }
};

/********************
 * UI Module
 ********************/
const UI = {
    show(id) {
        document.querySelectorAll('.card, #evalApp, #adminApp').forEach(el => {
            if (el.id === id) el.classList.remove('hidden');
            else {
                if (el.id === 'evalApp' && id.startsWith('eval')) el.classList.remove('hidden');
                else el.classList.add('hidden');
            }
        });
        if (id === 'evalApp' || id.startsWith('eval')) document.getElementById('evalApp').classList.remove('hidden');
        this.syncBranding();
    },
    backToGate() {
        ['adminEmail', 'adminPass', 'evalEmail', 'evalCode'].forEach(id => { const el = document.getElementById(id); if (el) el.value = '' });
        Auth.currentAdmin = null;
        document.querySelectorAll('.card, #evalApp, #adminApp').forEach(el => el.classList.add('hidden'));
        document.getElementById('roleGate').classList.remove('hidden');
        this.syncBranding();
    },
    syncBranding() {
        document.getElementById('appTitle').textContent = DB.settings.eventTitle;
        document.getElementById('appSubtitle').textContent = DB.settings.subtitle;
        document.getElementById('appLogo').src = DB.settings.logoUrl || 'https://dummyimage.com/128x128/1f2a52/ffffff&text=SE';
        document.getElementById('welcomeTitle').textContent = DB.settings.welcomeTitle;
        document.getElementById('welcomeBody').textContent = DB.settings.welcomeBody;

        const uc = document.getElementById('userControls'); uc.innerHTML = '';
        if (Auth.currentAdmin) {
            uc.style.display = 'flex';
            uc.appendChild(U.el(`<div class="userBadge">Admin: ${Auth.currentAdmin.email || '—'}</div>`));
            const btn = U.el(`<button class="headerLogout">Logout</button>`); btn.onclick = () => Auth.logoutAdmin(); uc.appendChild(btn);
            return;
        }
        if (Auth.currentEval) {
            uc.style.display = 'flex';
            uc.appendChild(U.el(`<div class="userBadge">${Auth.currentEval.name || Auth.currentEval.email || 'Evaluator'}</div>`));
            const btn = U.el(`<button class="headerLogout">Logout</button>`); btn.onclick = () => Auth.logoutEvaluator(); uc.appendChild(btn);
            const eb = document.getElementById('evalBadge'); if (eb) { eb.textContent = Auth.currentEval.name || Auth.currentEval.email; eb.classList.remove('hidden'); }
            const ebbtn = document.getElementById('evalLogoutBtn'); if (ebbtn) ebbtn.classList.remove('hidden');
            return;
        }
        uc.style.display = 'none';
        const eb = document.getElementById('evalBadge'); if (eb) eb.classList.add('hidden');
        const ebbtn = document.getElementById('evalLogoutBtn'); if (ebbtn) ebbtn.classList.add('hidden');
    },
    showLoading(msg = 'Loading...') {
        const existing = document.getElementById('globalLoading');
        if (existing) existing.remove();
        const loader = U.el(`<div id="globalLoading" style="position:fixed;top:70px;right:16px;background:var(--card);border:1px solid var(--border);padding:12px 16px;border-radius:10px;z-index:100;box-shadow:0 4px 12px rgba(0,0,0,0.3)"><div style="display:flex;align-items:center;gap:10px"><span class="spinner"></span><span>${msg}</span></div></div>`);
        document.body.appendChild(loader);
    },
    hideLoading() {
        const loader = document.getElementById('globalLoading');
        if (loader) loader.remove();
    }
};

/********************
 * Auth Module
 ********************/
const Auth = {
    currentAdmin: null,
    currentEval: null,
    adminLogin() {
        const email = document.getElementById('adminEmail').value.trim();
        const pass = document.getElementById('adminPass').value.trim();
        const msg = document.getElementById('adminLoginMsg');
        // local admin login fallback (useful before GAS)
        if (pass === DB.settings.adminPass) {
            this.currentAdmin = { email }; UI.show('adminApp'); Admin.render(); msg.textContent = ''; UI.syncBranding();
        } else {
            msg.textContent = 'Invalid passcode.';
            msg.style.color = 'var(--bad)';
        }
    },
    async evaluatorLogin() {
        const email = document.getElementById('evalEmail').value.trim();
        const code = document.getElementById('evalCode').value.trim();
        const ev = DB.evaluators.find(e => e.email === email && String(e.code) === String(code));
        const msg = document.getElementById('evalLoginMsg');
        if (ev) {
            this.currentEval = ev; UI.show('evalApp'); UI.show('evalWelcome'); UI.syncBranding();
        } else { msg.textContent = 'No evaluator found for that email & code.'; msg.style.color = 'var(--bad)'; }
    },
    logoutAdmin() {
        if (!confirm('Logout admin?')) return;
        this.currentAdmin = null; UI.backToGate();
    },
    logoutEvaluator() {
        if (!confirm('Logout evaluator?')) return;
        this.currentEval = null;
        document.getElementById('profName').value = '';
        document.getElementById('profExpertise').value = '';
        document.getElementById('profNotes').value = '';
        document.getElementById('evalProjectTable').innerHTML = '';
        UI.backToGate();
    }
};

/********************
 * Admin Module (rendering largely unchanged)
 ********************/
const Admin = {
    tabs: [
        { id: 'scores', label: 'Scores' },
        { id: 'settings', label: 'Settings' },
        { id: 'projects', label: 'Projects' },
        { id: 'evaluators', label: 'Evaluators' },
        { id: 'panels', label: 'Jury Panels' },
        { id: 'data', label: 'Data & Export' }
    ],
    render() {
        const tabs = document.getElementById('adminTabs');
        tabs.innerHTML = '';
        this.tabs.forEach((t, i) => {
            const b = U.el(`<button class="tab ${i === 0 ? 'active' : ''}" data-id="${t.id}">${t.label}</button>`);
            b.onclick = (e) => this.switch(e.target.getAttribute('data-id'));
            tabs.appendChild(b);
        });
        this.switch('scores');
        UI.syncBranding();
    },
    switch(id) {
        document.querySelectorAll('#adminTabs .tab').forEach(tb => tb.classList.remove('active'));
        const targetTab = document.querySelector(`#adminTabs .tab[data-id="${id}"]`);
        if (targetTab) targetTab.classList.add('active');
        const v = document.getElementById('adminView');
        this[id](v);
        UI.syncBranding();
    },

    /* SCORES */
    scores(host) {
        const projectScores = DB.projects.map(project => {
            const projectResults = DB.results.filter(r => r.projectId === project.id);
            if (projectResults.length === 0) {
                return { id: project.id, title: project.title, category: project.category || '—', team: project.team || '—', school: project.school || '—', evaluatorCount: 0, totalScore: 0, averageScore: 0, maxPossible: DB.rubricDefs.length * 10, percentage: 0, evaluators: [] };
            }
            const totalScore = projectResults.reduce((sum, r) => sum + (r.total || 0), 0);
            const averageScore = totalScore / projectResults.length;
            const maxPossible = DB.rubricDefs.length * 10;
            const percentage = (averageScore / maxPossible) * 100;
            const evaluators = projectResults.map(r => {
                const evaluator = DB.evaluators.find(e => e.id === r.evaluatorId);
                return { name: evaluator?.name || evaluator?.email || 'Unknown', score: r.total || 0, finalized: r.finalizedByEvaluator };
            });
            return { id: project.id, title: project.title, category: project.category || '—', team: project.team || '—', school: project.school || '—', evaluatorCount: projectResults.length, totalScore, averageScore, maxPossible, percentage, evaluators };
        });

        projectScores.sort((a, b) => b.averageScore - a.averageScore);

        const rows = projectScores.map((ps, index) => {
            const isTop5 = index < 5 && ps.evaluatorCount > 0;
            const rowStyle = isTop5 ? 'background: linear-gradient(90deg, #1a2454, #0f1534); border-left: 4px solid #7c9cff;' : '';
            const badge = isTop5 ? `<span class="pill" style="background:#7c9cff;color:#000;font-weight:700">TOP ${index + 1}</span>` : '';
            const evalDetails = ps.evaluators.length > 0 ? ps.evaluators.map(e => `${e.name}: <b>${e.score}</b>${e.finalized ? ' ✓' : ''}`).join('<br>') : '<span class="muted">No evaluations yet</span>';
            return `<tr style="${rowStyle}">
          <td>${badge}${badge ? '<br>' : ''}<b>${ps.title}</b><div class="hint" style="margin-top:4px">${ps.category}</div></td>
          <td>${ps.team}<div class="hint">${ps.school}</div></td>
          <td style="text-align:center"><span class="pill">${ps.evaluatorCount} evaluator${ps.evaluatorCount !== 1 ? 's' : ''}</span></td>
          <td style="text-align:right"><b style="font-size:18px;color:${isTop5 ? 'var(--acc)' : 'inherit'}">${ps.averageScore.toFixed(2)}</b><div class="hint">out of ${ps.maxPossible}</div></td>
          <td style="text-align:right"><b style="font-size:16px;color:${ps.percentage >= 80 ? 'var(--good)' : ps.percentage >= 60 ? '#fbbf24' : 'inherit'}">${ps.percentage.toFixed(1)}%</b></td>
          <td><button class="btn" onclick="Admin.viewProjectDetails('${ps.id}')">View Details</button></td>
        </tr>`;
        }).join('');

        const evaluatedProjects = projectScores.filter(ps => ps.evaluatorCount > 0);
        const avgScore = evaluatedProjects.length > 0 ? (evaluatedProjects.reduce((sum, ps) => sum + ps.averageScore, 0) / evaluatedProjects.length).toFixed(2) : '—';

        const summary = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:16px">
          <div class="card" style="background:#1a2454">
            <div class="hint">Total Projects</div>
            <div style="font-size:28px;font-weight:700;margin-top:4px">${DB.projects.length}</div>
          </div>
          <div class="card" style="background:#1a2454">
            <div class="hint">Projects Evaluated</div>
            <div style="font-size:28px;font-weight:700;margin-top:4px">${evaluatedProjects.length}</div>
          </div>
          <div class="card" style="background:#1a2454">
            <div class="hint">Total Evaluations</div>
            <div style="font-size:28px;font-weight:700;margin-top:4px">${DB.results.length}</div>
          </div>
          <div class="card" style="background:#1a2454">
            <div class="hint">Average Score</div>
            <div style="font-size:28px;font-weight:700;margin-top:4px">${avgScore}</div>
          </div>
        </div>
      `;

        host.innerHTML = `
        ${summary}
        <div class="card">
          <div class="flex-between" style="margin-bottom:12px">
            <h3>Project Scores (Ranked by Average)</h3>
            <div class="toolbar">
              <button class="btn" onclick="Admin.exportScores()">Export Scores</button>
              <button class="btn danger" onclick="Admin.clearScores()">Clear All Scores</button>
              <button class="btn secondary" onclick="Admin.refreshScores()">Refresh</button>
            </div>
          </div>
          <div class="hint" style="margin-bottom:12px">
            Top 5 projects are highlighted. Scores are averaged from all evaluator submissions.
          </div>
          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Team</th>
                  <th>Evaluations</th>
                  <th style="text-align:right">Avg Score</th>
                  <th style="text-align:right">Percentage</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${rows || '<tr><td colspan="6" class="muted" style="text-align:center;padding:20px">No projects or evaluations yet.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      `;
    },

    viewProjectDetails(projectId) {
        const project = DB.projects.find(p => p.id === projectId);
        if (!project) { alert('Project not found'); return; }
        const projectResults = DB.results.filter(r => r.projectId === projectId);
        if (projectResults.length === 0) { alert('No evaluations found for this project'); return; }
        const rubricAggregates = {};
        DB.rubricDefs.forEach(def => {
            const scores = projectResults.map(r => r.scores?.[def.key] || 0);
            const sum = scores.reduce((a, b) => a + b, 0);
            const avg = sum / scores.length;
            rubricAggregates[def.key] = { label: def.label, scores, average: avg, max: 10 };
        });
        const totalAvg = Object.values(rubricAggregates).reduce((sum, agg) => sum + agg.average, 0);
        const maxTotal = DB.rubricDefs.length * 10;
        const percentage = (totalAvg / maxTotal) * 100;
        const evaluatorRows = projectResults.map(r => {
            const evaluator = DB.evaluators.find(e => e.id === r.evaluatorId);
            const evalName = evaluator?.name || evaluator?.email || 'Unknown';
            const scoreBreakdown = DB.rubricDefs.map(def => `<div style="margin:4px 0"><span class="hint">${def.label}:</span> <b>${r.scores?.[def.key] || 0}</b>/10</div>`).join('');
            return `
          <div class="card" style="margin-bottom:10px">
            <div class="flex-between">
              <div>
                <b>${evalName}</b>
                ${r.finalizedByEvaluator ? '<span class="pill success" style="margin-left:8px">✓ Finalized</span>' : '<span class="pill" style="margin-left:8px">Draft</span>'}
              </div>
              <div style="text-align:right">
                <div style="font-size:20px;font-weight:700">${r.total || 0}</div>
                <div class="hint">out of ${maxTotal}</div>
              </div>
            </div>
            <div style="margin-top:12px;display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px">
              ${scoreBreakdown}
            </div>
            ${r.remark ? `<div style="margin-top:12px;padding:10px;background:#0e1430;border-radius:8px;border:1px solid var(--chip-border)"><div class="hint">Remark:</div>${r.remark}</div>` : ''}
          </div>
        `;
        }).join('');

        const aggregateTable = `
        <table>
          <thead>
            <tr>
              <th>Criterion</th>
              <th style="text-align:right">Average Score</th>
              <th style="text-align:right">Individual Scores</th>
            </tr>
          </thead>
          <tbody>
            ${DB.rubricDefs.map(def => {
            const agg = rubricAggregates[def.key];
            return `<tr>
                <td>${agg.label}</td>
                <td style="text-align:right"><b style="font-size:16px">${agg.average.toFixed(2)}</b> / 10</td>
                <td style="text-align:right">${agg.scores.join(', ')}</td>
              </tr>`;
        }).join('')}
            <tr style="background:#1a2454;font-weight:700">
              <td>TOTAL</td>
              <td style="text-align:right;font-size:18px;color:var(--acc)">${totalAvg.toFixed(2)} / ${maxTotal}</td>
              <td style="text-align:right;font-size:16px">${percentage.toFixed(1)}%</td>
            </tr>
          </tbody>
        </table>
      `;

        const dlg = U.el(`
        <div class="modal-wrap">
          <div class="modal" style="max-width:1100px">
            <h2>${project.title}</h2>
            <div class="hint" style="margin-bottom:16px">
              <b>Team:</b> ${project.team || '—'} | <b>School:</b> ${project.school || '—'} | <b>Category:</b> ${project.category || '—'}
            </div>

            <h3 style="margin-top:20px">Score Summary</h3>
            <div class="card">
              ${aggregateTable}
            </div>

            <h3 style="margin-top:20px">Individual Evaluations (${projectResults.length})</h3>
            ${evaluatorRows}

            <div class="toolbar" style="margin-top:16px">
              <button class="btn secondary" id="closeDetails">Close</button>
            </div>
          </div>
        </div>
      `);

        document.body.appendChild(dlg);
        dlg.querySelector('#closeDetails').onclick = () => dlg.remove();
    },

    exportScores() {
        const projectScores = DB.projects.map(project => {
            const projectResults = DB.results.filter(r => r.projectId === project.id);
            if (projectResults.length === 0) {
                return { 'Project ID': project.id, 'Project Title': project.title, 'Category': project.category || '', 'Team': project.team || '', 'School': project.school || '', 'Number of Evaluators': 0, 'Average Score': 0, 'Max Possible': DB.rubricDefs.length * 10, 'Percentage': 0 };
            }
            const totalScore = projectResults.reduce((sum, r) => sum + (r.total || 0), 0);
            const averageScore = totalScore / projectResults.length;
            const maxPossible = DB.rubricDefs.length * 10;
            const percentage = (averageScore / maxPossible) * 100;
            return { 'Project ID': project.id, 'Project Title': project.title, 'Category': project.category || '', 'Team': project.team || '', 'School': project.school || '', 'Number of Evaluators': projectResults.length, 'Average Score': averageScore.toFixed(2), 'Max Possible': maxPossible, 'Percentage': percentage.toFixed(1) + '%' };
        });
        projectScores.sort((a, b) => parseFloat(b['Average Score']) - parseFloat(a['Average Score']));
        U.download('project_scores.csv', U.csv(projectScores));
        alert('✓ Scores exported successfully!');
    },

    refreshScores() { this.scores(document.getElementById('adminView')); },

    clearScores() {
        if (!confirm('⚠️ WARNING: This will delete ALL evaluation scores and results.\n\nProjects, evaluators, and panels will remain intact.\n\nProceed with deleting all scores?')) return;
        if (!confirm('⚠️ FINAL CONFIRMATION\n\nDelete all evaluation results?\n\nThis cannot be undone!')) return;
        DB.results = [];
        DB.evaluatorState = {};
        alert('✓ All scores have been cleared successfully.\n\nProjects, evaluators, and panels are still available.');
        this.scores(document.getElementById('adminView'));
    },

    /* SETTINGS */
    settings(host) {
        const syncStatus = DB.lastSync ? `Last synced: ${U.fmtDate(DB.lastSync)}` : 'Never synced';
        host.innerHTML = `
        <div class="row">
          <div class="col-6 card">
            <h3>Branding & Content</h3>
            <label>Event Title</label>
            <input id="setEventTitle" value="${DB.settings.eventTitle}">
            <label>Subtitle</label>
            <input id="setSubtitle" value="${DB.settings.subtitle}">
            <label>Logo URL</label>
            <input id="setLogo" value="${DB.settings.logoUrl}">
            <label>Welcome Title</label>
            <input id="setWelcomeTitle" value="${DB.settings.welcomeTitle}">
            <label>Welcome Body</label>
            <textarea id="setWelcomeBody">${DB.settings.welcomeBody}</textarea>
            <div class="toolbar" style="margin-top:10px">
              <button class="btn" onclick="Admin.saveSettings()">Save</button>
              <button class="btn secondary" onclick="Admin.resetBranding()">Reset Defaults</button>
            </div>
          </div>

          <div class="col-6 card">
            <h3>Security & GAS Integration</h3>
            <label>Admin Passcode (local)</label>
            <input id="setAdminPass" type="password" value="${DB.settings.adminPass}">
            <label>Google Apps Script Web App URL</label>
            <input id="setGasUrl" placeholder="https://script.google.com/macros/s/.../exec" value="${DB.settings.gasUrl || ''}">
            <div class="hint">Deploy your GAS as a Web App and paste the URL here. Data will sync automatically when you click Sync Now (admin password required).</div>
            <div class="hint" style="margin-top:4px;color:var(--acc)">${syncStatus}</div>
            <div class="toolbar" style="margin-top:10px">
              <button class="btn" onclick="Admin.saveSettings()">Save</button>
              <button class="btn" onclick="saveToGASAsBulk()">Sync Now</button>
            </div>
            
            <h3 style="margin-top:20px">System Tools</h3>
            <div class="hint">Use these tools to manage your system data.</div>
            <div class="toolbar" style="margin-top:10px">
              <button class="btn secondary" onclick="Admin.migrateIDs()">Fix IDs to Simple Format</button>
              <button class="btn danger" onclick="Admin.resetAllData()">Reset All Data</button>
            </div>
          </div>
        </div>
      `;
    },
    saveSettings() {
        DB.settings.eventTitle = document.getElementById('setEventTitle').value.trim();
        DB.settings.subtitle = document.getElementById('setSubtitle').value.trim();
        DB.settings.logoUrl = document.getElementById('setLogo').value.trim();
        DB.settings.welcomeTitle = document.getElementById('setWelcomeTitle').value.trim();
        DB.settings.welcomeBody = document.getElementById('setWelcomeBody').value.trim();
        DB.settings.adminPass = document.getElementById('setAdminPass').value.trim();
        DB.settings.gasUrl = document.getElementById('setGasUrl').value.trim();
        if (DB.settings.gasUrl) GAS_API.setBase(DB.settings.gasUrl);
        UI.syncBranding();
        alert('✓ Settings saved (in-memory). To persist to Google Sheets, click Sync Now (admin password required).');
    },
    resetBranding() {
        if (!confirm('Reset all branding to defaults?')) return;
        DB.settings.eventTitle = 'Think Big Science Carnival 2025';
        DB.settings.subtitle = 'Project Evaluation System';
        DB.settings.logoUrl = 'https://dummyimage.com/128x128/1f2a52/ffffff&text=SE';
        DB.settings.welcomeTitle = 'Welcome to Think Big Science Carnival 2025';
        DB.settings.welcomeBody = 'Please read the instructions. Click below to enter your basic details and start evaluating assigned projects.';
        UI.syncBranding();
        this.settings(document.getElementById('adminView'));
    },

    resetAllData() {
        if (!confirm('⚠️ WARNING: This will permanently delete ALL DATA including:\n\n• All Projects\n• All Evaluators\n• All Panels\n• All Evaluation Results\n• All Scores\n\nThis action CANNOT be undone!\n\nClick OK to proceed with deletion.')) return;
        if (!confirm('⚠️ FINAL CONFIRMATION\n\nAre you absolutely sure you want to delete everything?\n\nThis is your last chance to cancel!')) return;
        DB.evaluators = [];
        DB.projects = [];
        DB.panels = [];
        DB.results = [];
        DB.evaluatorState = {};
        alert('✓ All data has been deleted successfully.\n\nThe system has been reset to empty state.');
        this.switch('scores');
    },

    /* PROJECTS */
    projects(host) {
        const list = DB.projects.map(p => `
        <tr>
          <td><b>${p.title}</b><div class="hint">${p.category || ''}</div></td>
          <td>${p.team || ''}</td>
          <td>${p.school || ''}</td>
          <td>${p.contact || ''}</td>
          <td>
            <div class="toolbar">
              <button class="btn" onclick="Admin.editProject('${p.id}')">Edit</button>
              <button class="btn danger" onclick="Admin.deleteProject('${p.id}')">Delete</button>
            </div>
          </td>
        </tr>`).join('');
        host.innerHTML = `
        <div class="toolbar" style="margin-bottom:10px">
          <button class="btn" onclick="Admin.editProject()">Add Project</button>
        </div>
        <div class="card">
          <h3>Projects (${DB.projects.length})</h3>
          <div class="table-wrapper">
            <table>
              <thead><tr><th>Project</th><th>Team</th><th>School</th><th>Contact</th><th>Actions</th></tr></thead>
              <tbody>${list || '<tr><td colspan="5" class="muted" style="text-align:center;padding:20px">No projects yet.</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      `;
    },
    editProject(id) {
        const p = id ? DB.projects.find(x => x.id === id) : { id: U.uid('project'), title: '', category: '', team: '', school: '', contact: '' };
        const dlg = U.el(`
        <div class="modal-wrap">
          <div class="modal">
            <h3>${id ? 'Edit' : 'Add'} Project</h3>
            <div class="hint" style="margin-bottom:12px">ID: <b>${p.id}</b></div>
            <label>Title *</label><input id="p_title" value="${p.title}">
            <label>Category</label><input id="p_cat" value="${p.category}" placeholder="e.g. IoT, AI/ML, Environment">
            <label>Team Name</label><input id="p_team" value="${p.team}">
            <label>School</label><input id="p_school" value="${p.school}">
            <label>Contact</label><input id="p_contact" value="${p.contact}" placeholder="email or phone">
            <div class="toolbar" style="margin-top:12px">
              <button class="btn" id="saveBtn">Save</button>
              <button class="btn secondary" id="cancelBtn">Cancel</button>
            </div>
          </div>
        </div>`);
        document.body.appendChild(dlg);
        dlg.querySelector('#cancelBtn').onclick = () => dlg.remove();
        dlg.querySelector('#saveBtn').onclick = async () => {
            p.title = dlg.querySelector('#p_title').value.trim();
            p.category = dlg.querySelector('#p_cat').value.trim();
            p.team = dlg.querySelector('#p_team').value.trim();
            p.school = dlg.querySelector('#p_school').value.trim();
            p.contact = dlg.querySelector('#p_contact').value.trim();
            if (!p.title) { alert('Title is required'); return }
            if (!id) DB.projects.push(p);
            dlg.remove();
            Admin.projects(document.getElementById('adminView'));
        }
        dlg.querySelector('#p_title').focus();
    },
    deleteProject(id) {
        if (!confirm('Delete this project? This will also remove it from all panels.')) return;
        DB.projects = DB.projects.filter(p => p.id !== id);
        DB.panels.forEach(pa => pa.projectIds = pa.projectIds.filter(pid => pid !== id));
        this.projects(document.getElementById('adminView'));
    },

    /* EVALUATORS */
    evaluators(host) {
        const list = DB.evaluators.map(e => `
        <tr>
          <td><b>${e.name || '(no name)'}</b><div class="hint">${e.email}</div></td>
          <td>${e.expertise || '—'}</td>
          <td><span class="pill">Code: ${e.code}</span></td>
          <td>
            <div class="toolbar">
              <button class="btn" onclick="Admin.editEvaluator('${e.id}')">Edit</button>
              <button class="btn danger" onclick="Admin.deleteEvaluator('${e.id}')">Delete</button>
            </div>
          </td>
        </tr>`).join('');
        host.innerHTML = `
        <div class="toolbar" style="margin-bottom:10px">
          <button class="btn" onclick="Admin.bulkAddEvaluators()">Quick Add (CSV)</button>
          <button class="btn" onclick="Admin.editEvaluator()">Add Evaluator</button>
        </div>
        <div class="card">
          <h3>Evaluators (${DB.evaluators.length})</h3>
          <div class="table-wrapper">
            <table>
              <thead><tr><th>Evaluator</th><th>Expertise</th><th>Access Code</th><th>Actions</th></tr></thead>
              <tbody>${list || '<tr><td colspan="4" class="muted" style="text-align:center;padding:20px">No evaluators yet.</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      `;
    },
    editEvaluator(id) {
        const e = id ? DB.evaluators.find(x => x.id === id) : { id: U.uid('evaluator'), name: '', email: '', expertise: '', notes: '', code: Math.floor(100000 + Math.random() * 900000) };
        const dlg = U.el(`
        <div class="modal-wrap">
          <div class="modal">
            <h3>${id ? 'Edit' : 'Add'} Evaluator</h3>
            <div class="hint" style="margin-bottom:12px">ID: <b>${e.id}</b></div>
            <label>Name *</label><input id="e_name" value="${e.name}">
            <label>Email *</label><input id="e_email" value="${e.email}" type="email">
            <label>Expertise</label><input id="e_ex" value="${e.expertise}" placeholder="e.g. Robotics, AI">
            <label>Access Code</label><input id="e_code" value="${e.code}">
            <label>Notes</label><textarea id="e_notes">${e.notes || ''}</textarea>
            <div class="toolbar" style="margin-top:12px">
              <button class="btn" id="saveBtn">Save</button>
              <button class="btn secondary" id="cancelBtn">Cancel</button>
            </div>
          </div>
        </div>`);
        document.body.appendChild(dlg);
        dlg.querySelector('#cancelBtn').onclick = () => dlg.remove();
        dlg.querySelector('#saveBtn').onclick = () => {
            e.name = dlg.querySelector('#e_name').value.trim();
            e.email = dlg.querySelector('#e_email').value.trim();
            e.expertise = dlg.querySelector('#e_ex').value.trim();
            e.code = dlg.querySelector('#e_code').value.trim();
            e.notes = dlg.querySelector('#e_notes').value.trim();
            if (!e.email) { alert('Email required'); return }
            if (!e.name) { alert('Name required'); return }
            if (!id) DB.evaluators.push(e);
            dlg.remove(); Admin.evaluators(document.getElementById('adminView'))
        }
        dlg.querySelector('#e_name').focus();
    },
    deleteEvaluator(id) {
        if (!confirm('Delete this evaluator? This will also remove them from all panels.')) return;
        DB.evaluators = DB.evaluators.filter(e => e.id !== id);
        DB.panels.forEach(pa => pa.evaluatorIds = pa.evaluatorIds.filter(eid => eid !== id));
        this.evaluators(document.getElementById('adminView'))
    },
    bulkAddEvaluators() {
        const sample = 'name,email,expertise\nJane Doe,jane@ex.com,Robotics\nJohn Smith,john@ex.com,Biology';
        const text = prompt('Paste CSV with columns: name,email,expertise\n\nExample:\n' + sample, '');
        if (!text) return;
        const lines = text.split(/\r?\n/).filter(Boolean);
        if (lines.length < 2) { alert('Need at least header + 1 data row'); return }
        const head = lines.shift().split(',').map(h => h.trim());
        let added = 0;
        lines.forEach(line => {
            const cols = line.split(',');
            if (cols.length < 2) return;
            const e = { id: U.uid('evaluator'), code: Math.floor(100000 + Math.random() * 900000), notes: '' };
            head.forEach((h, i) => e[h] = cols[i]?.trim() || '');
            if (e.email) {
                DB.evaluators.push(e);
                added++;
            }
        });
        alert(`Added ${added} evaluators`);
        this.evaluators(document.getElementById('adminView'))
    },

    /* PANELS */
    panels(host) {
        const list = DB.panels.map(pa => {
            const evaluators = pa.evaluatorIds.map(id => DB.evaluators.find(e => e.id === id)).filter(e => e);
            const projects = pa.projectIds.map(id => DB.projects.find(p => p.id === id)).filter(p => p);
            const evalNames = evaluators.map(e => e.name || e.email).join(', ');
            const projTitles = projects.map(p => p.title).join(', ');
            const evalCount = evaluators.length;
            const projCount = projects.length;
            return `<tr>
          <td><b>${pa.name}</b><div class="hint" style="margin-top:4px">${pa.id}</div></td>
          <td><span class="pill">${evalCount} member${evalCount !== 1 ? 's' : ''}</span><div class="hint" style="margin-top:4px">${evalNames || '<span class="muted">none</span>'}</div></td>
          <td><span class="pill">${projCount} project${projCount !== 1 ? 's' : ''}</span><div class="hint" style="margin-top:4px">${projTitles || '<span class="muted">none</span>'}</div></td>
          <td><div class="toolbar"><button class="btn" onclick="Admin.editPanel('${pa.id}')">Edit</button><button class="btn danger" onclick="Admin.deletePanel('${pa.id}')">Delete</button></div></td>
        </tr>`
        }).join('');
        host.innerHTML = `
        <div class="toolbar" style="margin-bottom:10px">
          <button class="btn" onclick="Admin.editPanel()">Create Panel</button>
        </div>
        <div class="card">
          <h3>Jury Panels (${DB.panels.length})</h3>
          <div class="table-wrapper">
            <table>
              <thead><tr><th>Panel</th><th>Evaluators</th><th>Projects</th><th>Actions</th></tr></thead>
              <tbody>${list || '<tr><td colspan="4" class="muted" style="text-align:center;padding:20px">No panels yet.</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      `;
    },
    editPanel(id) {
        const pa = id ? DB.panels.find(x => x.id === id) : { id: U.uid('panel'), name: 'Panel ' + (DB.panels.length + 1), evaluatorIds: [], projectIds: [] };
        const evalOpts = DB.evaluators.map(e => `<label class="chip" style="cursor:pointer"><input type="checkbox" data-eid value="${e.id}" style="width:auto;margin-right:6px"> ${e.name || e.email}</label>`).join(' ');
        const projOpts = DB.projects.map(p => `<label class="chip" style="cursor:pointer"><input type="checkbox" data-pid value="${p.id}" style="width:auto;margin-right:6px"> ${p.title}</label>`).join(' ');
        const dlg = U.el(`
        <div class="modal-wrap">
          <div class="modal">
            <h3>${id ? 'Edit' : 'Create'} Jury Panel</h3>
            <div class="hint" style="margin-bottom:12px">ID: <b>${pa.id}</b></div>
            <label>Panel Name</label><input id="pa_name" value="${pa.name}">
            <label>Evaluators (select 3–4) *</label>
            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px">${evalOpts || '<div class="muted">Add evaluators first.</div>'}</div>
            <label style="margin-top:10px">Projects to Evaluate *</label>
            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px">${projOpts || '<div class="muted">Add projects first.</div>'}</div>
            <div class="toolbar" style="margin-top:12px">
              <button class="btn" id="saveBtn">Save Panel</button>
              <button class="btn secondary" id="cancelBtn">Cancel</button>
            </div>
          </div>
        </div>`);
        document.body.appendChild(dlg);
        dlg.querySelectorAll('[data-eid]').forEach(ch => { ch.checked = pa.evaluatorIds.includes(ch.value) });
        dlg.querySelectorAll('[data-pid]').forEach(ch => { ch.checked = pa.projectIds.includes(ch.value) });
        dlg.querySelector('#cancelBtn').onclick = () => dlg.remove();
        dlg.querySelector('#saveBtn').onclick = () => {
            pa.name = dlg.querySelector('#pa_name').value.trim() || pa.name;
            pa.evaluatorIds = [...dlg.querySelectorAll('[data-eid]:checked')].map(x => x.value);
            pa.projectIds = [...dlg.querySelectorAll('[data-pid]:checked')].map(x => x.value);
            if (pa.evaluatorIds.length < 3 || pa.evaluatorIds.length > 4) { alert('Select 3–4 evaluators for a jury panel.'); return }
            if (pa.projectIds.length === 0) { alert('Assign at least one project.'); return }
            if (!id) DB.panels.push(pa);
            dlg.remove(); Admin.panels(document.getElementById('adminView'))
        }
    },
    deletePanel(id) {
        if (!confirm('Delete this panel?')) return;
        DB.panels = DB.panels.filter(p => p.id !== id);
        this.panels(document.getElementById('adminView'))
    },

    /* DATA */
    data(host) {
        const rows = DB.results.map(r => ({
            id: r.id,
            panel: DB.panels.find(p => p.id === r.panelId)?.name || '—',
            project: DB.projects.find(p => p.id === r.projectId)?.title || '—',
            evaluator: DB.evaluators.find(e => e.id === r.evaluatorId)?.name || '—',
            total: r.total,
            remark: r.remark,
            finalized: r.finalizedByEvaluator ? 'Yes' : 'No',
            time: U.fmtDate(r.ts),
            ...r.scores
        }));
        host.innerHTML = `
        <div class="toolbar" style="margin-bottom:10px">
          <button class="btn" onclick='U.download("results.json", DB.results)'>Download JSON</button>
          <button class="btn" onclick='U.download("results.csv", U.csv(${JSON.stringify(rows)}))'>Download CSV</button>
          <button class="btn" onclick="saveToGASAsBulk()">Sync to Google Sheets</button>
        </div>
        <div class="card">
          <h3>Evaluation Results (${DB.results.length})</h3>
          <div class="table-wrapper">
            <table>
              <thead><tr><th>ID</th><th>Panel</th><th>Project</th><th>Evaluator</th><th>Total</th><th>Finalized</th><th>Time</th></tr></thead>
              <tbody>
                ${rows.map(r => `<tr><td>${r.id.slice(0, 8)}</td><td>${r.panel}</td><td>${r.project}</td><td>${r.evaluator}</td><td><b>${r.total}</b></td><td>${r.finalized}</td><td class="small">${r.time}</td></tr>`).join('') || '<tr><td colspan="7" class="muted" style="text-align:center;padding:20px">No submissions yet.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      `;
    },

    migrateIDs() {
        if (!confirm('This will convert all IDs to simple format (PRJ-0001, EVAL-0001, etc.)\n\nContinue?')) return;
        IDMigration.migrate();
    }
};

/********************
 * ID Migration (keeps behavior)
 ********************/
const IDMigration = {
    needsMigration() {
        const hasOldId = (arr) => arr.some(item => item.id && String(item.id).startsWith('id_'));
        return hasOldId(DB.projects) || hasOldId(DB.evaluators) || hasOldId(DB.panels) || hasOldId(DB.results);
    },
    migrate() {
        const idMap = { projects: {}, evaluators: {}, panels: {}, results: {} };
        DB.projects.forEach((p, idx) => { const old = p.id; const newId = `PRJ-${String(idx + 1).padStart(4, '0')}`; idMap.projects[old] = newId; p.id = newId; });
        DB.evaluators.forEach((e, idx) => { const old = e.id; const newId = `EVAL-${String(idx + 1).padStart(4, '0')}`; idMap.evaluators[old] = newId; e.id = newId; });
        DB.panels.forEach((p, idx) => { const old = p.id; const newId = `PNL-${String(idx + 1).padStart(4, '0')}`; idMap.panels[old] = newId; p.id = newId; p.evaluatorIds = p.evaluatorIds.map(eid => idMap.evaluators[eid] || eid); p.projectIds = p.projectIds.map(pid => idMap.projects[pid] || pid); });
        DB.results.forEach((r, idx) => { const old = r.id; const newId = `RES-${String(idx + 1).padStart(4, '0')}`; idMap.results[old] = newId; r.id = newId; r.panelId = idMap.panels[r.panelId] || r.panelId; r.projectId = idMap.projects[r.projectId] || r.projectId; r.evaluatorId = idMap.evaluators[r.evaluatorId] || r.evaluatorId; });
        const newState = {}; for (let oldEvalId in DB.evaluatorState) { const newEvalId = idMap.evaluators[oldEvalId] || oldEvalId; newState[newEvalId] = DB.evaluatorState[oldEvalId]; } DB.evaluatorState = newState;
        alert('✓ IDs migrated. Refreshing UI.');
        Admin.render();
    }
};

/********************
 * Evaluator Module (unchanged logic but uses in-memory DB + immediate GAS push)
 ********************/
const Eval = {
    currentProject: null,
    draft: null,
    showProfileForm() {
        UI.show('evalProfile');
        const ev = Auth.currentEval;
        if (ev) {
            document.getElementById('profName').value = ev.name || '';
            document.getElementById('profExpertise').value = ev.expertise || '';
            document.getElementById('profNotes').value = ev.notes || '';
        }
    },
    saveProfile() {
        const name = document.getElementById('profName').value.trim();
        const expertise = document.getElementById('profExpertise').value.trim();
        const notes = document.getElementById('profNotes').value.trim();
        if (!name) { document.getElementById('profMsg').textContent = 'Name is required.'; document.getElementById('profMsg').style.color = 'var(--bad)'; return; }
        Auth.currentEval.name = name; Auth.currentEval.expertise = expertise; Auth.currentEval.notes = notes;
        const idx = DB.evaluators.findIndex(e => e.id === Auth.currentEval.id);
        if (idx >= 0) DB.evaluators[idx] = Auth.currentEval;
        this.goToAssigned(); UI.syncBranding();
    },
    _evaluatorFinalized() {
        return (DB.evaluatorState && DB.evaluatorState[Auth.currentEval.id] && DB.evaluatorState[Auth.currentEval.id].finalizedAll) === true;
    },
    goToAssigned() {
        UI.show('evalProjects');
        const myPanels = DB.panels.filter(p => p.evaluatorIds.includes(Auth.currentEval.id));
        const myProjectIds = [...new Set(myPanels.flatMap(p => p.projectIds))];
        const total = myProjectIds.length;
        const completed = DB.results.filter(r => r.evaluatorId === Auth.currentEval.id && myProjectIds.includes(r.projectId)).length;
        const left = Math.max(0, total - completed);
        const pct = total === 0 ? 0 : Math.round((completed / total) * 100);
        document.getElementById('progressFill').style.width = pct + '%';
        document.getElementById('progressCount').textContent = `${completed} / ${total} completed (${pct}%)`;
        document.getElementById('leftCount').textContent = `${left} left to evaluate`;
        const rows = myProjectIds.map(pid => {
            const p = DB.projects.find(x => x.id === pid) || { title: '(missing)' };
            const submitted = DB.results.find(r => r.projectId === pid && r.evaluatorId === Auth.currentEval.id);
            if (submitted) {
                return `<tr>
            <td><b>${p.title}</b><div class="hint">${p.category || ''}</div></td>
            <td>${p.team || '—'}</td>
            <td>${p.school || '—'}</td>
            <td><span class="pill success">Submitted</span></td>
            <td>
              <div class="toolbar">
                <button class="btn" onclick="Eval.openViewOnlyModalByProject('${pid}')">View</button>
              </div>
            </td>
          </tr>`;
            } else {
                return `<tr>
            <td><b>${p.title}</b><div class="hint">${p.category || ''}</div></td>
            <td>${p.team || '—'}</td>
            <td>${p.school || '—'}</td>
            <td><span class="pill">Pending</span></td>
            <td>
              <div class="toolbar">
                <button class="btn" onclick="Eval.openRubricModal('${pid}')">Evaluate</button>
              </div>
            </td>
          </tr>`;
            }
        }).join('');
        document.getElementById('evalProjectTable').innerHTML = `
        <table>
          <thead><tr><th>Project</th><th>Team</th><th>School</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5" class="muted" style="text-align:center;padding:20px">No projects assigned yet.</td></tr>'}</tbody>
        </table>`;
        const toolbar = document.getElementById('evalToolbar'); toolbar.innerHTML = '';
        if (this._evaluatorFinalized()) {
            toolbar.appendChild(U.el(`<div style="flex:1"></div>`));
            const logoutBtn = U.el(`<button class="btn secondary">Logout</button>`); logoutBtn.onclick = () => Auth.logoutEvaluator();
            toolbar.appendChild(logoutBtn);
            return;
        }
        const proceedBtn = U.el(`<button class="btn" id="proceedFinalizeBtn">Proceed to Finalize</button>`);
        proceedBtn.onclick = () => this.openFinalizeModal();
        const spacer = U.el(`<div style="flex:1"></div>`);
        const logoutBtn = U.el(`<button class="btn secondary">Logout</button>`); logoutBtn.onclick = () => Auth.logoutEvaluator();
        toolbar.appendChild(proceedBtn); toolbar.appendChild(spacer); toolbar.appendChild(logoutBtn);
    },
    openRubricModal(projectId) {
        const project = DB.projects.find(p => p.id === projectId) || { title: '(missing)' };
        const panel = DB.panels.find(p => p.projectIds.includes(projectId) && p.evaluatorIds.includes(Auth.currentEval.id));
        const prior = DB.results.find(r => r.projectId === projectId && r.evaluatorId === Auth.currentEval.id);
        const defs = DB.rubricDefs;
        const container = document.getElementById('modalContainer'); container.innerHTML = '';
        const modal = U.el(`<div class="modal-wrap"><div class="modal" role="dialog" aria-modal="true" aria-label="Rubric: ${project.title}"></div></div>`);
        const modalInner = modal.querySelector('.modal');
        const fieldsHtml = defs.map(d => {
            const val = prior ? (prior.scores?.[d.key] ?? '') : '';
            return `<div style="margin-bottom:10px">
          <label>${d.label} <span class="muted">(0–10)</span></label>
          <input type="number" min="0" max="10" step="1" data-score="${d.key}" value="${val}">
          <div class="error hidden">Enter a value between 0 and 10.</div>
        </div>`;
        }).join('');
        modalInner.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:10px">
          <h2 style="margin:0;font-size:18px">${project.title}</h2>
          <div style="font-size:12px;color:var(--muted)">${project.school || ''}</div>
        </div>
        <div class="hint" style="margin-bottom:12px">Team: ${project.team || '—'} | Category: ${project.category || '—'}</div>
        <div id="rubricFields">${fieldsHtml}</div>
        <label style="margin-top:8px">Overall Remark (optional)</label>
        <textarea id="rubricRemark" placeholder="Your comments about this project">${prior ? prior.remark || '' : ''}</textarea>
        <div style="margin-top:12px" class="toolbar">
          <button class="btn" id="saveAndClose">Save & Close</button>
          <button class="btn" id="reviewBtn">Review</button>
          <button class="btn secondary" id="cancelRubric">Cancel</button>
        </div>
      `;
        container.appendChild(modal);
        this.draft = { id: prior?.id || U.uid('result'), panelId: panel?.id, projectId: projectId, evaluatorId: Auth.currentEval.id, scores: prior?.scores ? { ...prior.scores } : {}, remark: prior?.remark || '', total: prior?.total || 0, ts: prior?.ts || Date.now(), finalizedByEvaluator: prior?.finalizedByEvaluator || false };
        modal.querySelector('#cancelRubric').onclick = () => { modal.remove(); container.innerHTML = ''; };
        modal.querySelector('#reviewBtn').onclick = () => { this.prepareReviewFromModal(modal); };
        modal.querySelector('#saveAndClose').onclick = () => { this.saveFromModal(modal, true); };
        modal.querySelector('[data-score]')?.focus();
    },
    prepareReviewFromModal(modal) {
        const inputs = [...modal.querySelectorAll('[data-score]')];
        for (const inp of inputs) {
            const v = Number(inp.value);
            const err = inp.nextElementSibling;
            if (isNaN(v) || v < 0 || v > 10) { err.classList.remove('hidden'); alert('Please fix invalid scores (0–10 only).'); inp.focus(); return; }
            err.classList.add('hidden');
            this.draft.scores[inp.dataset.score] = v;
        }
        this.draft.total = Object.values(this.draft.scores).reduce((a, b) => a + Number(b), 0);
        this.draft.remark = modal.querySelector('#rubricRemark').value.trim();
        modal.querySelector('.modal').innerHTML = `
        <h3>Review Your Scores</h3>
        <div class="card">
          <table>
            <thead><tr><th>Criterion</th><th>Score</th></tr></thead>
            <tbody>${Object.entries(this.draft.scores).map(([k, v]) => `<tr><td>${DB.rubricDefs.find(d => d.key === k)?.label || k}</td><td><b>${v}</b></td></tr>`).join('')}</tbody>
          </table>
          <p style="margin-top:12px;font-size:16px"><b>Total:</b> ${this.draft.total} / ${DB.rubricDefs.length * 10}</p>
          <p style="margin-top:8px"><b>Remark:</b> ${this.draft.remark || '<span class="muted">none</span>'}</p>
        </div>
        <div style="margin-top:12px" class="toolbar">
          <button class="btn" id="confirmSubmit">Submit</button>
          <button class="btn secondary" id="editScores">Edit Scores</button>
          <button class="btn" id="saveDraft">Save Draft & Close</button>
        </div>
      `;
        modal.querySelector('#editScores').onclick = () => { modal.remove(); document.getElementById('modalContainer').innerHTML = ''; this.openRubricModal(this.draft.projectId); };
        modal.querySelector('#confirmSubmit').onclick = async () => {
            await this.submitDraft();
            modal.remove(); document.getElementById('modalContainer').innerHTML = '';
            this.goToAssigned();
        };
        modal.querySelector('#saveDraft').onclick = () => { this.saveDraftOnly(); modal.remove(); document.getElementById('modalContainer').innerHTML = ''; this.goToAssigned(); };
    },
    saveFromModal(modal, closeAfterSave) {
        const inputs = [...modal.querySelectorAll('[data-score]')];
        for (const inp of inputs) {
            const v = Number(inp.value);
            const err = inp.nextElementSibling;
            if (isNaN(v) || v < 0 || v > 10) { err.classList.remove('hidden'); alert('Please fix invalid scores (0–10 only).'); inp.focus(); return; }
            err.classList.add('hidden');
            this.draft.scores[inp.dataset.score] = v;
        }
        this.draft.total = Object.values(this.draft.scores).reduce((a, b) => a + Number(b), 0);
        this.draft.remark = modal.querySelector('#rubricRemark').value.trim();
        const existingIdx = DB.results.findIndex(r => r.id === this.draft.id);
        if (existingIdx >= 0) DB.results[existingIdx] = this.draft; else DB.results.push(this.draft);
        if (closeAfterSave) {
            modal.remove(); document.getElementById('modalContainer').innerHTML = '';
            this.goToAssigned();
        }
    },
    saveDraftOnly() {
        const existingIdx = DB.results.findIndex(r => r.id === this.draft.id);
        if (existingIdx >= 0) DB.results[existingIdx] = this.draft; else DB.results.push(this.draft);
    },
    async submitDraft() {
        this.draft.ts = Date.now();
        const existingIdx = DB.results.findIndex(r => r.id === this.draft.id);
        if (existingIdx >= 0) DB.results[existingIdx] = this.draft; else DB.results.push(this.draft);
        await saveResultToGAS(this.draft);
    },
    openViewOnlyModalByProject(projectId) {
        const res = DB.results.find(r => r.projectId === projectId && r.evaluatorId === Auth.currentEval.id);
        if (!res) { alert('Submission not found'); return; }
        this.openViewOnlyModal(res);
    },
    openViewOnlyModal(res) {
        const project = DB.projects.find(p => p.id === res.projectId) || { title: '—' };
        const container = document.getElementById('modalContainer');
        const vmodal = U.el(`<div class="modal-wrap"><div class="modal" role="dialog" aria-modal="true" aria-label="View submission"></div></div>`);
        const defs = DB.rubricDefs;
        const rows = defs.map(d => `<tr><td>${d.label}</td><td><b>${res.scores?.[d.key] ?? '—'}</b></td></tr>`).join('');
        vmodal.querySelector('.modal').innerHTML = `
        <h3>Submission: ${project.title}</h3>
        <div class="hint" style="margin-bottom:12px">Team: ${project.team || '—'} | School: ${project.school || '—'}</div>
        <div class="card">
          <table>
            <thead><tr><th>Criterion</th><th>Score</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <p style="margin-top:12px;font-size:16px"><b>Total:</b> ${res.total || 0} / ${defs.length * 10}</p>
          <p style="margin-top:8px"><b>Remark:</b> ${res.remark || '<span class="muted">none</span>'}</p>
          <p style="margin-top:8px;color:var(--muted);font-size:13px">${res.finalizedByEvaluator ? '✓ Finalized' : 'Not Finalized'}</p>
        </div>
        <div style="margin-top:12px" class="toolbar">
          <button class="btn" id="closeView">Close</button>
        </div>
      `;
        container.appendChild(vmodal);
        vmodal.querySelector('#closeView').onclick = () => { vmodal.remove(); };
    },
    openFinalizeModal() {
        const subs = DB.results.filter(r => r.evaluatorId === Auth.currentEval.id);
        if (subs.length === 0) { alert('No submissions yet. Submit at least one rubric before proceeding.'); return; }
        const container = document.getElementById('modalContainer'); container.innerHTML = '';
        const modalWrap = U.el(`<div class="modal-wrap"></div>`);
        const modal = U.el(`<div class="modal" role="dialog" aria-modal="true" aria-label="Review submissions"></div>`);
        modalWrap.appendChild(modal);
        modal.innerHTML = `
        <h2>Review Your Submissions</h2>
        <div class="hint" style="margin-bottom:12px">Review all your evaluations before finalizing. Once finalized, you can only logout.</div>
        <div class="card" style="margin-bottom:12px">
          <div class="table-wrapper">
            <table>
              <thead><tr><th>Project</th><th>Total</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                ${subs.map(s => `<tr data-resid="${s.id}">
                  <td><b>${(DB.projects.find(p => p.id === s.projectId)?.title) || '—'}</b></td>
                  <td><b>${s.total || 0}</b></td>
                  <td>${s.finalizedByEvaluator ? '<span class="pill success">Finalized</span>' : '<span class="pill">Not Finalized</span>'}</td>
                  <td>
                    <div class="toolbar">
                      <button class="btn" data-view="${s.id}">View</button>
                      <button class="btn secondary" data-edit="${s.id}">Edit</button>
                    </div>
                  </td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
        <div class="toolbar">
          <button class="btn" id="finalizeAllBtn">Finalize All Submissions</button>
          <button class="btn secondary" id="cancelFinalizeBtn">Cancel</button>
        </div>
      `;
        container.appendChild(modalWrap);
        modal.querySelectorAll('[data-view]').forEach(b => { b.onclick = (e) => { const rid = e.target.getAttribute('data-view'); const res = DB.results.find(r => r.id === rid); this.openViewOnlyModal(res); }; });
        modal.querySelectorAll('[data-edit]').forEach(b => { b.onclick = (e) => { const rid = e.target.getAttribute('data-edit'); const res = DB.results.find(r => r.id === rid); modalWrap.remove(); container.innerHTML = ''; this.openRubricModal(res.projectId); }; });
        modal.querySelector('#cancelFinalizeBtn').onclick = () => { modalWrap.remove(); container.innerHTML = ''; };
        modal.querySelector('#finalizeAllBtn').onclick = async () => {
            if (!confirm('Click OK to finalize ALL your submissions. After finalizing, the screen will show only the Logout button.')) return;
            subs.forEach(s => { s.finalizedByEvaluator = true; });
            DB.evaluatorState = DB.evaluatorState || {};
            DB.evaluatorState[Auth.currentEval.id] = DB.evaluatorState[Auth.currentEval.id] || {};
            DB.evaluatorState[Auth.currentEval.id].finalizedAll = true;
            // push to GAS (bulk recommended)
            await saveToGASAsBulk();
            modalWrap.remove();
            container.innerHTML = '';
            this.goToAssigned();
            alert('✓ All submissions finalized successfully!');
        };
    }
};


