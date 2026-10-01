const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, ContainerBuilder, MessageFlags, SeparatorBuilder, StringSelectMenuBuilder, TextDisplayBuilder, ThumbnailBuilder, SectionBuilder } = require("discord.js");
const { ids } = require("../../config");
const store = require("./store");
const { componentEmoji, scoped, inlineEmoji } = require("../panel");
const V2 = MessageFlags.IsComponentsV2;
const PART_ACCENT = 0x00d1ff;
function withEmoji(b, client, name){ const e=client.appEmojis?.get(require("../../emojis").normalizeEmojiName(name)); return e? b.setEmoji({id:e.id,name:e.name,animated:e.animated}):b; }
function partnershipMainPanel(client, guildId, userId){
  const cfg = store.getConfig();
  const enabled = !!cfg.enabled;
  const channelId = cfg.channelId;
  const panel = new ContainerBuilder().setAccentColor(enabled ? PART_ACCENT : 0x2b2d31);
  const botAvatar = client.user?.displayAvatarURL({extension:"png",size:64})||null;
  try{
    const hdr=new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`## ${inlineEmoji(client,"users")} Parcerias`),
        new TextDisplayBuilder().setContent(`-# Contagem automática de convites • Ranking\n-# creator: x64thebuilder/.200021`)
      );
    if(botAvatar) hdr.setThumbnailAccessory(new ThumbnailBuilder().setURL(botAvatar).setDescription("Parcerias"));
    panel.addSectionComponents(hdr);
  }catch{
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client,"users")} Parcerias`));
  }
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `${enabled ? `${inlineEmoji(client,"ligado")} \`Ativo\`` : `${inlineEmoji(client,"desligado")} \`Inativo\``} • ${channelId ? `${inlineEmoji(client,"canal")} <#${channelId}>` : `${inlineEmoji(client,"negativo")} \`sem canal\``}`
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(scoped(ids.partnershipSelect, userId))
      .setPlaceholder(enabled ? "Ativo — desativar?" : "Inativo — ativar?")
      .addOptions({
        label: enabled ? "Desativar Parcerias" : "Ativar Parcerias",
        value: enabled ? "disable" : "enable",
        description: enabled ? "Pausar contagem" : "Liberar contagem",
        emoji: componentEmoji(client, enabled ? "desligado" : "ligado")
      })
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    withEmoji(new ButtonBuilder().setCustomId(scoped(ids.partnershipConfigChannel, userId)).setLabel(channelId ? "Canal" : "Definir Canal").setStyle(channelId?ButtonStyle.Primary:ButtonStyle.Success), client, "canal"),
    withEmoji(new ButtonBuilder().setCustomId(scoped("panel:back:main", userId)).setLabel("Voltar").setStyle(ButtonStyle.Secondary), client, "reload")
  ));
  return panel;
}
function partnershipChannelPicker(client, userId){
  const cfg=store.getConfig();
  const panel=new ContainerBuilder().setAccentColor(PART_ACCENT);
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client,"canal")} Canal — Parcerias`));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `${cfg.channelId ? `${inlineEmoji(client,"ligado")} <#${cfg.channelId}>` : `${inlineEmoji(client,"desligado")} Nenhum`}\n`+
    `-# Selecione onde \`discord.gg\` conta ponto`
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder().setCustomId(scoped(ids.partnershipChannelSelect, userId)).setPlaceholder("Selecione canal").setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(1).setMaxValues(1)
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    withEmoji(new ButtonBuilder().setCustomId(scoped(ids.partnershipAddId, userId)).setLabel("ID").setStyle(ButtonStyle.Secondary), client, "mais2"),
    withEmoji(new ButtonBuilder().setCustomId(scoped(ids.partnershipEntry, userId)).setLabel("Voltar").setStyle(ButtonStyle.Secondary), client, "reload")
  ));
  return panel;
}
function partnershipResponsePanel(client, guildId, userId, stats, rankList){
  const user = client.users.cache.get(userId);
  const avatar = user?.displayAvatarURL({extension:"png",size:64}) || client.user.displayAvatarURL({extension:"png",size:64});
  const container = new ContainerBuilder().setAccentColor(PART_ACCENT);
  try{
    const hdr=new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`## ${inlineEmoji(client,"users")} Parceria +1!`),
        new TextDisplayBuilder().setContent(`<@${userId}> • Total \`${stats.total}\` • #${stats.rank||"-"}`)
      ).setThumbnailAccessory(new ThumbnailBuilder().setURL(avatar).setDescription("Parceria"));
    container.addSectionComponents(hdr);
  }catch{
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client,"users")} Parceria +1! <@${userId}>`));
  }
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `${inlineEmoji(client,"rendimentos")} \`${stats.total}\` total • ${inlineEmoji(client,"clock")} \`${stats.daily}\` hoje • \`${stats.weekly}\` semana`
  ));
  if(rankList?.length){
    const top = rankList.slice(0,3).map((r,i)=>{
      const m = i===0?"🥇":i===1?"🥈":i===2?"🥉":`#${i+1}`;
      const you = r.userId===userId ? " ← você" : "";
      return `${m} <@${r.userId}> \`${r.total}\`${you}`;
    }).join(" • ");
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Top:** ${top}`));
  }
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${inlineEmoji(client,"wand")} Continue em <#${store.getConfig().channelId}>`));
  return container;
}
module.exports={ partnershipMainPanel, partnershipChannelPicker, partnershipResponsePanel, payload: (c)=>({components:[c], flags:V2}) };
