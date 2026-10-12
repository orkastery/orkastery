# DESIGN.md · Partitura (Orkastery)

Regras para agentes de IA gerarem UI on-brand da Orkastery. Leia tudo antes de gerar. Em conflito, este arquivo vence o `tokens.css` legado do repositório.

## 1. Em uma frase
Uma partitura: dezenas de threads numa página que se lê de relance. Chão calmo, estado legível, **um acento só (latão) para o que espera você**.

## 2. Tokens
Importe `partitura/partitura.css` e use só `var(--…)`. Nunca escreva hex soltos em componente. Fonte JSON: `partitura/partitura.json`.

### Cor · primitivos
| token | hex | uso |
| --- | --- | --- |
| `--nevoa` | #EEF0F2 | chão (dia) |
| `--papel` | #FFFFFF | cartões (dia) |
| `--trilho` | #E3E6EA | linhas (dia) |
| `--tinta` / `--tinta-2` / `--tinta-3` | #12161C / #454C56 / #5F6670 | texto, apoio, rótulo |
| `--noite` / `--noite-2` / `--noite-3` | #0D1015 / #161A21 / #232831 | chão, cartão, linha (noite) |
| `--luar` / `--luar-2` | #E9ECEF / #A7AEB8 | texto, apoio (noite) |
| `--latao` / `--latao-tinta` | #E0B264 / #8A5F17 | **espera você, ponto de HITL** |
| `--regencia` / `--regencia-tinta` | #4F78B8 / #3D639F | executando |
| `--patina` / `--patina-tinta` | #3C9A86 / #1F6B5C | verificado |
| `--brasa` / `--brasa-tinta` | #D9673F / #A8461F | falha, GO-FIX |

### Cor · semânticos (use estes em componentes)
`--chao --superficie --superficie-2 --linha --linha-forte --texto --texto-2 --texto-3 --acao --sobre-acao --campo`
`--espera --espera-texto --executando --executando-texto --verificado --verificado-texto --falha --falha-texto`
`--foco --anel-foco --sombra-1 --sombra-2 --sombra-3 --luz-latao`

Tema: `data-tema="noite"` em qualquer ancestral. Sem atributo = dia.

### Proporção de uso
névoa 58% · papel 18% · tinta 14% · trilho 6% · estados 3% · latão ≤ 1%.

### Tipografia
- Títulos: **Geist 600**, letter-spacing negativo (−0,01 a −0,035em).
- Texto: **Hanken Grotesk 400/500**, corpo 17px / 1,5.
- Prova: **IBM Plex Mono 400/500** para comandos, SHAs, horários, rótulos (caixa alta, +0,06em) e números de prova.
- Proibido: Bricolage, Fraunces, Inter, Roboto.
- Escala: `--t-display --t-titulo-1 --t-titulo-2 --t-titulo-3 --t-corpo --t-apoio --t-rotulo --t-codigo`.

### Forma
- Raio: `--raio-segmento` 3 · `--raio-chip` 7 · `--raio-botao` 12 · `--raio-cartao` 18 · `--raio-palco` 24.
- Espaço base 4: `--e-1` 4 … `--e-9` 96. Calha `--calha`, largura máx. `--largura` 1280px.
- Separe por **linha** antes de separar por sombra. Sombras frias, quase invisíveis.

### Movimento: andante, nunca allegro
- Curva `--curva` cubic-bezier(.16,1,.3,1). Durações `--dur-curta` 160, `--dur-media` 280, `--dur-longa` 600ms.
- Pulso de 2,8s **só no que está vivo** (executando, ponto de HITL aberto).
- Efeitos aprovados: partitura animada de roadmaps, linhas de fluxo tracejadas, brilho que segue o cursor, borda de luz em latão no CTA, entrada suave ao rolar.
- Sempre respeite `prefers-reduced-motion` (o CSS já zera durações).

## 3. Regras duras
1. Latão aparece **somente** em "espera você" e pontos de HITL. Exceção única: borda de luz (`--luz-latao`) no comando de instalação.
2. Estado **nunca só pela cor**: sempre rótulo; quando cabe, forma (✓, ×, tracejado, pulso).
3. Texto ≥ 4,5:1. Texto de estado no dia usa `--*-texto`. No noite, "executando" escreve em luar (regência não passa como texto).
4. Foco visível em todo interativo: `box-shadow: var(--anel-foco)`. Nunca `outline: none` sem substituto.
5. Alvo de toque ≥ 44 × 44px.
6. Bloco de código e comando copiável são sempre noite, nos dois temas.
7. Sem fotografia, sem robôs, cérebros, gradiente neon ou dado inventado. Imagem = saída real de terminal, recortes do board, diagramas.
8. Logo: use os arquivos de `marca/svg` (`-fundo-claro` no dia). Nunca recolorir, distorcer, girar, aplicar efeito ou recompor. Mínimo: símbolo 16px, assinatura 120px.

