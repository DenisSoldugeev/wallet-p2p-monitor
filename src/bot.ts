import { Telegraf, Context } from 'telegraf';
import { config } from './config';
import { P2PMonitor } from './monitor';
import { formatSnapshot } from './formatter';
import { walletClient } from './api';

const MAX_MESSAGE_LENGTH = 4096;
const NEW_TOP_CYCLE = [0, 3, 5, 10] as const;

type InlineKeyboard = { text: string; callback_data: string }[][];

function buildSettingsText(): string {
  const removedStatus = config.notifyRemoved ? '✅ Включены' : '❌ Выключены';
  const topN = config.notifyNewTopOnly;
  const newStatus = topN === 0 ? 'Все' : `Только топ-${topN}`;
  return [
    '⚙️ <b>Настройки уведомлений</b>',
    '',
    `🗑 Снятые предложения: <b>${removedStatus}</b>`,
    `🆕 Новые предложения: <b>${newStatus}</b>`,
  ].join('\n');
}

function settingsKeyboard(): InlineKeyboard {
  const removedLabel = config.notifyRemoved ? '🗑 Снятые: ✅ Вкл' : '🗑 Снятые: ❌ Выкл';
  const topN = config.notifyNewTopOnly;
  const newLabel = topN === 0 ? '🆕 Новые: Все' : `🆕 Новые: Топ-${topN}`;
  return [
    [{ text: removedLabel, callback_data: 'settings_toggle_removed' }],
    [{ text: newLabel, callback_data: 'settings_cycle_top' }],
  ];
}

function navKeyboard(type: 'stat' | 'snap', crypto: string, fiat: string, side: 'BUY' | 'SELL'): InlineKeyboard {
  const pair = config.pairs.find(
    (p) => p.cryptoCurrency === crypto && p.fiatCurrency === fiat
  );
  const oppSide = side === 'BUY' ? 'SELL' : 'BUY';
  const hasBothSides = pair ? pair.sides.includes(oppSide) : true;

  const row: { text: string; callback_data: string }[] = [];
  if (hasBothSides) {
    const oppEmoji = oppSide === 'BUY' ? '🟢' : '🔴';
    const oppLabel = oppSide === 'BUY' ? 'Покупка' : 'Продажа';
    row.push({ text: `${oppEmoji} ${oppLabel}`, callback_data: `${type}_flip:${crypto}:${fiat}:${oppSide}` });
  }
  row.push({ text: '📋 Другая пара', callback_data: `${type}_pick` });

  return [row];
}

export class TelegramBot {
  bot: Telegraf;
  private monitor: P2PMonitor;

  constructor(monitor: P2PMonitor) {
    this.bot = new Telegraf(config.botToken);
    this.monitor = monitor;
    this.setupCommands();
  }

  private setupCommands() {
    this.bot.command('start', (ctx) => {
      ctx.replyWithHTML(
        [
          '🤖 <b>Wallet P2P Monitor</b>',
          '',
          'Мониторинг P2P предложений на Telegram Wallet.',
          '',
          '📋 <b>Команды:</b>',
          '/status — Обзор текущего рынка',
          '/snapshot — Подробный снапшот всех пар',
          '/payments — Доступные методы оплаты',
          '/chatid — Показать ваш Chat ID',
          '/pairs — Показать отслеживаемые пары',
          '/settings — Настройки уведомлений',
          '/help — Помощь',
          '',
          `⏱ Интервал опроса: ${config.pollInterval} сек`,
          `📊 Пары: ${config.pairs.map((p) => `${p.cryptoCurrency}/${p.fiatCurrency}:${p.sides.join('+')}`).join(', ')}`,
        ].join('\n')
      );
    });

    this.bot.command('chatid', (ctx) => {
      ctx.replyWithHTML(`🆔 Ваш Chat ID: <code>${ctx.chat.id}</code>`);
    });

    this.bot.command('pairs', (ctx) => {
      const lines: string[] = ['📊 <b>Отслеживаемые пары:</b>', ''];
      for (const p of config.pairs) {
        const status = p.enabled ? '✅' : '❌';
        const sidesStr = p.sides.join('+');
        lines.push(`${status} ${p.cryptoCurrency}/${p.fiatCurrency} · ${sidesStr}`);
      }
      const buttons = config.pairs.map((p, i) => {
        const label = p.enabled
          ? `❌ Выкл ${p.cryptoCurrency}/${p.fiatCurrency}`
          : `✅ Вкл ${p.cryptoCurrency}/${p.fiatCurrency}`;
        return [{ text: label, callback_data: `pair_toggle:${i}` }];
      });
      ctx.replyWithHTML(lines.join('\n'), {
        reply_markup: { inline_keyboard: buttons },
      });
    });

    this.bot.action(/^pair_toggle:(\d+)$/, async (ctx) => {
      const idx = parseInt(ctx.match![1], 10);
      if (idx < 0 || idx >= config.pairs.length) {
        await ctx.answerCbQuery('Пара не найдена');
        return;
      }
      const pair = config.pairs[idx];
      pair.enabled = !pair.enabled;
      const statusLabel = pair.enabled ? 'включена' : 'выключена';
      await ctx.answerCbQuery(`${pair.cryptoCurrency}/${pair.fiatCurrency} ${statusLabel}`);

      const lines: string[] = ['📊 <b>Отслеживаемые пары:</b>', ''];
      for (const p of config.pairs) {
        const status = p.enabled ? '✅' : '❌';
        const sidesStr = p.sides.join('+');
        lines.push(`${status} ${p.cryptoCurrency}/${p.fiatCurrency} · ${sidesStr}`);
      }
      const buttons = config.pairs.map((p, i) => {
        const label = p.enabled
          ? `❌ Выкл ${p.cryptoCurrency}/${p.fiatCurrency}`
          : `✅ Вкл ${p.cryptoCurrency}/${p.fiatCurrency}`;
        return [{ text: label, callback_data: `pair_toggle:${i}` }];
      });
      await ctx.editMessageText(lines.join('\n'), {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buttons },
      });
    });

