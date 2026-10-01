const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  TextDisplayBuilder
} = require("discord.js");
const { BOT_VERSION } = require("../../config");
const { getGuildConfig } = require("../../storage");
const { checkAndUpdateVersion } = require("../identity");
const UPDATES_URL = "https://discord.com/channels/SEU_GUILD_ID/SEU_CANAL_UPDATES";
const BUGS_URL = "https://discord.com/channels/SEU_GUILD_ID/SEU_CANAL_BUGS";
const COLORS = {
  restart: 0xffffff,
  update: 0x2ecc71
};
const V2 = MessageFlags.IsComponentsV2;
const NO_PING = { parse: [] };
let _panelHelpers = null;
function panelHelpers() {
  if (!_panelHelpers) {
    _panelHelpers = require("../panel");
  }
  return _panelHelpers;
}
function inlineEmoji(client, name) {
  return panelHelpers().inlineEmoji(client, name);
}
function componentEmoji(client, name) {
  return panelHelpers().componentEmoji(client, name);
}
function withEmoji(builder, client, name) {
  const found = componentEmoji(client, name);
  return found ? builder.setEmoji(found) : builder;
}
function restartContainer(client) {
  const container = new ContainerBuilder().setAccentColor(COLORS.restart);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${inlineEmoji(client, "reload")}Bot Reiniciado`
    )
  );
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        `${inlineEmoji(client, "config2")}**Motivo:** Reinicializacao de seguranca`,
        `${inlineEmoji(client, "clock")}**Horario:** <t:${Math.floor(Date.now() / 1000)}:F>`,
        `${inlineEmoji(client, "cloud")}**Versao:** \`${BOT_VERSION}\``
      ].join("\n")
    )
  );
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `-# ${inlineEmoji(client, "online")}Todos os sistemas foram verificados e estao operando normalmente.`
    )
  );
  return container;
}
function updateContainer(client, previousVersion) {
  const container = new ContainerBuilder().setAccentColor(COLORS.update);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${inlineEmoji(client, "wand")}Nova Atualizacao Disponivel`
    )
  );
  container.addSeparatorComponents(new SeparatorBuilder());
  const versionLine = previousVersion
    ? `${inlineEmoji(client, "cloud")}**Versao:** \`${previousVersion}\` ➜ \`${BOT_VERSION}\``
    : `${inlineEmoji(client, "cloud")}**Versao atual:** \`${BOT_VERSION}\``;
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        `${inlineEmoji(client, "positivo")}O bot foi atualizado com sucesso!`,
        versionLine
      ].join("\n")
    )
  );
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `-# ${inlineEmoji(client, "streaming")}Confira as novidades ou reporte problemas usando os botoes abaixo.`
    )
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      withEmoji(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel("Ver atualizacoes")
          .setURL(UPDATES_URL),
        client,
        "recibo"
      ),
      withEmoji(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel("Reportar bugs")
          .setURL(BUGS_URL),
        client,
        "lupa"
      )
    )
  );
  return container;
}
async function announceSystemBoot(client) {
  const { changed, previousVersion } = checkAndUpdateVersion(BOT_VERSION);
  const guild = client.guilds.cache.first();
  if (!guild) return;
  let config;
  try {
    config = getGuildConfig(null);
  } catch {
    return;
  }
  const channelId = config?.channels?.systemLogs;
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  try {
    await channel.send({
      components: [restartContainer(client)],
      flags: V2,
      allowedMentions: NO_PING
    });
  } catch (error) {
    console.warn(`[Sistema] Falha ao enviar aviso de reinicializacao:`, error.message);
  }
  if (!changed) return;
  try {
    await channel.send({
      components: [updateContainer(client, previousVersion)],
      flags: V2,
      allowedMentions: NO_PING
    });
  } catch (error) {
    console.warn(`[Sistema] Falha ao enviar anuncio de atualizacao:`, error.message);
  }
}
module.exports = {
  announceSystemBoot,
  restartContainer,
  updateContainer
};
