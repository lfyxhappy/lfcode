import { EOL } from "os"
import { cancelBackgroundJob, reconcileBackgroundJob, reconcileRunningBackgroundJobs } from "@/background-job/control"
import { BackgroundJobPersistence } from "@/background-job/persistence"
import { SessionID } from "@/session/schema"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"

const BackgroundJobListCommand = cmd({
  command: "list",
  describe: "list durable background jobs",
  builder: (yargs) =>
    yargs
      .option("session-id", {
        type: "string",
        description: "Filter by session id",
      })
      .option("status", {
        type: "string",
        choices: ["running", "completed", "failed", "cancelled"] as const,
        description: "Filter by durable status",
      }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const jobs = BackgroundJobPersistence.list({
        ...(args.sessionId ? { sessionID: SessionID.make(args.sessionId) } : {}),
        ...(args.status ? { status: args.status } : {}),
      })
      process.stdout.write(JSON.stringify(jobs, null, 2) + EOL)
    })
  },
})

const BackgroundJobGetCommand = cmd({
  command: "get <job-id>",
  describe: "read one durable background job entry",
  builder: (yargs) =>
    yargs.positional("job-id", {
      type: "string",
      demandOption: true,
      description: "Background job id",
    }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const job = BackgroundJobPersistence.load(args.jobId)
      process.stdout.write(JSON.stringify(job ?? null, null, 2) + EOL)
    })
  },
})

const BackgroundJobLogsCommand = cmd({
  command: "logs <job-id>",
  describe: "read durable background job log chunks",
  builder: (yargs) =>
    yargs
      .positional("job-id", {
        type: "string",
        demandOption: true,
        description: "Background job id",
      })
      .option("after-seq", {
        type: "number",
        description: "Return log rows with sequence greater than this value",
      }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const logs = BackgroundJobPersistence.listLogs({
        jobID: args.jobId,
        ...(args.afterSeq !== undefined ? { afterSeq: args.afterSeq } : {}),
      })
      process.stdout.write(JSON.stringify(logs, null, 2) + EOL)
    })
  },
})

const BackgroundJobCancelCommand = cmd({
  command: "cancel <job-id>",
  describe: "attempt to cancel one durable background job",
  builder: (yargs) =>
    yargs.positional("job-id", {
      type: "string",
      demandOption: true,
      description: "Background job id",
    }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const result = cancelBackgroundJob(args.jobId, "debug-cli")
      process.stdout.write(JSON.stringify(result, null, 2) + EOL)
    })
  },
})

const BackgroundJobReconcileCommand = cmd({
  command: "reconcile [job-id]",
  describe: "reconcile stale durable running jobs against tracked pids",
  builder: (yargs) =>
    yargs.positional("job-id", {
      type: "string",
      description: "Background job id. Omit to sweep all durable jobs still marked running.",
    }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const result = args.jobId ? reconcileBackgroundJob(args.jobId, "debug-cli") : reconcileRunningBackgroundJobs("debug-cli")
      process.stdout.write(JSON.stringify(result, null, 2) + EOL)
    })
  },
})

export const BackgroundJobCommand = cmd({
  command: "background-job",
  describe: "inspect durable background-job ledger state",
  builder: (yargs) =>
    yargs
      .command(BackgroundJobListCommand)
      .command(BackgroundJobGetCommand)
      .command(BackgroundJobLogsCommand)
      .command(BackgroundJobCancelCommand)
      .command(BackgroundJobReconcileCommand)
      .demandCommand(),
  async handler() {},
})
