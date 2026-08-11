# ⚔️ Contador de Dano & Iniciativa — Extensão Owlbear Rodeo

Painel de combate sincronizado para toda a mesa: ordem de iniciativa, contagem
de rodadas, foco automático de câmera e ranking de **dano causado**, **dano
tankado** e **cura** — coroando um MVP ponderado no fim da batalha.

## Estrutura

```
danocontador/
├── index.html            Painel (popover) — UI em 4 abas + CSS dark RPG embutido
├── background.html       Página invisível que registra o menu de contexto
├── vite.config.js        Build com duas entradas (popover + background)
├── docs/
│   └── pontuacao-mvp.md  Como o MVP é calculado
├── src/
│   ├── main.js           Lógica do painel: render, turnos, dano, câmera
│   ├── background.js     Menu de contexto do token (clique direito)
│   └── state.js          Estado compartilhado na metadata da sala
└── public/
    ├── manifest.json     Manifesto da extensão (action 420x550)
    ├── icon.svg          Ícone da barra de ferramentas
    ├── sword.svg         Ícone do menu "Adicionar Dano"
    └── plus.svg          Ícone do menu "Adicionar à Iniciativa"
```

## Rodando localmente

```bash
npm install
npm run dev
```

O Vite sobe em `http://localhost:5173`. Para carregar na sua sala:

1. Abra uma sala no Owlbear Rodeo.
2. Menu **Extensions → Add Custom Extension**.
3. Cole `http://localhost:5173/manifest.json`.

> O Owlbear carrega a extensão dentro de um `<iframe>`. Se o navegador bloquear
> conteúdo misto (site em HTTPS carregando `localhost` em HTTP), use
> `npm run build && npm run preview`, ou exponha via túnel HTTPS.

## Deploy na Vercel

```bash
npm run build     # gera dist/
```

Na Vercel, importe o repositório. O preset **Vite** é detectado automaticamente
(_Build Command_ `npm run build`, _Output Directory_ `dist`). Depois do deploy,
o manifesto fica em:

```
https://<seu-projeto>.vercel.app/manifest.json
```

É essa URL que você cola em **Add Custom Extension**.

## Como funciona

### Sincronização

Todo o estado vive na metadata da sala, sob a chave `extensao-combat/room-state`:

```json
{
  "round": 1,
  "activeTokenId": "id-do-token-atual",
  "combatants": [
    {
      "id": "token-id-1",
      "name": "Thorin",
      "initiative": 18,
      "damageDealt": 145,
      "damageTanked": 80,
      "healingDone": 0,
      "isGMOnly": false,
      "hp": null,
      "ac": null
    },
    {
      "id": "token-id-2",
      "name": "Ogro das Cavernas",
      "initiative": 12,
      "damageDealt": 80,
      "damageTanked": 145,
      "healingDone": 0,
      "isGMOnly": true,
      "hp": { "current": 32, "max": 60 },
      "ac": { "value": 16, "visible": false }
    }
  ]
}
```

`hp: null` significa "sem controle de vida" — o caso da maioria dos heróis.
`ac: null` significa "CA não anotada"; `visible: false` é a CA que só o mestre vê.

`OBR.room.onMetadataChange` re-renderiza o painel de todo mundo a cada escrita.
A metadata da sala tem limite de **16 kB**, então o estado é normalizado antes
de gravar (máx. 60 combatentes, nomes truncados em 40 caracteres).

### Privacidade GM × Player

`OBR.player.getRole()` decide o que aparece. Combatentes com `isGMOnly: true`
são removidos da lista para quem é `PLAYER` — some da iniciativa e de todos os
rankings. O mestre vê os mesmos combatentes com o selo `🕵️ OCULTO`.

Quando é a vez de um token oculto, o jogador vê `??? (oculto)` no cabeçalho:
ele sabe que não é o turno dele sem descobrir qual monstro está em campo.

> **Limitação honesta:** a metadata da sala é sincronizada para todos os
> clientes — é assim que o Owlbear funciona, não existe armazenamento exclusivo
> do mestre. Os filtros acima escondem a informação na **interface**, o que
> resolve o problema real (spoiler acidental). Um jogador determinado, abrindo o
> console do navegador, conseguiria ler `OBR.room.getMetadata()`. Trate como
> cortina, não como cofre.

### Controle de vida dos monstros

A aba **❤️ Vida** monitora pontos de vida, e a entrada nela é **sempre manual**:
o mestre escolhe quem, da lista de iniciativa, passa a ser monitorado. Entrar na
iniciativa não coloca ninguém aqui automaticamente — se colocasse, os heróis
viriam junto com os monstros.

O que cada papel vê:

| | Mestre | Jogador |
| --- | --- | --- |
| Números | `32 / 60` | — |
| Estado | — | 💛 Ferido |
| Barra | posição real | preenche até o teto da faixa |
| Ajuste rápido | −10 −5 −1 / +1 +5 +10 | — |
| CA | sempre | só depois de revelada |

As faixas de estado (`HP_STATUSES` em [`src/state.js`](src/state.js)):

