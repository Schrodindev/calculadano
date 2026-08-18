# 👑 Como o MVP é escolhido

O relatório de batalha traz **duas** coisas distintas. Vale entender a diferença:

| | O que é | Como se decide |
| --- | --- | --- |
| **Melhores de cada frente** | Um destaque por categoria | Quem lidera a tabela daquela categoria |
| **Índice de contribuição** | Nota de 0 a 100 de quem mais ajudou | Cinco pilares ponderados, explicados abaixo |

O **MVP da batalha** é quem termina no topo do índice.

## Parte 1 — Os destaques de cada frente

Simples e direto: **o primeiro lugar de cada tabela leva o troféu da categoria.**

- ⚔️ **MVP de Dano** — maior `damageDealt`
- 🛡️ **MVP de Tank** — maior `damageTanked`
- 💨 **MVP de Evasão** — mais golpes esquivados (`misses`)
- 💚 **MVP de Cura** — maior `healingDone`

Uma categoria em que ninguém pontuou aparece como vaga ("Ninguém pontuou"). O
mesmo personagem pode levar mais de um troféu.

## Parte 2 — O índice de contribuição

Este é o placar que responde "quem jogou melhor?". Ele existe porque liderar uma
categoria não conta a história toda: quem foi segundo em dano *e* esquivou de
metade dos golpes contribuiu mais do que quem só bateu forte.

### A ideia em uma frase

> Cinco pilares medem o que você fez. Em cada um você recebe uma nota comparada
> ao melhor da mesa. As notas são multiplicadas pelos pesos e somadas: o
> resultado vai de 0 a 100.

## Passo 1 — Os cinco pilares

| Pilar | O que mede | De onde vem | Peso |
| --- | --- | --- | --- |
| ⚔️ **Ofensiva** | Dano que realmente encostou no inimigo | `damageDealt` | **30** |
| 🛡️ **Muralha** | Dano que você absorveu no próprio corpo | `damageTanked` | **20** |
| 💨 **Evasão** | Dano que você anulou antes de chegar na vida | esquiva + resistência | **20** |
| 💚 **Suporte** | Vida devolvida ao grupo | `healingDone` | **15** |
| ♟️ **Eficiência** | Bateu muito sem apanhar na mesma medida | dano causado × dano levado | **15** |

Os pesos somam 100 — por isso o índice já nasce numa escala de 0 a 100. Tirar
100 significaria ser o melhor da mesa em **todos** os pilares ao mesmo tempo.

### Por que esses cinco

**Nada é contado duas vezes.** Todo ponto de dano que veio na sua direção cai em
exatamente um pilar: se encostou, é Muralha; se não encostou, é Evasão. Somados,
os dois medem toda a ameaça que o inimigo dirigiu a você.

**Muralha e Eficiência se contradizem de propósito.** Um puxa para "aguentei a
pancada pelo grupo", o outro para "bati sem apanhar". São dois jeitos legítimos
de jogar bem, e cada um tem seu caminho até o topo — o tanque não perde para o
ladino por ter feito o trabalho dele, nem o contrário.

## Passo 2 — Cada pilar vira uma nota de 0 a 1

A nota é **relativa ao melhor da mesa** naquele pilar:

```
nota = seu valor ÷ maior valor da mesa
```

Quem lidera tira 1,0. Quem fez metade do que o líder fez tira 0,5. Isso é o que
mantém o índice justo em qualquer campanha: o que conta é o desempenho
comparado ao grupo, não o número absoluto de dano — 400 de dano é enorme no
nível 3 e modesto no nível 15.

### Os dois pilares compostos

**💨 Evasão** mistura duas medidas, 70% da primeira e 30% da segunda:

| Componente | O que é |
| --- | --- |
| **Dano anulado** (70%) | `damageMitigated + damageDodged` |
| **Golpes evitados** (30%) | `misses` |

Os dois existem porque nem toda mesa anota a rolagem de um ataque que errou. Se
só contasse o dano evitado, o mestre que digita `0` num erro zeraria a esquiva do
jogador. Se só contasse a quantidade, esquivar de um tapinha valeria o mesmo que
esquivar de uma bola de fogo.

**♟️ Eficiência** é a qualidade da troca, ponderada pelo volume:

```
eficiência = (dano causado ÷ (dano causado + dano levado)) × nota de ofensiva
```

A primeira parte vai de 0 a 1: bater 100 sem levar nada dá 1,0; levar tanto
quanto bateu dá 0,5. A segunda parte é o pedágio contra o carona — quem causou
5 de dano e não apanhou tem troca perfeita, mas com volume quase zero. Ficar
escondido atrás do tanque não vira MVP.

## Passo 3 — Pilares vazios saem da conta

**Um pilar em que ninguém pontuou é removido, e seu peso é redistribuído entre
os que sobraram.**

