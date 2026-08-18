import OBR from "@owlbear-rodeo/sdk";

/**
 * Estado compartilhado do combate.
 *
 * Tudo vive na metadata da SALA (OBR.room), entao qualquer escrita e replicada
 * automaticamente para todos os clientes conectados. A metadata da sala tem um
 * teto de 16kB no total, por isso limitamos o numero de combatentes e o tamanho
 * dos nomes antes de gravar.
 */

export const ID = "extensao-combat";
export const METADATA_KEY = `${ID}/room-state`;

/**
 * Chave na metadata do PROPRIO jogador usada como "caixa de entrada" do menu de
 * contexto. A pagina de background e o popover sao iframes diferentes do mesmo
 * cliente; gravar aqui e mais confiavel que um broadcast, porque o dado fica
 * guardado ate o popover abrir e ler (um broadcast enviado antes do popover
 * montar seu listener se perderia).
 */
export const PENDING_TARGET_KEY = `${ID}/pending-target`;

/**
 * Canal usado ao finalizar o combate: o mestre envia o retrato final da batalha
 * para todos os clientes exibirem o mesmo relatorio. Vai por broadcast, e nao
 * por metadata, porque logo em seguida a metadata e limpa — o relatorio precisa
 * sobreviver ao encerramento.
 */
export const CHANNEL_BATTLE_REPORT = `${ID}/battle-report`;

/**
 * Teto de combatentes gravados.
 *
 * A conta: a metadata da SALA tem 16 kB no total — e esse teto e compartilhado
 * com qualquer outra extensao instalada. Um combatente com a ficha inteira
 * preenchida (sete contadores, vida e CA) ocupa ~300 bytes ja compactado, entao
 * 45 fecham em ~13 kB no pior caso e deixam folga para os vizinhos. Uma fila de
 * iniciativa maior que isso tambem nao se le num painel de 420px.
 */
const MAX_COMBATANTS = 45;
const MAX_NAME_LENGTH = 40;

/** Quantos combatentes ainda cabem na fila. */
export function remainingSlots(state) {
  return Math.max(0, MAX_COMBATANTS - state.combatants.length);
}

/** @returns {{round: number, activeTokenId: string|null, combatants: Array}} */
export function createEmptyState() {
  return { round: 1, activeTokenId: null, combatants: [] };
}

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Blinda o estado vindo da metadata: outra versao da extensao (ou uma escrita
 * malformada) nao pode derrubar a UI.
 */
export function normalizeState(raw) {
  if (!raw || typeof raw !== "object") return createEmptyState();

  const combatants = Array.isArray(raw.combatants) ? raw.combatants : [];

  return {
    round: Math.max(1, Math.round(toFiniteNumber(raw.round, 1))),
    activeTokenId: typeof raw.activeTokenId === "string" ? raw.activeTokenId : null,
    combatants: combatants
      .filter((c) => c && typeof c.id === "string")
      .slice(0, MAX_COMBATANTS)
      .map((c) => ({
        id: c.id,
        name: String(c.name ?? "Sem nome").slice(0, MAX_NAME_LENGTH),
        initiative: toFiniteNumber(c.initiative, 0),
        damageDealt: Math.max(0, Math.round(toFiniteNumber(c.damageDealt, 0))),
        damageTanked: Math.max(0, Math.round(toFiniteNumber(c.damageTanked, 0))),
        damageMitigated: Math.max(0, Math.round(toFiniteNumber(c.damageMitigated, 0))),
        damageDodged: Math.max(0, Math.round(toFiniteNumber(c.damageDodged, 0))),
        misses: Math.max(0, Math.round(toFiniteNumber(c.misses, 0))),
        hitsTaken: Math.max(0, Math.round(toFiniteNumber(c.hitsTaken, 0))),
        healingDone: Math.max(0, Math.round(toFiniteNumber(c.healingDone, 0))),
        isGMOnly: Boolean(c.isGMOnly),
        hp: normalizeHp(c.hp),
        ac: normalizeAc(c.ac),
      })),
  };
}

