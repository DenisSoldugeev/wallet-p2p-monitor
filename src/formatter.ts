import { ItemChange, P2PItem } from './types';

/**
 * Formats P2P changes into beautiful Telegram messages (HTML parse mode).
 */

const SIDE_EMOJI = { BUY: '🟢', SELL: '🔴' };
const SIDE_LABEL = { BUY: 'Покупка', SELL: 'Продажа' };

const CHANGE_EMOJI: Record<string, string> = {
  NEW: '✨',
  PRICE_UP: '📈',
  PRICE_DOWN: '📉',
  VOLUME_CHANGE: '📦',
  REMOVED: '🗑',
};

const CHANGE_LABEL: Record<string, string> = {
  NEW: 'Новое предложение',
  PRICE_UP: 'Цена выросла',
  PRICE_DOWN: 'Цена упала',
  VOLUME_CHANGE: 'Объём изменился',
  REMOVED: 'Предложение снято',
};

const MERCHANT_BADGE: Record<string, string> = {
  MERCHANT: '🏪 Мерчант',
  TOP_MERCHANT: '⭐ Топ мерчант',
  '': '👤 Трейдер',
};

function formatPrice(price: string, fiat: string): string {
  return `<b>${parseFloat(price).toFixed(3)}</b> ${fiat}`;
}

function formatQuantity(qty: string, crypto: string): string {
  return `${parseFloat(qty).toFixed(2)} ${crypto}`;
}

function formatPayments(payments: string[]): string {
  if (!payments.length) return '—';
  return payments
    .map((p) => {
      // Beautify known payment methods
      const names: Record<string, string> = {
        sberbank: '🏦 Сбербанк',
        tinkoff: '🟡 Тинькофф',
        raiffeisen: '🟨 Райффайзен',
        alfa_bank: '🔴 Альфа-Банк',
        bank_of_georgia: '🇬🇪 Bank of Georgia',
        tbc_bank: '🇬🇪 TBC Bank',
        wise: '💸 Wise',
        revolut: '🔵 Revolut',
        cash: '💵 Наличные',
        zelle: '💜 Zelle',
        paypal: '🅿️ PayPal',
      };
      return names[p.toLowerCase()] || `💳 ${p}`;
    })
    .join(', ');
}

