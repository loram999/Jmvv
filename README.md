# TRX Trading Platform v2.0

Professional TRX Chart Analysis & Auto-Betting Platform

## Features

- **Professional Landing Page** - Modern, responsive design with feature showcase
- **Login System** - Connect to 6Lottery or 777BIGWIN game accounts
- **Live TRX Chart** - Real-time candlestick chart with drawing tools
- **Manual Betting** - One-click BIG/SMALL betting directly from the chart page
- **Auto Betting** - Full auto-bet settings with strategies (BS Order, Alternate, Trend Follow, Dream, Babio, Lyzo, Sniper, AI)
- **Persistent Auto Bet** - Auto-bet continues running on server even when page is closed
- **Mobile & Desktop Responsive** - Optimized for all screen sizes
- **Vercel Deploy Ready** - Ready to deploy on Vercel

## Deployment on Vercel

1. Push this project to a GitHub repository
2. Import the repository in Vercel
3. Vercel will automatically detect the `vercel.json` configuration
4. Deploy - no additional configuration needed

## API Endpoints

- `POST /api/trx?action=login` - Login to game account
- `POST /api/trx?action=getBalance` - Get account balance
- `GET /api/trx?action=getIssue` - Get current TRX issue number
- `POST /api/trx?action=placeBet` - Place a manual bet
- `POST /api/trx?action=getHistory` - Get bet history
- `GET /api/trx?action=trxData` - Get TRX chart data
- `POST /api/autobet?action=start` - Start auto-bet session
- `POST /api/autobet?action=stop` - Stop auto-bet session
- `GET /api/autobet?action=status` - Get auto-bet status

## Tech Stack

- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **Chart**: TradingView Lightweight Charts
- **Backend**: Node.js API Routes (Vercel Serverless Functions)
- **Deployment**: Vercel
