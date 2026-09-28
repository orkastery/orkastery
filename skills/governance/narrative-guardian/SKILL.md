---
name: narrative-guardian
description: "Auditoria de canon: confere que todo artefato publico do produto diz a mesma coisa que o codigo faz, sem numero sem origem, sem promessa de capacidade inexistente e sem metrica inventada. Roda antes de qualquer publicacao."
bucket: governance
roteia: "ork verify <thread> | ork phase list <thread>"
license: MIT
---

# Narrative Guardian

## O que esta skill e

Um roteador fino da auditoria de canon. Ela compara o que os artefatos publicos afirmam com o que
o codigo e o ledger provam. **Numero sem origem nao entra em documento publico**, e capacidade que
nao existe nao vira promessa em README.

## Quando usar

- Antes de publicar README, doc de produto, changelog, post ou pagina de marketing.
- Ao fim de toda thread que muda documentacao voltada para fora.
- Sempre que um artefato cita metrica, tempo, contagem ou comparacao.

## Como rotear

```bash
ork verify <thread>        # o que a maquina realmente prova hoje
ork phase list <thread>    # a origem de cada evidencia citada
ork master --todas         # o que ja foi fechado e pode ser citado como entregue
```

## As regras do canon

1. **Todo numero publicado tem origem colada.** Comando, saida, data. Numero de memoria nao entra.
2. **Capacidade descrita e capacidade que existe hoje.** Roadmap se escreve como roadmap, no futuro
   declarado, nunca no presente do indicativo.
3. **Metrica de tempo e cronometrada, nao estimada com otimismo.** A promessa de quinze minutos do
   quickstart vale porque o run foi executado e o registro publicado junto.
4. **Lacuna e publicada como lacuna.** `unavailable` com o motivo, nunca zero, nunca omissao.
5. **Divergencia entre doc e codigo e defeito do doc**, e vira tarefa, nao nota de rodape.

## Racionalizacoes comuns

| Desculpa | Realidade |
|---|---|
| "Uns 15 minutos, e mais ou menos isso" | Metrica de tempo e cronometrada. Numero sem origem vira promessa que o primeiro usuario desmente. |
| "Vai existir na proxima versao, ja escrevo no presente" | Capacidade descrita e capacidade que existe hoje. Roadmap escrito como presente e a mentira que matou o produto original. |
| "Deixo o campo vazio, ninguem repara" | Lacuna publicada como lacuna. Campo vazio vira zero na proxima leitura, e zero e um dado. |
| "O doc esta desatualizado, mas o codigo esta certo" | Divergencia entre doc e codigo e defeito do doc, com tarefa propria. Doc errado e o produto errado para quem le. |
| "Comparei com o concorrente de cabeca" | Comparacao publicada precisa de metodo e data. Sem isso, e propaganda com cara de dado. |
| "O time todo sabe que esse numero e aproximado" | Quem le de fora nao sabe. Aproximacao publicada declara que e aproximacao. |
| "Tiro o `unavailable`, fica feio no README" | Feio e o numero falso descoberto depois. A honestidade de medicao e parte do produto, nao um detalhe de formatacao. |
| "Isso e detalhe de marketing, nao de engenharia" | O artefato publico e superficie do produto. O canon vale igual nos dois lados. |

## Bandeiras vermelhas

- Numero em documento publico sem comando ou data ao lado.
- Verbo no presente para funcionalidade de roadmap.
- Benchmark citado sem maquina, regime e repeticao.
- Campo de metrica em branco em vez de `unavailable`.
- Changelog citando entrega sem MASTER log correspondente.

## Verificacao antes de publicar

Todo numero com origem, toda capacidade conferida contra o codigo, todo tempo cronometrado, toda
lacuna declarada, e nenhuma divergencia entre o artefato e o que o ledger prova. Ver `TEST 12`,
`PERF 9` e `PERF 10`.
