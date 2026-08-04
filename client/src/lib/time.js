export function formatTime(seconds = 0) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

/**
 * Extrapolate expected position from the last authoritative snapshot.
 * Matches the server formula so UI and displays stay consistent between pushes.
 */
export function getExpectedPosition(session, receivedAt = Date.now(), now = Date.now()) {
  if (!session) {
    return 0;
  }

  if (!session.isPlaying) {
    return session.expectedPosition;
  }

  const elapsedSinceMessage = (now - receivedAt) / 1000;
  return Math.max(0, session.expectedPosition + elapsedSinceMessage);
}
