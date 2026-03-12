import { P2PItem, ItemChange, TrackedItem } from './types';
import { config } from './config';

/**
 * Tracks state of P2P items and detects changes between polling cycles.
 */
export class P2PMonitor {
  // key = "PAIR:SIDE:ITEM_ID"
  private tracked = new Map<string, TrackedItem>();

  private makeKey(item: P2PItem): string {
    return `${item.cryptoCurrency}/${item.fiatCurrency}:${item.side}:${item.id}`;
  }

  /**
   * Process a batch of items from one poll and return detected changes.
   */
  processItems(
    items: P2PItem[],
    cryptoCurrency: string,
    fiatCurrency: string,
    side: 'BUY' | 'SELL'
  ): ItemChange[] {
    const changes: ItemChange[] = [];
    const pair = `${cryptoCurrency}/${fiatCurrency}`;
    const now = new Date();
    const currentIds = new Set<string>();

    for (const item of items) {
      const key = this.makeKey(item);
      currentIds.add(key);
      const existing = this.tracked.get(key);

      if (!existing) {
        // ✨ New item
        changes.push({ type: 'NEW', item, pair, side });
        this.tracked.set(key, {
          item,
          firstSeen: now,
          lastSeen: now,
          priceHistory: [{ price: item.price, time: now }],
        });
      } else {
        // Check for price change
        const oldPrice = parseFloat(existing.item.price);
        const newPrice = parseFloat(item.price);
        const priceDiffPct = oldPrice > 0 ? Math.abs(newPrice - oldPrice) / oldPrice * 100 : 0;
        if (priceDiffPct >= config.priceChangeThreshold) {
          changes.push({
            type: newPrice > oldPrice ? 'PRICE_UP' : 'PRICE_DOWN',
            item,
            previousPrice: existing.item.price,
            pair,
            side,
          });
          existing.priceHistory.push({ price: item.price, time: now });
          // Keep last 20 price points
          if (existing.priceHistory.length > 20) {
            existing.priceHistory = existing.priceHistory.slice(-20);
          }
        }

        existing.item = item;
        existing.lastSeen = now;
        existing.previousPrice = existing.item.price;
      }
    }

    // Check for removed items (were tracked for this pair+side but not in current batch)
    const prefix = `${pair}:${side}:`;
    for (const [key, tracked] of this.tracked.entries()) {
      if (key.startsWith(prefix) && !currentIds.has(key)) {
        changes.push({
          type: 'REMOVED',
          item: tracked.item,
          pair,
          side,
        });
        this.tracked.delete(key);
      }
    }

    return changes;
  }

  /**
   * Get current snapshot for a pair + side
   */
  getSnapshot(cryptoCurrency: string, fiatCurrency: string, side: 'BUY' | 'SELL'): TrackedItem[] {
    const prefix = `${cryptoCurrency}/${fiatCurrency}:${side}:`;
    const result: TrackedItem[] = [];
    for (const [key, tracked] of this.tracked.entries()) {
      if (key.startsWith(prefix)) {
        result.push(tracked);
      }
    }
    return result.sort((a, b) => parseFloat(a.item.price) - parseFloat(b.item.price));
  }

  /**
   * Get 0-based rank of an item by price (0 = best price).
   * For SELL best = lowest price, for BUY best = highest price.
   */
  getItemRank(
    cryptoCurrency: string,
    fiatCurrency: string,
    side: 'BUY' | 'SELL',
    itemId: string
  ): number | null {
    const snapshot = this.getSnapshot(cryptoCurrency, fiatCurrency, side);
    // snapshot is sorted by price ascending
    if (side === 'BUY') {
      // For BUY, best price = highest → reverse order
      const reversed = [...snapshot].reverse();
      const idx = reversed.findIndex((t) => String(t.item.id) === String(itemId));
      return idx === -1 ? null : idx;
    }
    // For SELL, best price = lowest → already correct order
    const idx = snapshot.findIndex((t) => String(t.item.id) === String(itemId));
    return idx === -1 ? null : idx;
  }

  /**
   * Get stats summary
   */
  getStats(cryptoCurrency: string, fiatCurrency: string, side: 'BUY' | 'SELL') {
    const items = this.getSnapshot(cryptoCurrency, fiatCurrency, side);
    if (items.length === 0) return null;

    const prices = items.map((i) => parseFloat(i.item.price));
    const volumes = items.map((i) => parseFloat(i.item.lastQuantity));

    return {
      count: items.length,
      minPrice: Math.min(...prices).toFixed(2),
      maxPrice: Math.max(...prices).toFixed(2),
      avgPrice: (prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2),
      totalVolume: volumes.reduce((a, b) => a + b, 0).toFixed(2),
    };
  }
}
