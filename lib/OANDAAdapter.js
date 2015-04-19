var _ = require("underscore"),
    Events = require("./Events"),
    querystring = require("querystring"),
    httpClient = require("./httpClient"),
    utils = require("./utils");

var environments = {
    sandbox: {
        restHost: "api-sandbox.oanda.com",
        streamHost: "stream-sandbox.oanda.com",
        secure: false
    },
    practice: {
        restHost: "api-fxpractice.oanda.com",
        streamHost: "stream-fxpractice.oanda.com",
        secure: true
    },
    live: {
        restHost: "api-fxtrade.oanda.com",
        streamHost: "stream-fxtrade.oanda.com",
        secure: true
    }
};

var maxSockets = 2,
    maxRequestsPerSecond = 15,
    maxRequestsWarningThreshold = 1000;

/*
 * config.environment
 * config.accessToken
 * config.username (Sandbox only)
 */
function OandaAdapter (config) {

    config.environment = config.environment || "practice";

    // this.accountId = accountId;
    this.accessToken = config.accessToken;

    this.restHost = environments[config.environment].restHost;
    this.streamHost = environments[config.environment].streamHost;
    this.secure = environments[config.environment].secure;

    if (config.environment === "sandbox") {
        this.username = config.username;
    }

    httpClient.setMaxSockets(maxSockets);

    this.subscriptions = {};

    this._eventsBuffer = [];
    this._pricesBuffer = [];

    this._sendRESTRequest = utils.rateLimit(this._sendRESTRequest, this, 1000 / maxRequestsPerSecond, maxRequestsWarningThreshold);
}

Events.mixin(OandaAdapter.prototype);

/*
 * Subscribes to events for all accounts authorized by the token
 */
OandaAdapter.prototype.subscribeEvents = function (listener, context) {

    var existingSubscriptions = this.getHandlers("event");

    this.off("event", listener, context);
    this.on("event", listener, context);

    if (existingSubscriptions.length === 0) {
        this._streamEvents();
    }
};

OandaAdapter.prototype.unsubscribeEvents = function (listener, context) {
    this.off("event", listener, context);
    this._streamEvents();
};

OandaAdapter.prototype._streamEvents = function () {

    var subscriptionCount = this.getHandlers("event").length;

    if (this.eventsRequest) {
        this.eventsRequest.abort();
    }
    if (subscriptionCount === 0) {
        return;
    }

    clearTimeout(this.eventsTimeout);
    this.eventsTimeout = setTimeout(this._eventsHeartbeatTimeout.bind(this), 20000);

    this.eventsRequest = httpClient.sendRequest({
            hostname: this.streamHost,
            method: "GET",
            path: "/v1/events",
            headers: {
                Authorization: "Bearer " + this.accessToken,
                Connection: "Keep-Alive"
            },
            secure: this.secure
        },
        this._onEventsResponse.bind(this),
        this._onEventsData.bind(this)
    );
};

OandaAdapter.prototype._onEventsResponse = function (error, body, statusCode) {
    if (statusCode !== 200) {
        if (body && body.disconnect) {
            this.trigger("message", null, "Events streaming API disconnected.\nOanda code " + body.disconnect.code + ": " + body.disconnect.message);
        } else {
            this.trigger("message", null, "Events streaming API disconnected with status " + statusCode);
        }
    }
    clearTimeout(this.eventsTimeout);
    this.eventsTimeout = setTimeout(this._eventsHeartbeatTimeout.bind(this), 20000);
};

OandaAdapter.prototype._onEventsData = function (data) {

    // Single chunks sometimes contain more than one event. Each always end with /r/n. Whole chunk therefore not JSON parsable, so must split.
    // Also, an event may be split accross data chunks, so must buffer.
    data.split(/\r\n/).forEach(function (line) {
        var update;
        if (line) {
            this._eventsBuffer.push(line);
            try {
                update = JSON.parse(this._eventsBuffer.join(""));
            } catch (error) {
                if (this._eventsBuffer.length <= 5) {
                    // Wait for next line.
                    return;
                }
                console.error("[ERROR] Unable to parse Oanda events subscription update", this._eventsBuffer.join("\n"), error);
                this._eventsBuffer = [];
                return;
            }
            this._eventsBuffer = [];

            if (update.heartbeat) {
                clearTimeout(this.eventsTimeout);
                this.eventsTimeout = setTimeout(this._eventsHeartbeatTimeout.bind(this), 20000);
                return;
            }
            this.trigger("event", update);
        }
    }, this);
};

