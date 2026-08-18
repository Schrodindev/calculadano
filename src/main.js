import OBR from "@owlbear-rodeo/sdk";
import {
  CHANNEL_BATTLE_REPORT,
  METADATA_KEY,
  adjustHp,
  advanceTurn,
  applyAttack,
  applyHealing,
  clearAc,
  computeMvpRanking,
  damageFaced,
  hpStatus,
  previewAttack,
  setAc,
  setAcVisibility,
  trackHp,
  trackedCombatants,
  untrackHp,
  consumePendingTarget,
  createCombatant,
  createEmptyState,
  endCombat,
  focusOnToken,
  mutateState,
  normalizeState,
  readState,
  remainingSlots,
  resetCombat,
  resolveTokenName,
  sortByDamageDealt,
  sortByDamageTanked,
  sortByEvasion,
  sortByHealing,
  sortByInitiative,
  syncCombatantNames,
  visibleAc,
  visibleTo,
} from "./state.js";

/* ========================================================================== */
/* Estado local da UI                                                         */
/* ========================================================================== */

/** Ultimo estado recebido da sala. */
let state = createEmptyState();

/** "GM" ou "PLAYER" — define o que a UI mostra e quais controles libera. */
let role = "PLAYER";

/** Aba visivel no momento. */
let activeTab = "initiative";

/** Zoom aplicado ao focar a camera no token da vez. */
const FOCUS_ZOOM = 1;

/**
 * Vira true quando o usuario mexe no select de atacante. A partir dai paramos
 * de sugerir "quem esta no turno", para nao desfazer a escolha dele a cada
 * sincronizacao da sala.
 */
let attackerTouched = false;

/** Modo do diálogo: "damage" ou "heal". */
let dialogMode = "damage";

/**
 * Alvos escolhidos no diálogo — mais de um porque dano e cura podem ser em área.
 * Cada item: `{ id, resistant, missed }`.
 *
 * As marcações são POR LANÇAMENTO, e não uma propriedade fixa do combatente:
 * resistência em RPG é por tipo de dano (o elemental resiste ao fogo e apanha
 * do machado), e errar é um evento daquele ataque.
 */
let dialogTargets = [];

const $ = (id) => document.getElementById(id);

/**
 * Trava de mestre para as acoes que so ele pode disparar (resetar, finalizar,
 * mexer na CA). A UI ja esconde esses botoes de quem e PLAYER; esta checagem
 * fecha o resto: um papel rebaixado no meio da sessao, ou um clique disparado
 * antes do re-render que esconde os controles.
 */
function requireGM() {
  if (role === "GM") return true;
  OBR.notification.show("Apenas o mestre pode fazer isso.", "WARNING").catch(() => {
    /* Notificacao e so cortesia; a acao ja foi barrada. */
  });
  return false;
}

/** Escapa texto vindo do nome do token antes de injetar em innerHTML. */
function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );
}

/* ========================================================================== */
/* Renderizacao                                                               */
/* ========================================================================== */

function render() {
  const combatants = visibleTo(state, role);

  renderHeader(combatants);
  renderInitiative(combatants);
  renderSelectors(combatants);
  renderHp(combatants);
  renderRankingTable("damage-list", sortByDamageDealt(combatants), "damageDealt", "damage");
  renderRankingTable("tank-list", sortByDamageTanked(combatants), "damageTanked", "tank");
  renderRankingTable("heal-list", sortByHealing(combatants), "healingDone", "heal");
}

function renderHeader(combatants) {
  $("round-value").textContent = state.round;

  const active = combatants.find((c) => c.id === state.activeTokenId);
  // Se o token da vez esta oculto e quem olha e um jogador, mostramos um rotulo
  // generico em vez do nome — o jogador sabe que nao e a vez dele, mas nao
  // descobre qual monstro esta em campo.
  const activeExists = state.combatants.some((c) => c.id === state.activeTokenId);
  $("active-name").textContent = active
    ? active.name
    : activeExists
      ? "??? (oculto)"
      : "—";

  $("btn-next-turn").disabled = state.combatants.length === 0;
  $("btn-open-attack").disabled = combatants.length === 0;
}

function renderInitiative(combatants) {
  const container = $("initiative-list");
  const order = sortByInitiative(combatants);

  if (order.length === 0) {
    container.innerHTML = emptyState(
      "⚔️",
      role === "GM"
        ? "Nenhum combatente na fila.<br />Selecione um token no mapa e clique em <b>Adicionar Token Selecionado</b>."
        : "Nenhum combatente na fila.<br />Aguarde o mestre montar o combate.",
    );
    return;
  }

  container.innerHTML = order
    .map((c) => {
      const isActive = c.id === state.activeTokenId;
      const classes = ["card"];
      if (isActive) classes.push("is-active");
      if (c.isGMOnly) classes.push("is-hidden-npc");

      // O selo de oculto so existe para o GM: um PLAYER nunca recebe esses cards.
      const hiddenTag = c.isGMOnly ? '<span class="tag-hidden">🕵️ OCULTO</span>' : "";
      const nowTag = isActive ? '<span class="tag-now">AGORA</span>' : "";

      // "Dar a vez a este": conserta um turno pulado sem querer. Nao aparece em
      // quem ja esta no turno.
      const setTurnAction = isActive
        ? ""
        : `<button class="icon-btn rewind" data-action="set-turn" data-id="${c.id}" title="Dar a vez a este combatente">▶️</button>`;

      // Editar iniciativa e remover sao acoes exclusivas do mestre.
      const gmActions =
         `<button class="icon-btn" data-action="edit-initiative" data-id="${c.id}" title="Editar iniciativa">✏️</button>
             <button class="icon-btn danger" data-action="remove" data-id="${c.id}" title="Remover do combate">✖️</button>`
        

      return `
        <div class="${classes.join(" ")}">
          <div class="init">${c.initiative}</div>
          <div class="card-body">
            <div class="card-name">${escapeHtml(c.name)}${nowTag}${hiddenTag}</div>
            <div class="card-stats">
              <span class="stat-dealt">⚔️ ${c.damageDealt}</span>
              <span class="stat-tanked">🛡️ ${c.damageTanked}</span>
              <span class="stat-heal">💚 ${c.healingDone}</span>
              ${c.damageMitigated > 0 ? `<span class="stat-mitigated" title="Dano cortado por resistência">½ ${c.damageMitigated}</span>` : ""}
              ${c.misses > 0 ? `<span class="stat-miss" title="Golpes esquivados">💨 ${c.misses}</span>` : ""}
            </div>
          </div>
          <div class="card-actions">
            ${setTurnAction}
            <button class="icon-btn" data-action="focus" data-id="${c.id}" title="Focar câmera no token">🎯</button>
            ${gmActions}
          </div>
        </div>`;
    })
    .join("");
}

