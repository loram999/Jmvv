const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API routes - use the actual handler directly
const trxHandler = require('./api/trx');
const autobetHandler = require('./api/autobet');

app.all('/api/trx', async (req, res) => {
  trxHandler(req, res);
});

app.all('/api/autobet', async (req, res) => {
  autobetHandler(req, res);
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`TRX Trading Platform running on port ${PORT}`);
});

module.exports = app;
