var http = require("http"),
    https = require("https"),
    querystring = require("querystring");

module.exports = {

    sendRequest: function (hostname, port, method, path, data, callback, onData) {

        var options,
            request,
            keepAlive;

        if (typeof hostname === "object") {
            options = hostname;
            data = hostname.data;
            callback = port;
            onData = method;
        } else {
            options = {
                hostname: hostname,
                port: port,
                method: method,
                path: path
            };
        }

        keepAlive = options.headers && options.headers.Connection === "Keep-Alive";

        console.info("[INFO] Sending request to", options.hostname, (options.port || ""), options.method, options.path);

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
                        console.error("[ERROR] Could not parse response body from", options.hostname, (options.port || ""), options.method, options.path, body.length);
                    }
                }

                if (statusCode !== 200 && statusCode !== 204 && statusCode !== 206) {
                    console.error("[ERROR] Error response received from", options.hostname, (options.port || ""), options.method, options.path, ":", statusCode, body.length);
                    return callback(true, body, statusCode, body); // TODO added body as second argument anyway (error responses can have a body that describes the error). Get rid of anywhere expecting it as 4th arg
                }
                
                console.info("[INFO] Success response received from", options.hostname, (options.port || ""), options.method, options.path);
                callback(null, body, statusCode);
            });

            request.removeAllListeners();
        });

        request.once("error", options.onError || function (error) {
            console.error("[ERROR] Response from", options.hostname, (options.port || ""), options.method, options.path, error);
            callback(error, null, 500);
        });

        if (!keepAlive) {
            request.setTimeout(5000, function () {
                request.removeAllListeners();
                console.error("[ERROR] Request timed out", options.hostname, (options.port || ""), options.method, options.path);
                callback("timeout", null, 508);
            });
        }

        return request;
    }
};