/** Mantem os selects de atacante/vitima sincronizados sem perder a escolha atual. */
function renderSelectors(combatants) {
  const order = sortByInitiative(combatants);

  const optionsFor = (list) =>
    list
      .map(
        (c) =>
          `<option value="${c.id}">${escapeHtml(c.name)}${c.isGMOnly ? " 🕵️" : ""}</option>`,
      )
      .join("");

  // --- Quem atacou: uma escolha só, preservada entre re-renders --------------
  const attacker = $("select-attacker");
  const previous = attacker.value;
  attacker.innerHTML = `<option value="">— quem atacou —</option>${optionsFor(order)}`;
  attacker.value = order.some((c) => c.id === previous) ? previous : "";

  // Atalho: enquanto o usuario nao escolher manualmente, o atacante sugerido e
  // quem esta no turno.
  if (!attackerTouched && order.some((c) => c.id === state.activeTokenId)) {
    attacker.value = state.activeTokenId;
  }

  // --- Quem levou: um seletor que ADICIONA à lista de alvos ------------------
  // Combatente que saiu do combate no meio do preenchimento sai da lista junto.
  dialogTargets = dialogTargets.filter((t) => order.some((c) => c.id === t.id));

  const available = order.filter((c) => !dialogTargets.some((t) => t.id === c.id));
  const picker = $("select-victim");
  picker.innerHTML =
    `<option value="">${available.length ? "— adicionar alvo —" : "— todos já são alvos —"}</option>` +
    optionsFor(available);
  picker.value = "";
  picker.disabled = available.length === 0;

  renderTargets();
}

/**
 * A lista de alvos do lançamento.
 *
 * Cada linha traz o resultado JÁ CALCULADO do golpe naquele alvo ("50 → 25"),
 * lido da mesma função que grava o placar. O mestre confere o efeito da
 * resistência antes de confirmar, sem precisar fazer a conta de cabeça.
 */
function renderTargets() {
  const container = $("target-list");
  const isHeal = dialogMode === "heal";

  if (dialogTargets.length === 0) {
    container.innerHTML = `<div class="target-empty">
        ${isHeal ? "Nenhum alvo — a cura conta só para quem lançou." : "Nenhum alvo — o dano conta só para quem atacou (dano ambiental)."}
      </div>`;
    return;
  }

  const amount = Number($("input-damage").value);
  const hasAmount = Number.isFinite(amount) && amount !== 0;
  const outcomes = previewAttack(dialogTargets, hasAmount ? amount : 0).perTarget;

  container.innerHTML = dialogTargets
    .map((target, index) => {
      const combatant = state.combatants.find((c) => c.id === target.id);
      const name = combatant ? combatant.name : "—";
      const outcome = outcomes[index];

      // Na cura não existe resistência nem esquiva: todo mundo recebe o valor cheio.
      const flags = isHeal
        ? ""
        : `<button class="target-flag ${target.resistant ? "on" : ""}" data-flag="resistant" data-id="${target.id}"
                   title="Resistência: este alvo recebe metade do dano">½ Resist.</button>
           <button class="target-flag miss ${target.missed ? "on" : ""}" data-flag="missed" data-id="${target.id}"
                   title="Errou: o alvo esquivou e não recebe dano">💨 Errou</button>`;

      const effect = isHeal
        ? hasAmount
          ? `<span class="target-hit heal">+${amount}</span>`
          : ""
        : hasAmount
          ? target.missed
            ? `<span class="target-hit missed">errou</span>`
            : `<span class="target-hit ${target.resistant ? "cut" : ""}">${
                target.resistant ? `${amount} → ${outcome.landed}` : outcome.landed
              }</span>`
          : "";

      return `<div class="target-row ${target.missed ? "is-missed" : ""}">
                <span class="target-name">${escapeHtml(name)}</span>
                ${effect}
                ${flags}
                <button class="target-remove" data-remove="${target.id}" title="Tirar da lista">✖️</button>
              </div>`;
    })
    .join("");
}

/** Adiciona um combatente à lista de alvos (ignora repetido e id inexistente). */
function addTarget(id) {
  if (!id || dialogTargets.some((t) => t.id === id)) return;
  if (!visibleTo(state, role).some((c) => c.id === id)) return;

  dialogTargets.push({ id, resistant: false, missed: false });
  renderSelectors(visibleTo(state, role));
}

/* -------------------------------------------------------------------------- */
/* Aba de vida                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Controle de vida dos monstros.
 *
 * A regra de privacidade e o coracao desta aba: o mestre ve "23 / 45"; o
 * jogador ve apenas "💛 Ferido" e uma barra arredondada em faixas de 25%. Nem o
 * numero nem a porcentagem exata vazam para a mesa.
 *
 * A CA segue a mesma logica, com um botao a mais: ela comeca secreta e o mestre
 * decide quando revela-la. Enquanto estiver secreta, o card do jogador nao
 * mostra nem o numero nem um espaco vazio — ele nao fica sabendo que existe uma
 * CA anotada.
 */
function renderHp(combatants) {
  const isGM = role === "GM";
  $("hp-controls").hidden = !isGM;

  const tracked = trackedCombatants(combatants);
  const container = $("hp-list");

  if (isGM) renderHpTargetOptions(combatants);

  if (tracked.length === 0) {
    container.innerHTML = emptyState(
      "❤️",
      isGM
        ? "Nenhum combatente sob controle de vida.<br />Escolha um da iniciativa acima e defina a vida máxima."
        : "Nenhum inimigo sendo monitorado no momento.",
    );
    return;
  }

  container.innerHTML = tracked
    .map((c) => {
      const status = hpStatus(c.hp);

      // Para o jogador a barra vai ate o TETO da faixa de estado, nunca ate a
      // porcentagem real. Isso mata dois problemas de uma vez: nao vaza a vida
      // exata e a barra nunca contradiz o rotulo (53% "Ferido" desenharia uma
      // barra de 53%, mais cheia do que o proprio rotulo sugere).
      const barPercent = isGM ? status.percent : status.max;

      const readout = isGM
        ? `<span class="hp-numbers ${status.key ? `hp-${status.key}` : ""}">
             ${c.hp.current}<small> / ${c.hp.max}</small>
           </span>`
        : `<span class="hp-status hp-${status.key}">${status.icon} ${status.label}</span>`;

      const gmActions = isGM
        ? `<div class="hp-actions">
             <button data-hp="-10" data-id="${c.id}" title="Tirar 10 de vida">−10</button>
             <button data-hp="-5" data-id="${c.id}" title="Tirar 5 de vida">−5</button>
             <button data-hp="-1" data-id="${c.id}" title="Tirar 1 de vida">−1</button>
             <button class="heal" data-hp="1" data-id="${c.id}" title="Devolver 1 de vida">+1</button>
             <button class="heal" data-hp="5" data-id="${c.id}" title="Devolver 5 de vida">+5</button>
             <button class="heal" data-hp="10" data-id="${c.id}" title="Devolver 10 de vida">+10</button>
             <button class="untrack" data-untrack="${c.id}" title="Parar de monitorar">✖️</button>
           </div>`
        : "";

      const hiddenTag = c.isGMOnly ? '<span class="tag-hidden">🕵️ OCULTO</span>' : "";

      return `<div class="hp-card hp-${status.key}">
                <div class="hp-head">
                  <span class="hp-name">${escapeHtml(c.name)}${hiddenTag}</span>
                  ${acChipHtml(c)}
                  ${readout}
                </div>
                <div class="hp-track">
                  <div class="hp-fill hp-${status.key}" style="width:${barPercent}%"></div>
                </div>
                ${gmActions}
                ${acRowHtml(c)}
              </div>`;
    })
    .join("");
}

