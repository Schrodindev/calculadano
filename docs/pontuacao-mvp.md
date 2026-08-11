# 👑 Como os MVPs são escolhidos

O relatório de batalha traz **duas** coisas distintas. Vale entender a diferença:

| | O que é | Como se decide |
| --- | --- | --- |
| **Os 3 MVPs** | Um destaque por categoria | Quem lidera a tabela daquela categoria |
| **Contribuição geral** | Placar de quem ajudou em mais frentes | Soma ponderada, explicada abaixo |

## Parte 1 — Os três MVPs

Simples e direto: **o primeiro lugar de cada tabela leva o troféu da categoria.**

- ⚔️ **MVP de Dano** — maior `damageDealt`
- 🛡️ **MVP de Tank** — maior `damageTanked`
- 💚 **MVP de Cura** — maior `healingDone`

Uma categoria em que ninguém pontuou aparece como vaga ("Ninguém pontuou"). O
mesmo personagem pode levar mais de um troféu.

## Parte 2 — Contribuição geral

Este é o placar que responde "quem foi mais útil no geral?". Ele existe porque
liderar uma categoria não conta a história toda: quem foi segundo em dano *e*
primeiro em tank contribuiu mais do que quem só bateu forte.

### A ideia em uma frase

> Em cada categoria monta-se um pódio. Ficar no pódio vale pontos. Categorias
> mais importantes multiplicam esses pontos. Quem somar mais, leva.

## Passo 1 — Pontos de pódio

Dentro de **cada** categoria, os três primeiros pontuam:

| Posição | Pontos |
| --- | --- |
| 🥇 1º | 5 |
| 🥈 2º | 3 |
| 🥉 3º | 1 |
| 4º em diante | 0 |

Quem tem valor zero na categoria não entra no pódio dela. Numa mesa de 3
jogadores onde só 2 causaram dano, o pódio de dano tem apenas 2 lugares.

## Passo 2 — Peso da categoria

Nem toda contribuição pesa igual:

| Categoria | Peso | Por quê |
| --- | --- | --- |
| ⚔️ **Dano causado** | **×3** | Derrubar o inimigo é o que encerra o combate |
| 🛡️ **Dano tankado** | **×2** | Segurar a linha de frente protege o grupo todo |
| 💚 **Cura** | **×1** | Utilidade que mantém a equipe de pé |

## Passo 3 — A conta

```
Pontuação = 3 × (pódio de dano)
          + 2 × (pódio de tank)
          + 1 × (pódio de cura)
```

Pontuação máxima possível: **30** (primeiro lugar nas três categorias).

### Tabela de referência

Quanto vale cada posição, já multiplicada pelo peso:

| | 🥇 1º | 🥈 2º | 🥉 3º |
| --- | --- | --- | --- |
| ⚔️ Dano (×3) | **15** | 9 | 3 |
| 🛡️ Tank (×2) | **10** | 6 | 2 |
| 💚 Cura (×1) | **5** | 3 | 1 |

## Exemplo

Combate com quatro personagens:

| Personagem | ⚔️ Dano | 🛡️ Tankado | 💚 Cura |
| --- | --- | --- | --- |
| Thorin | 145 | 210 | 0 |
| Elara | 190 | 40 | 0 |
| Sylas | 60 | 30 | 120 |
| Brann | 120 | 95 | 25 |

**Pódios:**

- Dano: 🥇 Elara (190) · 🥈 Thorin (145) · 🥉 Brann (120)
- Tank: 🥇 Thorin (210) · 🥈 Brann (95) · 🥉 Elara (40)
- Cura: 🥇 Sylas (120) · 🥈 Brann (25)

**Contas:**

| Personagem | Dano | Tank | Cura | **Total** |
| --- | --- | --- | --- | --- |
| **Thorin** | 2º → 9 | 1º → 10 | — | **19** 👑 |
| Elara | 1º → 15 | 3º → 2 | — | **17** |
| Brann | 3º → 3 | 2º → 6 | 2º → 3 | **12** |
| Sylas | — | — | 1º → 5 | **5** |

**Troféus de MVP** (parte 1, primeiro lugar de cada tabela):

- ⚔️ MVP de Dano: **Elara** (190)
- 🛡️ MVP de Tank: **Thorin** (210)
- 💚 MVP de Cura: **Sylas** (120)

**Contribuição geral** (parte 2): lidera **Thorin, com 19 pontos** — mesmo sem o
troféu de dano. Ele foi o segundo maior atacante *e* o maior tanque, e essa
combinação vale mais do que ser primeiro numa única frente.

É exatamente esse o objetivo do placar: premiar quem contribuiu em mais de uma
frente, enquanto os troféus de MVP reconhecem o melhor de cada especialidade.

## Desempate

Pontuações iguais são resolvidas nesta ordem:

1. Maior dano causado
2. Maior dano tankado
3. Maior cura
4. Ordem alfabética

## Onde isso vive no código

Em [`src/state.js`](../src/state.js):

- `PODIUM_POINTS` — o `[5, 3, 1]` do passo 1
- `CATEGORY_WEIGHTS` — os pesos `×3 / ×2 / ×1` do passo 2
- `computeMvpRanking()` — monta os pódios, aplica os pesos e ordena
- `sortByDamageDealt()` / `sortByDamageTanked()` / `sortByHealing()` — as tabelas
  de onde saem os três troféus de MVP

Em [`src/main.js`](../src/main.js):

- `mvpCardHtml()` — desenha um cartão de MVP
- `contributionSection()` — desenha o placar ponderado

Para mudar o balanceamento, altere apenas `PODIUM_POINTS` e `CATEGORY_WEIGHTS`.
Nenhuma outra parte do código assume valores específicos — o relatório lê o
detalhamento que `computeMvpRanking()` devolve.
