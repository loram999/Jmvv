const axios = require('axios');
const crypto = require('crypto');
const https = require('https');

const BASE_URLS = {
  "6Lottery": "https://6lotteryapi.com/api/webapi/",
  "777BIGWIN": "https://api.bigwinqaz.com/api/webapi/"
};

// ====================================================
// Helper Functions (extracted from index.js)
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
    
    const requestOptions = {
      ...defaultOptions,
      ...options,
      agent
    };
    
    const req = https.request(url, requestOptions, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          resolve({ data: jsonData });
        } catch (error) {
          reject(new Error(`Failed to parse response: ${error.message}`));
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
    
    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    
    req.end();
  });
}

function computeBetDetails(desiredAmount) {
  if (desiredAmount <= 0) {
    return { unitAmount: 0, betCount: 0, actualAmount: 0 };
  }
  
  const unitAmount = computeUnitAmount(desiredAmount);
  const betCount = Math.max(1, Math.floor(desiredAmount / unitAmount));
  const actualAmount = unitAmount * betCount;
  
  return { unitAmount, betCount, actualAmount };
}

function computeUnitAmount(amt) {
  if (amt <= 0) return 1;
  const amtStr = String(amt);
  const trailingZeros = amtStr.length - amtStr.replace(/0+$/, '').length;
  
  if (trailingZeros >= 4) return 10000;
  if (trailingZeros === 3) return 1000;
  if (trailingZeros === 2) return 100;
  if (trailingZeros === 1) return 10;
  return Math.pow(10, amtStr.length - 1);
}

function resultFromHash(hash) {
  const part = hash.length > 16 ? hash.slice(16) : hash;
  for (let i = part.length - 1; i >= 0; i--) {
    const ch = part[i];
    if (ch >= "0" && ch <= "9") return parseInt(ch, 10);
  }
  for (let i = hash.length - 1; i >= 0; i--) {
    const ch = hash[i];
    if (ch >= "0" && ch <= "9") return parseInt(ch, 10);
  }
  return 0;
}

