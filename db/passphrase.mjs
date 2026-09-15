// Sets a league's write passphrase.
//
//   npm run db:passphrase -- --league fan-club
//   npm run db:passphrase -- --league fan-club --yes     any host but localhost
//
// The passphrase is typed at a prompt, twice, and never echoed. It is never
// accepted as an argument: arguments land in shell history and in `ps` output
// that any other user on the machine can read. Only the scrypt hash is stored,
// in leagues.write_secret_hash, and nothing prints it.
//
// Replacing a passphrase does not sign anyone out. Unlocked sessions record the
// league, not the passphrase, so they stay unlocked until they expire or lock.
import { pool, describeTarget } from "./pool.mjs";
import { hashPassphrase, passphraseProblem } from "../server/passphrase.mjs";

const USAGE = `
  npm run db:passphrase -- --league <slug> [--yes]

    --league <slug>   the league to set. Required.
    --yes             required when the target is not localhost.

  The passphrase is prompted for. It is never taken as an argument.
`;

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const args = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--yes" || arg === "--help") {
      args[arg.slice(2)] = true;
    } else if (arg === "--league") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) fail("--league needs a value");
      args.league = value;
    } else if (arg.startsWith("--passphrase")) {
      fail("the passphrase is never taken as an argument — run without it and type it at the prompt");
    } else {
      fail(`unexpected argument "${arg}"`);
    }
  }

  return args;
}

/**
 * Reads one line from the terminal with echo off. Raw mode hands over every
 * keypress, so Enter, Backspace and Ctrl-C are handled here rather than by the
 * terminal.
 */
function promptHidden(question) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    let input = "";

    const finish = (error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      stdout.write("\n");
      if (error) reject(error);
      else resolve(input);
    };

    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") return finish();
        if (char === "") return finish(new Error("cancelled"));
        if (char === "" || char === "\b") input = [...input].slice(0, -1).join("");
        else if (char >= " ") input += char;
      }
    };

    // Echo goes off before the prompt appears, so nothing typed after it shows.
    stdin.setEncoding("utf8");
    stdin.setRawMode(true);
    stdout.write(question);
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function readNewPassphrase() {
  if (!process.stdin.isTTY) {
    fail("run this in a terminal — the passphrase is typed at a prompt, never piped in");
  }

  const passphrase = await promptHidden("New passphrase: ");
  const problem = passphraseProblem(passphrase);
  if (problem) fail(`passphrase ${problem}`);

  const again = await promptHidden("Same again:     ");
  if (again !== passphrase) fail("the two entries did not match");

  return passphrase;
}

let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (err) {
  console.error(`\n${err.message}\n${USAGE}`);
  process.exit(1);
}

if (args.help || args.league === undefined) {
  console.log(USAGE);
  process.exit(args.help ? 0 : 1);
}

const target = describeTarget();

try {
  // Production is one env var away. Local stays one command; anything else asks.
  const isLocal = target.startsWith("localhost:") || target.startsWith("127.0.0.1:");
  if (!isLocal && !args.yes) {
    fail(`${target} is not the local container. Re-run with --yes to set a passphrase there.`);
  }

  console.log(`${target}\n`);

  // Checked before the prompt, so a mistyped slug does not cost a passphrase.
  const { rows } = await pool.query(
    `SELECT name, write_secret_hash IS NOT NULL AS has_passphrase FROM leagues WHERE slug = $1`,
    [args.league]
  );
  if (rows.length === 0) fail(`no league with slug "${args.league}"`);

  const [league] = rows;
  console.log(
    `  ${league.name} (${args.league}) — ` +
      (league.has_passphrase ? "has a passphrase, which this replaces" : "no passphrase yet")
  );

  const hash = await hashPassphrase(await readNewPassphrase());

  await pool.query(`UPDATE leagues SET write_secret_hash = $1 WHERE slug = $2`, [hash, args.league]);

  console.log(`\n  Passphrase ${league.has_passphrase ? "replaced" : "set"} for ${args.league}.\n`);
} catch (err) {
  console.error(`\nNothing changed: ${err.message}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