    this.bot.command('status', (ctx) => {
      const buttons = config.pairs.filter((p) => p.enabled).flatMap((p) => {
        const pairStr = `${p.cryptoCurrency}/${p.fiatCurrency}`;
        const row: { text: string; callback_data: string }[] = [];
        if (p.sides.includes('BUY')) {
          row.push({ text: `🟢 ${pairStr} Покупка`, callback_data: `stat:${p.cryptoCurrency}:${p.fiatCurrency}:BUY` });
        }
        if (p.sides.includes('SELL')) {
          row.push({ text: `🔴 ${pairStr} Продажа`, callback_data: `stat:${p.cryptoCurrency}:${p.fiatCurrency}:SELL` });
        }
        return [row];
      });
      ctx.reply('📊 Выберите пару и сторону:', {
        reply_markup: { inline_keyboard: buttons },
      });
    });

    this.bot.action(/^stat:(.+):(.+):(BUY|SELL)$/, async (ctx) => {
      const [, crypto, fiat, side] = ctx.match!;
      await ctx.answerCbQuery();
      await ctx.deleteMessage().catch(() => {});
      await this.sendQuickStatus(ctx, crypto, fiat, side as 'BUY' | 'SELL');
    });

    this.bot.command('snapshot', (ctx) => {
      const buttons = config.pairs.filter((p) => p.enabled).flatMap((p) => {
        const pairStr = `${p.cryptoCurrency}/${p.fiatCurrency}`;
        const row: { text: string; callback_data: string }[] = [];
        if (p.sides.includes('BUY')) {
          row.push({ text: `🟢 ${pairStr} Покупка`, callback_data: `snap:${p.cryptoCurrency}:${p.fiatCurrency}:BUY` });
        }
        if (p.sides.includes('SELL')) {
          row.push({ text: `🔴 ${pairStr} Продажа`, callback_data: `snap:${p.cryptoCurrency}:${p.fiatCurrency}:SELL` });
        }
        return [row];
      });
      ctx.reply('📋 Выберите пару и сторону:', {
        reply_markup: { inline_keyboard: buttons },
      });
    });

    this.bot.action(/^snap:(.+):(.+):(BUY|SELL)$/, async (ctx) => {
      const [, crypto, fiat, side] = ctx.match!;
      await ctx.answerCbQuery();
      await ctx.deleteMessage().catch(() => {});
      await this.sendPairSnapshot(ctx, crypto, fiat, side as 'BUY' | 'SELL');
    });