OandaAdapter.prototype._eventsHeartbeatTimeout = function () {
    console.warn("[WARN] OandaAdapter: No heartbeat received from events stream for 20 seconds. Reconnecting.");
    this._streamEvents();
};

OandaAdapter.prototype.getAccounts = function (callback) {

    this._sendRESTRequest({
        method: "GET",
        path: "/v1/accounts" + (this.username ? "?username=" + this.username : "")
    }, function (error, body, statusCode) {
        if (error) {
            if (body && body.message) {
                console.error("[ERROR] Response from Oanda", statusCode + " Error: " + body.message + " (OANDA error code " + body.code + ")");
                return callback(body.message);
            }
            return callback(error);
        }
        if (body.accounts) {
            callback(null, body.accounts);
        } else {
            callback("Unexpected accounts response");
        }
    });
};

OandaAdapter.prototype.getAccount = function (accountId, callback) {

    this._sendRESTRequest({
        method: "GET",
        path: "/v1/accounts/" + accountId
    }, callback);
};

OandaAdapter.prototype.getInstruments = function (accountId, callback) {

    this._sendRESTRequest({
        method: "GET",
        path: "/v1/instruments?accountId=" + accountId + "&fields=" + ["instrument", "displayName", "pip", "maxTradeUnits", "precision", "maxTrailingStop", "minTrailingStop", "marginRate", "halted"].join("%2C"),
    },
    function (error, body, statusCode) {
        if (error) {
            if (body && body.message) {
                console.error("[ERROR] Response from Oanda", statusCode + " Error: " + body.message + " (OANDA error code " + body.code + ")");
                return callback(body.message);
            }
            return callback(error);
        }
        if (body.instruments) {
            callback(null, body.instruments);
        } else {
            callback("Unexpected instruments response");
        }
    });
};

OandaAdapter.prototype.getPrice = function (symbol, callback) {

    var multiple = _.isArray(symbol);

    if (multiple) {
        symbol = symbol.join("%2C");
    }

    this._sendRESTRequest({
        method: "GET",
        path: "/v1/prices?instruments=" + symbol
    }, function (error, body, statusCode) {
        if (error) {
            if (body && body.message) {
                console.error("[ERROR] Response from Oanda", statusCode + " Error: " + body.message + " (OANDA error code " + body.code + ")");
                return callback(body.message);
            }
            return callback(error);
        }
        if (body && body.prices[0]) {
            callback(null, multiple ? body.prices : body.prices[0]);
        } else {
            callback("Unexpected price response for " + symbol);
        }
    });
};

OandaAdapter.prototype.subscribePrice = function (accountId, symbol, listener, context) {

    var existingSubscriptions = this.getHandlers("price/" + symbol);

    // Price stream needs an accountId to be passed for streaming prices, though prices for a connection are same anyway
    if (!this.streamPrices) {
        this.streamPrices = _.throttle(this._streamPrices.bind(this, accountId));
    }

    this.off("price/" + symbol, listener, context);
    this.on("price/" + symbol, listener, context);

    if (existingSubscriptions.length === 0) {
        this.streamPrices();
    }
};

OandaAdapter.prototype.unsubscribePrice = function (symbol, listener, context) {
    this.off("price/" + symbol, listener, context);
    this.streamPrices();
};

// Kills rates streaming keep alive request for account and creates a new one whenever subsciption list changes. Should always be throttled.
OandaAdapter.prototype._streamPrices = function (accountId) {

    var changed;

    this.priceSubscriptions = Object.keys(this.getHandlers()).reduce(function (memo, event) {
        var match = event.match("^price/(.+)$");
        if (match) {
            memo.push(match[1]);
        }
        return memo;
    }, []).sort().join("%2C");

    changed = !this.lastPriceSubscriptions || this.priceSubscriptions !== this.lastPriceSubscriptions;

    this.lastPriceSubscriptions = this.priceSubscriptions;

    if (!changed) {
        return;
    }

    if (this.pricesRequest) {
        this.pricesRequest.abort();
    }

    if (this.priceSubscriptions === "") {
        return;
    }

    clearTimeout(this.pricesTimeout);
    this.pricesTimeout = setTimeout(this._pricesHeartbeatTimeout.bind(this), 10000);

    this.pricesRequest = httpClient.sendRequest({
            hostname: this.streamHost,
            method: "GET",
            path: "/v1/prices?accountId=" + accountId + "&instruments=" + this.priceSubscriptions,
            headers: {
                Authorization: "Bearer " + this.accessToken,
                Connection: "Keep-Alive"
            },
            secure: this.secure
        },
        this._onPricesResponse.bind(this, accountId),
        this._onPricesData.bind(this)
    );
};

