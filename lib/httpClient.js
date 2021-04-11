const https = require("https")
const querystring = require("querystring")

let httpsAgent

let maxSockets = 2

module.exports = {
    setMaxSockets: (max) => {
        maxSockets = max
    },

    sendRequest: (options, _callback, onData) => {
        const {data, timeout, stream} = options
        const TIMEOUT = timeout || 5000

        // For non streaming connections, use HTTP Agent to pool persistent TCP sockets for HTTP requests
        if (!stream) {
            if (!httpsAgent) {
                httpsAgent = new https.Agent({
                    maxSockets: maxSockets
                })
            }
            options.agent = httpsAgent

            Object.keys(options.agent.requests).forEach((connectionName) => {
                console.debug("OANDA socket pool for", connectionName, "has", options.agent.requests[connectionName].length, "pending requests over", options.agent.sockets[connectionName].length, "sockets")
            })
        }

        const request = https.request(options)

        if (data) {
            if (options.headers && options.headers["Content-Type"] === "application/x-www-form-urlencoded") {
                request.write(querystring.stringify(data))
            } else {
                request.write(JSON.stringify(data))
            }
        }

        request.end()

        const callback = (...args) => {
            _callback(...args)
            _callback = () => {
                console.error("OANDA HTTP callback called twice", options.hostname, options.port, options.method, options.path, ...args)
            }
        }

        request.once("response", (response) => {
            let body = ""
            let ended = false

            const {statusCode} = response

            response.setEncoding("utf8")

            response.on("data", (chunk) => {
                if (stream) {
                    if (onData) {
                        onData(chunk)
                    }
                    body = chunk
                } else {
                    body += chunk
                }
            })

            response.once("end", () => {
                ended = true

                if (body) {
                    try {
                        body = JSON.parse(body)
                    } catch (error) {
                        console.warn("OANDA HTTP response body could not be parsed", options.hostname, options.port, options.method, options.path, body.length)
                    }
                }

                if (statusCode !== 200 && statusCode !== 201 && statusCode !== 204 && statusCode !== 206) {
                    console.error("OANDA HTTP responded with error code", statusCode, options.hostname, options.port, options.method, options.path)
                    return callback(true, body, statusCode, body) // TODO added body as second argument anyway (error responses can have a body that describes the error). Get rid of anywhere expecting it as 4th arg
                }

                if (options.agent) {
                    Object.keys(options.agent.requests).forEach((connectionName) => {
                        console.debug("OANDA socket pool for", connectionName, "has", options.agent.requests[connectionName].length, "pending requests over", options.agent.sockets[connectionName].length, "sockets")
                    })
                }
                callback(null, body, statusCode)
            })

            response.once("error", (error) => {
                ended = true
                console.error("OANDA HTTP response errored", options.hostname, options.port, options.method, options.path, error)
                callback(error)
            })

            response.once("close", () => {
                if (!ended) {
                    console.error("OANDA HTTP response  closed unexpectedly", options.hostname, options.port, options.method, options.path)
                    callback("Response closed unexpectedly", null, 500)
                }
            })

            request.removeAllListeners()
        })

        request.once("error", (error) => {
            console.error("OANDA HTTP request errored", options.hostname, options.port, options.method, options.path, error)
            callback(error, null, 500)
        })

        if (!stream) {
            request.setTimeout(TIMEOUT, () => {
                request.removeAllListeners()
                console.error("OANDA HTTP request timed out after", timeout / 1000 + "s", options.hostname, options.port, options.method, options.path)
                callback("timeout", null, 508)
            })
        }

        return request
    }
}
