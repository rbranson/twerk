var util = require("util");

// The default options passed into twerk()
var OPTION_DEFAULTS = {
    heartbeatInterval: 5000,
    heartbeatTimeout:  20000
};

// The minimum granularity of heartbeat intervals is worst case: this value * 2
var NAZI_CHECK_INTERVAL = 100;

// The events twerk will forward directly from the stream
var STREAM_EVENTS_FORWARDED = [
    "timeout",
    "drain",
    "error"
];

// the representation of 1GB should be the longest length we should transmit. this value 
// is used to detect corruption
var MAX_HEADER_LENGTH = ((1024 * 1024 * 1024).toString() + ",").length;

// _bind and _extend
// extracted from underscore.js, license included below:
//
// Copyright (c) 2010 Jeremy Ashkenas, DocumentCloud
//
// Permission is hereby granted, free of charge, to any person
// obtaining a copy of this software and associated documentation
// files (the "Software"), to deal in the Software without
// restriction, including without limitation the rights to use,
// copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the
// Software is furnished to do so, subject to the following
// conditions:
// 
// The above copyright notice and this permission notice shall be
// included in all copies or substantial portions of the Software.
// 
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
// OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
// HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
// WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
// FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
// OTHER DEALINGS IN THE SOFTWARE.

var slice = Array.prototype.slice;

var _bind = function(func, obj) {
    var args = slice.call(arguments, 2);
    return function() {
        return func.apply(obj || {}, args.concat(slice.call(arguments)));
    };
};

var _extend = function(obj) {
    slice.call(arguments, 1).forEach(function(source) {
        for (var prop in source) obj[prop] = source[prop];
    });
    return obj;
};

var twerk = module.exports = function(stream, options) {
    return new twerk.Twerker(stream, options).modified();
};

// indicates a heartbeat message -- compared by identity (===)
var HEARTBEAT   = twerk.HEARTBEAT   = {};

// indicates stream corruption
var CORRUPT     = twerk.CORRUPT     = {};

// for the debuggers out there
HEARTBEAT.inspect  = function() { return "twerk:HEARTBEAT"; };
CORRUPT.inspect    = function() { return "twerk:CORRUPT"; };

// Allow the HEARTBEAT to be used as a parameter on write() -- neato
HEARTBEAT.toString = function() { return ""; };

// Twerker wraps a stream object with twerk functionality and allows a stream-like interface
// to be generated for the stream.
twerk.Twerker = function(stream, options) {
    var self = this;
    
    process.EventEmitter.call(this);
    
    this._stream    = stream;
    this._options   = _extend({}, OPTION_DEFAULTS, options || {});
        
    // just re-emit events coming from the stream that we don't particularly care about
    for (var i = 0, len = STREAM_EVENTS_FORWARDED; i < len; i++) {
        var ev = STREAM_EVENTS_FORWARDED[i];
        
        stream.on(ev, function() {
            self.emit.apply(self, slice.call(arguments, 1));
        });
    }
    
    stream.on("connect", function() {
        // on connect, send the heartbeat message
        self.write(HEARTBEAT);
        self.emit("connect");
    });
    
    // TODO: does stream.destroy() cause the client to receive a disconnect event?
    // The nazi will call the destroy function when it times out
    var nazi = this._nazi = twerk.nazi(this._options.heartbeatTimeout, function() {
        stream.destroy();
    });
    
    var decoder = twerk.decoder(function(message) {
        if (message === HEARTBEAT) {
            if (!self._beater) {
                self._beater = setInterval(function() {
                    self.write(HEARTBEAT);
                }, self._options.heartbeatInterval);
            }
            
            nazi();
        }
        else if (message === CORRUPT) {
            self.emit("corrupt");
        }
        else {
            self.emit("data", message);
        }
    });
    
    // send all the data we get to the decoder
    stream.on("data", function(data) { decoder(data); });

    // make sure to stop our heartbeating on a close/end
    stream.on("close",  function() { self._onDisconnect(); self.emit("close"); });
    stream.on("end",    function() { self._onDisconnect(); self.emit("end"); });
};

util.inherits(twerk.Twerker, process.EventEmitter);

// Returns a stream-like object that is bathed in twerkiness
twerk.Twerker.prototype.lookalike = function() {
    return _extend({}, this._stream, {
        on:         _bind(this.on, this),
        write:      _bind(this.write, this),
        destroy:    _bind(this.destroy, this),
        end:        _bind(this.end, this) 
    });
};

