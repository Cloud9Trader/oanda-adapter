# oanda-adapter

Node.js adapter for [OANDA](http://www.oanda.com/)'s REST and streaming API, from [Cloud9Trader](https://www.cloud9trader.com).

-   Provides a single interface for requesting data and streaming prices and account updates.

-   Smooths over polling and streaming endpoints for account updates and pricing for consistent subscriber methods.

-   Handles streaming connection loss and heartbeat timeout and retires connection.

-   Manages multiple price subscriptions and changes to the subscribed instrument list over a single long polling request.

-   Rate limits REST requests according to OANDA limit with automatic queuing for delayed execution and warning logs.

-   Returns instances from OANDA's definitions library at [https://github.com/oanda/v20-javascript](https://github.com/oanda/v20-javascript) for editor code hinting and content assist.

-   OANDA endpoints return data specific to your account. Retrieves default account ID so client does not need to specify.

See also [OANDA Developer's API](https://developer.oanda.com/rest-live-v20).

## API Compatibility

This is compatible with OANDA's v20 APIs. If your account ID contains only digits (eg. 2534253), you have a v1 account - please use version [1.0.0](https://www.npmjs.com/package/oanda-adapter/v/1.0.0) of this module.

## Installation

```bash
npm install oanda-adapter
```

## API Overview

```js
const OANDAAdapter = require("oanda-adapter")

const client = new OANDAAdapter({
    // 'live' or 'practice'
    environment: "live",
    // Generate your API access token in the 'Manage API Access' section of 'My Account' on OANDA's website
    accessToken: "<token>"
})
```

### subscribeUpdates(listener[, context]);

Starts polling for account changes and subscribes for incoming updates.

```js
client.subscribeUpdates(({changes: AccountChanges, state: AccountChangesState, lastTransactionID: string}) => {
    // ...
})
```

### getInstruments(accountId, callback)

List instruments available to an account. Pass `null` as `accountId` to use default. `callback` is called with the following arguments:

-   `error`
-   `Array[Instrument]` Array of available instruments

### subscribePrice(accountId, instrument, listener[, context]);

Subscribes to rates stream for a single instrument. Use `getInstruments()` to retrieve list of available instruments. A single streaming request will be managed as you subscribe to various instruments. If `null` is passed as `accountId`, the default account will be fetched. Optionally pass a `context` for the `listener` to be bound to.

```js
client.subscribePrice(null, "EUR_USD", (ClientPrice) => {
    // ...
})
```

### getAccounts(callback)

List accounts for a user. `callback` is called with the following arguments:

-   `error`
-   `Array[AccountProperties]` Array of accounts available under current access

### getAccountId(callback)

Gets the default account ID. `callback` is called with the following arguments:

-   `error`
-   `accountId`

### getAccount(accountId, callback)

Get account information. `callback` is called with the following arguments:

-   `error`
-   `Account` Object representing account information

### getPrice(accountId, instrument, callback)

Gets the current price of an instrument. If `null` is passed as `accountId`, the default account will be fetched. `instrument` can be an array to retrieve multiple prices. `callback` is called with the following arguments:

-   `error`
-   `ClientPrice` or `Array[ClientPrice]` Object representing current price, or array containing them.

### getCandles(accountId, instrument, from, to, interval, callback)

Get interval bars for `instrument` between time range. If `null` is passed as `accountId`, the default account will be fetched. `interval` is one of [`S5`, `S10`, `S15`, `S30`, `M1`, `M2`, `M4`, `M5`, `M10`, `M15`, `M30`, `H1`, `H2`, `H3`, `H4`, `H6`, `H8`, `H12`, `D`, `W`, `M`]. `from` and `to` can be dates or ISO strings. `callback` is called with the following arguments:

-   `error`
-   `Array[Candlestick]` Array of candles with bid, mid and ask ohlc and volume.

### kill()

Aborts any open events or rates streaming connections and removes all event listeners

```js
client.kill()
```

## Upcoming

Implementations for historical price and trading coming in next releases.

## Author

By [Cloud9Trader](https://www.cloud9trader.com). Simple, powerful platform for algorithmic trading.