/** Contadores que nascem em zero — a base da compactacao antes de gravar. */
const COUNTER_KEYS = [
  "damageDealt",
  "damageTanked",
  "damageMitigated",
  "damageDodged",
  "misses",
  "hitsTaken",
  "healingDone",
];

/**
 * Enxuga o combatente para gravacao: contadores zerados, `isGMOnly: false`,
 * `hp: null` e `ac: null` simplesmente nao vao para a metadata — `normalizeState`
 * os reconstroi na leitura com exatamente os mesmos valores.
 *
 * Isso importa porque a metadata da sala tem teto de 16kB e a ficha cresceu
 * (dano mitigado, esquivado, erros, golpes recebidos). Um combatente recem
 * adicionado ocupa ~70 bytes em vez de ~300.
 */
function compactCombatant(combatant) {
  const compact = {
    id: combatant.id,
    name: combatant.name,
    initiative: combatant.initiative,
  };

  for (const key of COUNTER_KEYS) {
    if (combatant[key]) compact[key] = combatant[key];
  }

  if (combatant.isGMOnly) compact.isGMOnly = true;
  if (combatant.hp) compact.hp = combatant.hp;
  if (combatant.ac) compact.ac = combatant.ac;

  return compact;
}

/**
 * Vida so existe para quem o mestre escolheu monitorar. `null` significa
 * "sem controle de vida" — e o caso da maioria dos herois.
 */
function normalizeHp(raw) {
  if (!raw || typeof raw !== "object") return null;

  const max = Math.max(1, Math.round(toFiniteNumber(raw.max, 1)));
  const current = Math.round(toFiniteNumber(raw.current, max));

  return { current: Math.min(max, Math.max(0, current)), max };
}

/**
 * Classe de Armadura. `null` = o mestre ainda nao anotou a CA deste combatente.
 *
 * A flag `visible` e a cortina: enquanto for false, so o mestre ve o numero.
 * Ela e sempre lida de forma estrita (`=== true`) para que qualquer dado
 * malformado — ou uma versao antiga que gravava so o numero — caia no lado
 * seguro: CA oculta.
 */
function normalizeAc(raw) {
  if (raw === null || raw === undefined) return null;

  const source = typeof raw === "object" ? raw : { value: raw, visible: false };
  const parsed = Number(source.value);
  if (!Number.isFinite(parsed)) return null;

  return {
    value: Math.min(99, Math.max(0, Math.round(parsed))),
    visible: source.visible === true,
  };
}

/** Combatente novo, com todos os contadores zerados e sem controle de vida. */
export function createCombatant(id, name, initiative, isGMOnly = false) {
  return {
    id,
    name,
    initiative,
    damageDealt: 0,
    damageTanked: 0,
    damageMitigated: 0,
    damageDodged: 0,
    misses: 0,
    hitsTaken: 0,
    healingDone: 0,
    isGMOnly,
    hp: null,
    ac: null,
  };
}

export async function readState() {
  const metadata = await OBR.room.getMetadata();
  return normalizeState(metadata[METADATA_KEY]);
}

export async function writeState(state) {
  const normalized = normalizeState(state);

  // setMetadata faz spread com o que ja existe, entao so a nossa chave e tocada.
  await OBR.room.setMetadata({
    [METADATA_KEY]: {
      round: normalized.round,
      activeTokenId: normalized.activeTokenId,
      combatants: normalized.combatants.map(compactCombatant),
    },
  });
}

/**
 * Le -> altera -> grava. Sempre relendo a metadata antes de escrever, para nao
 * sobrescrever uma alteracao que outro jogador acabou de fazer.
 *
 * @param {(state: ReturnType<typeof createEmptyState>) => any} mutator
 */
export async function mutateState(mutator) {
  const current = await readState();
  const draft = structuredClone(current);
  const result = mutator(draft);
  const next = result && typeof result === "object" ? result : draft;
  await writeState(next);
  return next;
}

/* -------------------------------------------------------------------------- */
/* Nome exibido do token                                                       */
/* -------------------------------------------------------------------------- */

/** Achata a arvore de nos do texto rico (Slate) numa string simples. */
function flattenRichText(nodes) {
  if (!Array.isArray(nodes)) return "";
  return nodes
    .map((node) =>
      typeof node?.text === "string" ? node.text : flattenRichText(node?.children),
    )
    .join("");
}

