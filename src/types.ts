// ─── Wallet P2P API Types ───

export interface P2PRequestBody {
  cryptoCurrency: string;
  fiatCurrency: string;
  side: 'BUY' | 'SELL';
  page: number;
  pageSize: number;
}

export interface P2PItem {
  id: string;
  number: string;
  userId: number;
  nickname: string;
  cryptoCurrency: string;
  fiatCurrency: string;
  side: 'BUY' | 'SELL';
  price: string;
  lastQuantity: string;
  minAmount: string;
  maxAmount: string;
  payments: string[];
  orderNum: number;
  executeRate: string;
  isOnline: boolean;
  merchantLevel: string;
  paymentPeriod: number;
  isAutoAccept: boolean;
}

export interface P2PResponse {
  status: string;
  data: P2PItem[];
}

// ─── Internal Types ───

export interface MonitorPair {
  cryptoCurrency: string;
  fiatCurrency: string;
}

export interface TrackedItem {
  item: P2PItem;
  firstSeen: Date;
  lastSeen: Date;
  previousPrice?: string;
  priceHistory: { price: string; time: Date }[];
}

export type ChangeType = 'NEW' | 'PRICE_UP' | 'PRICE_DOWN' | 'VOLUME_CHANGE' | 'REMOVED';

export interface ItemChange {
  type: ChangeType;
  item: P2PItem;
  previousPrice?: string;
  previousQuantity?: string;
  pair: string;
  side: 'BUY' | 'SELL';
}
