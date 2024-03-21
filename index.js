module.exports = require("./lib/OANDAAdapterV20")
// module.exports.OandaLib = require("@oanda/v20")

// const {Instrument} = require("@oanda/v20/primitives")
// const {ClientPrice} = require("@oanda/v20/pricing")
// const {Account, AccountProperties, AccountChanges, AccountChangesState} = require("@oanda/v20/account")
// const {Position} = require("@oanda/v20/position")
// const {Trade} = require("@oanda/v20/trade")
// const {MarketOrder} = require("@oanda/v20/order")
// const { Candlestick } = require("@oanda/v20/instrument")

module.exports.OANDA = Object.assign(
    {},
    require("@oanda/v20/account"),
    require("@oanda/v20/instrument"),
    require("@oanda/v20/order"),
    require("@oanda/v20/position"),
    require("@oanda/v20/pricing"),
    require("@oanda/v20/trade"),
    require("@oanda/v20/transaction")
)
