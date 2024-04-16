const _ = require("underscore")
const Events = require("./Events")
const httpClient = require("./httpClient")
const utils = require("./utils")
const environments = require("./environments")

const {Instrument} = require("@oanda/v20/primitives")
const {ClientPrice} = require("@oanda/v20/pricing")
const {Account, AccountProperties, AccountChanges, AccountChangesState} = require("@oanda/v20/account")
const {Position} = require("@oanda/v20/position")
const {Trade} = require("@oanda/v20/trade")
const {Order, MarketOrder} = require("@oanda/v20/order")
const {Transaction} = require("@oanda/v20/transaction")
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

        this._pricesBuffer = []
        this._transactionsBuffer = []

        this._sendRequest = utils.rateLimit(this._sendRequest, this, 1000 / MAX_REQUESTS_PER_SECOND, MAX_REQUESTS_WARNING_THRESHOLD)
    }

    subscribeAccountUpdates(listener, context) {
        const existingSubscriptions = this.getHandlers("account-update")

        this.off("account-update", listener, context)
        this.on("account-update", listener, context)

        if (existingSubscriptions.length === 0) {
            this.startAccountPolling()
        }
    }

    startAccountPolling() {
        if (this.accountPolling) return
        this.accountPolling = true

        this.getDefaultAccountId((error, accountId) => {
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

                this.trigger("account-update", {
                    accountId: this.accountId,
                    changes: new AccountChanges(changes),
                    state: new AccountChangesState(state),
                    lastTransactionID
                })

                setTimeout(() => this._getAccountChanges(lastTransactionID), 1000)
            }
        )
    }

    subscribeTransactions(listener, context) {
        this.off("transaction-update", listener, context)
        this.on("transaction-update", listener, context)

        this._streamTransactions()
    }

    _streamTransactions() {
        if (!this.accountId) {
            this.getDefaultAccountId((error, accountId) => {
                if (error) return console.error("Could not get default account ID to stream OANDA transactions", error)
                this._streamTransactions()
            })
            return
        }

        if (this.transactionsStreamRequest) {
            clearTimeout(this.transactionsTimeout)
            this.transactionsStreamRequest.abort()
        }

        this.transactionsStreamRequest = httpClient.sendRequest(
            {
                hostname: this.streamHost,
                method: "GET",
                path: `/v3/accounts/${this.accountId}/transactions/stream`,
                headers: {
                    Authorization: "Bearer " + this.accessToken
                },
                stream: true
            },
            this._onTransactionsStreamResponse.bind(this),
            this._onTransactionData.bind(this)
        )
    }

    _onTransactionsStreamResponse(error, body, statusCode) {
        if (statusCode !== 200) {
            if (body && body.disconnect) {
                this.trigger("message", this.accountId, "Transactions streaming API disconnected.\nOANDA code " + body.disconnect.code + ": " + body.disconnect.message)
            } else {
                this.trigger("message", this.accountId, "Transactions streaming API disconnected with status " + statusCode)
            }
        }
        clearTimeout(this.transactionsTimeout)
        this.transactionsTimeout = setTimeout(this._transactionsHeartbeatTimeout.bind(this), 10000)
    }

    _onTransactionData(data) {
        // Single data chunks sometimes contain more than one tick. Each always end with /r/n. Whole chunk therefore not JSON parsable, so must split.
        data.split(/\n/).forEach((line) => {
            let update
            if (line) {
                this._transactionsBuffer.push(line)
                try {
                    update = JSON.parse(this._transactionsBuffer.join(""))
                } catch (error) {
                    if (this._transactionsBuffer.length <= 5) {
                        // Wait for next update.
                        return
                    }
                    // Drop if cannot produce object after 5 updates
                    console.error("Error Unable to parse OANDA transaction subscription update", this._transactionsBuffer.join("\n"), error)
                    this._transactionsBuffer = []
                    return
                }
                this._transactionsBuffer = []

                const {type} = update
                if (type === "HEARTBEAT") {
                    clearTimeout(this.transactionsTimeout)
                    this.transactionsTimeout = setTimeout(this._transactionsHeartbeatTimeout.bind(this), 10000)
                    return
                }
                // Transaction update types: https://github.com/oanda/v20-javascript/blob/b5fc9c37e365483eb0367022d9c0e8514df47e07/src/transaction.js#L96
                this.trigger("transaction-update", type, Transaction.create(update))
            }
        }, this)
    }

    _transactionsHeartbeatTimeout() {
        console.warn("OANDAAdapterV20: No heartbeat received from transactions stream for 10 seconds. Reconnecting.")
        this._streamTransactions()
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
        if (!accountId) {
            this.getDefaultAccountId((error, accountId) => (error ? callback(error) : this.getAccount(accountId, callback)))
            return
        }
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

    getDefaultAccountId(callback) {
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

            /*  TODO OANDA returns several accounts, e.g.
                [
                    { id: '001-004-11425450-003', mt4AccountID: 8971055, tags: [ 'MT4', 'SPREAD_BETTING' ]},
                    { id: '001-004-11425450-001', tags: [] },
                    { id: '001-004-11425450-002', tags: [ 'SPREAD_BETTING' ] }
                ]
                We will want to support multi account. For now choose the non spread betting account
                This will likely vary with OANDA accounts in various regions
            */
            accounts = accounts.filter((account) => !account.tags.includes("SPREAD_BETTING"))
            this.accountId = accounts[0].id
            this.trigger("set-account-id", null, this.accountId)
            callback(null, this.accountId)
        })
    }

    getInstruments(accountId, callback) {
        if (!accountId) {
            this.getDefaultAccountId((error, accountId) => (error ? callback(error) : this.getInstruments(accountId, callback)))
            return
        }
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
            this.getDefaultAccountId((error, accountId) => (error ? callback(error) : this.getPrice(accountId, symbol, callback)))
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
            this.getDefaultAccountId((error, accountId) => (error ? callback(error) : this.getCandles(accountId, instrument, from, to, interval, callback)))
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
            this.getDefaultAccountId((error, accountId) => error || this.subscribePrice(accountId, symbol, listener, context))
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

        if (this.pricesStreamRequest) {
            this.pricesStreamRequest.abort()
        }

        if (this.priceSubscriptions === "") {
            return
        }

        clearTimeout(this.pricesTimeout)
        this.pricesTimeout = setTimeout(this._pricesHeartbeatTimeout.bind(this), 10000)

        this.pricesStreamRequest = httpClient.sendRequest(
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
        })
    }

    _pricesHeartbeatTimeout() {
        console.warn("OANDAAdapterV20: No heartbeat received from prices stream for 10 seconds. Reconnecting.")
        delete this.lastPriceSubscriptions
        this.streamPrices()
    }

    getOpenPositions(accountId, callback) {
        if (!accountId) {
            this.getDefaultAccountId((error, accountId) => (error ? callback(error) : this.getOpenPositions(accountId, callback)))
            return
        }
        this._requestHTTP(
            {
                method: "GET",
                path: `/v3/accounts/${accountId}/openPositions`
            },
            (error, body, statusCode) => {
                if (error) {
                    if (body && body.errorMessage) {
                        console.error("Error response from OANDA", statusCode + " Error: " + body.errorMessage + " (OANDA error code " + body.code + ")")
                        return callback(body.errorMessage)
                    }
                    return callback(error)
                }
                if (body.positions) {
                    console.info("Fetched open positions list", body.positions)
                    callback(
                        null,
                        body.positions.map((position) => new Position(position))
                    )
                } else {
                    callback("Unexpected positions response")
                }
            }
        )
    }

    getOpenTrades(accountId, callback) {
        if (!accountId) {
            this.getDefaultAccountId((error, accountId) => (error ? callback(error) : this.getOpenTrades(accountId, callback)))
            return
        }
        this._requestHTTP(
            {
                method: "GET",
                path: `/v3/accounts/${accountId}/openTrades`
            },
            (error, body, statusCode) => {
                if (error) {
                    if (body && body.errorMessage) {
                        console.error("Error response from OANDA", statusCode + " Error: " + body.errorMessage + " (OANDA error code " + body.code + ")")
                        return callback(body.errorMessage)
                    }
                    console.error("Error response from OANDA", statusCode + " Error: " + body)
                    return callback(error)
                }
                if (body.trades) {
                    // console.info("Fetched open trades list", body.trades)
                    callback(
                        null,
                        body.trades.map((trade) => {
                            trade = new Trade(trade)
                            trade.accountId = accountId
                            return trade
                        })
                    )
                } else {
                    callback("Unexpected trades response")
                }
            }
        )
    }

    getOrders(accountId, callback) {
        if (!accountId) {
            this.getDefaultAccountId((error, accountId) => (error ? callback(error) : this.getOrders(accountId, callback)))
            return
        }
        this._requestHTTP(
            {
                method: "GET",
                path: `/v3/accounts/${accountId}/orders`
            },
            (error, body, statusCode) => {
                if (error) {
                    if (body && body.errorMessage) {
                        console.error("Error response from OANDA", statusCode + " Error: " + body.errorMessage + " (OANDA error code " + body.code + ")")
                        return callback(body.errorMessage)
                    }
                    console.error("Error response from OANDA", statusCode + " Error: " + body)
                    return callback(error)
                }
                if (body.orders) {
                    callback(
                        null,
                        body.orders.map((order) => {
                            order = Order.create(order)
                            order.accountId = accountId
                            return order
                        })
                    )
                } else {
                    callback("Unexpected orders response")
                }
            }
        )
    }

    createMarketOrder(accountId, order, callback) {
        if (!accountId) {
            this.getDefaultAccountId((error, accountId) => (error ? callback(error) : this.createMarketOrder(accountId, order, callback)))
            return
        }

        // https://developer.oanda.com/rest-live-v20/order-df/#OrderRequest
        const orderRequest = {
            type: "MARKET"
        }

        if (!order.instrument) {
            return callback("'instrument' is a required field")
        }
        orderRequest.instrument = order.instrument

        // Positive value for long order, negative for short
        if (!order.units) {
            return callback("'units' is a required field")
        }
        orderRequest.units = order.units

        if (order.stopLoss) {
            orderRequest.stopLossOnFill = {
                price: order.stopLoss
            }
        }

        if (order.trailingStop) {
            orderRequest.trailingStopLossOnFill = {
                distance: order.trailingStop
            }
        }

        if (order.takeProfit) {
            orderRequest.takeProfitOnFill = {
                price: order.takeProfit
            }
        }

        this._requestHTTP(
            {
                method: "POST",
                path: `/v3/accounts/${accountId}/orders`,
                headers: {
                    "Content-Type": "application/json"
                },
                data: { order: orderRequest }
            },
            (error, body, statusCode) => {
                if (error) {
                    if (body && body.errorMessage) {
                        console.error("Error response from OANDA", statusCode + " Error: " + body.errorMessage + " (OANDA error code " + body.code + ")")
                        return callback(body.errorMessage)
                    }
                    return callback(error)
                }

                if (statusCode === 201) {
                    callback(null, new MarketOrder(body))
                } else {
                    console.info("Unexpected response from OANDA create market order", body, statusCode)
                    callback("Unexpected order response")
                }
            }
        )
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
        request.headers = {
            ...(request.headers || {}),
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
        if (this.pricesStreamRequest) {
            this.pricesStreamRequest.abort()
        }
        if (this.eventsRequest) {
            this.eventsRequest.abort()
        }
        this.off()
    }
}

Events.mixin(OANDAAdapterV20.prototype)

module.exports = OANDAAdapterV20