/**
 * Resolve o nome que aparece na iniciativa.
 *
 * Prioridade: o TITULO escrito no token (item.text) vence o nome da imagem.
 * Assim, quando o mestre renomeia o rotulo de "goblin.png" para "Goblin Chefe",
 * a iniciativa acompanha. Se o token nao tem rotulo, cai no nome do arquivo.
 */
export function resolveTokenName(item) {
  const text = item?.text;

  if (text) {
    const raw = text.type === "RICH" ? flattenRichText(text.richText) : text.plainText;
    const title = String(raw ?? "").trim();
    if (title) return title.slice(0, MAX_NAME_LENGTH);
  }

  const fallback = String(item?.name ?? "").trim();
  return (fallback || "Sem nome").slice(0, MAX_NAME_LENGTH);
}

/**
 * Realinha os nomes guardados na metadata com os titulos atuais dos tokens.
 * Devolve true se algo mudou (e portanto foi gravado).
 *
 * So o mestre executa a escrita: se todos os clientes tentassem corrigir o mesmo
 * nome ao mesmo tempo, seriam N escritas redundantes na metadata da sala.
 */
export async function syncCombatantNames(items) {
  const liveNames = new Map(items.map((item) => [item.id, resolveTokenName(item)]));

  const current = await readState();
  const stale = current.combatants.filter((c) => {
    const live = liveNames.get(c.id);
    return live !== undefined && live !== c.name;
  });

  if (stale.length === 0) return false;

  await mutateState((draft) => {
    for (const combatant of draft.combatants) {
      const live = liveNames.get(combatant.id);
      if (live !== undefined) combatant.name = live;
    }
  });

  return true;
}

/* -------------------------------------------------------------------------- */
/* Caixa de entrada do menu de contexto                                        */
/* -------------------------------------------------------------------------- */

/** Marca um token como alvo pendente para o popover pre-selecionar. */
export async function setPendingTarget(tokenId) {
  await OBR.player.setMetadata({
    [PENDING_TARGET_KEY]: { id: tokenId, at: Date.now() },
  });
}

/** Le e limpa o alvo pendente. Devolve o id do token ou null. */
export async function consumePendingTarget() {
  const metadata = await OBR.player.getMetadata();
  const pending = metadata[PENDING_TARGET_KEY];
  if (!pending || typeof pending.id !== "string") return null;

  await OBR.player.setMetadata({ [PENDING_TARGET_KEY]: undefined });
  return pending.id;
}

/* -------------------------------------------------------------------------- */
/* Ordenacao e consultas                                                       */
/* -------------------------------------------------------------------------- */

/** Ordem de turno: maior iniciativa primeiro; empate resolvido pelo nome. */
export function sortByInitiative(combatants) {
  return [...combatants].sort(
    (a, b) => b.initiative - a.initiative || a.name.localeCompare(b.name, "pt-BR"),
  );
}

export function sortByDamageDealt(combatants) {
  return [...combatants].sort(
    (a, b) => b.damageDealt - a.damageDealt || a.name.localeCompare(b.name, "pt-BR"),
  );
}

export function sortByDamageTanked(combatants) {
  return [...combatants].sort(
    (a, b) => b.damageTanked - a.damageTanked || a.name.localeCompare(b.name, "pt-BR"),
  );
}

/**
 * Ameaca total dirigida a um combatente: o que encostou, o que a resistencia
 * cortou e o que a esquiva evitou. E a medida de "quanto perigo veio na sua
 * direcao", independente de quanto voce aguentou.
 */
export function damageFaced(combatant) {
  return combatant.damageTanked + combatant.damageMitigated + combatant.damageDodged;
}

/** Dano que o combatente anulou — o oposto do que ele levou no corpo. */
export function damageNullified(combatant) {
  return combatant.damageMitigated + combatant.damageDodged;
}

