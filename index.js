const _ = require("lodash");
const zmq = require("zeromq");
var bitcoin = require('bitcoinjs-lib');
const bitcoin_rpc = require('node-bitcoin-rpc');
const http = require('http');
const express = require('express');
const consoleLogger = require("tracer").colorConsole({ level: "info" });


const zmqSock = zmq.socket("sub");
zmqSock.connect(process.env.BITCOIN_NODE_ZMQ_ADDRESS);
zmqSock.subscribe("rawtx");

const app = express();
const socket_app = http.createServer(function (req, res) {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end();
});
const io = require('socket.io').listen(socket_app);


bitcoin_rpc.init(process.env.BITCOIN_NODE_RPC_HOST, parseInt(process.env.BITCOIN_NODE_RPC_PORT), process.env.BITCOIN_NODE_RPC_USER, process.env.BITCOIN_NODE_RPC_PASSWORD);


let txs_ids = [];
function clearTxs() {
  if (txs_ids.length > 5000) {
    txs_ids = txs_ids.splice(1000);
  }
  setTimeout(() => {
    clearTxs();
  }, 5000);
}
clearTxs();


function getTransaction(tx_id, callback) {
  let callBacked = false;
  bitcoin_rpc.call('getrawtransaction', [tx_id, 1], (err, res) => {
    if (callBacked) {
      return;
    }
    if (err) {
      callBacked = true;
      callback(err);

      return;
    }
    if (!res || !res.result) {
      callBacked = true;
      callback(new Error("No data!"));

      return;
    }
    callBacked = true;
    callback(undefined, res.result);
  })
}

io.sockets.on('connection', function (socket) {
  consoleLogger.info("CLIENTS ", io.engine.clientsCount)

  socket.on('disconnect', function () {
    socket.disconnect(0);
    consoleLogger.info("CLIENTS ", io.sockets.clients.length)
    consoleLogger.info('User disconnected');
  });
});

zmqSock.on('message', (topic, message) => {
  if (topic.toString() === "rawtx") {
    const hex = message;
    let decodedTx = undefined;
    try {
      decodedTx = bitcoin.Transaction.fromHex(hex);
    } catch (e) {
      consoleLogger.error(e);
    }
    if (!decodedTx) {
      return;
    }
    const txid = decodedTx.getId();
    if (txs_ids.indexOf(txid) > -1) {
      return;
    }
    txs_ids.push(txid);
    io.sockets.emit("tx:*", hex, decodedTx);
    const splitted = bitcoin.script.toASM(decodedTx.outs[0].script).toString().split(" ");
    if (splitted.length < 2) {
      return;
    }
    const label = new Buffer(splitted[2], "hex").toString("utf8").split(" ")[0];
    if (!label || label.trim() === "") {
      return;
    }
    io.sockets.emit(label, hex, decodedTx);
    decodedTx.outs.forEach(out => {
      let address;
      try {
        address = bitcoin.address.fromOutputScript(out.script)
      } catch (e) { consoleLogger.error(e) }

      if (address) {
        io.sockets.emit(`address:${address}`, hex, decodedTx);
      }
    })
  }
})

app.get('/transaction/:tx_id', function (req, res, next) {
  getTransaction(req.params.tx_id, (err, transaction) => {
    if (err) {
      res.sendStatus(400);

      return;
    }
    res.send(transaction);
  })
});

socket_app.listen(parseInt(process.env.SOCKET_PORT), process.env.HOST, () => {
  consoleLogger.info(`Socket is listening on port ${process.env.SOCKET_PORT}`);
});

app.listen(parseInt(process.env.EXPRESS_PORT), process.env.HOST, () => {
  consoleLogger.info(`App is listening on port ${process.env.EXPRESS_PORT}`);
});