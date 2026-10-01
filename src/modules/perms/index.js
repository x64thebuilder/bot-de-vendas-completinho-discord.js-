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
  TextInputStyle,
  UserSelectMenuBuilder
} = require("discord.js");
const { ids } = require("../../config");
const { getGuildConfig, setGuildConfig } = require("../../storage");
const { botOwnerIds } = require("../../botOwners");
const V2 = MessageFlags.IsComponentsV2;
const V2_EPHEMERAL = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
const COLOR = 0xffffff;
const OK_COLOR = 0x2ecc71;
const DANGER_COLOR = 0xe74c3c;
function container(title, description, color = COLOR) {
  return new ContainerBuilder()
    .setAccentColor(color)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}\n${description}`))
    .addSeparatorComponents(new SeparatorBuilder());
}
function button(id, label, style) {
  return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
}
function isBotOwner(interaction) {
  return botOwnerIds(interaction.guild).includes(interaction.user.id);
}
function permsPayload(guildId) {
  const config = getGuildConfig(guildId);
  const users = config.permissions.users || [];
  const list = users.length
    ? users.map((id, index) => `**${index + 1}.** <@${id}> \`${id}\``).join("\n")
    : "`Nenhum usuario com permissao extra.`";
  const panel = container(
    "Permissoes do Bot",
    `Usuarios com permissao total para mexer no bot neste servidor:\n\n${list}`,
    COLOR
  );
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      button(ids.permsAdd, "Adicionar", ButtonStyle.Success),
      button(ids.permsRemove, "Remover", ButtonStyle.Danger)
    )
  );
  return { components: [panel], flags: V2_EPHEMERAL };
}
function userPickerPayload(mode) {
  const adding = mode === "add";
  const panel = container(
    adding ? "Adicionar permissao" : "Remover permissao",
    adding
      ? "Selecione a pessoa que recebera permissao total no bot."
      : "Selecione a pessoa que perdera a permissao extra.",
    adding ? OK_COLOR : DANGER_COLOR
  );
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId(adding ? ids.permsAddSelect : ids.permsRemoveSelect)
        .setPlaceholder(adding ? "Selecione quem sera adicionado" : "Selecione quem sera removido")
        .setMinValues(1)
        .setMaxValues(1)
    )
  );
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      button(adding ? ids.permsAddId : ids.permsRemoveId, adding ? "Adicionar por ID" : "Remover por ID", ButtonStyle.Secondary),
      button(ids.permsCancel, "Cancelar", ButtonStyle.Secondary)
    )
  );
  return { components: [panel], flags: V2_EPHEMERAL };
}
function confirmPayload(mode, targetId) {
  const adding = mode === "add";
  const panel = container(
    adding ? "Confirmar permissao" : "Confirmar remocao",
    adding
      ? `Tem certeza que deseja dar permissao total para <@${targetId}>?\n\nEssa pessoa podera usar o painel e mexer nas configuracoes do bot.`
      : `Tem certeza que deseja remover a permissao extra de <@${targetId}>?`,
    adding ? OK_COLOR : DANGER_COLOR
  );
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      button(`${adding ? ids.permsConfirmAdd : ids.permsConfirmRemove}:${targetId}`, adding ? "Sim, adicionar" : "Sim, remover", adding ? ButtonStyle.Success : ButtonStyle.Danger),
      button(ids.permsCancel, "Cancelar", ButtonStyle.Secondary)
    )
  );
  return { components: [panel], flags: V2_EPHEMERAL };
}
function idModal(mode, ownerId) {
  return new ModalBuilder()
    .setCustomId(`${ids.permsIdModal}:${mode}:${ownerId}`)
    .setTitle(mode === "add" ? "Adicionar por ID" : "Remover por ID")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("userId")
          .setLabel("ID do usuario")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}
