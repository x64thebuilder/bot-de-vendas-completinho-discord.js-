"use strict";
function editProductChoiceOption() {
  return null;
}
function productPanelExtras() {
  return { active: false, line: null };
}
function isActive() {
  return false;
}
function getProductRoblox() {
  return { active: false, game: null, category: null, items: {} };
}
function consumeItemsStock() {
  return { ok: false, insufficient: [] };
}
function hasAnyStock() {
  return false;
}
function robloxEntryPanel() {
  return null;
}
function robloxPanelPayload(component) {
  return { components: component ? [component] : [] };
}
async function handleRobloxPanelComponent() {
  return false;
}
async function handleRobloxModal() {
  return false;
}
async function handleRobloxPublicAction() {
  return false;
}
async function handleBuyClick(interaction) {
  try {
    const { MessageFlags } = require("discord.js");
    await interaction.reply({
      content: "O sistema de itens Roblox foi desativado neste bot.",
      flags: MessageFlags.Ephemeral
    }).catch(() => null);
  } catch {   }
  return true;
}
function buildDeliveryStaffMessage() {
  return { content: "Pedido Roblox legado — sistema de itens removido." };
}
async function handleRobloxMessage() {
  return false;
}
module.exports = {
  editProductChoiceOption,
  productPanelExtras,
  isActive,
  getProductRoblox,
  consumeItemsStock,
  hasAnyStock,
  robloxEntryPanel,
  robloxPanelPayload,
  handleRobloxPanelComponent,
  handleRobloxModal,
  handleRobloxPublicAction,
  handleBuyClick,
  buildDeliveryStaffMessage,
  handleRobloxMessage
};