OandaAdapter.prototype._onPricesResponse = function (accountId, error, body, statusCode) {
    if (statusCode !== 200) {
        if (body && body.disconnect) {
            this.trigger("message", accountId, "Prices streaming API disconnected.\nOanda code " + body.disconnect.code + ": " + body.disconnect.message);
        } else {
            this.trigger("message", accountId, "Prices streaming API disconnected with status " + statusCode);
        }
    }
    clearTimeout(this.pricesTimeout);
    this.pricesTimeout = setTimeout(this._pricesHeartbeatTimeout.bind(this), 10000);
};

OandaAdapter.prototype._onPricesData = function (data) {

    // Single data chunks sometimes contain more than one tick. Each always end with /r/n. Whole chunk therefore not JSON parsable, so must split.
    // A tick may also be split accross data chunks, so must buffer
    data.split(/\r\n/).forEach(function (line) {
        var update;
        if (line) {
            this._pricesBuffer.push(line);
            try {
                update = JSON.parse(this._pricesBuffer.join(""));
            } catch (error) {
                if (this._pricesBuffer.length <= 5) {
                    // Wait for next update.
                    return;
                }
                // Drop if cannot produce object after 5 updates
                console.error("[ERROR] Unable to parse Oanda price subscription update", this._pricesBuffer.join("\n"), error);
                this._pricesBuffer = [];
                return;
            }
            this._pricesBuffer = [];

            if (update.heartbeat) {
                clearTimeout(this.pricesTimeout);
                this.pricesTimeout = setTimeout(this._pricesHeartbeatTimeout.bind(this), 10000);
                return;
            }
            if (update.tick) {
                update.tick.time = new Date(update.tick.time);
                this.trigger("price/" + update.tick.instrument, update.tick);
            }
        }
    }, this);
};

OandaAdapter.prototype._pricesHeartbeatTimeout = function () {
    console.warn("[WARN] OandaAdapter: No heartbeat received from prices stream for 10 seconds. Reconnecting.");
    delete this.lastPriceSubscriptions;
    this._streamPrices();
};

OandaAdapter.prototype.getCandles = function (symbol, start, end, granularity, callback) {

    this._sendRESTRequest({
        method: "GET",
        path: "/v1/candles?" + querystring.stringify({
            instrument: symbol,
            start: new Date(start).getTime(),
            end: new Date(end).getTime(),
            granularity: granularity,
            alignmentTimezone: "GMT0",
            dailyAlignment: 0
        }),
        headers: {
            Authorization: "Bearer " + this.accessToken,
            "X-Accept-Datetime-Format": "UNIX"
        }
    }, function (error, body, statusCode) {
        if (error) {
            if (body && body.message) {
                console.error("[ERROR] Response from Oanda", statusCode + " Error: " + body.message + " (OANDA error code " + body.code + ")");
                return callback(body.message);
            }
            return callback(error);
        }
        if (body && body.candles) {
            callback(null, body.candles);
        } else if (body === "") {
            // Body is an empty string if there are no candles to return
            callback(null, []);
        } else {
            callback("Unexpected candles response for " + symbol);
        }
    });
};

OandaAdapter.prototype.getOpenPositions = function (accountId, callback) {

    this._sendRESTRequest({
        method: "GET",
        path: "/v1/accounts/" + accountId + "/positions"
    }, function (error, body, statusCode) {
        if (error) {
            if (body && body.message) {
                console.error("[ERROR] Response from Oanda", statusCode + " Error: " + body.message + " (OANDA error code " + body.code + ")");
                return callback(body.message);
            }
            return callback(error);
        }
        if (body && body.positions) {
            callback(null, body.positions);
        } else {
            callback("Unexpected response for open positions");
        }
    });
};

