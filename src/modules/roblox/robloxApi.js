async function lookupRobloxUser(username) {
  const clean = String(username || "").trim();
  if (!clean) return null;
  const response = await fetch("https://users.roblox.com/v1/usernames/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usernames: [clean], excludeBannedUsers: false }),
    signal: AbortSignal.timeout(8000)
  }).catch(() => null);
  if (!response || !response.ok) return null;
  const payload = await response.json().catch(() => null);
  const user = payload?.data?.[0];
  if (!user) return null;
  const avatarUrl = await fetchAvatarThumbnail(user.id);
  return {
    id: user.id,
    username: user.name,
    displayName: user.displayName || user.name,
    hasVerifiedBadge: Boolean(user.hasVerifiedBadge),
    avatarUrl
  };
}
async function fetchAvatarThumbnail(userId) {
  const url = `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=420x420&format=Png&isCircular=false`;
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!response || !response.ok) return null;
  const payload = await response.json().catch(() => null);
  return payload?.data?.[0]?.imageUrl || null;
}
module.exports = {
  lookupRobloxUser
};
