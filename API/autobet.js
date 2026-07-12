const axios = require('axios');
const crypto = require('crypto');
const https = require('https');
const fs = require('fs');

const BASE_URLS = {
  "6Lottery": "https://6lotteryapi.com/api/webapi/",
  "777BIGWIN": "https://api.bigwinqaz.com/api/webapi/"
};

// ====================================================
// Helper Functions
// ====================================================

function generateSignature(data) {
  const f = {};
  const exclude = ["signature", "track", "xosoBettingData"];
  
  Object.keys(data).sort().forEach(function(k) {
    const v = data[k];
    if (v !== null && v !== '' && !exclude.includes(k)) {
      f[k] = v === 0 ? 0 : v;
    }
  });
  
  const jstr = JSON.stringify(f);
  return crypto.createHash('md5').update(jstr).digest('hex').toUpperCase();
}

function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const agent = new https.Agent({ 
      rejectUnauthorized: false,
      keepAlive: true,
      keepAliveMsecs: 1000
    });
    
    const defaultOptions = {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0',
        'Connection': 'Keep-Alive',
        'Ar-Origin': 'https://6win598.com',
        'Origin': 'https://6win598.com',
        'Referer': 'https://6win598.com/',
      },
      timeout: 12000
    };
    
    const requestOptions = { ...defaultOptions, ...options, agent };
    
    const req = https.request(url, requestOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ data: JSON.parse(data) }); }
        catch (e) { reject(new Error(`Parse error: ${e.message}`)); }
      });
    });
    
    req.on('error', (error) => { reject(error); });
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    
    if (options.body) { req.write(JSON.stringify(options.body)); }
    req.end();
  });
}

function computeUnitAmount(amt) {
  if (amt <= 0) return 1;
  const amtStr = String(amt);
  const tz = amtStr.length - amtStr.replace(/0+$/, '').length;
  if (tz >= 4) return 10000;
  if (tz === 3) return 1000;
  if (tz === 2) return 100;
  if (tz === 1) return 10;
  return Math.pow(10, amtStr.length - 1);
}

function computeBetDetails(desiredAmount) {
  if (desiredAmount <= 0) return { unitAmount: 0, betCount: 0, actualAmount: 0 };
  const unitAmount = computeUnitAmount(desiredAmount);
  const betCount = Math.max(1, Math.floor(desiredAmount / unitAmount));
  return { unitAmount, betCount, actualAmount: unitAmount * betCount };
}

const SELECT_MAP = {
  BS: { "B": 13, "S": 14 },
  COLOR: { "G": 11, "V": 12, "R": 10 }
};

