var net     = require("net"),
    twerk   = require("./twerk");

var server = net.createServer(function(conn) {
    var stream = twerk(conn);
    
    stream.setEncoding("utf8");
    stream.on('connect', function () {
        console.log("Received connection.");
        stream.write('hello\r\n');
    });
    stream.on('data', function (data) {
        console.log("Received data: " + data);
        stream.write(data);
    });
    stream.on('end', function () {
        console.log("Someone disconnected.");
        stream.end();
    });
});

server.listen(8124);
console.log("Listening on 8124...");