/**
 * Selo de CA no cabecalho do card.
 *
 * `visibleAc` ja aplica a cortina: para o jogador ele devolve null enquanto a
 * CA for secreta, e nesse caso nada e desenhado. Para o mestre a CA aparece
 * sempre, com o visual tracejado indicando que a mesa ainda nao viu.
 */
function acChipHtml(combatant) {
  const ac = visibleAc(combatant, role);
  if (!ac) return "";

  const secret = !ac.visible;
  const title = secret
    ? "CA visível só para o mestre"
    : role === "GM"
      ? "CA revelada para os jogadores"
      : "Classe de Armadura";

  return `<span class="ac-chip ${secret ? "is-secret" : "is-public"}" title="${title}">
            🛡️ CA ${ac.value}${secret ? " 🙈" : ""}
          </span>`;
}

/** Linha de controle da CA — exclusiva do mestre. */
function acRowHtml(combatant) {
  if (role !== "GM") return "";

  const { id, ac } = combatant;

  if (!ac) {
    return `<div class="ac-row">
              <button data-ac-edit="${id}" title="Anotar a Classe de Armadura">🛡️ Definir CA</button>
            </div>`;
  }

  const toggleLabel = ac.visible ? "🙈 Ocultar dos jogadores" : "👁️ Mostrar aos jogadores";

  return `<div class="ac-row">
            <button data-ac-edit="${id}" title="Editar ou remover a CA">✏️ CA ${ac.value}</button>
            <button class="${ac.visible ? "is-public" : ""}" data-ac-toggle="${id}">${toggleLabel}</button>
          </div>`;
}

/** Preenche o select com quem ainda NAO esta sob controle de vida. */
function renderHpTargetOptions(combatants) {
  const select = $("select-hp-target");
  const previous = select.value;

  const available = sortByInitiative(combatants.filter((c) => !c.hp));

  select.innerHTML =
    `<option value="">— escolha um combatente —</option>` +
    available
      .map(
        (c) =>
          `<option value="${c.id}">${escapeHtml(c.name)}${c.isGMOnly ? " 🕵️" : ""}</option>`,
      )
      .join("");

  select.value = available.some((c) => c.id === previous) ? previous : "";
  $("btn-track-hp").disabled = available.length === 0;
}

/** Textos de cada categoria de ranking, usados nas tabelas e nos vazios. */
const CATEGORY_UI = {
  damage: {
    icon: "⚔️",
    header: "Dano",
    empty: "Nenhum dano registrado ainda.<br />Use <b>Registrar Ataque</b> na aba Turnos.",
  },
  tank: {
    icon: "🛡️",
    header: "Recebido",
    empty: "Ninguém apanhou ainda.<br />O paredão está limpo.",
  },
  evasion: {
    icon: "💨",
    header: "Esquivas",
    empty: "Nenhuma esquiva registrada.",
  },
  heal: {
    icon: "💚",
    header: "Cura",
    empty: "Nenhuma cura registrada.<br />Use o modo <b>💚 Cura</b> ao registrar.",
  },
  score: { icon: "👑", header: "Índice", empty: "Nada registrado." },
};

const MEDALS = ["🥇", "🥈", "🥉"];

/**
 * Quem aparece na tabela de cada categoria.
 *
 * O tank é o caso especial: quem só esquivou tem `damageTanked` zerado e ainda
 * assim precisa aparecer — foi alvo, e sair ileso é justamente o mérito.
 */
function rankingFilter(field, kind) {
  if (kind !== "tank") return (c) => c[field] > 0;
  return (c) => damageFaced(c) > 0 || c.misses > 0;
}

/**
 * Monta a tabela de um ranking. Só entra quem tem valor maior que zero — uma
 * linha com 0 não diz nada e só empurra o resto para fora da tela.
 *
 * @param {Array}  ordered  combatentes já ordenados pela categoria
 * @param {"damageDealt"|"damageTanked"|"healingDone"} field
 * @param {"damage"|"tank"|"heal"} kind
 */
function rankingTableHtml(ordered, field, kind) {
  const scored = ordered.filter(rankingFilter(field, kind));
  if (scored.length === 0) return "";

  const isTank = kind === "tank";
  const { header } = CATEGORY_UI[kind];

  // No tank as duas barras dividem a MESMA escala (o maior "recebido +
  // mitigado" da mesa), então o segmento sólido continua caindo linha a linha,
  // acompanhando a ordenação, e a soma nunca estoura a largura da célula.
  const max = isTank
    ? Math.max(...scored.map((c) => c.damageTanked + c.damageMitigated), 1)
    : scored[0][field] || 1;

  const rows = scored
    .map((c, index) => {
      const position = index + 1;
      const bar = isTank ? tankBarHtml(c, max) : plainBarHtml(c[field], max);
      const detail = isTank ? tankDetailHtml(c) : "";

      return `<tr class="pos-${position}">
                <td class="col-pos">${MEDALS[index] ?? `${position}º`}</td>
                <td class="col-name bar-cell"${isTank ? ' style="white-space:normal"' : ""}>
                  ${bar}
                  <span>${escapeHtml(c.name)}</span>
                  ${detail}
                </td>
                <td class="col-value">${c[field]}</td>
              </tr>`;
    })
    .join("");

  return `<table class="rank-table ${kind}">
            <thead>
              <tr><th class="col-pos">#</th><th>Combatente</th><th class="col-value">${header}</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          ${isTank ? TANK_LEGEND : ""}`;
}

function plainBarHtml(value, max) {
  return `<div class="bar" style="width:${Math.round((value / max) * 100)}%"></div>`;
}

