const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");
const { ids } = require("../../config");
const { normalizeEmojiName } = require("../../emojis");
const { hasBotPermission } = require("../perms");
const { generateBackupCode, saveBackup, getBackup, listGuildBackups } = require("./storage");
const { collectGuildSnapshot, wipeGuild, restoreGuildSnapshot } = require("./service");
const V2 = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
const COLOR = 0xffffff;
const OK_COLOR = 0x2ecc71;
const DANGER_COLOR = 0xe74c3c;
const WARN_COLOR = 0xf1c40f;
const MANAGE_EMOJI_PERMISSION = PermissionFlagsBits.ManageGuildExpressions ?? PermissionFlagsBits.ManageEmojisAndStickers;
const SELECT_PAGE_SIZE = 25;
const MAX_LIST_SELECTS = 4; 
function container(title, description, color = COLOR) {
  return new ContainerBuilder()
    .setAccentColor(color)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}\n${description}`))
    .addSeparatorComponents(new SeparatorBuilder());
}
function componentEmoji(client, name) {
  const normalized = normalizeEmojiName(name);
  const found = client.appEmojis?.get(normalized);
  if (!found) return undefined;
  return { id: found.id, name: found.name, animated: found.animated };
}
function button(id, label, style, client, emojiName) {
  const built = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
  if (client && emojiName) {
    const found = componentEmoji(client, emojiName);
    if (found) built.setEmoji(found);
  }
  return built;
}
function backButton(client, id, label = "Voltar") {
  return button(id, label, ButtonStyle.Secondary, client, "arrow_left");
}
function payload(panel) {
  return { components: [panel], flags: V2 };
}
function formatDate(ms) {
  return new Date(ms).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}
function statsLine(stats) {
  return `🎭 **${stats.roles}** cargo(s) • 🗂️ **${stats.categories}** categoria(s) • 💬 **${stats.channels}** canal(is) • 😀 **${stats.emojis}** emoji(s)`;
}
function statsShort(stats) {
  return `${stats.roles} cargos • ${stats.categories} categorias • ${stats.channels} canais • ${stats.emojis} emojis`.slice(0, 100);
}
function isBackupAllowed(interaction) {
  if (!interaction.inGuild()) return false;
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  return hasBotPermission(interaction);
}
function isRestoreAllowed(interaction) {
  if (!interaction.inGuild()) return false;
  return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.Administrator));
}
function missingBotPermissions(guild) {
  const me = guild.members.me;
  if (!me) return ["Administrator"];
  const required = [
    [PermissionFlagsBits.ManageChannels, "Gerenciar Canais"],
    [PermissionFlagsBits.ManageRoles, "Gerenciar Cargos"],
    [MANAGE_EMOJI_PERMISSION, "Gerenciar Emojis"]
  ];
  return required.filter(([flag]) => flag && !me.permissions.has(flag)).map(([, label]) => label);
}
function mainMenuPayload(client) {
  const panel = container(
    "💾 Sistema de Backup",
    "Escolha uma opção abaixo. Você pode criar um backup completo do servidor, ver os backups já criados ou restaurar o servidor a partir de um deles."
  );
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(ids.backupMenu)
        .setPlaceholder("O que você deseja fazer?")
        .addOptions(
          {
            label: "Criar Backup",
            value: "create",
            description: "Salva categorias, canais, cargos e emojis do servidor",
            emoji: componentEmoji(client, "db")
          },
          {
            label: "Listar Backups",
            value: "list",
            description: "Veja todos os backups já criados neste servidor",
            emoji: componentEmoji(client, "package")
          },
          {
            label: "Restaurar Servidor",
            value: "restore",
            description: "Restaura o servidor a partir de um backup",
            emoji: componentEmoji(client, "carregaranimado")
          }
        )
    )
  );
  return payload(panel);
}
function backupOptions(client, backups) {
  return backups.map((backup) => ({
    label: `Backup de ${formatDate(backup.createdAt)}`.slice(0, 100),
    value: backup.code,
    description: statsShort(backup.stats),
    emoji: componentEmoji(client, "db")
  }));
}
function listBackupsPayload(client, guildId) {
  const backups = listGuildBackups(guildId);
  if (!backups.length) {
    const panel = container(
      "📦 Listar Backups",
      "Nenhum backup foi criado ainda neste servidor.\n\nVolte ao menu e use **Criar Backup** para gerar o primeiro."
    );
    panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, ids.backupBackMenu)));
    return payload(panel);
  }
  const shown = backups.slice(0, SELECT_PAGE_SIZE * MAX_LIST_SELECTS);
  const extraNote = backups.length > shown.length
    ? `\n\nMostrando os ${shown.length} backups mais recentes de um total de ${backups.length}.`
    : "";
  const panel = container(
    "📦 Listar Backups",
    `Este servidor já tem **${backups.length}** backup(s) criado(s). Selecione um para ver os detalhes.${extraNote}`
  );
  const pages = [];
  for (let i = 0; i < shown.length; i += SELECT_PAGE_SIZE) {
    pages.push(shown.slice(i, i + SELECT_PAGE_SIZE));
  }
  pages.forEach((page, index) => {
    const first = formatDate(page[0].createdAt);
    const last = formatDate(page.at(-1).createdAt);
    panel.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${ids.backupListSelect}:${index}`)
          .setPlaceholder(pages.length > 1 ? `Backups ${first} → ${last}` : "Selecione um backup")
          .addOptions(backupOptions(client, page))
      )
    );
  });
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, ids.backupBackMenu)));
  return payload(panel);
}
function backupDetailPayload(client, guildId, code) {
  const backup = getBackup(code);
  if (!backup) {
    const panel = container("❌ Backup não encontrado", `O backup \`${code}\` não existe mais.`, DANGER_COLOR);
    panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, ids.backupListBack, "Voltar à lista")));
    return payload(panel);
  }
  const panel = container(
    "📦 Detalhes do Backup",
    [
      `**Código:** \`${backup.code}\``,
      `**Servidor de origem:** ${backup.guildName}`,
      `**Criado por:** <@${backup.createdBy}>`,
      `**Criado em:** ${formatDate(backup.createdAt)}`,
      "",
      statsLine(backup.stats)
    ].join("\n")
  );
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      button(`${ids.backupListRestore}:${code}`, "Restaurar este backup", ButtonStyle.Danger, client, "carregaranimado"),
      backButton(client, ids.backupListBack, "Voltar à lista")
    )
  );
  return payload(panel);
}
function restoreMenuPayload(client, guildId) {
  const backups = listGuildBackups(guildId).slice(0, SELECT_PAGE_SIZE);
  const panel = container(
    "♻️ Restaurar Servidor",
    [
      "⚠️ **Atenção:** restaurar um backup apaga todos os canais, categorias, cargos e emojis atuais do servidor antes de recriar tudo a partir do backup escolhido. Essa ação não pode ser desfeita.",
      "",
      backups.length
        ? "Selecione um dos backups mais recentes deste servidor, ou use o botão abaixo para restaurar por código (inclusive de outra conta/servidor)."
        : "Nenhum backup foi criado neste servidor ainda. Use o botão abaixo para restaurar a partir de um código."
    ].join("\n"),
    WARN_COLOR
  );
  if (backups.length) {
    panel.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${ids.backupRestoreSelect}:0`)
          .setPlaceholder("Selecione um backup recente")
          .addOptions(backupOptions(client, backups))
      )
    );
  }
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      button(ids.backupRestoreUseCode, "Usar Código", ButtonStyle.Primary, client, "editar"),
      backButton(client, ids.backupBackMenu)
    )
  );
  return payload(panel);
}
function confirmRestorePayload(client, code) {
  const backup = getBackup(code);
  if (!backup) return null;
  const panel = container(
    "⚠️ Tem certeza?",
    [
      `Você está prestes a restaurar o backup \`${backup.code}\`, criado em ${formatDate(backup.createdAt)} a partir do servidor **${backup.guildName}**.`,
      "",
      statsLine(backup.stats),
      "",
      "🚨 **Isso vai apagar AGORA todos os canais, categorias, cargos e emojis deste servidor** para recriar tudo do zero de acordo com o backup. Essa ação é irreversível.",
      "",
      "Tem certeza que deseja continuar?"
    ].join("\n"),
    DANGER_COLOR
  );
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      button(`${ids.backupConfirmYes}:${code}`, "Sim, restaurar", ButtonStyle.Danger, client, "check"),
      button(ids.backupConfirmNo, "Cancelar", ButtonStyle.Secondary, client, "negativo")
    )
  );
  return payload(panel);
}
function progressPayload(label, current, total) {
  const safeTotal = total || Math.max(current, 1);
  const ratio = Math.min(1, current / safeTotal);
  const filled = Math.round(ratio * 20);
  const bar = `${"█".repeat(filled)}${"░".repeat(20 - filled)}`;
  const panel = container(
    "♻️ Restaurando servidor...",
    `${label}\n\n\`${bar}\` ${current}/${safeTotal}\n\nIsso pode levar alguns minutos dependendo do tamanho do servidor. Não feche esta mensagem.`,
    WARN_COLOR
  );
  return payload(panel);
}
function restoreSummaryPayload(client, backup, summary) {
  const hasFailures = summary.failed > 0;
  const panel = container(
    hasFailures ? "⚠️ Servidor restaurado com avisos" : "✅ Servidor restaurado!",
    [
      `O backup \`${backup.code}\` (${backup.guildName}) foi restaurado.`,
      "",
      `🎭 **${summary.roles}** cargo(s) recriado(s)`,
      `🗂️ **${summary.categories}** categoria(s) recriada(s)`,
      `💬 **${summary.channels}** canal(is) recriado(s)`,
      `😀 **${summary.emojis}** emoji(s) recriado(s)`,
      hasFailures ? `\n⚠️ ${summary.failed} item(ns) não puderam ser recriados (permissões ou limites do Discord).` : ""
    ].join("\n"),
    hasFailures ? WARN_COLOR : OK_COLOR
  );
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, ids.backupBackMenu, "Voltar ao menu")));
  return payload(panel);
}
function missingPermissionsPayload(client, missing) {
  const panel = container(
    "❌ Permissões insuficientes",
    `Eu preciso das seguintes permissões para restaurar o servidor:\n\n${missing.map((label) => `• ${label}`).join("\n")}\n\nAjuste meu cargo e tente novamente.`,
    DANGER_COLOR
  );
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, ids.backupBackMenu, "Voltar ao menu")));
  return payload(panel);
}
function createdBackupEmbed(backup) {
  const embed = new EmbedBuilder()
    .setColor(OK_COLOR)
    .setTitle("💾 Backup criado com sucesso!")
    .setDescription(
      [
        `Um novo backup do servidor **${backup.guildName}** foi criado.`,
        "",
        statsLine(backup.stats),
        "",
        "**Código do backup:**",
        `\`\`\`${backup.code}\`\`\``,
        "",
        "🔑 Guarde esse código em um lugar seguro. Ele é a única forma de restaurar esse backup depois — funciona até mesmo se você trocar de conta, já que não fica preso a você nem ao servidor de origem."
      ].join("\n")
    )
    .setFooter({ text: `Criado em ${formatDate(backup.createdAt)}` });
  if (backup.guildIconUrl) embed.setThumbnail(backup.guildIconUrl);
  return embed;
}
function backupCreatedPayload(client, backup, dmSent) {
  const panel = container(
    "✅ Backup criado com sucesso!",
    [
      statsLine(backup.stats),
      "",
      "**Código do backup:**",
      `\`\`\`${backup.code}\`\`\``,
      "",
      dmSent
        ? "📩 Também te enviei esse código no seu privado, guarde com carinho!"
        : "⚠️ Não consegui te mandar no privado (DMs fechadas) — copie o código acima antes de sair daqui, ele não vai aparecer de novo!"
    ].join("\n"),
    OK_COLOR
  );
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, ids.backupBackMenu, "Voltar ao menu")));
  return payload(panel);
}
function useCodeModal() {
  return new ModalBuilder()
    .setCustomId(ids.backupUseCodeModal)
    .setTitle("Restaurar por código")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("code")
          .setLabel("Código do backup")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("XXXX-XXXX-XXXX")
          .setMinLength(5)
          .setMaxLength(32)
          .setRequired(true)
      )
    );
}
async function handleCreateBackup(interaction) {
  await interaction.deferUpdate();
  const guild = interaction.guild;
  const snapshot = await collectGuildSnapshot(guild);
  const code = generateBackupCode();
  const backup = {
    code,
    guildId: guild.id,
    guildName: snapshot.guildName,
    guildIconUrl: snapshot.guildIconUrl,
    createdBy: interaction.user.id,
    createdByTag: interaction.user.tag,
    createdAt: Date.now(),
    stats: snapshot.stats,
    payload: snapshot.payload
  };
  saveBackup(backup);
  let dmSent = true;
  try {
    await interaction.user.send({ embeds: [createdBackupEmbed(backup)] });
  } catch {
    dmSent = false;
  }
  await interaction.editReply(backupCreatedPayload(interaction.client, backup, dmSent));
}
async function performRestore(interaction, code) {
  const backup = getBackup(code);
  if (!backup) {
    await interaction.update(payload(container("❌ Backup não encontrado", `O backup \`${code}\` não existe mais.`, DANGER_COLOR)));
    return;
  }
  const guild = interaction.guild;
  const missing = missingBotPermissions(guild);
  if (missing.length) {
    await interaction.update(missingPermissionsPayload(interaction.client, missing));
    return;
  }
  await interaction.update(payload(container("♻️ Restaurando servidor...", "Preparando para apagar os dados atuais...", WARN_COLOR)));
  let lastEdit = 0;
  const onProgress = (label, current, total) => {
    const now = Date.now();
    if (now - lastEdit < 1500 && current !== total) return;
    lastEdit = now;
    interaction.editReply(progressPayload(label, current, total)).catch(() => null);
  };
  await wipeGuild(guild, onProgress);
  const summary = await restoreGuildSnapshot(guild, backup, onProgress);
  await interaction.editReply(restoreSummaryPayload(interaction.client, backup, summary));
}
async function showConfirm(interaction, code) {
  const confirm = confirmRestorePayload(interaction.client, code);
  if (!confirm) {
    await interaction.update(payload(container("❌ Código inválido", `O backup \`${code}\` não foi encontrado.`, DANGER_COLOR)));
    return;
  }
  await interaction.update(confirm);
}
async function handleBackupCommand(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "backup") return false;
  if (!interaction.inGuild()) {
    await interaction.reply({ content: "Use este comando dentro de um servidor.", flags: MessageFlags.Ephemeral });
    return true;
  }
  if (!isBackupAllowed(interaction)) {
    await interaction.reply({ content: "Você precisa ser administrador para usar o /backup.", flags: MessageFlags.Ephemeral });
    return true;
  }
  await interaction.reply(mainMenuPayload(interaction.client));
  return true;
}
async function handleBackupInteraction(interaction) {
  if (!interaction.customId?.startsWith("backup:")) return false;
  if (!interaction.inGuild()) {
    await interaction.reply({ content: "Use isso dentro de um servidor.", flags: MessageFlags.Ephemeral });
    return true;
  }
  if (!isBackupAllowed(interaction)) {
    await interaction.reply({ content: "Você precisa ser administrador para usar o /backup.", flags: MessageFlags.Ephemeral });
    return true;
  }
  const { customId, client, guildId } = interaction;
  if (customId === ids.backupMenu) {
    const choice = interaction.values[0];
    if (choice === "create") {
      await handleCreateBackup(interaction);
      return true;
    }
    if (choice === "list") {
      await interaction.update(listBackupsPayload(client, guildId));
      return true;
    }
    await interaction.update(restoreMenuPayload(client, guildId));
    return true;
  }
  if (customId === ids.backupBackMenu) {
    await interaction.update(mainMenuPayload(client));
    return true;
  }
  if (customId === ids.backupListBack) {
    await interaction.update(listBackupsPayload(client, guildId));
    return true;
  }
  if (customId.startsWith(`${ids.backupListSelect}:`)) {
    await interaction.update(backupDetailPayload(client, guildId, interaction.values[0]));
    return true;
  }
  if (customId.startsWith(`${ids.backupListRestore}:`)) {
    const code = customId.split(":").at(-1);
    await showConfirm(interaction, code);
    return true;
  }
  if (customId.startsWith(`${ids.backupRestoreSelect}:`)) {
    await showConfirm(interaction, interaction.values[0]);
    return true;
  }
  if (customId === ids.backupRestoreUseCode) {
    await interaction.showModal(useCodeModal());
    return true;
  }
  if (customId.startsWith(`${ids.backupConfirmYes}:`)) {
    if (!isRestoreAllowed(interaction)) {
      await interaction.reply({ content: "Restaurar backup exige permissão de Administrador.", flags: MessageFlags.Ephemeral });
      return true;
    }
    const code = customId.split(":").at(-1);
    await performRestore(interaction, code);
    return true;
  }
  if (customId === ids.backupConfirmNo) {
    await interaction.update(mainMenuPayload(client));
    return true;
  }
  return false;
}
async function handleBackupModal(interaction) {
  if (!interaction.isModalSubmit() || interaction.customId !== ids.backupUseCodeModal) return false;
  if (!isBackupAllowed(interaction)) {
    await interaction.reply({ content: "Você precisa ser administrador para usar o /backup.", flags: MessageFlags.Ephemeral });
    return true;
  }
  const raw = interaction.fields.getTextInputValue("code").trim().toUpperCase();
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(raw)) {
    await interaction.reply({ content: "Código inválido. Use o formato XXXX-XXXX-XXXX (letras e números).", flags: MessageFlags.Ephemeral });
    return true;
  }
  await showConfirm(interaction, raw);
  return true;
}
module.exports = {
  handleBackupCommand,
  handleBackupInteraction,
  handleBackupModal
};