twerk.Twerker.prototype.write = function(message) {
    this._stream.write(twerk.stringify(message));
};

twerk.Twerker.prototype.destroy = function() {
    this._onDisconnect();
    this._stream.destroy();
};

twerk.Twerker.prototype.end = function() {
    this._onDisconnect();
    this._stream.end.apply(this._stream, arguments);
};

twerk.Twerker.prototype._onDisconnect = function() {
    clearInterval(this._beater);
    this._nazi(true);    
};

// Converts a string-compatible object into a twerk frame
twerk.stringify = function(message) {
    var s = (message || "").toString();
    return s.length + "," + s;
};

// The heartbeat nazi, calls a callback if it hasn't received a call for gap milliseconds
twerk.nazi = function(gap, callback) {
    var last, interval;
    
    function beat() {
        if (arguments.length == 0) {
            last = Date.now();
        }
        else {
            clearInterval(interval);
        }
    }
    
    function check() {
        if ((Date.now() - last) > gap) {
            beat(true); // clears the interval
            callback();
        }
    }
    
    // Do an initial beat to setup our "last" variable
    beat();
    
    interval = setInterval(check, NAZI_CHECK_INTERVAL);
    
    // Pass back the beat function
    return beat;
};

// Returns a function that takes data and calls the callback when a full message is received.
twerk.decoder = function(callback) {
    // NOTE: lots of repeated code in here because repeating code is fast and this
    // is infrastucture code, so I get to make these performance nazi concessions.
    
    // oh what tangled mutable state we weave
    var buf     = "",
        wait    = 0;
    
    // message framin' is hard, let's go shopping, er, no, let's frame like manly men (and gals)
    return function(chnk) {
        var pending = [];
        
        if (wait == 0) {
            // on new message frame, assign the buffer as a starting point
            buf = chnk;
        }
        else {
            // not a new message frame, so just concatenate the data onto the existing buffer
            buf += chnk;
        }
        
        // this is a loop because we have to parse multi-message data chunks with C-style breakin'
        while (true) {
            if (wait <= 0) { 
                // a new message frame, OR haven't received a complete header yet
                var commaAt = buf.indexOf(","),
                    buflen  = buf.length;
            
                if (commaAt != -1) {
                    // have a comma, so we're in business
                    var pldlen  = parseInt(buf.slice(0, commaAt)),
                        hdrlen  = commaAt + 1,
                        tlen    = pldlen + hdrlen;
                    
                    if (hdrlen > MAX_HEADER_LENGTH) {
                        // sanity check for corruption
                        pending.push(CORRUPT);
                        buf = ""; wait = 0;
                    }
                    else if (buflen >= tlen) {
                        // have at least a full message, if not more
                        
                        // zero-length is a heartbeat, otherwise it's a regular message
                        pending.push(pldlen == 0 ? HEARTBEAT : buf.substr(hdrlen, pldlen));

                        if (buflen == tlen) {
                            // our chunk consisted of one and only one message
                            buf = ""; wait = 0;
                            break;
                        }
                        else {
                            // data after the msg end, so loop back and parse the rest of the stream
                            buf  = buf.slice(tlen);
                            wait = 0;
                            continue; // explicit -- just for explicitness
                        }
                    }
                    else {
                        // don't have the full message yet, record number of bytes left
                        wait = pldlen - (buflen - hdrlen);
                        break;
                    }
                }
                else {
                    // no comma, so there's some weird shit going on
                    
                    // sanity check the length of our buffer
                    if (buflen > MAX_HEADER_LENGTH) {
                        // uh oh, problems, report corruption and reset
                        pending.push(CORRUPT);
                        buf = ""; wait = 0;
                    }
                    else {
                        // mark it so doesn't get overwritten when the rest of the data comes in.
                        wait = -1;
                    }

                    break;
                }
            }
            else { 
                // haven't received a complete message frame, so keep looking
                wait -= chnk.length;
                
                if (wait <= 0) {
                    // at least received a whole message frame, possibly more, now hit back at the
                    // while loop above where it'll parse the message as it should.
                    continue;
                }
                else {
                    // doh, still don't have our full message!
                    break;
                }
            }
        }
                
        // call the callback after we're done, so exceptions don't interrupt the main routine
        for (var i = 0, len = pending.length; i < len; i++) {
            callback(pending[i]);
        }
    };
};
