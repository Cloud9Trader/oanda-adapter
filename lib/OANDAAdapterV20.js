const _ = require("underscore")
const Events = require("./Events")
const httpClient = require("./httpClient")
const utils = require("./utils")
const environments = require("./environments")

const {Instrument} = require("@oanda/v20/primitives")
const {ClientPrice} = require("@oanda/v20/pricing")
const {Account, AccountProperties, AccountChanges, AccountChangesState} = require("@oanda/v20/account")
const {Candlestick} = require("@oanda/v20/instrument")

const MAX_SOCKETS = 20
const MAX_REQUESTS_PER_SECOND = 120
const MAX_REQUESTS_WARNING_THRESHOLD = 1000

/*
 * config.environment
 * config.accessToken
 */
class OANDAAdapterV20 {
    constructor(config) {
        config.environment = config.environment || "practice"

        this.accessToken = config.accessToken

        this.restHost = environments[config.environment].restHost
        this.streamHost = environments[config.environment].streamHost

        httpClient.setMaxSockets(MAX_SOCKETS)

        this.subscriptions = {}
        this.requesting = {}

        this._eventsBuffer = []
        this._pricesBuffer = []

        this._sendRequest = utils.rateLimit(this._sendRequest, this, 1000 / MAX_REQUESTS_PER_SECOND, MAX_REQUESTS_WARNING_THRESHOLD)
    }

    startAccountPolling() {
        if (this.accountPolling) return
        this.accountPolling = true

        this.getAccountId((error, accountId) => {
            if (error) {
                console.error("Error from OANDA getting account ID", error)
                return
            }
            this.getAccount(accountId, (error, body) => {
                if (error) {
                    console.error("Error from OANDA getting account", error)
                    return
                }
                const {account, lastTransactionID} = body
                this.account = new Account(account)

                setTimeout(() => this._getAccountChanges(lastTransactionID), 1000)
            })
        })
    }

    _getAccountChanges(sinceTransactionId) {
        this._requestHTTP(
            {
                method: "GET",
                path: `/v3/accounts/${this.accountId}/changes?sinceTransactionID=${sinceTransactionId}`
            },
            (error, body) => {
                if (error) {
                    console.error("Error polling OANDA for account changes", this.accountId, sinceTransactionId)
                    return
                }
                const {changes, state, lastTransactionID} = body

                this.trigger("update", {
                    changes: new AccountChanges(changes),
                    state: new AccountChangesState(state),
                    lastTransactionID
                })

                setTimeout(() => this._getAccountChanges(lastTransactionID), 1000)
            }
        )
    }

    subscribeUpdates(listener, context) {
        const existingSubscriptions = this.getHandlers("update")

        this.off("update", listener, context)
        this.on("update", listener, context)

        if (existingSubscriptions.length === 0) {
            this.startAccountPolling()
        }
    }

    getAccounts(callback) {
        this._requestHTTP(
            {
                method: "GET",
                path: "/v3/accounts"
            },
            (error, body, statusCode) => {
                if (error) {
                    if (body && body.errorMessage) {
                        console.error("Error response from OANDA", statusCode + " Error: " + body.errorMessage + " (OANDA error code " + body.code + ")")
                        return callback(body.errorMessage)
                    }
                    return callback(error)
                }
                if (body.accounts) {
                    console.info("Fetched account list", body.accounts)
                    callback(
                        null,
                        body.accounts.map((account) => new AccountProperties(account))
                    )
                } else {
                    callback("Unexpected accounts response")
                }
            }
        )
    }

    getAccount(accountId, callback) {
        this._requestHTTP(
            {
                method: "GET",
                path: "/v3/accounts/" + accountId
            },
            (error, body, statusCode) => {
                if (error) {
                    console.error("Error getting account from OANDA", accountId, error)
                    return callback(error)
                }
                const {account} = body
                callback(null, new Account(account))
            }
        )
    }

    getAccountId(callback) {
        if (this.accountId) {
            callback(null, this.accountId)
            return
        }
        if (this.gettingAccountId) {
            this.once("set-account-id", callback)
            return
        }
        this.gettingAccountId = true
        this.getAccounts((error, accounts) => {
            this.gettingAccountId = false
            if (error) {
                this.trigger("set-account-id", error)
                callback(error)
                return
            }
            this.accountId = accounts[0].id
            this.trigger("set-account-id", null, this.accountId)
            callback(null, this.accountId)
        })
    }

