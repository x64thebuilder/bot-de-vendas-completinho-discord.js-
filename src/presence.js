const { ActivityType, PresenceUpdateStatus } = require("discord.js");
const DEFAULT_ACTIVITY_NAME = "/panel";
function applyPresence(client) {
  client.user.setPresence({
    status: PresenceUpdateStatus.Online,
    activities: [
      {
        name: DEFAULT_ACTIVITY_NAME,
        type: ActivityType.Streaming,
        url: "https://www.twitch.tv/discord"
      }
    ]
  });
}
module.exports = {
  applyPresence
};
