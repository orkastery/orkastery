# Design do Orkastery: a Partitura

> **Em uma frase:** o design system, a marca, a voz e os componentes visuais do Orkastery, numa pasta só, para toda sessão (humana ou de agente) que criar ou alterar UI, design, frontend, componentes visuais ou layout.

## Quem lê e quando

Leia antes de mexer em qualquer superfície visual do Orkastery: os sites (`orkastery/orkastery.com` e `orkastery/orkmind.com`), os mods do Claude Code (`adapters/claude-code/mods/`), o painel, o terminal desenhado, as imagens de README e de redes sociais e qualquer componente novo. Sem exceção para "só um ajuste".

## Ordem de leitura

1. [`DESIGN.md`](DESIGN.md): as regras para gerar UI on-brand (tokens, tipografia, forma, movimento, regras duras, voz, componentes, responsividade e o checklist de entrega). **Em conflito, ele vence** qualquer `tokens.css` legado.
2. [`CLAUDE.md`](CLAUDE.md): os acertos que vieram depois do brief (tokens aprovados a mais, termos permitidos e proibidos, o formato do manual).
3. [`revisao-de-copy.md`](revisao-de-copy.md): as trocas de texto já mapeadas, arquivo por arquivo, e o que ainda é decisão do dono.
4. Os tokens, sempre por `var(--…)`: [`partitura/partitura.css`](partitura/partitura.css) e a fonte em JSON [`partitura/partitura.json`](partitura/partitura.json).
5. As referências visuais, abertas no navegador:
   - `Partitura Componentes.dc.html`: cada componente com os estados obrigatórios;
   - `Manual de Marca.dc.html` (e a versão para impressão, `Manual de Marca-print.dc.html`);
   - `Brand Kit.dc.html`, `Brand Kit EN.dc.html` e `Brand Kit Templates.dc.html`;
   - `Diretrizes Rapidas.dc.html`: o resumo de uma página.

   Elas usam `doc-page.js` e `support.js`, desta mesma pasta.

## O que está aqui

| Caminho | Conteúdo |
| --- | --- |
| `partitura/` | tokens da Partitura em CSS e em JSON |
| `marca/svg/` | símbolo, nome, assinatura e ícones, com as variantes `-fundo-claro` |
| `marca/png/` | as mesmas peças em PNG, favicons e o avatar do GitHub |
| `marca/templates/` | capa de deck, banner do GitHub, imagem OG e imagem social |
| `*.dc.html` | manual, brand kit, componentes e diretrizes, gerados no Claude Design |
| `github.md` | o mapa entre as telas do Claude Design e os arquivos dos sites |

A pasta `docs/assets/marca/` é a marca anterior. A marca vigente é a de `marca/`, já com as cores da Partitura.

## Regras que não se negociam

- Só `var(--…)` da Partitura; nenhum hex solto em componente.
- O latão aparece só no que espera o dono (pontos de HITL); a exceção única é a borda de luz do comando de instalação.
- Estado nunca só pela cor: sempre rótulo e, quando cabe, forma.
- Contraste de texto de pelo menos 4,5:1 nos dois temas, foco visível e alvos de toque de pelo menos 44 × 44 px.
- Todo número vem com o comando que o prova; lacuna aparece como lacuna.
- Comando, caminho e identificador técnico sempre como código, inteiro, sem quebrar no meio da linha.
- Idiomas: só PT-BR (em `/`) e inglês (em `/en/`), como manda o `DESIGN.md`. O espanhol saiu dos sites por decisão do dono em 12/10/2026; os endereços antigos em `/es/` redirecionam para o equivalente em inglês.

## OrkMind

O site do OrkMind segue a mesma Partitura (estrutura de tokens, regras, tipografia, movimento e voz), com narrativa, textos e paleta próprios, derivados pelo mesmo método.