    // Flip side — edit message in place (status) or resend (snapshot)
    this.bot.action(/^stat_flip:(.+):(.+):(BUY|SELL)$/, async (ctx) => {
      const [, crypto, fiat, side] = ctx.match!;
      await ctx.answerCbQuery();
      const text = this.buildStatusText(crypto, fiat, side as 'BUY' | 'SELL');
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: navKeyboard('stat', crypto, fiat, side as 'BUY' | 'SELL') },
      });
    });

    this.bot.action(/^snap_flip:(.+):(.+):(BUY|SELL)$/, async (ctx) => {
      const [, crypto, fiat, side] = ctx.match!;
      await ctx.answerCbQuery();
      await ctx.deleteMessage().catch(() => {});
      await this.sendPairSnapshot(ctx, crypto, fiat, side as 'BUY' | 'SELL');
    });

    // Pick another pair
    this.bot.action(/^stat_pick$/, async (ctx) => {
      await ctx.answerCbQuery();
      const buttons = config.pairs.filter((p) => p.enabled).flatMap((p) => {
        const pairStr = `${p.cryptoCurrency}/${p.fiatCurrency}`;
        const row: { text: string; callback_data: string }[] = [];
        if (p.sides.includes('BUY')) {
          row.push({ text: `🟢 ${pairStr} Покупка`, callback_data: `stat:${p.cryptoCurrency}:${p.fiatCurrency}:BUY` });
        }
        if (p.sides.includes('SELL')) {
          row.push({ text: `🔴 ${pairStr} Продажа`, callback_data: `stat:${p.cryptoCurrency}:${p.fiatCurrency}:SELL` });
        }
        return [row];
      });
      await ctx.editMessageText('📊 Выберите пару и сторону:', {
        reply_markup: { inline_keyboard: buttons },
      });
    });

    this.bot.action(/^snap_pick$/, async (ctx) => {
      await ctx.answerCbQuery();
      const buttons = config.pairs.filter((p) => p.enabled).flatMap((p) => {
        const pairStr = `${p.cryptoCurrency}/${p.fiatCurrency}`;
        const row: { text: string; callback_data: string }[] = [];
        if (p.sides.includes('BUY')) {
          row.push({ text: `🟢 ${pairStr} Покупка`, callback_data: `snap:${p.cryptoCurrency}:${p.fiatCurrency}:BUY` });
        }
        if (p.sides.includes('SELL')) {
          row.push({ text: `🔴 ${pairStr} Продажа`, callback_data: `snap:${p.cryptoCurrency}:${p.fiatCurrency}:SELL` });
        }
        return [row];
      });
      await ctx.editMessageText('📋 Выберите пару и сторону:', {
        reply_markup: { inline_keyboard: buttons },
      });
    });

    this.bot.command('settings', (ctx) => {
      ctx.replyWithHTML(buildSettingsText(), {
        reply_markup: { inline_keyboard: settingsKeyboard() },
      });
    });

    this.bot.action('settings_toggle_removed', async (ctx) => {
      config.notifyRemoved = !config.notifyRemoved;
      await ctx.answerCbQuery(`Снятые: ${config.notifyRemoved ? 'Включены' : 'Выключены'}`);
      await ctx.editMessageText(buildSettingsText(), {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: settingsKeyboard() },
      });
    });

    this.bot.action('settings_cycle_top', async (ctx) => {
      const currentIdx = NEW_TOP_CYCLE.indexOf(config.notifyNewTopOnly as (typeof NEW_TOP_CYCLE)[number]);
      const nextIdx = (currentIdx + 1) % NEW_TOP_CYCLE.length;
      config.notifyNewTopOnly = NEW_TOP_CYCLE[nextIdx];
      const label = config.notifyNewTopOnly === 0 ? 'Все' : `Топ-${config.notifyNewTopOnly}`;
      await ctx.answerCbQuery(`Новые: ${label}`);
      await ctx.editMessageText(buildSettingsText(), {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: settingsKeyboard() },
      });
    });

    this.bot.command('payments', async (ctx) => {
      const lines: string[] = ['💳 <b>Методы оплаты в текущих офферах:</b>', ''];

      let hasData = false;
      for (const pair of config.pairs.filter((p) => p.enabled)) {
        const pairKey = `${pair.cryptoCurrency}-${pair.fiatCurrency}`;
        const pairStr = `${pair.cryptoCurrency}/${pair.fiatCurrency}`;
        const pairPayments = new Map<string, number>();

        for (const side of pair.sides) {
          const snapshot = this.monitor.getSnapshot(pair.cryptoCurrency, pair.fiatCurrency, side);
          for (const tracked of snapshot) {
            for (const p of tracked.item.payments) {
              pairPayments.set(p, (pairPayments.get(p) || 0) + 1);
            }
          }
        }

        if (pairPayments.size === 0) continue;
        hasData = true;

        const sorted = [...pairPayments.entries()].sort((a, b) => b[1] - a[1]);
        lines.push(`📊 <b>${pairStr}</b>`);
        for (const [name, count] of sorted) {
          lines.push(`  • <code>${name}</code> — ${count} офферов`);
        }

        const filter = config.filterPayments.get(pairKey);
        if (filter) {
          lines.push(`  🔍 Фильтр: ${filter.join(', ')}`);
        }
        lines.push('');
      }

      if (!hasData) {
        ctx.replyWithHTML('📭 Нет данных. Дождитесь первого цикла опроса.');
        return;
      }

      ctx.replyWithHTML(lines.join('\n'));
    });

    this.bot.command('help', (ctx) => {
      ctx.replyWithHTML(
        [
          '❓ <b>Помощь</b>',
          '',
          'Бот автоматически отслеживает P2P предложения и присылает уведомления при:',
          '',
          '✨ Новое предложение появилось',
          '📈 Цена выросла',
          '📉 Цена упала',
          '📦 Объём изменился',
          '🗑 Предложение снято',
          '',
          'Все изменения сравниваются с предыдущим состоянием.',
          '',
          '/status — быстрый обзор (мин/макс/средн цена)',
          '/snapshot — подробный снапшот с топ предложениями',
          '/payments — все методы оплаты в текущих офферах',
          '/settings — настройки фильтрации уведомлений',
        ].join('\n')
      );
    });
  }

  private buildStatusText(crypto: string, fiat: string, side: 'BUY' | 'SELL'): string {
    const stats = this.monitor.getStats(crypto, fiat, side);
    const pairStr = `${crypto}/${fiat}`;
    const sideEmoji = side === 'BUY' ? '🟢' : '🔴';
    const sideLabel = side === 'BUY' ? 'Покупка' : 'Продажа';

    if (!stats) {
      return `${sideEmoji} <b>${pairStr}</b> ${sideLabel}\n📭 Нет данных (ожидайте первый цикл опроса)`;
    }

    return [
      `${sideEmoji} <b>${pairStr}</b> · ${sideLabel}`,
      `├ Предложений: <b>${stats.count}</b>`,
      `├ Мин: <b>${stats.minPrice}</b> ${fiat}`,
      `├ Макс: <b>${stats.maxPrice}</b> ${fiat}`,
      `├ Средн: <b>${stats.avgPrice}</b> ${fiat}`,
      `└ Объём: <b>${stats.totalVolume}</b> ${crypto}`,
    ].join('\n');
  }

  private async sendQuickStatus(ctx: Context, crypto: string, fiat: string, side: 'BUY' | 'SELL') {
    const text = this.buildStatusText(crypto, fiat, side);
    await ctx.replyWithHTML(text, {
      reply_markup: { inline_keyboard: navKeyboard('stat', crypto, fiat, side) },
    });
  }

  private async sendPairSnapshot(ctx: Context, crypto: string, fiat: string, side: 'BUY' | 'SELL') {
    const loading = await ctx.replyWithHTML('⏳ Генерация снапшота...');
    try {
      const { items } = await walletClient.getOnlineItems(crypto, fiat, side);
      const stats = this.monitor.getStats(crypto, fiat, side);
      const pairStr = `${crypto}/${fiat}`;
      const msg = formatSnapshot(pairStr, side, items, stats);
      const keyboard = navKeyboard('snap', crypto, fiat, side);
      await this.safeSend(ctx.chat!.id.toString(), msg, keyboard);
    } catch (err) {
      console.error('Snapshot error:', err);
      await ctx.replyWithHTML('❌ Ошибка при получении данных');
    }
    await ctx.deleteMessage(loading.message_id).catch(() => {});
  }

  /**
   * Send a notification to the configured chat
   */
  async notify(message: string): Promise<void> {
    await this.safeSend(config.chatId, message);
  }

  /**
   * Send message with auto-splitting for long messages
   */
  private async safeSend(chatId: string, text: string, keyboard?: InlineKeyboard): Promise<void> {
    if (text.length <= MAX_MESSAGE_LENGTH) {
      await this.bot.telegram.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
      });
      return;
    }

    // Split by double newline, keeping chunks under limit
    const chunks: string[] = [];
    let current = '';

    for (const part of text.split('\n\n')) {
      if ((current + '\n\n' + part).length > MAX_MESSAGE_LENGTH) {
        if (current) chunks.push(current.trim());
        current = part;
      } else {
        current = current ? current + '\n\n' + part : part;
      }
    }
    if (current.trim()) chunks.push(current.trim());

    for (let i = 0; i < chunks.length; i++) {
      const isLast = i === chunks.length - 1;
      await this.bot.telegram.sendMessage(chatId, chunks[i], {
        parse_mode: 'HTML',
        reply_markup: isLast && keyboard ? { inline_keyboard: keyboard } : undefined,
      });
      if (!isLast) await new Promise((r) => setTimeout(r, 200));
    }
  }

  async start(): Promise<void> {
    this.bot.launch().catch((err) => {
      console.error('❌ Telegram bot launch error:', err);
      process.exit(1);
    });
    console.log('🤖 Telegram bot started');
  }

  stop(): void {
    this.bot.stop('SIGTERM');
  }
}
