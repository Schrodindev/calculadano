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

const MAX_COMBATANTS = 60;
const MAX_NAME_LENGTH = 40;

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
        healingDone: Math.max(0, Math.round(toFiniteNumber(c.healingDone, 0))),
        isGMOnly: Boolean(c.isGMOnly),
        hp: normalizeHp(c.hp),
        ac: normalizeAc(c.ac),
      })),
  };
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
  // setMetadata faz spread com o que ja existe, entao so a nossa chave e tocada.
  await OBR.room.setMetadata({ [METADATA_KEY]: normalizeState(state) });
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
 * Lancamento duplo de dano: credita damageDealt no atacante e damageTanked na
 * vitima na mesma escrita. Atacante e vitima podem ser o mesmo combatente
 * (dano em si proprio) e qualquer um dos dois pode ser omitido.
 *
 * @param {number} amount valor positivo (dano) ou negativo (correcao/cura)
 */
export function applyDamage(state, attackerId, victimId, amount) {
  const value = Math.round(toFiniteNumber(amount, 0));
  if (value === 0) return state;

  const attacker = state.combatants.find((c) => c.id === attackerId);
  const victim = state.combatants.find((c) => c.id === victimId);

  if (attacker) attacker.damageDealt = Math.max(0, attacker.damageDealt + value);

  if (victim) {
    victim.damageTanked = Math.max(0, victim.damageTanked + value);
    // Quem tem vida monitorada perde pontos no mesmo lançamento.
    if (victim.hp) victim.hp.current = clampHp(victim.hp.current - value, victim.hp.max);
  }

  return state;
}

function clampHp(value, max) {
  return Math.min(max, Math.max(0, Math.round(value)));
}

/**
 * Registra cura. So o curandeiro pontua (healingDone); o alvo nao acumula nada,
 * porque "vida recebida" nao e merito de quem levou o feitico.
 */
export function applyHealing(state, healerId, targetId, amount) {
  const value = Math.round(toFiniteNumber(amount, 0));
  if (value === 0) return state;

  const healer = state.combatants.find((c) => c.id === healerId);
  if (healer) healer.healingDone = Math.max(0, healer.healingDone + value);

  // O alvo nao ganha merito, mas recupera vida se estiver sendo monitorado.
  const target = state.combatants.find((c) => c.id === targetId);
  if (target?.hp) target.hp.current = clampHp(target.hp.current + value, target.hp.max);

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
    combatant.damageDealt = 0;
    combatant.damageTanked = 0;
    combatant.healingDone = 0;
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
 * Pontos por posicao no podio de UMA categoria. Fora do top 3, zero.
 * Ver docs/pontuacao-mvp.md para a explicacao completa.
 */
export const PODIUM_POINTS = [5, 3, 1];

/**
 * Peso de cada categoria. Dano vale mais, tank vem em seguida, cura fecha como
 * ponto de utilidade.
 */
export const CATEGORY_WEIGHTS = [
  { key: "damageDealt", weight: 3, label: "Dano", icon: "⚔️" },
  { key: "damageTanked", weight: 2, label: "Tank", icon: "🛡️" },
  { key: "healingDone", weight: 1, label: "Cura", icon: "💚" },
];

/**
 * Calcula a pontuacao de MVP de cada combatente.
 *
 * Para cada categoria montamos um podio (so quem tem valor > 0 entra) e damos
 * 5/3/1 ponto ao 1o/2o/3o. Esse ponto e multiplicado pelo peso da categoria e
 * tudo e somado. Maximo teorico: 3x5 + 2x5 + 1x5 = 30.
 *
 * O desempate final e por dano bruto, depois tank, depois cura — assim dois
 * empates de podio nunca ficam em ordem aleatoria.
 *
 * @returns lista ordenada do maior para o menor score, com o detalhamento
 *          usado no relatorio de batalha.
 */
export function computeMvpRanking(combatants) {
  const scores = new Map(
    combatants.map((c) => [c.id, { combatant: c, score: 0, breakdown: [] }]),
  );

  for (const category of CATEGORY_WEIGHTS) {
    const podium = [...combatants]
      .filter((c) => c[category.key] > 0)
      .sort(
        (a, b) =>
          b[category.key] - a[category.key] || a.name.localeCompare(b.name, "pt-BR"),
      )
      .slice(0, PODIUM_POINTS.length);

    podium.forEach((combatant, index) => {
      const points = PODIUM_POINTS[index] * category.weight;
      const entry = scores.get(combatant.id);
      if (!entry) return;

      entry.score += points;
      entry.breakdown.push({
        ...category,
        position: index + 1,
        value: combatant[category.key],
        points,
      });
    });
  }

  return [...scores.values()].sort(
    (a, b) =>
      b.score - a.score ||
      b.combatant.damageDealt - a.combatant.damageDealt ||
      b.combatant.damageTanked - a.combatant.damageTanked ||
      b.combatant.healingDone - a.combatant.healingDone ||
      a.combatant.name.localeCompare(b.combatant.name, "pt-BR"),
  );
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
