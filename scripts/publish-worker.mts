// Safety net for Upload-to-Meta jobs: run whatever is due. Scheduled every
// five minutes on GitHub (needs DATABASE_URL + TOKEN_ENCRYPTION_KEY; the Meta
// token lives in the database). Locally:
//   node --env-file=.env.local --import tsx scripts/publish-worker.mts
import { resumeRunnable } from "../src/lib/publish/engine";
const jobs = await resumeRunnable(4 * 60 * 1000, 20);
if (jobs.length === 0) console.log("no jobs due");
for (const j of jobs) console.log(`${j.id.slice(0, 8)} ${j.assignmentId.slice(0, 8)} → ${j.status} @ ${j.step}${j.lastError ? ` (${j.lastError.slice(0, 120)})` : ""}`);
process.exit(0);
