const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  ModalBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");
const { ids } = require("../../config");
const { getGuildConfig } = require("../../storage");
const { scoped, componentEmoji, inlineEmoji } = require("../panel");
const { getConfig, getStore, topAffiliates } = require("./store");
const V2 = MessageFlags.IsComponentsV2;
const COLOR = 0xffffff;
function accent(guildId) {
  try {
    return getGuildConfig(guildId).customColor || COLOR;
  } catch {
    return COLOR;
  }
}
function fmtBRL(value) {
  return `R$ ${Number(value || 0).toFixed(2).replace(".", ",")}`;
}
function rootPanel(client, guildId, userId) {
  const cfg = getConfig();
  const store = getStore();
  const pendingCount = Object.keys(store.pending).length;
  const paidCount = Object.keys(store.paid).length;
  const top = topAffiliates(5);
  const panel = new ContainerBuilder().setAccentColor(accent(guildId));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${inlineEmoji(client, "w_users")}Afiliados por Invite`
  ));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `Quem convida ganha comissão em saldo quando o convidado **fica 24h** no servidor. Saiu antes? O saldo some (nunca chega a cair).\n` +
    `${cfg.enabled ? `${inlineEmoji(client, "w_on")} **Ativo**` : `${inlineEmoji(client, "w_off")} **Desativado`} ╺╸ ` +
    `${inlineEmoji(client, "w_chart")} **Por convite:** ${fmtBRL(cfg.amountPerInvite)}`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `${inlineEmoji(client, "w_clock")} **Aguardando 24h:** ${pendingCount} ╺╸ ` +
    `${inlineEmoji(client, "w_check")} **Confirmados:** ${paidCount}`
  ));
  if (top.length) {
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `**Top afiliados**\n` +
      top.map((t, i) => `\`${i + 1}.\` <@${t.userId}> — **${fmtBRL(t.total)}** (${t.count})`).join("\n")
    ));
  }
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    withEmoji(client, new ButtonBuilder().setCustomId(scoped(ids.affToggle, userId)).setLabel(cfg.enabled ? "Desativar" : "Ativar").setStyle(cfg.enabled ? ButtonStyle.Danger : ButtonStyle.Success), cfg.enabled ? "w_off" : "w_on"),
    withEmoji(client, new ButtonBuilder().setCustomId(scoped(ids.affAmount, userId)).setLabel("Valor").setStyle(ButtonStyle.Secondary), "w_chart")
  ));
  return panel;
}
function withEmoji(client, builder, name) {
  const found = componentEmoji(client, name);
  return found ? builder.setEmoji(found) : builder;
}
function amountModal(userId, current) {
  const modal = new ModalBuilder().setCustomId(scoped(ids.affAmountModal, userId)).setTitle("Comissão por Invite");
  const value = Number(current) > 0 ? Number(current).toFixed(2).replace(".", ",") : "";
  const input = new TextInputBuilder().setCustomId("amount").setLabel("R$ por convite (0 = desligar valor)").setStyle(TextInputStyle.Short)
    .setRequired(true).setMaxLength(20).setPlaceholder("Ex: 2,50");
  if (value) input.setValue(value);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}
module.exports = {
  rootPanel,
  amountModal
};
