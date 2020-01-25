const _ = require("lodash");
const async = require("async");
const hex_decoder = require("raw-transaction-hex-decoder");
const Client = require('ssh2').Client;
const http = require('http');
const express = require('express');
const app = express();
const socket_app = http.createServer(function (req, res) {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end();
});
const io = require('socket.io').listen(socket_app);

let last_mempool = [];
const conn = new Client();
let ready = false;
conn.on('ready', function () {
  console.log('Client :: ready');
  ready = true;
}).connect({
  host: process.env.BITCOIN_NODE_HOST,
  port: parseInt(process.env.BITCOIN_NODE_PORT),
  user: process.env.BITCOIN_NODE_USER,
  privateKey: new Buffer(process.env.BITCOIN_NODE_PRIVATE_KEY, "ascii")
});

function exec(command, callback, retry) {
  if (!ready) {
    if (retry) {
      throw "Failed on retry";
    }
    setTimeout(() => {
      exec(command, callback, true);
    }, 5000);

    return;
  }
  let data = "";
  let callback_fired = false;
  conn.exec(command, (err, stream) => {
    if (err) {
      //console.log(err);
      if (!callback_fired) {
        callback_fired = true;
        callback(err);
      }
      return;
    }
    stream.on('close', function (code, signal) {
      if (code !== 0) {
        callback_fired = true;
        callback(new Error(`Exit with ${code} code and ${signal} signal`));

        return;
      }
      if (!callback_fired) {
        callback_fired = true;
        callback(undefined, JSON.parse(data));

        return;
      }
      console.log("Before fired!")
    }).on('data', function (value) {
      data += value.toString();
    }).stderr.on('data', function (data) {
      console.log('STDERR: ' + data);
      callback_fired = true;
      callback(new Error(data));
    });
  })
}

function getTransaction(tx_id, callback) {
  exec(`bitcoin-cli getrawtransaction ${tx_id} 1`, callback);
}
function loop(retry) {
  retry = retry || 0;
  exec('bitcoin-cli getrawmempool', (err, data) => {
    if (err) {
      if (retry > 3) {
        throw "Retry failed!"
      }
      setTimeout(() => {
        console.log("retry getrawmempoool");
        loop(retry++);
      }, 2000);
      return;
    }
    const mem_pool = data;
    if (last_mempool.length !== 0) {
      const difference = _.xor(last_mempool, mem_pool);
      if (difference.length > 0) {
        function fn(tx_id, cb) {
          getTransaction(tx_id, (err, tx) => {
            if (err) {
              console.log(err);
              console.log("retry");
              setTimeout(() => {
                fn(tx_id, cb)
              }, 1000);

              return;
            }
            let decodedTx = hex_decoder.decodeRawUTXO(tx.hex);
            const s = new Buffer(decodedTx.outs[0].script.split(" ").pop(), 'hex').toString('utf8');
            const first_space = s.indexOf(" ");
            const label = s.substring(0, first_space);
            if (!label || label.trim() === "") {
              cb(undefined);

              return;
            }
            io.sockets.emit(label, tx);
          })
        }
        async.eachLimit(difference, 5, fn, () => { })
      }
    }
    last_mempool = mem_pool;
    setTimeout(() => {
      loop();
    }, 100);
  })
}

io.sockets.on('connection', function (socket) {
  console.log("CLIENTS ", io.engine.clientsCount)

  socket.on('disconnect', function () {
    socket.disconnect(0);
    console.log("CLIENTS ", io.sockets.clients.length)
    console.log('User disconnected');
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
  console.log(`Socket is listening on port ${process.env.SOCKET_PORT}`);
});

app.listen(parseInt(process.env.EXPRESS_PORT), process.env.HOST, () => {
  console.log(`App is listening on port ${process.env.EXPRESS_PORT}`);
});

setTimeout(() => {
  loop();
}, 2000);