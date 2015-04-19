var http = require("http"),
    https = require("https"),
    querystring = require("querystring");

var httpAgent, httpsAgent, maxSockets = 2;

module.exports = {

    setMaxSockets: function (max) {
        maxSockets = max;
    },

    sendRequest: function (options, callback, onData) {

        var request,
            keepAlive,
            timeout = 5000;

        data = options.data;
        timeout = options.timeout || timeout;

        keepAlive = options.headers && options.headers.Connection === "Keep-Alive";
        
        // For non streaming connections, use HTTP Agent to pool persistent TCP sockets for HTTP requests
        if (!keepAlive) {

            if (!options.secure) {
                if (!httpAgent) {
                    httpAgent = new http.Agent({
                        maxSockets: maxSockets
                    });
                }
                options.agent = httpAgent;
            } else {
                if (!httpsAgent) {
                    httpsAgent = new https.Agent({
                        maxSockets: maxSockets
                    });
                }
                options.agent = httpsAgent;
            }

            Object.keys(options.agent.requests).forEach(function (connectionName) {
                console.info("[INFO] Socket pool for", connectionName, "has", options.agent.requests[connectionName].length, "pending requests over", options.agent.sockets[connectionName].length, "sockets");
            });
        }

        console.info("[INFO]  HTTPS OUT", options.hostname, options.port, options.method, options.path);

        if (options.secure === false) {
            request = http.request(options);
        } else {
            request = https.request(options);
        }

        if (data) {
            if (options.headers && options.headers["Content-Type"] === "application/x-www-form-urlencoded") {
                request.write(querystring.stringify(data));
            } else {
                request.write(JSON.stringify(data));
            }
        }

        request.end();

        request.once("response", options.onResponse || function (response) {

            var body = "",
                statusCode = response.statusCode;

            response.setEncoding("utf8");

            response.on("data", function (chunk) {
                if (keepAlive) {
                    if (onData) {
                        onData(chunk);
                    }
                    body = chunk;
                } else {
                    body += chunk;
                }
            });

            response.once("end", function () {
                if (body) {
                    try {
                        body = JSON.parse(body);
                    } catch (error) {
                        console.warn("[WARN]  HTTPS IN ", options.hostname, options.port, options.method, options.path, body.length, "Could not parse response body");
                    }
                }

                if (statusCode !== 200 && statusCode !== 204 && statusCode !== 206) {
                    console.error("[ERROR] HTTPS IN ", options.hostname, options.port, options.method, options.path, ":", statusCode, body.length);
                    return callback(true, body, statusCode, body); // TODO added body as second argument anyway (error responses can have a body that describes the error). Get rid of anywhere expecting it as 4th arg
                }
                
                console.info("[INFO]  HTTPS IN ", options.hostname, options.port, options.method, options.path);
                if (options.agent) {
                    Object.keys(options.agent.requests).forEach(function (connectionName) {
                        console.info("[INFO] Socket pool for", connectionName, "has", options.agent.requests[connectionName].length, "pending requests over", options.agent.sockets[connectionName].length, "sockets");
                    });
                }
                callback(null, body, statusCode);
            });

            response.once("error", function (error) {
                console.error("[ERROR] HTTPS IN ", options.hostname, options.port, options.method, options.path, "Response stream errored", error);
            });

            request.removeAllListeners();
        });

        request.once("error", options.onError || function (error) {
            console.error("[ERROR] HTTPS IN ", options.hostname, options.port, options.method, options.path, error);
            callback(error, null, 500);
        });

        if (!keepAlive) {
            request.setTimeout(timeout, function () {
                request.removeAllListeners();
                console.error("[ERROR] HTTPS IN ", options.hostname, options.port, options.method, options.path, "Timed out after " + (timeout / 1000) + "s");
                callback("timeout", null, 508);
            });
        }

        return request;
    }
};