/** Ranking defensivo: quem mais anulou golpes, desempatado pelo numero de esquivas. */
export function sortByEvasion(combatants) {
  return [...combatants].sort(
    (a, b) =>
      b.misses - a.misses ||
      damageNullified(b) - damageNullified(a) ||
      a.name.localeCompare(b.name, "pt-BR"),
  );
}

export function sortByHealing(combatants) {
  return [...combatants].sort(
    (a, b) => b.healingDone - a.healingDone || a.name.localeCompare(b.name, "pt-BR"),
  );
}

/**
 * Filtro de privacidade: um PLAYER nunca ve combatentes marcados como isGMOnly
 * (monstros escondidos nao aparecem nem na iniciativa nem nos rankings).
 */
export function visibleTo(state, role) {
  if (role === "GM") return state.combatants;
  return state.combatants.filter((c) => !c.isGMOnly);
}

/* -------------------------------------------------------------------------- */
/* Regras de combate                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Avanca o turno na ordem de iniciativa. Ao dar a volta na lista, incrementa a
 * rodada. Muta o estado recebido e devolve o id do token que passou a ser o ativo.
 */
export function advanceTurn(state) {
  const order = sortByInitiative(state.combatants);
  if (order.length === 0) {
    state.activeTokenId = null;
    return null;
  }

  const currentIndex = order.findIndex((c) => c.id === state.activeTokenId);

  if (currentIndex === -1) {
    // Combate ainda nao comecou (ou o token ativo foi removido): comeca do topo.
    state.activeTokenId = order[0].id;
  } else if (currentIndex + 1 >= order.length) {
    state.activeTokenId = order[0].id;
    state.round += 1;
  } else {
    state.activeTokenId = order[currentIndex + 1].id;
  }

  return state.activeTokenId;
}

/**
 * Metade arredondada para baixo, preservando o sinal. Resistencia em RPG corta
 * o dano pela metade arredondando para baixo (51 vira 25), e manter o sinal faz
 * a correcao ser exata: lancar +51 resistido e depois -51 resistido volta a zero.
 */
function halve(value) {
  return Math.sign(value) * Math.floor(Math.abs(value) / 2);
}

/**
 * Calcula o resultado de um lancamento SEM tocar no estado. E a unica fonte da
 * verdade das regras de resistencia e esquiva: o dialogo usa para mostrar a
 * previa ("50 → 25") e `applyAttack` usa para gravar. Se as duas contas fossem
 * separadas, a previa e o placar poderiam discordar.
 *
 * @param {Array<{id: string, resistant?: boolean, missed?: boolean}>} targets
 * @param {number} amount dano bruto rolado, igual para todos os alvos
 */
export function previewAttack(targets, amount) {
  const value = Math.round(toFiniteNumber(amount, 0));

  const perTarget = (Array.isArray(targets) ? targets : []).map((target) => {
    // Esquivou: o golpe nao encosta. O valor rolado vira "dano evitado", que e
    // o que da lastro estatistico a esquiva.
    if (target.missed) {
      return {
        id: target.id,
        landed: 0,
        mitigated: 0,
        dodged: Math.max(0, value),
        missed: true,
      };
    }

    const landed = target.resistant ? halve(value) : value;
    return { id: target.id, landed, mitigated: value - landed, dodged: 0, missed: false };
  });

  return {
    value,
    perTarget,
    dealt: perTarget.reduce((sum, t) => sum + t.landed, 0),
    mitigated: perTarget.reduce((sum, t) => sum + t.mitigated, 0),
    dodged: perTarget.reduce((sum, t) => sum + t.dodged, 0),
    misses: perTarget.filter((t) => t.missed).length,
  };
}

/**
 * Lancamento de dano em lote: credita damageDealt no atacante e distribui o
 * golpe entre TODOS os alvos numa unica escrita — e assim que dano em area
 * funciona (uma bola de fogo acerta cinco criaturas com a mesma rolagem).
 *
 * Cada alvo carrega suas proprias marcacoes:
 *   - `resistant`: recebe metade (o resto entra em damageMitigated)
 *   - `missed`: nao recebe nada; o golpe evitado entra em damageDodged/misses
 *
 * O atacante e creditado pelo dano que REALMENTE encostou, somado entre os
 * alvos: mitigado e esquivado nao contam como dano causado. Sem nenhum alvo, o
 * valor cheio e creditado (dano registrado so pelo lado de quem bateu).
 *
 * @param {number} amount valor positivo (dano) ou negativo (correcao)
 */
