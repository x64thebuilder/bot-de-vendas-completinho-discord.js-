const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, ContainerBuilder, EmbedBuilder, MessageFlags, ModalBuilder, SeparatorBuilder, StringSelectMenuBuilder, TextDisplayBuilder, TextInputBuilder, TextInputStyle, ThumbnailBuilder, SectionBuilder, MediaGalleryBuilder
} = require("discord.js");
const QRCode = require("qrcode");
const { ids } = require("../../config");
const { getGuildConfig } = require("../../storage");
const saldoStore = require("./store");
const { componentEmoji, scoped, inlineEmoji } = require("../panel");
const { hasBotPermission } = require("../perms");
const { botOwnerIds } = require("../../botOwners");
const V2 = MessageFlags.IsComponentsV2;
const V2_EPH = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
function withEmoji(builder, client, name) {
  const e = componentEmoji(client, name);
  return e ? builder.setEmoji(e) : builder;
}
function payload(c){ return { components:[c], flags:V2 }; }
function ephemeral(c){ return { components:[c], flags:V2_EPH }; }
function bar(percent, len=10){
  const filled = Math.max(0, Math.min(len, Math.round((percent/100)*len)));
  return "█".repeat(filled) + "░".repeat(len-filled);
}
function code(v){ return `\`${v}\``; }
function saldoConfigPanel(client, guildId, userId){
  const cfg = saldoStore.getConfig();
  const enabled = cfg.enabled;
  const bonus = cfg.bonusPercent;
  const st = saldoStore.readStore();
  const totalUsers = Object.keys(st.balances||{}).length;
  const totalCirculante = Object.values(st.balances||{}).reduce((a,b)=>a+Number(b||0),0);
  const accent = enabled ? 0x00ff88 : 0x2b2d31;
  const panel = new ContainerBuilder().setAccentColor(accent);
  try{
    const guild = client.guilds.cache.get(guildId);
    const icon = guild?.iconURL({extension:"png",size:128}) || client.user?.displayAvatarURL({extension:"png",size:64});
    const header = new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`## ${inlineEmoji(client,"carteira")} Carteira da Loja — Sistema de Saldo`),
        new TextDisplayBuilder().setContent(`Transforme saldo em **conversão**. Cliente recarrega via PIX, ganha **bônus** e paga **1 clique** no carrinho.`),
        new TextDisplayBuilder().setContent(`-# ${inlineEmoji(client,"sparkles")} Ative e veja **Saldo** aparecer como forma de pagamento no carrinho.`)
      );
    if(icon) header.setThumbnailAccessory(new ThumbnailBuilder().setURL(icon).setDescription("Saldo"));
    panel.addSectionComponents(header);
  }catch{
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client,"carteira")} Carteira da Loja — Sistema de Saldo`));
  }
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
  const statusBadge = enabled ? `${inlineEmoji(client,"ligado")} **Ativo** • visível no checkout` : `${inlineEmoji(client,"desligado")} **Desativado** • oculto no checkout`;
  const bonusPreview = bonus>0 ? `Ex: \`R$ 100,00\` → \`${saldoStore.formatBRL(100*(1+bonus/100))}\` (+${bonus}%)  [${bar(bonus,12)}] ${bonus}%` : `Sem bônus • Ative em **Extras → Bônus**`;
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `${statusBadge}\n`+
    `${inlineEmoji(client,"gift")} **Bônus:** \`${bonus}%\` • ${bonusPreview}\n`+
    `${inlineEmoji(client,"users")} **Clientes:** \`${totalUsers}\` • ${inlineEmoji(client,"pricep")} **Circulante:** \`${saldoStore.formatBRL(totalCirculante)}\``
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${inlineEmoji(client,"config2")} Ativação`));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Escolha abaixo para **ativar/desativar** instantaneamente. Sem reiniciar.`));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(scoped(ids.saldoToggle, userId))
      .setPlaceholder(enabled ? "🟢 Saldo ativo — clique para desativar" : "⚪ Saldo desativado — clique para ativar")
      .addOptions({ label: enabled ? "Desativar Saldo" : "Ativar Saldo", value: enabled ? "disable" : "enable", description: enabled ? "Remove Saldo do checkout" : "Adiciona Saldo ao checkout", emoji: componentEmoji(client, enabled ? "desligado":"ligado") })
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    withEmoji(new ButtonBuilder().setCustomId(scoped(ids.saldoManage, userId)).setLabel("Gerenciar Saldo").setStyle(ButtonStyle.Secondary).setDisabled(true), client, "users"),
    withEmoji(new ButtonBuilder().setCustomId(scoped(ids.saldoExtras, userId)).setLabel("Extras").setStyle(ButtonStyle.Primary), client, "gift"),
    withEmoji(new ButtonBuilder().setCustomId(scoped(ids.panelSales, userId)).setLabel("Voltar").setStyle(ButtonStyle.Secondary), client, "reload")
  ));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${inlineEmoji(client,"lightbulb")} **Extras → Bônus** define cashback. **Gerenciar** (próxima versão) listará ranking de saldos.`));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# creator: x64thebuilder/.200021`));
  return panel;
}
function saldoExtrasPanel(client, userId){
  const bonus = saldoStore.getBonusPercent();
  const tiers = saldoStore.getBonusTiers();
  const cfg = saldoStore.getConfig();
  const cashback = cfg.cashbackPercent||0;
  const referral = cfg.referralBonus||0;
  const panel = new ContainerBuilder().setAccentColor(0xffd700);
  try{
    const sec = new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`## ${inlineEmoji(client,"gift")} Extras — Pacotes, Cashback & Indicação`),
        new TextDisplayBuilder().setContent(`Bônus **não é padrão**: só ganha quem atinge **pacote**. Configure escalonado + cashback.`),
        new TextDisplayBuilder().setContent(`-# Pacotes: \`${tiers.length}\` • Cashback: \`${cashback}%\` • Indicação: \`${referral}%\``)
      );
    panel.addSectionComponents(sec);
  }catch{
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client,"gift")} Extras — Pacotes & Mais`));
  }
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
  const example100 = (100*(1+(saldoStore.getBonusForAmount(100)/100))).toFixed(2).replace(".",",");
  const example50 = (50*(1+(saldoStore.getBonusForAmount(50)/100))).toFixed(2).replace(".",",");
  let tierLines = tiers.length ? tiers.map(t=> `${inlineEmoji(client,"pricep")} \`R$ ${t.amount.toFixed(2).replace(".",",")}\`+ → **+${t.percent}%** [${bar(t.percent,8)}]`).join("\n") : `${inlineEmoji(client,"desligado")} Nenhum pacote — **nenhum bônus** (bônus base ${code(bonus+"%")} desconsiderado)`;
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `${inlineEmoji(client,"pricep")} **Bônus base (legado):** \`${bonus}%\` [${bar(bonus,12)}] -# só usado se **nenhum pacote**\n`+
    `${inlineEmoji(client,"carteira")} Ex: \`R$ 50,00\` → \`R$ ${example50}\` • \`R$ 100,00\` → \`R$ ${example100}\` (tier)\n`+
    `**Pacotes turbinados (bônus NÃO padrão):**\n${tierLines}\n`+
    `${inlineEmoji(client,"rendimentos")} **Cashback:** \`${cashback}%\` por compra • ${inlineEmoji(client,"users")} **Indicação:** \`${referral}%\` para quem indica`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(scoped(ids.saldoExtrasSelect, userId))
      .setPlaceholder("Selecione o que configurar")
      .addOptions(
        { label:"Bônus Base (legado)", value:"bonus", description:`Atual ${bonus}% (ignorado com pacotes)`, emoji: componentEmoji(client,"gift") },
        { label:"Adicionar Pacote", value:"tier_add", description:"Ex: R$100 → +25%", emoji: componentEmoji(client,"mais2") },
        ...(tiers.length? [{ label:"Remover Pacote", value:"tier_remove", description:`${tiers.length} pacotes`, emoji: componentEmoji(client,"apagar") }]: []),
        { label:"Cashback por Compra", value:"cashback", description:`Atual ${cashback}%`, emoji: componentEmoji(client,"rendimentos") },
        { label:"Bônus Indicação", value:"referral", description:`Atual ${referral}%`, emoji: componentEmoji(client,"users") }
      )
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    withEmoji(new ButtonBuilder().setCustomId(scoped(ids.saldoEntry, userId)).setLabel("Voltar").setStyle(ButtonStyle.Secondary), client, "reload")
  ));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# **Bônus turbinado NÃO é padrão**: só quem recarregar **acima do pacote** ganha. Cashback volta após cada compra.`));
  return panel;
}
function bonusModal(userId, current){
  return new ModalBuilder()
    .setCustomId(`${ids.saldoBonusModal}:${userId}`)
    .setTitle("🎁 Bônus de Saldo")
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("bonus").setLabel("Taxa de bônus % (0 a 100)").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("Ex: 20 = R$100 vira R$120").setValue(String(current||0)).setMaxLength(3)
    ));
}
function tierModal(userId){
  return new ModalBuilder()
    .setCustomId(`${ids.saldoTierModal}:${userId}`)
    .setTitle("📦 Novo Pacote Turbinado")
    .addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("amount").setLabel("Valor mínimo R$ (ex: 100)").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("100,00").setMaxLength(8)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("percent").setLabel("Bônus % (ex: 25)").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("25").setMaxLength(3))
    );
}
function transferModal(userId){
  return new ModalBuilder()
    .setCustomId(`${ids.saldoTransferModal}:${userId}`)
    .setTitle("💸 Transferir Saldo")
    .addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("target").setLabel("ID ou @ do usuário").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("123456789012345678 ou @user").setMaxLength(32)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("amount").setLabel("Valor R$ (ex: 20,00)").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("10,00").setMaxLength(10))
    );
}
function rankingContainer(client){
  const ranking = saldoStore.getRanking(10);
  const panel = new ContainerBuilder().setAccentColor(0xffd700);
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client,"rendimentos")} Ranking — Top Carteiras`));
  if(!ranking.length){
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${inlineEmoji(client,"desligado")} Nenhum saldo ainda.`));
  } else {
    const medals=["🥇","🥈","🥉"];
    const lines = ranking.map((e,i)=> `${medals[i]||`\`${i+1}.\``} <@${e.userId}> — \`${saldoStore.formatBRL(e.balance)}\``).join("\n");
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines));
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Total em circulação: \`${saldoStore.formatBRL(Object.values(saldoStore.readStore().balances||{}).reduce((a,b)=>a+Number(b||0),0))}\``));
  }
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    withEmoji(new ButtonBuilder().setCustomId(`saldo:ranking:refresh`).setLabel("Atualizar").setStyle(ButtonStyle.Secondary), client, "reload"),
    withEmoji(new ButtonBuilder().setCustomId(`painelsaldo:wallet:${0}`).setLabel("Voltar").setStyle(ButtonStyle.Secondary), client, "reload")
  ));
  return panel;
}
function cashbackModal(userId, cur){
  return new ModalBuilder().setCustomId(`${ids.saldoCashbackModal}:${userId}`).setTitle("Cashback por Compra").addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("percent").setLabel("Cashback % (0-30)").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("Ex: 5 = 5% volta em saldo").setValue(String(cur||0)).setMaxLength(2)));
}
function referralModal(userId, cur){
  return new ModalBuilder().setCustomId(`${ids.saldoReferralModal}:${userId}`).setTitle("Bônus Indicação").addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("percent").setLabel("Bônus indicação % (0-100)").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("Ex: 10 = indicado ganha 10% extra").setValue(String(cur||0)).setMaxLength(3)));
}
function walletContainer(client, userId){
  const balance = saldoStore.getBalance(userId);
  const txs = saldoStore.getTransactions(userId);
  const txCount = txs.length;
  const bonus = saldoStore.getBonusPercent();
  const totalCredit = txs.filter(t=>t.type==="credit").reduce((a,t)=>a+Number(t.total||t.amount||0),0);
  const totalDebit = txs.filter(t=>t.type==="debit").reduce((a,t)=>a+Number(t.amount||0),0);
  const lastTx = txs[0];
  const panel = new ContainerBuilder().setAccentColor(balance>0 ? 0x00ff88 : 0xffffff);
  try{
    const user = client.users.cache.get(userId) || { displayAvatarURL: ()=>null, username:"Você" };
    const avatar = user?.displayAvatarURL?.({extension:"png",size:128});
    const section = new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`## ${inlineEmoji(client,"carteira")} Minha Carteira`),
        new TextDisplayBuilder().setContent(`### ${inlineEmoji(client,"pricep")} \`${saldoStore.formatBRL(balance)}\``),
        new TextDisplayBuilder().setContent(`${inlineEmoji(client,"gift")} Bônus ativo: \`${bonus}%\` • ${inlineEmoji(client,"recibo")} \`${txCount}\` movimentações`)
      );
    if(avatar) section.setThumbnailAccessory(new ThumbnailBuilder().setURL(avatar).setDescription("Avatar"));
    panel.addSectionComponents(section);
  }catch{
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client,"carteira")} Minha Carteira\n### \`${saldoStore.formatBRL(balance)}\``));
  }
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `${inlineEmoji(client,"positivo")} **Recarregado:** \`${saldoStore.formatBRL(totalCredit)}\` • ${inlineEmoji(client,"negativo")} **Gasto:** \`${saldoStore.formatBRL(totalDebit)}\` • ${inlineEmoji(client,"clock")} **Último:** ${lastTx?`<t:${Math.floor(lastTx.at/1000)}:R>`:"—"}\n`+
    `-# ${inlineEmoji(client,"lightbulb")} Use seu saldo para **pagar 1 clique** no carrinho. Sem taxas.`
  ));
  if(lastTx){
    const sign = lastTx.type==="credit"?`+${saldoStore.formatBRL(lastTx.total||lastTx.amount)}`:`-${saldoStore.formatBRL(lastTx.amount)}`;
    const bonusStr = lastTx.bonus? ` (+${saldoStore.formatBRL(lastTx.bonus)})`:"";
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Última: \`${sign}${bonusStr}\` • ${lastTx.reason||""} • <t:${Math.floor(lastTx.at/1000)}:f>`));
  }
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    withEmoji(new ButtonBuilder().setCustomId(`saldo:extrato:${userId}`).setLabel("Extrato").setStyle(ButtonStyle.Secondary), client, "recibo"),
    withEmoji(new ButtonBuilder().setCustomId(`saldo:transfer:${userId}`).setLabel("Transferir").setStyle(ButtonStyle.Primary), client, "users"),
    withEmoji(new ButtonBuilder().setCustomId(`saldo:refresh:${userId}`).setLabel("Atualizar").setStyle(ButtonStyle.Secondary), client, "reload")
  ));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${inlineEmoji(client,"pix")} Recarregue com **bônus ${bonus}%** via \`/painel-saldo\` • ${inlineEmoji(client,"gift")} Pacotes turbinados ativos: \`${saldoStore.getBonusTiers().length}\``));
  return panel;
}
function extratoContainer(client, userId){
  const balance = saldoStore.getBalance(userId);
  const all = saldoStore.getTransactions(userId);
  const txs = all.slice(0,12);
  const totalCredit = all.filter(t=>t.type==="credit").reduce((a,t)=>a+Number(t.total||t.amount||0),0);
  const totalDebit = all.filter(t=>t.type==="debit").reduce((a,t)=>a+Number(t.amount||0),0);
  const panel = new ContainerBuilder().setAccentColor(0xffffff);
  try{
    const sec = new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`## ${inlineEmoji(client,"recibo")} Extrato — ${saldoStore.formatBRL(balance)}`),
        new TextDisplayBuilder().setContent(`${inlineEmoji(client,"positivo")} Entradas: \`${saldoStore.formatBRL(totalCredit)}\` • ${inlineEmoji(client,"negativo")} Saídas: \`${saldoStore.formatBRL(totalDebit)}\` • ${inlineEmoji(client,"clock")} \`${all.length}\` registros`),
        new TextDisplayBuilder().setContent(`-# Mostrando ${txs.length} mais recentes • saldo atual em destaque`)
      );
    const user = client.users.cache.get(userId);
    const av = user?.displayAvatarURL({extension:"png",size:64});
    if(av) sec.setThumbnailAccessory(new ThumbnailBuilder().setURL(av).setDescription("Avatar"));
    panel.addSectionComponents(sec);
  }catch{
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client,"recibo")} Extrato — ${saldoStore.formatBRL(balance)}`));
  }
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
  if(!txs.length){
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${inlineEmoji(client,"desligado")} Nenhuma movimentação ainda.\n-# Faça sua primeira recarga e ganhe \`${saldoStore.getBonusPercent()}%\` de bônus!`));
  } else {
    const lines = txs.map(t=>{
      const isCredit = t.type==="credit";
      const icon = isCredit? inlineEmoji(client,"positivo") : inlineEmoji(client,"negativo");
      const sign = isCredit ? "+" : "−";
      const bonusStr = t.bonus ? ` \`${saldoStore.formatBRL(t.bonus)} bônus\`` : "";
      const date = `<t:${Math.floor(t.at/1000)}:R>`;
      const reason = (t.reason||"").slice(0,32);
      const amountStr = `\`${sign}${saldoStore.formatBRL(t.amount)}${isCredit?bonusStr:""}\``;
      return `${icon} ${amountStr} • **${reason}** • ${date} • → \`${saldoStore.formatBRL(t.balanceAfter)}\``;
    }).join("\n");
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines));
    if(all.length>12) panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# +${all.length-12} movimentações antigas • saldo sempre atualizado`));
  }
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    withEmoji(new ButtonBuilder().setCustomId(`saldo:wallet:${userId}`).setLabel("Voltar à Carteira").setStyle(ButtonStyle.Secondary), client, "carteira"),
    withEmoji(new ButtonBuilder().setCustomId(`saldo:refresh:${userId}`).setLabel("Atualizar").setStyle(ButtonStyle.Secondary), client, "reload")
  ));
  return panel;
}
function painelSaldoContainer(client, guildId, userId){
  const cfg = saldoStore.getConfig();
  const st = saldoStore.readStore();
  const totalUsers = Object.keys(st.balances||{}).length;
  const totalSaldo = Object.values(st.balances||{}).reduce((a,b)=>a+Number(b||0),0);
  const topupsPending = Object.values(st.topups||{}).filter(t=>t.status!=="approved").length;
  const panel = new ContainerBuilder().setAccentColor(0xffd700);
  try{
    const guild = client.guilds.cache.get(guildId);
    const icon = guild?.iconURL({extension:"png",size:64}) || client.user?.displayAvatarURL({extension:"png",size:64});
    const sec = new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`## ${inlineEmoji(client,"carteira")} Painel de Saldo — Gestão Premium`),
        new TextDisplayBuilder().setContent(`Controle total da **carteira da loja** em tempo real.`),
        new TextDisplayBuilder().setContent(`-# ${cfg.enabled?`${inlineEmoji(client,"ligado")} Saldo ativo`:`${inlineEmoji(client,"desligado")} Desativado`} • Bônus \`${cfg.bonusPercent}%\``)
      );
    if(icon) sec.setThumbnailAccessory(new ThumbnailBuilder().setURL(icon).setDescription("Guild"));
    panel.addSectionComponents(sec);
  }catch{
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client,"carteira")} Painel de Saldo — Gestão Premium`));
  }
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `${inlineEmoji(client,"users")} **Clientes:** \`${totalUsers}\` • ${inlineEmoji(client,"pricep")} **Circulante:** \`${saldoStore.formatBRL(totalSaldo)}\` • ${inlineEmoji(client,"clock")} **Pendentes:** \`${topupsPending}\`\n`+
    `${inlineEmoji(client,"gift")} **Bônus:** \`${cfg.bonusPercent}%\` [${bar(cfg.bonusPercent,12)}] • ${cfg.enabled?`${inlineEmoji(client,"ligado")} Checkout com Saldo`:`${inlineEmoji(client,"desligado")} Oculto no checkout`}\n`+
    `-# ${inlineEmoji(client,"lightbulb")} **Adicionar Saldo** cria thread privada com PIX + aprovação owner.`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  const recent = Object.values(st.topups||{}).sort((a,b)=>b.createdAt-a.createdAt).slice(0,3);
  if(recent.length){
    const lines = recent.map(t=> `${t.status==="approved"?`${inlineEmoji(client,"positivo")}`:`${inlineEmoji(client,"clock")}`} #\`${t.id.slice(-6)}\` <@${t.userId}> • \`${t.amount?saldoStore.formatBRL(t.amount):"—"}\` • ${t.status}`).join("\n");
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Recargas recentes:**\n${lines}`));
    panel.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
  }
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    withEmoji(new ButtonBuilder().setCustomId(`painelsaldo:add:${userId}`).setLabel("Adicionar Saldo").setStyle(ButtonStyle.Success), client, "mais2"),
    withEmoji(new ButtonBuilder().setCustomId(`painelsaldo:wallet:${userId}`).setLabel("Minha Carteira").setStyle(ButtonStyle.Secondary), client, "carteira")
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    withEmoji(new ButtonBuilder().setCustomId(`painelsaldo:ranking:${userId}`).setLabel("Ranking").setStyle(ButtonStyle.Secondary), client, "rendimentos"),
    withEmoji(new ButtonBuilder().setCustomId(`painelsaldo:export:${userId}`).setLabel("Exportar CSV").setStyle(ButtonStyle.Secondary), client, "recibo")
  ));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${inlineEmoji(client,"lightbulb")} **Ranking** mostra top carteiras • **Exportar** baixa CSV de saldos e topups`));
  return panel;
}
function topupInitialContainer(client, topup){
  const bonus = saldoStore.getBonusForAmount(100);
  const tiers = saldoStore.getBonusTiers();
  const panel = new ContainerBuilder().setAccentColor(0x1a1a2e);
  try{
    const sec = new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`## ${inlineEmoji(client,"carteira")} Adicionar Saldo — Etapa 1/3`),
        new TextDisplayBuilder().setContent(`Recarregue sua **carteira** e ganhe **bônus instantâneo** para usar na loja.`),
        new TextDisplayBuilder().setContent(`-# ${inlineEmoji(client,"gift")} **Bônus atual:** \`${bonus}%\` • Ex: R$100 → \`${saldoStore.formatBRL(100*(1+bonus/100))}\``)
      );
    panel.addSectionComponents(sec);
  }catch{
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client,"carteira")} Adicionar Saldo — Etapa 1/3`));
  }
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
  const tierInfo = tiers.length ? tiers.map(t=> `\`R$ ${t.amount.toFixed(2).replace(".",",")}\` → +${t.percent}%`).join(" • ") : `Bônus base ${bonus}%`;
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `${inlineEmoji(client,"sparkles")} **Como funciona:**\n`+
    `**1.** Defina o valor → **2.** Aceite os termos → **3.** Pague o PIX → **4.** Owner aprova e saldo cai na hora\n`+
    `**Pacotes:** ${tierInfo}\n`+
    `-# Progresso: \`█░░\` 1/3 • Thread privada • expira em 60 min`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    withEmoji(new ButtonBuilder().setCustomId(`saldo:topup:define:${topup.id}`).setLabel("Definir Valor").setStyle(ButtonStyle.Success), client, "pricep"),
    withEmoji(new ButtonBuilder().setCustomId(`saldo:topup:cancel:${topup.id}`).setLabel("Cancelar").setStyle(ButtonStyle.Danger), client, "negativo")
  ));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${inlineEmoji(client,"clock")} Clique em **Definir Valor** para escolher quanto recarregar (R$1 a R$5.000).`));
  return panel;
}
function termsContainer(client, topup, amount){
  const bonusPercent = saldoStore.getBonusForAmount(amount);
  const bonus = Math.round(Number(amount)*(bonusPercent/100)*100)/100;
  const total = Math.round((Number(amount)+bonus)*100)/100;
  const panel = new ContainerBuilder().setAccentColor(0xf1c40f);
  try{
    const sec = new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`## ${inlineEmoji(client,"ban")} Termos de Recarga — Etapa 2/3`),
        new TextDisplayBuilder().setContent(`Leia com atenção antes de **aceitar**.`),
        new TextDisplayBuilder().setContent(`-# Recarga #\`${topup.id.slice(-6)}\` • <t:${Math.floor(Date.now()/1000)}:F>`)
      );
    panel.addSectionComponents(sec);
  }catch{
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client,"ban")} Termos — 2/3`));
  }
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `${inlineEmoji(client,"negativo")} **Valor não reembolsável** — não pode ser sacado.\n`+
    `${inlineEmoji(client,"caixa")} **Uso exclusivo** — somente em produtos desta loja.\n`+
    `${inlineEmoji(client,"gift")} **Bônus** \`${bonusPercent}%\` creditado junto.\n`+
    `${inlineEmoji(client,"clock")} **Validade** — saldo não expira.`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `### ${inlineEmoji(client,"pricep")} Resumo da recarga\n`+
    `${inlineEmoji(client,"carteira")} **Você paga:** \`${saldoStore.formatBRL(amount)}\`\n`+
    `${inlineEmoji(client,"gift")} **Bônus:** \`${saldoStore.formatBRL(bonus)}\` (${bonusPercent}%) → pacotes turbinados aplicados\n`+
    `${inlineEmoji(client,"positivo")} **Você recebe:** \`${saldoStore.formatBRL(total)}\` **em saldo**\n`+
    `-# Progresso: \`██░\` 2/3`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    withEmoji(new ButtonBuilder().setCustomId(`saldo:topup:terms:accept:${topup.id}:${amount}`).setLabel(`Aceitar — Pagar ${saldoStore.formatBRL(amount)}`).setStyle(ButtonStyle.Success), client, "positivo"),
    withEmoji(new ButtonBuilder().setCustomId(`saldo:topup:terms:cancel:${topup.id}`).setLabel("Cancelar").setStyle(ButtonStyle.Danger), client, "negativo")
  ));
  return panel;
}
function amountModal(userId, topupId){
  return new ModalBuilder()
    .setCustomId(`modal:saldo:topup:amount:${topupId}:${userId}`)
    .setTitle("💳 Valor da Recarga")
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("amount").setLabel("Valor em R$ (ex: 50,00)").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("10,00 — mínimo R$1, máximo R$5.000").setMaxLength(10)
    ));
}
function parseBRL(v){ const n = String(v||"").replace(/[^\d,.-]/g,"").replace(/\./g,"").replace(",","."); return Math.round((Number(n)||0)*100)/100; }
function formatBRL(v){ return saldoStore.formatBRL(v); }
function buildPixPayload({ key, amount, txid }){
  const emv=(id,val)=>{ const s=String(val); return `${id}${String(s.length).padStart(2,"0")}${s}`; };
  const merchant = emv("00","br.gov.bcb.pix")+emv("01",key);
  const base=[emv("00","01"),emv("26",merchant),emv("52","0000"),emv("53","986"),amount?emv("54",Number(amount).toFixed(2)):"",emv("58","BR"),emv("59","SALDO"),emv("60","BRASIL"),emv("62",emv("05",String(txid||"SALDO").slice(0,25)))].join("");
  const withoutCrc=`${base}6304`;
  let crc=0xffff; for(const ch of withoutCrc){ crc ^= ch.charCodeAt(0)<<8; for(let i=0;i<8;i++) crc=crc&0x8000?(crc<<1)^0x1021:crc<<1, crc&=0xffff; }
  return `${withoutCrc}${crc.toString(16).toUpperCase().padStart(4,"0")}`;
}
async function handleSaldoCommand(interaction){
  if(!interaction.isChatInputCommand() || interaction.commandName!=="saldo") return false;
  try{
    await interaction.reply({ components:[walletContainer(interaction.client, interaction.user.id)], flags:V2, ephemeral: true });
  }catch{
    await interaction.reply({ content:"Erro ao abrir carteira. Tente novamente.", flags: MessageFlags.Ephemeral }).catch(()=>null);
  }
  return true;
}
async function handlePainelSaldoCommand(interaction){
  if(!interaction.isChatInputCommand() || interaction.commandName!=="painel-saldo") return false;
  const guild = interaction.guild;
  const isOwner = require("../../botOwners").botOwnerIds(guild).includes(interaction.user.id);
  const isAdmin = interaction.memberPermissions?.has(require("discord.js").PermissionFlagsBits.Administrator);
  const hasPerm = require("../perms").hasBotPermission(interaction);
  if(!isOwner && !isAdmin && !hasPerm){
    await interaction.reply({ content:"Somente owner/admin pode usar /painel-saldo.", flags: MessageFlags.Ephemeral });
    return true;
  }
  try{
    await interaction.reply({ components:[painelSaldoContainer(interaction.client, interaction.guildId, interaction.user.id)], flags:V2, ephemeral: true });
  }catch{
    await interaction.reply({ content:"Erro ao abrir painel.", flags: MessageFlags.Ephemeral }).catch(()=>null);
  }
  return true;
}
async function handleSaldoPanelComponent(interaction, baseId){
  const client=interaction.client; const guildId=interaction.guildId; const userId=interaction.user.id;
  try{
    if(baseId===ids.saldoEntry){
      await interaction.update(payload(saldoConfigPanel(client, guildId, userId)));
      return true;
    }
    if(baseId===ids.saldoExtras){
      await interaction.update(payload(saldoExtrasPanel(client, userId)));
      return true;
    }
    if(baseId===ids.saldoToggle){
      const val = interaction.values?.[0];
      if(val==="enable") saldoStore.setConfig(c=>({ ...c, enabled:true }));
      if(val==="disable") saldoStore.setConfig(c=>({ ...c, enabled:false }));
      await interaction.update(payload(saldoConfigPanel(client, guildId, userId)));
      return true;
    }
    if(baseId===ids.saldoExtrasSelect){
      const v=interaction.values?.[0];
      if(v==="bonus"){
        await interaction.showModal(bonusModal(userId, saldoStore.getBonusPercent()));
        return true;
      }
      if(v==="tier_add"){
        await interaction.showModal(tierModal(userId));
        return true;
      }
      if(v==="tier_remove"){
        const tiers = saldoStore.getBonusTiers();
        if(!tiers.length){
          await interaction.reply({ content:"Nenhum pacote para remover.", flags:MessageFlags.Ephemeral });
          return true;
        }
        const panel=new ContainerBuilder().setAccentColor(0xe74c3c);
        panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client,"apagar")} Remover Pacote`));
        panel.addActionRowComponents(new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(scoped(ids.saldoTierRemoveSelect, userId))
            .setPlaceholder("Selecione o pacote para remover")
            .addOptions(tiers.map((t,i)=>({ label:`R$ ${t.amount.toFixed(2).replace(".",",")} → +${t.percent}%`, value:String(i), description:`Pacote ${i+1}`, emoji: componentEmoji(client,"apagar") })))
        ));
        panel.addActionRowComponents(new ActionRowBuilder().addComponents(
          withEmoji(new ButtonBuilder().setCustomId(scoped(ids.saldoExtras, userId)).setLabel("Voltar").setStyle(ButtonStyle.Secondary), client, "reload")
        ));
        await interaction.update(payload(panel));
        return true;
      }
      if(v==="cashback"){
        await interaction.showModal(cashbackModal(userId, saldoStore.getConfig().cashbackPercent||0));
        return true;
      }
      if(v==="referral"){
        await interaction.showModal(referralModal(userId, saldoStore.getConfig().referralBonus||0));
        return true;
      }
    }
    if(baseId===ids.saldoTierRemoveSelect){
      const idx = Number(interaction.values?.[0]);
      saldoStore.removeBonusTier(idx);
      await interaction.update(payload(saldoExtrasPanel(client, userId)));
      return true;
    }
  }catch(e){
    console.error("[Saldo panel]", e);
    await interaction.reply({ content:`Erro: ${e.message}`, flags: MessageFlags.Ephemeral }).catch(()=>null);
    return true;
  }
  return false;
}
async function handleSaldoModal(interaction){
  const id=interaction.customId;
  try{
    if(id.startsWith(ids.saldoBonusModal)){
      const isOwner = require("../../botOwners").botOwnerIds(interaction.guild).includes(interaction.user.id);
      const isAdmin = interaction.memberPermissions?.has(require("discord.js").PermissionFlagsBits.Administrator);
      const hasPerm = require("../perms").hasBotPermission(interaction);
      if(!isOwner && !isAdmin && !hasPerm){
        await interaction.reply({ content:"Somente owner/admin pode alterar o bônus.", flags: MessageFlags.Ephemeral });
        return true;
      }
      const bonusRaw=interaction.fields.getTextInputValue("bonus").trim().replace(",",".").replace("%","");
      const num = Number(bonusRaw);
      if(!Number.isFinite(num) || num<0 || num>100){
        await interaction.reply({ content:"Bônus inválido. Use 0 a 100.", flags: MessageFlags.Ephemeral });
        return true;
      }
      saldoStore.setConfig(c=>({ ...c, bonusPercent: Math.round(num) }));
      await interaction.update(payload(saldoExtrasPanel(interaction.client, interaction.user.id)));
      return true;
    }
    if(id.startsWith(ids.saldoTierModal)){
      const isOwner = require("../../botOwners").botOwnerIds(interaction.guild).includes(interaction.user.id);
      const isAdmin = interaction.memberPermissions?.has(require("discord.js").PermissionFlagsBits.Administrator);
      const hasPerm = require("../perms").hasBotPermission(interaction);
      if(!isOwner && !isAdmin && !hasPerm){
        await interaction.reply({ content:"Somente owner/admin pode criar pacotes.", flags:MessageFlags.Ephemeral });
        return true;
      }
      const amt = parseBRL(interaction.fields.getTextInputValue("amount"));
      const percRaw = interaction.fields.getTextInputValue("percent").trim().replace("%","").replace(",",".");
      const perc = Math.round(Number(percRaw)||0);
      if(!amt || amt<5){ await interaction.reply({ content:"Valor mínimo do pacote: R$5,00", flags:MessageFlags.Ephemeral }); return true; }
      if(!Number.isFinite(perc) || perc<=0 || perc>100){ await interaction.reply({ content:"Bônus inválido 1-100", flags:MessageFlags.Ephemeral }); return true; }
      saldoStore.addBonusTier(amt, perc);
      await interaction.update(payload(saldoExtrasPanel(interaction.client, interaction.user.id)));
      return true;
    }
    if(id.startsWith(ids.saldoCashbackModal)){
      const isOwner = require("../../botOwners").botOwnerIds(interaction.guild).includes(interaction.user.id);
      const isAdmin = interaction.memberPermissions?.has(require("discord.js").PermissionFlagsBits.Administrator);
      const hasPerm = require("../perms").hasBotPermission(interaction);
      if(!isOwner && !isAdmin && !hasPerm){ await interaction.reply({ content:"Somente owner/admin pode alterar cashback.", flags:MessageFlags.Ephemeral }); return true; }
      const perc = Math.round(Number(interaction.fields.getTextInputValue("percent").trim().replace("%","").replace(",","."))||0);
      if(!Number.isFinite(perc) || perc<0 || perc>30){ await interaction.reply({ content:"Cashback 0-30% (ex: 5 = 5% volta)", flags:MessageFlags.Ephemeral }); return true; }
      saldoStore.setConfig(c=>({ ...c, cashbackPercent: perc }));
      await interaction.update(payload(saldoExtrasPanel(interaction.client, interaction.user.id)));
      return true;
    }
    if(id.startsWith(ids.saldoReferralModal)){
      const isOwner = require("../../botOwners").botOwnerIds(interaction.guild).includes(interaction.user.id);
      const isAdmin = interaction.memberPermissions?.has(require("discord.js").PermissionFlagsBits.Administrator);
      const hasPerm = require("../perms").hasBotPermission(interaction);
      if(!isOwner && !isAdmin && !hasPerm){ await interaction.reply({ content:"Somente owner/admin pode alterar indicação.", flags:MessageFlags.Ephemeral }); return true; }
      const perc = Math.round(Number(interaction.fields.getTextInputValue("percent").trim().replace("%","").replace(",","."))||0);
      if(!Number.isFinite(perc) || perc<0 || perc>100){ await interaction.reply({ content:"Bônus indicação 0-100% (ex: 10)", flags:MessageFlags.Ephemeral }); return true; }
      saldoStore.setConfig(c=>({ ...c, referralBonus: perc }));
      await interaction.update(payload(saldoExtrasPanel(interaction.client, interaction.user.id)));
      return true;
    }
    if(id.startsWith(ids.saldoTransferModal)){
      const rawTarget = interaction.fields.getTextInputValue("target").trim();
      const amount = parseBRL(interaction.fields.getTextInputValue("amount"));
      if(!amount || amount < 1){ await interaction.reply({ content:"Valor mínimo R$1,00", flags:MessageFlags.Ephemeral }); return true; }
      if(amount > 1000){ await interaction.reply({ content:"Máximo por transferência: R$1.000", flags:MessageFlags.Ephemeral }); return true; }
      const targetId = rawTarget.replace(/\D/g,"");
      if(!/^\d{15,25}$/.test(targetId)){ await interaction.reply({ content:"ID/@ inválido. Use ID 15-25 dígitos ou mencione.", flags:MessageFlags.Ephemeral }); return true; }
      if(targetId===interaction.user.id){ await interaction.reply({ content:"Não pode transferir para si mesmo.", flags:MessageFlags.Ephemeral }); return true; }
      const panel=new ContainerBuilder().setAccentColor(0xf1c40f);
      panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(interaction.client,"users")} Confirmar Transferência`));
      panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${inlineEmoji(interaction.client,"carteira")} **Valor:** \`${saldoStore.formatBRL(amount)}\` → <@${targetId}>\n-# Taxa: 0% • Transferência instantânea`));
      panel.addActionRowComponents(new ActionRowBuilder().addComponents(
        withEmoji(new ButtonBuilder().setCustomId(`saldo:transfer:confirm:${targetId}:${amount}`).setLabel("Confirmar").setStyle(ButtonStyle.Success), interaction.client, "positivo"),
        withEmoji(new ButtonBuilder().setCustomId(`saldo:transfer:cancel`).setLabel("Cancelar").setStyle(ButtonStyle.Danger), interaction.client, "negativo")
      ));
      await interaction.reply({ components:[panel], flags:V2_EPH });
      return true;
    }
    if(id.startsWith("modal:saldo:topup:amount:")){
      const parts=id.split(":"); const topupId=parts[4];
      const amount = parseBRL(interaction.fields.getTextInputValue("amount"));
      if(!amount || amount < 1){
        await interaction.reply({ content:"Valor inválido. Use mínimo R$ 1,00. Ex: 50,00", flags:MessageFlags.Ephemeral });
        return true;
      }
      if(amount > 5000){
        await interaction.reply({ content:"Valor máximo por recarga é R$ 5.000,00.", flags:MessageFlags.Ephemeral });
        return true;
      }
      const topup = saldoStore.getTopup(topupId);
      if(!topup){ await interaction.reply({ content:"Recarga não encontrada ou expirada.", flags:MessageFlags.Ephemeral }); return true; }
      if(topup.userId !== interaction.user.id){
        await interaction.reply({ content:"Somente quem criou pode definir valor.", flags:MessageFlags.Ephemeral });
        return true;
      }
      saldoStore.setTopup(topupId, cur=>({ ...cur, amount }));
      await interaction.reply({ components:[termsContainer(interaction.client, topup, amount)], flags:V2 });
      return true;
    }
  }catch(e){
    console.error("[Saldo modal]", e);
    await interaction.reply({ content:`Erro: ${e.message}`, flags: MessageFlags.Ephemeral }).catch(()=>null);
    return true;
  }
  return false;
}
async function handleSaldoInteraction(interaction){
  const cid = interaction.customId || "";
  const client = interaction.client;
  try{
    if(cid.startsWith("saldo:extrato:")){
      const uid = cid.split(":")[2];
      const isOwner = require("../../botOwners").botOwnerIds(interaction.guild).includes(interaction.user.id);
      if(uid !== interaction.user.id && !hasBotPermission(interaction) && !interaction.memberPermissions?.has(require("discord.js").PermissionFlagsBits.Administrator) && !isOwner){
        await interaction.reply({ content:"Você só pode ver seu extrato.", flags:MessageFlags.Ephemeral });
        return true;
      }
      await interaction.update({ components:[extratoContainer(client, uid)], flags:V2 });
      return true;
    }
    if(cid.startsWith("saldo:refresh:")){
      const uid = cid.split(":")[2];
      const isOwner = require("../../botOwners").botOwnerIds(interaction.guild).includes(interaction.user.id);
      if(uid !== interaction.user.id && !hasBotPermission(interaction) && !interaction.memberPermissions?.has(require("discord.js").PermissionFlagsBits.Administrator) && !isOwner){
        await interaction.reply({ content:"Você só pode atualizar sua própria carteira.", flags:MessageFlags.Ephemeral });
        return true;
      }
      await interaction.update({ components:[walletContainer(client, uid)], flags:V2 });
      return true;
    }
    if(cid.startsWith("saldo:wallet:")){
      const uid = cid.split(":")[2];
      const isOwner = require("../../botOwners").botOwnerIds(interaction.guild).includes(interaction.user.id);
      if(uid !== interaction.user.id && !hasBotPermission(interaction) && !interaction.memberPermissions?.has(require("discord.js").PermissionFlagsBits.Administrator) && !isOwner){
        await interaction.reply({ content:"Você só pode ver sua carteira.", flags:MessageFlags.Ephemeral });
        return true;
      }
      await interaction.update({ components:[walletContainer(client, uid)], flags:V2 });
      return true;
    }
    if(cid.startsWith("saldo:transfer:") && !cid.startsWith("saldo:transfer:confirm")){
      if(cid==="saldo:transfer:cancel"){
        await interaction.update({ components:[walletContainer(client, interaction.user.id)], flags:V2 });
        return true;
      }
      const uid = cid.split(":")[2];
      if(uid !== interaction.user.id){
        await interaction.reply({ content:"Use sua própria carteira.", flags:MessageFlags.Ephemeral });
        return true;
      }
      const bal = saldoStore.getBalance(uid);
      if(bal <=0){
        await interaction.reply({ content:`Saldo insuficiente: \`${saldoStore.formatBRL(bal)}\``, flags:MessageFlags.Ephemeral });
        return true;
      }
      await interaction.showModal(transferModal(uid));
      return true;
    }
    if(cid.startsWith("saldo:transfer:confirm:")){
      const parts=cid.split(":"); const targetId=parts[3]; const amount=Number(parts[4]);
      if(!targetId || !amount){ await interaction.reply({ content:"Dados inválidos.", flags:MessageFlags.Ephemeral }); return true; }
      try{
        const res = await saldoStore.transferAtomic(interaction.user.id, targetId, amount, `Transferência para <@${targetId}>`, `Transferência de <@${interaction.user.id}>`);
        if(!res?.ok){
          await interaction.update({ components:[new ContainerBuilder().setAccentColor(0xe74c3c).addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client,"negativo")} Falha\n${res?.reason||"Saldo insuficiente"}`))], flags:V2 });
          return true;
        }
        const c=new ContainerBuilder().setAccentColor(0x2ecc71);
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client,"positivo")} Transferência enviada!`));
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${inlineEmoji(client,"carteira")} \`${saldoStore.formatBRL(amount)}\` para <@${targetId}>\n${inlineEmoji(client,"pricep")} Seu saldo: \`${saldoStore.formatBRL(res.fromAfter)}\``));
        await interaction.update({ components:[c], flags:V2 });
        try{ const u=await client.users.fetch(targetId).catch(()=>null); if(u){ const dm=new ContainerBuilder().setAccentColor(0x2ecc71).addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client,"carteira")} Você recebeu \`${saldoStore.formatBRL(amount)}\`!\nDe <@${interaction.user.id}> • Saldo atual \`${saldoStore.formatBRL(res.toAfter)}\``)); await u.send({ components:[dm], flags:V2 }).catch(()=>null);} }catch{}
      }catch(e){
        await interaction.reply({ content:`Erro: ${e.message}`, flags:MessageFlags.Ephemeral }).catch(()=>null);
      }
      return true;
    }
    if(cid==="saldo:ranking:refresh"){
      await interaction.update({ components:[rankingContainer(client)], flags:V2 });
      return true;
    }
    if(cid.startsWith("painelsaldo:add:")){
      if(!interaction.channel?.isTextBased()){ await interaction.reply({ content:"Use em um canal de texto.", flags:MessageFlags.Ephemeral }); return true; }
      const key = `saldo:topup:${interaction.user.id}`;
      if(client._saldoCooldown?.has(key)){
        await interaction.reply({ content:"Aguarde 30s para criar outra recarga.", flags:MessageFlags.Ephemeral });
        return true;
      }
      client._saldoCooldown ||= new Map();
      client._saldoCooldown.set(key, Date.now());
      setTimeout(()=> client._saldoCooldown.delete(key), 30000);
      const guildId = interaction.guildId;
      const channel = interaction.channel;
      const { ChannelType } = require("discord.js");
      let parentId = null;
      try{ parentId = require("../../storage").getGuildConfig(guildId).sales.channels.cartsCategory || null; }catch{}
      let thread;
      try{
        const opts = { name:`💳・saldo-${interaction.user.username}`.slice(0,90), type: channel.type===ChannelType.GuildText?ChannelType.PrivateThread:ChannelType.PublicThread, autoArchiveDuration: 60, reason:"Recarga de saldo" };
        thread = await channel.threads.create(opts);
        await thread.members.add(interaction.user.id).catch(()=>null);
        for(const oid of botOwnerIds(interaction.guild)) await thread.members.add(oid).catch(()=>null);
      }catch(e){
        await interaction.reply({ content:`Não consegui criar thread: ${e.message} (verifique permissão Criar Threads Privadas)`, flags:MessageFlags.Ephemeral });
        return true;
      }
      const topup = saldoStore.createTopup({ userId: interaction.user.id, guildId, channelId: channel.id, threadId: thread.id });
      saldoStore.setTopup(topup.id, cur=>({ ...cur, threadId: thread.id }));
      await thread.send({ components:[topupInitialContainer(client, {...topup, threadId: thread.id})], flags:V2 });
      await interaction.reply({ content:`✅ Thread criada: ${thread} — finalize sua recarga lá!`, flags:MessageFlags.Ephemeral });
      return true;
    }
    if(cid.startsWith("painelsaldo:wallet:")){
      await interaction.reply({ components:[walletContainer(client, interaction.user.id)], flags:V2_EPH });
      return true;
    }
    if(cid.startsWith("painelsaldo:ranking:")){
      await interaction.reply({ components:[rankingContainer(client)], flags:V2_EPH });
      return true;
    }
    if(cid.startsWith("painelsaldo:export:")){
      const data = saldoStore.readStore();
      const rows = [["userId","balance","transactions"]].concat(Object.entries(data.balances||{}).map(([uid,bal])=> [uid, String(bal), String((data.transactions[uid]||[]).length)]));
      const csv = rows.map(r=> r.map(v=> `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
      const buf = Buffer.from(csv, "utf8");
      await interaction.reply({ content:`📊 Export Saldo — ${rows.length-1} carteiras`, files:[{ attachment: buf, name:`saldo-${Date.now()}.csv` }], flags: MessageFlags.Ephemeral });
      return true;
    }
    if(cid.startsWith("saldo:topup:cancel:")){
      const topupId=cid.split(":")[3];
      const topup = saldoStore.getTopup(topupId);
      if(topup && topup.userId !== interaction.user.id && !hasBotPermission(interaction) && !interaction.memberPermissions?.has(require("discord.js").PermissionFlagsBits.Administrator)){
        await interaction.reply({ content:"Somente o dono da recarga pode cancelar.", flags:MessageFlags.Ephemeral });
        return true;
      }
      const c = new ContainerBuilder().setAccentColor(0xe74c3c);
      c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client,"negativo")} Recarga cancelada\n${inlineEmoji(client,"clock")} Esta thread será fechada em **15 segundos**.`));
      c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# #\`${topupId.slice(-6)}\` • ${inlineEmoji(client,"carteira")} Saldo não alterado`));
      await interaction.update({ components:[c], flags:V2 });
      setTimeout(()=>{ interaction.channel?.delete("Recarga cancelada").catch(()=>null); saldoStore.deleteTopup(topupId); },15000);
      return true;
    }
    if(cid.startsWith("saldo:topup:define:")){
      const topupId=cid.split(":")[3];
      const topup = saldoStore.getTopup(topupId);
      if(!topup){ await interaction.reply({ content:"Recarga não encontrada.", flags:MessageFlags.Ephemeral }); return true; }
      if(topup.userId !== interaction.user.id){
        await interaction.reply({ content:"Somente quem criou pode definir valor.", flags:MessageFlags.Ephemeral });
        return true;
      }
      await interaction.showModal(amountModal(interaction.user.id, topupId));
      return true;
    }
    if(cid.startsWith("saldo:topup:terms:cancel:")){
      const c=new ContainerBuilder().setAccentColor(0x2b2d31);
      c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client,"negativo")} Termos recusados\nRecarga cancelada. Você pode clicar em **Definir Valor** novamente ou **Cancelar** a thread.`));
      await interaction.update({ components:[c], flags:V2 });
      return true;
    }
    if(cid.startsWith("saldo:topup:terms:accept:")){
      const parts=cid.split(":"); const topupId=parts[4];
      const topup=saldoStore.getTopup(topupId);
      if(!topup || !topup.amount){ await interaction.reply({ content:"Valor não definido. Clique em Definir Valor primeiro.", flags:MessageFlags.Ephemeral }); return true; }
      const amount = Number(topup.amount);
      const cfg = getGuildConfig(interaction.guildId);
      const pixKey = cfg.payments.pix.key;
      if(!pixKey){
        const c = new ContainerBuilder().setAccentColor(0xe74c3c);
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client,"negativo")} PIX não configurado\nConfigure uma **chave Pix** em \`/panel → Configurações → Formas de Pagamento → Pix manual\` antes de recarregar.`));
        await interaction.reply({ components:[c], flags:V2_EPH });
        return true;
      }
      await interaction.deferUpdate().catch(()=>null);
      const bonusPercent = saldoStore.getBonusForAmount(amount);
      const bonus = Math.round(amount*(bonusPercent/100)*100)/100;
      const payload = buildPixPayload({ key: pixKey, amount, txid:`S${String(topupId).slice(-20)}` });
      saldoStore.setTopup(topupId, cur=>({ ...cur, bonus, total: Math.round((amount+bonus)*100)/100, pixPayload: payload, status:"await_confirmation" }));
      const totalStr = formatBRL(amount+bonus);
      const bonusStr = bonus>0?`+ ${formatBRL(bonus)} bônus → **${totalStr}**`:"";
      const panel=new ContainerBuilder().setAccentColor(0x00ff88);
      try{
        const sec=new SectionBuilder()
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`## ${inlineEmoji(client,"carteira")} Pague para recarregar — Etapa 3/3`),
            new TextDisplayBuilder().setContent(`${inlineEmoji(client,"pricep")} **Você paga:** \`${formatBRL(amount)}\` ${bonusStr}`),
            new TextDisplayBuilder().setContent(`-# Progresso: \`███\` 3/3 • Após pagar clique **Confirmar**`)
          );
        panel.addSectionComponents(sec);
      }catch{
        panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client,"carteira")} Pague para recarregar — 3/3\n**Valor:** \`${formatBRL(amount)}\` ${bonusStr}`));
      }
      panel.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
      panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${inlineEmoji(client,"pix")} **PIX copia-e-cola** (toque para copiar no botão abaixo):`));
      panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`\`\`\`${payload}\`\`\``));
      const buf = await QRCode.toBuffer(payload, { width:520, margin:2 }).catch(()=>null);
      const files = buf? [{ attachment: buf, name:`pix-${topupId}.png` }]: [];
      if(buf) panel.addMediaGalleryComponents(new MediaGalleryBuilder({ items:[{ media:{ url:`attachment://pix-${topupId}.png` }, description:"QR Code PIX" }] }));
      panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
      panel.addActionRowComponents(new ActionRowBuilder().addComponents(
        withEmoji(new ButtonBuilder().setCustomId(`saldo:topup:copy:${topupId}`).setLabel("Copia e cola").setStyle(ButtonStyle.Secondary), client, "recibo"),
        withEmoji(new ButtonBuilder().setCustomId(`saldo:topup:confirm:${topupId}`).setLabel("Confirmar pagamento").setStyle(ButtonStyle.Success), client, "positivo")
      ));
      panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${inlineEmoji(client,"lightbulb")} Após pagar via banco, clique **Confirmar** para o owner aprovar.`));
      await interaction.editReply({ components:[panel], flags:V2, files }).catch(()=> interaction.followUp({ components:[panel], flags:V2, files }).catch(()=>null));
      await interaction.followUp({ content:`Obrigado por usar nossa loja! 💚`, flags:MessageFlags.Ephemeral }).catch(()=>null);
      return true;
    }
    if(cid.startsWith("saldo:topup:copy:")){
      const topupId=cid.split(":")[3];
      const topup=saldoStore.getTopup(topupId);
      if(!topup?.pixPayload){ await interaction.reply({ content:"PIX ainda não gerado. Aceite os termos primeiro.", flags:MessageFlags.Ephemeral }); return true; }
      await interaction.reply({ content:`\`\`\`${topup.pixPayload}\`\`\``, flags:MessageFlags.Ephemeral });
      return true;
    }
    if(cid.startsWith("saldo:topup:confirm:")){
      const topupId=cid.split(":")[3];
      const topup=saldoStore.getTopup(topupId);
      if(!topup){ await interaction.reply({ content:"Recarga não encontrada.", flags:MessageFlags.Ephemeral }); return true; }
      if(interaction.user.id !== topup.userId){
        await interaction.reply({ content:"Somente quem criou a recarga pode confirmar.", flags:MessageFlags.Ephemeral });
        return true;
      }
      if(topup.status==="await_approval"){
        await interaction.reply({ content:"Já confirmado, aguardando aprovação do owner.", flags:MessageFlags.Ephemeral });
        return true;
      }
      saldoStore.setTopup(topupId, cur=>({ ...cur, status:"await_approval" }));
      const panel=new ContainerBuilder().setAccentColor(0xf1c40f);
      panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client,"clock")} Pagamento em análise`));
      panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `O usuário <@${topup.userId}> confirmou pagamento de \`${formatBRL(topup.amount)}\` (+ \`${formatBRL(topup.bonus||0)} bônus\`)\n`+
        `**Total a creditar:** \`${formatBRL(topup.total||topup.amount)}\`\n`+
        `-# Aguardando **aprovação do owner** para liberar o saldo.`
      ));
      panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
      panel.addActionRowComponents(new ActionRowBuilder().addComponents(
        withEmoji(new ButtonBuilder().setCustomId(`saldo:topup:approve:${topupId}`).setLabel("Aprovar pagamento").setStyle(ButtonStyle.Success), client, "positivo")
      ));
      panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${inlineEmoji(client,"lightbulb")} Owner: clique **Aprovar** para creditar na hora.`));
      await interaction.update({ components:[panel], flags:V2 });
      return true;
    }
    if(cid.startsWith("saldo:topup:approve:")){
      const topupId=cid.split(":")[3];
      const pre = saldoStore.getTopup(topupId);
      if(!pre){ await interaction.reply({ content:"Recarga não encontrada.", flags:MessageFlags.Ephemeral }); return true; }
      const isOwner = botOwnerIds(interaction.guild).includes(interaction.user.id) || interaction.memberPermissions?.has(require("discord.js").PermissionFlagsBits.Administrator) || hasBotPermission(interaction);
      if(!isOwner){
        await interaction.reply({ content:"Somente owner/admin pode aprovar.", flags:MessageFlags.Ephemeral });
        return true;
      }
      if(pre.status==="approved"){
        await interaction.reply({ content:"Já aprovado.", flags:MessageFlags.Ephemeral });
        return true;
      }
      const resultWrap = await saldoStore.approveTopupAtomic(topupId, interaction.user.id);
      if(!resultWrap?.ok){
        await interaction.reply({ content: resultWrap?.reason || "Falha ao aprovar. Tente novamente.", flags:MessageFlags.Ephemeral });
        return true;
      }
      const result = { before: resultWrap.before, after: resultWrap.after, bonus: resultWrap.bonus, totalAdd: resultWrap.totalAdd };
      const topup = resultWrap.topup;
      const panel=new ContainerBuilder().setAccentColor(0x2ecc71);
      try{
        const sec=new SectionBuilder()
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`## ${inlineEmoji(client,"positivo")} Saldo creditado com sucesso!`),
            new TextDisplayBuilder().setContent(`### ${inlineEmoji(client,"carteira")} \`${formatBRL(result.totalAdd)}\` creditados`),
            new TextDisplayBuilder().setContent(`-# Aprovado por <@${interaction.user.id}> • <t:${Math.floor(Date.now()/1000)}:F>`)
          );
        const u = await client.users.fetch(topup.userId).catch(()=>null);
        const av = u?.displayAvatarURL({extension:"png",size:64});
        if(av) sec.setThumbnailAccessory(new ThumbnailBuilder().setURL(av).setDescription("User"));
        panel.addSectionComponents(sec);
      }catch{
        panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client,"positivo")} Saldo creditado!`));
      }
      panel.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
      const pct = topup.amount ? Math.round((result.bonus/Number(topup.amount))*100) : 0;
      panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `${inlineEmoji(client,"pricep")} **Pago:** \`${formatBRL(topup.amount)}\` • ${inlineEmoji(client,"gift")} **Bônus:** \`${formatBRL(result.bonus)}\` (${pct}%)\n`+
        `${inlineEmoji(client,"carteira")} **Total:** \`${formatBRL(result.totalAdd)}\` → **Saldo atual:** \`${formatBRL(result.after)}\`\n`+
        `${inlineEmoji(client,"users")} **Usuário:** <@${topup.userId}> • #\`${topupId.slice(-6)}\`\n\n`+
        `${inlineEmoji(client,"sparkles")} Seu saldo já está **pronto para usar** nos produtos da loja!`
      ));
      panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
      panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${inlineEmoji(client,"clock")} Esta thread fecha em **2 minutos** • Use \`/saldo\` para ver o extrato`));
      await interaction.update({ components:[panel], flags:V2 });
      try{
        const u = await client.users.fetch(topup.userId).catch(()=>null);
        if(u){
          const dmPanel=new ContainerBuilder().setAccentColor(0x2ecc71);
          dmPanel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client,"positivo")} Recarga aprovada!\n\`${formatBRL(result.totalAdd)}\` creditados • Saldo atual \`${formatBRL(result.after)}\``));
          await u.send({ components:[dmPanel], flags:V2 }).catch(()=>null);
        }
      }catch{}
      try{
        const { sendSalesLog } = require("../sales");
      }catch{}
      setTimeout(()=>{ interaction.channel?.delete("Recarga concluída").catch(()=>null); }, 2*60*1000);
      return true;
    }
  }catch(e){
    console.error("[Saldo interaction]", e);
    if(interaction.isRepliable() && !interaction.replied && !interaction.deferred){
      await interaction.reply({ content:`Erro: ${e.message}`, flags: MessageFlags.Ephemeral }).catch(()=>null);
    }
  }
  return false;
}
module.exports = {
  saldoConfigPanel, saldoExtrasPanel, bonusModal,
  walletContainer, extratoContainer, painelSaldoContainer,
  handleSaldoCommand, handlePainelSaldoCommand,
  handleSaldoPanelComponent, handleSaldoModal, handleSaldoInteraction,
  isEnabled: ()=>saldoStore.isEnabled()
};