/**
 * Barra dupla do paredão: o que o combatente levou de fato (sólido) e o que a
 * resistência cortou antes de chegar na vida (hachurado, encostado no fim da
 * primeira). Juntas mostram a ameaça que veio na direção dele.
 */
function tankBarHtml(combatant, max) {
  const received = Math.round((combatant.damageTanked / max) * 100);
  const mitigated = Math.round((combatant.damageMitigated / max) * 100);

  // Sem mitigação o segundo segmento nem existe — assim o sólido é o último
  // filho e fecha as duas pontas arredondadas, como qualquer outra barra.
  const cut =
    combatant.damageMitigated > 0
      ? `<div class="bar-seg mitigated" style="width:${mitigated}%"></div>`
      : "";

  return `<div class="bar-stack">
            <div class="bar-seg received" style="width:${received}%"></div>
            ${cut}
          </div>`;
}

/** Números por extenso da linha do tank — o que a barra desenha, em texto. */
function tankDetailHtml(combatant) {
  const attacks = combatant.hitsTaken + combatant.misses;
  const chips = [`<span class="chip">🛡️ ${combatant.damageTanked} recebido</span>`];

  if (combatant.damageMitigated > 0) {
    chips.push(`<span class="chip">½ ${combatant.damageMitigated} mitigado</span>`);
  }
  if (combatant.misses > 0) {
    chips.push(
      `<span class="chip">💨 ${combatant.misses} esquiva${combatant.misses > 1 ? "s" : ""} de ${attacks}</span>`,
    );
  }
  if (combatant.damageDodged > 0) {
    chips.push(`<span class="chip">🚫 ${combatant.damageDodged} evitado</span>`);
  }

  return `<div class="chip-row">${chips.join("")}</div>`;
}

/** Legenda da barra dupla — sem ela, o hachurado é só um enfeite. */
const TANK_LEGEND = `<div class="bar-legend">
    <span><i class="swatch received"></i> Dano recebido de fato</span>
    <span><i class="swatch mitigated"></i> Mitigado por resistência</span>
  </div>`;

/** Renderiza a tabela de um ranking numa das abas. */
function renderRankingTable(containerId, ordered, field, kind) {
  const table = rankingTableHtml(ordered, field, kind);
  $(containerId).innerHTML =
    table || emptyState(CATEGORY_UI[kind].icon, CATEGORY_UI[kind].empty);
}

function emptyState(icon, html) {
  return `<div class="empty"><span class="empty-icon">${icon}</span>${html}</div>`;
}

/* ========================================================================== */
/* Acoes                                                                      */
/* ========================================================================== */

async function handleNextTurn() {
  let nextId = null;
  await mutateState((draft) => {
    nextId = advanceTurn(draft);
  });

  // Auto-focus: centraliza a camera no token que acabou de entrar no turno.
  if (nextId) await focusOnToken(nextId, FOCUS_ZOOM);
}

/** Coloca a vez num combatente especifico — desfaz um turno pulado por engano. */
async function handleSetTurn(id) {
  await mutateState((draft) => {
    if (draft.combatants.some((c) => c.id === id)) draft.activeTokenId = id;
  });
  await focusOnToken(id, FOCUS_ZOOM);
}

/* -------------------------------------------------------------------------- */
/* Dialogo de ataque                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Abre o diálogo de lançamento de dano.
 *
 * @param {string|null} victimId vítima pré-selecionada (vem do menu de contexto)
 */
function openAttackDialog(victimId = null) {
  // A cada abertura o atacante volta a ser sugerido como quem está no turno.
  attackerTouched = false;
  dialogTargets = [];
  setDialogMode("damage");

  $("input-damage").value = "";
  clearQuickSelection();

  // A vítima pré-selecionada (menu de contexto) entra como primeiro alvo; os
  // demais o mestre acrescenta pelo seletor.
  if (victimId) dialogTargets.push({ id: victimId, resistant: false, missed: false });
  render();

  $("attack-overlay").hidden = false;

  // Se a vítima já veio pronta, o foco vai direto para o campo de dano.
  (dialogTargets.length ? $("input-damage") : $("select-attacker")).focus();
}

/** Troca entre registrar dano e registrar cura, reescrevendo os rótulos. */
function setDialogMode(mode) {
  dialogMode = mode;
  const isHeal = mode === "heal";

  for (const button of document.querySelectorAll(".mode-switch .mode")) {
    button.classList.toggle("active", button.dataset.mode === mode);
  }

  $("attack-title").textContent = isHeal ? "💚 Registrar Cura" : "⚔️ Registrar Ataque";
  $("label-attacker").textContent = isHeal ? "Quem curou" : "Quem atacou";
  $("arrow-label").textContent = isHeal ? "↓ curou ↓" : "↓ causou dano em ↓";
  $("label-victim").textContent = isHeal ? "Quem recebeu" : "Quem levou";
  $("label-amount").textContent = isHeal ? "Cura" : "Dano";

  $("hint-damage").hidden = isHeal;
  $("hint-heal").hidden = !isHeal;

  $("btn-apply-damage").textContent = isHeal ? "💚 Confirmar" : "💥 Confirmar";

  // As marcações de resistência/erro só existem no modo dano.
  renderTargets();
}

function closeAttackDialog() {
  $("attack-overlay").hidden = true;
}

function clearQuickSelection() {
  for (const button of document.querySelectorAll("[data-quick]")) {
    button.classList.remove("selected");
  }
}

/** Os botões rápidos preenchem o campo; quem aplica é o "Confirmar". */
function pickQuickDamage(value) {
  $("input-damage").value = value;
  clearQuickSelection();
  const button = document.querySelector(`[data-quick="${value}"]`);
  if (button) button.classList.add("selected");
  // A prévia por alvo acompanha o novo valor.
  renderTargets();
}

async function handleApplyDamage() {
  const isHeal = dialogMode === "heal";
  const sourceId = $("select-attacker").value;
  const targets = [...dialogTargets];
  const amount = Number($("input-damage").value);

  if (!Number.isFinite(amount) || amount === 0) {
    await OBR.notification.show(
      `Informe um valor de ${isHeal ? "cura" : "dano"} diferente de zero.`,
      "WARNING",
    );
    return;
  }

  if (isHeal) {
    // Na cura, quem pontua é o curandeiro — sem ele não há o que registrar.
    if (!sourceId) {
      await OBR.notification.show("Escolha quem realizou a cura.", "WARNING");
      return;
    }
    // Os alvos não ganham mérito, mas recuperam vida se estiverem sob controle.
    await mutateState((draft) =>
      applyHealing(draft, sourceId, targets.map((t) => t.id), amount),
    );
  } else {
    if (!sourceId && targets.length === 0) {
      await OBR.notification.show("Escolha ao menos um atacante ou uma vítima.", "WARNING");
      return;
    }
    // Escrita unica: credita o dano efetivo no atacante e distribui entre os alvos.
    await mutateState((draft) => applyAttack(draft, sourceId, targets, amount));
  }

  closeAttackDialog();
  await OBR.notification.show(attackSummary(isHeal, sourceId, targets, amount), "SUCCESS");
}