function toPeriod(ts) {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${y}-${mo}-${day} ${h}:${mi}`;
}

// ====================================================
// CORS Headers
// ====================================================

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );
}

// ====================================================
// API Routes
// ====================================================

module.exports = async (req, res) => {
  setCORS(res);

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const action = req.query.action || req.body?.action;
  
  // ─── LOGIN ───
  if (req.method === 'POST' && action === 'login') {
    try {
      const { phone, password, site = "6Lottery" } = req.body;
      const baseUrl = BASE_URLS[site] || BASE_URLS["6Lottery"];
      const normBaseUrl = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';

      const loginData = {
        username: "95" + phone,
        pwd: password,
        phonetype: 1,
        logintype: "mobile",
        packId: "",
        deviceId: "5dcab3e06db88a206975e91ea6ac7c87",
        language: 7,
        random: crypto.randomBytes(16).toString('hex'),
      };
      
      const signature = generateSignature(loginData);
      loginData.signature = signature;
      loginData.timestamp = Math.floor(Date.now() / 1000);
      
      const response = await axios.post(
        normBaseUrl + "Login",
        loginData,
        {
          headers: {
            "Content-Type": "application/json;charset=UTF-8",
            "Ar-Origin": "https://6win598.com",
            "Origin": "https://6win598.com",
            "Referer": "https://6win598.com/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0",
          },
          timeout: 15000,
        }
      );
      
      const loginRes = response.data;
      if (loginRes.code === 0 && loginRes.data) {
        const tokenHeader = loginRes.data.tokenHeader || "Bearer ";
        const token = loginRes.data.token || "";
        
        // Create session object with token
        const session = {
          post: async (endpoint, data) => {
            const url = normBaseUrl + endpoint;
            const options = {
              method: 'POST',
              headers: {
                "Authorization": `${tokenHeader}${token}`,
                "Content-Type": "application/json; charset=UTF-8",
                "Ar-Origin": "https://6win598.com",
                "Origin": "https://6win598.com",
                "Referer": "https://6win598.com/",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0"
              },
              body: data
            };
            return makeRequest(url, options);
          }
        };
        
        // Test session with GetBalance
        try {
          const balanceRes = await session.post("GetBalance", {
            language: 7,
            random: "71ebd56cff7d4679971c482807c33f6f",
            signature: generateSignature({language:7, random:"71ebd56cff7d4679971c482807c33f6f"}).toUpperCase(),
            timestamp: Math.floor(Date.now() / 1000)
          });
          
          if (balanceRes.data && balanceRes.data.code === 0 && balanceRes.data.data) {
            const amount = balanceRes.data.data.Amount || balanceRes.data.data.amount || balanceRes.data.data.balance || 0;
            const balance = parseFloat(amount);
            
            const userInfo = await session.post("GetUserInfo", {
              language: 7,
              random: "4fc9f8f8d6764a5f934d4c6a468644e0",
              signature: generateSignature({language:7, random:"4fc9f8f8d6764a5f934d4c6a468644e0"}).toUpperCase(),
              timestamp: Math.floor(Date.now() / 1000)
            });
            
            const user = userInfo.data && userInfo.data.code === 0 && userInfo.data.data ? {
              user_id: userInfo.data.data.userId,
              username: userInfo.data.data.userName,
              nickname: userInfo.data.data.nickName,
              photo: userInfo.data.data.userPhoto,
            } : {};
            
            res.status(200).json({
              success: true,
              token: token,
              tokenHeader: tokenHeader,
              site: site,
              baseUrl: normBaseUrl,
              balance: balance,
              user: user
            });
          } else {
            res.status(200).json({
              success: true,
              token: token,
              tokenHeader: tokenHeader,
              site: site,
              baseUrl: normBaseUrl,
              balance: 0,
              user: {}
            });
          }
        } catch (balanceError) {
          res.status(200).json({
            success: true,
            token: token,
            tokenHeader: tokenHeader,
            site: site,
            baseUrl: normBaseUrl,
            balance: 0,
            user: {}
          });
        }
      } else {
        res.status(200).json({
          success: false,
          error: loginRes.msg || "Login failed",
          code: loginRes.code
        });
      }
    } catch (error) {
      res.status(200).json({
        success: false,
        error: error.message
      });
    }
    return;
  }

  // ─── GET BALANCE ───
  if (req.method === 'POST' && action === 'getBalance') {
    try {
      const { token, tokenHeader, baseUrl } = req.body;
      
      if (!token || !baseUrl) {
        res.status(400).json({ success: false, error: "Missing credentials" });
        return;
      }

      const normBaseUrl = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
      const body = {
        language: 7,
        random: "71ebd56cff7d4679971c482807c33f6f"
      };
      body.signature = generateSignature(body).toUpperCase();
      body.timestamp = Math.floor(Date.now() / 1000);
      
      const options = {
        method: 'POST',
        headers: {
          "Authorization": `${tokenHeader || 'Bearer '}${token}`,
          "Content-Type": "application/json; charset=UTF-8",
          "Ar-Origin": "https://6win598.com",
          "Origin": "https://6win598.com",
          "Referer": "https://6win598.com/",
        },
        body: body
      };
      
      const result = await makeRequest(normBaseUrl + "GetBalance", options);
      const balData = result.data;
      
      if (balData.code === 0 && balData.data) {
        const amount = balData.data.Amount || balData.data.amount || balData.data.balance || 0;
        res.status(200).json({ success: true, balance: parseFloat(amount) });
      } else {
        res.status(200).json({ success: false, error: balData.msg || "Failed" });
      }
    } catch (error) {
      res.status(200).json({ success: false, error: error.message });
    }
    return;
  }

  // ─── GET CURRENT ISSUE ───
  if (req.method === 'GET' && action === 'getIssue') {
    try {
      const { token, tokenHeader, baseUrl, gameType = "TRX" } = req.query;
      
      if (!token || !baseUrl) {
        res.status(400).json({ success: false, error: "Missing credentials" });
        return;
      }

      const normBaseUrl = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
      
      let typeId, endpoint;
      if (gameType === "TRX") {
        typeId = 13;
        endpoint = "GetTrxGameIssue";
      } else {
        typeId = 1;
        endpoint = "GetGameIssue";
      }
      
      const body = {
        typeId: typeId,
        language: 7,
        random: "7d76f361dc5d4d8c98098ae3d48ef7af"
      };
      body.signature = generateSignature(body).toUpperCase();
      body.timestamp = Math.floor(Date.now() / 1000);
      
      const options = {
        method: 'POST',
        headers: {
          "Authorization": `${tokenHeader || 'Bearer '}${token}`,
          "Content-Type": "application/json; charset=UTF-8",
          "Ar-Origin": "https://6win598.com",
          "Origin": "https://6win598.com",
          "Referer": "https://6win598.com/",
        },
        body: body
      };
      
      const result = await makeRequest(normBaseUrl + endpoint, options);
      const resData = result.data;
      
      if (resData.code === 0) {
        const data = resData.data || {};
        const issueNumber = gameType === "TRX" ? (data.predraw?.issueNumber) : data.issueNumber;
        res.status(200).json({ success: true, issueNumber, data: resData.data });
      } else {
        res.status(200).json({ success: false, error: resData.msg || "Failed" });
      }
    } catch (error) {
      res.status(200).json({ success: false, error: error.message });
    }
    return;
  }

  // ─── PLACE BET ───
  if (req.method === 'POST' && action === 'placeBet') {
    try {
      const { token, tokenHeader, baseUrl, issueNumber, selectType, amount, gameType = "TRX" } = req.body;
      
      if (!token || !baseUrl || !issueNumber || !selectType || !amount) {
        res.status(400).json({ success: false, error: "Missing required fields" });
        return;
      }

      const normBaseUrl = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
      
      let typeId, endpoint;
      if (gameType === "TRX") {
        typeId = 13;
        endpoint = "GameTrxBetting";
      } else {
        typeId = 1;
        endpoint = "GameBetting";
      }

      const selectTypeInt = parseInt(selectType);
      if (isNaN(selectTypeInt)) {
        res.status(400).json({ success: false, error: "Invalid selectType" });
        return;
      }

      const { unitAmount, betCount, actualAmount } = computeBetDetails(parseFloat(amount));
      
      if (actualAmount === 0) {
        res.status(400).json({ success: false, error: "Invalid bet amount" });
        return;
      }

      const betBody = {
        typeId: typeId,
        issuenumber: issueNumber,
        language: 7,
        gameType: 2,  // 0=COLOR, 2=BIG/SMALL
        amount: unitAmount,
        betCount: betCount,
        selectType: selectTypeInt,
        random: "f9ec46840a374a65bb2abad44dfc4dc3"
      };
      betBody.signature = generateSignature(betBody).toUpperCase();
      betBody.timestamp = Math.floor(Date.now() / 1000);
      
      const options = {
        method: 'POST',
        headers: {
          "Authorization": `${tokenHeader || 'Bearer '}${token}`,
          "Content-Type": "application/json; charset=UTF-8",
          "Ar-Origin": "https://6win598.com",
          "Origin": "https://6win598.com",
          "Referer": "https://6win598.com/",
        },
        body: betBody
      };
      
      const result = await makeRequest(normBaseUrl + endpoint, options);
      const betRes = result.data;
      
      if (betRes.code === 0) {
        res.status(200).json({ 
          success: true, 
          issueNumber,
          amount: actualAmount,
          unitAmount,
          betCount,
          selectType: selectTypeInt
        });
      } else {
        res.status(200).json({ success: false, error: betRes.msg || "Bet failed", code: betRes.code });
      }
    } catch (error) {
      res.status(200).json({ success: false, error: error.message });
    }
    return;
  }

  // ─── GET BET HISTORY ───
  if (req.method === 'POST' && action === 'getHistory') {
    try {
      const { token, tokenHeader, baseUrl, pageSize = 10 } = req.body;
      
      if (!token || !baseUrl) {
        res.status(400).json({ success: false, error: "Missing credentials" });
        return;
      }

      const normBaseUrl = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
      const body = {
        pageSize: parseInt(pageSize),
        pageNo: 1,
        typeId: 13,
        language: 7,
        random: "4ad5325e389745a882f4189ed6550e70"
      };
      body.signature = generateSignature(body).toUpperCase();
      body.timestamp = Math.floor(Date.now() / 1000);
      
      const options = {
        method: 'POST',
        headers: {
          "Authorization": `${tokenHeader || 'Bearer '}${token}`,
          "Content-Type": "application/json; charset=UTF-8",
          "Ar-Origin": "https://6win598.com",
          "Origin": "https://6win598.com",
          "Referer": "https://6win598.com/",
        },
        body: body
      };
      
      const result = await makeRequest(normBaseUrl + "GetTRXMyEmerdList", options);
      const histData = result.data;
      
      if (histData.code === 0 && histData.data && histData.data.list) {
        const list = histData.data.list.map(item => ({
          orderNumber: item.orderNumber,
          issueNumber: item.issueNumber,
          amount: parseFloat(item.amount) / 100,
          realAmount: parseFloat(item.realAmount) / 100,
          fee: parseFloat(item.fee) / 100,
          profit: parseFloat(item.profitAmount) / 100,
          selectType: item.selectType,
          colour: item.colour,
          number: item.number,
          state: item.state,
          status: item.state === 1 ? 'win' : (item.state === 0 ? 'loss' : 'pending'),
          addTime: item.addTime
        }));
        res.status(200).json({ success: true, list });
      } else {
        res.status(200).json({ success: false, error: histData.msg || "Failed" });
      }
    } catch (error) {
      res.status(200).json({ success: false, error: error.message });
    }
    return;
  }

  // ─── GET TRX DATA (Chart) ───
  if (req.method === 'GET' && action === 'trxData') {
    try {
      const limit = parseInt(req.query.limit) || 100;
      const fetchLimit = Math.min(limit, 100);
      const upstreamUrl = `https://apilist.tronscanapi.com/api/block?sort=-number&start=0&limit=${fetchLimit}&_ts=${Date.now()}`;
      
      const response = await axios.get(upstreamUrl, { 
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      
      const rows = response.data.data || [];
      
      const list = rows.map(row => {
        const result = resultFromHash(row.hash);
        return {
          issueNumber: row.number.toString(),
          number: result.toString(),
          blockTime: toPeriod(row.timestamp)
        };
      });

      res.status(200).json(list);
    } catch (error) {
      res.status(500).json({ error: 'Fetch Failed', message: error.message });
    }
    return;
  }

  // ─── DEFAULT ───
  res.status(200).json({ error: "Unknown action", actions: ["login", "getBalance", "getIssue", "placeBet", "getHistory", "trxData"] });
};
