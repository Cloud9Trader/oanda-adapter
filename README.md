oanda-adapter
=============

Node.js adapter for [OANDA](http://www.oanda.com/)'s REST and streaming API, from [Cloud9Trader](https://www.cloud9trader.com).

* Provides a single interface for requesting data and streaming prices and events.

* Manages pub/sub subscriptions to live prices and events.

* Attempts reconnect if keep-alive connection is lost.

* Rate limits REST requests according to OANDA limit (queued for delayed execution with warning logged where threshold exceeded).

See also [OANDA Developer's API](http://developer.oanda.com/docs/).

## Installation

```bash
npm install oanda-adapter
```

## API Overview

```js
var OANDAAdapter = require('oanda-adapter');

var client = new OANDAAdapter({
    // 'live', 'practice' or 'sandbox'
    environment: 'practice',
    // Generate your API access in the 'Manage API Access' section of 'My Account' on OANDA's website
    accessToken: 'a837f0927f0b0cd630a0934059c87003-7eb890aff42eb9c985305b309a94e421',
    // Optional. Required only if evironment is 'sandbox'
    username: 'a837f0927f0b0cd630a0934059c87003-7eb890aff42eb9c985305b309a94e421'
});
```

### subscribeEvents(listener[, context]);

Subscribes to events stream.

```js
client.subscribeEvents(function (event) {
    // ...
}, this);
```
Optionally pass a `context` for `listener` to be bound to. `listener` is called with `event`, an object that will have a `type` property containing one of the following values:

```
MARKET_ORDER_CREATE, STOP_ORDER_CREATE, LIMIT_ORDER_CREATE, MARKET_IF_TOUCHED_ORDER_CREATE,
ORDER_UPDATE, ORDER_CANCEL, ORDER_FILLED, TRADE_UPDATE, TRADE_CLOSE, MIGRATE_TRADE_OPEN,
MIGRATE_TRADE_CLOSE, STOP_LOSS_FILLED, TAKE_PROFIT_FILLED, TRAILING_STOP_FILLED, MARGIN_CALL_ENTER,
MARGIN_CALL_EXIT, MARGIN_CLOSEOUT, TRANSFER_FUNDS, DAILY_INTEREST, FEE
```
See [OANDA Docs - Events Streaming](http://developer.oanda.com/docs/v1/stream/#events-streaming) for more info on the various types.


### unsubscribeEvents([listener][, context]);

Unsubscribes from events stream. Omitting arguments will unsubscribe all listeners.

### subscribePrice(accountId, instrument, listener[, context]);

Subscribes to rates stream for a single instrument. Use `getInstruments()` to retrieve list of available instruments. Note that a single keep alive request will be managed as you subscribe to various instruments. Optionally pass a `context` for `listener` to be bound to.

```js
client.subscribePrice("1234567", "EUR_USD", function (tick) {
    // ...
}, this);
```

### unsubscribePrice(instrument, listener[, context]);

Unsubscribes from rates stream. Omitting arguments will unsubscribe all listeners.


### getAccounts(callback)

List accounts for a user. `callback` is called with the following arguments:

* `error`
* `accounts` Array of accounts available under current access token (or for `username` if sandbox) 

### getAccount(accountId, callback)

Get account information. `callback` is called with the following arguments:

* `error`
* `account` Object representing account information

### getInstruments(accountId, callback)

List instruments available to an account. `callback` is called with the following arguments:

* `error`
* `instruments` Array of available instruments

### getPrice(instrument, callback)

Gets the current price of an instrument. `instrument` can be an array to retrive multiple prices. `callback` is called with the following arguments:

* `error`
* `price` Object representing current price

### getCandles(symbol, start, end, granularity, callback)

Gets the historical price candles for an instrument. See [OANDA Docs - Retrieve Instrument History](http://developer.oanda.com/docs/v1/rates/#retrieve-instrument-history) for argument format and available values.`callback` is called with the following arguments:

* `error`
* `candles` Array of historical price bars

### getOpenPositions(accountId, callback)

Lists the open positions for an account. `callback` is called with the following arguments:

* `error`
* `positions` Array of open positions

### getOpenTrades(accountId, callback)

Lists the open trades for an account. `callback` is called with the following arguments:

* `error`
* `trades` Array of open trades

### createOrder(accountId, order, callback)

Creates an order for trade execution.

The second argument, `order` is an object with the following properties:

* {String} `instrument` Required. Instrument to open the order on.
* {Number} `units` Required. The number of units to open order for.
* {String} `side` Required. Direction of the order, either `buy` or `sell`.
* {String} `type` Required. The type of the order `limit`, `stop`, `marketIfTouched` or `market`.
* {String} `expiry` Required. If order type is `limit`, `stop`, or `marketIfTouched`. The value specified must be in a valid datetime format.
* {String} `price` Required. If order type is `limit`, `stop`, or `marketIfTouched`. The price where the order is set to trigger at.
* {Number} `lowerBound` Optional. The minimum execution price.
* {Number} `upperBound` Optional. The maximum execution price.
* {Number} `stopLoss` Optional. The stop loss price.
* {Number} `takeProfit` Optional. The take profit price.
* {Number} `trailingStop` Optional The trailing stop distance in pips, up to one decimal place.

`callback` is called with the following arguments:

* `error`
* `confirmation` Object representing trade confirmation

### closeTrade(tradeId, callback)

Closes a trade by its `tradeId`. `callback` is called with the following arguments:

* `error`
* `confirmation` Object representing trade close confirmation

### kill()

Aborts any open events or rates streaming connections and removes all event listeners

```js
client.kill();
```

## Author

By [Cloud9Trader](https://www.cloud9trader.com). Simple, powerful platform for algorithmic trading.