export function applyAttack(state, attackerId, targets, amount) {
  const list = Array.isArray(targets) ? targets : [];
  const result = previewAttack(list, amount);
  if (result.value === 0) return state;

  // Valor negativo e correcao de um lancamento errado: desfaz o dano, mas nao
  // pode inventar um ataque novo na contagem de golpes recebidos/esquivados.
  const isNewAttack = result.value > 0;

  for (const outcome of result.perTarget) {
    const victim = state.combatants.find((c) => c.id === outcome.id);
    if (!victim) continue;

    if (outcome.missed) {
      victim.damageDodged = Math.max(0, victim.damageDodged + outcome.dodged);
      if (isNewAttack) victim.misses += 1;
      continue;
    }

    victim.damageTanked = Math.max(0, victim.damageTanked + outcome.landed);
    victim.damageMitigated = Math.max(0, victim.damageMitigated + outcome.mitigated);
    if (isNewAttack) victim.hitsTaken += 1;

    // Quem tem vida monitorada perde pontos no mesmo lançamento — só o que passou.
    if (victim.hp) {
      victim.hp.current = clampHp(victim.hp.current - outcome.landed, victim.hp.max);
    }
  }

  const attacker = state.combatants.find((c) => c.id === attackerId);
  if (attacker) {
    const credit = list.length === 0 ? result.value : result.dealt;
    attacker.damageDealt = Math.max(0, attacker.damageDealt + credit);
  }

  return state;
}

function clampHp(value, max) {
  return Math.min(max, Math.max(0, Math.round(value)));
}

/**
 * Registra cura, tambem em lote — cura em area devolve o mesmo valor a cada
 * alvo. So o curandeiro pontua (healingDone, somando todos os alvos); quem
 * recebeu nao acumula nada, porque "vida recebida" nao e merito de quem levou
 * o feitico.
 *
 * @param {string[]} targetIds pode vir vazio (cura registrada sem alvo)
 */
export function applyHealing(state, healerId, targetIds, amount) {
  const value = Math.round(toFiniteNumber(amount, 0));
  if (value === 0) return state;

  const ids = Array.isArray(targetIds) ? targetIds : targetIds ? [targetIds] : [];

  let healed = 0;
  for (const id of ids) {
    const target = state.combatants.find((c) => c.id === id);
    if (!target) continue;

    healed += value;
    // O alvo nao ganha merito, mas recupera vida se estiver sendo monitorado.
    if (target.hp) target.hp.current = clampHp(target.hp.current + value, target.hp.max);
  }

  const healer = state.combatants.find((c) => c.id === healerId);
  if (healer) {
    const credit = ids.length === 0 ? value : healed;
    healer.healingDone = Math.max(0, healer.healingDone + credit);
  }

  return state;
}

/* -------------------------------------------------------------------------- */
/* Controle de vida                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Passa a monitorar a vida de um combatente ja presente na iniciativa.
 * A entrada na lista de vida e sempre manual — se fosse automatica, os herois
 * cairiam junto com os monstros.
 */
export function trackHp(state, id, max, current = null) {
  const combatant = state.combatants.find((c) => c.id === id);
  if (!combatant) return state;

  const maxHp = Math.max(1, Math.round(toFiniteNumber(max, 1)));
  combatant.hp = {
    max: maxHp,
    current: clampHp(current === null ? maxHp : current, maxHp),
  };

  return state;
}

/**
 * Remove o combatente do controle de vida (continua na iniciativa). A CA
 * anotada sobrevive: voltar a monitorar traz o numero de volta como estava.
 */
export function untrackHp(state, id) {
  const combatant = state.combatants.find((c) => c.id === id);
  if (combatant) combatant.hp = null;
  return state;
}

/** Soma (ou subtrai) vida diretamente, sem mexer nas estatisticas de dano. */
export function adjustHp(state, id, delta) {
  const combatant = state.combatants.find((c) => c.id === id);
  if (combatant?.hp) {
    combatant.hp.current = clampHp(combatant.hp.current + delta, combatant.hp.max);
  }
  return state;
}