OandaAdapter.prototype.getOpenTrades = function (accountId, callback) {

    this._sendRESTRequest({
        method: "GET",
        path: "/v1/accounts/" + accountId + "/trades"
    }, function (error, body, statusCode) {
        if (error) {
            if (body && body.message) {
                console.error("[ERROR] Response from Oanda", statusCode + " Error: " + body.message + " (OANDA error code " + body.code + ")");
                return callback(body.message);
            }
            return callback(error);
        }
        if (body && body.trades) {
            callback(null, body.trades);
        } else {
            callback("Unexpected response for open trades");
        }
    });
};


/**
* @method createOrder
* @param {String} accountId Required.
* @param {Object} order
* @param {String} order.instrument Required. Instrument to open the order on.
* @param {Number} order.units Required. The number of units to open order for.
* @param {String} order.side Required. Direction of the order, either ‘buy’ or ‘sell’.
* @param {String} order.type Required. The type of the order ‘limit’, ‘stop’, ‘marketIfTouched’ or ‘market’.
* @param {String} order.expiry Required. If order type is ‘limit’, ‘stop’, or ‘marketIfTouched’. The value specified must be in a valid datetime format.
* @param {String} order.price Required. If order type is ‘limit’, ‘stop’, or ‘marketIfTouched’. The price where the order is set to trigger at.
* @param {Number} order.lowerBound Optional. The minimum execution price.
* @param {Number} order.upperBound Optional. The maximum execution price.
* @param {Number} order.stopLoss Optional. The stop loss price.
* @param {Number} order.takeProfit Optional. The take profit price.
* @param {Number} order.trailingStop Optional The trailing stop distance in pips, up to one decimal place.
* @param {Function} callback
*/

OandaAdapter.prototype.createOrder = function (accountId, order, callback) {

    if (!order.instrument) {
        return callback("'instrument' is a required field");
    }
    if (!order.units) {
        return callback("'units' is a required field");
    }
    if (!order.side) {
        return callback("'side' is a required field. Specify 'buy' or 'sell'");
    }
    if (!order.type) {
        return callback("'type' is a required field. Specify 'market', 'marketIfTouched', 'stop' or 'limit'");
    }
    if ((order.type !== "market") && !order.expiry) {
        return callback("'expiry' is a required field for order type '" + order.type + "'");
    }
    if ((order.type !== "market") && !order.price) {
        return callback("'price' is a required field for order type '" + order.type + "'");
    }

    this._sendRESTRequest({
        method: "POST",
        path: "/v1/accounts/" + accountId + "/orders",
        data: order,
        headers: {
            Authorization: "Bearer " + this.accessToken,
            "Content-Type": "application/x-www-form-urlencoded"
        },
    }, function (error, body, statusCode) {
        if (error) {
            if (body && body.message) {
                console.error("[ERROR] Response from Oanda", statusCode + " Error: " + body.message + " (OANDA error code " + body.code + ")");
                return callback(body.message);
            }
            return callback(error);
        }
        callback(null, body);
    });
};

OandaAdapter.prototype.closeTrade = function (accountId, tradeId, callback) {

    this._sendRESTRequest({
        method: "DELETE",
        path: "/v1/accounts/" + accountId + "/trades/" + tradeId
    }, function (error, body, statusCode) {
        if (error) {
            if (body && body.message) {
                console.error("[ERROR] Response from Oanda", statusCode + " Error: " + body.message + " (OANDA error code " + body.code + ")");
                return callback(body.message);
            }
            return callback(error);
        }
        if (body) {
            callback(null, body);
        } else {
            callback("Unexpected response for open positions");
        }
    });
};

OandaAdapter.prototype._sendRESTRequest = function (request, callback) {

    request.hostname = this.restHost;
    request.headers = request.headers || {
        Authorization: "Bearer " + this.accessToken
    };
    request.secure = this.secure;

    httpClient.sendRequest(request, callback);
};

OandaAdapter.prototype.kill = function () {
    if (this.pricesRequest) {
        this.pricesRequest.abort();
    }
    if (this.eventsRequest) {
        this.eventsRequest.abort();
    }
    this.off();
};

module.exports = OandaAdapter;