## 4. Voz
- Arco de cada página: **dor → calma → prova**.
- Frases curtas, verbos concretos. Todo número vem com o comando que o prova. Lacunas aparecem como lacunas ("não existe", "planejado").
- Vocabulário: plataforma, thread, fase, claim, maestro, autonomia, HITL.
- Proibidos: "afrouxar", "batuta", "metrônomo", Bernstein, "pausa" no sentido de HITL (diga "ponto de HITL: decidir ou aprovar"), "disruptivo", frases que desvalorizem velocidade.
- Tom: sereno e preciso. Velocidade e escala são valores centrais.
- Idiomas: PT-BR em `/`, inglês em `/en/`. Slugs e IDs técnicos iguais nas duas línguas.
- Frases aprovadas:
  - "Conduza 20 roadmaps com a calma de quem conduz um."
  - "Uma camada rege todos os seus runtimes, em todas as suas máquinas."
  - "As decisões simples, a Orkastery toma por você. Você decide só o que importa."
  - "O modo ajusta a autonomia. A verificação é sempre a mesma."
  - "Maestria é construir mais, e mais rápido, com qualidade no produto e na vida de quem conduz."

## 5. Componentes (referência: `Partitura Componentes.dc.html`)
Estados obrigatórios: padrão, hover, foco, ativo, desabilitado, carregando, erro, vazio.

- **Botão**: altura 44, raio 12, Hanken 500 15px. Primário `--acao`/`--sobre-acao`; secundário borda `--linha-forte`; fantasma transparente; perigo borda `--falha` e texto `--falha-texto`. Desabilitado muda contorno (tracejado) e cursor.
- **Comando copiável**: fundo `--noite-2`, `--luz-latao`, prompt `$` em luar-2, botão "copiar" → "✓ copiado" por 1,6s; erro "× use ⌘C".
- **Chip de estado**: altura 28, raio 7, mono 12, ponto de 7px + rótulo. Rótulos: espera você · executando · verificado · falha · pendente.
- **Barra de 6 fases**: GOAL PLAN GO CHECK SHIP MASTER; segmento 6px raio 3; glifo no rótulo (✓ … ● × ·); `aria-label` com o estado de cada fase.
- **Pergunta a–d**: até 5 por lote; opção recomendada marcada com ponto latão + "recomendada"; a selecionada tem borda `--texto` 1,5px.
- **Resumo horário**: pendentes, urgentes, bloqueiam, críticos + fuso declarado + "Posso enviar agora?". Vazio: "Nada espera você."
- **Número de prova**: número em Geist 600 + rótulo + comando mono. Lacuna: "—", borda tracejada, "planejado · RM-xxx".
- **Evento do ledger**: hora mono, ponto de estado, tipo mono (`claim.verificada`, `gate.falhou`…), mensagem.
- **Ork board**: tabela com thead mono caixa alta; linha selecionada com marca `inset 2px 0 0 var(--texto)`; abaixo de 768px vira lista de cartões.
- **Matriz de modos**: #Classic (3 pontos de HITL), #Maestro (1), #Auto (0), #Fast (0, só GO). Ponto de HITL = ponto latão no fim do bloco.
- **Topologia / diagramas**: nós raio 7 com rótulo mono; instrução = tracejado regência (anima 2,8s); evidência = contínuo pátina; latão só no "você".
- **Separador**: linha que se dissolve nas pontas, ponto latão de 7px no centro.

## 6. Responsividade
390 (4 col, calha 20) · 768 (8 col, calha 32) · 1280 (12 col, calha 48) · 1440 (conteúdo para em 1280 e centraliza).

## 7. Exemplo
```html
<link rel="stylesheet" href="/partitura/partitura.css">
<section data-tema="noite" style="background:var(--chao);color:var(--texto);padding:var(--e-8) var(--calha)">
  <h1 style="font:600 var(--t-display)/1 var(--f-titulo);letter-spacing:-.035em">Conduza 20 roadmaps com a calma de quem conduz um.</h1>
  <div style="display:inline-flex;align-items:center;gap:var(--e-3);padding:6px 6px 6px 18px;border-radius:var(--raio-botao);background:var(--noite-2);box-shadow:var(--luz-latao)">
    <code style="font:400 15px var(--f-mono);color:var(--luar)"><span style="color:var(--luar-2)">$ </span>npm install -g @orkastery/cli</code>
    <button style="height:36px;border-radius:9px;font:12px var(--f-mono)">copiar</button>
  </div>
  <span style="display:inline-flex;align-items:center;gap:7px;height:28px;padding:0 10px;border-radius:var(--raio-chip);border:1px solid var(--linha);font:12px var(--f-mono);color:var(--verificado-texto)">
    <span style="width:7px;height:7px;border-radius:50%;background:var(--verificado)"></span>verificado
  </span>
</section>
```

## 8. Checklist antes de entregar
- [ ] Só `var(--…)` da Partitura; nenhum hex solto.
- [ ] Latão só em espera você / HITL / CTA de instalação.
- [ ] Todo estado tem rótulo.
- [ ] Contraste ≥ 4,5:1 em texto, nos dois temas.
- [ ] Foco visível; alvos ≥ 44px.
- [ ] Todo número tem o comando que o prova.
- [ ] Nenhum termo proibido.
- [ ] Testado em 390, 768, 1280 e 1440.
