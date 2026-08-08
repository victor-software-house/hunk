/** Quote one argv value for the shell that drives the test-only PTY wrapper. */
export function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Build a bounded cross-platform terminal transcript command. */
export function createTerminalTranscriptCommand({
  command,
  transcript,
  timeoutSeconds,
}: {
  command: string;
  transcript: string;
  timeoutSeconds: number;
}) {
  return process.platform === "darwin"
    ? `timeout ${timeoutSeconds} script -q -F ${shellQuote(transcript)} bash -lc ${shellQuote(command)}`
    : `timeout ${timeoutSeconds} script -q -f -e -c ${shellQuote(command)} ${shellQuote(transcript)}`;
}

/**
 * Build a bounded `script` invocation for a real terminal session test.
 *
 * macOS ships BSD `script`, whose command follows the transcript path; Linux
 * uses util-linux `script`, whose command is passed with `-c`.
 */
export function createScriptedTerminalTestCommand({
  argv,
  transcript,
  quitAfterSeconds,
  timeoutSeconds,
}: {
  argv: readonly string[];
  transcript: string;
  quitAfterSeconds: number;
  timeoutSeconds: number;
}) {
  const command = argv.map(shellQuote).join(" ");
  const scriptCommand = createTerminalTranscriptCommand({ command, transcript, timeoutSeconds });

  return `(sleep ${quitAfterSeconds}; printf q) | ${scriptCommand}`;
}
