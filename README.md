oanda-adapter
=============

Node.js adapter for [Oanda](http://www.oanda.com/)'s REST and streaming API.

* Provides a single interface for requesting data and streaming prices and events.

* Manages pub/sub subscriptions to live prices and events.

* Attempts reconnect id keep-alive connection is lost.

See also [Oanda Developer's API](http://developer.oanda.com/docs/).

## Installation

```bash
npm install oanda-adapter
```

## API Overview

```js
var OandaAdapter = require('oanda-adapter');

var client = new OandaAdapter({
    // 'live', 'practice' or 'sandbox'
    environment: 'practice',
    // Generate your API access in the 'Manage API Access' section of 'My Account' on Oanda's website
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

### unsubscribeEvents([listener][, context]);

Unsubscribes from events stream. Omit listener argument to unsubscribe all listeners.

### subscribePrice(accountId, instrument, listener[, context]);

Subscribes to rates stream for a single instrument. Use `getInstruments()` to retrieve list of available instruments. Note that a single keep alive request will be managed as you subscribe to various instruments.

```js
client.subscribePrice("1234567", "EUR_USD", function (tick) {
    // ...
}, this);
```

### unsubscribePrice(instrument, listener[, context]);

Unsubscribes from rates stream. Omit listener argument to unsubscribe all listeners.


### getAccounts(callback)

List accounts for a user. `callback` is invoked with the following arguments:

* `error`
* `accounts` Array of accounts available under current access token (or for `username` if sandbox) 

### getAccount(accountId, callback)

Get account information. `callback` is invoked with the following arguments:

* `error`
* `account` Object representing account information

### getInstruments(accountId, callback)

List instruments available to an account. `callback` is invoked with the following arguments:

* `error`
* `instruments` Array of available instruments

### getPrice(instrument, callback)

Gets the current price of an instrument. `callback` is invoked with the following arguments:

* `error`
* `price` Object representing current price

### getCandles(symbol, start, end, granularity, callback)

Gets the historical price candles for an instrument. See [Oanda docs](http://developer.oanda.com/docs/v1/rates/#retrieve-instrument-history) for argument format and available values.`callback` is invoked with the following arguments:

* `error`
* `candles` Array of historical price bars

### getOpenPositions(accountId, callback)

Lists the open positions for an account. `callback` is invoked with the following arguments:

* `error`
* `positions` Array of open positions

### getOpenTrades(accountId, callback)

Lists the open trades for an account. `callback` is invoked with the following arguments:

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

`callback` is invoked with the following arguments:

* `error`
* `confirmation` Object representing trade confirmation

### closeTrade(tradeId, callback)

Closes a trade by its `tradeId`. `callback` is invoked with the following arguments:

* `error`
* `confirmation` Object representing trade close confirmation

### kill()

Aborts any open events or rates streaming connections and removes all event listeners

```js
client.kill();
```

## Author

By [Cloud9Trader](https://www.cloud9trader.com).