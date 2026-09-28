# Diagramas do Orkastery

Seis diagramas em SVG, todos autocontidos (sem fonte externa, sem script, sem CSS embutido),
desenhados para renderizar direto no GitHub e para funcionar em tema claro e escuro, porque
cada um pinta o próprio fundo.

Eles ilustram o processo. Nenhum deles precisa de legenda extra para ser entendido, e nenhum
descreve feature que não existe: o que está planejado aparece marcado como planejado.

| Diagrama | Responde |
| --- | --- |
| [`arquitetura-3-camadas.svg`](arquitetura-3-camadas.svg) | onde cada coisa mora, e por que o núcleo não tem LLM dentro |
| [`ciclo-de-thread.svg`](ciclo-de-thread.svg) | as 6 fases e a prova que o núcleo cobra em cada fronteira |
| [`espectro-de-modos.svg`](espectro-de-modos.svg) | os 5 modos de condução e onde cada um para para o humano |
| [`gate-de-tokens-e-handoff.svg`](gate-de-tokens-e-handoff.svg) | como o contexto atravessa a rotação de sessão sem virar cópia |
| [`paralelismo-e-leases.svg`](paralelismo-e-leases.svg) | por que N threads em paralelo não colidem |
| [`auditores-e-hardening.svg`](auditores-e-hardening.svg) | como a exigência sobe junto com o estágio do produto |

## Fonte de verdade

Dois deles desenham a matriz de modos e por isso têm uma fonte de verdade executável:
`ciclo-de-thread.svg` (que ilustra o `#Classic`, o modo padrão) e `espectro-de-modos.svg`.
Antes de editar qualquer um dos dois, rode o comando e confira bloco a bloco:

```bash
cd core && npm run build && node dist/index.js modos
```

Hoje a matriz viva é `#Classic` 4 blocos / 3 pausas, `#Maestro` 3/1 e `#Auto` 1/0, com
`conduction.default_mode: classic`. Se o comando divergir do desenho, quem está errado é o
desenho.

`#Look` e `#Ork` foram aposentados pela I-43 e saíram do espectro desenhado. A matriz do
código mantém a definição dos dois, porque thread antiga neles ainda abre; o que encolheu foi
a lista de escrita (`ORDEM_DOS_MODOS`), e é ela que `ork modos` imprime.

## Identidade visual

| Papel | Cor | Uso |
| --- | --- | --- |
| fundo | `#0F1520` | o painel inteiro |
| superfície | `#18202E`, `#141E2D`, `#111A28` | painéis, cartões e caixas |
| borda | `#2B3A50`, `#33415C` | contorno neutro |
| texto | `#E6EDF7`, `#C9D8EC`, `#8FA3BE`, `#54688A` | título, corpo, apoio e rodapé |
| âmbar | `#F2A03D` | o humano, a pausa, o núcleo `ork` |
| ciano | `#4FB6E8` | a entrada, os hosts, os rótulos de seção |
| verde | `#45C08A` | o que segue sozinho, a orquestra, o determinismo |
| vermelho | `#E8615B` | o limite duro (`force_rotate_above`) |

Tipografia por atributo de apresentação, sempre terminando em família genérica, para que o
render não dependa de fonte instalada:

```text
sans  ui-sans-serif, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif
mono  ui-monospace, SFMono-Regular, Menlo, Consolas, monospace
```

## Como editar

Os arquivos são SVG puro, editáveis à mão. Ao mudar qualquer um deles, confira que o XML
continua válido antes de commitar:

```bash
python3 -c "import xml.dom.minidom,glob; [xml.dom.minidom.parse(f) for f in glob.glob('docs/conceitos/diagramas/*.svg')]; print('XML valido')"
```

Duas regras que mantêm o conjunto coerente:

1. **Nada de `<style>` nem CSS externo.** Cor, fonte e tamanho vão em atributo de apresentação
   no próprio elemento. Alguns renderizadores de markdown removem blocos de estilo dentro de SVG.
2. **Nada de texto que só cabe numa fonte específica.** Deixe folga na caixa: a mesma string
   ocupa larguras diferentes em Segoe UI, Roboto e DejaVu Sans.
