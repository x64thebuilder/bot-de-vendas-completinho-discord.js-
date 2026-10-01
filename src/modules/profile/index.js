const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SectionBuilder, ThumbnailBuilder, MessageFlags } = require("discord.js");
const { getGuildConfig } = require("../../storage");
const { normalizeEmojiName } = require("../../emojis");
const { salesOrders, middlemanTrades, isPaidSale, formatBRL } = require("../stats");
function componentEmoji(client, name) {
  const normalized = normalizeEmojiName(name);
  const found = client.appEmojis?.get(normalized);
  if (!found) return undefined;
  return { id: found.id, name: found.name, animated: found.animated };
}
function inlineEmoji(client, name) {
  const c = componentEmoji(client, name);
  if (!c) return "";
  return `<${c.animated ? "a" : ""}:${c.name}:${c.id}> `;
}
const V2 = MessageFlags.IsComponentsV2;
async function resolveTargetUser(interaction) {
  const userOpt = interaction.options.getUser("usuario");
  const idOpt = interaction.options.getString("id");
  let targetId = null;
  if (userOpt) targetId = userOpt.id;
  else if (idOpt) {
    const cleaned = String(idOpt).replace(/\D/g, "");
    if (/^\d{15,25}$/.test(cleaned)) targetId = cleaned;
  }
  if (!targetId) {
    return { user: interaction.user, member: interaction.member, id: interaction.user.id };
  }
  let user = userOpt;
  if (!user) {
    try { user = await interaction.client.users.fetch(targetId); } catch { user = null; }
  }
  let member = null;
  try { member = await interaction.guild.members.fetch(targetId).catch(() => null); } catch {}
  if (!user) {
    user = { id: targetId, username: `ID ${targetId}`, displayAvatarURL: () => null, tag: `ID ${targetId}` };
  }
  return { user, member, id: targetId };
}
function buildProfilePanel(client, guildId, target, stats) {
  const cfg = getGuildConfig(guildId);
  const accent = cfg.customColor || 0xffffff;
  const panel = new ContainerBuilder().setAccentColor(accent);
  const createdAt = target.user.createdTimestamp ? Math.floor(target.user.createdTimestamp / 1000) : null;
  const joinedAt = target.member?.joinedTimestamp ? Math.floor(target.member.joinedTimestamp / 1000) : null;
  const avatar = target.user.displayAvatarURL ? target.user.displayAvatarURL({ extension: "png", size: 256 }) : null;
  const displayName = target.member?.displayName || target.user.globalName || target.user.username || target.id;
  try {
    const header = new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`## ${inlineEmoji(client, "user")}Perfil — ${displayName}`),
        new TextDisplayBuilder().setContent(
          `${inlineEmoji(client, "hash")} **ID:** \`${target.id}\`\n` +
          `${inlineEmoji(client, "user")} **Tag:** \`${target.user.username || target.user.tag || "—"}\` ${target.user.bot ? inlineEmoji(client, "verifiedp") + "`BOT`" : ""}\n` +
          `${inlineEmoji(client, "clock")} **Conta criada:** ${createdAt ? `<t:${createdAt}:F> (<t:${createdAt}:R>)` : "—"}\n` +
          `${inlineEmoji(client, "cargo")} **Entrou no servidor:** ${joinedAt ? `<t:${joinedAt}:F> (<t:${joinedAt}:R>)` : "—"}`
        )
      );
    if (avatar) header.setThumbnailAccessory(new ThumbnailBuilder().setURL(avatar).setDescription("Avatar"));
    panel.addSectionComponents(header);
  } catch {
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client, "user")}Perfil — ${displayName}\nID \`${target.id}\``));
  }
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  const roles = target.member ? [...target.member.roles.cache.values()]
    .filter(r => r.id !== guildId)
    .sort((a, b) => b.position - a.position)
    .slice(0, 8) : [];
  const rolesText = roles.length ? roles.map(r => `<@&${r.id}>`).join(" ") : "`sem cargos`";
  const isStaff = cfg.roles.admin && target.member?.roles.cache.has(cfg.roles.admin);
  const isSupport = cfg.tickets.roles.support && target.member?.roles.cache.has(cfg.tickets.roles.support);
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `### ${inlineEmoji(client, "cargo")} Cargos e Permissões\n` +
    `${rolesText}\n` +
    `${isStaff ? `${inlineEmoji(client, "ligado")} Admin do bot` : `${inlineEmoji(client, "desligado")} Não é admin`} ╺╸ ${isSupport ? `${inlineEmoji(client, "ligado")} Suporte` : `${inlineEmoji(client, "desligado")} Não é suporte`}`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  const sales = stats.sales;
  const totalSales = sales.reduce((a, b) => a + Number(b.total || 0), 0);
  const topProduct = sales.length ? sales.sort((a, b) => Number(b.total) - Number(a.total))[0] : null;
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${inlineEmoji(client, "bag")} Vendas`));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `${inlineEmoji(client, "cart")} **Pedidos:** \`${sales.length}\` ╺╸ ${inlineEmoji(client, "dollar")} **Total gasto:** **${formatBRL(totalSales)}**\n` +
    (sales.length ? `${inlineEmoji(client, "preview")} **Top compra:** \`${topProduct.id}\` **${topProduct.productName}** — ${formatBRL(topProduct.total)}\n` : "") +
    (sales.length ? sales.slice(0, 3).map(o => `• \`${o.id}\` ${o.productName} — ${formatBRL(o.total)} <t:${Math.floor((o.deliveredAt||o.approvedAt||o.createdAt)/1000)}:R>`).join("\n") : `-# Nenhuma compra entregue ainda.`)
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
  const trades = stats.trades;
  const doneTrades = trades.filter(t => t.status === "done");
  const asBuyer = doneTrades.filter(t => t.buyerId === target.id).length;
  const asSeller = doneTrades.filter(t => t.sellerId === target.id).length;
  const totalMm = doneTrades.filter(t => t.buyerId === target.id).reduce((a, b) => a + Number(b.total || b.amount || 0), 0);
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${inlineEmoji(client, "tradep")} Middleman`));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `${inlineEmoji(client, "users")} **Trades concluídos:** \`${doneTrades.length}\` ╺╸ **Como comprador:** \`${asBuyer}\` ╺╸ **Como vendedor:** \`${asSeller}\`\n` +
    `${inlineEmoji(client, "dollar")} **Total (comprador):** **${formatBRL(totalMm)}**\n` +
    (doneTrades.length ? doneTrades.slice(0, 3).map(t => `• \`${t.id}\` ${t.buyerId === target.id ? "comprou" : t.sellerId === target.id ? "vendeu" : "participou"} ${formatBRL(t.amount)} — <t:${Math.floor((t.finishedAt||t.createdAt)/1000)}:R>`).join("\n") : `-# Nenhum middleman concluído.`)
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${inlineEmoji(client, "clock")} Perfil gerado <t:${Math.floor(Date.now()/1000)}:R> • ${inlineEmoji(client, "casa")} ${client.guilds.cache.get(guildId)?.name || "Servidor"}`));
  return panel;
}
async function handleProfileCommand(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "perfil") return false;
  if (!interaction.inGuild()) {
    await interaction.reply({ content: "Use este comando dentro de um servidor.", flags: MessageFlags.Ephemeral }).catch(() => null);
    return true;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
  const target = await resolveTargetUser(interaction);
  const guildId = interaction.guildId;
  const allSales = salesOrders(guildId).filter(o => o.userId === target.id && isPaidSale(o)).sort((a, b) => Number(b.deliveredAt || b.approvedAt || b.createdAt || 0) - Number(a.deliveredAt || a.approvedAt || a.createdAt || 0));
  const allTrades = middlemanTrades(guildId).filter(t => [t.buyerId, t.sellerId, t.creatorId].includes(target.id)).sort((a, b) => Number(b.finishedAt || b.createdAt || 0) - Number(a.finishedAt || a.createdAt || 0));
  const panel = buildProfilePanel(interaction.client, guildId, target, { sales: allSales, trades: allTrades });
  await interaction.editReply({ components: [panel], flags: V2 }).catch(async () => {
    await interaction.followUp({ components: [panel], flags: V2, ephemeral: true }).catch(() => null);
  });
  return true;
}
module.exports = { handleProfileCommand, buildProfilePanel };
