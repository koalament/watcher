const _ = require("lodash");
const async = require("async");
const hex_decoder = require("raw-transaction-hex-decoder");
const bitcoin_rpc = require('node-bitcoin-rpc');
const http = require('http');
const express = require('express');
const app = express();
const consoleLogger = require("tracer").colorConsole({ level: "info" });
const socket_app = http.createServer(function (req, res) {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end();
});
bitcoin_rpc.init(process.env.BITCOIN_NODE_RPC_HOST, parseInt(process.env.BITCOIN_NODE_RPC_PORT), process.env.BITCOIN_NODE_RPC_USER, process.env.BITCOIN_NODE_RPC_PASSWORD);
const io = require('socket.io').listen(socket_app);

let last_mempool = [];

function getTransaction(tx_id, callback) {
  consoleLogger.info(tx_id)
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
    callback(res.result);
  })
}

function loop() {
  bitcoin_rpc.call('getrawmempool', [], (err, res) => {
    if (err) {
      consoleLogger.error(err);
      consoleLogger.error("retry getrawmempool")
      setTimeout(() => {
        loop();
      }, 1000);
      return;
    }
    if (!res || !res.result) {
      throw new Error("No data!");
    }
    const mem_pool = res.result;
    if (last_mempool.length !== 0) {
      const difference = _.xor(last_mempool, mem_pool);
      if (difference.length > 0) {
        consoleLogger.info(difference)
        function fn(tx_id, cb) {
          getTransaction(tx_id, (err, tx) => {
            if (err) {
              cb(err);

              return;
            }
            let decodedTx = undefined;
            try {
              decodedTx = hex_decoder.decodeRawUTXO(tx.hex);
            } catch (e) {
              consoleLogger.error(e);
            }
            if (!decodedTx) {
              cb(undefined);

              return;
            }
            const s = new Buffer(decodedTx.outs[0].script.split(" ").pop(), 'hex').toString('utf8');
            const first_space = s.indexOf(" ");
            const label = s.substring(0, first_space);
            if (!label || label.trim() === "") {
              cb(undefined);

              return;
            }
            io.sockets.emit("tx:*", tx, decodedTx);
            io.sockets.emit(label, tx, decodedTx);
            cb(undefined);
          })
        }
        async.eachLimit(difference, 1, fn, () => {
          setTimeout(() => {
            loop();
          }, parseInt(process.env.WATCH_MEMPOOL_INTERVAL));
        })
      }
    }
    last_mempool = mem_pool;
    setTimeout(() => {
      loop();
    }, parseInt(process.env.WATCH_MEMPOOL_INTERVAL));
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

setTimeout(() => {
  loop();
}, 2000);