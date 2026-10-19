// ===========================================================================
// Presence — in-memory registry of who is currently connected.
//
// A user can have several sockets open (phone + web), so we ref-count
// connections. When the last socket drops we record `lastSeen`, which the
// disconnect handler persists on the User document.
// ===========================================================================

const connections = new Map(); // userId -> number of open sockets
const lastSeen = new Map(); // userId -> Date of most recent disconnect

function key(userId) {
  return String(userId || '');
}

export function isOnline(userId) {
  return (connections.get(key(userId)) || 0) > 0;
}

export function getLastSeen(userId) {
  return lastSeen.get(key(userId)) || null;
}

// Returns true when this connection brought the user online (first socket).
export function addConnection(userId) {
  const id = key(userId);
  if (!id) return false;
  const next = (connections.get(id) || 0) + 1;
  connections.set(id, next);
  return next === 1;
}

// Returns the disconnect time when the last socket closed, otherwise null.
export function removeConnection(userId) {
  const id = key(userId);
  const next = Math.max(0, (connections.get(id) || 0) - 1);
  if (next === 0) {
    connections.delete(id);
    const at = new Date();
    lastSeen.set(id, at);
    return at;
  }
  connections.set(id, next);
  return null;
}

// Snapshot for a set of user ids — used to answer `presence:query`.
export function presenceSnapshot(userIds = [], persisted = new Map()) {
  return [...new Set((userIds || []).map(String).filter(Boolean))].map((userId) => ({
    userId,
    online: isOnline(userId),
    lastSeen: isOnline(userId) ? null : (persisted.get(userId) || getLastSeen(userId) || null),
  }));
}