async function handlePermsCommand(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "perms") return false;
  if (!interaction.inGuild()) {
    await interaction.reply({ content: "Use este comando dentro de um servidor.", flags: MessageFlags.Ephemeral });
    return true;
  }
  if (!isBotOwner(interaction)) {
    await interaction.reply({ content: "Somente o owner do bot pode usar /perms.", flags: MessageFlags.Ephemeral });
    return true;
  }
  await interaction.reply(permsPayload(interaction.guildId));
  return true;
}
async function handlePermsInteraction(interaction) {
  if (!interaction.customId?.startsWith("perms:")) return false;
  if (!isBotOwner(interaction)) {
    await interaction.reply({ content: "Somente o owner do bot pode gerenciar permissoes.", flags: MessageFlags.Ephemeral });
    return true;
  }
  if (interaction.customId === ids.permsAdd) {
    await interaction.update(userPickerPayload("add"));
    return true;
  }
  if (interaction.customId === ids.permsRemove) {
    await interaction.update(userPickerPayload("remove"));
    return true;
  }
  if (interaction.customId === ids.permsAddSelect || interaction.customId === ids.permsRemoveSelect) {
    const mode = interaction.customId === ids.permsAddSelect ? "add" : "remove";
    await interaction.update(confirmPayload(mode, interaction.values[0]));
    return true;
  }
  if (interaction.customId === ids.permsAddId || interaction.customId === ids.permsRemoveId) {
    await interaction.showModal(idModal(interaction.customId === ids.permsAddId ? "add" : "remove", interaction.user.id));
    return true;
  }
  if (interaction.customId.startsWith(`${ids.permsConfirmAdd}:`)) {
    await addPermission(interaction, interaction.customId.split(":").at(-1));
    return true;
  }
  if (interaction.customId.startsWith(`${ids.permsConfirmRemove}:`)) {
    await removePermission(interaction, interaction.customId.split(":").at(-1));
    return true;
  }
  if (interaction.customId === ids.permsCancel) {
    await interaction.update(permsPayload(interaction.guildId));
    return true;
  }
  return false;
}
async function handlePermsModal(interaction) {
  if (!interaction.customId?.startsWith(`${ids.permsIdModal}:`)) return false;
  const [, , , mode, ownerId] = interaction.customId.split(":");
  if (ownerId !== interaction.user.id || !isBotOwner(interaction)) {
    await interaction.reply({ content: "Este modal nao pertence a voce.", flags: MessageFlags.Ephemeral });
    return true;
  }
  const targetId = interaction.fields.getTextInputValue("userId").replace(/\D/g, "");
  if (!targetId) {
    await interaction.reply({ content: "ID invalido.", flags: MessageFlags.Ephemeral });
    return true;
  }
  await interaction.update(confirmPayload(mode, targetId));
  return true;
}
async function addPermission(interaction, targetId) {
  if (botOwnerIds(interaction.guild).includes(targetId)) {
    await interaction.update(permsPayload(interaction.guildId));
    await interaction.followUp({ content: "Esse usuario ja e owner do bot.", flags: MessageFlags.Ephemeral });
    return;
  }
  setGuildConfig(interaction.guildId, (config) => {
    config.permissions.users = Array.from(new Set([...(config.permissions.users || []), targetId]));
    return config;
  });
  await interaction.update(permsPayload(interaction.guildId));
  await interaction.followUp({ content: `<@${targetId}> agora tem permissao total no bot.`, flags: MessageFlags.Ephemeral });
}
async function removePermission(interaction, targetId) {
  setGuildConfig(interaction.guildId, (config) => {
    config.permissions.users = (config.permissions.users || []).filter((id) => id !== targetId);
    return config;
  });
  await interaction.update(permsPayload(interaction.guildId));
  await interaction.followUp({ content: `<@${targetId}> teve a permissao removida.`, flags: MessageFlags.Ephemeral });
}
function hasBotPermission(interaction) {
  if (!interaction.inGuild()) return false;
  if (isBotOwner(interaction)) return true;
  const config = getGuildConfig(interaction.guildId);
  return (config.permissions.users || []).includes(interaction.user.id);
}
module.exports = {
  handlePermsCommand,
  handlePermsInteraction,
  handlePermsModal,
  hasBotPermission,
  isBotOwner,
  botOwnerIds
};
