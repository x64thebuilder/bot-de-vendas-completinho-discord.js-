const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const commands = [
  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("[🏠] Abra o painel de configuração do bot")
    .setDMPermission(false)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("perms")
    .setDescription("[🔑] Gerencie usuários com permissão total no bot")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("vercompras")
    .setDescription("[🛍️] Veja suas compras e middlemans concluídos")
    .setDMPermission(false)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("rank")
    .setDescription("[🏆] Veja o ranking de usuários que mais gastaram")
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName("filtro")
        .setDescription("Tipo de ranking")
        .setRequired(false)
        .addChoices(
          { name: "Tudo", value: "all" },
          { name: "Sales", value: "sales" },
          { name: "Middleman", value: "middleman" }
        )
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("convites")
    .setDescription("[📨] Veja seus convites no servidor")
    .setDMPermission(false)
    .addUserOption((option) =>
      option
        .setName("usuario")
        .setDescription("Usuario para consultar")
        .setRequired(false)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("rank_invites")
    .setDescription("[📈] Veja o ranking de convites do servidor")
    .setDMPermission(false)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("nuke")
    .setDescription("[💣] Apaga e recria este canal do zero, limpando todo o histórico")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("clear")
    .setDescription("[🧹] Apaga uma quantidade de mensagens deste canal")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false)
    .addIntegerOption((option) =>
      option
        .setName("quantidade")
        .setDescription("Quantidade de mensagens para apagar (1 a 99)")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(99)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("lock")
    .setDescription("[🔒] Bloqueia este canal, impedindo o envio de mensagens")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName("motivo")
        .setDescription("Motivo do bloqueio")
        .setRequired(false)
        .setMaxLength(512)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("unlock")
    .setDescription("[🔓] Desbloqueia este canal, liberando o envio de mensagens")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName("motivo")
        .setDescription("Motivo do desbloqueio")
        .setRequired(false)
        .setMaxLength(512)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("[🔨] Bane um usuário do servidor")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setDMPermission(false)
    .addUserOption((option) =>
      option
        .setName("usuario")
        .setDescription("Usuário que será banido")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("motivo")
        .setDescription("Motivo do banimento")
        .setRequired(false)
        .setMaxLength(512)
    )
    .addIntegerOption((option) =>
      option
        .setName("apagar_mensagens")
        .setDescription("Apagar mensagens dos últimos X dias (0 a 7)")
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(7)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("unban")
    .setDescription("[🔓] Remove o banimento de um usuário")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setDMPermission(false)
    .addUserOption((option) =>
      option
        .setName("usuario")
        .setDescription("Usuário que será desbanido (pode ser um ID)")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("motivo")
        .setDescription("Motivo do desbanimento")
        .setRequired(false)
        .setMaxLength(512)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("solicitar-produto")
    .setDescription("[📦] Solicitar um novo produto ou reposição de estoque (owners)")
    .setDMPermission(false)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("backup")
    .setDescription("[💾] Crie, liste ou restaure backups completos do servidor")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("qrcode-personalizar")
    .setDescription("[🎨] Gere um QR Code com logo e cor (vira padrão da loja)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addStringOption((o) =>
      o.setName("texto")
        .setDescription("Texto ou código Pix do QR")
        .setRequired(true)
        .setMaxLength(2000)
    )
    .addAttachmentOption((o) =>
      o.setName("imagem")
        .setDescription("Logo PNG/JPG para o meio")
        .setRequired(false)
    )
    .addStringOption((o) =>
      o.setName("cor")
        .setDescription("Cor em RGB ex: 255,0,0")
        .setRequired(false)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("encerrar-sorteio")
    .setDescription("[🎉] Encerra um sorteio ativo anunciando o ganhador")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("perfil")
    .setDescription("[👤] Veja o perfil completo de um usuário (vendas e middleman)")
    .setDMPermission(false)
    .addUserOption(o => o.setName("usuario").setDescription("Usuário para ver o perfil").setRequired(false))
    .addStringOption(o => o.setName("id").setDescription("Ou informe o ID do usuário").setRequired(false))
    .toJSON(),
  new SlashCommandBuilder()
    .setName("entregue")
    .setDescription("[✅] Confirme a entrega de Robux no carrinho atual")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("calcular")
    .setDescription("[🧮] Calcule o valor de Robux com e sem taxa")
    .setDMPermission(false)
    .addIntegerOption((o) =>
      o.setName("quantidade")
        .setDescription("Quantidade de Robux (ex: 1000)")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(1000000)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("saldo")
    .setDescription("[💳] Veja seu saldo e extrato")
    .setDMPermission(false)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("painel-saldo")
    .setDescription("[💰] Painel de saldo (owner)")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON()
];
async function registerCommands({ token, clientId, guildId, guildIds = [] }) {
  if (!token || !clientId) {
    throw new Error("Configure DISCORD_TOKEN e DISCORD_CLIENT_ID no arquivo .env.");
  }
  const validId = (id) => /^\d{15,25}$/.test(String(id));
  const targets = Array.from(new Set([guildId, ...guildIds].filter(Boolean).filter(validId)));
  const rest = new REST({ version: "10" }).setToken(token);
  try {
    if (!targets.length) {
      console.warn("[Comandos] AVISO: nenhum GUILD_ID válido — registrando globalmente (1h para propagar). Defina GUILD_ID no .env para instantâneo.");
      const registered = await rest.put(Routes.applicationCommands(clientId), { body: commands });
      return {
        scope: "globalmente",
        names: registered.map((command) => command.name)
      };
    }
    const results = [];
    for (const targetGuildId of targets) {
      const registered = await rest.put(Routes.applicationGuildCommands(clientId, targetGuildId), { body: commands });
      results.push({
        guildId: targetGuildId,
        names: registered.map((command) => command.name)
      });
    }
    try {
      await rest.put(Routes.applicationCommands(clientId), { body: [] });
    } catch {}
    return {
      scope: targets.length === 1 ? `servidor ${targets[0]}` : `${targets.length} servidores`,
      names: Array.from(new Set(results.flatMap((result) => result.names))),
      results
    };
  } catch (e) {
    const msg = e.status === 401 ? "TOKEN inválido" : e.status === 403 ? "Sem permissão (verifique CLIENT_ID e que o bot está no servidor)" : e.message;
    throw new Error(`Falha ao registrar comandos: ${msg}`);
  }
}
module.exports = {
  commands,
  registerCommands
};
