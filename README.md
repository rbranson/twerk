# Twerk

_twerk_ is a node.js module that makes sending and receiving messages on a stream a piece of cake.

## Installation

    $ npm install twerk

## Usage

_twerk_ turns an I/O stream into a set of individual messages using a simple framing protocol. It dices a stream into the pieces you actually intended to send them in. It works as an adapter, and the API works as a drop-in "replacement" for net.Stream:

    var socket = twerk(stream);

    socket.on("connect", function() {
        console.log("I'm connected! Yes!");
    });
    
    socket.on("data", function(msg) {
        console.log(data);
    });
    
    socket.on("close", function() {
        console.log("Lost my connection! Oh noes!");
    });

## Protocol

_twerk_ uses a very simple protocol that allows it to quickly determine when it has received a complete message, and where the boundaries of messages are on the stream. At the stream level, _twerk_ looks like this:

    => "0,"
    <= "0,"
    => "5,hello"
    <= "7,goodbye"

It's simple: the message length is sent as text followed by a comma, and then the message payload. Heartbeats are encoded as zero-length messages: "0,". When the connection is established, a simple handshake is used: both sides send a heartbeat message. When either side receives the first heartbeat, it's assumed that the other side is ready to receive messages.

## API

As stated previous, _twerk_ is just an adapter. It exposes itself as a function, which takes two arguments: the first being a _stream_, which is required, and the second being an _options_ hash. It returns an object that has the same interface as a _stream_, but is doing message framing underneath the covers.

     twerk(stream, {
         heartbeatInterval: 5000,   // milliseconds between heartbeat messages
         heartbeatTimeout: 20000    // number of milliseconds to wait for a heartbeat
     });

That's it.

## Notes

* Twerk only supports UTF-8 message encoding right now.
* This is pretty new code, and while the test coverage is decent, it hasn't been put through enough rigor to be considered "production ready."