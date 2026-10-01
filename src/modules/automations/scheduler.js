const { runScheduledTasks } = require("./index");
const TICK_INTERVAL_MS = 30_000;
let timer = null;
let running = false;
function start(client) {
  if (timer) return;
  console.log("[Automações] Scheduler iniciado.");
  timer = setInterval(() => {
    if (running) return;
    running = true;
    runScheduledTasks(client)
      .catch((error) => console.error("[Automações tick]", error))
      .finally(() => {
        running = false;
      });
  }, TICK_INTERVAL_MS);
}
function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}
module.exports = { start, stop };
