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
  pollInterval: parseInt(process.env.POLL_INTERVAL || '30', 10),
  pairs: parsePairs(process.env.MONITOR_PAIRS || 'USDT-GEL,USDT-USD'),
  notifyRemoved: (process.env.NOTIFY_REMOVED || 'true').toLowerCase() !== 'false',
  notifyNewTopOnly: parseInt(process.env.NOTIFY_NEW_TOP_ONLY || '0', 10),
  priceChangeThreshold: parseFloat(process.env.PRICE_CHANGE_THRESHOLD || '0.5'),
};

function parsePairs(raw: string): MonitorPair[] {
  return raw.split(',').map((p) => {
    const [crypto, fiat] = p.trim().split('-');
    if (!crypto || !fiat) {
      console.error(`❌ Invalid pair format: "${p}". Use CRYPTO-FIAT (e.g. USDT-GEL)`);
      process.exit(1);
    }
    return { cryptoCurrency: crypto, fiatCurrency: fiat };
  });
}
