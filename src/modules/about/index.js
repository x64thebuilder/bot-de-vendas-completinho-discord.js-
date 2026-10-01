const os = require("node:os");
const {
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  TextDisplayBuilder,
  version: DISCORD_JS_VERSION
} = require("discord.js");
const { BOT_VERSION } = require("../../config");
const { getBotIdentity } = require("../identity");
const { isBotOwner } = require("../perms");
const { inlineEmoji } = require("../panel");
const V2_EPHEMERAL = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
const COLOR = 0xffffff;
async function handleAboutCommand(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "sobre") return false;
  if (!interaction.inGuild()) {
    await interaction.reply({ content: "Use este comando dentro de um servidor.", flags: MessageFlags.Ephemeral });
    return true;
  }
  if (!isBotOwner(interaction)) {
    await interaction.reply({ content: "Somente o owner do bot pode usar /sobre.", flags: MessageFlags.Ephemeral });
    return true;
  }
  await interaction.reply(aboutPayload(interaction.client));
  return true;
}
function aboutPayload(client) {
  const identity = getBotIdentity();
  const uptimeMs = client.uptime || 0;
  const guildCount = client.guilds.cache.size;
  const memberCount = client.guilds.cache.reduce((total, guild) => total + (guild.memberCount || 0), 0);
  const ping = Math.round(client.ws.ping);
  const panel = new ContainerBuilder().setAccentColor(COLOR);
  panel.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${inlineEmoji(client, "dev")}Sobre o bot\nInformacoes gerais e identidade unica desta instancia do bot.`
    )
  );
  panel.addSeparatorComponents(new SeparatorBuilder());
  panel.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        `${inlineEmoji(client, "fields")}**ID unico do bot:** \`${identity.botId}\``,
        `${inlineEmoji(client, "user")}**Nome atual:** ${client.user.tag}`,
        `${inlineEmoji(client, "wand")}**Application ID:** \`${client.user.id}\``,
        `${inlineEmoji(client, "cloud")}**Versao:** \`${BOT_VERSION}\``
      ].join("\n")
    )
  );
  panel.addSeparatorComponents(new SeparatorBuilder());
  panel.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        `${inlineEmoji(client, "online")}**Uptime:** ${formatUptime(uptimeMs)}`,
        `${inlineEmoji(client, "clock")}**Ping:** \`${ping}ms\``,
        `${inlineEmoji(client, "users")}**Servidores:** \`${guildCount}\``,
        `${inlineEmoji(client, "user1p")}**Usuarios (aprox.):** \`${memberCount}\``
      ].join("\n")
    )
  );
  panel.addSeparatorComponents(new SeparatorBuilder());
  panel.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        `${inlineEmoji(client, "config2")}**Node.js:** \`${process.version}\``,
        `${inlineEmoji(client, "reload")}**discord.js:** \`v${DISCORD_JS_VERSION}\``,
        `${inlineEmoji(client, "db")}**Sistema:** \`${os.platform()} ${os.arch()}\``
      ].join("\n")
    )
  );
  panel.addSeparatorComponents(new SeparatorBuilder());
  panel.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        `${inlineEmoji(client, "datep")}**ID registrado em:** ${formatDate(identity.createdAt)}`,
        `${inlineEmoji(client, "reload")}**Ultima inicializacao:** ${formatDate(identity.lastBootAt)}`,
        `${inlineEmoji(client, "config2")}**Total de inicializacoes:** \`${identity.bootCount || 1}\``,
        `-# creator: x64thebuilder/.200021`
      ].join("\n")
    )
  );
  return { components: [panel], flags: V2_EPHEMERAL };
}
function formatUptime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(" ");
}
function formatDate(timestamp) {
  if (!timestamp) return "desconhecido";
  const unixSeconds = Math.floor(Number(timestamp) / 1000);
  return `<t:${unixSeconds}:F> (<t:${unixSeconds}:R>)`;
}
module.exports = {
  handleAboutCommand,
  aboutPayload
};
