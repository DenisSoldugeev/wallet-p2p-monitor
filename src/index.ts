import { config } from './config';
import { walletClient } from './api';
import { P2PMonitor } from './monitor';
import { TelegramBot } from './bot';
import { formatChangeBatch } from './formatter';
import { P2PItem } from './types';

function filterByPayments(items: P2PItem[], pairKey: string): P2PItem[] {
  const allowedMethods = config.filterPayments.get(pairKey);
  if (!allowedMethods) return items;
  return items.filter((item) =>
    item.payments.some((p) => allowedMethods.includes(p.toLowerCase()))
  );
}

const monitor = new P2PMonitor();
const bot = new TelegramBot(monitor);

let isFirstRun = true;
let pollTimer: ReturnType<typeof setInterval> | null = null;

async function poll() {
  const allChanges: import('./types').ItemChange[] = [];

  for (const pair of config.pairs) {
    try {
      const { buyItems, sellItems } = await walletClient.getAll(
        pair.cryptoCurrency,
        pair.fiatCurrency
      );

      const pairKey = `${pair.cryptoCurrency}-${pair.fiatCurrency}`;
      const filteredBuy = filterByPayments(buyItems, pairKey);
      const filteredSell = filterByPayments(sellItems, pairKey);

      const pairStr = `${pair.cryptoCurrency}/${pair.fiatCurrency}`;
      const hasFilter = config.filterPayments.has(pairKey);
      const filterNote = hasFilter
        ? ` (filtered: ${filteredBuy.length}/${buyItems.length} buy, ${filteredSell.length}/${sellItems.length} sell)`
        : '';
      console.log(
        `📊 ${pairStr} — BUY: ${buyItems.length} offers, SELL: ${sellItems.length} offers${filterNote}`
      );

      const buyChanges = monitor.processItems(
        filteredBuy,
        pair.cryptoCurrency,
        pair.fiatCurrency,
        'BUY'
      );
      const sellChanges = monitor.processItems(
        filteredSell,
        pair.cryptoCurrency,
        pair.fiatCurrency,
        'SELL'
      );

      allChanges.push(...buyChanges, ...sellChanges);
    } catch (err) {
      console.error(`❌ Error polling ${pair.cryptoCurrency}/${pair.fiatCurrency}:`, err);
    }
  }

  // On first run, send a startup summary instead of spamming all items as "new"
  if (isFirstRun) {
    isFirstRun = false;
    console.log(`✅ Initial scan complete. ${allChanges.length} items loaded.`);

    try {
      const summaryLines: string[] = [
        '🚀 <b>Монитор запущен!</b>',
        `⏱ Интервал: ${config.pollInterval} сек`,
        '',
      ];

      for (const pair of config.pairs) {
        const pairStr = `${pair.cryptoCurrency}/${pair.fiatCurrency}`;
        for (const side of ['BUY', 'SELL'] as const) {
          const stats = monitor.getStats(pair.cryptoCurrency, pair.fiatCurrency, side);
          const sideEmoji = side === 'BUY' ? '🟢' : '🔴';
          const sideLabel = side === 'BUY' ? 'Покупка' : 'Продажа';

          if (stats) {
            summaryLines.push(
              `${sideEmoji} <b>${pairStr}</b> · ${sideLabel}`,
              `   ${stats.count} предложений | ${stats.minPrice}–${stats.maxPrice} ${pair.fiatCurrency} | Объём: ${stats.totalVolume} ${pair.cryptoCurrency}`,
              ''
            );
          } else {
            summaryLines.push(`${sideEmoji} <b>${pairStr}</b> · ${sideLabel}: нет предложений`, '');
          }
        }
      }

      if (config.filterPayments.size > 0) {
        summaryLines.push('🔍 <b>Фильтры оплаты:</b>');
        for (const [pair, methods] of config.filterPayments) {
          summaryLines.push(`   ${pair}: ${methods.join(', ')}`);
        }
        summaryLines.push('');
      }
      summaryLines.push('💡 Теперь вы будете получать уведомления об изменениях.');

      await bot.notify(summaryLines.join('\n'));
    } catch (err) {
      console.error('❌ Failed to send startup message:', err);
    }
    return;
  }

  // Filter changes based on config
  const filteredChanges = allChanges.filter((change) => {
    if (!config.notifyRemoved && change.type === 'REMOVED') {
      return false;
    }

    if (config.notifyNewTopOnly > 0 && change.type === 'NEW') {
      const [crypto, fiat] = change.pair.split('/');
      const rank = monitor.getItemRank(crypto, fiat, change.side, change.item.id);
      if (rank === null || rank >= config.notifyNewTopOnly) {
        return false;
      }
    }

    return true;
  });

  // Send change notifications
  if (filteredChanges.length > 0) {
    console.log(`🔔 ${filteredChanges.length} changes detected (${allChanges.length} total, ${allChanges.length - filteredChanges.length} filtered out)`);
    const messages = formatChangeBatch(filteredChanges);

    for (const msg of messages) {
      try {
        await bot.notify(msg);
        // Small delay between messages
        await new Promise((r) => setTimeout(r, 300));
      } catch (err) {
        console.error('❌ Failed to send notification:', err);
      }
    }
  } else {
    // Log that nothing changed (debug)
    const timestamp = new Date().toLocaleTimeString('ru-RU');
    console.log(`⏳ ${timestamp} — no changes`);
  }
}

async function main() {
  console.log('═'.repeat(40));
  console.log('  🔍 Wallet P2P Monitor');
  console.log('═'.repeat(40));
  console.log(`  Pairs: ${config.pairs.map((p) => `${p.cryptoCurrency}/${p.fiatCurrency}`).join(', ')}`);
  console.log(`  Poll interval: ${config.pollInterval}s`);
  if (config.filterPayments.size > 0) {
    for (const [pair, methods] of config.filterPayments) {
      console.log(`  Payment filter [${pair}]: ${methods.join(', ')}`);
    }
  }
  console.log('═'.repeat(40));

  // Start bot
  await bot.start();

  // Initial poll
  await poll();

  // Schedule recurring polls
  pollTimer = setInterval(poll, config.pollInterval * 1000);

  console.log('✅ Monitoring started. Press Ctrl+C to stop.');
}

// Graceful shutdown
function shutdown(signal: string) {
  console.log(`\n⛔ ${signal} received. Shutting down...`);
  if (pollTimer) clearInterval(pollTimer);
  bot.stop();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main().catch((err) => {
  console.error('💀 Fatal error:', err);
  process.exit(1);
});