/** Uma linha de texto contando o que acabou de acontecer, em área ou não. */
function attackSummary(isHeal, sourceId, targets, amount) {
  const nameOf = (id) => state.combatants.find((c) => c.id === id)?.name;
  const sourceName = nameOf(sourceId);

  const targetLabel =
    targets.length === 0
      ? isHeal
        ? ""
        : "sem alvo"
      : targets.length === 1
        ? (nameOf(targets[0].id) ?? "alvo")
        : `${targets.length} alvos`;

  if (isHeal) {
    const total = amount * Math.max(1, targets.length);
    return `💚 ${sourceName} curou ${amount}${targetLabel ? ` em ${targetLabel}` : ""}${
      targets.length > 1 ? ` (${total} no total)` : ""
    }.`;
  }

  const result = previewAttack(targets, amount);
  const extras = [];
  if (result.mitigated > 0) extras.push(`½ ${result.mitigated} mitigado`);
  if (result.misses > 0) extras.push(`💨 ${result.misses} esquiva${result.misses > 1 ? "s" : ""}`);

  const dealt = targets.length === 0 ? amount : result.dealt;
  return `${sourceName ?? "Dano ambiental"} → ${targetLabel}: ${dealt} de dano${
    extras.length ? ` · ${extras.join(" · ")}` : ""
  }`;
}

async function handleAddSelected() {
  if (!(await OBR.scene.isReady())) {
    await OBR.notification.show("Abra uma cena antes de montar o combate.", "WARNING");
    return;
  }

  const selection = await OBR.player.getSelection();
  if (!selection || selection.length === 0) {
    await OBR.notification.show("Selecione um ou mais tokens no mapa.", "WARNING");
    return;
  }

  const items = await OBR.scene.items.getItems(selection);
  const isGMOnly = $("check-gm-only").checked;

  const current = await readState();
  const candidates = items.filter((item) => !current.combatants.some((c) => c.id === item.id));

  if (candidates.length === 0) {
    await OBR.notification.show("Esses tokens já estão no combate.", "INFO");
    return;
  }

  // A fila tem teto (a metadata da sala é limitada). Melhor dizer o que ficou
  // de fora do que gravar e deixar a normalização cortar em silêncio.
  const slots = remainingSlots(current);
  if (slots === 0) {
    await OBR.notification.show(
      "A fila de iniciativa está cheia. Remova alguém antes de adicionar.",
      "ERROR",
    );
    return;
  }

  const fresh = candidates.slice(0, slots);
  if (fresh.length < candidates.length) {
    await OBR.notification.show(
      `Só cabiam mais ${slots} na fila — ${candidates.length - fresh.length} token(s) ficaram de fora.`,
      "WARNING",
    );
  }

  // Uma unica rolagem de iniciativa por lote mantem o fluxo rapido; o mestre
  // ajusta valores individuais depois pelo lapis no card.
  const answer = window.prompt(
    fresh.length === 1
      ? `Iniciativa de "${resolveTokenName(fresh[0])}":`
      : `Iniciativa para os ${fresh.length} tokens selecionados:`,
    "10",
  );
  if (answer === null) return;

  const initiative = Number(answer);
  if (!Number.isFinite(initiative)) {
    await OBR.notification.show("Iniciativa inválida.", "ERROR");
    return;
  }

  await mutateState((draft) => {
    for (const item of fresh) {
      // resolveTokenName: título do token quando existir, nome da imagem como reserva.
      draft.combatants.push(
        createCombatant(item.id, resolveTokenName(item), initiative, isGMOnly),
      );
    }
  });

  await OBR.notification.show(
    `${fresh.length} combatente(s) adicionado(s).`,
    "SUCCESS",
  );
}

async function handleReset() {
  if (!requireGM()) return;

  const confirmed = window.confirm(
    "Resetar o combate?\n\nIsso volta para a Rodada 1 e zera todo o dano causado e tankado. Os combatentes permanecem na lista.",
  );
  if (!confirmed) return;

  await mutateState((draft) => resetCombat(draft));
  await OBR.notification.show("Combate resetado.", "SUCCESS");
}

/* -------------------------------------------------------------------------- */
/* Acoes da aba de vida                                                        */
/* -------------------------------------------------------------------------- */

async function handleTrackHp() {
  if (!requireGM()) return;

  const id = $("select-hp-target").value;
  const max = Number($("input-hp-max").value);

  // CA e opcional: campo vazio apenas nao anota nada.
  const rawAc = $("input-hp-ac").value.trim();
  const ac = rawAc === "" ? null : Number(rawAc);

  if (!id) {
    await OBR.notification.show("Escolha um combatente da iniciativa.", "WARNING");
    return;
  }
  if (!Number.isFinite(max) || max < 1) {
    await OBR.notification.show("Informe uma vida máxima válida.", "WARNING");
    return;
  }
  if (ac !== null && (!Number.isFinite(ac) || ac < 0)) {
    await OBR.notification.show("CA inválida — use um número de 0 a 99.", "WARNING");
    return;
  }

  await mutateState((draft) => {
    trackHp(draft, id, max);
    // Entra oculta: a mesa so ve a CA quando o mestre apertar "Mostrar".
    if (ac !== null) setAc(draft, id, ac, false);
  });

  $("input-hp-max").value = "";
  $("input-hp-ac").value = "";

  const name = state.combatants.find((c) => c.id === id)?.name ?? "Combatente";
  await OBR.notification.show(
    ac === null
      ? `${name} entrou no controle de vida (${max}).`
      : `${name} entrou no controle de vida (${max}) — CA ${Math.round(ac)} oculta.`,
    "SUCCESS",
  );
}

async function handleAdjustHp(id, delta) {
  await mutateState((draft) => adjustHp(draft, id, delta));
}

async function handleUntrackHp(id) {
  await mutateState((draft) => untrackHp(draft, id));
}

/* -------------------------------------------------------------------------- */
/* Acoes da CA                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Define, corrige ou remove a CA. Campo vazio remove — assim o mesmo botao
 * resolve os tres casos sem poluir o card com mais um icone.
 */
