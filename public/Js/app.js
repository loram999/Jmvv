/* ═══════════════════════════════════════════════════
   TRX TRADING PLATFORM - Main App Logic
   ═══════════════════════════════════════════════════ */

const APP = {
  currentUser: null,
  currentBetChoice: null,
  currentBetType: 'BS',
  currentStrategy: 'BS_ORDER',
  betSizes: [100],
  pattern: 'BSBSBSBSBS',
  selectedAmount: null,
  betId: null,
  chart: null,
  series: null,
  issuePollTimer: null,
};

// ─── Credentials ───
APP.getCreds = function() {
  try { return JSON.parse(localStorage.getItem('trx_credentials')); }
  catch (e) { return null; }
};
APP.setCreds = function(val) {
  if (val === null) localStorage.removeItem('trx_credentials');
  else localStorage.setItem('trx_credentials', JSON.stringify(val));
};
APP.getConfig = function() {
  try { return JSON.parse(localStorage.getItem('trx_config')); }
  catch (e) { return {}; }
};
APP.setConfig = function(val) {
  localStorage.setItem('trx_config', JSON.stringify(val));
};

// ─── INITIALIZATION ───
document.addEventListener('DOMContentLoaded', () => {
  const creds = APP.getCreds();
  if (creds && creds.token) {
    APP.currentUser = creds;
    showPage('chart');
    refreshBalance();
    updateAccessInfo();
  } else {
    showPage('landing');
  }

  // Initialize UI defaults
  renderBetSizes();
  updateSlider('stopLossSlider');
  updateSlider('profitTargetSlider');

  // Restore auto-bet session if exists
  const savedBetId = APP.getConfig().betId;
  if (savedBetId) {
    APP.betId = savedBetId;
    setTimeout(() => updateAutoBetStatus(), 1000);
  }

  // Close modal on outside click
  document.getElementById('betModal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeBetModal();
  });
});

// ═══════════════════════════════════════════════════
// PAGE NAVIGATION
// ═══════════════════════════════════════════════════

function showPage(pageName) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const page = document.getElementById('page-' + pageName);
  if (page) page.classList.add('active');

  // Update nav
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navBtn = document.getElementById('nav-' + pageName);
  if (navBtn) navBtn.classList.add('active');

  // Hide bottom nav on landing/login/access
  const bottomNav = document.getElementById('bottomNav');
  if (bottomNav) {
    bottomNav.style.display = (pageName === 'landing' || pageName === 'login' || pageName === 'access') ? 'none' : 'flex';
  }

  // Chart page
  if (pageName === 'chart') {
    setTimeout(() => initChart(), 300);
    refreshBalance();
    updateAccessInfo();
    startIssuePoll();
  } else {
    stopIssuePoll();
  }

  // Auto bet page
  if (pageName === 'autobet') {
    renderBetSizes();
    if (APP.betId) {
      setTimeout(() => updateAutoBetStatus(), 500);
    }
  }

  // Access page
  if (pageName === 'access') {
    updateAccessInfo();
  }
}

// ═══════════════════════════════════════════════════
// TOAST NOTIFICATIONS
// ═══════════════════════════════════════════════════

