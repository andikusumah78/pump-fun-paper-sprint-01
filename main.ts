// Pump.fun Paper Sprint — pullback rider with pyramiding.
//
// What the dev data shows: most new pump.fun coins spike early and retrace,
// so buying the open loses; but a coin that already ran hard (+60% over its
// first price), pulled back (-10% from its peak) and is bouncing again
// (+5% off the trough) with real breadth (10+ distinct buyers) keeps
// running often enough to pay. This bot buys that second wave, then rides
// it: take profit at +20%, trail the peak once +10% in profit, cut at -20%,
// free the slot when a coin stalls. While a winner is held, the bot keeps
// buying while the bounce signal holds — each batch's buy is its own
// order, and the exposure cap (0.50 SOL of filled buys per coin) bounds
// the total — so size scales into strength instead of chasing with one
// big bet. The per-reply size cap is 1% of real reserves, so exposure
// also scales with the coin's own growth.
//
// Everything is decided from the event stream the harness delivers — no
// network, no clock, no randomness — so two replays of the same window
// produce the same orders. Prices are bonding-curve ratios (virtual SOL
// reserves over virtual token reserves) compared with bigint
// cross-multiplication, so no floating point ever decides a trade.

import { LAMPORTS_PER_SOL, runBot, type BuyInput, type SellInput } from './vendor/makefun-bot.ts';

// ---- tunables (all in lamports / basis points / slots) -------------------
const STAKE_LAMPORTS = LAMPORTS_PER_SOL / 5n; // 0.20 SOL per buy
const MAX_EXPOSURE_LAMPORTS = LAMPORTS_PER_SOL / 2n; // 0.50 SOL per coin, all buys
const MIN_BUY_LAMPORTS = LAMPORTS_PER_SOL / 100n; // 0.01 SOL guardrail floor
const BUY_SLIPPAGE_BPS = 2000; // skip the fill if the price ran away in the latency
const SELL_SLIPPAGE_BPS = 10_000; // exits must land: never let a dump strand us holding
const PEAK_MIN_BPS = 6000; // the coin must have run +60% over its first price
const PULLBACK_BPS = 1000; // ... then pulled back -10% from that peak
const BOUNCE_BPS = 500; // ... then bounced +5% off the trough
const MIN_BUYERS = 10; // ... with at least 10 distinct buyers behind it
const TAKE_PROFIT_BPS = 2000; // sell all at +20% over entry
const TRAIL_ARM_BPS = 1000; // arm the trailing stop once +10% in profit
const TRAIL_DROP_BPS = 1000; // sell when -10% below the peak after arming
const STOP_BPS = 2000; // hard stop at -20% under entry
const STALE_SLOTS = 3000; // free the slot if held this long without +5%
const STALE_GAIN_BPS = 500;

// ---- price-ratio helpers (bigint, no floats) -----------------------------
// True when price (aQ/aT) is at least `bps` above price (bQ/bT).
function upByAtLeast(aQ: bigint, aT: bigint, bQ: bigint, bT: bigint, bps: number): boolean {
  return aQ * bT * 10_000n >= bQ * aT * BigInt(10_000 + bps);
}
// True when price (aQ/aT) is at least `bps` below price (bQ/bT).
function downByAtLeast(aQ: bigint, aT: bigint, bQ: bigint, bT: bigint, bps: number): boolean {
  return aQ * bT * 10_000n <= bQ * aT * BigInt(10_000 - bps);
}
// True when price (aQ/aT) is above price (bQ/bT) by any amount.
function above(aQ: bigint, aT: bigint, bQ: bigint, bT: bigint): boolean {
  return aQ * bT > bQ * aT;
}

interface Track {
  firstQ: bigint;
  firstT: bigint;
  peakQ: bigint;
  peakT: bigint;
  troughQ: bigint;
  troughT: bigint;
  armed: boolean;
}

interface Held {
  entryQ: bigint; // cost lamports per token held (fees included)
  entryT: bigint;
  peakQ: bigint;
  peakT: bigint;
  entrySlot: number;
}

