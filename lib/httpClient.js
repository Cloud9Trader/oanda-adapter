const https = require("https")
const querystring = require("querystring")

let httpAgent
let httpsAgent

let maxSockets = 2

module.exports = {
    setMaxSockets: (max) => {
        maxSockets = max
    },

    sendRequest: (options, callback, onData) => {
        const {data, stream} = options
        const timeout = options.timeout || 5000

        // For non streaming connections, use HTTP Agent to pool persistent TCP sockets for HTTP requests
        if (!stream) {
            if (!httpsAgent) {
                httpsAgent = new https.Agent({
                    maxSockets: maxSockets
                })
            }
            options.agent = httpsAgent

            Object.keys(options.agent.requests).forEach((connectionName) => {
                console.info("[INFO] Socket pool for", connectionName, "has", options.agent.requests[connectionName].length, "pending requests over", options.agent.sockets[connectionName].length, "sockets")
            })
        }

        console.info("[INFO] HTTPS OUT", options.hostname, options.port, options.method, options.path)

        const request = https.request(options)

        if (data) {
            if (options.headers && options.headers["Content-Type"] === "application/x-www-form-urlencoded") {
                request.write(querystring.stringify(data))
            } else {
                request.write(JSON.stringify(data))
            }
        }

        request.end()

        request.once(
            "response",
            options.onResponse ||
                function (response) {
                    let body = ""
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
                        if (body) {
                            try {
                                body = JSON.parse(body)
                            } catch (error) {
                                console.warn("[WARN]  HTTPS IN ", options.hostname, options.port, options.method, options.path, body.length, "Could not parse response body")
                            }
                        }

                        if (statusCode !== 200 && statusCode !== 201 && statusCode !== 204 && statusCode !== 206) {
                            console.error("[ERROR] HTTPS IN ", options.hostname, options.port, options.method, options.path, ":", statusCode, body.length)
                            return callback(true, body, statusCode, body) // TODO added body as second argument anyway (error responses can have a body that describes the error). Get rid of anywhere expecting it as 4th arg
                        }

                        console.info("[INFO]  HTTPS IN ", options.hostname, options.port, options.method, options.path)
                        if (options.agent) {
                            Object.keys(options.agent.requests).forEach((connectionName) => {
                                console.info("[INFO] Socket pool for", connectionName, "has", options.agent.requests[connectionName].length, "pending requests over", options.agent.sockets[connectionName].length, "sockets")
                            })
                        }
                        callback(null, body, statusCode)
                    })

                    response.once("error", (error) => {
                        console.error("[ERROR] HTTPS IN ", options.hostname, options.port, options.method, options.path, "Response stream errored", error)
                    })

                    request.removeAllListeners()
                }
        )

        request.once(
            "error",
            options.onError ||
                function (error) {
                    console.error("[ERROR] HTTPS IN ", options.hostname, options.port, options.method, options.path, error)
                    callback(error, null, 500)
                }
        )

        if (!stream) {
            request.setTimeout(timeout, () => {
                request.removeAllListeners()
                console.error("[ERROR] HTTPS IN ", options.hostname, options.port, options.method, options.path, "Timed out after " + timeout / 1000 + "s")
                callback("timeout", null, 508)
            })
        }

        return request
    }
}
