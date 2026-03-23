import axios, { AxiosInstance } from 'axios';
import { P2PItem, P2PRequestBody, P2PResponse } from './types';
import { config } from './config';

const BASE_URL = 'https://p2p.walletbot.me/p2p/integration-api/v1';
const REQUEST_DELAY_MS = config.requestDelay;
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 10000;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

class WalletP2PClient {
  private http: AxiosInstance;
  private lastRequestTime = 0;

  constructor() {
    this.http = axios.create({
      baseURL: BASE_URL,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-API-Key': config.walletApiKey,
      },
      timeout: 15000,
    });
  }

  private async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < REQUEST_DELAY_MS) {
      await delay(REQUEST_DELAY_MS - elapsed);
    }
    this.lastRequestTime = Date.now();
  }

  async getOnlineItems(
    cryptoCurrency: string,
    fiatCurrency: string,
    side: 'BUY' | 'SELL'
  ): Promise<{ items: P2PItem[]; success: boolean }> {
    const allItems: P2PItem[] = [];
    let page = 1;
    const pageSize = 50;

    while (true) {
      const body: P2PRequestBody = {
        cryptoCurrency,
        fiatCurrency,
        side,
        page,
        pageSize,
      };

      let retries = 0;

      while (retries <= MAX_RETRIES) {
        try {
          await this.throttle();
          const { data } = await this.http.post<P2PResponse>('/item/online', body);

          if (data.status !== 'SUCCESS' || !data.data?.length) {
            return { items: allItems, success: true };
          }

          allItems.push(...data.data);

          if (data.data.length < pageSize) return { items: allItems, success: true };

          if (page >= config.maxPages) {
            return { items: allItems, success: true };
          }

          page++;
          break;
        } catch (err: any) {
          if (err.response?.status === 429) {
            retries++;
            if (retries > MAX_RETRIES) {
              console.error(
                `❌ Rate limit exceeded ${MAX_RETRIES} retries [${cryptoCurrency}/${fiatCurrency} ${side}], skipping`
              );
              return { items: allItems, success: false };
            }
            const backoff = INITIAL_BACKOFF_MS * retries;
            console.warn(`⚠️  Rate limited, retry ${retries}/${MAX_RETRIES} in ${backoff / 1000}s...`);
            await delay(backoff);
            continue;
          }
          console.error(
            `❌ API error [${cryptoCurrency}/${fiatCurrency} ${side}]:`,
            err.response?.status,
            err.response?.data || err.message
          );
          return { items: allItems, success: false };
        }
      }
    }
  }

  async getAll(cryptoCurrency: string, fiatCurrency: string) {
    const buy = await this.getOnlineItems(cryptoCurrency, fiatCurrency, 'BUY');
    const sell = await this.getOnlineItems(cryptoCurrency, fiatCurrency, 'SELL');
    return { buy, sell };
  }
}

export const walletClient = new WalletP2PClient();
