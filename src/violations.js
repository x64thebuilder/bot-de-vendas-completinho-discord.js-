const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const { getGuildConfig, setGuildConfig } = require("./storage");
const { sendModLog } = require("./modLog");
const OWNER_DM_ID = process.env.OWNER_ID || null;
const DANGER_COLOR = 0xe74c3c;
const WARN_COLOR = 0xf1c40f;
const OK_COLOR = 0x2ecc71;
const VIOLATION_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;
function isExpired(violation) {
  return Date.now() - violation.at > VIOLATION_EXPIRY_MS;
}
function getViolations(guildId) {
  const all = getGuildConfig(guildId).moderation.violations;
  const active = all.filter((v) => !isExpired(v));
  if (active.length !== all.length) {
    setGuildConfig(guildId, (config) => {
      config.moderation.violations = config.moderation.violations.filter((v) => !isExpired(v));
      return config;
    });
  }
  return active;
}
function getStrikeCount(guildId) {
  return getViolations(guildId).length;
}
function getRestrictionLevel(guildId) {
  const count = getStrikeCount(guildId);
  if (count >= 2) return 2;
  if (count >= 1) return 1;
  return 0;
}
function violationsListText(violations) {
  return violations
    .map((v, i) => `**${i + 1}.** ${v.rule}\n> ${v.description || "Sem detalhes adicionais."}\n> <t:${Math.floor(v.at / 1000)}:f>`)
    .join("\n\n");
}
async function guildLabel(client, guildId) {
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  return { guild, name: guild?.name || "Desconhecido" };
}
const DUPLICATE_WINDOW_MS = 5 * 60 * 1000;
async function reportViolation(client, guildId, { rule, description, reportedBy, severity = "normal" } = {}) {
  if (severity === "critical") {
    return reportCriticalViolation(client, guildId, { rule, description, reportedBy });
  }
  getViolations(guildId);
  let count = 0;
  let duplicate = false;
  setGuildConfig(guildId, (config) => {
    const violations = config.moderation.violations;
    const last = violations[violations.length - 1];
    const isDuplicate = last
      && last.rule === (rule || "Regra nao especificada")
      && last.reportedBy === (reportedBy || null)
      && Date.now() - last.at <= DUPLICATE_WINDOW_MS;
    if (isDuplicate) {
      duplicate = true;
      last.description = description || last.description;
      last.at = Date.now();
      last.repeatCount = (last.repeatCount || 1) + 1;
    } else {
      violations.push({
        rule: rule || "Regra nao especificada",
        description: description || "",
        reportedBy: reportedBy || null,
        severity,
        at: Date.now()
      });
      config.moderation.restorationRequested = false;
    }
    count = violations.length;
    return config;
  });
  if (duplicate) {
    return count;
  }
  const { name: guildName } = await guildLabel(client, guildId);
  await sendModLog(client, new EmbedBuilder()
    .setTitle(`⚠️ Violacao registrada (${count}/3)`)
    .setColor(WARN_COLOR)
    .setDescription(
      `**Servidor:** ${guildName} (\`${guildId}\`)\n` +
      `**Regra:** ${rule || "Nao especificada"}\n` +
      `**Detalhes:** ${description || "Sem detalhes adicionais."}\n` +
      `${reportedBy ? `**Usuario:** <@${reportedBy}>` : ""}`
    )
    .setTimestamp()
  ).catch(() => null);
  if (count === 3) {
    await notifyOwnerThirdStrike(client, guildId).catch((error) => {
      console.warn("[Violacoes] Falha ao avisar o dono do bot:", error.message);
    });
  }
  return count;
}
async function reportCriticalViolation(client, guildId, { rule, description, reportedBy }) {
  const { banGuildAndOwner } = require("./modules/blacklist");
  const reason = `[BAN AUTOMATICO - VIOLACAO CRITICA] ${rule || "Conteudo proibido grave"}: ${description || ""}`;
  const result = await banGuildAndOwner(client, guildId, reason, reportedBy || "sistema");
  const embed = new EmbedBuilder()
    .setTitle("🚨 Ban automatico por violacao critica")
    .setColor(DANGER_COLOR)
    .setDescription(
      `**Servidor:** ${result.guildName || "Desconhecido"} (\`${guildId}\`)\n` +
      `**Motivo:** ${rule || "Conteudo proibido grave"}\n` +
      `**Detalhes:** ${description || "Sem detalhes adicionais."}\n` +
      `${reportedBy ? `**Detectado por acao de:** <@${reportedBy}>` : ""}\n\n` +
      `${result.ownerId ? `Dono do servidor <@${result.ownerId}> tambem banido. ` : "Nao foi possivel identificar o dono. "}` +
      `Aviso no PV do dono: ${result.dmSent ? "enviado" : "nao foi possivel enviar"}.`
    )
    .setFooter({ text: "Este servidor pulou o sistema de strikes por violacao critica (conteudo infantil)." })
    .setTimestamp();
  const owner = await client.users.fetch(OWNER_DM_ID).catch(() => null);
  if (owner) await owner.send({ embeds: [embed] }).catch(() => null);
  await sendModLog(client, embed).catch(() => null);
  return { banned: true, critical: true, ...result };
}
async function notifyOwnerThirdStrike(client, guildId) {
  const owner = await client.users.fetch(OWNER_DM_ID).catch(() => null);
  if (!owner) return;
  const { guild, name: guildName } = await guildLabel(client, guildId);
  const violations = getViolations(guildId);
  const embed = new EmbedBuilder()
    .setTitle("⚠️ Servidor atingiu 3 violacoes de regras")
    .setColor(DANGER_COLOR)
    .setDescription(
      `**Servidor:** ${guildName} (\`${guildId}\`)\n` +
      `**Dono do servidor:** ${guild?.ownerId ? `<@${guild.ownerId}>` : "Desconhecido"}\n\n` +
      violationsListText(violations)
    )
    .setFooter({ text: "Decisao enviada por PV para o dono do bot." })
    .setTimestamp();
  await sendModLog(client, embed).catch(() => null);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`violation:ban:${guildId}`).setLabel("Banir").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`violation:dismiss:${guildId}`).setLabel("Nao banir").setStyle(ButtonStyle.Secondary)
  );
  await owner.send({ embeds: [embed], components: [row] });
}
async function requestRestoration(client, guildId, requesterId) {
  const config = getGuildConfig(guildId);
  if (!config.moderation.violations.length) return { ok: false, reason: "no_violations" };
  if (config.moderation.restorationUsed) return { ok: false, reason: "already_used" };
  if (config.moderation.restorationRequested) return { ok: false, reason: "already_requested" };
  setGuildConfig(guildId, (current) => {
    current.moderation.restorationRequested = true;
    current.moderation.restorationUsed = true;
    return current;
  });
  const { name: guildName } = await guildLabel(client, guildId);
  const embed = new EmbedBuilder()
    .setTitle("🔄 Pedido de restauracao")
    .setColor(WARN_COLOR)
    .setDescription(
      `O dono do servidor **${guildName}** (\`${guildId}\`) pediu para remover ` +
      `as punicoes do bot naquele servidor.\n\n` +
      `**Solicitado por:** <@${requesterId}>\n\n` +
      violationsListText(config.moderation.violations)
    )
    .setTimestamp();
  await sendModLog(client, embed).catch(() => null);
  const owner = await client.users.fetch(OWNER_DM_ID).catch(() => null);
  if (!owner) return { ok: true, dmSent: false };
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`restore:accept:${guildId}`).setLabel("Aceitar restauracao").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`restore:reject:${guildId}`).setLabel("Recusar").setStyle(ButtonStyle.Danger)
  );
  const dmSent = await owner.send({ embeds: [embed], components: [row] }).then(() => true).catch(() => false);
  return { ok: true, dmSent };
}
function clearViolations(guildId) {
  setGuildConfig(guildId, (config) => {
    config.moderation.violations = [];
    config.moderation.restorationRequested = false;
    return config;
  });
}
function rejectRestoration(guildId) {
  setGuildConfig(guildId, (config) => {
    config.moderation.restorationRequested = false;
    return config;
  });
}
async function handleViolationButton(interaction) {
  if (!interaction.isButton()) return false;
  const [prefix, action, guildId] = interaction.customId.split(":");
  if (prefix !== "violation" && prefix !== "restore") return false;
  if (interaction.user.id !== OWNER_DM_ID) {
    await interaction.reply({ content: "Apenas o dono do bot pode responder isso.", flags: MessageFlags.Ephemeral });
    return true;
  }
  if (prefix === "violation") {
    if (action === "ban") {
      const { banGuildAndOwner } = require("./modules/blacklist");
      const { guildName, ownerId, dmSent } = await banGuildAndOwner(
        interaction.client,
        guildId,
        "Acumulou 3 violacoes das regras do bot.",
        interaction.user.id
      );
      const embed = new EmbedBuilder()
        .setTitle("🚫 Servidor banido")
        .setColor(DANGER_COLOR)
        .setDescription(
          `**${guildName || "Servidor"}** (\`${guildId}\`) foi banido.\n` +
          `${ownerId ? `Dono <@${ownerId}> tambem banido. ` : ""}` +
          `Aviso no PV do dono: ${dmSent ? "enviado" : "nao foi possivel enviar"}.`
        );
      await interaction.update({ embeds: [embed], components: [] });
      await sendModLog(interaction.client, embed).catch(() => null);
      return true;
    }
    if (action === "dismiss") {
      const embed = new EmbedBuilder()
        .setTitle("Servidor mantido")
        .setColor(OK_COLOR)
        .setDescription(`**${guildId}** nao foi banido. Ele continua com as restricoes atuais ate que voce aceite um pedido de restauracao pelo /panel do servidor.`);
      await interaction.update({ embeds: [embed], components: [] });
      await sendModLog(interaction.client, embed).catch(() => null);
      return true;
    }
  }
  if (prefix === "restore") {
    if (action === "accept") {
      clearViolations(guildId);
      const embed = new EmbedBuilder()
        .setTitle("✅ Restauracao aceita")
        .setColor(OK_COLOR)
        .setDescription(`As punicoes do servidor \`${guildId}\` foram removidas. O bot voltou ao normal la.`);
      await interaction.update({ embeds: [embed], components: [] });
      await sendModLog(interaction.client, embed).catch(() => null);
      return true;
    }
    if (action === "reject") {
      rejectRestoration(guildId);
      const embed = new EmbedBuilder()
        .setTitle("Restauracao recusada")
        .setColor(DANGER_COLOR)
        .setDescription(`O pedido de restauracao do servidor \`${guildId}\` foi recusado. As restricoes continuam.`);
      await interaction.update({ embeds: [embed], components: [] });
      await sendModLog(interaction.client, embed).catch(() => null);
      return true;
    }
  }
  return false;
}
module.exports = {
  OWNER_DM_ID,
  VIOLATION_EXPIRY_MS,
  getViolations,
  getStrikeCount,
  getRestrictionLevel,
  reportViolation,
  requestRestoration,
  clearViolations,
  rejectRestoration,
  handleViolationButton
};
