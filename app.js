(() => {
  'use strict';

  const AUTO_LOGOUT_SECONDS = 30;

  const state = {
    currentUser: null,
    activeView: 'login',
    sfxEnabled: true,
    countdownTimerId: null,
    countdownRemaining: AUTO_LOGOUT_SECONDS,
    cachedLoans: [],
  };

  // ==================== ELEMENTS ====================
  const el = {
    mainNav: document.getElementById('main-nav'),
    navPills: document.querySelectorAll('.nav-pill'),
    badgePendentes: document.getElementById('badge-pendentes'),
    userPill: document.getElementById('user-pill'),
    userPillName: document.getElementById('user-pill-name'),
    btnLogout: document.getElementById('btn-logout'),
    btnSfxToggle: document.getElementById('btn-sfx-toggle'),
    btnDbModal: document.getElementById('btn-db-modal'),

    views: {
      login: document.getElementById('view-login'),
      assinar: document.getElementById('view-assinar'),
      pendentes: document.getElementById('view-pendentes'),
      baixa: document.getElementById('view-baixa'),
    },

    loginForm: document.getElementById('login-form'),
    loginMatricula: document.getElementById('login-matricula'),
    loginNome: document.getElementById('login-nome'),
    loginFeedback: document.getElementById('login-feedback'),

    ctxStudentInfo: document.getElementById('ctx-student-info'),
    loanForm: document.getElementById('loan-form'),
    loanMaterial: document.getElementById('loan-material'),
    loanQty: document.getElementById('loan-qty'),
    loanFeedback: document.getElementById('loan-feedback'),
    quickMaterials: document.getElementById('quick-materials'),
    myPendingCount: document.getElementById('my-pending-count'),
    allPendingCount: document.getElementById('all-pending-count'),

    searchPendentes: document.getElementById('search-pendentes'),
    pendentesList: document.getElementById('pendentes-list'),
    pendentesEmpty: document.getElementById('pendentes-empty'),

    baixaStudentMatricula: document.getElementById('baixa-student-matricula'),
    baixaList: document.getElementById('baixa-list'),
    baixaEmpty: document.getElementById('baixa-empty'),
    baixaEmptyMsg: document.getElementById('baixa-empty-msg'),

    postLoanModal: document.getElementById('post-loan-modal'),
    postLoanSummary: document.getElementById('post-loan-summary'),
    countdownPill: document.getElementById('countdown-pill'),
    countdownText: document.getElementById('countdown-text'),
    countdownBarFill: document.getElementById('countdown-bar-fill'),
    btnAnotherLoan: document.getElementById('btn-another-loan'),
    btnFinishLogout: document.getElementById('btn-finish-logout'),

    dbModal: document.getElementById('db-modal'),
    btnCloseDb: document.getElementById('btn-close-db'),
    dbTableBody: document.getElementById('db-table-body'),
    btnExportCsv: document.getElementById('btn-export-csv'),
    btnExportJson: document.getElementById('btn-export-json'),
  };

  // ==================== SFX (WEB AUDIO) ====================
  let audioCtx = null;

  function playTone(freq = 520, duration = 0.06, type = 'triangle') {
    if (!state.sfxEnabled) return;
    try {
      if (!audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        audioCtx = new AudioContext();
      }
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch {
      // Ignora bloqueios de áudio do navegador
    }
  }

  // ==================== HELPERS ====================
  function formatDateTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showFeedback(target, message, type = 'error') {
    target.textContent = message;
    target.className = `form-feedback ${type}`;
    target.classList.remove('hidden');
  }

  function clearFeedback(target) {
    target.classList.add('hidden');
    target.textContent = '';
  }

  // ==================== NAVIGATION & SESSION ====================
  function switchView(viewName) {
    state.activeView = viewName;
    Object.entries(el.views).forEach(([key, section]) => {
      section.classList.toggle('active', key === viewName);
    });
    el.navPills.forEach((pill) => {
      pill.classList.toggle('active', pill.dataset.view === viewName);
    });
  }

  function updateSessionUI() {
    const loggedIn = Boolean(state.currentUser);
    el.mainNav.classList.toggle('hidden', !loggedIn);
    el.userPill.classList.toggle('hidden', !loggedIn);
    el.btnLogout.classList.toggle('hidden', !loggedIn);

    if (loggedIn) {
      const shortName = state.currentUser.nome.split(' ')[0].toUpperCase();
      el.userPillName.textContent = `${shortName} · ${state.currentUser.matricula}`;
      el.ctxStudentInfo.textContent = `${state.currentUser.nome} (${state.currentUser.matricula})`;
      el.baixaStudentMatricula.textContent = state.currentUser.matricula;
    } else {
      el.ctxStudentInfo.textContent = '—';
      el.baixaStudentMatricula.textContent = '—';
    }
  }

  function logout() {
    stopCountdown();
    el.postLoanModal.classList.add('hidden');
    state.currentUser = null;
    el.loginForm.reset();
    resetLoanForm();
    clearFeedback(el.loginFeedback);
    updateSessionUI();
    switchView('login');
    playTone(340, 0.09);
  }

  // ==================== DATA REFRESH & RENDERING ====================
  async function refreshData() {
    const loans = await SaidaDB.getAllLoans();
    state.cachedLoans = loans;

    const pending = loans.filter((l) => l.status === 'pendente');
    el.badgePendentes.textContent = pending.length;
    el.allPendingCount.textContent = pending.length;

    if (state.currentUser) {
      const mine = pending.filter((l) => l.matricula === state.currentUser.matricula);
      el.myPendingCount.textContent = mine.length;
    } else {
      el.myPendingCount.textContent = '0';
    }

    renderPendentes(pending);
    renderBaixa(pending);
  }

  function renderPendentes(pendingList) {
    const query = (el.searchPendentes.value || '').trim().toLowerCase();
    const filtered = pendingList.filter((item) => {
      if (!query) return true;
      return (
        item.nome.toLowerCase().includes(query) ||
        item.matricula.toLowerCase().includes(query) ||
        item.material.toLowerCase().includes(query)
      );
    });

    el.pendentesList.innerHTML = '';
    el.pendentesEmpty.classList.toggle('hidden', filtered.length > 0);

    filtered.forEach((loan) => {
      const card = document.createElement('article');
      card.className = 'loan-card';
      card.innerHTML = `
        <div class="loan-card-top">
          <h3 class="loan-material">${escapeHtml(loan.material)}</h3>
          <span class="loan-qty-pill">QTD: ${loan.quantidade}</span>
        </div>
        <div class="loan-meta">
          <span><strong>Aluno:</strong> ${escapeHtml(loan.nome)}</span>
          <span><strong>Matrícula:</strong> ${escapeHtml(loan.matricula)}</span>
          <span><strong>Saída:</strong> ${formatDateTime(loan.dataSaida)}</span>
        </div>
      `;
      el.pendentesList.appendChild(card);
    });
  }

  function renderBaixa(pendingList) {
    const filtered = state.currentUser
      ? pendingList.filter((item) => item.matricula === state.currentUser.matricula)
      : [];

    el.baixaList.innerHTML = '';
    el.baixaEmpty.classList.toggle('hidden', filtered.length > 0);
    el.baixaEmptyMsg.textContent = 'Você não possui devoluções pendentes na sua matrícula no momento.';

    filtered.forEach((loan) => {
      const card = document.createElement('article');
      card.className = 'loan-card';
      card.innerHTML = `
        <div class="loan-card-top">
          <h3 class="loan-material">${escapeHtml(loan.material)}</h3>
          <span class="loan-qty-pill">QTD: ${loan.quantidade}</span>
        </div>
        <div class="loan-meta">
          <span><strong>Aluno:</strong> ${escapeHtml(loan.nome)}</span>
          <span><strong>Matrícula:</strong> ${escapeHtml(loan.matricula)}</span>
          <span><strong>Retirado em:</strong> ${formatDateTime(loan.dataSaida)}</span>
        </div>
        <button type="button" class="btn-amber-sm btn-return-loan" data-id="${loan.id}">
          DAR BAIXA / DEVOLVER ✓
        </button>
      `;
      el.baixaList.appendChild(card);
    });
  }

  // ==================== POST-LOAN MODAL & 30s TIMEOUT ====================
  function stopCountdown() {
    if (state.countdownTimerId !== null) {
      clearInterval(state.countdownTimerId);
      state.countdownTimerId = null;
    }
  }

  function updateCountdownDisplay() {
    el.countdownPill.textContent = `${state.countdownRemaining}s`;
    el.countdownText.textContent = state.countdownRemaining;
    const pct = (state.countdownRemaining / AUTO_LOGOUT_SECONDS) * 100;
    el.countdownBarFill.style.width = `${Math.max(0, pct)}%`;
  }

  function openPostLoanModal(loanRecord) {
    stopCountdown();
    state.countdownRemaining = AUTO_LOGOUT_SECONDS;
    updateCountdownDisplay();

    el.postLoanSummary.innerHTML = `
      <div><strong>Material:</strong> ${escapeHtml(loanRecord.material)} (Qtd: ${loanRecord.quantidade})</div>
      <div><strong>Aluno:</strong> ${escapeHtml(loanRecord.nome)} · ${escapeHtml(loanRecord.matricula)}</div>
      <div><strong>Horário de saída:</strong> ${formatDateTime(loanRecord.dataSaida)}</div>
    `;

    el.postLoanModal.classList.remove('hidden');

    state.countdownTimerId = setInterval(() => {
      state.countdownRemaining -= 1;
      updateCountdownDisplay();

      if (state.countdownRemaining <= 0) {
        logout();
      }
    }, 1000);
  }

  function resetLoanForm() {
    el.loanForm.reset();
    el.loanQty.value = 1;
    clearFeedback(el.loanFeedback);
  }

  // ==================== DB MODAL & EXPORT ====================
  async function openDbModal() {
    const allLoans = await SaidaDB.getAllLoans();
    el.dbTableBody.innerHTML = '';

    if (allLoans.length === 0) {
      el.dbTableBody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align:center; color: var(--text-muted); padding: 1.5rem;">
            Nenhum registro encontrado no banco de dados de saída.
          </td>
        </tr>
      `;
    } else {
      allLoans.forEach((item) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><code>${escapeHtml(item.matricula)}</code></td>
          <td>${escapeHtml(item.nome)}</td>
          <td>${escapeHtml(item.material)}</td>
          <td>${item.quantidade}</td>
          <td>${formatDateTime(item.dataSaida)}</td>
          <td><span class="status-tag ${item.status}">${item.status.toUpperCase()}</span></td>
          <td>${formatDateTime(item.dataDevolucao)}</td>
        `;
        el.dbTableBody.appendChild(tr);
      });
    }

    el.dbModal.classList.remove('hidden');
  }

  function downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ==================== EVENT LISTENERS ====================
  el.loginMatricula.addEventListener('blur', async () => {
    const val = el.loginMatricula.value.trim();
    if (!val) return;
    const existing = await SaidaDB.getStudent(val);
    if (existing && !el.loginNome.value.trim()) {
      el.loginNome.value = existing.nome;
    }
  });

  el.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFeedback(el.loginFeedback);

    const matricula = el.loginMatricula.value.trim();
    const nome = el.loginNome.value.trim();

    if (!matricula || !nome) {
      showFeedback(el.loginFeedback, 'Preencha a matrícula e o nome completo.', 'error');
      return;
    }

    try {
      const saved = await SaidaDB.saveStudent({ matricula, nome });
      state.currentUser = saved;
      updateSessionUI();
      await refreshData();
      switchView('assinar');
      playTone(640, 0.08);
    } catch {
      showFeedback(el.loginFeedback, 'Erro ao salvar no banco de dados local.', 'error');
    }
  });

  el.navPills.forEach((pill) => {
    pill.addEventListener('click', async () => {
      playTone(520, 0.04);
      await refreshData();
      switchView(pill.dataset.view);
    });
  });

  el.quickMaterials.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip-btn');
    if (!btn) return;
    el.loanMaterial.value = btn.dataset.item;
    playTone(580, 0.04);
  });

  el.loanForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFeedback(el.loanFeedback);

    if (!state.currentUser) {
      logout();
      return;
    }

    const material = el.loanMaterial.value.trim();
    const quantidade = Number(el.loanQty.value);

    if (!material) {
      showFeedback(el.loanFeedback, 'Informe o material que está sendo retirado.', 'error');
      return;
    }

    if (!Number.isFinite(quantidade) || quantidade < 1) {
      showFeedback(el.loanFeedback, 'Informe uma quantidade válida (mínimo 1).', 'error');
      return;
    }

    try {
      const record = await SaidaDB.addLoan({
        matricula: state.currentUser.matricula,
        nome: state.currentUser.nome,
        material,
        quantidade,
      });

      playTone(760, 0.1);
      await refreshData();
      resetLoanForm();
      openPostLoanModal(record);
    } catch {
      showFeedback(el.loanFeedback, 'Não foi possível salvar o empréstimo.', 'error');
    }
  });

  el.btnAnotherLoan.addEventListener('click', () => {
    stopCountdown();
    el.postLoanModal.classList.add('hidden');
    resetLoanForm();
    switchView('assinar');
    playTone(620, 0.06);
  });

  el.btnFinishLogout.addEventListener('click', () => {
    logout();
  });

  el.btnLogout.addEventListener('click', () => {
    logout();
  });

  el.searchPendentes.addEventListener('input', () => {
    const pending = state.cachedLoans.filter((l) => l.status === 'pendente');
    renderPendentes(pending);
  });

  el.baixaList.addEventListener('click', async (e) => {
    const btn = e.target.closest('.btn-return-loan');
    if (!btn || !state.currentUser) return;
    const id = Number(btn.dataset.id);
    const loan = state.cachedLoans.find((item) => item.id === id);

    // Garante que apenas o dono da matrícula possa dar baixa
    if (!loan || loan.matricula !== state.currentUser.matricula) {
      return;
    }

    btn.disabled = true;
    btn.textContent = 'PROCESSANDO...';

    try {
      await SaidaDB.returnLoan(id);
      playTone(720, 0.09);
      await refreshData();
    } catch {
      btn.disabled = false;
      btn.textContent = 'DAR BAIXA / DEVOLVER ✓';
    }
  });

  el.btnSfxToggle.addEventListener('click', () => {
    state.sfxEnabled = !state.sfxEnabled;
    el.btnSfxToggle.textContent = `SFX: ${state.sfxEnabled ? 'ON' : 'OFF'}`;
    el.btnSfxToggle.setAttribute('aria-pressed', String(state.sfxEnabled));
    if (state.sfxEnabled) playTone(560, 0.05);
  });

  el.btnDbModal.addEventListener('click', () => {
    playTone(500, 0.04);
    openDbModal();
  });

  el.btnCloseDb.addEventListener('click', () => {
    el.dbModal.classList.add('hidden');
  });

  el.dbModal.addEventListener('click', (e) => {
    if (e.target === el.dbModal) el.dbModal.classList.add('hidden');
  });

  el.btnExportJson.addEventListener('click', async () => {
    const all = await SaidaDB.getAllLoans();
    const clean = all.map(({ assinatura, ...rest }) => ({
      ...rest,
      possuiAssinatura: Boolean(assinatura),
    }));
    downloadFile(
      `banco-saida-emprestimos-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(clean, null, 2),
      'application/json'
    );
  });

  el.btnExportCsv.addEventListener('click', async () => {
    const all = await SaidaDB.getAllLoans();
    const header = ['ID', 'Matricula', 'Aluno', 'Material', 'Quantidade', 'Observacao', 'Status', 'DataSaida', 'DataDevolucao'];
    const rows = all.map((r) => [
      r.id,
      r.matricula,
      `"${String(r.nome).replace(/"/g, '""')}"`,
      `"${String(r.material).replace(/"/g, '""')}"`,
      r.quantidade,
      `"${String(r.observacao || '').replace(/"/g, '""')}"`,
      r.status,
      r.dataSaida,
      r.dataDevolucao || '',
    ]);
    const csv = [header.join(','), ...rows.map((r) => r.join(','))].join('\n');
    downloadFile(
      `banco-saida-emprestimos-${new Date().toISOString().slice(0, 10)}.csv`,
      '\uFEFF' + csv,
      'text/csv;charset=utf-8;'
    );
  });

  // ==================== INIT ====================
  (async function bootstrap() {
    await SaidaDB.init();
    await refreshData();
    updateSessionUI();
    switchView('login');
  })();
})();
