const { readGuildFile, writeGuildFile } = require("./guildDb");
const DEFAULT_CONFIG = {
  channels: {
    generalLogs: null,
    moderationLogs: null,
    messageLogs: null,
    middlemanLogs: null,
    inviteLogs: null,
    systemLogs: null,
    productRequestLogs: null,
    verificationLogs: null
  },
  roles: {
    admin: null,
    autoRole: null,
    middleman: null,
    trader: null
  },
  permissions: {
    users: []
  },
  payments: {
    pix: {
      enabled: false,
      key: null,
      type: "email"
    },
    mercadoPago: {
      enabled: false,
      accessToken: null,
      payerEmail: "comprador@example.com"
    },
    efi: {
      enabled: false,
      clientId: null,
      clientSecret: null,
      certificatePath: null,
      certificatePassphrase: null,
      pixKey: null,
      pendingCertificateUserId: null,
      pendingCertificateChannelId: null,
      pendingCertificateAt: null
    },
    stripe: {
      enabled: false,
      secretKey: null,
      webhookSecret: null,
      currency: "brl"
    }
  },
  suggestions: {
    enabled: true,
    channelId: null,
    autoThread: true
  },
  customColor: null,
  botOwnerId: null,
  moderation: {
    violations: [],
    restorationRequested: false,
    restorationUsed: false
  },
  middleman: {
    enabled: false,
    mode: "manual",
    color: 0xffffff,
    description: "Solicite um middleman seguro para sua trade PIX.",
    banner: null,
    thumbnail: null,
    fees: "default",
    feeRules: [
      { above: 2.5, type: "fixed", value: 1 },
      { above: 100, type: "fixed", value: 2.15 },
      { above: 200, type: "fixed", value: 4.3 },
      { above: 400, type: "fixed", value: 6.8 },
      { above: 700, type: "percent", value: 1.2 }
    ],
    accountExtraFee: 4,
    vouchChannel: null,
    bigVouchChannel: null
  },
  storeClosed: false,
  storeHours: {
    enabled: false,
    open: "09:00",
    close: "18:00",
    days: [1, 2, 3, 4, 5],
    timezone: "America/Sao_Paulo"
  },
  sales: {
    cartLogsEnabled: true,
    closed: false,
    receiptMode: "container",
    qrStyle: { color: "#10b981" },
    channels: {
      privateLogs: null,
      publicLogs: null,
      orderLogs: null,
      paymentLogs: null,
      confirmedLogs: null,
      approvedLogs: null,
      deliveredLogs: null,
      cancelledLogs: null,
      errorLogs: null,
      cartsCategory: null,
      feedbackChannel: null
    },
    roles: {
      staff: null,
      customer: null
    }
  },
  reestock: {
    channelId: null,
    mode: "container"
  },
  tickets: {
    channels: {
      logs: null
    },
    roles: {
      support: null
    }
  },
  automation: {
    autoMessages: {
      enabled: false,
      messages: {}
    },
    autoReact: {
      channels: {}
    },
    repost: {
      enabled: false,
      time: "06:00",
      nuke: false,
      systems: {
        sales: true,
        middleman: false,
        tickets: false
      }
    }
  },
  vorkbux: {
    pricePer1000: 0,
    minRobux: 100,
    maxRobux: 10000,
    group: {
      url: null,
      pricePer1000: 0,
      stock: 0
    },
    purchase: {
      mode: "container",
      title: null,
      description: null,
      color: 0xffffff,
      banner: null,
      thumbnail: null,
      channelId: null
    }
  }
};
function readGuildDb(_guildId) {
  return readGuildFile(null, "config", () => ({}));
}
function writeGuildDb(_guildId, data) {
  writeGuildFile(null, "config", data);
}
function mergeDefaults(config = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...config,
    channels: { ...DEFAULT_CONFIG.channels, ...config.channels },
    roles: { ...DEFAULT_CONFIG.roles, ...config.roles },
    permissions: {
      ...DEFAULT_CONFIG.permissions,
      ...config.permissions,
      users: Array.isArray(config.permissions?.users) ? config.permissions.users : []
    },
    payments: {
      pix: {
        ...DEFAULT_CONFIG.payments.pix,
        ...config.payments?.pix
      },
      mercadoPago: {
        ...DEFAULT_CONFIG.payments.mercadoPago,
        ...config.payments?.mercadoPago
      },
      efi: {
        ...DEFAULT_CONFIG.payments.efi,
        ...config.payments?.efi
      },
      stripe: {
        ...DEFAULT_CONFIG.payments.stripe,
        ...config.payments?.stripe,
        currency: ["brl", "usd"].includes(config.payments?.stripe?.currency) ? config.payments.stripe.currency : DEFAULT_CONFIG.payments.stripe.currency
      }
    },
    suggestions: {
      ...DEFAULT_CONFIG.suggestions,
      ...config.suggestions
    },
    storeHours: {
      enabled: Boolean(config.storeHours?.enabled ?? false),
      open: typeof config.storeHours?.open === "string" ? config.storeHours.open : DEFAULT_CONFIG.storeHours.open,
      close: typeof config.storeHours?.close === "string" ? config.storeHours.close : DEFAULT_CONFIG.storeHours.close,
      days: Array.isArray(config.storeHours?.days) ? config.storeHours.days : DEFAULT_CONFIG.storeHours.days,
      timezone: typeof config.storeHours?.timezone === "string" ? config.storeHours.timezone : DEFAULT_CONFIG.storeHours.timezone
    },
    storeClosed: Boolean(config.storeClosed ?? config.sales?.closed ?? false),
    customColor: typeof config.customColor === "number" ? config.customColor : DEFAULT_CONFIG.customColor,
    botOwnerId: config.botOwnerId || null,
    moderation: {
      restorationRequested: Boolean(config.moderation?.restorationRequested),
      restorationUsed: Boolean(config.moderation?.restorationUsed),
      violations: Array.isArray(config.moderation?.violations) ? config.moderation.violations : []
    },
    middleman: {
      ...DEFAULT_CONFIG.middleman,
      ...config.middleman,
      feeRules: Array.isArray(config.middleman?.feeRules)
        ? config.middleman.feeRules
        : DEFAULT_CONFIG.middleman.feeRules
    },
    sales: {
      ...DEFAULT_CONFIG.sales,
      ...config.sales,
      closed: Boolean(config.sales?.closed ?? config.storeClosed ?? false),
      channels: {
        ...DEFAULT_CONFIG.sales.channels,
        ...config.sales?.channels
      },
      roles: {
        ...DEFAULT_CONFIG.sales.roles,
        ...config.sales?.roles
      }
    },
    reestock: {
      ...DEFAULT_CONFIG.reestock,
      ...config.reestock
    },
    tickets: {
      ...DEFAULT_CONFIG.tickets,
      ...config.tickets,
      channels: {
        ...DEFAULT_CONFIG.tickets.channels,
        ...config.tickets?.channels
      },
      roles: {
        ...DEFAULT_CONFIG.tickets.roles,
        ...config.tickets?.roles
      }
    },
    automation: {
      ...DEFAULT_CONFIG.automation,
      ...config.automation,
      autoMessages: {
        ...DEFAULT_CONFIG.automation.autoMessages,
        ...config.automation?.autoMessages,
        messages: config.automation?.autoMessages?.messages && typeof config.automation.autoMessages.messages === "object"
          ? config.automation.autoMessages.messages
          : {}
      },
      autoReact: {
        ...DEFAULT_CONFIG.automation.autoReact,
        ...config.automation?.autoReact,
        channels: config.automation?.autoReact?.channels && typeof config.automation.autoReact.channels === "object"
          ? config.automation.autoReact.channels
          : {}
      },
      repost: {
        ...DEFAULT_CONFIG.automation.repost,
        ...config.automation?.repost,
        systems: {
          ...DEFAULT_CONFIG.automation.repost.systems,
          ...(config.automation?.repost?.systems || {})
        }
      }
    },
    vorkbux: {
      ...DEFAULT_CONFIG.vorkbux,
      ...config.vorkbux,
      pricePer1000: Number(config.vorkbux?.pricePer1000) || 0,
      minRobux: Number(config.vorkbux?.minRobux) || 100,
      maxRobux: Number(config.vorkbux?.maxRobux) || 10000,
      group: {
        ...DEFAULT_CONFIG.vorkbux.group,
        ...config.vorkbux?.group,
        pricePer1000: Number(config.vorkbux?.group?.pricePer1000) || 0,
        stock: Number(config.vorkbux?.group?.stock) || 0
      },
      purchase: {
        ...DEFAULT_CONFIG.vorkbux.purchase,
        ...config.vorkbux?.purchase,
        mode: ["container","embed","message"].includes(config.vorkbux?.purchase?.mode) ? config.vorkbux.purchase.mode : "container",
        color: typeof config.vorkbux?.purchase?.color === "number" ? config.vorkbux.purchase.color : 0xffffff
      }
    }
  };
}
function getGuildConfig(_guildId) {
  return mergeDefaults(readGuildDb(null));
}
function setGuildConfig(_guildId, updater) {
  const current = mergeDefaults(readGuildDb(null));
  const next = typeof updater === "function" ? updater(current) : updater;
  const merged = mergeDefaults(next);
  writeGuildDb(null, merged);
  return merged;
}
function isStoreOpen(_guildId) {
  const cfg = getGuildConfig(_guildId);
  if (cfg.storeClosed) return { open: false, reason: "Loja fechada manualmente" };
  if (!cfg.storeHours.enabled) return { open: true };
  try {
    const now = new Date();
    const tz = cfg.storeHours.timezone || "America/Sao_Paulo";
    const timeStr = now.toLocaleTimeString("en-GB", { timeZone: tz, hour12: false, hour: "2-digit", minute: "2-digit" });
    const localDay = new Date(now.toLocaleString("en-US", { timeZone: tz })).getDay();
    if (!cfg.storeHours.days.includes(localDay)) return { open: false, reason: `Fechado hoje (dia ${localDay})` };
    const [oh, om] = cfg.storeHours.open.split(":").map(Number);
    const [ch, cm] = cfg.storeHours.close.split(":").map(Number);
    const [nh, nm] = timeStr.split(":").map(Number);
    const openMin = oh * 60 + om;
    const closeMin = ch * 60 + cm;
    const nowMin = nh * 60 + nm;
    const isOpen = closeMin > openMin ? (nowMin >= openMin && nowMin < closeMin) : (nowMin >= openMin || nowMin < closeMin);
    return { open: isOpen, reason: isOpen ? "Aberto" : `Fora do horário ${cfg.storeHours.open}–${cfg.storeHours.close}`, time: timeStr };
  } catch {
    return { open: true };
  }
}
function getConfig() {
  return getGuildConfig(null);
}
function setConfig(updater) {
  return setGuildConfig(null, updater);
}
module.exports = {
  DEFAULT_CONFIG,
  getGuildConfig,
  setGuildConfig,
  getConfig,
  setConfig,
  isStoreOpen,
};