    getInstruments(accountId, callback) {
        this._requestHTTP(
            {
                method: "GET",
                path: `/v3/accounts/${accountId}/instruments`
            },
            (error, body, statusCode) => {
                if (error) {
                    if (body && body.errorMessage) {
                        console.error("Error response from OANDA", statusCode + " Error: " + body.errorMessage + " (OANDA error code " + body.code + ")")
                        return callback(body.errorMessage)
                    }
                    return callback(error)
                }
                if (body.instruments) {
                    callback(
                        null,
                        body.instruments.map((instrument) => new Instrument(instrument))
                    )
                } else {
                    callback("Unexpected instruments response")
                }
            }
        )
    }

    getPrice(accountId, symbol, callback) {
        if (!accountId) {
            this.getAccountId((error) => (error ? callback(error) : this.getPrice(accountId, symbol, callback)))
            return
        }

        const multiple = _.isArray(symbol)

        if (multiple) {
            symbol = symbol.join("%2C")
        }

        this._requestHTTP(
            {
                method: "GET",
                path: `/v3/accounts/${accountId}/pricing?instruments=` + symbol
            },
            (error, body, statusCode) => {
                if (error) {
                    if (body && body.errorMessage) {
                        console.error("Error response from OANDA", statusCode + " Error: " + body.errorMessage + " (OANDA error code " + body.code + ")")
                        return callback(body.errorMessage)
                    }
                    return callback(error)
                }
                if (body && body.prices[0]) {
                    callback(null, multiple ? body.prices.map((price) => new ClientPrice(price)) : new ClientPrice(body.prices[0]))
                } else {
                    callback("Unexpected price response for " + symbol)
                }
            }
        )
    }

    getCandles(accountId, instrument, from, to, interval, callback) {
        if (!accountId) {
            this.getAccountId((error, accountId) => (error ? callback(error) : this.getCandles(accountId, instrument, from, to, interval, callback)))
            return
        }

        from = from.toISOString ? from.toISOString() : from
        to = to.toISOString ? to.toISOString() : to

        const intervals = ["S5", "S10", "S15", "S30", "M1", "M2", "M4", "M5", "M10", "M15", "M30", "H1", "H2", "H3", "H4", "H6", "H8", "H12", "D", "W", "M"]
        if (!intervals.includes(interval)) {
            return callback("Interval must be one of " + intervals.join(", "))
        }

        this._requestHTTP(
            {
                method: "GET",
                path: `/v3/accounts/${accountId}/instruments/${instrument}/candles?price=BMA&granularity=M1&from=${from}&to=${to}`
            },
            (error, body, statusCode) => {
                if (error) {
                    if (body && body.errorMessage) {
                        console.error("Error response from OANDA", statusCode + " Error: " + body.errorMessage + " (OANDA error code " + body.code + ")")
                        return callback(body.errorMessage)
                    }
                    return callback(error)
                }
                if (body && body.candles) {
                    callback(
                        null,
                        body.candles.map((candle) => new Candlestick(candle))
                    )
                } else {
                    callback("Unexpected candles response for " + instrument)
                }
            }
        )
    }

    subscribePrice(accountId, symbol, listener, context) {
        if (!accountId) {
            this.getAccountId((error, accountId) => error || this.subscribePrice(accountId, symbol, listener, context))
            return
        }

        const existingSubscriptions = this.getHandlers("price/" + symbol)

        if (!this.streamPrices) {
            this.streamPrices = _.throttle(this._streamPrices.bind(this, accountId))
        }

        this.off("price/" + symbol, listener, context)
        this.on("price/" + symbol, listener, context)

        if (existingSubscriptions.length === 0) {
            this.streamPrices()
        }
    }

    unsubscribePrice(symbol, listener, context) {
        this.off("price/" + symbol, listener, context)
        this.streamPrices()
    }

