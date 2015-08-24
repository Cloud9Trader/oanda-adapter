/* 
 * Backbone events have the key advantage that context can be passes in as third argument, so all handlers added by a particular instance can be remove on its teardown
 * Also removes need for function binding (reduces code, plus function binding creates new function wrappers which are slower to garbage collect)
 * 
 * Usage:
 *
 *    var myEventEmitter = Events.mixin({});
 *
 * Or for a function constructor:
 *
 *     function MyConstructor(){}
 *     MyConstructor.prototype.foo = function(){}
 *     Events.mixin(MyConstructor.prototype);
 */

var _ = require("underscore"),
    Events = require("backbone-events-standalone");

// Waits for wait ms for event to fire or calls listener with error, removing listener
function waitFor (event, listener, context, wait) {
    var timeout;
    if (!wait) {
        throw new Error("[FATAL] waitFor called without wait time");
    }
    var handler = function () {
        clearTimeout(timeout);
        listener.apply(context, arguments);
    };
    timeout = setTimeout(function () {
        this.off(event, handler, context);
        listener.call(context, "timeout");
    }.bind(this), wait);
    this.once(event, handler, context);
}

// Listens for duration ms for events to fire, then removes listener
function listenFor (event, listener, context, duration) {
    setTimeout(function () {
        this.off(event, listener, context);
    }.bind(this), duration);
    this.on(event, listener, context);
}

// Returns list off event handlers using same matching criteria as 'off' (excluding eventsAPI features)
function getHandlers (name, callback, context) {
    var events = [];
    if (!callback && !context) {
        if (name) {
            return (this._events && this._events[name]) || [];
        } else {
            return this._events;
        }
    }
    _.each(this._events, function (value, key) {
        if (!name || key === name) {
            value.forEach(function (event) {
                if ((!callback || event.callback === callback) && (!context || event.context === context)) {
                    events.push(event);
                }
            });
        }
    });
    return events;
}

module.exports = {
    mixin: function (proto) {
        // Mixin origin BackboneEvent methods
        BackboneEvents.mixin(proto);

        // Add some compatibility with node's EventEmitter.
        proto.addListener = BackboneEvents.on;
        proto.emit = BackboneEvents.trigger;
        proto.removeListener = BackboneEvents.removeAllListeners = BackboneEvents.off;

        // Add in our custom methods
        proto.waitFor = waitFor;
        proto.listenFor = listenFor;
        proto.getHandlers = getHandlers;

        return proto;
    }
}

module.exports = Events;