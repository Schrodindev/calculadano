import OBR from "@owlbear-rodeo/sdk";
import {
  ID,
  createCombatant,
  mutateState,
  readState,
  resolveTokenName,
  setPendingTarget,
} from "./state.js";

/**
 * Pagina de background.
 *
 * Carrega junto com a sala e permanece viva durante toda a sessao, entao e o
 * lugar certo para registrar o menu de contexto: assim as opcoes de clique
 * direito existem mesmo que o jogador nunca abra o painel.
 *
 * Nota de implementacao: esta pagina roda num iframe oculto, onde window.prompt
 * nao aparece para o usuario. Por isso as acoes daqui nunca perguntam nada —
 * elas gravam o alvo na metadata do jogador e abrem o painel, que tem a UI
 * completa para concluir a operacao.
 */

const INITIATIVE_DEFAULT = 10;

/** Filtro comum: tokens da camada de personagem. */
const CHARACTER_FILTER = { every: [{ key: "layer", value: "CHARACTER" }] };

async function setupContextMenus() {
  // ---- ⚔️ Adicionar dano ao token ----------------------------------------
  await OBR.contextMenu.create({
    id: `${ID}/context-add-damage`,
    icons: [
      {
        icon: "/sword.svg",
        label: "⚔️ Adicionar Dano ao Token",
        filter: { ...CHARACTER_FILTER, max: 1 },
      },
    ],
    async onClick(context) {
      const item = context.items[0];
      if (!item) return;

      const state = await readState();
      if (!state.combatants.some((c) => c.id === item.id)) {
        await OBR.notification.show(
          `"${resolveTokenName(item)}" ainda não está no combate.`,
          "WARNING",
        );
        return;
      }

      // Deixa o alvo pronto para o painel e abre o painel na aba de dano.
      await setPendingTarget(item.id);
      await OBR.action.open();
    },
  });

  // ---- ➕ Adicionar a iniciativa (somente mestre) -------------------------
  await OBR.contextMenu.create({
    id: `${ID}/context-add-combatant`,
    icons: [
      {
        icon: "/plus.svg",
        label: "➕ Adicionar à Iniciativa",
        filter: { ...CHARACTER_FILTER, roles: ["GM"] },
      },
    ],
    async onClick(context) {
      const state = await readState();
      const fresh = context.items.filter(
        (item) => !state.combatants.some((c) => c.id === item.id),
      );

      if (fresh.length === 0) {
        await OBR.notification.show("Esses tokens já estão no combate.", "INFO");
        return;
      }

      // Entra com iniciativa padrao; o mestre ajusta no painel pelo lápis.
      await mutateState((draft) => {
        for (const item of fresh) {
          draft.combatants.push(
            createCombatant(item.id, resolveTokenName(item), INITIATIVE_DEFAULT),
          );
        }
      });

      await OBR.notification.show(
        `${fresh.length} combatente(s) adicionado(s) com iniciativa ${INITIATIVE_DEFAULT}.`,
        "SUCCESS",
      );
    },
  });
}

OBR.onReady(setupContextMenus);
