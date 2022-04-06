const _ = require("lodash");
const zmq = require("zeromq");
const bitcoin_rpc = require('node-bitcoin-rpc');
const http = require('http');
const express = require('express');
const bodyParser = require('body-parser')
const consoleLogger = require("tracer").colorConsole({ level: "info" });
const bsv = require("bsv");
const FastTTL = require("./libs/fast.ttl");

const zmqSock = zmq.socket("sub");
zmqSock.connect(process.env.BITCOIN_NODE_ZMQ_ADDRESS);
zmqSock.subscribe("rawtx");

const app = express();
app.use(bodyParser.json());
const socket_app = http.createServer(function (req, res) {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end();
});
const io = require('socket.io').listen(socket_app);

const network = (process.env.NETWORK === "test" ? bsv.Networks.testnet : bsv.Networks.mainnet);
bitcoin_rpc.init(process.env.BITCOIN_NODE_RPC_HOST, parseInt(process.env.BITCOIN_NODE_RPC_PORT), process.env.BITCOIN_NODE_RPC_USER, process.env.BITCOIN_NODE_RPC_PASSWORD);


let txs_ids = new FastTTL();


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

function broadcastTransaction(raw,callback){
  let callBacked = false;
  bitcoin_rpc.call('sendrawtransaction', [raw], (err, res) => {
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
    if(res && res.error){
      callback(res);

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
      decodedTx = new bsv.Transaction(hex);
    } catch (e) {
      consoleLogger.error(e);
    }
    if (!decodedTx) {
      return;
    }
    const txid = decodedTx.id;
    if (txs_ids.has(txid) ) {
      return;
    }
    txs_ids.set(txid);
    //io.sockets.emit("tx:*", hex, decodedTx.toObject());


    // let opOutput;
    // decodedTx.outputs.forEach((out) => {
    //   if (out.satoshis === 0 && out.script.toASM().indexOf("0 OP_RETURN") === 0) {
    //     opOutput = out.script.toASM();
    //   }
    // });

    // if (!opOutput) {
    //   return;
    // }
    // const hexSplitted = opOutput.split(" ");
    // if (hexSplitted.length < 2) {
    //   return;
    // }
    // const splitted = Buffer.from(hexSplitted[2], "hex").toString("utf8").split(" ");
    // const label = splitted.shift();
    // if (!label || label.trim() === "") {
    //   return;
    // }
    // io.sockets.emit(label, hex, decodedTx.toObject());

    decodedTx.inputs.forEach(xin => {
      let address;
      try {
        address = xin.script.toAddress(network).toString();
      } catch (e) { }

      if (address) {
        io.sockets.emit(`address.in:${address}`, hex, decodedTx.toObject());
      }
    })
    decodedTx.outputs.forEach(out => {
      let address;
      try {
        address = out.script.toAddress(network).toString();
      } catch (e) { }

      if (address) {
        io.sockets.emit(`address.out:${address}`, hex, decodedTx.toObject());
      }
    })
  }
})

app.get('/transaction/:tx_id', function (req, res) {
  getTransaction(req.params.tx_id, (err, transaction) => {
    if (err) {
      res.sendStatus(400);

      return;
    }
    res.send(transaction);
  })
});

app.post('/broadcast', function (req, res) {
  broadcastTransaction(req.body.raw, (err, txid) => {
    if (err) {
      res.sendStatus(400);

      return;
    }
    res.send(txid);
  })
});

socket_app.listen(parseInt(process.env.SOCKET_PORT), process.env.HOST, () => {
  consoleLogger.info(`Socket is listening on port ${process.env.SOCKET_PORT}`);
});

app.listen(parseInt(process.env.EXPRESS_PORT), process.env.HOST, () => {
  consoleLogger.info(`App is listening on port ${process.env.EXPRESS_PORT}`);
});
