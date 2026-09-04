// Engångskörning av nattens auto-assign — samma kod som cron:en använder.
// Kör: NODE_OPTIONS="--conditions=react-server" npx tsx --env-file=.env.local scripts/run-auto-assign.ts
import { autoAssignAllAccounts } from "../src/lib/adsets/auto-assign";

autoAssignAllAccounts().then((r) => {
  console.log(JSON.stringify(r, null, 2));
}).catch((e) => {
  console.error("FEL:", e);
  process.exit(1);
});
