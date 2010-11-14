var twerk   = require("./twerk"),
    assert  = require("assert"),
    util    = require("util");

function durationOf(f) {
    var before = Date.now();
    f();
    return Date.now() - before;
}

function measure(what, f) {
    var duration = durationOf(f);
    util.log("Executed " + what + " in " + duration + "ms");
}

function measureIterationsOverTime(what, duration, f, granularity) {
    granularity = granularity || 1000;
    
    var iterations  = 0,
        start       = Date.now();

    while (Date.now() < (start + duration)) {
        for (var i = 0; i < granularity; i++) {
            f();
        }
        iterations += granularity;
    };
    
    var duration    = Date.now() - start,
        persec      = (iterations / (Date.now() - start)) * 1000;
        
    util.log("Executed " + what + " " + iterations + " times in " + duration + "ms " + "(" + persec + "/sec)");
}

function repeat(what, times) {
    out = "";
    
    for (var i = 0; i < times; i++) {
        out += what;
    }
    
    return out;
} 

// -----------------------------------
// twerk.decoder
// -----------------------------------

function assertTwerkDecoder(expected, chunks) {
    var out = [];
    var f   = twerk.decoder(function(msg) {
        out.push(msg);
    });
    
    for (var i = 0, len = chunks.length; i < len; i++) {
        f(chunks[i]);
    }

    assert.deepEqual(expected, out);
}

// single-message chunk
assertTwerkDecoder(["abcd"], ["4,abcd"]);

// multiple single-message chunks in order
assertTwerkDecoder(["abcd", "efgh", "ijkl"], ["4,abcd", "4,efgh", "4,ijkl"])

// single-message with a complete header but broken body
assertTwerkDecoder(["abcd"], ["4,ab", "cd"])