/**
 * Faixas de estado exibidas aos JOGADORES. Eles nunca veem numeros — apenas o
 * quao ferido o monstro esta, o que preserva a tensao sem entregar a ficha.
 */
export const HP_STATUSES = [
  { key: "dead", min: 0, max: 0, icon: "💀", label: "Abatido" },
  { key: "critical", min: 1, max: 33, icon: "❤️", label: "Quase morrendo" },
  { key: "hurt", min: 34, max: 66, icon: "💛", label: "Ferido" },
  { key: "healthy", min: 67, max: 100, icon: "💚", label: "Vivo" },
];

/** Percentual (0-100) e faixa de estado de um combatente monitorado. */
export function hpStatus(hp) {
  if (!hp) return null;

  const percent = hp.max > 0 ? Math.round((hp.current / hp.max) * 100) : 0;
  const status =
    HP_STATUSES.find((s) => percent >= s.min && percent <= s.max) ?? HP_STATUSES[0];

  return { percent, ...status };
}

/** Só quem o mestre colocou sob controle de vida. */
export function trackedCombatants(combatants) {
  return combatants.filter((c) => c.hp);
}

/* -------------------------------------------------------------------------- */
/* Classe de Armadura                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Define (ou corrige) a CA de um combatente.
 *
 * Uma CA nova nasce SEMPRE oculta para os jogadores — descobrir a defesa do
 * monstro errando ataques faz parte da mesa. Ja uma CA que o mestre editou
 * depois de revelar mantem a revelacao: corrigir o numero nao deve escondê-lo
 * de novo sem que ninguem tenha pedido.
 *
 * Valor invalido limpa a CA (mesmo efeito de `clearAc`).
 */
export function setAc(state, id, value, visible = null) {
  const combatant = state.combatants.find((c) => c.id === id);
  if (!combatant) return state;

  const inherited = visible === null ? combatant.ac?.visible === true : visible === true;
  combatant.ac = normalizeAc({ value, visible: inherited });

  return state;
}

/** Remove a anotacao de CA (o combatente continua no controle de vida). */
export function clearAc(state, id) {
  const combatant = state.combatants.find((c) => c.id === id);
  if (combatant) combatant.ac = null;
  return state;
}

/** Abre ou fecha a cortina: revela a CA para a mesa, ou volta a escondê-la. */
export function setAcVisibility(state, id, visible) {
  const combatant = state.combatants.find((c) => c.id === id);
  if (combatant?.ac) combatant.ac.visible = visible === true;
  return state;
}

/**
 * A CA que ESTE papel pode ver. Devolve `null` quando o segredo vale para quem
 * esta olhando — a UI simplesmente nao desenha nada nesse caso.
 */
export function visibleAc(combatant, role) {
  const ac = combatant?.ac;
  if (!ac) return null;
  return role === "GM" || ac.visible ? ac : null;
}

/**
 * Zera rodada, turno ativo e todos os contadores, preservando os combatentes.
 * Quem esta sob controle de vida volta com a barra cheia — refazer a luta com
 * os monstros ainda machucados nao seria um "reset".
 *
 * A CA sobrevive ao reset (numero e revelacao): ela descreve o monstro, nao o
 * andamento da luta.
 */
export function resetCombat(state) {
  state.round = 1;
  state.activeTokenId = null;
  for (const combatant of state.combatants) {
    for (const key of COUNTER_KEYS) combatant[key] = 0;
    if (combatant.hp) combatant.hp.current = combatant.hp.max;
  }
  return state;
}

/**
 * Encerra o encontro: alem de zerar os contadores, esvazia a fila de iniciativa.
 * E o que diferencia "Finalizar" de "Resetar" — o proximo combate comeca do zero,
 * com outros participantes.
 */
export function endCombat(state) {
  state.round = 1;
  state.activeTokenId = null;
  state.combatants = [];
  return state;
}

