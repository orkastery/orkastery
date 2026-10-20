const express = require('express');
const { exec } = require('node:child_process');
const _ = require('lodash');

const app = express();

app.get('/ls', function (req, res) {
  // Command injection: user input reaches a shell.
  exec('ls ' + req.query.dir, (err, out) => res.send(_.escape(out)));
});

app.get('/calc', function (req, res) {
  // Code injection: user input reaches eval.
  res.send(String(eval(req.query.expr)));
});

app.listen(8080);
