var net     = require("net"),
    twerk   = require("./twerk");

var stream = twerk(net.createConnection(8124));

stream.on("connect", function() {
    console.log("Connected!");
    stream.write("Hello world!");

    setTimeout(function() {
        stream.end();
    }, 1000);
});

stream.on("data", function(msg) {
    console.log("Received: " + msg);
});

stream.on("close", function() {
    console.log("Disconnected!");
});