| Vida restante | Estado |
| --- | --- |
| 67–100% | 💚 Vivo |
| 34–66% | 💛 Ferido |
| 1–33% | ❤️ Quase morrendo |
| 0% | 💀 Abatido |

A barra do jogador vai até o **teto da faixa**, nunca até a porcentagem real —
assim ela não vaza a vida exata e nunca contradiz o rótulo.

O dano lançado pelo diálogo desconta automaticamente da vida de quem estiver
sendo monitorado, na mesma escrita que atualiza as estatísticas. Cura devolve
vida ao alvo (o mérito, esse, fica só com quem curou).

### Classe de Armadura

A CA fica no mesmo card da vida e é anotada de dois jeitos: pelo campo
**CA (opcional)** ao colocar o monstro no controle de vida, ou pelo botão
**🛡️ Definir CA** no próprio card.

Ela **nasce oculta para os jogadores** — descobrir a defesa do monstro errando
ataques faz parte da mesa. O card do mestre mostra o selo tracejado
`🛡️ CA 16 🙈` justamente para deixar claro que aquele número ainda é segredo;
o card do jogador não mostra nada, nem um espaço vazio.

Quando o mestre quiser abrir o jogo, o botão **👁️ Mostrar aos jogadores** muda
`ac.visible` para `true` e o selo aparece para todo mundo, em azul sólido. O
mesmo botão vira **🙈 Ocultar dos jogadores** e fecha a cortina de novo.

Editar o número de uma CA já revelada **mantém** a revelação — corrigir um valor
não deveria escondê-lo sem ninguém pedir. Apagar o campo no diálogo de edição
remove a CA. `resetCombat` preserva número e revelação: a CA descreve o monstro,
não o andamento da luta.

### Ações exclusivas do mestre

**🔄 Resetar Combate** e **🏁 Finalizar Combate** vivem dentro do bloco
`#gm-controls`, que fica `hidden` para quem é `PLAYER` — nem aparecem na tela.
Além disso, `handleReset`, `openEndDialog`, `handleEndCombat` e todas as ações
de CA passam por `requireGM()` antes de escrever qualquer coisa, cobrindo o caso
de um papel rebaixado no meio da sessão.

### Lançamento duplo de dano

Uma única ação incrementa `damageDealt` do atacante **e** `damageTanked` da
vítima, numa só escrita na metadata. Qualquer um dos dois lados pode ser
omitido (dano ambiental, queda, dano em si próprio).

Valores negativos são aceitos como correção — os contadores nunca passam de 0
para baixo.

### Menu de contexto

Clique direito num token da camada `CHARACTER`:

- **⚔️ Adicionar Dano ao Token** — grava o token como alvo pendente e abre o
  painel com a vítima já selecionada.
- **➕ Adicionar à Iniciativa** _(só mestre)_ — entra no combate com iniciativa
  10, ajustável pelo ✏️ no card.

## Desvios da especificação original

Dois pontos do pedido não existem na API real do SDK e foram implementados de
outra forma:

**1. `OBR.action.create()` não existe.** A `ActionApi` só expõe
`getWidth/setWidth`, `getHeight/setHeight`, `getIcon/setIcon`,
`getTitle/setTitle`, `getBadgeText/setBadgeText`, `open`, `close`, `isOpen` e
`onOpenChange`. O botão da barra de ferramentas é declarado no
`manifest.json`, no campo `action` — é lá que ficam `width: 420` e
`height: 550`. O `main.js` reforça as dimensões em runtime com
`OBR.action.setWidth/setHeight`.

**2. `animateTo({ position, zoom })` tem assinatura diferente.** O tipo real é
`ViewportTransform = { position: Vector2, scale: number }` — não existe campo
`zoom`, e `position` é o deslocamento do *viewport*, não a posição do token no
mundo. Passar `token.position` direto joga a câmera para o lugar errado.

O caminho documentado para enquadrar algo é `animateToBounds()`, que recebe uma
caixa em coordenadas de mundo. `focusOnToken()` monta uma caixa centrada no
token (via `OBR.scene.items.getItemBounds`) com tamanho equivalente à tela
dividida pelo zoom desejado, atingindo o mesmo efeito de forma confiável.

## APIs do SDK usadas

| API | Uso |
| --- | --- |
| `OBR.onReady` | Bootstrap das duas páginas |
| `OBR.room.getMetadata / setMetadata / onMetadataChange` | Estado sincronizado |
| `OBR.player.getRole / onChange` | Filtro de privacidade GM × Player |
| `OBR.player.getSelection` | Adicionar tokens selecionados |
| `OBR.player.getMetadata / setMetadata` | Alvo pendente do menu de contexto |
| `OBR.scene.isReady` | Guarda contra sala sem cena aberta |
| `OBR.scene.items.getItems / getItemBounds` | Ler tokens e enquadrar câmera |
| `OBR.viewport.animateToBounds / getWidth / getHeight` | Auto-focus no turno |
| `OBR.contextMenu.create` | Menu do clique direito |
| `OBR.action.setWidth / setHeight / open / onOpenChange` | Painel |
| `OBR.notification.show` | Feedback de erro e sucesso |
