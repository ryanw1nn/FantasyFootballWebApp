// League passphrases, hashed with scrypt from node:crypto — no native build and
// no dependency. The server and db/passphrase.mjs both import this file, so
// there is exactly one way a hash is made and one way it is checked.
//
// A stored hash carries its own parameters:
//
//   scrypt$<N>$<r>$<p>$<salt>$<hash>        salt and hash in base64url
//
// so raising the cost later only affects new hashes; existing ones still verify
// with the parameters they were made with.
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

/**
 * One of OWASP's equivalent scrypt minimums. OWASP rates it level with N=2^17,
 * p=1, but it needs 32 MB per check instead of 128 MB, which matters on a 512 MB host.
 */
const COST = { N: 2 ** 15, r: 8, p: 3 };
const SALT_BYTES = 16;
const KEY_BYTES = 64;

export const MIN_LENGTH = 12;
export const MAX_LENGTH = 200;

/**
 * Upper bounds on what a stored hash may ask for. The column is trusted, but a
 * corrupted row should fail verification rather than allocate gigabytes.
 */
const MAX_N = 2 ** 20;
const MAX_R = 32;
const MAX_P = 16;

const FORMAT = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/;

/**
 * Checked against when a league has no hash, so "no passphrase set" takes as
 * long as a wrong guess and the two cannot be told apart. Its preimage was
 * random bytes that were never stored; verification against it is discarded
 * regardless.
 */
const DUMMY_HASH =
  "scrypt$32768$8$3$xEq-uw3nptDFqbDsjL31nw$" +
  "S0N8x_shFqW3D8ZSc8M6BgZc_Hxu-ttEpKcoV1gK1p4bGBwQZrg6qvAa1gVjO0HNsGfXHB_qOIT2p11VGK2Uzg";

/** Same bytes for the same text, however the keyboard composed its accents. */
function normalize(passphrase) {
  return passphrase.normalize("NFC");
}

/** scrypt needs 128·N·r bytes; Node's default ceiling is 32 MB. */
function derive(passphrase, salt, keyBytes, { N, r, p }) {
  return scrypt(normalize(passphrase), salt, keyBytes, { N, r, p, maxmem: 256 * N * r });
}

function parse(stored) {
  const match = typeof stored === "string" ? FORMAT.exec(stored) : null;
  if (!match) return null;

  const [N, r, p] = match.slice(1, 4).map(Number);
  const isPowerOfTwo = N > 1 && (N & (N - 1)) === 0;
  if (!isPowerOfTwo || N > MAX_N || r < 1 || r > MAX_R || p < 1 || p > MAX_P) return null;

  const salt = Buffer.from(match[4], "base64url");
  const hash = Buffer.from(match[5], "base64url");
  if (salt.length === 0 || hash.length === 0) return null;

  return { cost: { N, r, p }, salt, hash };
}

/** Why a passphrase would be refused, or null if it is acceptable. */
export function passphraseProblem(passphrase) {
  if (typeof passphrase !== "string") return "must be text";
  const length = [...normalize(passphrase)].length;
  if (length < MIN_LENGTH) return `must be at least ${MIN_LENGTH} characters`;
  if (length > MAX_LENGTH) return `must be at most ${MAX_LENGTH} characters`;
  return null;
}

export async function hashPassphrase(passphrase) {
  const problem = passphraseProblem(passphrase);
  if (problem) throw new Error(`Passphrase ${problem}`);

  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(passphrase, salt, KEY_BYTES, COST);
  const { N, r, p } = COST;
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

/**
 * True only when the passphrase matches a well-formed stored hash. A missing or
 * malformed hash is checked against DUMMY_HASH and then refused, so it costs the
 * same as a wrong passphrase and never authorizes anything.
 */
export async function verifyPassphrase(passphrase, stored) {
  const parsed = parse(stored);
  const target = parsed ?? parse(DUMMY_HASH);
  const candidate = typeof passphrase === "string" ? passphrase : "";

  const derived = await derive(candidate, target.salt, target.hash.length, target.cost);
  const matches = timingSafeEqual(derived, target.hash);

  return parsed !== null && matches;
}