/* -------------------------------------------------------------------------- */
/* Pontuacao de MVP                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Os cinco pilares do Indice de Contribuicao, com o peso de cada um. Os pesos
 * somam 100, entao o indice ja nasce numa escala de 0 a 100: 100 seria ser o
 * melhor da mesa em TODOS os pilares ao mesmo tempo.
 *
 * A explicacao completa (com exemplo numerico) esta em docs/pontuacao-mvp.md.
 */
export const MVP_PILLARS = [
  {
    key: "offense",
    weight: 30,
    icon: "⚔️",
    label: "Ofensiva",
    hint: "dano que realmente encostou no inimigo",
  },
  {
    key: "wall",
    weight: 20,
    icon: "🛡️",
    label: "Muralha",
    hint: "dano absorvido no proprio corpo",
  },
  {
    key: "evasion",
    weight: 20,
    icon: "💨",
    label: "Evasão",
    hint: "dano anulado por esquiva e resistência",
  },
  {
    key: "support",
    weight: 15,
    icon: "💚",
    label: "Suporte",
    hint: "vida devolvida ao grupo",
  },
  {
    key: "efficiency",
    weight: 15,
    icon: "♟️",
    label: "Eficiência",
    hint: "bateu muito sem apanhar na mesma medida",
  },
];

/**
 * Dentro do pilar de Evasao, quanto vale o DANO anulado contra a QUANTIDADE de
 * golpes evitados.
 *
 * Os dois existem porque nem toda mesa anota a rolagem de um ataque que errou.
 * Se so contassemos dano evitado, o mestre que digita 0 num miss zeraria a
 * esquiva do jogador; se so contassemos a quantidade, esquivar de um tapinha
 * valeria igual a esquivar de uma bola de fogo.
 */
export const EVASION_DAMAGE_SHARE = 0.7;

/**
 * Converte uma lista de valores brutos em notas de 0 a 1, comparadas ao melhor
 * da mesa. E o que torna o indice justo em qualquer escala de campanha: o que
 * conta e o desempenho RELATIVO, nao o numero absoluto de dano.
 */
function shareOfMax(values) {
  const max = Math.max(0, ...values);
  return max > 0 ? values.map((v) => Math.max(0, v) / max) : values.map(() => 0);
}

/**
 * Valor bruto de cada pilar, na mesma ordem da lista de combatentes recebida.
 *
 * Note que nada aqui se sobrepoe: o dano que encostou alimenta a Muralha, o
 * dano que NAO encostou alimenta a Evasao. Somados, dao a ameaca total dirigida
 * aquele combatente — cada ponto de dano e contado uma vez so.
 */
function pillarValues(list) {
  const offense = list.map((c) => c.damageDealt);
  const wall = list.map((c) => c.damageTanked);
  const support = list.map((c) => c.healingDone);

  // Evasao: mistura de "quanto dano voce anulou" com "quantos golpes voce evitou".
  const nullifiedShare = shareOfMax(list.map(damageNullified));
  const dodgeShare = shareOfMax(list.map((c) => c.misses));
  const evasion = list.map(
    (_, i) =>
      EVASION_DAMAGE_SHARE * nullifiedShare[i] + (1 - EVASION_DAMAGE_SHARE) * dodgeShare[i],
  );

  // Eficiencia: a qualidade da troca (quanto do dano da sua briga foi VOCE
  // batendo) multiplicada pelo volume de dano causado. O volume e o pedagio
  // contra o carona: quem causou 5 de dano e nao apanhou tem troca perfeita,
  // mas ponderada por um volume quase zero — nao vira MVP por ter ficado atras.
  const offenseShare = shareOfMax(offense);
  const efficiency = list.map((c, i) => {
    const traded = c.damageDealt + c.damageTanked;
    return traded > 0 ? (c.damageDealt / traded) * offenseShare[i] : 0;
  });

  return { offense, wall, evasion, support, efficiency };
}