É a regra que resolve o "nem todo grupo tem curandeiro". Numa mesa sem cura,
ninguém carrega 15 pontos mortos que jamais poderia ganhar — os pesos viram:

| Pilar | Peso normal | Numa mesa sem cura |
| --- | --- | --- |
| ⚔️ Ofensiva | 30 | **35,3** |
| 🛡️ Muralha | 20 | **23,5** |
| 💨 Evasão | 20 | **23,5** |
| 💚 Suporte | 15 | — |
| ♟️ Eficiência | 15 | **17,6** |

O relatório mostra os pesos que **de fato** valeram naquela batalha, embaixo da
tabela, e avisa quantos pilares saíram.

## Passo 4 — A conta

```
Índice = Σ (nota do pilar × peso efetivo do pilar)
```

## Exemplo

Combate com quatro personagens:

| Personagem | ⚔️ Dano | 🛡️ Tankado | ½ Mitigado | 🚫 Evitado | 💨 Esquivas | 💚 Cura |
| --- | --- | --- | --- | --- | --- | --- |
| Thorin | 145 | 210 | 40 | 30 | 2 | 0 |
| Elara | 190 | 40 | 0 | 60 | 3 | 0 |
| Sylas | 60 | 30 | 0 | 0 | 0 | 120 |
| Brann | 120 | 95 | 20 | 0 | 0 | 25 |

**Notas por pilar** (cada coluna dividida pelo maior da coluna):

| Personagem | ⚔️ Ofensiva | 🛡️ Muralha | 💨 Evasão | 💚 Suporte | ♟️ Eficiência |
| --- | --- | --- | --- | --- | --- |
| Thorin | 0,76 | **1,00** | **1,00** | 0 | 0,38 |
| Elara | **1,00** | 0,19 | **1,00** | 0 | **1,00** |
| Sylas | 0,32 | 0,14 | 0 | **1,00** | 0,25 |
| Brann | 0,63 | 0,45 | 0,22 | 0,21 | 0,43 |

**Índice final:**

| Personagem | ⚔️ | 🛡️ | 💨 | 💚 | ♟️ | **Total** |
| --- | --- | --- | --- | --- | --- | --- |
| **Elara** | 30,0 | 3,8 | 20,0 | — | 15,0 | **68,8** 👑 |
| Thorin | 22,9 | 20,0 | 20,0 | — | 5,7 | **68,6** |
| Brann | 18,9 | 9,0 | 4,4 | 3,1 | 6,4 | **42,0** |
| Sylas | 9,5 | 2,9 | — | 15,0 | 3,8 | **31,2** |

**Troféus** (parte 1, primeiro lugar de cada tabela):

- ⚔️ MVP de Dano: **Elara** (190)
- 🛡️ MVP de Tank: **Thorin** (210)
- 💨 MVP de Evasão: **Elara** (3 esquivas)
- 💚 MVP de Cura: **Sylas** (120)

**MVP da batalha:** **Elara, com 68,8** — por dois décimos de ponto. Ela bateu
mais que todo mundo e saiu quase ilesa; Thorin comeu a pancada inteira do grupo
e devolveu bem. Os dois jogaram muito, de jeitos opostos, e o índice reflete
exatamente isso: o desempate veio da eficiência da troca.

E repare em Sylas: sozinho no pilar de cura, tirou os 15 pontos cheios de
Suporte. Mesmo assim ficou por último — utilidade é ponto, não passe livre.

## Desempate

Índices iguais são resolvidos nesta ordem:

1. Maior dano causado
2. Maior ameaça enfrentada (tankado + mitigado + evitado)
3. Maior cura
4. Ordem alfabética

## Onde isso vive no código

Em [`src/state.js`](../src/state.js):

- `MVP_PILLARS` — os cinco pilares e seus pesos
- `EVASION_DAMAGE_SHARE` — o 70/30 dentro do pilar de Evasão
- `computeMvpRanking()` — calcula as notas, derruba pilares vazios, redistribui
  os pesos e ordena. Devolve `{ ranking, pillars }`
- `sortByDamageDealt()` / `sortByDamageTanked()` / `sortByEvasion()` /
  `sortByHealing()` — as tabelas de onde saem os quatro troféus

Em [`src/main.js`](../src/main.js):

- `mvpCardHtml()` — desenha um troféu de categoria
- `mvpBannerHtml()` — desenha a faixa do MVP da batalha
- `contributionSection()` — desenha a tabela do índice

Para mudar o balanceamento, altere apenas os `weight` de `MVP_PILLARS`. Eles não
precisam somar 100: o código normaliza os pilares ativos, então a proporção
entre eles é a única coisa que importa. Nenhuma outra parte do código assume
valores específicos — o relatório lê o detalhamento que `computeMvpRanking()`
devolve.