// ====================================================
// CORS
// ====================================================
function setCORS(res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// ====================================================
// Persistence File
// ====================================================
const AUTOBET_STATE_FILE = '/tmp/autobet_state.json';

function loadState() {
  try {
    if (fs.existsSync(AUTOBET_STATE_FILE)) {
      return JSON.parse(fs.readFileSync(AUTOBET_STATE_FILE, 'utf8'));
    }
  } catch (e) {}
  return {};
}

function saveState(state) {
  try {
    fs.writeFileSync(AUTOBET_STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {}
}

// Load on startup
let globalState = loadState();
const AUTOBET_DIR = '/tmp/autobet_sessions';
if (!fs.existsSync(AUTOBET_DIR)) fs.mkdirSync(AUTOBET_DIR, { recursive: true });

// ====================================================
// Auto-Bet Logic
// ====================================================

const activeAutoBets = {};
const MAX_RESULT_WAIT = 60;
const MAX_ERRORS = 10;

// ─── Restore running sessions on startup ───
try {
  const restoredState = loadState();
  for (const betId of Object.keys(restoredState)) {
    const state = restoredState[betId];
    if (state && state.running) {
      // Reload full session from file
      const fullSession = loadSessionState(betId);
      if (fullSession && fullSession.running) {
        // Ensure settings.running is set
        fullSession.settings = fullSession.settings || {};
        fullSession.settings.running = true;
        activeAutoBets[betId] = fullSession;
        // Restart the auto-bet loop
        runAutoBet(fullSession);
        console.log(`[AutoBet] Restored running session: ${betId}`);
      }
    }
  }
} catch (e) {
  console.error('[AutoBet] Failed to restore sessions:', e);
}

async function runAutoBet(session) {
  const { token, tokenHeader, baseUrl, settings, betId } = session;
  const normBaseUrl = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
  
  settings.running = true;
  settings.consecutiveErrors = 0;
  settings.lastIssue = null;
  
  // Get initial balance
  let currentBalance = null;
  try {
    const balBody = { language: 7, random: "71ebd56cff7d4679971c482807c33f6f" };
    balBody.signature = generateSignature(balBody).toUpperCase();
    balBody.timestamp = Math.floor(Date.now() / 1000);
    const balRes = await makeRequest(normBaseUrl + "GetBalance", {
      method: 'POST',
      headers: {
        "Authorization": `${tokenHeader || 'Bearer '}${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "Ar-Origin": "https://6win598.com",
        "Origin": "https://6win598.com",
        "Referer": "https://6win598.com/",
      },
      body: balBody
    });
    if (balRes.data && balRes.data.code === 0 && balRes.data.data) {
      currentBalance = parseFloat(balRes.data.data.Amount || balRes.data.data.amount || balRes.data.data.balance || 0);
      session.startBalance = currentBalance;
    }
  } catch (e) {}
  
  if (currentBalance === null) {
    currentBalance = session.startBalance || 0;
  }
  
  let totalProfit = 0;
  let roundCount = 0;
  let currentStrategyIndex = settings.strategyIndex || 0;
  
  // Main loop
  try {
    while (settings.running && settings.consecutiveErrors < MAX_ERRORS) {
      
      // Refresh session state from file (allows stop from other requests)
      const savedState = loadSessionState(betId);
      if (!savedState || !savedState.running) {
        break;
      }
      
      // Check time range
      if (settings.timeStart && settings.timeEnd) {
        const now = new Date();
        // Convert to Myanmar time (UTC+6:30)
        const myanmarTime = new Date(now.getTime() + 6.5 * 60 * 60 * 1000);
        const currentMinutes = myanmarTime.getUTCHours() * 60 + myanmarTime.getUTCMinutes();
        
        const startMin = timeToMinutes(settings.timeStart);
        const endMin = timeToMinutes(settings.timeEnd);
        
        let inRange;
        if (endMin > startMin) {
          inRange = currentMinutes >= startMin && currentMinutes < endMin;
        } else {
          inRange = currentMinutes >= startMin || currentMinutes < endMin;
        }
        
        if (!inRange) {
          await sleep(5000);
          continue;
        }
      }
      
      // Get balance
      try {
        const balBody = { language: 7, random: "71ebd56cff7d4679971c482807c33f6f" };
        balBody.signature = generateSignature(balBody).toUpperCase();
        balBody.timestamp = Math.floor(Date.now() / 1000);
        const balRes = await makeRequest(normBaseUrl + "GetBalance", {
          method: 'POST',
          headers: {
            "Authorization": `${tokenHeader || 'Bearer '}${token}`,
            "Content-Type": "application/json; charset=UTF-8",
            "Ar-Origin": "https://6win598.com",
            "Origin": "https://6win598.com",
            "Referer": "https://6win598.com/",
          },
          body: balBody
        });
        if (balRes.data && balRes.data.code === 0 && balRes.data.data) {
          currentBalance = parseFloat(balRes.data.data.Amount || balRes.data.data.amount || balRes.data.data.balance || 0);
        }
      } catch (e) {
        settings.consecutiveErrors++;
        await sleep(2000);
        continue;
      }
      
      // Check stop loss / profit target
      if (session.startBalance && settings.stopLoss > 0) {
        const loss = session.startBalance - currentBalance;
        if (loss >= settings.stopLoss) {
          settings.running = false;
          break;
        }
      }
      if (settings.profitTarget > 0 && totalProfit >= settings.profitTarget) {
        settings.running = false;
        break;
      }
      
      // Get current issue
      settings.consecutiveErrors = 0;
      let issueNumber;
      try {
        const issueBody = {
          typeId: 13,
          language: 7,
          random: "7d76f361dc5d4d8c98098ae3d48ef7af"
        };
        issueBody.signature = generateSignature(issueBody).toUpperCase();
        issueBody.timestamp = Math.floor(Date.now() / 1000);
        
        const issueRes = await makeRequest(normBaseUrl + "GetTrxGameIssue", {
          method: 'POST',
          headers: {
            "Authorization": `${tokenHeader || 'Bearer '}${token}`,
            "Content-Type": "application/json; charset=UTF-8",
            "Ar-Origin": "https://6win598.com",
            "Origin": "https://6win598.com",
            "Referer": "https://6win598.com/",
          },
          body: issueBody
        });
        
        if (issueRes.data && issueRes.data.code === 0) {
          const data = issueRes.data.data || {};
          issueNumber = data.predraw?.issueNumber;
        } else {
          settings.consecutiveErrors++;
          await sleep(2000);
          continue;
        }
      } catch (e) {
        settings.consecutiveErrors++;
        await sleep(2000);
        continue;
      }
      
      if (!issueNumber || issueNumber === settings.lastIssue) {
        await sleep(1000);
        continue;
      }
      
      settings.lastIssue = issueNumber;
      
      // Determine bet choice using strategy
      const betType = settings.betType || "BS";
      const strategy = settings.strategy || "BS_ORDER";
      const betSizes = settings.betSizes || [100];
      const minBetSize = Math.min(...betSizes);
      
      if (currentBalance < minBetSize) {
        settings.running = false;
        break;
      }
      
      let betChoice = "B";
      let shouldSkip = false;
      
      // Determine bet choice using strategy
      if (strategy === "BS_ORDER") {
        const pattern = settings.pattern || "BSBSBSBSBS";
        betChoice = pattern[currentStrategyIndex % pattern.length];
        currentStrategyIndex = (currentStrategyIndex + 1) % pattern.length;
      } else if (strategy === "ALTERNATE") {
        betChoice = settings.lastResult === "B" ? "S" : "B";
      } else if (strategy === "TREND_FOLLOW") {
        betChoice = settings.lastResult || "B";
      } else if (strategy === "DREAM") {
        const dreamOrder = ["B","S","S","B","S","B","B","S"];
        betChoice = dreamOrder[currentStrategyIndex % dreamOrder.length];
        currentStrategyIndex = (currentStrategyIndex + 1) % dreamOrder.length;
      } else if (strategy === "BABIO") {
        const babioOrder = ["B","B","S","B","S","S"];
        betChoice = babioOrder[currentStrategyIndex % babioOrder.length];
        currentStrategyIndex = (currentStrategyIndex + 1) % babioOrder.length;
      } else if (strategy === "LYZO") {
        const lyzoOrder = ["S","B","B","S","B","S","B"];
        betChoice = lyzoOrder[currentStrategyIndex % lyzoOrder.length];
        currentStrategyIndex = (currentStrategyIndex + 1) % lyzoOrder.length;
      } else if (strategy === "SNIPER") {
        const sniperOrder = ["B","S","B","S","B"];
        betChoice = sniperOrder[currentStrategyIndex % sniperOrder.length];
        currentStrategyIndex = (currentStrategyIndex + 1) % sniperOrder.length;
      } else if (strategy === "AI_PREDICTION") {
        // Simple alternating with slight bias
        betChoice = Math.random() > 0.45 ? "B" : "S";
      } else {
        betChoice = "B";
      }
      
      // Calculate bet amount (Martingale)
      const strategyIndex = settings.martingaleIndex || 0;
      const adjustedIndex = Math.min(strategyIndex, betSizes.length - 1);
      const desiredAmount = betSizes[adjustedIndex];
      
      const { unitAmount, betCount, actualAmount } = computeBetDetails(desiredAmount);
      
      if (actualAmount === 0 || currentBalance < actualAmount) {
        settings.running = false;
        break;
      }
      
      // Check if should skip
      if (settings.skipMode && shouldSkip) {
        // Record skip and wait for result
        roundCount++;
        await saveHistory(betId, {
          period: issueNumber,
          betChoice: betChoice,
          amount: 0,
          result: "SKIP",
          winAmount: 0,
          timestamp: Date.now()
        });
        
        // Wait for result
        await waitForResult(normBaseUrl, token, tokenHeader, issueNumber, settings, betId);
        
        continue;
      }
      
      // Place bet
      const selectType = SELECT_MAP[betType] ? SELECT_MAP[betType][betChoice] : 13;
      
      let endpoint = "GameTrxBetting";
      let typeId = 13;
      let gameType = 2;
      
      if (betType === "COLOR") {
        gameType = 0;
      }
      
      // Store bet choice for result checking
      settings.betChoice = betChoice;
      
      const betBody = {
        typeId: typeId,
        issuenumber: issueNumber,
        language: 7,
        gameType: gameType,
        amount: unitAmount,
        betCount: betCount,
        selectType: parseInt(selectType),
        random: "f9ec46840a374a65bb2abad44dfc4dc3"
      };
      betBody.signature = generateSignature(betBody).toUpperCase();
      betBody.timestamp = Math.floor(Date.now() / 1000);
      
      let betSuccess = false;
      try {
        const betRes = await makeRequest(normBaseUrl + endpoint, {
          method: 'POST',
          headers: {
            "Authorization": `${tokenHeader || 'Bearer '}${token}`,
            "Content-Type": "application/json; charset=UTF-8",
            "Ar-Origin": "https://6win598.com",
            "Origin": "https://6win598.com",
            "Referer": "https://6win598.com/",
          },
          body: betBody
        });
        
        if (betRes.data && betRes.data.code === 0) {
          betSuccess = true;
        }
      } catch (e) {
        settings.consecutiveErrors++;
        if (settings.consecutiveErrors >= MAX_ERRORS) break;
        await sleep(2000);
        continue;
      }
      
      if (!betSuccess) {
        settings.consecutiveErrors++;
        if (settings.consecutiveErrors >= MAX_ERRORS) break;
        await sleep(3000);
        continue;
      }
      
      // Wait for result
      roundCount++;
      const result = await waitForResult(normBaseUrl, token, tokenHeader, issueNumber, settings, betId);
      
      // Update martingale index
      if (result && result.isWin !== null) {
        if (result.isWin) {
          settings.martingaleIndex = 0;
          totalProfit += actualAmount * 0.98;
        } else {
          settings.martingaleIndex = Math.min((settings.martingaleIndex || 0) + 1, betSizes.length - 1);
          totalProfit -= actualAmount;
        }
        settings.lastResult = result.wasBig ? "B" : "S";
      }
      
      // Save history
      await saveHistory(betId, {
        period: issueNumber,
        betChoice: betChoice,
        amount: actualAmount,
        result: result ? (result.isWin ? "WIN" : "LOSS") : "PENDING",
        number: result ? result.number : "—",
        winAmount: result ? (result.isWin ? actualAmount * 0.98 : -actualAmount) : 0,
        timestamp: Date.now()
      });
      
      // Save state
      session.martingaleIndex = settings.martingaleIndex;
      session.strategyIndex = currentStrategyIndex;
      session.lastResult = settings.lastResult;
      session.totalProfit = totalProfit;
      session.roundCount = roundCount;
      session.currentBalance = currentBalance;
      saveSessionState(betId, session);
      
      await sleep(1000);
    }
  } catch (error) {
    console.error(`[AutoBet] Error for ${betId}: ${error.message}`);
  } finally {
    settings.running = false;
    delete activeAutoBets[betId];
    
    // Update final state
    const savedState = loadSessionState(betId);
    if (savedState) {
      savedState.running = false;
      savedState.totalProfit = totalProfit;
      savedState.roundCount = roundCount;
      saveSessionState(betId, savedState);
    }
    
    saveState(globalState);
  }
}

async function waitForResult(normBaseUrl, token, tokenHeader, issueNumber, settings, betId) {
  const betType = settings.betType || "BS";
  const betChoice = settings.betChoice || settings.lastBetChoice || "B";
  
  for (let attempt = 0; attempt < MAX_RESULT_WAIT; attempt++) {
    if (!settings.running) return null;
    
    try {
      const issueBody = {
        typeId: 13,
        language: 7,
        random: "7d76f361dc5d4d8c98098ae3d48ef7af"
      };
      issueBody.signature = generateSignature(issueBody).toUpperCase();
      issueBody.timestamp = Math.floor(Date.now() / 1000);
      
      const issueRes = await makeRequest(normBaseUrl + "GetTrxGameIssue", {
        method: 'POST',
        headers: {
          "Authorization": `${tokenHeader || 'Bearer '}${token}`,
          "Content-Type": "application/json; charset=UTF-8",
          "Ar-Origin": "https://6win598.com",
          "Origin": "https://6win598.com",
          "Referer": "https://6win598.com/",
        },
        body: issueBody
      });
      
      if (issueRes.data && issueRes.data.code === 0) {
        const data = issueRes.data.data || {};
        const newIssue = data.predraw?.issueNumber;
        
        if (newIssue && newIssue !== issueNumber) {
          // Result is available - get the number
          const numberStr = data.predraw?.number || issueNumber.slice(-1);
          const num = parseInt(numberStr);
          const isBig = num >= 5;
          const isWin = (betType === "BS") ? 
            (betChoice === "B" && isBig) || (betChoice === "S" && !isBig) : true;
          
          return { isWin, number: num.toString(), wasBig: isBig };
        }
      }
    } catch (e) {}
    
    await sleep(1000);
  }
  return null;
}

function timeToMinutes(timeStr) {
  const parts = timeStr.split(':');
  return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function loadSessionState(betId) {
  try {
    const filePath = `${AUTOBET_DIR}/${betId}.json`;
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (e) {}
  return null;
}

function saveSessionState(betId, state) {
  try {
    const filePath = `${AUTOBET_DIR}/${betId}.json`;
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
    // Also update global state
    globalState[betId] = {
      running: state.running,
      totalProfit: state.totalProfit || 0,
      roundCount: state.roundCount || 0,
      currentBalance: state.currentBalance || 0,
      startTime: state.startTime,
      settings: {
        betType: state.settings?.betType,
        strategy: state.settings?.strategy,
        betSizes: state.settings?.betSizes,
        stopLoss: state.settings?.stopLoss,
        profitTarget: state.settings?.profitTarget,
        timeStart: state.settings?.timeStart,
        timeEnd: state.settings?.timeEnd,
        pattern: state.settings?.pattern,
        martingaleIndex: state.martingaleIndex,
        strategyIndex: state.strategyIndex,
        lastResult: state.lastResult,
      }
    };
    saveState(globalState);
  } catch (e) {}
}

function saveHistory(betId, entry) {
  try {
    const historyFile = `${AUTOBET_DIR}/${betId}_history.json`;
    let history = [];
    if (fs.existsSync(historyFile)) {
      history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
    }
    history.unshift(entry);
    if (history.length > 100) history = history.slice(0, 100);
    fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));
  } catch (e) {}
}

function getHistory(betId) {
  try {
    const historyFile = `${AUTOBET_DIR}/${betId}_history.json`;
    if (fs.existsSync(historyFile)) {
      return JSON.parse(fs.readFileSync(historyFile, 'utf8'));
    }
  } catch (e) {}
  return [];
}

// ====================================================
// API Handler
// ====================================================

module.exports = async (req, res) => {
  setCORS(res);
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { action } = req.query;

  // ─── START AUTO-BET ───
  if (req.method === 'POST' && action === 'start') {
    try {
      const body = req.body || {};
      const {
        token, tokenHeader, baseUrl,
        betType = "BS",
        strategy = "BS_ORDER",
        pattern = "BSBSBSBSBS",
        betSizes = [100],
        stopLoss = 0,
        profitTarget = 0,
        timeStart = "",
        timeEnd = "",
        martingaleIndex = 0,
        strategyIndex = 0,
        lastResult = null
      } = body;
      
      if (!token || !baseUrl) {
        res.status(400).json({ success: false, error: "Missing credentials" });
        return;
      }

      const betId = crypto.randomBytes(8).toString('hex');
      
      const settings = {
        running: true,
        betType,
        strategy,
        pattern,
        betSizes: betSizes.map(Number),
        stopLoss: parseFloat(stopLoss) || 0,
        profitTarget: parseFloat(profitTarget) || 0,
        timeStart,
        timeEnd,
        martingaleIndex: parseInt(martingaleIndex) || 0,
        strategyIndex: parseInt(strategyIndex) || 0,
        lastResult,
        consecutiveErrors: 0,
        lastIssue: null
      };
      
      const session = {
        betId,
        running: true,
        token,
        tokenHeader,
        baseUrl,
        settings,
        startBalance: 0,
        totalProfit: 0,
        roundCount: 0,
        currentBalance: 0,
        startTime: new Date().toISOString(),
        martingaleIndex: settings.martingaleIndex,
        strategyIndex: settings.strategyIndex,
        lastResult: settings.lastResult,
      };
      
      saveSessionState(betId, session);
      activeAutoBets[betId] = session;
      
      // Start auto-bet in background (no await)
      runAutoBet(session);
      
      res.status(200).json({ success: true, betId });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
    return;
  }

  // ─── STOP AUTO-BET ───
  if (req.method === 'POST' && action === 'stop') {
    try {
      const { betId } = req.body || {};
      if (!betId) {
        res.status(400).json({ success: false, error: "Missing betId" });
        return;
      }
      
      const savedState = loadSessionState(betId);
      if (!savedState) {
        res.status(200).json({ success: false, error: "No active auto-bet found" });
        return;
      }
      
      savedState.running = false;
      savedState.settings.running = false;
      saveSessionState(betId, savedState);
      
      res.status(200).json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
    return;
  }

  // ─── GET STATUS ───
  if (req.method === 'GET' && action === 'status') {
    try {
      const { betId } = req.query;
      if (!betId) {
        res.status(400).json({ success: false, error: "Missing betId" });
        return;
      }
      
      const savedState = loadSessionState(betId);
      if (!savedState) {
        res.status(200).json({ running: false, betId });
        return;
      }
      
      const history = getHistory(betId);
      const wins = history.filter(h => h.result === 'WIN').length;
      const losses = history.filter(h => h.result === 'LOSS').length;
      
      res.status(200).json({
        running: savedState.running,
        betId,
        totalProfit: savedState.totalProfit || 0,
        roundCount: savedState.roundCount || 0,
        currentBalance: savedState.currentBalance || 0,
        startBalance: savedState.startBalance || 0,
        startTime: savedState.startTime,
        history: history.slice(0, 20),
        stats: { wins, losses, total: history.length }
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
    return;
  }

  // ─── ALL ACTIVE SESSIONS ───
  if (req.method === 'GET' && action === 'sessions') {
    try {
      const globalState = loadState();
      const sessions = Object.keys(globalState).map(id => ({
        betId: id,
        running: globalState[id].running,
        totalProfit: globalState[id].totalProfit || 0,
        roundCount: globalState[id].roundCount || 0,
        currentBalance: globalState[id].currentBalance || 0,
        startTime: globalState[id].startTime,
      }));
      res.status(200).json({ success: true, sessions });
    } catch (error) {
      res.status(200).json({ success: true, sessions: [] });
    }
    return;
  }

  // ─── GET HISTORY ───
  if (req.method === 'GET' && action === 'history') {
    try {
      const { betId } = req.query;
      if (!betId) {
        res.status(400).json({ success: false, error: "Missing betId" });
        return;
      }
      const history = getHistory(betId);
      res.status(200).json({ success: true, history });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
    return;
  }

  // ─── DEFAULT ───
  res.status(200).json({ error: "Unknown action", actions: ["start", "stop", "status", "sessions", "history"] });
};
