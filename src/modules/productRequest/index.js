const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  FileUploadBuilder,
  LabelBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  ModalBuilder,
  SectionBuilder,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  ThumbnailBuilder
} = require("discord.js");
const { ids } = require("../../config");
const { normalizeEmojiName } = require("../../emojis");
const { getGuildConfig } = require("../../storage");
const { botOwnerIds } = require("../../botOwners");
const { readGuildFile, writeGuildFile } = require("../../guildDb");
const V2 = MessageFlags.IsComponentsV2;
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
function readProductRequests(guildId) {
  return readGuildFile(guildId, "product-requests", () => ({ stockWaiters: {} }));
}
function writeProductRequests(guildId, data) {
  writeGuildFile(guildId, "product-requests", data);
}
function getAvailableProductPanels(guildId) {
  try {
    const salesData = readGuildFile(guildId, "sales", () => ({ products: {} }));
    return Object.values(salesData.products || {}).map((product) => ({
      id: product.id,
      name: product.name,
      fields: Object.values(product.fields || {})
    }));
  } catch {
    return [];
  }
}
function getProductPanelData(guildId, productId) {
  return getAvailableProductPanels(guildId).find((product) => product.id === productId) || null;
}
function selectStepContainer(title, description, actionRow) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}\n${description}`));
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addActionRowComponents(actionRow);
  return container;
}
async function reuploadAttachment(file) {
  try {
    const response = await fetch(file.url);
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    const safeName = (file.name || "exemplo.png").replace(/[^a-zA-Z0-9._-]/g, "_");
    return new AttachmentBuilder(buffer, { name: safeName });
  } catch (error) {
    console.error("[Solicitar Produto] Erro ao baixar imagem de exemplo:", error);
    return null;
  }
}
async function sendRequestLog(interaction, logContainer, files = []) {
  const config = getGuildConfig(interaction.guildId);
  const logChannelId = config.channels.productRequestLogs;
  if (!logChannelId) return false;
  try {
    const channel = await interaction.guild.channels.fetch(logChannelId);
    if (channel?.isTextBased()) {
      await channel.send({ components: [logContainer], flags: V2, files });
      return true;
    }
  } catch (error) {
    console.error("[Solicitar Produto] Erro ao enviar log:", error);
  }
  return false;
}
async function handleProductRequestCommand(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "solicitar-produto") return false;
  if (!interaction.inGuild()) {
    await interaction.reply({ content: "Este comando só pode ser usado dentro de um servidor.", flags: MessageFlags.Ephemeral });
    return true;
  }
  const isOwner = botOwnerIds(interaction.guild).includes(interaction.user.id);
  if (!isOwner) {
    await interaction.reply({ content: `${inlineEmoji(interaction.client, "circle_x")}Apenas owners do bot podem usar este comando.`, flags: MessageFlags.Ephemeral });
    return true;
  }
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${inlineEmoji(interaction.client, "package")}Painel de Solicitações\nPeça um **produto novo** para o catálogo ou solicite **reposição de estoque** de um produto já existente. Tudo fica registrado automaticamente no canal de log.`
    )
  );
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      withEmoji(
        new ButtonBuilder()
          .setCustomId("product_request_now")
          .setLabel("Solicitar agora")
          .setStyle(ButtonStyle.Secondary),
        interaction.client,
        "clipboard_list"
      )
    )
  );
  await interaction.reply({ components: [container], flags: V2 });
  return true;
}
async function handleProductRequestInteraction(interaction) {
  if (interaction.isButton() && interaction.customId === "product_request_now") {
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId("product_request_type")
      .setPlaceholder("Escolha uma opção")
      .addOptions(
        { label: "Solicitar novo produto", value: "new_product", emoji: componentEmoji(interaction.client, "sparkles"), description: "Pedir um produto que ainda não existe no catálogo" },
        { label: "Solicitar estoque", value: "request_stock", emoji: componentEmoji(interaction.client, "package"), description: "Pedir reposição de um produto já existente" }
      );
    const container = selectStepContainer(
      `${inlineEmoji(interaction.client, "clipboard_list")}O que você deseja fazer?`,
      "Escolha uma das opções abaixo para continuar.",
      new ActionRowBuilder().addComponents(selectMenu)
    );
    await interaction.reply({ components: [container], flags: V2 | MessageFlags.Ephemeral });
    return true;
  }
  if (interaction.isButton() && interaction.customId.startsWith("notify_stock:")) {
    const [, productId, fieldId] = interaction.customId.split(":");
    const data = readProductRequests(interaction.guildId);
    if (!data.stockWaiters) data.stockWaiters = {};
    if (!data.stockWaiters[fieldId]) data.stockWaiters[fieldId] = [];
    if (!data.stockWaiters[fieldId].includes(interaction.user.id)) {
      data.stockWaiters[fieldId].push(interaction.user.id);
      writeProductRequests(interaction.guildId, data);
    }
    await interaction.reply({ content: `${inlineEmoji(interaction.client, "bell")}Você será notificado quando este campo receber estoque!`, flags: MessageFlags.Ephemeral });
    const product = getProductPanelData(interaction.guildId, productId);
    const field = product?.fields.find((f) => f.id === fieldId);
    const logContainer = new ContainerBuilder();
    const section = new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `## ${inlineEmoji(interaction.client, "bell")}Novo aviso de estoque\n<@${interaction.user.id}> quer ser avisado quando **${field?.name || fieldId}** (${product?.name || productId}) tiver estoque novamente.\n-# <t:${Math.floor(Date.now() / 1000)}:R>`
        )
      )
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(interaction.user.displayAvatarURL()));
    logContainer.addSectionComponents(section);
    await sendRequestLog(interaction, logContainer);
    return true;
  }
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === "product_request_type") {
      const type = interaction.values[0];
      if (type === "new_product") {
        await interaction.showModal(buildNewProductModal());
        return true;
      }
      if (type === "request_stock") {
        const productPanels = getAvailableProductPanels(interaction.guildId);
        if (productPanels.length === 0) {
          const emptyContainer = new ContainerBuilder().addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`## ${inlineEmoji(interaction.client, "package")}Solicitar estoque\n${inlineEmoji(interaction.client, "circle_x")}Nenhum produto encontrado neste servidor.`)
          );
          await interaction.update({ components: [emptyContainer], flags: V2 });
          return true;
        }
        const selectRow = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("stock_request_product")
            .setPlaceholder("Escolha um produto")
            .addOptions(
              productPanels.slice(0, 25).map((product) => ({
                label: product.name.substring(0, 100),
                value: product.id,
                emoji: componentEmoji(interaction.client, "package")
              }))
            )
        );
        const container = selectStepContainer(
          `${inlineEmoji(interaction.client, "package")}Solicitar estoque`,
          "Escolha para qual produto você quer pedir reposição.",
          selectRow
        );
        await interaction.update({ components: [container], flags: V2 });
        return true;
      }
    }
    if (interaction.customId === "stock_request_product") {
      const productId = interaction.values[0];
      const product = getProductPanelData(interaction.guildId, productId);
      if (!product) {
        await interaction.reply({ content: `${inlineEmoji(interaction.client, "circle_x")}Produto não encontrado.`, flags: MessageFlags.Ephemeral });
        return true;
      }
      if (product.fields.length <= 1) {
        const field = product.fields[0];
        if (!field) {
          await interaction.reply({ content: `${inlineEmoji(interaction.client, "circle_x")}Este produto não possui campos configurados.`, flags: MessageFlags.Ephemeral });
          return true;
        }
        await routeStockField(interaction, productId, field);
        return true;
      }
      const fieldSelect = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`stock_field:${productId}`)
          .setPlaceholder("Escolha um campo")
          .addOptions(
            product.fields.slice(0, 25).map((field) => ({
              label: field.name.substring(0, 100),
              value: field.id,
              emoji: componentEmoji(interaction.client, "target")
            }))
          )
      );
      const container = selectStepContainer(
        `${inlineEmoji(interaction.client, "target")}Escolha o campo`,
        `O produto **${product.name}** tem mais de uma variação. Escolha para qual deseja pedir estoque.`,
        fieldSelect
      );
      await interaction.update({ components: [container], flags: V2 });
      return true;
    }
    if (interaction.customId.startsWith("stock_field:")) {
      const [, productId] = interaction.customId.split(":");
      const fieldId = interaction.values[0];
      const product = getProductPanelData(interaction.guildId, productId);
      const field = product?.fields.find((f) => f.id === fieldId);
      if (!field) {
        await interaction.reply({ content: `${inlineEmoji(interaction.client, "circle_x")}Campo não encontrado.`, flags: MessageFlags.Ephemeral });
        return true;
      }
      await routeStockField(interaction, productId, field);
      return true;
    }
  }
  if (interaction.isModalSubmit()) {
    if (interaction.customId === "product_request_modal") {
      const type = interaction.fields.getTextInputValue("product_type");
      const value = interaction.fields.getTextInputValue("product_value");
      const description = interaction.fields.getTextInputValue("product_description");
      const uploadedFiles = interaction.fields.getUploadedFiles("product_example_image");
      const exampleFile = uploadedFiles && uploadedFiles.size > 0 ? uploadedFiles.first() : null;
      const attachment = exampleFile ? await reuploadAttachment(exampleFile) : null;
      const logContainer = new ContainerBuilder();
      const section = new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `## ${inlineEmoji(interaction.client, "sparkles")}Nova solicitação de produto\nPedido por **${interaction.user.username}**\n-# <t:${Math.floor(Date.now() / 1000)}:R>`
          )
        )
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(interaction.user.displayAvatarURL()));
      logContainer.addSectionComponents(section);
      logContainer.addSeparatorComponents(new SeparatorBuilder());
      logContainer.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `**${inlineEmoji(interaction.client, "shopping_bag")}Tipo do produto**\n${type}\n\n` +
          `**${inlineEmoji(interaction.client, "hash")}Valor desejado**\n${value || "Não informado"}\n\n` +
          `**${inlineEmoji(interaction.client, "clipboard")}Descrição**\n${description || "Sem descrição fornecida"}`
        )
      );
      const files = [];
      if (attachment) {
        logContainer.addSeparatorComponents(new SeparatorBuilder());
        logContainer.addMediaGalleryComponents(
          new MediaGalleryBuilder().addItems(
            new MediaGalleryItemBuilder().setURL(`attachment://${attachment.name}`).setDescription("Imagem de exemplo enviada pelo solicitante")
          )
        );
        files.push(attachment);
      }
      const sent = await sendRequestLog(interaction, logContainer, files);
      await interaction.reply({
        content: sent
          ? `${inlineEmoji(interaction.client, "circle_check_big")}Solicitação enviada com sucesso!`
          : `${inlineEmoji(interaction.client, "circle_check_big")}Solicitação registrada! (nenhum canal de log configurado — avise um administrador para configurar em \`/panel\`)`,
        flags: MessageFlags.Ephemeral
      });
      return true;
    }
    if (interaction.customId.startsWith("stock_quantity_modal:")) {
      const [, productId, fieldId] = interaction.customId.split(":");
      const quantity = interaction.fields.getTextInputValue("quantity");
      const product = getProductPanelData(interaction.guildId, productId);
      const field = product?.fields.find((f) => f.id === fieldId);
      const logContainer = new ContainerBuilder();
      const section = new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `## ${inlineEmoji(interaction.client, "package")}Solicitação de estoque\nPedido por **${interaction.user.username}**\n-# <t:${Math.floor(Date.now() / 1000)}:R>`
          )
        )
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(interaction.user.displayAvatarURL()));
      logContainer.addSectionComponents(section);
      logContainer.addSeparatorComponents(new SeparatorBuilder());
      logContainer.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `**${inlineEmoji(interaction.client, "shopping_bag")}Produto**\n${product?.name || productId}\n\n` +
          `**${inlineEmoji(interaction.client, "target")}Campo**\n${field?.name || fieldId}\n\n` +
          `**${inlineEmoji(interaction.client, "hash")}Quantidade solicitada**\n${quantity}`
        )
      );
      const sent = await sendRequestLog(interaction, logContainer);
      if (interaction.channel?.isTextBased()) {
        const publicContainer = new ContainerBuilder();
        const publicSection = new SectionBuilder()
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              `## ${inlineEmoji(interaction.client, "package")}Reposição de estoque solicitada\n<@${interaction.user.id}> pediu reposição de **${field?.name || fieldId}** para **${product?.name || productId}**.`
            )
          )
          .setThumbnailAccessory(new ThumbnailBuilder().setURL(interaction.user.displayAvatarURL()));
        publicContainer.addSectionComponents(publicSection);
        publicContainer.addSeparatorComponents(new SeparatorBuilder());
        publicContainer.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`**${inlineEmoji(interaction.client, "hash")}Quantidade:** ${quantity}`)
        );
        await interaction.channel.send({ components: [publicContainer], flags: V2 }).catch(() => null);
      }
      await interaction.reply({
        content: sent
          ? `${inlineEmoji(interaction.client, "circle_check_big")}Solicitação de estoque enviada!`
          : `${inlineEmoji(interaction.client, "circle_check_big")}Solicitação registrada! (nenhum canal de log configurado — avise um administrador para configurar em \`/panel\`)`,
        flags: MessageFlags.Ephemeral
      });
      return true;
    }
  }
  return false;
}
async function routeStockField(interaction, productId, field) {
  const hasStock = Number(field.stock) > 0;
  if (!hasStock) {
    const notifyRow = new ActionRowBuilder().addComponents(
      withEmoji(
        new ButtonBuilder()
          .setCustomId(`notify_stock:${productId}:${field.id}`)
          .setLabel("Avisar quando tiver estoque")
          .setStyle(ButtonStyle.Secondary),
        interaction.client,
        "bell"
      )
    );
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## ${inlineEmoji(interaction.client, "package_x")}Sem estoque no momento\nO campo **${field.name}** está sem estoque agora. Deseja ser notificado quando for reabastecido?`
      )
    );
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addActionRowComponents(notifyRow);
    await interaction.update({ components: [container], flags: V2 });
    return;
  }
  await showStockModal(interaction, productId, field.id, field.name);
}
async function showStockModal(interaction, productId, fieldId, fieldName) {
  const quantityInput = new TextInputBuilder()
    .setCustomId("quantity")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(10);
  const quantityLabel = new LabelBuilder()
    .setLabel(`Quantidade de ${fieldName}`.slice(0, 45))
    .setDescription("Quantos itens você quer pedir de reposição")
    .setTextInputComponent(quantityInput);
  const modal = new ModalBuilder()
    .setCustomId(`stock_quantity_modal:${productId}:${fieldId}`)
    .setTitle("Solicitar estoque")
    .addLabelComponents(quantityLabel);
  await interaction.showModal(modal);
}
function buildNewProductModal() {
  const typeInput = new TextInputBuilder()
    .setCustomId("product_type")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(3)
    .setMaxLength(100);
  const valueInput = new TextInputBuilder()
    .setCustomId("product_value")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(50);
  const descriptionInput = new TextInputBuilder()
    .setCustomId("product_description")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(500);
  const exampleImageUpload = new FileUploadBuilder()
    .setCustomId("product_example_image")
    .setRequired(false)
    .setMaxValues(1);
  return new ModalBuilder()
    .setCustomId("product_request_modal")
    .setTitle("Solicitar novo produto")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Tipo do produto")
        .setDescription("Qual produto você quer que seja adicionado ao catálogo")
        .setTextInputComponent(typeInput),
      new LabelBuilder()
        .setLabel("Valor desejado")
        .setDescription("Opcional — uma faixa de preço já ajuda")
        .setTextInputComponent(valueInput),
      new LabelBuilder()
        .setLabel("Descrição / observações")
        .setDescription("Opcional — detalhes extras sobre o produto")
        .setTextInputComponent(descriptionInput),
      new LabelBuilder()
        .setLabel("Imagem de exemplo")
        .setDescription("Opcional — envie uma imagem de referência de como você quer o produto")
        .setFileUploadComponent(exampleImageUpload)
    );
}
function productRequestConfigPanel(client, guildId, userId) {
  const config = getGuildConfig(guildId);
  const logChannelId = config.channels.productRequestLogs;
  const panel = new ContainerBuilder();
  panel.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${inlineEmoji(client, "package")}Solicitar Produtos\nOwners usam \`/solicitar-produto\` para pedir um produto novo ou reposição de estoque. As solicitações são registradas no canal de log abaixo.`
    )
  );
  panel.addSeparatorComponents(new SeparatorBuilder());
  panel.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        `**${inlineEmoji(client, "clipboard")}Canal de log:** ${logChannelId ? `<#${logChannelId}>` : "não configurado"}`,
        "",
        "Para escolher o canal, vá em **Configurações → Canais → Solicitar Produtos - logs**."
      ].join("\n")
    )
  );
  panel.addSeparatorComponents(new SeparatorBuilder());
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
  handleProductRequestCommand,
  handleProductRequestInteraction,
  productRequestConfigPanel,
  readProductRequests,
  writeProductRequests
};
