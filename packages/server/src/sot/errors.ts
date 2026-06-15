// Errors shared across source-of-truth backends.

/**
 * A live device query (NAPALM) could not reach the target device. Backends that
 * support live queries throw this when the device is unreachable; backends that
 * don't (e.g. Infrahub) throw it unconditionally. The route maps it to 503.
 */
export class NapalmUnreachableError extends Error {}