function itemCard(item: P2PItem): string {
  const badge = MERCHANT_BADGE[item.merchantLevel] || MERCHANT_BADGE[''];
  const autoAccept = item.isAutoAccept ? '⚡ Авто' : '🕐 Ручная';
  const online = item.isOnline ? '🟢 Online' : '⚫ Offline';

  return [
    `${badge} <b>${escapeHtml(item.nickname)}</b>  ${online}`,
    `├ Сделок: ${item.orderNum} | Рейт: ${(parseFloat(item.executeRate) * 100).toFixed(1)}%`,
    `├ Оплата: ${formatPayments(item.payments)}`,
    `├ Лимит: ${formatPrice(item.minAmount, item.fiatCurrency)} — ${formatPrice(item.maxAmount, item.fiatCurrency)}`,
    `├ Объём: ${formatQuantity(item.lastQuantity, item.cryptoCurrency)}`,
    `├ Обработка: ${autoAccept} | ${item.paymentPeriod} мин`,
    `└ Номер: <code>${item.number}</code>`,
  ].join('\n');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Format a single change notification
 */
export function formatChange(change: ItemChange): string {
  const emoji = CHANGE_EMOJI[change.type];
  const label = CHANGE_LABEL[change.type];
  const sideEmoji = SIDE_EMOJI[change.side];
  const sideLabel = SIDE_LABEL[change.side];
  const { item } = change;

  const header = `${emoji} <b>${label}</b>\n${sideEmoji} ${sideLabel} · ${change.pair}`;

  let priceInfo = `💰 Цена: ${formatPrice(item.price, item.fiatCurrency)}`;

  if (change.type === 'PRICE_UP' || change.type === 'PRICE_DOWN') {
    const oldP = parseFloat(change.previousPrice || '0');
    const newP = parseFloat(item.price);
    const diff = newP - oldP;
    const pct = oldP > 0 ? ((diff / oldP) * 100).toFixed(2) : '0';
    const arrow = diff > 0 ? '⬆️' : '⬇️';
    priceInfo = `💰 Цена: ${formatPrice(change.previousPrice!, item.fiatCurrency)} → ${formatPrice(item.price, item.fiatCurrency)} ${arrow} ${diff > 0 ? '+' : ''}${pct}%`;
  }

  if (change.type === 'VOLUME_CHANGE') {
    const oldQ = change.previousQuantity || '0';
    priceInfo += `\n📦 Объём: ${formatQuantity(oldQ, item.cryptoCurrency)} → ${formatQuantity(item.lastQuantity, item.cryptoCurrency)}`;
  }

  const divider = '─'.repeat(16);

  return [header, '', priceInfo, '', divider, '', itemCard(item)].join('\n');
}

/**
 * Compact single-line format for batched notifications
 */
function formatChangeCompact(change: ItemChange): string {
  const emoji = CHANGE_EMOJI[change.type];
  const { item } = change;
  const badge = item.merchantLevel === 'MERCHANT' || item.merchantLevel === 'TOP_MERCHANT' ? '🏪' : '👤';
  const online = item.isOnline ? '🟢' : '⚫';
  const price = `${parseFloat(item.price).toFixed(3)} ${item.fiatCurrency}`;

  let priceInfo = price;
  if ((change.type === 'PRICE_UP' || change.type === 'PRICE_DOWN') && change.previousPrice) {
    const oldP = parseFloat(change.previousPrice);
    const newP = parseFloat(item.price);
    const pct = oldP > 0 ? (((newP - oldP) / oldP) * 100).toFixed(1) : '0';
    priceInfo = `${parseFloat(change.previousPrice).toFixed(3)} → ${price} (${newP > oldP ? '+' : ''}${pct}%)`;
  }

  return `${emoji} ${badge} ${online} <b>${escapeHtml(item.nickname)}</b> · ${priceInfo}`;
}

/**
 * Format a batch of changes into grouped messages.
 * Groups by pair to avoid message spam.
 */
export function formatChangeBatch(changes: ItemChange[]): string[] {
  if (changes.length === 0) return [];

  // If few changes, send individually
  if (changes.length <= 3) {
    return changes.map(formatChange);
  }

  // Group by pair + side
  const groups = new Map<string, ItemChange[]>();
  for (const c of changes) {
    const key = `${c.pair} ${c.side}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }

  const messages: string[] = [];

  for (const [groupKey, groupChanges] of groups) {
    const lines: string[] = [];
    const [pair, side] = groupKey.split(' ');
    const sideEmoji = SIDE_EMOJI[side as 'BUY' | 'SELL'];
    const sideLabel = SIDE_LABEL[side as 'BUY' | 'SELL'];

    lines.push(`📊 <b>Обновления ${pair}</b> · ${sideEmoji} ${sideLabel}`);
    lines.push(`📅 ${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Tbilisi' })}`);
    lines.push('');

    // Summary counts
    const newCount = groupChanges.filter((c) => c.type === 'NEW').length;
    const priceCount = groupChanges.filter((c) => c.type === 'PRICE_UP' || c.type === 'PRICE_DOWN').length;
    const volCount = groupChanges.filter((c) => c.type === 'VOLUME_CHANGE').length;
    const removedCount = groupChanges.filter((c) => c.type === 'REMOVED').length;

    const summary: string[] = [];
    if (newCount) summary.push(`✨ ${newCount} новых`);
    if (priceCount) summary.push(`📊 ${priceCount} обновлений цен`);
    if (volCount) summary.push(`📦 ${volCount} объём`);
    if (removedCount) summary.push(`🗑 ${removedCount} снято`);
    lines.push(summary.join(' · '));
    lines.push('─'.repeat(16));

    for (const change of groupChanges) {
      lines.push('');
      lines.push(formatChangeCompact(change));
    }

    messages.push(lines.join('\n'));
  }

  return messages;
}

/**
 * Format a market overview / snapshot
 */
export function formatSnapshot(
  pair: string,
  side: 'BUY' | 'SELL',
  items: P2PItem[],
  stats: { count: number; minPrice: string; maxPrice: string; avgPrice: string; totalVolume: string } | null
): string {
  const sideEmoji = SIDE_EMOJI[side];
  const sideLabel = SIDE_LABEL[side];
  const fiat = items[0]?.fiatCurrency || '';
  const crypto = items[0]?.cryptoCurrency || '';

  const lines: string[] = [];
  lines.push(`📋 <b>Обзор рынка ${pair}</b>`);
  lines.push(`${sideEmoji} ${sideLabel}`);
  lines.push(`📅 ${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Tbilisi' })}`);
  lines.push('');

  if (!stats || items.length === 0) {
    lines.push('📭 Нет активных предложений');
    return lines.join('\n');
  }

  lines.push(`📊 <b>Статистика:</b>`);
  lines.push(`├ Предложений: <b>${stats.count}</b>`);
  lines.push(`├ Мин. цена: ${formatPrice(stats.minPrice, fiat)}`);
  lines.push(`├ Макс. цена: ${formatPrice(stats.maxPrice, fiat)}`);
  lines.push(`├ Средн. цена: ${formatPrice(stats.avgPrice, fiat)}`);
  lines.push(`└ Общий объём: ${formatQuantity(stats.totalVolume, crypto)}`);
  lines.push('');
  lines.push('─'.repeat(16));

  // Show top 5 items sorted by price
  const sorted = [...items].sort((a, b) =>
    side === 'SELL'
      ? parseFloat(a.price) - parseFloat(b.price) // cheapest first for sellers
      : parseFloat(b.price) - parseFloat(a.price) // highest first for buyers
  );

  const top = sorted.slice(0, 5);
  lines.push('');
  lines.push(`🏆 <b>Топ-${top.length} предложений:</b>`);

  for (let i = 0; i < top.length; i++) {
    lines.push('');
    lines.push(`<b>#${i + 1}</b> · ${formatPrice(top[i].price, fiat)}`);
    lines.push(itemCard(top[i]));
  }

  if (sorted.length > 5) {
    lines.push(`\n... и ещё ${sorted.length - 5} предложений`);
  }

  return lines.join('\n');
}
