const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder
} = require("discord.js");
const { ids } = require("../../config");
const { normalizeEmojiName } = require("../../emojis");
const { getGuildConfig, setGuildConfig } = require("../../storage");
const { readGuildFile, writeGuildFile } = require("../../guildDb");
const V2 = MessageFlags.IsComponentsV2;
const VOTE_BAR_LENGTH = 12;
function componentEmoji(client, name) {
  const normalized = normalizeEmojiName(name);
  const found = client?.appEmojis?.get(normalized);
  if (!found) return undefined;
  return { id: found.id, name: found.name, animated: found.animated };
}
function withEmoji(builder, client, name) {
  const found = componentEmoji(client, name);
  return found ? builder.setEmoji(found) : builder;
}
function inlineEmoji(client, name) {
  const found = componentEmoji(client, name);
  if (!found) return "";
  return `<${found.animated ? "a" : ""}:${found.name}:${found.id}> `;
}
function readVotes(guildId) {
  return readGuildFile(guildId, "suggestions", () => ({ votes: {}, meta: {} }));
}
function writeVotes(guildId, data) {
  writeGuildFile(guildId, "suggestions", data);
}
function voteButtonsRow(client, messageId, agrees, disagrees) {
  const total = agrees + disagrees;
  const agreePercent = total > 0 ? Math.round((agrees / total) * 100) : 0;
  const disagreePercent = total > 0 ? 100 - agreePercent : 0;
  return new ActionRowBuilder().addComponents(
    withEmoji(
      new ButtonBuilder()
        .setCustomId(`suggestion:agree:${messageId}`)
        .setLabel(`${agreePercent}%`)
        .setStyle(ButtonStyle.Secondary),
      client,
      "check"
    ),
    withEmoji(
      new ButtonBuilder()
        .setCustomId(`suggestion:disagree:${messageId}`)
        .setLabel(`${disagreePercent}%`)
        .setStyle(ButtonStyle.Secondary),
      client,
      "ban"
    )
  );
}
function voteBar(agreePercent) {
  const filled = Math.max(0, Math.min(VOTE_BAR_LENGTH, Math.round((agreePercent / 100) * VOTE_BAR_LENGTH)));
  return "🟩".repeat(filled) + "⬜".repeat(VOTE_BAR_LENGTH - filled);
}
function buildSuggestionContainer(client, meta, agrees, disagrees, messageId) {
  const total = agrees + disagrees;
  const agreePercent = total > 0 ? Math.round((agrees / total) * 100) : 0;
  const container = new ContainerBuilder();
  const headerSection = new SectionBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${inlineEmoji(client, "lightbulb")}Nova sugestão\nEnviada por **${meta.authorUsername}** · <t:${meta.timestamp}:R>`
    )
  );
  if (meta.authorAvatar) {
    headerSection.setThumbnailAccessory(new ThumbnailBuilder().setURL(meta.authorAvatar));
  }
  container.addSectionComponents(headerSection);
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(meta.content));
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${inlineEmoji(client, "vote")}**Votação** · ${total} voto${total === 1 ? "" : "s"}\n` +
      `${voteBar(agreePercent)}\n` +
      `Concordam **${agrees}**   Discordam **${disagrees}**`
    )
  );
  if (messageId) {
    container.addActionRowComponents(voteButtonsRow(client, messageId, agrees, disagrees));
  }
  return container;
}
async function handleSuggestionsInteraction(interaction) {
  if (!interaction.isButton()) return false;
  if (!interaction.customId.startsWith("suggestion:agree:") && !interaction.customId.startsWith("suggestion:disagree:")) {
    return false;
  }
  const [, voteType, messageId] = interaction.customId.split(":");
  const guildId = interaction.guildId;
  try {
    const data = readVotes(guildId);
    if (!data.votes) data.votes = {};
    if (!data.meta) data.meta = {};
    if (!data.votes[messageId]) data.votes[messageId] = {};
    const meta = data.meta[messageId];
    if (!meta) {
      await interaction.reply({ content: "Não encontrei os detalhes desta sugestão para registrar o voto.", flags: MessageFlags.Ephemeral });
      return true;
    }
    data.votes[messageId][interaction.user.id] = voteType;
    writeVotes(guildId, data);
    const tally = Object.values(data.votes[messageId]);
    const agrees = tally.filter((v) => v === "agree").length;
    const disagrees = tally.filter((v) => v === "disagree").length;
    await interaction.update({
      components: [buildSuggestionContainer(interaction.client, meta, agrees, disagrees, messageId)],
      flags: V2
    });
    await interaction.followUp({
      content: voteType === "agree" ? "Voto registrado: você concorda com a sugestão." : "Voto registrado: você discorda da sugestão.",
      flags: MessageFlags.Ephemeral
    }).catch(() => null);
  } catch (error) {
    console.error("[Sugestoes] Erro ao registrar voto:", error);
    await interaction.reply({ content: "Não consegui registrar seu voto. Tente novamente.", flags: MessageFlags.Ephemeral }).catch(() => null);
  }
  return true;
}
async function handleSuggestionMessage(message) {
  if (!message.guildId || message.author.bot) return false;
  const config = getGuildConfig(message.guildId);
  const suggestions = config.suggestions;
  if (!suggestions?.channelId || suggestions?.enabled === false) return false;
  if (message.channelId !== suggestions.channelId) return false;
  const content = message.content?.trim();
  if (!content) return false;
  const meta = {
    authorUsername: message.author.username,
    authorAvatar: message.author.displayAvatarURL(),
    content,
    timestamp: Math.floor(Date.now() / 1000)
  };
  try {
    await message.delete().catch(() => null);
    const suggestionMsg = await message.channel.send({
      components: [buildSuggestionContainer(message.client, meta, 0, 0, null)],
      flags: V2
    });
    const data = readVotes(message.guildId);
    if (!data.votes) data.votes = {};
    if (!data.meta) data.meta = {};
    data.votes[suggestionMsg.id] = {};
    data.meta[suggestionMsg.id] = meta;
    writeVotes(message.guildId, data);
    await suggestionMsg.edit({
      components: [buildSuggestionContainer(message.client, meta, 0, 0, suggestionMsg.id)],
      flags: V2
    });
    if (suggestions.autoThread !== false && message.channel.threads) {
      const thread = await message.channel.threads.create({
        name: `${message.author.username}`.slice(0, 100),
        type: ChannelType.PublicThread,
        autoArchiveDuration: 1440,
        reason: "Thread de discussao de sugestao",
        startMessage: suggestionMsg.id
      }).catch(() => null);
      if (thread) {
        const threadIntro = new ContainerBuilder();
        threadIntro.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `${inlineEmoji(message.client, "message_circle")}**Thread de discussão**\nUse este espaço para debater a sugestão. Os botões na mensagem acima registram o voto.`
          )
        );
        await thread.send({ components: [threadIntro], flags: V2 }).catch(() => null);
      }
    }
    return true;
  } catch (error) {
    console.error("[Sugestoes] Erro ao processar sugestao:", error);
    return false;
  }
}
function suggestionConfigPanel(client, guildId, userId) {
  const config = getGuildConfig(guildId);
  const suggestions = config.suggestions;
  const active = Boolean(suggestions.channelId) && suggestions.enabled !== false;
  const panel = new ContainerBuilder();
  panel.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${inlineEmoji(client, "lightbulb")}Sistema de Sugestões\nMembros enviam sugestões em um canal e o bot transforma cada uma em uma votação, além de abrir uma thread de discussão.`
    )
  );
  panel.addSeparatorComponents(new SeparatorBuilder());
  panel.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        `**Status:** ${active ? "🟢 Ativado" : "⚪ Desativado"}`,
        `**Canal:** ${suggestions.channelId ? `<#${suggestions.channelId}>` : "não configurado"}`,
        `**Thread automática:** ${suggestions.autoThread !== false ? "🟢 Ativada" : "⚪ Desativada"}`,
        "",
        suggestions.channelId
          ? "Para trocar o canal, vá em **Configurações → Canais → Sugestões**."
          : "Escolha o canal em **Configurações → Canais → Sugestões** — o sistema já ativa sozinho assim que o canal for escolhido."
      ].join("\n")
    )
  );
  panel.addSeparatorComponents(new SeparatorBuilder());
  const toggleRow = new ActionRowBuilder().addComponents(
    withEmoji(
      new ButtonBuilder()
        .setCustomId(`${ids.suggestionsToggle}:${userId}`)
        .setLabel(active ? "Desativar" : "Ativar")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!suggestions.channelId),
      client,
      active ? "circle_x" : "circle_check_big"
    ),
    withEmoji(
      new ButtonBuilder()
        .setCustomId(`${ids.suggestionsAutoThreadToggle}:${userId}`)
        .setLabel(suggestions.autoThread !== false ? "Desativar thread" : "Ativar thread")
        .setStyle(ButtonStyle.Secondary),
      client,
      "messages_square"
    )
  );
  panel.addActionRowComponents(toggleRow);
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      withEmoji(
        new ButtonBuilder()
          .setCustomId(`${ids.panelBackSettings}:${userId}`)
          .setLabel("Voltar")
          .setStyle(ButtonStyle.Secondary),
        client,
        "arrow_left"
      )
    )
  );
  return panel;
}
module.exports = {
  handleSuggestionsInteraction,
  handleSuggestionMessage,
  suggestionConfigPanel
};