const tracks = new Map<string, Track>();
const held = new Map<string, Held>();
const buyers = new Map<string, Set<string>>();
// Coins whose entry cycle is done (position closed): never re-enter them.
const decided = new Set<string>();
// Lamports spent per coin (fills only), bounding the pyramid.
const exposure = new Map<string, bigint>();

await runBot({
  onBatch(state, batch) {
    const { caps } = state.hello;
    const tx = state.txFeeLamports();
    const orders: Array<BuyInput | SellInput> = [];

    // --- fills: book buy fills into exposure, re-arm the pullback machine --
    const pendingBuys = new Set<string>();
    const pendingSells = new Set<string>();
    for (const p of state.pending.values()) {
      if (p.order.side === 'buy') pendingBuys.add(p.order.mint);
      else pendingSells.add(p.order.mint);
    }
    for (const f of batch.fills) {
      if (f.status !== 'filled' || f.side !== 'buy') continue;
      exposure.set(f.mint, (exposure.get(f.mint) ?? 0n) + BigInt(f.quote_lamports));
      const tr = tracks.get(f.mint);
      if (tr !== undefined) {
        // A fresh buy restarts the pullback watch from the fill price: the
        // next dip-and-bounce from here is the next pyramid step.
        tr.armed = false;
        tr.troughQ = BigInt(f.quote_lamports);
        tr.troughT = BigInt(f.token_amount);
      }
    }

    // --- exits first: free slots before deciding new entries --------------
    for (const [mint, pos] of state.positions) {
      if (pendingSells.has(mint)) continue;
      const curve = state.curves.get(mint);
      if (curve === undefined || curve.complete) continue;
      const q = curve.virtual_quote_reserves;
      const t = curve.virtual_token_reserves;
      if (t === 0n) continue;
      let h = held.get(mint);
      if (h === undefined) {
        // First batch the filled position is visible: anchor on the true
        // break-even price (SOL spent per token, fees included).
        h = {
          entryQ: pos.cost_lamports,
          entryT: pos.token_amount,
          peakQ: pos.cost_lamports,
          peakT: pos.token_amount,
          entrySlot: state.slot,
        };
        held.set(mint, h);
      }
      if (above(q, t, h.peakQ, h.peakT)) {
        h.peakQ = q;
        h.peakT = t;
      }
      const takeProfit = upByAtLeast(q, t, h.entryQ, h.entryT, TAKE_PROFIT_BPS);
      const stopLoss = downByAtLeast(q, t, h.entryQ, h.entryT, STOP_BPS);
      const armed = upByAtLeast(h.peakQ, h.peakT, h.entryQ, h.entryT, TRAIL_ARM_BPS);
      const trailedOff = armed && downByAtLeast(q, t, h.peakQ, h.peakT, TRAIL_DROP_BPS);
      const stale =
        state.slot - h.entrySlot > STALE_SLOTS &&
        !upByAtLeast(q, t, h.entryQ, h.entryT, STALE_GAIN_BPS);
      if (takeProfit || stopLoss || trailedOff || stale) {
        orders.push({
          side: 'sell',
          mint,
          token_amount: pos.token_amount,
          max_slippage_bps: SELL_SLIPPAGE_BPS,
        });
      }
    }
    // Positions that are gone had their cycle end: never re-enter them.
    for (const mint of [...held.keys()]) {
      if (!state.positions.has(mint)) {
        held.delete(mint);
        decided.add(mint);
      }
    }

    // --- entries: one pullback-bounce signal per coin, pyramid while held --
    let free = state.freeCashLamports();
    for (const o of orders) {
      if (o.side === 'sell') free -= tx; // a sell still pays its tx fee
    }
    const committed = new Set<string>(state.positions.keys());
    for (const m of pendingBuys) committed.add(m);
    let slots = caps.max_open_positions - committed.size;

    // Distinct buyers behind each coin, from this batch's trades.
    for (const e of batch.events) {
      if (e.event === 'TradeEvent' && e.is_buy) {
        let set = buyers.get(e.mint);
        if (set === undefined) {
          set = new Set<string>();
          buyers.set(e.mint, set);
        }
        set.add(e.user);
      }
    }

    // One pass over this batch's distinct mints, in event order.
    const seenThisBatch = new Set<string>();
    for (const e of batch.events) {
      if (orders.length >= caps.max_orders_per_batch || slots <= 0) break;
      const mint = e.mint;
      if (seenThisBatch.has(mint)) continue;
      seenThisBatch.add(mint);
      const curve = state.curves.get(mint);
      if (curve === undefined || curve.complete) {
        tracks.delete(mint);
        continue;
      }
      const heldNow = state.positions.has(mint) || pendingBuys.has(mint);
      if (decided.has(mint) && !heldNow) continue;
      if (heldNow && (exposure.get(mint) ?? 0n) >= MAX_EXPOSURE_LAMPORTS) continue;
      let tr = tracks.get(mint);
      if (tr === undefined) {
        // First time this mint is seen: anchor its first price, peak and trough.
        tr = {
          firstQ: curve.virtual_quote_reserves,
          firstT: curve.virtual_token_reserves,
          peakQ: curve.virtual_quote_reserves,
          peakT: curve.virtual_token_reserves,
          troughQ: curve.virtual_quote_reserves,
          troughT: curve.virtual_token_reserves,
          armed: false,
        };
        tracks.set(mint, tr);
        continue; // need at least one more batch of price action
      }
      const q = curve.virtual_quote_reserves;
      const t = curve.virtual_token_reserves;
      if (t === 0n || tr.firstT === 0n) continue;
      // The size cap is the gate: a fresh curve holds no real SOL, so the
      // first buy waits until real buys have put at least 1 SOL in.
      const cap = state.maxBuyLamports(mint);
      if (cap < MIN_BUY_LAMPORTS) continue;
      // Breadth first: a bounce nobody is buying is just noise.
      if ((buyers.get(mint)?.size ?? 0) < MIN_BUYERS) continue;
      // Peak and trough are tracked from the price before this batch's move
      // for the signal, then updated with it — a new high can never itself
      // be the pullback that triggers a buy.
      const strong = upByAtLeast(tr.peakQ, tr.peakT, tr.firstQ, tr.firstT, PEAK_MIN_BPS);
      let signal = false;
      if (strong) {
        if (downByAtLeast(q, t, tr.peakQ, tr.peakT, PULLBACK_BPS)) {
          tr.armed = true;
          if (t > 0n && tr.troughT > 0n && q * tr.troughT < tr.troughQ * t) {
            tr.troughQ = q;
            tr.troughT = t;
          }
        }
        if (tr.armed && upByAtLeast(q, t, tr.troughQ, tr.troughT, BOUNCE_BPS)) {
          signal = true;
        }
      }
      if (above(q, t, tr.peakQ, tr.peakT)) {
        tr.peakQ = q;
        tr.peakT = t;
      }
      if (!signal) continue;
      // The pyramid buys while the bounce signal holds, even with a buy
      // still in flight: each batch's buy is its own order, and the
      // exposure cap (fills only) bounds the total. The signal is spent
      // only when a buy fills (see the fill handler above), not here.
      const amount = cap < STAKE_LAMPORTS ? cap : STAKE_LAMPORTS;
      if (amount < MIN_BUY_LAMPORTS) continue;
      if (free < amount + tx) continue;
      orders.push({ side: 'buy', mint, quote_lamports: amount, max_slippage_bps: BUY_SLIPPAGE_BPS });
      free -= amount + tx;
      if (!heldNow) {
        slots -= 1;
        decided.add(mint);
      }
    }
    // Prune tracking for curves that completed while we were not looking.
    if (tracks.size > 5000) {
      for (const [mint] of tracks) {
        const c = state.curves.get(mint);
        if (c === undefined || c.complete) tracks.delete(mint);
      }
    }
    return orders;
  },
});
