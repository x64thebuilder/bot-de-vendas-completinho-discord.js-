const { EmbedBuilder, MessageFlags, PermissionFlagsBits } = require("discord.js");
const { getGuildConfig } = require("../../storage");
const { readGuildFile } = require("../../guildDb");
const { hasBotPermission } = require("../perms");
const COLOR = 0xffffff;
const OK_COLOR = 0x2ecc71;
const WARN_COLOR = 0xf1c40f;
async function handleStatsCommand(interaction) {
  if (!interaction.isChatInputCommand()) return false;
  if (interaction.commandName === "vercompras") {
    await showPurchases(interaction);
    return true;
  }
  if (interaction.commandName === "rank") {
    await showSpendingRank(interaction);
    return true;
  }
  return false;
}
async function showPurchases(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: "Use este comando dentro de um servidor.", flags: MessageFlags.Ephemeral });
    return;
  }
  const sales = salesOrders(interaction.guildId)
    .filter((order) => order.userId === interaction.user.id && isPaidSale(order))
    .sort((a, b) => Number(b.deliveredAt || b.approvedAt || b.createdAt || 0) - Number(a.deliveredAt || a.approvedAt || a.createdAt || 0));
  const trades = middlemanTrades(interaction.guildId)
    .filter((trade) => trade.status === "done" && [trade.buyerId, trade.sellerId, trade.creatorId].includes(interaction.user.id))
    .sort((a, b) => Number(b.finishedAt || b.createdAt || 0) - Number(a.finishedAt || a.createdAt || 0));
  const totalSales = sum(sales, (order) => order.total);
  const totalMiddlemanBuyer = sum(trades.filter((trade) => trade.buyerId === interaction.user.id), (trade) => trade.total || trade.amount);
  const lastSales = sales.slice(0, 5).map((order) => `\`${order.id}\` **${order.productName}** - ${formatBRL(order.total)} - ${statusLabel(order.status)}`);
  const lastTrades = trades.slice(0, 5).map((trade) => `\`${trade.id}\` ${roleInTrade(trade, interaction.user.id)} - ${formatBRL(trade.amount)} - ${trade.mode === "automatic" ? "Automatico" : "Manual"}`);
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setAuthor({ name: interaction.user.username, iconURL: interaction.user.displayAvatarURL() })
    .setTitle("🛍️ Histórico de compras e middlemans")
    .setDescription("Resumo dos registros concluídos encontrados para você neste servidor.")
    .addFields(
      { name: "🛒 Sales", value: `Pedidos: **${sales.length}**\nTotal gasto: **${formatBRL(totalSales)}**`, inline: true },
      { name: "🤝 Middleman", value: `Trades: **${trades.length}**\nComo comprador: **${formatBRL(totalMiddlemanBuyer)}**`, inline: true },
      { name: "📦 Últimas compras", value: lastSales.length ? lastSales.join("\n") : "Nenhuma venda concluída encontrada.", inline: false },
      { name: "🔄 Últimos middlemans", value: lastTrades.length ? lastTrades.join("\n") : "Nenhum middleman concluído encontrado.", inline: false }
    )
    .setFooter({ text: "🌨️ Sync", iconURL: interaction.client.user.displayAvatarURL() })
    .setTimestamp();
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
async function showSpendingRank(interaction) {
  if (!canUseAdminCommand(interaction)) {
    await interaction.reply({ content: "Somente administradores ou usuarios com /perms podem usar este comando.", flags: MessageFlags.Ephemeral });
    return;
  }
  const filter = interaction.options.getString("filtro") || "all";
  const rows = spendingRows(interaction.guildId, filter)
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);
  const MEDALS = ["🥇", "🥈", "🥉"];
  const description = rows.length
    ? rows.map((row, index) => `**${MEDALS[index] || `${index + 1}.`}** <@${row.userId}> — **${formatBRL(row.total)}**\n💰 Sales: ${formatBRL(row.sales)} | 🤝 Middleman: ${formatBRL(row.middleman)} | 📄 Registros: \`${row.count}\``).join("\n\n")
    : "Ainda não existem registros concluídos para este filtro.";
  const embed = new EmbedBuilder()
    .setColor(OK_COLOR)
    .setTitle("🏆 Rank de gastos")
    .setDescription(description)
    .addFields({ name: "🔍 Filtro", value: filterLabel(filter), inline: true })
    .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL() || undefined })
    .setTimestamp();
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
function spendingRows(guildId, filter) {
  const users = new Map();
  const touch = (userId) => {
    if (!users.has(userId)) users.set(userId, { userId, sales: 0, middleman: 0, total: 0, count: 0 });
    return users.get(userId);
  };
  if (filter === "all" || filter === "sales") {
    for (const order of salesOrders(guildId).filter(isPaidSale)) {
      const row = touch(order.userId);
      row.sales += Number(order.total || 0);
      row.total += Number(order.total || 0);
      row.count += 1;
    }
  }
  if (filter === "all" || filter === "middleman") {
    for (const trade of middlemanTrades(guildId).filter((item) => item.status === "done" && item.buyerId)) {
      const value = Number(trade.total || trade.amount || 0);
      const row = touch(trade.buyerId);
      row.middleman += value;
      row.total += value;
      row.count += 1;
    }
  }
  return [...users.values()].filter((row) => row.total > 0);
}
function salesOrders(guildId) {
  const data = readGuildFile(guildId, "sales", () => ({ orders: {} }));
  return Object.values(data.orders || {});
}
function middlemanTrades(guildId) {
  const data = readGuildFile(guildId, "middleman-trades", () => ({}));
  return Object.values(data || {});
}
function isPaidSale(order) {
  return ["delivered", "manual_delivery"].includes(order.status) || Boolean(order.deliveredAt || order.approvedAt);
}
function roleInTrade(trade, userId) {
  if (trade.buyerId === userId) return "Comprador";
  if (trade.sellerId === userId) return "Vendedor";
  return "Participante";
}
function statusLabel(status) {
  const names = {
    delivered: "Entregue",
    manual_delivery: "Entrega manual",
    payment: "Pagamento",
    cancelled: "Cancelado"
  };
  return names[status] || status || "Registrado";
}
function filterLabel(filter) {
  return { all: "Sales + Middleman", sales: "Somente Sales", middleman: "Somente Middleman" }[filter] || "Sales + Middleman";
}
function canUseAdminCommand(interaction) {
  if (!interaction.inGuild()) return false;
  if (hasBotPermission(interaction)) return true;
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  const config = getGuildConfig(interaction.guildId);
  return Boolean(config.roles.admin && interaction.member?.roles?.cache?.has(config.roles.admin));
}
function sum(items, picker) {
  return items.reduce((total, item) => total + Number(picker(item) || 0), 0);
}
function formatBRL(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));
}
module.exports = {
  handleStatsCommand,
  canUseAdminCommand,
  salesOrders,
  middlemanTrades,
  isPaidSale,
  formatBRL
};