function showToast(message, type = 'info') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(-20px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ═══════════════════════════════════════════════════
// API HELPERS
// ═══════════════════════════════════════════════════

async function apiRequest(endpoint, method = 'GET', body = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (body) options.body = JSON.stringify(body);

  const response = await fetch(endpoint, options);
  return response.json();
}

// ═══════════════════════════════════════════════════
// LOGIN
// ═══════════════════════════════════════════════════

let selectedSite = '6Lottery';

function selectSite(site) {
  selectedSite = site;
  document.querySelectorAll('.site-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('site-' + site.replace('777BIGWIN', '777')).classList.add('active');
}

async function handleLogin() {
  const phone = document.getElementById('loginPhone').value.trim();
  const password = document.getElementById('loginPassword').value.trim();

  if (!phone || !password) {
    showToast('Please enter phone number and password', 'error');
    return;
  }

  const btn = document.getElementById('loginBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Logging in...';

  try {
    const result = await apiRequest('/api/trx?action=login', 'POST', {
      phone, password, site: selectedSite
    });

    if (result.success) {
      APP.setCreds({
        token: result.token,
        tokenHeader: result.tokenHeader,
        baseUrl: result.baseUrl,
        site: selectedSite,
        balance: result.balance,
        user: result.user
      });
      APP.currentUser = APP.getCreds();

      showToast('Login successful!', 'success');
      showPage('chart');
      refreshBalance();
    } else {
      showToast(result.error || 'Login failed', 'error');
    }
  } catch (error) {
    showToast('Connection error: ' + error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Login';
  }
}

async function refreshBalance() {
  const creds = APP.getCreds();
  if (!creds || !creds.token) return;

  try {
    const result = await apiRequest('/api/trx?action=getBalance', 'POST', {
      token: creds.token,
      tokenHeader: creds.tokenHeader,
      baseUrl: creds.baseUrl
    });

    if (result.success) {
      creds.balance = result.balance;
      APP.setCreds(creds);
      updateBalanceDisplay();
      updateAccessInfo();
    }
  } catch (e) {
    console.error('Balance refresh error:', e);
  }
}

function updateBalanceDisplay() {
  const creds = APP.getCreds();
  if (!creds) return;

  const balanceEl = document.getElementById('userBalance');
  const nameEl = document.getElementById('userName');
  const avatarEl = document.getElementById('userAvatar');

  if (balanceEl) balanceEl.textContent = (creds.balance || 0).toFixed(2) + ' Ks';
  const name = creds.user?.nickname || creds.user?.username || 'User';
  if (nameEl) nameEl.textContent = name.substring(0, 8);
  if (avatarEl) avatarEl.textContent = name.charAt(0).toUpperCase();
}

function handleLogout() {
  APP.setCreds(null);
  APP.currentUser = null;
  APP.setConfig({});
  APP.betId = null;
  showPage('landing');
  showToast('Logged out', 'info');
}

// ═══════════════════════════════════════════════════
// ACCESS INFO
// ═══════════════════════════════════════════════════

function updateAccessInfo() {
  const creds = APP.getCreds();
  if (!creds) return;

  const siteEl = document.getElementById('accessSite');
  const userEl = document.getElementById('accessUsername');
  const balEl = document.getElementById('accessBalance');
  const betIdEl = document.getElementById('accessBetId');

  if (siteEl) siteEl.textContent = creds.site || '—';
  if (userEl) userEl.textContent = creds.user?.nickname || creds.user?.username || '—';
  if (balEl) balEl.textContent = (creds.balance || 0).toFixed(2) + ' Ks';
  if (betIdEl) betIdEl.textContent = APP.betId || '—';
}

// ═══════════════════════════════════════════════════
// ISSUE POLLING
// ═══════════════════════════════════════════════════

function startIssuePoll() {
  stopIssuePoll();
  pollIssue();
  APP.issuePollTimer = setInterval(pollIssue, 15000);
}

function stopIssuePoll() {
  if (APP.issuePollTimer) {
    clearInterval(APP.issuePollTimer);
    APP.issuePollTimer = null;
  }
}

async function pollIssue() {
  const creds = APP.getCreds();
  if (!creds || !creds.token) return;

  try {
    const res = await fetch(
      `/api/trx?action=getIssue&token=${encodeURIComponent(creds.token)}&tokenHeader=${encodeURIComponent(creds.tokenHeader || '')}&baseUrl=${encodeURIComponent(creds.baseUrl)}`
    );
    const data = await res.json();
    if (data.success && data.issueNumber) {
      const hCurrent = document.getElementById('hCurrent');
      const hNext = document.getElementById('hNext');
      if (hCurrent) hCurrent.textContent = data.issueNumber;
      if (hNext) {
        const num = parseInt(data.issueNumber);
        if (!isNaN(num)) hNext.textContent = (num + 1).toString();
      }
    }
  } catch (e) {
    console.error('Issue poll error:', e);
  }
}

// ═══════════════════════════════════════════════════
// MANUAL BETTING
// ═══════════════════════════════════════════════════

function showBetModal(choice) {
  APP.currentBetChoice = choice;
  const modal = document.getElementById('betModal');
  modal.classList.add('show');

  const choiceText = choice === 'B' ? 'BIG' : 'SMALL';
  const choiceClass = choice === 'B' ? 'bet-choice-big' : 'bet-choice-small';
  document.getElementById('betModalChoice').innerHTML =
    `<span class="${choiceClass}">${choiceText}</span>`;

  APP.selectedAmount = null;
  document.querySelectorAll('.amount-btn').forEach(b => b.classList.remove('selected'));
}

function closeBetModal() {
  document.getElementById('betModal').classList.remove('show');
}

function selectAmount(amount) {
  APP.selectedAmount = amount;
  document.querySelectorAll('.amount-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById('customAmount').value = '';
  // Highlight the clicked button via event
  const btns = document.querySelectorAll('.amount-btn');
  btns.forEach(btn => {
    if (btn.textContent.includes(amount.toLocaleString())) btn.classList.add('selected');
  });
}

function setCustomAmount() {
  const val = parseFloat(document.getElementById('customAmount').value);
  if (val > 0) {
    APP.selectedAmount = val;
    document.querySelectorAll('.amount-btn').forEach(b => b.classList.remove('selected'));
  }
}

async function placeBet() {
  const creds = APP.getCreds();
  if (!creds || !creds.token) {
    showToast('Please login first', 'error');
    closeBetModal();
    showPage('login');
    return;
  }

  if (!APP.selectedAmount || APP.selectedAmount <= 0) {
    showToast('Please select a bet amount', 'error');
    return;
  }

  const btn = document.getElementById('betConfirmBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Placing Bet...';

  try {
    // Get current issue
    const issueRes = await fetch(
      `/api/trx?action=getIssue&token=${encodeURIComponent(creds.token)}&tokenHeader=${encodeURIComponent(creds.tokenHeader || '')}&baseUrl=${encodeURIComponent(creds.baseUrl)}`
    );
    const issueData = await issueRes.json();

    if (!issueData.success || !issueData.issueNumber) {
      showToast('Failed to get current issue', 'error');
      btn.disabled = false;
      btn.textContent = 'Confirm Bet';
      return;
    }

    const selectType = APP.currentBetChoice === 'B' ? 13 : 14;

    const betRes = await apiRequest('/api/trx?action=placeBet', 'POST', {
      token: creds.token,
      tokenHeader: creds.tokenHeader,
      baseUrl: creds.baseUrl,
      issueNumber: issueData.issueNumber,
      selectType: selectType,
      amount: APP.selectedAmount,
      gameType: 'TRX'
    });

    if (betRes.success) {
      showToast(`Bet placed! ${APP.currentBetChoice === 'B' ? 'BIG' : 'SMALL'} - ${betRes.amount} Ks on ${issueData.issueNumber}`, 'success');
      closeBetModal();
      refreshBalance();
      addHistoryItem(issueData.issueNumber, APP.currentBetChoice, betRes.amount, 'pending');
    } else {
      showToast(betRes.error || 'Bet failed', 'error');
    }
  } catch (error) {
    showToast('Bet error: ' + error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Confirm Bet';
  }
}

function addHistoryItem(period, choice, amount, result, number = null) {
  const list = document.getElementById('historyList');
  if (!list) return;

  // Remove empty placeholder
  if (list.children.length === 1 && list.children[0].textContent.includes('No bets')) {
    list.innerHTML = '';
  }

  const item = document.createElement('div');
  item.className = 'history-item';

  const betText = choice === 'B' ? 'BIG' : 'SMALL';
  const betClass = choice === 'B' ? 'big' : 'small';

  let resultHtml = '';
  if (result === 'win') {
    resultHtml = `<span class="history-result win">WIN ✓</span>`;
  } else if (result === 'loss') {
    resultHtml = `<span class="history-result loss">LOSS ✗</span>`;
  } else {
    resultHtml = `<span class="history-result pending">WAITING...</span>`;
  }

  item.innerHTML = `
    <span class="history-period">${period}</span>
    <span class="history-bet ${betClass}">${betText}</span>
    <span class="history-amount">${amount} Ks</span>
    ${resultHtml}
  `;

  list.insertBefore(item, list.firstChild);

  while (list.children.length > 20) {
    list.removeChild(list.lastChild);
  }
}

// ═══════════════════════════════════════════════════
// AUTO BET
// ═══════════════════════════════════════════════════

function setBetType(type) {
  APP.currentBetType = type;
  document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('type-' + type).classList.add('active');
}

function setStrategy(strategy) {
  APP.currentStrategy = strategy;
  document.querySelectorAll('.strategy-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('strategy-' + strategy);
  if (btn) btn.classList.add('active');

  const patternSection = document.getElementById('patternSection');
  if (patternSection) {
    patternSection.style.display = strategy === 'BS_ORDER' ? 'block' : 'none';
  }
}

function updatePattern() {
  const input = document.getElementById('patternInput');
  if (input) APP.pattern = input.value.toUpperCase();
}

function addBetSize() {
  const input = document.getElementById('betSizeInput');
  if (!input) return;
  const val = parseInt(input.value);
  if (!val || val <= 0) return;
  if (APP.betSizes.includes(val)) {
    showToast('Bet size already added', 'error');
    return;
  }

  APP.betSizes.push(val);
  APP.betSizes.sort((a, b) => a - b);
  renderBetSizes();
  input.value = '';
}

function removeBetSize(index) {
  if (APP.betSizes.length <= 1) {
    showToast('Need at least one bet size', 'error');
    return;
  }
  APP.betSizes.splice(index, 1);
  renderBetSizes();
}

function renderBetSizes() {
  const container = document.getElementById('betSizesDisplay');
  if (!container) return;
  container.innerHTML = APP.betSizes.map((size, i) =>
    `<div class="bet-size-tag">${size} Ks <span class="remove" onclick="removeBetSize(${i})">&times;</span></div>`
  ).join('');
}

function updateSlider(id) {
  const slider = document.getElementById(id);
  if (!slider) return;
  const fill = slider.parentElement.querySelector('.slider-fill');
  const display = document.getElementById(id + 'Value');
  if (fill) {
    const pct = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
    fill.style.width = pct + '%';
  }
  if (display) display.textContent = slider.value;
}

async function startAutoBet() {
  const creds = APP.getCreds();
  if (!creds || !creds.token) {
    showToast('Please login first', 'error');
    showPage('login');
    return;
  }

  const stopLoss = parseFloat(document.getElementById('stopLossSlider').value) || 0;
  const profitTarget = parseFloat(document.getElementById('profitTargetSlider').value) || 0;
  const timeStart = document.getElementById('timeStart').value;
  const timeEnd = document.getElementById('timeEnd').value;

  const btn = document.getElementById('startAutoBetBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Starting...';

  try {
    const result = await apiRequest('/api/autobet?action=start', 'POST', {
      token: creds.token,
      tokenHeader: creds.tokenHeader,
      baseUrl: creds.baseUrl,
      betType: APP.currentBetType,
      strategy: APP.currentStrategy,
      pattern: APP.pattern,
      betSizes: APP.betSizes,
      stopLoss: stopLoss,
      profitTarget: profitTarget,
      timeStart: timeStart,
      timeEnd: timeEnd,
      martingaleIndex: 0,
      strategyIndex: 0
    });

    if (result.success) {
      APP.betId = result.betId;
      // Save betId to localStorage for persistence across page refreshes
      APP.setConfig({ betId: result.betId });
      showToast('Auto Bet started!', 'success');
      updateAutoBetStatus();
      document.getElementById('startAutoBetBtn').disabled = true;
      document.getElementById('stopAutoBetBtn').disabled = false;
    } else {
      showToast(result.error || 'Failed to start', 'error');
    }
  } catch (error) {
    showToast('Error: ' + error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '▶ START';
  }
}

async function stopAutoBet() {
  if (!APP.betId) {
    showToast('No active auto bet', 'error');
    return;
  }

  const btn = document.getElementById('stopAutoBetBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Stopping...';

  try {
    const result = await apiRequest('/api/autobet?action=stop', 'POST', {
      betId: APP.betId
    });

    if (result.success) {
      showToast('Auto Bet stopped', 'info');
      updateAutoBetStatus();
    } else {
      showToast(result.error || 'Failed to stop', 'error');
    }
  } catch (error) {
    showToast('Error: ' + error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '■ STOP';
  }
}

async function updateAutoBetStatus() {
  if (!APP.betId) return;

  try {
    const result = await fetch(`/api/autobet?action=status&betId=${APP.betId}`);
    const data = await result.json();

    if (data.running !== undefined) {
      const statusPanel = document.getElementById('statusPanel');
      if (statusPanel) statusPanel.classList.add('show');

      const elRunning = document.getElementById('statusRunning');
      if (elRunning) {
        elRunning.innerHTML = data.running
          ? '<span class="status-val running">● RUNNING</span>'
          : '<span class="status-val stopped">● STOPPED</span>';
      }

      const elProfit = document.getElementById('statusProfit');
      if (elProfit) {
        const isProfit = data.totalProfit >= 0;
        elProfit.innerHTML = `<span class="status-val ${isProfit ? 'profit' : 'loss'}">${isProfit ? '+' : ''}${data.totalProfit.toFixed(2)} Ks</span>`;
      }

      const elRounds = document.getElementById('statusRounds');
      if (elRounds) elRounds.textContent = data.roundCount || 0;

      const elBalance = document.getElementById('statusBalance');
      if (elBalance) elBalance.textContent = (data.currentBalance || 0).toFixed(2) + ' Ks';

      const elStart = document.getElementById('statusStart');
      if (elStart) elStart.textContent = data.startTime || '—';

      // Update buttons
      const startBtn = document.getElementById('startAutoBetBtn');
      const stopBtn = document.getElementById('stopAutoBetBtn');
      if (startBtn) startBtn.disabled = data.running;
      if (stopBtn) stopBtn.disabled = !data.running;

      // Update history
      const historyList = document.getElementById('autoBetHistory');
      if (data.history && data.history.length > 0 && historyList) {
        historyList.innerHTML = data.history.map(h => {
          const betClass = h.betChoice === 'B' ? 'big' : 'small';
          const resultClass = h.result === 'WIN' ? 'win' : (h.result === 'LOSS' ? 'loss' : 'pending');
          const winColor = h.winAmount > 0 ? 'var(--accent-green)' : 'var(--accent-red)';
          return `
            <div class="history-item-auto">
              <span class="history-period">${h.period}</span>
              <span class="history-bet ${betClass}">${h.betChoice === 'B' ? 'BIG' : 'SMALL'}</span>
              <span class="history-amount">${h.amount} Ks</span>
              <span style="color: ${winColor}; font-weight: 600; margin-left: auto;">
                ${h.winAmount > 0 ? '+' : ''}${h.winAmount.toFixed(0)} Ks
              </span>
              <span class="history-result ${resultClass}">${h.result}</span>
            </div>
          `;
        }).join('');
      }
    } else {
      // No data - session may have ended
      if (data.running === false) {
        document.getElementById('startAutoBetBtn')?.setAttribute('disabled', '');
        document.getElementById('stopAutoBetBtn')?.removeAttribute('disabled');
      }
    }
  } catch (e) {
    console.error('Status update error:', e);
  }
}

// Poll auto-bet status every 5 seconds
setInterval(() => {
  if (APP.betId) {
    updateAutoBetStatus();
  }
}, 5000);

// ═══════════════════════════════════════════════════
// CHART INITIALIZATION
// ═══════════════════════════════════════════════════

function initChart() {
  if (APP.chart) return;

  const container = document.getElementById('tvChart');
  if (!container) return;

  // Wait for lightweight charts library
  if (typeof LightweightCharts === 'undefined') {
    setTimeout(initChart, 500);
    return;
  }

  try {
    APP.chart = LightweightCharts.createChart(container, {
      layout: {
        background: { color: '#0a0a0f' },
        textColor: '#787b86',
        fontFamily: 'Inter, sans-serif',
      },
      grid: {
        vertLines: { color: 'rgba(42, 42, 53, 0.5)' },
        horzLines: { color: 'rgba(42, 42, 53, 0.5)' },
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: { color: '#787b86', width: 1, style: LightweightCharts.LineStyle.Dashed },
        horzLine: { color: '#787b86', width: 1, style: LightweightCharts.LineStyle.Dashed },
      },
      rightPriceScale: {
        borderColor: '#2a2a35',
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: '#2a2a35',
        timeVisible: true,
      },
      handleScroll: true,
      handleScale: true,
    });

    APP.series = APP.chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderDownColor: '#ef5350',
      borderUpColor: '#26a69a',
      wickDownColor: '#ef5350',
      wickUpColor: '#26a69a',
    });

    loadChartData();
  } catch (e) {
    console.error('Chart init error:', e);
  }
}

async function loadChartData() {
  try {
    const response = await fetch('/api/trx?action=trxData&limit=100');
    const data = await response.json();

    if (Array.isArray(data) && data.length > 0) {
      const candles = data.map(d => {
        const close = parseInt(d.number);
        const open = Math.max(0, close + (Math.random() - 0.5) * 2);
        const high = Math.max(open, close) + Math.random();
        const low = Math.min(open, close) - Math.random();
        return {
          time: d.blockTime,
          open: parseFloat(open.toFixed(4)),
          high: parseFloat(high.toFixed(4)),
          low: parseFloat(low.toFixed(4)),
          close: parseFloat(close.toFixed(4))
        };
      });

      if (APP.series) {
        APP.series.setData(candles.reverse());
        APP.chart.timeScale().fitContent();
      }
    }
  } catch (e) {
    console.error('Chart data load error:', e);
  }
}

// Refresh chart data every 30 seconds
setInterval(() => {
  if (APP.chart) {
    loadChartData();
  }
}, 30000);
