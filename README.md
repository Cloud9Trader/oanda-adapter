oanda-adapter
=============

Node.js adapter for [Oanda](http://www.oanda.com/)'s REST and streaming API.

* Provides a single interface for requesting data and streaming prices and events.

* Manages pub/sub subscriptions to live prices and events.

* Attempts reconnect id keep-alive connection is lost.

See also [http://developer.oanda.com/docs/].

## Installation

`npm install stripe`

## API Overview

```js
var OandaAdapter = require('oanda-adapter');

var client = new OandaAdapter({
    // 'live', 'practice' or 'sandbox'
    environment: 'practice',
    // Generate your API access in the 'Manage API Access' section of 'My Account' on Oanda's website
    accessToken: 'a837f0927f0b0cd630a0934059c87003-7eb890aff42eb9c985305b309a94e421'
});
```


### subscribeEvents(listener[, context]);

Subscribes to events stream.

```js
client.subscribeEvents(function (event) {
    console.log(event);
}, this);
```

### subscribePrice(accountId, instrument, listener[, context]);

Subscribes to rates stream for a single instrument. Note that a single keep alive request will be managed as you subscribe to various instruments.

```js
client.subscribePrice("1234567", "EUR_USD", function (tick) {
    console.log(tick);
}, this);
```

## Author

By [Cloud9Trader](https://www.cloud9trader.com)