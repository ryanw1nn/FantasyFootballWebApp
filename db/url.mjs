/**
 * pg currently treats sslmode=require as verify-full, but pg v9 will adopt
 * libpq semantics, where require skips certificate verification entirely. Say
 * verify-full explicitly so the upgrade cannot quietly weaken the connection.
 *
 * URLs without an sslmode — the local container — are returned unchanged.
 */
export function pinTlsVerification(connectionString) {
  return connectionString.replace(
    /([?&]sslmode=)(require|prefer|verify-ca)\b/,
    "$1verify-full"
  );
}