async function handleEditAc(id) {
  if (!requireGM()) return;

  const combatant = state.combatants.find((c) => c.id === id);
  if (!combatant) return;

  const answer = window.prompt(
    `Classe de Armadura de "${combatant.name}"\n\n(deixe vazio para remover a CA)`,
    combatant.ac ? String(combatant.ac.value) : "",
  );
  if (answer === null) return;

  const trimmed = answer.trim();

  if (trimmed === "") {
    await mutateState((draft) => clearAc(draft, id));
    await OBR.notification.show(`CA de ${combatant.name} removida.`, "INFO");
    return;
  }

  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) {
    await OBR.notification.show("CA inválida — use um número de 0 a 99.", "ERROR");
    return;
  }

  // setAc preserva a revelacao atual: corrigir o numero de uma CA ja revelada
  // nao a esconde de novo.
  await mutateState((draft) => setAc(draft, id, value));

  const wasSecret = !combatant.ac?.visible;
  await OBR.notification.show(
    `CA de ${combatant.name}: ${Math.round(value)}${wasSecret ? " (oculta para os jogadores)" : ""}.`,
    "SUCCESS",
  );
}

/** Abre ou fecha a cortina da CA para a mesa inteira. */
async function handleToggleAc(id) {
  if (!requireGM()) return;

  const combatant = state.combatants.find((c) => c.id === id);
  if (!combatant?.ac) return;

  const reveal = !combatant.ac.visible;
  await mutateState((draft) => setAcVisibility(draft, id, reveal));

  await OBR.notification.show(
    reveal
      ? `🛡️ CA de ${combatant.name} revelada para a mesa.`
      : `🙈 CA de ${combatant.name} voltou a ser segredo.`,
    reveal ? "SUCCESS" : "INFO",
  );
}

/* -------------------------------------------------------------------------- */
/* Finalizar combate                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Abre a confirmacao em dois passos. O primeiro passo explica o que vai
 * acontecer; o segundo exige marcar a caixa antes de liberar o botao. Dois
 * gestos deliberados, para um clique errado nao apagar a batalha.
 */
function openEndDialog() {
  if (!requireGM()) return;

  showEndStep(1);
  $("end-overlay").hidden = false;
}

function closeEndDialog() {
  $("end-overlay").hidden = true;
}

function showEndStep(step) {
  $("end-step-1").hidden = step !== 1;
  $("end-step-2").hidden = step !== 2;
  $("btn-end-next").hidden = step !== 1;
  $("btn-end-confirm").hidden = step !== 2;

  // A caixa sempre volta desmarcada: avancar de passo nao pode herdar um aceite.
  $("check-end-confirm").checked = false;
  $("btn-end-confirm").disabled = true;
}

async function handleEndCombat() {
  if (!requireGM()) return;

  // Retrato da batalha ANTES de limpar — e o que alimenta o relatorio.
  const snapshot = await readState();
  closeEndDialog();

  if (snapshot.combatants.length === 0) {
    await OBR.notification.show("Não há combatentes para relatar.", "WARNING");
    return;
  }

  // Todo mundo na mesa ve o mesmo relatorio; cada cliente filtra pela sua role.
  await OBR.broadcast.sendMessage(CHANNEL_BATTLE_REPORT, snapshot, {
    destination: "ALL",
  });

  // Quem encerrou nao depende do proprio broadcast voltar: renderiza direto.
  // Se a mensagem tambem chegar aqui, o re-render e identico e inofensivo.
  showBattleReport(snapshot);

  // A limpeza acontece agora, mas o relatorio ja esta na tela de cada um,
  // renderizado a partir do retrato — nao depende mais da metadata.
  await mutateState((draft) => endCombat(draft));
}

/**
 * Monta e exibe o relatorio final a partir de um retrato do combate.
 *
 * Ordem da tela: primeiro as TABELAS completas de cada categoria, depois os
 * destaques de cada frente e, no fim, o MVP geral com o indice que o elegeu —
 * a leitura sobe dos numeros para a coroacao.
 */
function showBattleReport(snapshot) {
  const combatants = visibleTo(snapshot, role);

  const byDamage = sortByDamageDealt(combatants);
  const byTank = sortByDamageTanked(combatants);
  const byHeal = sortByHealing(combatants);
  const byEvasion = sortByEvasion(combatants);

  const total = (field) => combatants.reduce((sum, c) => sum + c[field], 0);

  const totalDamage = total("damageDealt");
  const totalTanked = total("damageTanked");
  const totalHealed = total("healingDone");
  const totalMitigated = total("damageMitigated");
  const totalMisses = total("misses");

  // Um MVP por categoria: simplesmente quem lidera cada tabela.
  const mvps = [
    { kind: "damage", label: "MVP de Dano", unit: "dano", leader: byDamage[0], field: "damageDealt" },
    { kind: "tank", label: "MVP de Tank", unit: "tankado", leader: byTank[0], field: "damageTanked" },
    { kind: "evasion", label: "MVP de Evasão", unit: "esquivas", leader: byEvasion[0], field: "misses" },
    { kind: "heal", label: "MVP de Cura", unit: "cura", leader: byHeal[0], field: "healingDone" },
  ];

  $("report-body").innerHTML = `
    <div class="report-totals" style="margin-top:0">
      <div class="total-tile"><strong>${snapshot.round}</strong><small>rodadas</small></div>
      <div class="total-tile"><strong style="color:var(--accent)">${totalDamage}</strong><small>dano</small></div>
      <div class="total-tile"><strong style="color:var(--shield)">${totalTanked}</strong><small>tankado</small></div>
      <div class="total-tile"><strong style="color:var(--shield)">${totalMitigated}</strong><small>mitigado</small></div>
      <div class="total-tile"><strong style="color:var(--gold)">${totalMisses}</strong><small>esquivas</small></div>
      <div class="total-tile"><strong style="color:var(--success)">${totalHealed}</strong><small>cura</small></div>
    </div>

    ${reportSection("⚔️ Dano causado", byDamage, "damageDealt", "damage")}
    ${reportSection("🛡️ Dano tankado e evitado", byTank, "damageTanked", "tank")}
    ${reportSection("💚 Cura realizada", byHeal, "healingDone", "heal")}

    <div class="report-section">
      <div class="section-title">🏅 Os melhores de cada frente</div>
      <div class="mvp-grid">
        ${mvps.map(mvpCardHtml).join("")}
      </div>
    </div>

    ${contributionSection(combatants)}`;

  $("report-overlay").hidden = false;
}

/** Um cartão de MVP. Categoria sem nenhum registro aparece como vaga. */
function mvpCardHtml({ kind, label, unit, leader, field }) {
  const { icon } = CATEGORY_UI[kind];

  if (!leader || leader[field] <= 0) {
    return `<div class="mvp-card ${kind} vacant">
              <div class="mvp-icon">${icon}</div>
              <div class="mvp-info">
                <div class="mvp-label">${label}</div>
                <div class="mvp-name">Ninguém pontuou</div>
              </div>
            </div>`;
  }

  return `<div class="mvp-card ${kind}">
            <div class="mvp-icon">${icon}</div>
            <div class="mvp-info">
              <div class="mvp-label">${label}</div>
              <div class="mvp-name">${escapeHtml(leader.name)}</div>
            </div>
            <div>
              <div class="mvp-value">${leader[field]}</div>
              <small class="mvp-unit">${unit}</small>
            </div>
          </div>`;
}