    // Kills rates streaming keep alive request for account and creates a new one whenever subscription list changes. Should always be throttled.
    _streamPrices(accountId) {
        this.priceSubscriptions = Object.keys(this.getHandlers())
            .reduce((memo, event) => {
                const match = event.match("^price/(.+)$")
                if (match) {
                    memo.push(match[1])
                }
                return memo
            }, [])
            .sort()
            .join("%2C")

        const changed = !this.lastPriceSubscriptions || this.priceSubscriptions !== this.lastPriceSubscriptions

        this.lastPriceSubscriptions = this.priceSubscriptions

        if (!changed) {
            return
        }

        if (this.pricesRequest) {
            this.pricesRequest.abort()
        }

        if (this.priceSubscriptions === "") {
            return
        }

        clearTimeout(this.pricesTimeout)
        this.pricesTimeout = setTimeout(this._pricesHeartbeatTimeout.bind(this), 10000)

        this.pricesRequest = httpClient.sendRequest(
            {
                hostname: this.streamHost,
                method: "GET",
                path: `/v3/accounts/${this.accountId}/pricing/stream?instruments=` + this.priceSubscriptions,
                headers: {
                    Authorization: "Bearer " + this.accessToken
                },
                stream: true
            },
            this._onPricesResponse.bind(this, accountId),
            this._onPricesData.bind(this)
        )
    }

    _onPricesResponse(accountId, error, body, statusCode) {
        if (statusCode !== 200) {
            if (body && body.disconnect) {
                this.trigger("message", accountId, "Prices streaming API disconnected.\nOANDA code " + body.disconnect.code + ": " + body.disconnect.message)
            } else {
                this.trigger("message", accountId, "Prices streaming API disconnected with status " + statusCode)
            }
        }
        clearTimeout(this.pricesTimeout)
        this.pricesTimeout = setTimeout(this._pricesHeartbeatTimeout.bind(this), 10000)
    }

    _onPricesData(data) {
        // Single data chunks sometimes contain more than one tick. Each always end with /r/n. Whole chunk therefore not JSON parsable, so must split.
        // A tick may also be split across data chunks, so must buffer
        data.split(/\n/).forEach((line) => {
            let update
            if (line) {
                this._pricesBuffer.push(line)
                try {
                    update = JSON.parse(this._pricesBuffer.join(""))
                } catch (error) {
                    if (this._pricesBuffer.length <= 5) {
                        // Wait for next update.
                        return
                    }
                    // Drop if cannot produce object after 5 updates
                    console.error("Error Unable to parse OANDA price subscription update", this._pricesBuffer.join("\n"), error)
                    this._pricesBuffer = []
                    return
                }
                this._pricesBuffer = []

                const {type} = update

                if (type === "HEARTBEAT") {
                    clearTimeout(this.pricesTimeout)
                    this.pricesTimeout = setTimeout(this._pricesHeartbeatTimeout.bind(this), 10000)
                    return
                }
                if (type === "PRICE") {
                    const price = new ClientPrice(update)
                    this.trigger("price/" + update.instrument, price)
                }
            }
        }, this)
    }

    _pricesHeartbeatTimeout() {
        console.warn("OANDAAdapterV20: No heartbeat received from prices stream for 10 seconds. Reconnecting.")
        delete this.lastPriceSubscriptions
        this.streamPrices()
    }

    _requestHTTP(request, callback) {
        const {method, path} = request
        if (method === "GET") {
            if (this.requesting[path]) {
                this.once(this.requesting[path], callback)
                return
            }
            this.requesting[path] = path
        }
        request.hostname = this.restHost
        request.headers = request.headers || {
            Authorization: "Bearer " + this.accessToken
        }

        this._sendRequest(request, (error, body, statusCode) => {
            callback(error, body, statusCode)
            if (method === "GET") {
                this.trigger(this.requesting[path], error, body, statusCode)
                delete this.requesting[path]
            }
        })
    }

    // Throttled
    _sendRequest(request, callback) {
        httpClient.sendRequest(request, callback)
    }

    kill() {
        if (this.pricesRequest) {
            this.pricesRequest.abort()
        }
        if (this.eventsRequest) {
            this.eventsRequest.abort()
        }
        this.off()
    }
}

Events.mixin(OANDAAdapterV20.prototype)

module.exports = OANDAAdapterV20
