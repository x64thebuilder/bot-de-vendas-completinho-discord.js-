const QRCode = require("qrcode");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ContainerBuilder,
  EmbedBuilder,
  MediaGalleryBuilder,
  MessageFlags,
  ModalBuilder,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder
} = require("discord.js");
const { ids } = require("../../config");
const { getGuildConfig } = require("../../storage");
const { readGuildFile, writeGuildFile } = require("../../guildDb");
const { componentEmoji, scoped } = require("../panel");
const { botOwnerIds } = require("../../botOwners");
const { checkProhibitedContent, prohibitedContentMessage } = require("../../contentFilter");
const { reportViolation } = require("../../violations");
const V2 = MessageFlags.IsComponentsV2;
const V2_EPHEMERAL = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
const DEFAULT_COLOR = 0xffffff;
const OK_COLOR = 0x2ecc71;
const WARN_COLOR = 0xf1c40f;
const DANGER_COLOR = 0xe74c3c;
function defaultTicketsStore() {
  return { panels: {}, openTickets: {}, cooldowns: {} };
}
function readTickets(guildId) {
  return readGuildFile(guildId, "tickets", defaultTicketsStore);
}
function writeTickets(guildId, data) {
  writeGuildFile(guildId, "tickets", data);
}
function guildStore(data) {
  data.panels ||= {};
  data.openTickets ||= {};
  data.cooldowns ||= {};
  return data;
}
function panelsList(guildId) {
  return Object.values(guildStore(readTickets(guildId)).panels);
}
function getPanel(guildId, panelId) {
  return guildStore(readTickets(guildId)).panels[panelId] || null;
}
function setPanel(guildId, panelId, updater) {
  const data = readTickets(guildId);
  const store = guildStore(data);
  store.panels[panelId] = typeof updater === "function" ? updater(store.panels[panelId]) : updater;
  writeTickets(guildId, data);
  return store.panels[panelId];
}
function createPanel(guildId, input) {
  const data = readTickets(guildId);
  const store = guildStore(data);
  const id = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  store.panels[id] = {
    id,
    guildId,
    name: input.name,
    description: input.description || "Abra um ticket para falar com a equipe.",
    banner: input.banner || null,
    color: input.color || null,
    buttonStyle: input.buttonStyle || "secondary",
    mode: "container",
    reasons: {},
    options: { adminPanel: true, memberPanel: true },
    schedule: { enabled: false, start: "12:00", end: "20:00", weekendEnabled: false, weekendStart: "12:00", weekendEnd: "20:00" },
    publicPanels: [],
    createdAt: Date.now()
  };
  writeTickets(guildId, data);
  return store.panels[id];
}
function deletePanel(guildId, panelId) {
  const data = readTickets(guildId);
  delete guildStore(data).panels[panelId];
  writeTickets(guildId, data);
}
function reasonsList(panel) {
  return Object.values(panel?.reasons || {});
}
function createReason(guildId, panelId, input) {
  return setPanel(guildId, panelId, (panel) => {
    const id = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    panel.reasons[id] = { id, name: input.name, description: input.description || "Atendimento geral.", emoji: input.emoji || null };
    return panel;
  });
}
function container(title, description, color = DEFAULT_COLOR) {
  const builder = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}\n${description}`));
  if (color) builder.setAccentColor(color);
  return builder.addSeparatorComponents(new SeparatorBuilder());
}
function button(client, id, label, style, emojiName) {
  const builder = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
  const emoji = componentEmoji(client, emojiName);
  return emoji ? builder.setEmoji(emoji) : builder;
}
function backButton(client, targetId, userId) {
  return button(client, scoped(targetId, userId), "Voltar", ButtonStyle.Secondary, "reload");
}
function payload(component) {
  return { components: [component], flags: V2 };
}
function emojiText(client, name, fallback = "") {
  const found = componentEmoji(client, name);
  if (!found) return fallback;
  return `<${found.animated ? "a" : ""}:${found.name}:${found.id}>`;
}
function panelRoot(client, guildId, userId) {
  const panels = panelsList(guildId);
  let openCount = 0;
  try {
    const data = readTickets(guildId);
    openCount = Object.keys((data && guildStore(data).openTickets) || {}).length;
  } catch {}
  const totalReasons = panels.reduce((a, p) => a + reasonsList(p).length, 0);
  const panel = container("Tickets", `${emojiText(client, "canal")} Paineis: **${panels.length}** • Em atendimento: **${openCount}** • Motivos: **${totalReasons}**\n-# Dica: um painel por assunto (vendas, suporte, parcerias) organiza o servidor.`, DEFAULT_COLOR);
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(scoped(ids.ticketPanelSelect, userId))
      .setPlaceholder(panels.length ? "Selecione um painel de ticket" : "Nenhum painel criado")
      .setDisabled(!panels.length)
      .addOptions((panels.length ? panels : [{ id: "none", name: "Nenhum painel", description: "Crie um painel primeiro." }]).slice(0, 25).map((item) => ({
        label: item.name.slice(0, 100),
        value: item.id,
        description: (item.description || "Painel de ticket").slice(0, 100),
        emoji: componentEmoji(client, "canal")
      })))
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, scoped(ids.ticketCreatePanel, userId), "Criar", ButtonStyle.Success, "mais2"),
    button(client, scoped(ids.ticketDeletePanel, userId), "Deletar", ButtonStyle.Danger, "apagar"),
    backButton(client, ids.panelBackMain, userId)
  ));
  return panel;
}
function panelAdmin(client, guildId, userId, panelId) {
  const item = getPanel(guildId, panelId);
  if (!item) return panelRoot(client, guildId, userId);
  let openHere = 0;
  try {
    openHere = Object.values(guildStore(readTickets(guildId)).openTickets || {}).filter((t) => t.panelId === panelId).length;
  } catch {}
  const sent = item.publicPanels?.[0];
  const panel = container(
    item.name,
    `${item.description}\n\n${emojiText(client, "fields")} Motivos: **${reasonsList(item).length}** • Em atendimento: **${openHere}**\n${emojiText(client, "preview")} Modo: **${panelModeLabel(item.mode)}** • Horario: **${item.schedule.enabled ? "ativo" : "desativado"}**\n${emojiText(client, "canal")} Painel público: ${sent ? `[abrir](https://discord.com/channels/${guildId}/${sent.channelId}/${sent.messageId})` : "`não enviado`"}`,
    item.color
  );
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, scoped(`${ids.ticketAppearance}:${panelId}`, userId), "Aparencia", ButtonStyle.Primary, "editar"),
    button(client, scoped(`${ids.ticketReasons}:${panelId}`, userId), "Gerenciar motivos", ButtonStyle.Secondary, "fields"),
    button(client, scoped(`${ids.ticketOptionals}:${panelId}`, userId), "Opcionais", ButtonStyle.Secondary, "config2")
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, scoped(`${ids.ticketSchedule}:${panelId}`, userId), "Horarios", ButtonStyle.Secondary, "clock"),
    button(client, scoped(`${ids.ticketPreview}:${panelId}`, userId), "Preview", ButtonStyle.Primary, "preview"),
    button(client, scoped(`${ids.ticketSend}:${panelId}`, userId), "Enviar Painel", ButtonStyle.Success, "canal"),
    backButton(client, ids.panelTickets, userId)
  ));
  return panel;
}
function appearancePanel(client, guildId, userId, panelId) {
  const item = getPanel(guildId, panelId);
  const panel = container("Aparencia", `Painel: **${item?.name || "Ticket"}**\nCor: **${item?.color ? intToHex(item.color) : "padrao (sem cor)"}**\nModo: **${panelModeLabel(item?.mode)}**\nBanner: **${item?.banner ? "configurado" : "nao definido"}**`, item?.color || DEFAULT_COLOR);
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, scoped(`${ids.ticketAppearanceEdit}:${panelId}`, userId), "Editar texto e cor", ButtonStyle.Primary, "editar")
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(scoped(`${ids.ticketModeSelect}:${panelId}`, userId))
      .setPlaceholder("Modo do painel")
      .addOptions(
        { label: "Mensagem", value: "message", description: "Texto simples com o botao/menu.", emoji: componentEmoji(client, "recibo") },
        { label: "Container", value: "container", description: "Components V2.", emoji: componentEmoji(client, "caixa") },
        { label: "Embed", value: "embed", description: "Embed tradicional.", emoji: componentEmoji(client, "embed") }
      )
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, `${ids.ticketPanelSelect}:back:${panelId}`, userId)));
  return panel;
}
function reasonsPanel(client, guildId, userId, panelId) {
  const item = getPanel(guildId, panelId);
  const reasons = reasonsList(item);
  const panel = container("Motivos do Ticket", `Painel: **${item?.name || "Ticket"}**\nMotivos criados: **${reasons.length}**`, DEFAULT_COLOR);
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(scoped(`${ids.ticketReasonSelect}:${panelId}`, userId))
      .setPlaceholder(reasons.length ? "Selecione um motivo" : "Nenhum motivo criado")
      .setDisabled(!reasons.length)
      .addOptions((reasons.length ? reasons : [{ id: "none", name: "Nenhum motivo", description: "Crie um motivo." }]).slice(0, 25).map((reason) => ({
        label: reason.name.slice(0, 100),
        value: reason.id,
        description: (reason.description || "Motivo").slice(0, 100),
        emoji: reason.emoji || componentEmoji(client, "recibo")
      })))
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, scoped(`${ids.ticketReasonCreate}:${panelId}`, userId), "Criar", ButtonStyle.Success, "mais2"),
    button(client, scoped(`${ids.ticketReasonDelete}:${panelId}`, userId), "Deletar", ButtonStyle.Danger, "apagar"),
    backButton(client, `${ids.ticketPanelSelect}:back:${panelId}`, userId)
  ));
  return panel;
}
function deleteReasonPanel(client, guildId, userId, panelId) {
  const reasons = reasonsList(getPanel(guildId, panelId));
  const panel = container("Deletar Motivo", "Selecione o motivo que deseja remover.", DANGER_COLOR);
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(scoped(`${ids.ticketReasonDeleteSelect}:${panelId}`, userId))
      .setPlaceholder(reasons.length ? "Selecione o motivo" : "Nenhum motivo")
      .setDisabled(!reasons.length)
      .addOptions((reasons.length ? reasons : [{ id: "none", name: "Nenhum motivo" }]).slice(0, 25).map((reason) => ({ label: reason.name.slice(0, 100), value: reason.id })))
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, `${ids.ticketReasons}:${panelId}`, userId)));
  return panel;
}
function optionalsPanel(client, guildId, userId, panelId) {
  const item = getPanel(guildId, panelId);
  const panel = container(
    "Opcionais",
    `Painel admin: **${item?.options?.adminPanel ? "ativado" : "desativado"}**\nPainel membro: **${item?.options?.memberPanel ? "ativado" : "desativado"}**`,
    DEFAULT_COLOR
  );
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(scoped(`${ids.ticketOptionalSelect}:${panelId}`, userId))
      .setPlaceholder("Selecione uma opcao")
      .addOptions({ label: "Gerenciar Painel", value: "panel", description: "Ativar/desativar painel admin e membro.", emoji: componentEmoji(client, "config2") })
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, `${ids.ticketPanelSelect}:back:${panelId}`, userId)));
  return panel;
}
function panelOptionsPanel(client, guildId, userId, panelId) {
  const item = getPanel(guildId, panelId);
  const panel = container("Gerenciar Painel", `Admin: **${item.options.adminPanel ? "ativado" : "desativado"}**\nMembro: **${item.options.memberPanel ? "ativado" : "desativado"}**`, DEFAULT_COLOR);
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(scoped(`${ids.ticketPanelOptionsSelect}:${panelId}`, userId))
      .setPlaceholder("Clique para alternar")
      .addOptions(
        { label: `Painel admin: ${item.options.adminPanel ? "ativado" : "desativado"}`, value: "adminPanel", description: "Precisa do cargo suporte configurado.", emoji: componentEmoji(client, "users") },
        { label: `Painel membro: ${item.options.memberPanel ? "ativado" : "desativado"}`, value: "memberPanel", description: "Opcoes visiveis para quem abriu o ticket.", emoji: componentEmoji(client, "user") }
      )
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, `${ids.ticketOptionals}:${panelId}`, userId)));
  return panel;
}
function schedulePanel(client, guildId, userId, panelId) {
  const item = getPanel(guildId, panelId);
  const s = item.schedule;
  const panel = container("Horarios", `Status: **${s.enabled ? "ativado" : "desativado"}**\nSemana: **${s.start} ate ${s.end}**\nFinal de semana: **${s.weekendEnabled ? `${s.weekendStart} ate ${s.weekendEnd}` : "desativado"}**`, DEFAULT_COLOR);
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, scoped(`${ids.ticketScheduleToggle}:${panelId}`, userId), s.enabled ? "Desativar" : "Ativar", s.enabled ? ButtonStyle.Danger : ButtonStyle.Success, s.enabled ? "desligado" : "ligado"),
    button(client, scoped(`${ids.ticketScheduleConfig}:${panelId}`, userId), "Configurar semana", ButtonStyle.Primary, "clock"),
    button(client, scoped(`${ids.ticketWeekendConfig}:${panelId}`, userId), "Final de semana", ButtonStyle.Secondary, "datep"),
    backButton(client, `${ids.ticketPanelSelect}:back:${panelId}`, userId)
  ));
  return panel;
}
function sendTypeSelectPanel(client, userId, panelId) {
  const panel = container("Enviar Painel", `${emojiText(client, "preview")} Escolha como o painel sera enviado.`, OK_COLOR);
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(scoped(`${ids.ticketSendTypeSelect}:${panelId}`, userId))
      .setPlaceholder("Selecione o tipo do painel")
      .addOptions(
        { label: "Mensagem", value: "message", description: "Texto simples com o botao/menu de ticket.", emoji: componentEmoji(client, "recibo") },
        { label: "Container", value: "container", description: "Components V2.", emoji: componentEmoji(client, "caixa") },
        { label: "Embed", value: "embed", description: "Embed tradicional.", emoji: componentEmoji(client, "embed") }
      )
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, `${ids.ticketPanelSelect}:back:${panelId}`, userId)));
  return panel;
}
function sendAppearanceModal(userId, panelId, mode, item = {}) {
  const modal = new ModalBuilder()
    .setCustomId(`${ids.ticketSendAppearanceModal}:${mode}:${panelId}:${userId}`)
    .setTitle("Aparencia do painel");
  if (mode !== "message") {
    const colorInput = new TextInputBuilder()
      .setCustomId("color")
      .setLabel(`Cor do ${mode === "embed" ? "embed" : "container"} em HEX (opcional)`)
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("Ex: #5865F2 - deixe vazio para nao usar cor")
      .setRequired(false)
      .setMaxLength(7);
    if (item.color) colorInput.setValue(intToHex(item.color));
    modal.addComponents(new ActionRowBuilder().addComponents(colorInput));
  }
  const buttonInput = new TextInputBuilder()
    .setCustomId("buttonStyle")
    .setLabel("Cor do botao: verde, azul, cinza ou vermelho")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Deixe vazio para usar cinza (padrao)")
    .setRequired(false)
    .setMaxLength(10);
  if (item.buttonStyle) buttonInput.setValue(buttonStyleLabel(item.buttonStyle));
  modal.addComponents(new ActionRowBuilder().addComponents(buttonInput));
  return modal;
}
function sendPanel(client, userId, panelId) {
  const panel = container("Enviar Painel", "Selecione um canal ou envie no canal atual.", OK_COLOR);
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(scoped(`${ids.ticketSendChannel}:${panelId}`, userId))
      .setPlaceholder("Selecione o canal")
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setMinValues(1)
      .setMaxValues(1)
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, scoped(`${ids.ticketSendHere}:${panelId}`, userId), "Enviar aqui neste canal", ButtonStyle.Success, "canal"),
    backButton(client, `${ids.ticketPanelSelect}:back:${panelId}`, userId)
  ));
  return panel;
}
function ticketPanelModal(userId, mode, panelId = "new", item = {}) {
  return new ModalBuilder()
    .setCustomId(`${ids.ticketPanelModal}:${mode}:${panelId}:${userId}`)
    .setTitle(mode === "edit" ? "Editar Aparencia" : "Criar Painel")
    .addComponents(
      inputRow("name", "Nome do painel", TextInputStyle.Short, true, item.name || "Suporte"),
      inputRow("description", "Descricao", TextInputStyle.Paragraph, false, item.description || "Abra um ticket para falar com a equipe."),
      inputRow("banner", "Banner URL opcional", TextInputStyle.Short, false, item.banner || ""),
      inputRow("color", "Cor HEX do container/embed", TextInputStyle.Short, true, intToHex(item.color || DEFAULT_COLOR))
    );
}
function reasonModal(userId, panelId) {
  return new ModalBuilder()
    .setCustomId(`${ids.ticketReasonModal}:${panelId}:${userId}`)
    .setTitle("Criar Motivo")
    .addComponents(
      inputRow("name", "Nome do motivo", TextInputStyle.Short, true),
      inputRow("description", "Descricao", TextInputStyle.Paragraph, false),
      inputRow("emoji", "Emoji opcional", TextInputStyle.Short, false)
    );
}
function scheduleModal(userId, panelId, item, weekend = false) {
  const s = item.schedule;
  return new ModalBuilder()
    .setCustomId(`${weekend ? ids.ticketWeekendModal : ids.ticketScheduleModal}:${panelId}:${userId}`)
    .setTitle(weekend ? "Horario fim de semana" : "Horario semana")
    .addComponents(
      inputRow("start", "Abre em HH:MM", TextInputStyle.Short, true, weekend ? s.weekendStart : s.start),
      inputRow("end", "Fecha em HH:MM", TextInputStyle.Short, true, weekend ? s.weekendEnd : s.end)
    );
}
function paymentModal(userId, ticketId) {
  return new ModalBuilder()
    .setCustomId(`${ids.ticketPaymentModal}:${ticketId}:${userId}`)
    .setTitle("Gerar pagamento")
    .addComponents(
      inputRow("what", "O que sera pago", TextInputStyle.Short, true),
      inputRow("value", "Valor", TextInputStyle.Short, true)
    );
}
function addIdModal(userId, ticketId) {
  return new ModalBuilder()
    .setCustomId(`${ids.ticketAddIdModal}:${ticketId}:${userId}`)
    .setTitle("Adicionar por ID")
    .addComponents(inputRow("id", "ID do usuario", TextInputStyle.Short, true));
}
function inputRow(id, label, style, required, value) {
  const input = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required);
  if (value) input.setValue(String(value).slice(0, 4000));
  return new ActionRowBuilder().addComponents(input);
}
async function handleTicketPanelComponent(interaction, baseId) {
  const client = interaction.client;
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  if (baseId === ids.panelTickets) {
    await interaction.update(payload(panelRoot(client, guildId, userId)));
    return true;
  }
  if (baseId === ids.ticketCreatePanel) {
    await interaction.showModal(ticketPanelModal(userId, "create"));
    return true;
  }
  if (baseId === ids.ticketDeletePanel) {
    await interaction.update(payload(deletePanelView(client, guildId, userId)));
    return true;
  }
  if (baseId === ids.ticketPanelSelect) {
    await interaction.update(payload(panelAdmin(client, guildId, userId, interaction.values[0])));
    return true;
  }
  if (baseId.startsWith(`${ids.ticketPanelSelect}:back:`)) {
    await interaction.update(payload(panelAdmin(client, guildId, userId, baseId.split(":").at(-1))));
    return true;
  }
  if (baseId === ids.ticketDeleteSelect) {
    deletePanel(guildId, interaction.values[0]);
    await interaction.update(payload(panelRoot(client, guildId, userId)));
    return true;
  }
  if (baseId.startsWith(ids.ticketAppearanceEdit)) {
    const panelId = baseId.split(":").at(-1);
    await interaction.showModal(ticketPanelModal(userId, "edit", panelId, getPanel(guildId, panelId)));
    return true;
  }
  if (baseId.startsWith(ids.ticketAppearance)) {
    await interaction.update(payload(appearancePanel(client, guildId, userId, baseId.split(":").at(-1))));
    return true;
  }
  if (baseId.startsWith(ids.ticketModeSelect)) {
    const panelId = baseId.split(":").at(-1);
    setPanel(guildId, panelId, (p) => ({ ...p, mode: normalizePanelMode(interaction.values[0]) }));
    await refreshPublicPanels(client, guildId, panelId);
    await interaction.update(payload(panelAdmin(client, guildId, userId, panelId)));
    return true;
  }
  if (baseId.startsWith(ids.ticketReasons)) {
    await interaction.update(payload(reasonsPanel(client, guildId, userId, baseId.split(":").at(-1))));
    return true;
  }
  if (baseId.startsWith(ids.ticketReasonCreate)) {
    await interaction.showModal(reasonModal(userId, baseId.split(":").at(-1)));
    return true;
  }
  if (baseId.startsWith(ids.ticketReasonDeleteSelect)) {
    const parts = baseId.split(":");
    const panelId = parts.at(-1);
    const reasonId = interaction.values[0];
    setPanel(guildId, panelId, (p) => {
      delete p.reasons[reasonId];
      return p;
    });
    await refreshPublicPanels(client, guildId, panelId);
    await interaction.update(payload(reasonsPanel(client, guildId, userId, panelId)));
    return true;
  }
  if (baseId.startsWith(ids.ticketReasonDelete)) {
    await interaction.update(payload(deleteReasonPanel(client, guildId, userId, baseId.split(":").at(-1))));
    return true;
  }
  if (baseId.startsWith(ids.ticketReasonSelect)) {
    const panelId = baseId.split(":").at(-1);
    if (!interaction.values?.[0]) {
      await interaction.reply({ content: "Selecione um motivo valido.", flags: MessageFlags.Ephemeral });
      return true;
    }
    const item = getPanel(guildId, panelId);
    const reason = item?.reasons?.[interaction.values[0]];
    await interaction.reply({
      content: reason ? `**${reason.name}**\n${reason.description || "Sem descricao."}` : "Motivo nao encontrado.",
      flags: MessageFlags.Ephemeral
    });
    return true;
  }
  if (baseId.startsWith(ids.ticketOptionalSelect)) {
    await interaction.update(payload(panelOptionsPanel(client, guildId, userId, baseId.split(":").at(-1))));
    return true;
  }
  if (baseId.startsWith(ids.ticketOptionals)) {
    await interaction.update(payload(optionalsPanel(client, guildId, userId, baseId.split(":").at(-1))));
    return true;
  }
  if (baseId.startsWith(ids.ticketPanelOptionsSelect)) {
    const panelId = baseId.split(":").at(-1);
    const key = interaction.values[0];
    setPanel(guildId, panelId, (p) => {
      p.options[key] = !p.options[key];
      return p;
    });
    await interaction.update(payload(panelOptionsPanel(client, guildId, userId, panelId)));
    return true;
  }
  if (baseId.startsWith(ids.ticketScheduleToggle)) {
    const panelId = baseId.split(":").at(-1);
    setPanel(guildId, panelId, (p) => {
      p.schedule.enabled = !p.schedule.enabled;
      return p;
    });
    await interaction.update(payload(schedulePanel(client, guildId, userId, panelId)));
    return true;
  }
  if (baseId.startsWith(ids.ticketScheduleConfig)) {
    const panelId = baseId.split(":").at(-1);
    await interaction.showModal(scheduleModal(userId, panelId, getPanel(guildId, panelId), false));
    return true;
  }
  if (baseId.startsWith(ids.ticketWeekendConfig)) {
    const panelId = baseId.split(":").at(-1);
    await interaction.showModal(scheduleModal(userId, panelId, getPanel(guildId, panelId), true));
    return true;
  }
  if (baseId.startsWith(ids.ticketSchedule)) {
    await interaction.update(payload(schedulePanel(client, guildId, userId, baseId.split(":").at(-1))));
    return true;
  }
  if (baseId.startsWith(ids.ticketPreview)) {
    const item = getPanel(guildId, baseId.split(":").at(-1));
    const previewFlags = item?.mode === "embed" || item?.mode === "message" ? MessageFlags.Ephemeral : V2_EPHEMERAL;
    await interaction.reply({ ...publicTicketPayload(client, item), flags: previewFlags });
    return true;
  }
  if (baseId.startsWith(ids.ticketSendChannel)) {
    await sendPublicPanel(interaction, baseId.split(":").at(-1), interaction.values[0]);
    return true;
  }
  if (baseId.startsWith(ids.ticketSendHere)) {
    await sendPublicPanel(interaction, baseId.split(":").at(-1), interaction.channelId);
    return true;
  }
  if (baseId.startsWith(ids.ticketSendTypeSelect)) {
    const panelId = baseId.split(":").at(-1);
    const mode = normalizePanelMode(interaction.values[0]);
    await interaction.showModal(sendAppearanceModal(userId, panelId, mode, getPanel(guildId, panelId)));
    return true;
  }
  if (baseId.startsWith(ids.ticketSend)) {
    await interaction.update(payload(sendTypeSelectPanel(client, userId, baseId.split(":").at(-1))));
    return true;
  }
  return false;
}
function deletePanelView(client, guildId, userId) {
  const panels = panelsList(guildId);
  const panel = container("Deletar Painel", "Selecione o painel que deseja deletar.", DANGER_COLOR);
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(scoped(ids.ticketDeleteSelect, userId))
      .setPlaceholder(panels.length ? "Selecione um painel" : "Nenhum painel")
      .setDisabled(!panels.length)
      .addOptions((panels.length ? panels : [{ id: "none", name: "Nenhum painel" }]).slice(0, 25).map((item) => ({ label: item.name.slice(0, 100), value: item.id })))
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, ids.panelTickets, userId)));
  return panel;
}
async function handleTicketModal(interaction) {
  if (!interaction.customId.startsWith("modal:tickets:")) return false;
  const parts = interaction.customId.split(":");
  const ownerId = parts.at(-1);
  if (ownerId !== interaction.user.id) {
    await interaction.reply({ content: "Este modal pertence a outra pessoa.", flags: MessageFlags.Ephemeral });
    return true;
  }
  const guildId = interaction.guildId;
  const client = interaction.client;
  if (parts[2] === "panel") {
    const mode = parts[3];
    const panelId = parts[4];
    const input = {
      name: interaction.fields.getTextInputValue("name").trim(),
      description: interaction.fields.getTextInputValue("description").trim(),
      banner: normalizeUrl(interaction.fields.getTextInputValue("banner")),
      color: parseHex(interaction.fields.getTextInputValue("color"), DEFAULT_COLOR)
    };
    const check = checkProhibitedContent(input.name, input.description);
    if (check.blocked) {
      await reportViolation(client, guildId, {
        rule: "Painel de ticket com conteudo proibido",
        description: `Tentou criar o painel "${input.name}" (categoria: ${check.label}).`,
        reportedBy: interaction.user.id,
        severity: check.severity
      });
      await interaction.reply({ content: prohibitedContentMessage(check), flags: MessageFlags.Ephemeral });
      return true;
    }
    const item = mode === "edit" ? setPanel(guildId, panelId, (p) => ({ ...p, ...input })) : createPanel(guildId, input);
    await refreshPublicPanels(client, guildId, item.id);
    await interaction.update(payload(panelAdmin(client, guildId, ownerId, item.id)));
    return true;
  }
  if (parts[2] === "reason") {
    const panelId = parts[3];
    const reasonInput = {
      name: interaction.fields.getTextInputValue("name").trim(),
      description: interaction.fields.getTextInputValue("description").trim(),
      emoji: interaction.fields.getTextInputValue("emoji").trim()
    };
    const check = checkProhibitedContent(reasonInput.name, reasonInput.description);
    if (check.blocked) {
      await reportViolation(client, guildId, {
        rule: "Motivo de ticket com conteudo proibido",
        description: `Tentou criar o motivo "${reasonInput.name}" (categoria: ${check.label}).`,
        reportedBy: interaction.user.id,
        severity: check.severity
      });
      await interaction.reply({ content: prohibitedContentMessage(check), flags: MessageFlags.Ephemeral });
      return true;
    }
    createReason(guildId, panelId, reasonInput);
    await refreshPublicPanels(client, guildId, panelId);
    await interaction.update(payload(reasonsPanel(client, guildId, ownerId, panelId)));
    return true;
  }
  if (parts[2] === "schedule" || parts[2] === "weekend") {
    const panelId = parts[3];
    const start = normalizeTime(interaction.fields.getTextInputValue("start"));
    const end = normalizeTime(interaction.fields.getTextInputValue("end"));
    setPanel(guildId, panelId, (p) => {
      if (parts[2] === "weekend") {
        p.schedule.weekendEnabled = true;
        p.schedule.weekendStart = start;
        p.schedule.weekendEnd = end;
      } else {
        p.schedule.start = start;
        p.schedule.end = end;
      }
      return p;
    });
    await interaction.update(payload(schedulePanel(client, guildId, ownerId, panelId)));
    return true;
  }
  if (parts[2] === "send" && parts[3] === "appearance") {
    const mode = normalizePanelMode(parts[4]);
    const panelId = parts[5];
    const colorInput = mode !== "message" ? interaction.fields.getTextInputValue("color").trim() : "";
    const buttonInput = interaction.fields.getTextInputValue("buttonStyle").trim();
    const color = colorInput ? parseHex(colorInput, null) : null;
    if (colorInput && color === null) {
      await interaction.reply({ content: "Cor do container/embed invalida. Use um HEX valido, exemplo #5865F2, ou deixe vazio.", flags: MessageFlags.Ephemeral });
      return true;
    }
    const buttonStyle = normalizeButtonStyle(buttonInput);
    setPanel(guildId, panelId, (p) => {
      p.mode = mode;
      p.color = color;
      p.buttonStyle = buttonStyle;
      return p;
    });
    await refreshPublicPanels(client, guildId, panelId);
    await interaction.update(payload(sendPanel(client, ownerId, panelId)));
    return true;
  }
  if (parts[2] === "payment") {
    await createTicketPayment(interaction, parts[3]);
    return true;
  }
  if (parts[2] === "addid") {
    await addMemberById(interaction, parts[3], interaction.fields.getTextInputValue("id").trim());
    return true;
  }
  return false;
}
async function sendPublicPanel(interaction, panelId, channelId) {
  const item = getPanel(interaction.guildId, panelId);
  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!item || !channel?.isTextBased()) {
    await interaction.reply({ content: "Canal ou painel invalido.", flags: MessageFlags.Ephemeral });
    return;
  }
  const message = await channel.send(publicTicketPayload(interaction.client, item));
  setPanel(interaction.guildId, panelId, (p) => {
    p.publicPanels ||= [];
    p.publicPanels.push({ channelId: channel.id, messageId: message.id });
    return p;
  });
  if (interaction.deferred || interaction.replied) await interaction.followUp({ content: `Painel enviado em ${channel}.`, flags: MessageFlags.Ephemeral });
  else await interaction.update(payload(panelAdmin(interaction.client, interaction.guildId, interaction.user.id, panelId))).catch(() => null);
}
function ticketActionRows(client, item) {
  const reasons = reasonsList(item);
  const rows = [];
  if (reasons.length === 1) {
    rows.push(new ActionRowBuilder().addComponents(
      button(client, `ticket:open:${item.guildId}:${item.id}:${reasons[0].id}`, "Abrir Ticket", buttonStyleFromValue(item.buttonStyle), "mais2")
    ));
  } else if (reasons.length > 1) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`ticket:reason:${item.guildId}:${item.id}`)
        .setPlaceholder("Selecione o motivo do ticket")
        .addOptions(reasons.slice(0, 25).map((reason) => ({ label: reason.name.slice(0, 100), value: reason.id, description: (reason.description || "Atendimento").slice(0, 100), emoji: reason.emoji || componentEmoji(client, "recibo") })))
    ));
  }
  return rows;
}
function publicTicketPayload(client, item) {
  const reasons = reasonsList(item);
  const text = reasons.length ? item.description : `${item.description}\n\n${emojiText(client, "config2")} Configure pelo menos um motivo para abrir tickets.`;
  const rows = ticketActionRows(client, item);
  if (item.mode === "message") {
    return {
      content: `${emojiText(client, "recibo")} **${item.name}**\n\n${text}`,
      embeds: [],
      components: rows
    };
  }
  if (item.mode === "embed") {
    const embed = new EmbedBuilder().setTitle(`${emojiText(client, "recibo")} ${item.name}`).setDescription(text).setTimestamp();
    if (item.color) embed.setColor(item.color);
    if (item.banner) embed.setImage(item.banner);
    return { embeds: [embed], components: rows };
  }
  const panel = container(item.name, text, item.color);
  if (item.banner) panel.addMediaGalleryComponents(new MediaGalleryBuilder({ items: [{ media: { url: item.banner }, description: item.name }] }));
  rows.forEach((row) => panel.addActionRowComponents(row));
  return { components: [panel], flags: V2 };
}
async function refreshPublicPanels(client, guildId, panelId) {
  const item = getPanel(guildId, panelId);
  if (!item?.publicPanels?.length) return;
  const alive = [];
  for (const saved of item.publicPanels) {
    const channel = await client.channels.fetch(saved.channelId).catch(() => null);
    const message = channel?.isTextBased() ? await channel.messages.fetch(saved.messageId).catch(() => null) : null;
    if (!message) continue;
    const next = publicTicketPayload(client, getPanel(guildId, panelId));
    const ok = await message.edit(next).then(() => true).catch(() => false);
    if (ok) alive.push(saved);
    else {
      const sent = await channel.send(next).catch(() => null);
      if (sent) {
        await message.delete().catch(() => null);
        alive.push({ channelId: channel.id, messageId: sent.id });
      }
    }
  }
  setPanel(guildId, panelId, (p) => {
    p.publicPanels = alive;
    return p;
  });
}
async function repostPublicPanels(client, guildId, panelId) {
  const item = getPanel(guildId, panelId);
  if (!item?.publicPanels?.length) return { reposted: 0, failed: 0 };
  const alive = [];
  let failed = 0;
  for (const saved of item.publicPanels) {
    const channel = await client.channels.fetch(saved.channelId).catch(() => null);
    if (!channel?.isTextBased?.()) {
      failed += 1;
      continue;
    }
    const oldMessage = await channel.messages.fetch(saved.messageId).catch(() => null);
    if (oldMessage) await oldMessage.delete().catch(() => null);
    const next = publicTicketPayload(client, getPanel(guildId, panelId));
    const sent = await channel.send(next).catch(() => null);
    if (sent) alive.push({ channelId: channel.id, messageId: sent.id });
    else failed += 1;
  }
  setPanel(guildId, panelId, (p) => {
    p.publicPanels = alive;
    return p;
  });
  return { reposted: alive.length, failed };
}
async function handleTicketInteraction(interaction) {
  if (!interaction.customId?.startsWith("ticket:")) return false;
  const [prefix, action, guildId, panelId, value] = interaction.customId.split(":");
  const ticketId = panelId;
  if (prefix !== "ticket") return false;
  if (action === "reason") {
    await openTicket(interaction, guildId, panelId, interaction.values[0]);
    return true;
  }
  if (action === "open") {
    await openTicket(interaction, guildId, panelId, value);
    return true;
  }
  if (action === "option") {
    await handleTicketOption(interaction, guildId, ticketId, interaction.values[0]);
    return true;
  }
  if (action === "product") {
    await setTicketProduct(interaction, guildId, ticketId, interaction.values[0]);
    return true;
  }
  if (action === "claim") {
    await claimTicket(interaction, guildId, ticketId);
    return true;
  }
  if (action === "pingstaff") {
    await pingStaff(interaction, guildId, ticketId);
    return true;
  }
  if (action === "delete") {
    await deleteAndSaveTicket(interaction, guildId, ticketId);
    return true;
  }
  if (action === "adduser") {
    await addSelectedMember(interaction, guildId, ticketId);
    return true;
  }
  if (action === "removeuser") {
    await removeSelectedMember(interaction, guildId, ticketId);
    return true;
  }
  if (action === "addid") {
    await interaction.showModal(addIdModal(interaction.user.id, ticketId));
    return true;
  }
  if (action === "payok") {
    await approveTicketPayment(interaction, guildId, ticketId);
    return true;
  }
  if (action === "copypix") {
    const ticket = getOpenTicket(guildId, ticketId);
    await interaction.reply({ content: ticket?.payment?.payload || "Pagamento indisponivel.", flags: MessageFlags.Ephemeral });
    return true;
  }
  return true;
}
async function openTicket(interaction, guildId, panelId, reasonId) {
  if (await require("../oauth2").requireVerified(interaction, "ticket")) return;
  const item = getPanel(guildId, panelId);
  const reason = item?.reasons?.[reasonId];
  if (!item || !reason) {
    await interaction.reply({ content: "Motivo indisponivel.", flags: MessageFlags.Ephemeral });
    return;
  }
  const schedule = scheduleStatus(item);
  if (!schedule.open) {
    await interaction.reply({ content: `O suporte esta fora do horario. Atendimento: **${schedule.label}**.`, flags: MessageFlags.Ephemeral });
    return;
  }
  const hasOpenTicket = Object.values(guildStore(readTickets(guildId)).openTickets).some(t => t.openerId === interaction.user.id);
  if (hasOpenTicket) {
    await interaction.reply({ content: "Você já tem um ticket aberto. Feche-o antes de abrir outro. (limite: 1 por pessoa)", flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const thread = await interaction.channel.threads.create({
    name: channelThreadName("Suporte", interaction.user),
    type: interaction.channel.type === ChannelType.GuildText ? ChannelType.PrivateThread : ChannelType.PublicThread,
    autoArchiveDuration: 1440,
    reason: "Ticket aberto"
  });
  await thread.members.add(interaction.user.id).catch(() => null);
  const ticketId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  saveOpenTicket(guildId, ticketId, { id: ticketId, panelId, reasonId, openerId: interaction.user.id, threadId: thread.id, claimedBy: null, createdAt: Date.now() });
  const config = getGuildConfig(guildId);
  const mention = config.tickets.roles.support ? `<@&${config.tickets.roles.support}>` : "equipe";
  const panelMessage = await thread.send(ticketThreadPayload(interaction.client, guildId, ticketId, `${mention} ${interaction.user}`));
  await panelMessage.pin().catch(() => null);
  await thread.send(ticketHelpPayload(interaction.client, guildId, ticketId));
  await logTicket(interaction.client, guildId, {
    title: "Ticket aberto",
    description: "Um novo ticket foi criado.",
    color: OK_COLOR,
    fields: [
      ["Usuario", `${interaction.user}`],
      ["Motivo", reason.name],
      ["Thread", `${thread}`]
    ]
  });
  await interaction.editReply({ title: "Ticket criado", content: `${thread}` });
}
function ticketHelpPayload(client, guildId, ticketId) {
  const ticket = getOpenTicket(guildId, ticketId);
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0x2b2d31)
        .setDescription(`👋 Ola, <@${ticket.openerId}>. Em que podemos ajudar?\n\n⏱️ Por favor, aguarde enquanto um membro da nossa equipe venha lhe atender.`)
        .setTimestamp()
    ],
    allowedMentions: { users: [ticket.openerId] }
  };
}
function ticketThreadPayload(client, guildId, ticketId, mentionLine = "") {
  const ticket = getOpenTicket(guildId, ticketId);
  if (!ticket) {
    return { components: [container("Ticket", "Nao consegui encontrar os dados deste ticket.", DANGER_COLOR)], flags: V2 };
  }
  const item = getPanel(guildId, ticket.panelId);
  if (!item) {
    return { components: [container("Ticket", "O painel original deste ticket foi apagado.", DANGER_COLOR)], flags: V2 };
  }
  const reason = item.reasons[ticket.reasonId] || { name: "Atendimento", description: "Explique sua situacao para a equipe." };
  const opener = client.users.cache.get(ticket.openerId);
  const openerName = opener?.username || "Usuario";
  const openerAvatar = opener?.displayAvatarURL?.({ size: 64 });
  const rows = [];
  const config = getGuildConfig(guildId);
  const panelChoices = [];
  if (item.options.adminPanel) {
    panelChoices.push({ label: "Painel staff", value: "panel:staff", description: "Ferramentas de atendimento da equipe.", emoji: componentEmoji(client, "users") });
  }
  if (item.options.memberPanel) {
    panelChoices.push({ label: "Painel membro", value: "panel:member", description: "Acoes disponiveis para quem abriu o ticket.", emoji: componentEmoji(client, "user") });
  }
  if (panelChoices.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`ticket:option:${guildId}:${ticketId}`)
        .setPlaceholder("Selecione um painel")
        .addOptions(panelChoices)
    ));
  }
  const recent = recentSales(guildId, ticket.openerId);
  if (recent.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`ticket:product:${guildId}:${ticketId}`)
        .setPlaceholder("Produtos comprados nas ultimas 10 horas")
        .addOptions(recent.slice(0, 25).map((order) => ({ label: order.productName.slice(0, 100), value: order.id, description: `${order.fieldName || "Produto"} - R$ ${Number(order.total || 0).toFixed(2)}`.slice(0, 100) })))
    ));
  }
  rows.push(new ActionRowBuilder().addComponents(
    button(client, `ticket:pingstaff:${guildId}:${ticketId}`, "Notificar", ButtonStyle.Primary, "clock"),
    button(client, `ticket:claim:${guildId}:${ticketId}`, "Assumir Ticket", ButtonStyle.Secondary, "positivo")
  ));
  rows.push(new ActionRowBuilder().addComponents(
    button(client, `ticket:delete:${guildId}:${ticketId}`, "Deletar e Salvar", ButtonStyle.Danger, "apagar")
  ));
  const embed = new EmbedBuilder()
    .setColor(item.color)
    .setAuthor({ name: openerName, iconURL: openerAvatar })
    .setTitle(reason.name || "Suporte")
    .setDescription([
      item.description || "Apos solicitar atendimento, aguarde um integrante da equipe responder.",
      "",
      "O atendimento e realizado de forma privada. Somente voce, membros adicionados e a equipe terao acesso a este ticket.",
      "",
      `**Motivo**`,
      `${reason.emoji ? `${reason.emoji} ` : ""}${reason.name}`,
      reason.description ? `\n${reason.description}` : "",
      "",
      `**Detalhes**`,
      `Aberto por: <@${ticket.openerId}>`,
      `Assumido por: ${ticket.claimedBy ? `<@${ticket.claimedBy}>` : "`ninguem`"}`,
      `Categoria: **${ticket.productId ? "suporte a compra" : "suporte"}**`,
      ticket.productName ? `Compra vinculada: **${ticket.productName}**` : ""
    ].filter(Boolean).join("\n"))
    .setTimestamp();
  if (item.banner) embed.setImage(item.banner);
  return {
    content: mentionLine || undefined,
    embeds: [embed],
    components: rows,
    allowedMentions: config.tickets.roles.support ? { roles: [config.tickets.roles.support], users: [ticket.openerId] } : undefined
  };
}
async function handleTicketOption(interaction, guildId, ticketId, option) {
  const ticket = getOpenTicket(guildId, ticketId);
  if (!ticket) return interaction.reply({ content: "Ticket nao encontrado.", flags: MessageFlags.Ephemeral });
  if (option === "panel:staff") {
    if (!canUseTicketAdmin(interaction, guildId)) return interaction.reply({ content: "Somente suporte pode abrir o painel staff.", flags: MessageFlags.Ephemeral });
    return interaction.reply(staffPanelPayload(interaction.client, guildId, ticketId));
  }
  if (option === "panel:member") return interaction.reply(memberPanelPayload(interaction.client, guildId, ticketId));
  const isAdmin = canUseTicketAdmin(interaction, guildId);
  if (option.startsWith("admin:") && !isAdmin) return interaction.reply({ content: "Somente suporte pode usar o painel admin.", flags: MessageFlags.Ephemeral });
  if (option === "admin:add" || option === "member:add") return interaction.reply(addUserPicker(interaction.client, guildId, ticketId));
  if (option === "admin:remove") return interaction.reply(removeUserPicker(interaction.client, guildId, ticketId));
  if (option === "admin:transcript") return sendTranscript(interaction, guildId, ticketId);
  if (option === "admin:claim") return claimTicket(interaction, guildId, ticketId);
  if (option === "admin:payment") return interaction.showModal(paymentModal(interaction.user.id, ticketId));
  if (option === "admin:markmember") return interaction.reply({ content: `<@${ticket.openerId}>`, allowedMentions: { users: [ticket.openerId] } });
  if (option === "member:pingstaff") return pingStaff(interaction, guildId, ticketId);
  return interaction.reply({ content: "Opcao indisponivel.", flags: MessageFlags.Ephemeral });
}
function staffPanelPayload(client, guildId, ticketId) {
  const panel = container(
    "Painel staff",
    [
      "Ferramentas de atendimento para a equipe.",
      "",
      "Use com cuidado: algumas acoes alteram membros, pagamento e transcript do ticket."
    ].join("\n"),
    DEFAULT_COLOR
  );
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`ticket:option:${guildId}:${ticketId}`)
      .setPlaceholder("Selecione uma acao staff")
      .addOptions(
        { label: "Adicionar membro", value: "admin:add", description: "Adiciona um usuario ao ticket.", emoji: componentEmoji(client, "mais2") },
        { label: "Remover membro", value: "admin:remove", description: "Remove um usuario do ticket.", emoji: componentEmoji(client, "apagar") },
        { label: "Gerar transcript", value: "admin:transcript", description: "Gera um arquivo com as mensagens.", emoji: componentEmoji(client, "recibo") },
        { label: "Assumir ticket", value: "admin:claim", description: "Assume o atendimento e avisa o membro.", emoji: componentEmoji(client, "positivo") },
        { label: "Gerar pagamento", value: "admin:payment", description: "Gera QR Code Pix para o ticket.", emoji: componentEmoji(client, "pix") },
        { label: "Marcar membro", value: "admin:markmember", description: "Marca quem abriu o ticket.", emoji: componentEmoji(client, "user") }
      )
  ));
  return { components: [panel], flags: V2_EPHEMERAL };
}
function memberPanelPayload(client, guildId, ticketId) {
  const panel = container(
    "Painel membro",
    [
      "Acoes rapidas para quem abriu o ticket.",
      "",
      "O aviso ao staff tem limite de uso para evitar spam."
    ].join("\n"),
    OK_COLOR
  );
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`ticket:option:${guildId}:${ticketId}`)
      .setPlaceholder("Selecione uma acao")
      .addOptions(
        { label: "Adicionar membro", value: "member:add", description: "Adiciona outra pessoa ao ticket.", emoji: componentEmoji(client, "mais2") },
        { label: "Marcar staff assumido", value: "member:pingstaff", description: "Marca o staff assumido a cada 5 horas.", emoji: componentEmoji(client, "users") }
      )
  ));
  return { components: [panel], flags: V2_EPHEMERAL };
}
function addUserPicker(client, guildId, ticketId) {
  const panel = container("Adicionar membro", "Selecione o membro para adicionar ou use o botao de ID.", DEFAULT_COLOR);
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(`ticket:adduser:${guildId}:${ticketId}`).setPlaceholder("Selecionar membro").setMinValues(1).setMaxValues(1))
  );
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(button(client, `ticket:addid:${guildId}:${ticketId}`, "Adicionar por ID", ButtonStyle.Secondary, "mais2"))
  );
  return {
    components: [panel],
    flags: V2_EPHEMERAL
  };
}
function removeUserPicker(client, guildId, ticketId) {
  const panel = container("Remover membro", "Selecione o membro que sera removido do ticket.", DANGER_COLOR);
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(`ticket:removeuser:${guildId}:${ticketId}`).setPlaceholder("Selecionar membro").setMinValues(1).setMaxValues(1))
  );
  return {
    components: [panel],
    flags: V2_EPHEMERAL
  };
}
async function addSelectedMember(interaction, guildId, ticketId) {
  const ticket = getOpenTicket(guildId, ticketId);
  if (!canUseTicketAdmin(interaction, guildId) && ticket?.openerId !== interaction.user.id) return interaction.reply({ content: "Somente suporte ou quem abriu o ticket pode adicionar membros.", flags: MessageFlags.Ephemeral });
  await addMemberById(interaction, ticketId, interaction.values[0]);
}
async function addMemberById(interaction, ticketId, userId) {
  await interaction.channel.members.add(userId).catch(() => null);
  await interaction.reply({ content: `<@${userId}> foi adicionado ao ticket.`, flags: MessageFlags.Ephemeral });
}
async function removeSelectedMember(interaction, guildId, ticketId) {
  if (!canUseTicketAdmin(interaction, guildId)) return interaction.reply({ content: "Somente suporte pode remover membros.", flags: MessageFlags.Ephemeral });
  const userId = interaction.values[0];
  await interaction.channel.members.remove(userId).catch(() => null);
  await interaction.reply({ content: `<@${userId}> foi removido do ticket.`, flags: MessageFlags.Ephemeral });
}
async function claimTicket(interaction, guildId, ticketId) {
  const current = getOpenTicket(guildId, ticketId);
  if (!current) return interaction.reply({ content: "Ticket nao encontrado.", flags: MessageFlags.Ephemeral });
  if (!canUseTicketAdmin(interaction, guildId)) return interaction.reply({ content: "Somente suporte pode assumir tickets.", flags: MessageFlags.Ephemeral });
  setOpenTicket(guildId, ticketId, (ticket) => ({ ...ticket, claimedBy: interaction.user.id }));
  await interaction.reply({ content: `<@${getOpenTicket(guildId, ticketId).openerId}> seu ticket foi assumido por ${interaction.user}.`, allowedMentions: { users: [getOpenTicket(guildId, ticketId).openerId] } });
  await interaction.message?.edit(ticketThreadPayload(interaction.client, guildId, ticketId)).catch(() => null);
}
async function pingStaff(interaction, guildId, ticketId) {
  const ticket = getOpenTicket(guildId, ticketId);
  const key = `${ticketId}:${interaction.user.id}:pingstaff`;
  const data = readTickets(guildId);
  const store = guildStore(data);
  const last = store.cooldowns[key] || 0;
  if (Date.now() - last < 5 * 60 * 60 * 1000) {
    await interaction.reply({ content: "Voce so pode marcar novamente a cada 5 horas.", flags: MessageFlags.Ephemeral });
    return;
  }
  store.cooldowns[key] = Date.now();
  writeTickets(guildId, data);
  const target = ticket.claimedBy ? `<@${ticket.claimedBy}>` : (getGuildConfig(guildId).tickets.roles.support ? `<@&${getGuildConfig(guildId).tickets.roles.support}>` : "equipe");
  await interaction.reply({ content: `${target} o membro solicitou atendimento.`, allowedMentions: ticket.claimedBy ? { users: [ticket.claimedBy] } : undefined });
}
async function setTicketProduct(interaction, guildId, ticketId, orderId) {
  const ticket = getOpenTicket(guildId, ticketId);
  if (!ticket) return interaction.reply({ content: "Ticket nao encontrado.", flags: MessageFlags.Ephemeral });
  const order = recentSales(guildId, interaction.user.id).find((item) => item.id === orderId);
  if (!order) return interaction.reply({ content: "Compra recente nao encontrada.", flags: MessageFlags.Ephemeral });
  setOpenTicket(guildId, ticketId, (ticket) => ({ ...ticket, productId: order.id, productName: order.productName }));
  await interaction.update(ticketThreadPayload(interaction.client, guildId, ticketId));
}
async function sendTranscript(interaction, guildId, ticketId) {
  if (!canUseTicketAdmin(interaction, guildId)) return interaction.reply({ content: "Somente suporte pode gerar transcript.", flags: MessageFlags.Ephemeral });
  const files = await transcriptFiles(interaction.channel, ticketId);
  await interaction.reply({ content: "Transcript gerado.", files, flags: MessageFlags.Ephemeral });
  await logTicket(interaction.client, guildId, {
    title: "Transcript gerado",
    description: "Um transcript foi gerado manualmente pela equipe.",
    color: OK_COLOR,
    fields: [
      ["Ticket", `#${ticketId}`],
      ["Canal", `${interaction.channel}`],
      ["Gerado por", `${interaction.user}`]
    ],
    files
  });
}
async function deleteAndSaveTicket(interaction, guildId, ticketId) {
  if (!canUseTicketAdmin(interaction, guildId)) {
    await interaction.reply({ content: "Somente suporte pode deletar e salvar o ticket.", flags: MessageFlags.Ephemeral });
    return;
  }
  const ticket = getOpenTicket(guildId, ticketId);
  if (!ticket) {
    await interaction.reply({ content: "Ticket nao encontrado.", flags: MessageFlags.Ephemeral });
    return;
  }
  const files = await transcriptFiles(interaction.channel, ticketId);
  await logTicket(interaction.client, guildId, {
    title: "Ticket fechado",
    description: "O ticket foi salvo e fechado pela equipe.",
    color: DANGER_COLOR,
    fields: [
      ["Ticket", `#${ticketId}`],
      ["Aberto por", `<@${ticket.openerId}>`],
      ["Fechado por", `${interaction.user}`],
      ["Canal", `${interaction.channel}`]
    ],
    files
  });
  await interaction.reply({ content: "Ticket salvo no log. Este canal sera deletado em alguns segundos.", flags: MessageFlags.Ephemeral });
  removeOpenTicket(guildId, ticketId);
  setTimeout(() => interaction.channel.delete("Ticket fechado e salvo").catch(() => null), 5000);
}
async function transcriptFiles(channel, ticketId) {
  const sorted = await fetchTranscriptMessages(channel);
  const entries = sorted.map(transcriptEntry);
  const meta = ticketTranscriptMeta(channel, ticketId, entries);
  const text = ticketTranscriptText(channel, ticketId, entries, meta);
  const html = ticketTranscriptHtml(channel, ticketId, entries, meta);
  return [
    { attachment: Buffer.from(text, "utf8"), name: `ticket-${ticketId}.txt` },
    { attachment: Buffer.from(html, "utf8"), name: `ticket-${ticketId}.html` }
  ];
}
async function fetchTranscriptMessages(channel, maxMessages = 1000) {
  const collected = [];
  let before;
  while (collected.length < maxMessages) {
    const batch = await channel.messages.fetch({ limit: Math.min(100, maxMessages - collected.length), before }).catch(() => null);
    if (!batch?.size) break;
    collected.push(...batch.values());
    before = batch.last()?.id;
    if (batch.size < 100) break;
  }
  return collected.reverse();
}
function transcriptEntry(message) {
  return {
    id: message.id,
    authorId: message.author?.id || null,
    authorTag: message.author?.tag || message.author?.username || "Usuario",
    authorName: message.author?.username || "Usuario",
    authorBot: Boolean(message.author?.bot),
    avatar: message.author?.displayAvatarURL?.({ size: 128 }) || "",
    createdAt: message.createdTimestamp,
    content: message.content || "",
    attachments: [...(message.attachments?.values?.() || [])].map((attachment) => ({
      name: attachment.name || "anexo",
      url: attachment.url,
      contentType: attachment.contentType || "",
      size: attachment.size || 0
    })),
    embeds: (message.embeds || []).map((embed) => ({
      title: embed.title || "",
      description: embed.description || "",
      url: embed.url || "",
      color: embed.color || null,
      author: embed.author?.name || "",
      fields: (embed.fields || []).map((field) => ({ name: field.name || "", value: field.value || "" })),
      footer: embed.footer?.text || "",
      image: embed.image?.url || "",
      thumbnail: embed.thumbnail?.url || ""
    })),
    components: (message.components || []).length,
    stickers: [...(message.stickers?.values?.() || [])].map((sticker) => sticker.name || sticker.id),
    reactions: [...(message.reactions?.cache?.values?.() || [])].map((reaction) => ({
      emoji: reaction.emoji?.toString?.() || reaction.emoji?.name || "",
      count: reaction.count || 0
    }))
  };
}
function ticketTranscriptMeta(channel, ticketId, entries) {
  const ticket = getOpenTicket(channel.guild?.id, ticketId);
  const panel = ticket?.panelId ? getPanel(channel.guild?.id, ticket.panelId) : null;
  const reason = panel?.reasons?.[ticket?.reasonId] || null;
  const participants = new Map();
  for (const entry of entries) {
    if (!entry.authorId) continue;
    participants.set(entry.authorId, {
      id: entry.authorId,
      tag: entry.authorTag,
      name: entry.authorName,
      bot: entry.authorBot,
      avatar: entry.avatar
    });
  }
  return {
    ticket,
    panel,
    reason,
    participants: [...participants.values()],
    generatedAt: Date.now(),
    messageCount: entries.length,
    attachmentCount: entries.reduce((total, entry) => total + entry.attachments.length, 0),
    embedCount: entries.reduce((total, entry) => total + entry.embeds.length, 0)
  };
}
function ticketTranscriptText(channel, ticketId, entries, meta) {
  const lines = [
    `TRANSCRIPT DO TICKET #${ticketId}`,
    `Canal: #${channel.name || "ticket"} (${channel.id})`,
    `Servidor: ${channel.guild?.name || "Servidor"} (${channel.guild?.id || "sem-id"})`,
    `Gerado em: ${formatDate(meta.generatedAt)}`,
    `Aberto por: ${meta.ticket?.openerId ? `<@${meta.ticket.openerId}> (${meta.ticket.openerId})` : "Nao identificado"}`,
    `Assumido por: ${meta.ticket?.claimedBy ? `<@${meta.ticket.claimedBy}> (${meta.ticket.claimedBy})` : "Ninguem"}`,
    `Painel: ${meta.panel?.name || "Nao identificado"}`,
    `Motivo: ${meta.reason?.name || "Nao identificado"}`,
    `Produto vinculado: ${meta.ticket?.productName || "Nenhum"}`,
    `Mensagens: ${meta.messageCount} | Participantes: ${meta.participants.length} | Anexos: ${meta.attachmentCount} | Embeds: ${meta.embedCount}`,
    "",
    "PARTICIPANTES",
    ...(meta.participants.length ? meta.participants.map((user) => `- ${user.tag} (${user.id})${user.bot ? " [BOT]" : ""}`) : ["- Nenhum participante identificado"]),
    "",
    "MENSAGENS"
  ];
  if (!entries.length) lines.push("Sem mensagens.");
  for (const entry of entries) {
    lines.push("");
    lines.push(`[${formatDate(entry.createdAt)}] ${entry.authorTag}${entry.authorBot ? " [BOT]" : ""}:`);
    lines.push(entry.content || "[sem texto]");
    for (const embed of entry.embeds) {
      lines.push(`  [EMBED] ${embed.title || "Sem titulo"}`);
      if (embed.description) lines.push(`  ${embed.description.replace(/\n/g, "\n  ")}`);
      for (const field of embed.fields) lines.push(`  - ${field.name}: ${field.value.replace(/\n/g, " / ")}`);
    }
    for (const attachment of entry.attachments) lines.push(`  [ANEXO] ${attachment.name}: ${attachment.url}`);
    if (entry.components) lines.push(`  [COMPONENTES] ${entry.components} linha(s) de componente`);
    if (entry.reactions.length) lines.push(`  [REACOES] ${entry.reactions.map((reaction) => `${reaction.emoji} x${reaction.count}`).join(", ")}`);
  }
  return lines.join("\n");
}
function ticketTranscriptHtml(channel, ticketId, entries, meta) {
  const opener = meta.ticket?.openerId ? mentionText(meta.ticket.openerId) : "Nao identificado";
  const claimedBy = meta.ticket?.claimedBy ? mentionText(meta.ticket.claimedBy) : "Ninguem";
  const participantRows = meta.participants.map((user) => `
      <div class="participant">
        <img src="${escapeAttr(user.avatar)}" alt="">
        <div><strong>${escapeHtml(user.name)}</strong><span>${escapeHtml(user.id)}${user.bot ? " - BOT" : ""}</span></div>
      </div>`).join("");
  const rows = entries.map((message) => {
    const author = escapeHtml(message.authorName);
    const tag = escapeHtml(message.authorTag);
    const time = escapeHtml(formatDate(message.createdAt));
    const content = message.content
      ? linkify(escapeHtml(message.content)).replace(/\n/g, "<br>")
      : (message.embeds.length || message.attachments.length || message.components ? "" : `<span class="muted">[sem texto]</span>`);
    const embeds = message.embeds.map(renderTranscriptEmbed).join("");
    const attachments = renderTranscriptAttachments(message.attachments);
    const stickers = message.stickers.length ? `<div class="stickers">${message.stickers.map((name) => `<span>${escapeHtml(name)}</span>`).join("")}</div>` : "";
    const components = message.components ? `<div class="components">Mensagem com ${message.components} linha(s) de componente.</div>` : "";
    const reactions = message.reactions.length ? `<div class="reactions">${message.reactions.map((reaction) => `<span>${escapeHtml(reaction.emoji)} ${reaction.count}</span>`).join("")}</div>` : "";
    return `
      <article class="message${message.authorBot ? " bot" : ""}" id="message-${escapeAttr(message.id)}">
        <img class="avatar" src="${escapeAttr(message.avatar)}" alt="">
        <div class="body">
          <div class="meta"><span class="author">${author}</span>${message.authorBot ? '<span class="bot-badge">BOT</span>' : ""}<span class="tag">${tag}</span><span class="time">${time}</span></div>
          <div class="content">${content}</div>
          ${embeds}
          ${attachments}
          ${stickers}
          ${components}
          ${reactions}
        </div>
      </article>`;
  }).join("\n");
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Transcript Ticket #${escapeHtml(ticketId)}</title>
  <style>
    :root { color-scheme: dark; --bg:#0f1117; --panel:#1f2129; --panel2:#171923; --line:#30333d; --text:#f2f3f5; --muted:#a3a7b1; --accent:#5865f2; --green:#2ecc71; --red:#e74c3c; }
    * { box-sizing: border-box; }
    body { margin:0; background:var(--bg); color:var(--text); font:15px/1.45 Inter, "Segoe UI", Arial, sans-serif; }
    header { padding:30px 32px; border-bottom:1px solid var(--line); background:linear-gradient(135deg, #262936, #151720); position:sticky; top:0; z-index:5; box-shadow:0 16px 38px rgba(0,0,0,.28); }
    h1 { margin:0 0 6px; font-size:26px; letter-spacing:0; }
    .subtitle { color:var(--muted); }
    main { max-width:1180px; margin:0 auto; padding:26px 18px 56px; display:grid; grid-template-columns:310px 1fr; gap:18px; }
    .summary, .channel { background:var(--panel); border:1px solid var(--line); border-radius:12px; overflow:hidden; box-shadow:0 16px 40px rgba(0,0,0,.22); }
    .summary { align-self:start; position:sticky; top:112px; }
    .summary h2, .channel-title { margin:0; padding:16px 18px; border-bottom:1px solid var(--line); font-size:16px; }
    .stats { display:grid; grid-template-columns:1fr 1fr; gap:8px; padding:14px; }
    .stat { background:var(--panel2); border:1px solid rgba(255,255,255,.06); border-radius:8px; padding:10px; }
    .stat span, .kv span, .participant span { display:block; color:var(--muted); font-size:12px; }
    .stat strong, .kv strong { display:block; margin-top:2px; word-break:break-word; }
    .kv-list { padding:0 14px 14px; display:grid; gap:8px; }
    .kv { background:rgba(255,255,255,.035); border:1px solid rgba(255,255,255,.055); border-radius:8px; padding:10px; }
    .participants { padding:0 14px 16px; display:grid; gap:8px; }
    .participant { display:flex; gap:10px; align-items:center; }
    .participant img { width:30px; height:30px; border-radius:50%; background:#30333d; }
    .channel-title { display:flex; justify-content:space-between; gap:12px; align-items:center; }
    .channel-title span { color:var(--muted); font-size:12px; font-weight:500; }
    .message { display:flex; gap:14px; padding:14px 22px; border-bottom:1px solid rgba(255,255,255,.04); }
    .message:hover { background:rgba(255,255,255,.025); }
    .message.bot { background:rgba(88,101,242,.035); }
    .avatar { width:42px; height:42px; border-radius:50%; background:#30333d; flex:0 0 auto; }
    .body { min-width:0; flex:1; }
    .meta { display:flex; flex-wrap:wrap; gap:8px; align-items:baseline; margin-bottom:3px; }
    .author { font-weight:700; color:#fff; }
    .tag, .time { color:var(--muted); font-size:12px; }
    .bot-badge { background:var(--accent); color:white; border-radius:4px; padding:1px 5px; font-size:10px; font-weight:800; }
    .content { white-space:normal; word-break:break-word; }
    .muted { color:var(--muted); font-style:italic; }
    .embed { margin-top:8px; max-width:620px; border-left:4px solid var(--accent); background:rgba(0,0,0,.18); border-radius:7px; padding:10px 12px; }
    .embed-author, .embed-footer { color:var(--muted); font-size:12px; }
    .embed-title { font-weight:800; margin:2px 0 6px; }
    .embed-description { color:#dbdee1; white-space:pre-wrap; word-break:break-word; }
    .embed-fields { display:grid; gap:7px; margin-top:8px; }
    .embed-field { background:rgba(255,255,255,.035); border-radius:6px; padding:7px; }
    .embed-field strong { display:block; margin-bottom:2px; }
    .embed img { max-width:100%; border-radius:6px; margin-top:8px; border:1px solid rgba(255,255,255,.08); }
    .attachments { margin-top:8px; display:grid; gap:8px; max-width:620px; }
    .attachment { color:#dbe2ff; background:rgba(88,101,242,.16); border:1px solid rgba(88,101,242,.35); padding:8px 10px; border-radius:7px; text-decoration:none; display:inline-block; width:max-content; max-width:100%; word-break:break-word; }
    .attachment-image { max-width:420px; border-radius:8px; border:1px solid rgba(255,255,255,.1); display:block; }
    .components, .stickers, .reactions { margin-top:8px; display:flex; gap:7px; flex-wrap:wrap; color:var(--muted); }
    .components, .stickers span, .reactions span { background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.08); border-radius:999px; padding:4px 8px; font-size:12px; }
    a { color:#8ea1ff; }
    @media (max-width: 880px) { header { position:static; } main { grid-template-columns:1fr; } .summary { position:static; } }
  </style>
</head>
<body>
  <header>
    <h1>Transcript Ticket #${escapeHtml(ticketId)}</h1>
    <div class="subtitle">${escapeHtml(channel.guild?.name || "Servidor")} / #${escapeHtml(channel.name || "ticket")} - gerado em ${escapeHtml(formatDate(meta.generatedAt))}</div>
  </header>
  <main>
    <aside class="summary">
      <h2>Resumo do ticket</h2>
      <div class="stats">
        <div class="stat"><span>Mensagens</span><strong>${meta.messageCount}</strong></div>
        <div class="stat"><span>Participantes</span><strong>${meta.participants.length}</strong></div>
        <div class="stat"><span>Anexos</span><strong>${meta.attachmentCount}</strong></div>
        <div class="stat"><span>Embeds</span><strong>${meta.embedCount}</strong></div>
      </div>
      <div class="kv-list">
        <div class="kv"><span>Aberto por</span><strong>${escapeHtml(opener)}</strong></div>
        <div class="kv"><span>Assumido por</span><strong>${escapeHtml(claimedBy)}</strong></div>
        <div class="kv"><span>Painel</span><strong>${escapeHtml(meta.panel?.name || "Nao identificado")}</strong></div>
        <div class="kv"><span>Motivo</span><strong>${escapeHtml(meta.reason?.name || "Nao identificado")}</strong></div>
        <div class="kv"><span>Produto vinculado</span><strong>${escapeHtml(meta.ticket?.productName || "Nenhum")}</strong></div>
      </div>
      <h2>Participantes</h2>
      <div class="participants">${participantRows || '<span class="muted">Nenhum participante identificado.</span>'}</div>
    </aside>
    <section class="channel">
      <div class="channel-title"><strong># ${escapeHtml(channel.name || "ticket")}</strong><span>ID ${escapeHtml(channel.id)}</span></div>
      ${rows || '<div class="message"><div class="body muted">Sem mensagens.</div></div>'}
    </section>
  </main>
</body>
</html>`;
}
function renderTranscriptEmbed(embed) {
  const color = Number.isInteger(embed.color) ? `#${embed.color.toString(16).padStart(6, "0")}` : "var(--accent)";
  const fields = embed.fields.map((field) => `<div class="embed-field"><strong>${escapeHtml(field.name)}</strong><div>${linkify(escapeHtml(field.value)).replace(/\n/g, "<br>")}</div></div>`).join("");
  return `
    <div class="embed" style="border-left-color:${escapeAttr(color)}">
      ${embed.author ? `<div class="embed-author">${escapeHtml(embed.author)}</div>` : ""}
      ${embed.title ? `<div class="embed-title">${embed.url ? `<a href="${escapeAttr(embed.url)}">${escapeHtml(embed.title)}</a>` : escapeHtml(embed.title)}</div>` : ""}
      ${embed.description ? `<div class="embed-description">${linkify(escapeHtml(embed.description)).replace(/\n/g, "<br>")}</div>` : ""}
      ${fields ? `<div class="embed-fields">${fields}</div>` : ""}
      ${embed.thumbnail ? `<img src="${escapeAttr(embed.thumbnail)}" alt="thumbnail">` : ""}
      ${embed.image ? `<img src="${escapeAttr(embed.image)}" alt="imagem do embed">` : ""}
      ${embed.footer ? `<div class="embed-footer">${escapeHtml(embed.footer)}</div>` : ""}
    </div>`;
}
function renderTranscriptAttachments(attachments) {
  if (!attachments.length) return "";
  return `<div class="attachments">${attachments.map((attachment) => {
    const isImage = attachment.contentType?.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(attachment.url || attachment.name || "");
    const size = attachment.size ? ` - ${formatBytes(attachment.size)}` : "";
    if (isImage) {
      return `<div><a class="attachment" href="${escapeAttr(attachment.url)}">${escapeHtml(attachment.name)}${escapeHtml(size)}</a><img class="attachment-image" src="${escapeAttr(attachment.url)}" alt="${escapeAttr(attachment.name)}"></div>`;
    }
    return `<a class="attachment" href="${escapeAttr(attachment.url)}">${escapeHtml(attachment.name)}${escapeHtml(size)}</a>`;
  }).join("")}</div>`;
}
function mentionText(userId) {
  return `@${userId}`;
}
function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" });
}
function formatBytes(size) {
  if (!size) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}
function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
function linkify(value) {
  return String(value || "").replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
}
async function createTicketPayment(interaction, ticketId) {
  if (!hasFullBotAccess(interaction, interaction.guildId)) {
    await interaction.reply({ content: "Somente owners ou usuarios com /perms podem gerar pagamento no ticket.", flags: MessageFlags.Ephemeral });
    return;
  }
  const config = getGuildConfig(interaction.guildId);
  if (!config.payments.pix.enabled || !config.payments.pix.key) return interaction.reply({ content: "Pix nao configurado.", flags: MessageFlags.Ephemeral });
  const what = interaction.fields.getTextInputValue("what").trim();
  const amount = parseBRL(interaction.fields.getTextInputValue("value"));
  if (!amount || amount <= 0) {
    await interaction.reply({ content: "Valor inválido. Informe um valor maior que R$ 0,00 (ex: 10,00).", flags: MessageFlags.Ephemeral });
    return;
  }
  const pix = buildPixPayload({ key: config.payments.pix.key, amount, name: "TICKET", city: "BRASIL", txid: `T${ticketId.slice(-20)}` });
  const png = await QRCode.toBuffer(pix, { width: 480, margin: 2 });
  setOpenTicket(interaction.guildId, ticketId, (ticket) => ({ ...ticket, payment: { what, amount, payload: pix, status: "pending" } }));
  await interaction.reply({
    embeds: [new EmbedBuilder().setColor(OK_COLOR).setTitle("Pagamento gerado").setDescription(`**${what}**\nValor: **${formatBRL(amount)}**`).setImage(`attachment://pix-${ticketId}.png`)],
    files: [{ attachment: png, name: `pix-${ticketId}.png` }],
    components: [new ActionRowBuilder().addComponents(button(interaction.client, `ticket:copypix:${interaction.guildId}:${ticketId}`, "Copia e cola", ButtonStyle.Secondary, "recibo"), button(interaction.client, `ticket:payok:${interaction.guildId}:${ticketId}`, "Aprovar pagamento", ButtonStyle.Success, "positivo"))]
  });
}
async function approveTicketPayment(interaction, guildId, ticketId) {
  if (!hasFullBotAccess(interaction, guildId)) return interaction.reply({ content: "Somente owners ou usuarios com /perms podem aprovar pagamento.", flags: MessageFlags.Ephemeral });
  setOpenTicket(guildId, ticketId, (ticket) => ({ ...ticket, payment: { ...(ticket.payment || {}), status: "approved", approvedBy: interaction.user.id } }));
  await interaction.update({ embeds: [new EmbedBuilder().setColor(OK_COLOR).setTitle("Pagamento aprovado").setDescription(`Pagamento do ticket **#${ticketId}** aprovado por ${interaction.user}.`)], components: [], attachments: [] });
}
function saveOpenTicket(guildId, ticketId, ticket) {
  const data = readTickets(guildId);
  guildStore(data).openTickets[ticketId] = ticket;
  writeTickets(guildId, data);
}
function getOpenTicket(guildId, ticketId) {
  return guildStore(readTickets(guildId)).openTickets[ticketId] || null;
}
function setOpenTicket(guildId, ticketId, updater) {
  const data = readTickets(guildId);
  const store = guildStore(data);
  store.openTickets[ticketId] = typeof updater === "function" ? updater(store.openTickets[ticketId]) : updater;
  writeTickets(guildId, data);
  return store.openTickets[ticketId];
}
function removeOpenTicket(guildId, ticketId) {
  const data = readTickets(guildId);
  delete guildStore(data).openTickets[ticketId];
  writeTickets(guildId, data);
}
function canUseTicketAdmin(interaction, guildId) {
  if (hasFullBotAccess(interaction, guildId)) return true;
  const role = getGuildConfig(guildId).tickets.roles.support;
  return Boolean(role && interaction.member?.roles?.cache?.has(role));
}
function hasFullBotAccess(interaction, guildId = interaction.guildId) {
  if (botOwnerIds(interaction.guild).includes(interaction.user.id)) return true;
  const permissions = getGuildConfig(guildId).permissions.users || [];
  return permissions.includes(interaction.user.id);
}
function channelThreadName(prefix, user) {
  const username = String(user?.username || "usuario")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w-]/g, "")
    .slice(0, 28) || "usuario";
  return `${prefix}・${username}・${user.id}`.slice(0, 90);
}
function recentSales(guildId, userId) {
  const { listOrders } = require("../sales");
  const maxAge = Date.now() - 10 * 60 * 60 * 1000;
  return listOrders(guildId).filter((order) => order.userId === userId && order.status === "delivered" && Number(order.deliveredAt || order.createdAt || 0) >= maxAge);
}
function scheduleStatus(item) {
  const s = item.schedule;
  const weekend = [0, 6].includes(new Date().getDay());
  if (!s.enabled) return { open: true, label: "sempre aberto" };
  if (weekend && !s.weekendEnabled) return { open: false, label: `${s.start} ate ${s.end}` };
  const start = weekend ? s.weekendStart : s.start;
  const end = weekend ? s.weekendEnd : s.end;
  return { open: isNowInRange(start, end), label: `${start} ate ${end}` };
}
function isNowInRange(start, end) {
  const now = new Date();
  const current = now.getHours() * 60 + now.getMinutes();
  const s = toMinutes(start);
  const e = toMinutes(end);
  return s <= e ? current >= s && current <= e : current >= s || current <= e;
}
function toMinutes(value) {
  const [h, m] = normalizeTime(value).split(":").map(Number);
  return h * 60 + m;
}
function normalizeTime(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return "12:00";
  const h = Math.max(0, Math.min(Number(match[1]), 23));
  const m = Math.max(0, Math.min(Number(match[2]), 59));
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function parseHex(value, fallback) {
  const clean = String(value || "").replace("#", "").trim();
  return /^[0-9a-fA-F]{6}$/.test(clean) ? Number.parseInt(clean, 16) : fallback;
}
function normalizeUrl(value) {
  const url = String(value || "").trim();
  return /^https?:\/\//i.test(url) ? url : null;
}
function intToHex(value) {
  return `#${Number(value || DEFAULT_COLOR).toString(16).padStart(6, "0").slice(-6).toUpperCase()}`;
}
function normalizeButtonStyle(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "secondary";
  if (["azul", "blue", "primary"].includes(text)) return "primary";
  if (["cinza", "gray", "grey", "secondary"].includes(text)) return "secondary";
  if (["vermelho", "red", "danger"].includes(text)) return "danger";
  if (["verde", "green", "success"].includes(text)) return "success";
  return "secondary";
}
function buttonStyleFromValue(value) {
  const styles = {
    primary: ButtonStyle.Primary,
    secondary: ButtonStyle.Secondary,
    danger: ButtonStyle.Danger,
    success: ButtonStyle.Success
  };
  return styles[value] || ButtonStyle.Secondary;
}
function buttonStyleLabel(value) {
  const labels = {
    primary: "azul",
    secondary: "cinza",
    danger: "vermelho",
    success: "verde"
  };
  return labels[value] || "cinza";
}
function normalizePanelMode(value) {
  if (value === "embed") return "embed";
  if (value === "message") return "message";
  return "container";
}
function panelModeLabel(mode) {
  if (mode === "embed") return "embed";
  if (mode === "message") return "mensagem";
  return "container";
}
function parseBRL(value) {
  const normalized = String(value || "0").replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  return Math.round((Number(normalized) || 0) * 100) / 100;
}
function formatBRL(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));
}
function buildPixPayload({ key, amount, name, city, txid }) {
  const merchantAccount = emv("00", "br.gov.bcb.pix") + emv("01", key);
  const base = [emv("00", "01"), emv("26", merchantAccount), emv("52", "0000"), emv("53", "986"), amount ? emv("54", Number(amount).toFixed(2)) : "", emv("58", "BR"), emv("59", sanitizePixText(name, 25)), emv("60", sanitizePixText(city, 15)), emv("62", emv("05", sanitizePixText(txid, 25)))].join("");
  const withoutCrc = `${base}6304`;
  return `${withoutCrc}${crc16(withoutCrc)}`;
}
function emv(id, value) {
  return `${id}${String(String(value).length).padStart(2, "0")}${value}`;
}
function sanitizePixText(value, max) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9 ]/g, "").slice(0, max).trim() || "PIX";
}
function crc16(payload) {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i += 1) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j += 1) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}
async function logTicket(client, guildId, titleOrOptions, description, color = DEFAULT_COLOR, files = []) {
  const channelId = getGuildConfig(guildId).tickets.channels.logs;
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const options = typeof titleOrOptions === "object"
    ? titleOrOptions
    : { title: titleOrOptions, description, color, files };
  const ts = Math.floor(Date.now() / 1000);
  const found = client.appEmojis?.get("w_ticket");
  const icon = found ? `<:${found.name}:${found.id}> ` : "";
  const panel = new ContainerBuilder().setAccentColor(options.color || color);
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${icon}${options.title || "Log de ticket"}\n${options.description || "Evento registrado no sistema de tickets."}`));
  const fields = (options.fields || []).map(([name, value]) => ({ name, value }));
  if (fields.length) {
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(compactTicketLines(fields)));
  }
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Sistema de Tickets • <t:${ts}:R>`));
  await channel.send({ components: [panel], flags: V2, files: options.files || files || [] }).catch(() => null);
}
function compactTicketLines(fields) {
  const lines = [];
  let pending = null;
  for (const f of fields) {
    const v = String(f.value ?? "—").slice(0, 1000);
    if (v.includes("\n") || v.length > 60) {
      if (pending) {
        lines.push(pending);
        pending = null;
      }
      lines.push(`**${f.name}:** ${v}`);
    } else if (!pending) {
      pending = `**${f.name}:** ${v}`;
    } else {
      lines.push(`${pending} ╺╸ **${f.name}:** ${v}`);
      pending = null;
    }
  }
  if (pending) lines.push(pending);
  return lines.join("\n");
}
module.exports = {
  handleTicketPanelComponent,
  handleTicketInteraction,
  handleTicketModal,
  panelsList,
  getPanel,
  setPanel,
  repostPublicPanels
};