/** Uma seção de tabela do relatório, com título. */
function reportSection(title, ordered, field, kind) {
  const table = rankingTableHtml(ordered, field, kind);
  return `<div class="report-section">
            <div class="section-title">${title}</div>
            ${table || '<p class="confirm-text" style="margin:0">Nada registrado.</p>'}
          </div>`;
}

/**
 * A coroação: o MVP da batalha e o Índice de Contribuição que o elegeu.
 *
 * O índice vai de 0 a 100 e mede desempenho RELATIVO ao melhor da mesa em cada
 * pilar — ofensiva, muralha, evasão, suporte e eficiência. Regra completa em
 * docs/pontuacao-mvp.md.
 */
function contributionSection(combatants) {
  const { ranking, pillars } = computeMvpRanking(combatants);
  const scored = ranking.filter((entry) => entry.score > 0);
  if (scored.length === 0) return "";

  const rows = scored
    .map((entry, index) => {
      const position = index + 1;
      const chips = entry.breakdown
        .map(
          (part) =>
            `<span class="chip" title="${part.label}: ${Math.round(part.share * 100)}% do melhor da mesa">
               ${part.icon} ${part.points.toFixed(1)}
             </span>`,
        )
        .join("");

      // A barra usa o próprio índice como largura: ela mede o quanto o
      // combatente chegou perto do desempenho perfeito, não do primeiro lugar.
      return `<tr class="pos-${position}">
                <td class="col-pos">${MEDALS[index] ?? `${position}º`}</td>
                <td class="col-name bar-cell" style="white-space:normal">
                  <div class="bar" style="width:${Math.round(entry.score)}%"></div>
                  <span>${escapeHtml(entry.combatant.name)}</span>
                  <div class="chip-row">${chips}</div>
                </td>
                <td class="col-value">${entry.score.toFixed(1)}</td>
              </tr>`;
    })
    .join("");

  const weights = pillars
    .map(
      (pillar) =>
        `<span class="chip" title="${pillar.hint}">${pillar.icon} ${pillar.label} ${Math.round(pillar.effectiveWeight)}</span>`,
    )
    .join("");

  // Pilares em que ninguém pontuou saem da conta e devolvem seu peso aos
  // outros — é o que impede uma mesa sem curandeiro de carregar pontos mortos.
  const dropped = MVP_PILLAR_COUNT - pillars.length;

  return `${mvpBannerHtml(scored[0])}
          <div class="report-section">
            <div class="section-title">📊 Índice de contribuição</div>
            <table class="rank-table score">
              <thead>
                <tr><th class="col-pos">#</th><th>Combatente</th><th class="col-value">Índice</th></tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
            <div class="chip-row" style="margin-top:7px">${weights}</div>
            <p class="dialog-hint">
              Cada pilar vira uma nota comparada ao <b>melhor da mesa</b> e é
              multiplicada pelo peso acima — 100 seria liderar tudo ao mesmo tempo.
              ${
                dropped > 0
                  ? `<br />${dropped} pilar${dropped > 1 ? "es" : ""} sem registro nesta batalha saiu da conta, e o peso dele foi redistribuído.`
                  : ""
              }
            </p>
          </div>`;
}

/** Quantos pilares existem no total — para avisar quantos saíram da conta. */
const MVP_PILLAR_COUNT = 5;

/** O pódio em uma linha só: quem levou a batalha e por quê. */
function mvpBannerHtml(winner) {
  const top = winner.breakdown
    .slice(0, 2)
    .map((part) => `${part.icon} ${part.label}`)
    .join(" · ");

  return `<div class="report-section">
            <div class="section-title">👑 MVP da batalha</div>
            <div class="mvp-banner">
              <div class="mvp-crown">👑</div>
              <div class="mvp-info">
                <div class="mvp-name">${escapeHtml(winner.combatant.name)}</div>
                <div class="mvp-why">${top || "Participação registrada"}</div>
              </div>
              <div>
                <div class="mvp-value">${winner.score.toFixed(1)}</div>
                <small class="mvp-unit">índice</small>
              </div>
            </div>
          </div>`;
}

async function handleEditInitiative(id) {
  const combatant = state.combatants.find((c) => c.id === id);
  if (!combatant) return;

  const answer = window.prompt(
    `Nova iniciativa de "${combatant.name}":`,
    String(combatant.initiative),
  );
  if (answer === null) return;

  const initiative = Number(answer);
  if (!Number.isFinite(initiative)) {
    await OBR.notification.show("Iniciativa inválida.", "ERROR");
    return;
  }

  await mutateState((draft) => {
    const target = draft.combatants.find((c) => c.id === id);
    if (target) target.initiative = initiative;
  });
}

async function handleRemove(id) {
  await mutateState((draft) => {
    draft.combatants = draft.combatants.filter((c) => c.id !== id);
    // Se removemos justamente quem estava no turno, o proximo "Próximo Turno"
    // recomeca do topo da ordem.
    if (draft.activeTokenId === id) draft.activeTokenId = null;
  });
}

/* ========================================================================== */
/* Ligacao de eventos                                                         */
/* ========================================================================== */

function switchTab(name) {
  activeTab = name;
  for (const tab of document.querySelectorAll(".tab")) {
    tab.classList.toggle("active", tab.dataset.tab === name);
  }
  for (const panel of document.querySelectorAll(".panel")) {
    panel.classList.toggle("active", panel.id === `panel-${name}`);
  }
}

