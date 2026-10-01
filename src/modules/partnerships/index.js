const { MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require("discord.js");
const { ids } = require("../../config");
const store = require("./store");
const { partnershipMainPanel, partnershipChannelPicker, partnershipResponsePanel } = require("./panel");
const { scoped } = require("../panel");
const V2 = MessageFlags.IsComponentsV2;
function isInviteLink(content){
  if(!content) return false;
  const re = /(discord\.gg\/[a-zA-Z0-9]+|discord\.com\/invite\/[a-zA-Z0-9]+|discordapp\.com\/invite\/[a-zA-Z0-9]+|dsc\.gg\/[a-zA-Z0-9]+)/i;
  return re.test(content);
}
async function handlePartnershipPanelComponent(interaction, baseId){
  const client=interaction.client;
  const userId=interaction.user.id;
  const guildId=interaction.guildId;
  if(baseId===ids.partnershipEntry){
    await interaction.update({ components:[partnershipMainPanel(client, guildId, userId)], flags: V2 });
    return true;
  }
  if(baseId===ids.partnershipSelect){
    const val=interaction.values?.[0];
    const cfg=store.getConfig();
    if(val==="enable" && !cfg.enabled){
      store.setConfig(c=>({ ...c, enabled:true }));
    } else if(val==="disable" && cfg.enabled){
      store.setConfig(c=>({ ...c, enabled:false }));
    } else {
      store.setConfig(c=>({ ...c, enabled:!c.enabled }));
    }
    await interaction.update({ components:[partnershipMainPanel(client, guildId, userId)], flags: V2 });
    return true;
  }
  if(baseId===ids.partnershipConfigChannel){
    await interaction.update({ components:[partnershipChannelPicker(client, userId)], flags: V2 });
    return true;
  }
  if(baseId===ids.partnershipChannelSelect){
    const channelId=interaction.values?.[0];
    if(!channelId || !/^\d{15,25}$/.test(channelId)){
      await interaction.reply({ content:"Canal inválido.", flags: MessageFlags.Ephemeral }).catch(()=>null);
      return true;
    }
    const ch=await interaction.guild.channels.fetch(channelId).catch(()=>null);
    if(!ch?.isTextBased()){
      await interaction.reply({ content:"Selecione um canal de texto.", flags: MessageFlags.Ephemeral }).catch(()=>null);
      return true;
    }
    store.setConfig(c=>({ ...c, channelId }));
    await interaction.update({ components:[partnershipMainPanel(client, guildId, userId)], flags: V2 });
    return true;
  }
  if(baseId===ids.partnershipAddId){
    const modal=new ModalBuilder()
      .setCustomId(`${ids.partnershipChannelIdModal}:${userId}`)
      .setTitle("ID do Canal de Parcerias")
      .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("cid").setLabel("ID do canal").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("123456789012345678").setMaxLength(25)));
    await interaction.showModal(modal).catch(()=>null);
    return true;
  }
  return false;
}
async function handlePartnershipModal(interaction){
  const id=interaction.customId;
  const userId=interaction.user.id;
  const guildId=interaction.guildId;
  if(id.startsWith(ids.partnershipChannelIdModal)){
    const cid=interaction.fields.getTextInputValue("cid").trim();
    if(!/^\d{15,25}$/.test(cid)){
      await interaction.reply({ content:"ID inválido. Use 15-25 dígitos.", flags: MessageFlags.Ephemeral }).catch(()=>null);
      return true;
    }
    const ch=await interaction.guild.channels.fetch(cid).catch(()=>null);
    if(!ch?.isTextBased()){
      await interaction.reply({ content:"Canal não encontrado ou não é de texto.", flags: MessageFlags.Ephemeral }).catch(()=>null);
      return true;
    }
    store.setConfig(c=>({ ...c, channelId: cid }));
    await interaction.update({ components:[partnershipMainPanel(interaction.client, guildId, userId)], flags: V2 }).catch(()=>null);
    return true;
  }
  return false;
}
async function handlePartnershipMessage(message){
  if(!message.guild || message.author.bot) return false;
  const cfg=store.getConfig();
  if(!cfg.enabled || !cfg.channelId) return false;
  if(message.channel.id!==cfg.channelId) return false;
  if(!isInviteLink(message.content)) return false;
  const codes = store.extractInviteCodes(message.content);
  if(!codes.length) return false;
  const block = store.isLinkBlocked(codes);
  if(block.blocked){
    const { ContainerBuilder, SeparatorBuilder, TextDisplayBuilder, MessageFlags } = require("discord.js");
    const { inlineEmoji } = require("../panel");
    const remainingH = block.remainingHours || 1;
    const remainingStr = remainingH === 1 ? "1 hora" : `${remainingH} horas`;
    const container = new ContainerBuilder().setAccentColor(0xe74c3c);
    try{
      const { SectionBuilder, ThumbnailBuilder } = require("discord.js");
      const avatar = message.author.displayAvatarURL({extension:"png",size:64});
      const sec = new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`## ${inlineEmoji(message.client,"negativo")} Link repetido!`),
          new TextDisplayBuilder().setContent(`O convite \`${block.code}\` já foi enviado há menos de 24h.`)
        ).setThumbnailAccessory(new ThumbnailBuilder().setURL(avatar).setDescription("Bloqueado"));
      container.addSectionComponents(sec);
    }catch{
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(message.client,"negativo")} Link repetido!`));
    }
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `${inlineEmoji(message.client,"clock")} **Aguarde:** \`${remainingStr}\` para reenviar\n`+
      `${inlineEmoji(message.client,"desligado")} **Bloqueio:** 24h por link • Após 24h pode reenviar`
    ));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${inlineEmoji(message.client,"wand")} Dica: use um convite diferente ou aguarde.`));
    try{
      await message.reply({ components:[container], flags: MessageFlags.IsComponentsV2, allowedMentions:{ users:[message.author.id] } });
    }catch{
      try{ await message.channel.send({ components:[container], flags: MessageFlags.IsComponentsV2 }); }catch{}
    }
    return true;
  }
  store.recordLinks(codes);
  const stats = store.addPartnership(message.author.id);
  const userStats = store.getUserStats(message.author.id);
  const rankList = store.getRank(5);
  const panel = partnershipResponsePanel(message.client, message.guild.id, message.author.id, userStats, rankList);
  try{
    await message.reply({ components:[panel], flags: MessageFlags.IsComponentsV2, allowedMentions:{ users:[message.author.id] } });
  }catch(e){
    try{ await message.channel.send({ components:[panel], flags: MessageFlags.IsComponentsV2 }); }catch{}
  }
  return true;
}
module.exports={ handlePartnershipPanelComponent, handlePartnershipModal, handlePartnershipMessage, isInviteLink };
