import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { uid } from './helpers.js';
const { query, pool } = require('../server/db');
const { createExchangeMarket } = require('../server/exchange/createMarket');
const { loadBook } = require('../server/exchange/book');

const USER = uid('bk-user');
let GROUP, marketId;

beforeAll(async () => {
  await query(`INSERT INTO users (id, email, starting_points) VALUES ($1,$2,100000) ON CONFLICT (id) DO NOTHING`, [USER, `${USER}@t.internal`]);
  const g = await query(`INSERT INTO groups (name, owner_id) VALUES ('g',$1) RETURNING id`, [USER]);
  GROUP = g.rows[0].id;
  ({ marketId } = await createExchangeMarket({ groupId: GROUP, creatorId: USER, title: 'book test' }, query));
  await query(`INSERT INTO orders (market_id, user_id, side, price, quantity, filled_quantity, status) VALUES
    ($1,$2,'buy',60,10,0,'open'),
    ($1,$2,'buy',58,5,2,'partial'),
    ($1,$2,'sell',64,8,0,'open'),
    ($1,$2,'buy',55,5,5,'filled')`, [marketId, USER]);
});
afterAll(async () => { await pool.end(); });

describe('loadBook', () => {
  it('returns open/partial orders split into bids and asks with REMAINING qty', async () => {
    const book = await loadBook(marketId, query);
    expect(book.bids.map((o) => [o.price, o.qty])).toEqual(expect.arrayContaining([[60, 10], [58, 3]]));
    expect(book.bids.find((o) => o.price === 55)).toBeUndefined();
    expect(book.asks.map((o) => [o.price, o.qty])).toEqual([[64, 8]]);
  });

  it('indexes every resting order by id for maker-side lookup', async () => {
    const book = await loadBook(marketId, query);
    const anyBid = book.bids[0];
    expect(book.byId.get(anyBid.id).side).toBe('buy');
  });
});
