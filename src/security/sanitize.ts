const sensitiveKey =
  /(authorization|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|password|credential|cookie)/i;

export function sanitizeForLogging(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'string' ? redactKnownSecrets(value) : value;
  }
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeForLogging(item, seen));

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      sensitiveKey.test(key) ? '[REDACTED]' : sanitizeForLogging(item, seen),
    ]),
  );
}

function redactKnownSecrets(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, '[REDACTED KEY]');
}