// single-message broken over a long set of chunks
assertTwerkDecoder(["1234567890"], [ "10,1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]);

// multi-message chunk
assertTwerkDecoder(["abcd", "efgh"], ["4,abcd4,efgh"]);

// broken multi-message chunks
assertTwerkDecoder(["abcd", "efgh", "ijkl"], ["4,abcd4,e", "fgh4,ij", "kl"]);

// single-message with multiple chunks and broken header
assertTwerkDecoder(["1234567890"], ["10", ",1234567890"]);
assertTwerkDecoder(["1234567890"], ["1", "0", ",1234567890"]);

// empty chunk -- will never happen IRLz, but whatever
assertTwerkDecoder([], [""]);

// empty chunk followed by a real message
assertTwerkDecoder(["abcd"], ["", "4,abcd"]);

// intermittent empty chunk
assertTwerkDecoder(["abcd", "abcd"], ["", "4,abcd", "", "4,abcd"]);

// empty chunk breaks message
assertTwerkDecoder(["abcd"], ["4,ab", "", "cd"]);

// exceptions in the callback don't break decoder state
(function() {
    var out;
    var dec = twerk.decoder(function(msg) {
        out.push(msg);
        throw "Hell yeah I decode messages";
    });
    
    // won't break on a single-message
    out = [];
    try { dec("4,abcd"); } catch (e) {}    
    assert.deepEqual(["abcd"], out);
    
    // won't break with broken & overlapping messages
    out = [];
    try { dec("4,ab"); } catch (e) {}
    try { dec("cd4,e"); } catch (e) {}
    try { dec("fgh"); } catch (e) {} 
    assert.deepEqual(["abcd", "efgh"], out);
    
    // won't break with broken headers, but doesn't catch the last error, so the pending
    // executor loop at the end of the function stops, which is expected behavior.
    out = [];
    try { dec("1,x1"); } catch (e) {}
    try { dec(",x1,x"); } catch (e) {}
    assert.deepEqual(["x", "x"], out);

    // after all this, still won't break on a single-message
    out = [];
    try { dec("4,abcd"); } catch (e) {}    
    assert.deepEqual(["abcd"], out);
})();

// heartbeats are emitted properly
(function() {
    var out = [];
    var dec = twerk.decoder(function(msg) {
        out.push(msg);
   });
   
   // full heartbeat
   dec("0,");
   
   // broken heartbeat
   dec("0");
   dec(",");
   
   // overlapping heartbeats 
   dec("0,0,0,");
   
   // heartbeats mixed in with other messages
   dec("4,abcd0,4,abcd");

   assert.strictEqual(twerk.HEARTBEAT, out[0]);
   assert.strictEqual(twerk.HEARTBEAT, out[1]); 
   assert.strictEqual(twerk.HEARTBEAT, out[2]); 
   assert.strictEqual(twerk.HEARTBEAT, out[3]); 
   assert.strictEqual(twerk.HEARTBEAT, out[4]); 
   assert.strictEqual(twerk.HEARTBEAT, out[6]);
})();

// stream corruption is detected
(function() {
    var out = [];
    var dec = twerk.decoder(function(msg) {
        out.push(msg);
   });
   
   // a completely inane message, it should emit CORRUPT on this
   dec("laksdjgaosieuaelwrjs;lfjsdlfkjasdlfkjasdfoij");
   
   // corrupt messages have commas in them too!
   dec("1024249043904390430941283012,3248203");
   
   assert.strictEqual(twerk.CORRUPT, out[0]);
   assert.strictEqual(twerk.CORRUPT, out[1]);
})();

if (process.argv[2] == "--perf") {
    // performance test
    util.log("Hold tight... these performance tests are around 10 seconds each.");
    
    (function() {
        var perfdec = twerk.decoder(function(msg) { }),
            byte100 = "100," + repeat("X", 100),
            onek = "1024," + repeat("X", 1024),
            tenk = (10 * 1024) + "," + repeat("X", 10 * 1024);

        measureIterationsOverTime("100 byte message decode", 10000, function() {
            perfdec(byte100);
        });

        measureIterationsOverTime("1kb message decode", 10000, function() {
            perfdec(onek);
        });
    
        measureIterationsOverTime("10kb message decode", 10000, function() {
            perfdec(tenk);
        });
    
        // this used to break because it produces a corrupt message, because apparently
        // i don't know how to use slice. but now we have corrupt message detection, 
        // so it's placed here as a stress test.
        var stresstenka = tenk.slice(0, 2499),
            stresstenkb = tenk.slice(2500, 4999),
            stresstenkc = tenk.slice(5000, 7499),
            stresstenkd = tenk.slice(7500);
    
        measureIterationsOverTime("corrupt four-part 10kb message decode", 10000, function() {
            perfdec(stresstenka);
            perfdec(stresstenkb);
            perfdec(stresstenkc);
            perfdec(stresstenkd);
        });

        var stresstenka = tenk.slice(0, 2500),
            stresstenkb = tenk.slice(2500, 5000),
            stresstenkc = tenk.slice(5000, 7500),
            stresstenkd = tenk.slice(7500);
    
        assert.equal(10240 + "10240,".length, (stresstenka + stresstenkb + stresstenkc + stresstenkd).length);
    
        measureIterationsOverTime("correct four-part 10kb message decode", 10000, function() {
            perfdec(stresstenka);
            perfdec(stresstenkb);
            perfdec(stresstenkc);
            perfdec(stresstenkd);
        });
    })();
}
else {
    util.log("Pro tip: run me with --perf to see performance tests");
}

// -----------------------------------
// twerk.stringify
// -----------------------------------

assert.equal("1,a",                 twerk.stringify("a"));
assert.equal("4,abcd",              twerk.stringify("abcd"));
assert.equal("10,1234567890",       twerk.stringify("1234567890"));
assert.equal("4,1234",              twerk.stringify(1234));
assert.equal("0,",                  twerk.stringify(""));
assert.equal("0,",                  twerk.stringify([]));
assert.equal("15,[object Object]",  twerk.stringify({}));
assert.equal("0,",                  twerk.stringify(null));
assert.equal("0,",                  twerk.stringify());

// -----------------------------------
// Twerker
// -----------------------------------
var StreamMock = function() {
    process.EventEmitter.call(this);
    
    this._written     = [],
    this._destroyed   = 0,
    this._ended       = 0;
};

util.inherits(StreamMock, process.EventEmitter);

StreamMock.prototype.write          = function(data) { this._written.push(data); };
StreamMock.prototype.destroy        = function() { this._destroyed++; };
StreamMock.prototype.end            = function() { this._ended++; };
StreamMock.prototype.setEncoding    = function(s) { this._encoding = s; };

// emit packet gets decoded and passed to the "data" event, destroy works and passes destroy
(function() {
    var mock    = new StreamMock(),
        twerker = new twerk.Twerker(mock, {});
        
    twerker.on("data", function(message) {
        assert.equal("abcd", message);
    });
    
    mock.emit("data", "0,");
    mock.emit("data", "4,abcd4,abcd");
    
    twerker.destroy();
    assert.equal(1, mock._destroyed);
})();

// end & close events causes are handled properly
(function() {
    var mock        = new StreamMock(),
        twerker     = new twerk.Twerker(mock, {}),
        ended       = false,
        destroyed   = false;
    
    twerker.on("end", function() { ended = true; });    
    mock.emit("end");
    assert.ok(ended);

    twerker.on("close", function() { closed = true; });    
    mock.emit("close");
    assert.ok(ended);

    twerker.destroy();
})();

// corrupt event is triggered by corrupt data
(function() {
    var mock    = new StreamMock(),
        twerker = new twerk.Twerker(mock, {}),
        flagged = false;
    
    twerker.on("corrupt", function() {
        flagged = true;
    });
    
    mock.emit("data", "11111111111111111111111111111111111111111111111111111111111111");
    assert.ok(flagged);
    
    twerker.destroy();
})();

// heartbeat timeout passes in and triggers the destroy
(function() {
    var mock    = new StreamMock(),
        twerker = new twerk.Twerker(mock, { heartbeatTimeout: 250 });
    
    setTimeout(function() {
        assert.equal(1, mock._destroyed);
        twerker.destroy();
    }, 500);
})();

// heartbeat timeout does NOT pass
(function() {
    var mock    = new StreamMock(),
        twerker = new twerk.Twerker(mock, { heartbeatTimeout: 250 });
    
    var beater = setInterval(function() {
        mock.emit("data", "0,");
    }, 100);
    
    setTimeout(function() {
        assert.equal(0, mock._destroyed);
        twerker.destroy();
        clearInterval(beater);
    }, 500);
})();

// The basic decode/data pump works through the lookalike
(function() {
    var mock        = new StreamMock(),
        twerker     = new twerk.Twerker(mock, {}),
        lookalike   = twerker.lookalike();
    
    var gotData;
    lookalike.on("data", function(msg) {
        gotData = msg;
    });
    mock.emit("data", "4,abcd");
    assert.equal("abcd", gotData);
    
    twerker.destroy();
})();

// Writing to the lookalike does an encode/write to the stream
(function() {
    var mock        = new StreamMock(),
        twerker     = new twerk.Twerker(mock, {}),
        lookalike   = twerker.lookalike();
    
    lookalike.write("abcd");
    assert.equal("4,abcd", mock._written[0]);
    
    twerker.destroy();
})();

// end & destroy hit the stream through the lookalike
(function() {
    var mock        = new StreamMock(),
        twerker     = new twerk.Twerker(mock, {}),
        lookalike   = twerker.lookalike();
        
    lookalike.end();
    lookalike.destroy();
    
    assert.equal(1, mock._ended);
    assert.equal(1, mock._destroyed);    
    
    twerker.destroy();
})();

// twerker sets encoding to utf-8
(function() {
    var mock        = new StreamMock(),
        twerker     = new twerk.Twerker(mock, {});
        
    assert.equal("utf8", mock._encoding);
    twerker.destroy();
})();



// -----------------------------------
// twerk.nazi
// -----------------------------------

// the nazi will actually call the callback if it doesn't get a beat
(function() {
    var wuzCalled = false;
    var nazi = twerk.nazi(200, function() {
        wuzCalled = true;
    });

    setTimeout(function() {
        assert.ok(!wuzCalled);
    }, 100);

    setTimeout(function() {
        assert.ok(wuzCalled);
    }, 400);
})();

// the nazi WON'T call the callback if it gets a beat
(function() {
    var wuzCalled = false;
    var nazi = twerk.nazi(200, function() {
        wuzCalled = true;
    });

    var beater = setInterval(function() {
        nazi();
    }, 50);
    
    setTimeout(function() {
        assert.ok(!wuzCalled);
    }, 100);

    setTimeout(function() {
        assert.ok(!wuzCalled);
        clearInterval(beater);
    }, 400);
})();

/////////////////////////////////////////

setTimeout(function() {
    util.log("All tests passed!");
}, 2000);