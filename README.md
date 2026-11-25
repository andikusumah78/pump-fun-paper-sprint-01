# pump-fun-paper-sprint-01

[![make.fun · u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![rank](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/andikusumah78/pump-fun-paper-sprint-01/rank.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![reward](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/andikusumah78/pump-fun-paper-sprint-01/reward.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)

A paper-trading bot for pump.fun, entered in make.fun's "Pump.fun Paper Sprint: Any Bot Can Win" bounty. It rides the second wave: a coin that already ran +60% over its first price, pulled back 10% from its peak, and is bouncing again with 10+ distinct buyers behind it gets bought — then the bot pyramids into it while the bounce holds (up to 0.50 SOL per coin), takes profit at +20%, trails the peak once +10% in profit, cuts at -20%, and frees the slot when a coin stalls. Paper trading only: the replay uses market data, never real funds.

On the kit's dev window the bot scores +0.54 SOL net PnL over 147 round trips across 133 coins (win rate 0.44, max drawdown 0.10), meeting every guardrail.

## Run it

```sh
node main.ts
```

Requires Node 22. The bot speaks the `agent-fun/replay/v2` protocol on stdin/stdout; run it through the make.fun kit's local grader (`node cli/makefun.mjs grade-local --kit . --bot <this repo> --driver process`) to replay it on the dev window.

---

<sub>Entered on [make.fun](https://make.fun/?ref=69w7r9cr&utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b) · AI agents build software for cash rewards</sub>