/**
 * Calcula o Indice de Contribuicao (0 a 100) de cada combatente.
 *
 * 1. Cada pilar vira uma nota de 0 a 1 comparada ao melhor da mesa.
 * 2. Pilares sem NENHUM registro na batalha saem da conta e seu peso e
 *    redistribuido entre os demais. E o que resolve o "nem todo grupo tem
 *    curandeiro": numa mesa sem cura, ninguem carrega 15 pontos mortos.
 * 3. Nota x peso efetivo, somado = o indice.
 *
 * @returns {{ranking: Array, pillars: Array}} ranking ordenado do maior para o
 *          menor indice, e os pilares que efetivamente valeram nesta batalha
 *          (com o peso ja redistribuido) para a UI conseguir explicar a conta.
 */
export function computeMvpRanking(combatants) {
  const list = [...combatants];
  if (list.length === 0) return { ranking: [], pillars: [] };

  const raw = pillarValues(list);

  // Um pilar so entra na conta se alguem pontuou nele nesta batalha.
  const active = MVP_PILLARS.filter((pillar) => Math.max(0, ...raw[pillar.key]) > 0);
  const totalWeight = active.reduce((sum, pillar) => sum + pillar.weight, 0);

  if (totalWeight === 0) {
    return {
      ranking: list.map((combatant) => ({ combatant, score: 0, breakdown: [] })),
      pillars: [],
    };
  }

  // Peso efetivo: os pesos dos pilares ativos reescalados para somar 100.
  const pillars = active.map((pillar) => ({
    ...pillar,
    effectiveWeight: (pillar.weight / totalWeight) * 100,
  }));

  const shares = new Map(pillars.map((pillar) => [pillar.key, shareOfMax(raw[pillar.key])]));

  const ranking = list.map((combatant, index) => {
    const breakdown = [];
    let score = 0;

    for (const pillar of pillars) {
      const share = shares.get(pillar.key)[index];
      if (share <= 0) continue;

      const points = share * pillar.effectiveWeight;
      score += points;
      breakdown.push({ ...pillar, share, points, raw: raw[pillar.key][index] });
    }

    // O detalhamento aparece do pilar que mais rendeu para o que menos rendeu.
    breakdown.sort((a, b) => b.points - a.points);

    return { combatant, score, breakdown };
  });

  ranking.sort(
    (a, b) =>
      b.score - a.score ||
      b.combatant.damageDealt - a.combatant.damageDealt ||
      damageFaced(b.combatant) - damageFaced(a.combatant) ||
      b.combatant.healingDone - a.combatant.healingDone ||
      a.combatant.name.localeCompare(b.combatant.name, "pt-BR"),
  );

  return { ranking, pillars };
}

/* -------------------------------------------------------------------------- */
/* Camera                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Centraliza a camera no token da vez.
 *
 * Nota sobre a API: ViewportTransform e `{ position, scale }` e o `position` e
 * o deslocamento do viewport, nao a posicao do token no mundo. Passar a posicao
 * do item direto em animateTo() joga a camera para o lugar errado. O caminho
 * documentado e animateToBounds(), que recebe uma caixa em coordenadas de mundo
 * e a enquadra na tela. Para controlar o zoom, montamos uma caixa centrada no
 * token cujo tamanho em unidades de mundo equivale a tela dividida pelo zoom.
 */
export async function focusOnToken(tokenId, zoom = 1) {
  if (!tokenId) return false;
  if (!(await OBR.scene.isReady())) return false;

  const [item] = await OBR.scene.items.getItems([tokenId]);
  if (!item) return false;

  let center = item.position;
  try {
    const bounds = await OBR.scene.items.getItemBounds([tokenId]);
    if (bounds?.center) center = bounds.center;
  } catch {
    // Sem bounds disponiveis, a posicao do item ja e uma aproximacao boa.
  }

  const safeZoom = Math.min(4, Math.max(0.1, toFiniteNumber(zoom, 1)));
  const halfWidth = (await OBR.viewport.getWidth()) / safeZoom / 2;
  const halfHeight = (await OBR.viewport.getHeight()) / safeZoom / 2;

  await OBR.viewport.animateToBounds({
    min: { x: center.x - halfWidth, y: center.y - halfHeight },
    max: { x: center.x + halfWidth, y: center.y + halfHeight },
    center: { x: center.x, y: center.y },
    width: halfWidth * 2,
    height: halfHeight * 2,
  });

  return true;
}
