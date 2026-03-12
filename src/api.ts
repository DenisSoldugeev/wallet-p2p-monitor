import axios, { AxiosInstance } from 'axios';
import { P2PItem, P2PRequestBody, P2PResponse } from './types';
import { config } from './config';

const BASE_URL = 'https://p2p.walletbot.me/p2p/integration-api/v1';

class WalletP2PClient {
  private http: AxiosInstance;

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

  /**
   * Fetch all online items (ads) for a given pair and side.
   * Automatically paginates to get all results.
   */
  async getOnlineItems(
    cryptoCurrency: string,
    fiatCurrency: string,
    side: 'BUY' | 'SELL'
  ): Promise<P2PItem[]> {
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

      try {
        const { data } = await this.http.post<P2PResponse>('/item/online', body);

        if (data.status !== 'SUCCESS' || !data.data?.length) break;

        allItems.push(...data.data);

        // If we got fewer items than pageSize, we've reached the end
        if (data.data.length < pageSize) break;

        page++;
      } catch (err: any) {
        if (err.response?.status === 429) {
          console.warn('⚠️  Rate limited, waiting 5s...');
          await new Promise((r) => setTimeout(r, 5000));
          continue;
        }
        console.error(
          `❌ API error [${cryptoCurrency}/${fiatCurrency} ${side}]:`,
          err.response?.status,
          err.response?.data || err.message
        );
        break;
      }
    }

    return allItems;
  }

  /**
   * Fetch all items for a pair (both BUY and SELL sides)
   */
  async getAll(cryptoCurrency: string, fiatCurrency: string) {
    const [buyItems, sellItems] = await Promise.all([
      this.getOnlineItems(cryptoCurrency, fiatCurrency, 'BUY'),
      this.getOnlineItems(cryptoCurrency, fiatCurrency, 'SELL'),
    ]);
    return { buyItems, sellItems };
  }
}

export const walletClient = new WalletP2PClient();
