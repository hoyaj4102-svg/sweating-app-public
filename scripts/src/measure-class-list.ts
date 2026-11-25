import { measureClassList, parseCli } from "./class-list-timing.ts";

function invokedAsCli(): boolean {
  const entry = process.argv[1] ?? "";
  return entry.endsWith("measure-class-list.ts") || entry.endsWith("measure-class-list.mjs");
}

export async function main(argv: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
  const options = parseCli(argv, env);
  const report: { before?: unknown; after?: unknown } = {};
  let unknown = false;
  if (options.before) {
    report.before = await measureClassList(options.before, { samples: options.samples, pauseMs: 50 });
    if ((report.before as { outcome?: string }).outcome !== "measured") unknown = true;
  }
  if (options.after) {
    report.after = await measureClassList(options.after, { samples: options.samples, pauseMs: 50 });
    if ((report.after as { outcome?: string }).outcome !== "measured") unknown = true;
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return unknown ? 2 : 0;
}

if (invokedAsCli()) {
  main(process.argv.slice(2), process.env).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      const message = error instanceof Error ? error.message : "Measurement failed.";
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    },
  );
}
