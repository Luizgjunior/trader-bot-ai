import fs from 'fs';
import path from 'path';

const DB_PATH = path.join(process.cwd(), '..', 'data', 'dashboard.json');

interface Store {
  status: object | null;
  analyses: string[];
  openTrades: Record<string, string>;
  closedTrades: string[];
  balance: string | null;
}

function read(): Store {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return { status: null, analyses: [], openTrades: {}, closedTrades: [], balance: null };
  }
}

function write(data: Store): void {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(data));
}

export const store = {
  get: (key: keyof Store) => read()[key],

  set(key: 'status' | 'balance', value: object | string) {
    const data = read();
    data[key] = value as never;
    write(data);
  },

  lpush(key: 'analyses' | 'closedTrades', value: string) {
    const data = read();
    data[key].unshift(value);
    write(data);
  },

  ltrim(key: 'analyses' | 'closedTrades', max: number) {
    const data = read();
    data[key] = data[key].slice(0, max + 1);
    write(data);
  },

  hset(tradeId: string, value: string) {
    const data = read();
    data.openTrades[tradeId] = value;
    write(data);
  },

  hdel(tradeId: string) {
    const data = read();
    delete data.openTrades[tradeId];
    write(data);
  },
};
