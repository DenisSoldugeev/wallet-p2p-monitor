# Wallet P2P Monitor

Telegram bot for monitoring P2P offers on [Telegram Wallet](https://wallet.tg/).

## Features

- Notifications for **new offers**
- **Price change** tracking (with percentage)
- **Volume change** tracking
- Notifications for **removed offers**
- Commands for viewing **current market state**
- Trader info (level, rating, payment methods)

## Quick Start

### 1. Install

```bash
git clone <repo>
cd wallet-p2p-monitor
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

Fill in `.env`:

| Variable | Description |
|---|---|
| `BOT_TOKEN` | Token from @BotFather |
| `CHAT_ID` | Your Chat ID (use /chatid command in the bot) |
| `WALLET_API_KEY` | Wallet P2P API key |
| `POLL_INTERVAL` | Polling interval in seconds (default 30) |
| `MONITOR_PAIRS` | Comma-separated pairs: `USDT-GEL,USDT-USD` |

### 3. Run

**Development:**
```bash
npm run dev
```

**Production:**
```bash
npm run build
npm start
```

### 4. Docker (optional)

```bash
docker build -t wallet-p2p-monitor .
docker run -d --env-file .env --name p2p-monitor wallet-p2p-monitor
```

## Bot Commands

| Command | Description |
|---|---|
| `/start` | Welcome message and command list |
| `/status` | Quick overview (min/max/avg price) |
| `/snapshot` | Detailed snapshot with top 5 offers |
| `/pairs` | List of monitored pairs |
| `/chatid` | Show Chat ID |
| `/help` | Help |

## Architecture

```
src/
├── index.ts       # Entry point, orchestration
├── config.ts      # Configuration loading from .env
├── types.ts       # TypeScript types
├── api.ts         # Wallet P2P API client
├── monitor.ts     # Change tracking
├── formatter.ts   # Message formatting
└── bot.ts         # Telegram bot
```