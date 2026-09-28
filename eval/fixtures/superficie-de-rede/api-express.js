// Fixture DELIBERADAMENTE vulneravel: a superficie de rede que o pack security-privacy
// (SP8..SP12) precisa enxergar. Nao e codigo de producao e nao entra em nenhum build.
const express = require('express');
const cors = require('cors');

const app = express();

// SP11: origem global com credenciais, num servico que serve rota de usuario.
app.use(cors({ origin: '*', credentials: true }));

// SP9: console de administracao publicado sem restricao de rede nem oAuth.
app.get('/admin/usuarios', (req, res) => {
  res.json(listarUsuarios());
});

// SP9: documentacao de API aberta, que entrega o mapa inteiro da superficie.
app.get('/swagger.json', (req, res) => res.json(especificacao()));

// SP8 + SP12: rota de dado pessoal sem guarda e sem esquema de entrada.
app.post('/usuarios/:id/endereco', (req, res) => {
  salvarEndereco(req.params.id, req.body);
  res.status(204).end();
});

// SP10: caminho classico de forca bruta, sem limite de taxa.
app.post('/login', (req, res) => {
  res.json(autenticar(req.body.email, req.body.senha));
});

app.listen(3000);
