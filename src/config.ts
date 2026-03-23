import dotenv from 'dotenv';
import { MonitorPair } from './types';

dotenv.config();

function required(key: string): string {
  const val = process.env[key];
  if (!val) {
    console.error(`❌ Missing required env variable: ${key}`);
    console.error(`   Copy .env.example to .env and fill in your values.`);
    process.exit(1);
  }
  return val;
}

export const config = {
  botToken: required('BOT_TOKEN'),
  chatId: required('CHAT_ID'),
  walletApiKey: required('WALLET_API_KEY'),
  pollInterval: parseInt(process.env.POLL_INTERVAL || '60', 10),
  pairs: parsePairs(process.env.MONITOR_PAIRS || 'USDT-GEL,USDT-USD,USDT-RUB:SELL'),
  notifyRemoved: (process.env.NOTIFY_REMOVED || 'false').toLowerCase() !== 'false',
  notifyNewTopOnly: parseInt(process.env.NOTIFY_NEW_TOP_ONLY || '5', 10),
  priceChangeThreshold: parseFloat(process.env.PRICE_CHANGE_THRESHOLD || '0.5'),
  requestDelay: parseInt(process.env.REQUEST_DELAY || '3000', 10),
  maxPages: parseInt(process.env.MAX_PAGES || '3', 10),
  filterPayments: parsePaymentFilters(process.env.FILTER_PAYMENTS || ''),
};

function parsePaymentFilters(raw: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  if (!raw.trim()) return result;

  for (const segment of raw.split(';')) {
    const trimmed = segment.trim();
    if (!trimmed) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const pair = trimmed.slice(0, colonIdx).trim().toUpperCase();
    const methods = trimmed
      .slice(colonIdx + 1)
      .split(',')
      .map((m) => m.trim().toLowerCase())
      .filter(Boolean);

    if (pair && methods.length > 0) {
      result.set(pair, methods);
    }
  }

  return result;
}

function parsePairs(raw: string): MonitorPair[] {
  return raw.split(',').map((p) => {
    const trimmed = p.trim();
    const [pairPart, sidesPart] = trimmed.split(':');
    const [crypto, fiat] = pairPart.split('-');
    if (!crypto || !fiat) {
      console.error(`❌ Invalid pair format: "${p}". Use CRYPTO-FIAT or CRYPTO-FIAT:SELL (e.g. USDT-GEL, USDT-RUB:SELL)`);
      process.exit(1);
    }

    let sides: ('BUY' | 'SELL')[] = ['BUY', 'SELL'];
    if (sidesPart) {
      sides = sidesPart
        .toUpperCase()
        .split('+')
        .filter((s): s is 'BUY' | 'SELL' => s === 'BUY' || s === 'SELL');
      if (sides.length === 0) {
        console.error(`❌ Invalid sides in pair "${p}". Use BUY, SELL or BUY+SELL`);
        process.exit(1);
      }
    }

    return { cryptoCurrency: crypto, fiatCurrency: fiat, sides, enabled: true };
  });
}