function bindEvents() {
  // --- Abas ---------------------------------------------------------------
  for (const tab of document.querySelectorAll(".tab")) {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  }

  // --- Turno --------------------------------------------------------------
  $("btn-next-turn").addEventListener("click", handleNextTurn);

  // --- Diálogo de ataque --------------------------------------------------
  $("btn-open-attack").addEventListener("click", () => openAttackDialog());
  $("btn-close-attack").addEventListener("click", closeAttackDialog);
  $("btn-cancel-attack").addEventListener("click", closeAttackDialog);

  // Clique no fundo escurecido fecha o diálogo.
  $("attack-overlay").addEventListener("click", (event) => {
    if (event.target === $("attack-overlay")) closeAttackDialog();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("attack-overlay").hidden) closeAttackDialog();
  });

  $("select-attacker").addEventListener("change", () => {
    attackerTouched = true;
  });

  // O seletor de vítima é um "adicionar": escolher alguém empurra para a lista
  // de alvos e volta ao placeholder, pronto para o próximo alvo da área.
  $("select-victim").addEventListener("change", (event) => {
    addTarget(event.target.value);
  });

  // Marcações por alvo (resistência / erro) e remoção da lista.
  $("target-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-flag], [data-remove]");
    if (!button) return;

    const { flag, id, remove } = button.dataset;

    if (remove) {
      dialogTargets = dialogTargets.filter((t) => t.id !== remove);
      renderSelectors(visibleTo(state, role));
      return;
    }

    const target = dialogTargets.find((t) => t.id === id);
    if (!target) return;

    target[flag] = !target[flag];
    // Errar e resistir são excludentes: um golpe que não encostou não tem
    // metade para cortar.
    if (target[flag]) target[flag === "missed" ? "resistant" : "missed"] = false;

    renderTargets();
  });

  $("btn-apply-damage").addEventListener("click", handleApplyDamage);
  $("input-damage").addEventListener("keydown", (event) => {
    if (event.key === "Enter") handleApplyDamage();
  });
  $("input-damage").addEventListener("input", () => {
    clearQuickSelection();
    renderTargets();
  });

  for (const button of document.querySelectorAll("[data-quick]")) {
    button.addEventListener("click", () => pickQuickDamage(Number(button.dataset.quick)));
  }

  for (const button of document.querySelectorAll(".mode-switch .mode")) {
    button.addEventListener("click", () => setDialogMode(button.dataset.mode));
  }

  // --- Finalizar combate (duplo aceite) -----------------------------------
  $("btn-end-combat").addEventListener("click", openEndDialog);
  $("btn-close-end").addEventListener("click", closeEndDialog);
  $("btn-cancel-end").addEventListener("click", closeEndDialog);
  $("btn-end-next").addEventListener("click", () => showEndStep(2));

  // O botão final só destrava com a caixa marcada — o segundo aceite.
  $("check-end-confirm").addEventListener("change", (event) => {
    $("btn-end-confirm").disabled = !event.target.checked;
  });
  $("btn-end-confirm").addEventListener("click", handleEndCombat);

  $("btn-close-report").addEventListener("click", () => {
    $("report-overlay").hidden = true;
  });

  // --- Controles do mestre ------------------------------------------------
  $("btn-add-selected").addEventListener("click", handleAddSelected);
  $("btn-reset").addEventListener("click", handleReset);

  // --- Aba de vida --------------------------------------------------------
  $("btn-track-hp").addEventListener("click", handleTrackHp);
  $("input-hp-max").addEventListener("keydown", (event) => {
    if (event.key === "Enter") handleTrackHp();
  });

  $("input-hp-ac").addEventListener("keydown", (event) => {
    if (event.key === "Enter") handleTrackHp();
  });

  $("hp-list").addEventListener("click", (event) => {
    const button = event.target.closest(
      "[data-hp], [data-untrack], [data-ac-edit], [data-ac-toggle]",
    );
    if (!button) return;

    const { untrack, acEdit, acToggle } = button.dataset;

    if (acEdit) handleEditAc(acEdit);
    else if (acToggle) handleToggleAc(acToggle);
    else if (untrack) handleUntrackHp(untrack);
    else handleAdjustHp(button.dataset.id, Number(button.dataset.hp));
  });

  // --- Acoes dentro dos cards (delegacao) ---------------------------------
  $("initiative-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;

    const { action, id } = button.dataset;
    if (action === "focus") focusOnToken(id, FOCUS_ZOOM);
    else if (action === "edit-initiative") handleEditInitiative(id);
    else if (action === "remove") handleRemove(id);
  });
}

/* ========================================================================== */
/* Integracao com o menu de contexto                                          */
/* ========================================================================== */

/**
 * O menu de contexto ("⚔️ Adicionar Dano ao Token") roda na pagina de background
 * e nao consegue exibir dialogos. Ele apenas grava o token alvo na metadata do
 * jogador e abre este painel; aqui nos pegamos esse alvo, pre-selecionamos a
 * vitima e mandamos o mestre direto para a aba de iniciativa, onde fica o
 * formulario de dano.
 */
async function consumeContextMenuTarget() {
  const targetId = await consumePendingTarget();
  if (!targetId) return;

  // O token pode nem estar na iniciativa (ou estar oculto para quem clicou).
  if (!visibleTo(state, role).some((c) => c.id === targetId)) return;

  switchTab("initiative");
  openAttackDialog(targetId);
}

/* ========================================================================== */
/* Bootstrap                                                                  */
/* ========================================================================== */

OBR.onReady(async () => {
  // O manifest ja declara 420x550, mas reforcamos em runtime para o caso de a
  // extensao ter sido instalada com uma versao antiga do manifest em cache.
  await OBR.action.setWidth(420);
  await OBR.action.setHeight(550);

  role = await OBR.player.getRole();
  $("gm-controls").hidden = false

  state = await readState();
  bindEvents();
  render();

  // Re-renderiza para todos na mesa sempre que a metadata da sala mudar.
  OBR.room.onMetadataChange((metadata) => {
    state = normalizeState(metadata[METADATA_KEY]);
    render();
  });

  // O papel do jogador pode mudar durante a sessao (o mestre promove alguem).
  OBR.player.onChange((player) => {
    if (player.role && player.role !== role) {
      role = player.role;
      $("gm-controls").hidden = role !== "GM";
      render();
    }
  });

  // Relatorio final: quem encerra transmite o retrato da batalha, e todos na
  // mesa veem o mesmo pódio — cada cliente filtrando pelo proprio papel.
  OBR.broadcast.onMessage(CHANNEL_BATTLE_REPORT, (event) => {
    if (event?.data) showBattleReport(normalizeState(event.data));
  });

  // Os nomes na iniciativa acompanham o titulo do token. Como onChange dispara a
  // cada movimento, agrupamos as verificacoes numa janela curta, e so o mestre
  // grava (evita N clientes escrevendo a mesma correcao).
  if (role === "GM") {
    let syncTimer = null;
    OBR.scene.items.onChange((items) => {
      clearTimeout(syncTimer);
      syncTimer = setTimeout(() => {
        syncCombatantNames(items).catch(() => {
          /* Falha de sync de nome nao pode derrubar o painel. */
        });
      }, 400);
    });
  }

  // Se o painel foi aberto pelo menu de contexto, ja vem com a vitima escolhida.
  await consumeContextMenuTarget();

  // O painel tambem pode ser aberto e fechado varias vezes na mesma sessao;
  // em cada abertura verificamos se ha um alvo pendente esperando.
  OBR.action.onOpenChange((isOpen) => {
    if (isOpen) consumeContextMenuTarget();
  });
});
