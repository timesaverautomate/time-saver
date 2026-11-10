export async function cleanupSecurity(db, now = Date.now()) {
  await db.batch([
    db.prepare('DELETE FROM security_state WHERE expires <= ?').bind(now),
    db.prepare('DELETE FROM submission_locks WHERE expires <= ?').bind(now)
  ]);
}
export async function takeRate(db, key, maximum, expires, now = Date.now()) {
  const result = await db.prepare(`INSERT INTO security_state(key,value,expires) VALUES (?, '1', ?)
    ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1
    WHERE CAST(value AS INTEGER) < ? RETURNING value`).bind(key, expires, maximum).first();
  return Boolean(result);
}
export async function claimSubmission(db, key, fingerprint, now = Date.now()) {
  const reference = `TS-${crypto.randomUUID().toUpperCase()}`;
  const inserted = await db.prepare(`INSERT INTO submission_locks(key,fingerprint,reference,state,lease,expires,created)
    VALUES (?, ?, ?, 'sending', ?, ?, ?) ON CONFLICT DO NOTHING RETURNING *`)
    .bind(key, fingerprint, reference, now + 30_000, now + 23 * 3_600_000, now).first();
  if (inserted) return { owned:true, record:inserted };
  const existing = await db.prepare('SELECT * FROM submission_locks WHERE key = ? OR fingerprint = ? LIMIT 1').bind(key, fingerprint).first();
  if (!existing) throw new Error('lock_unavailable');
  if (existing.fingerprint !== fingerprint) return { owned:false, conflict:true, record:existing };
  if (existing.state === 'accepted' || existing.state === 'rejected') return { owned:false, record:existing };
  const retry = await db.prepare(`UPDATE submission_locks SET state = 'sending', lease = ?
    WHERE key = ? AND (state = 'retry' OR (state = 'sending' AND lease <= ?)) RETURNING *`)
    .bind(now + 30_000, existing.key, now).first();
  return { owned:Boolean(retry), record:retry || existing };
}
export async function markSubmission(db, key, state) {
  await db.prepare('UPDATE submission_locks SET state = ? WHERE key = ?').bind(state,key).run();
}
