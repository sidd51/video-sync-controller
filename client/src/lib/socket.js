import { io } from "socket.io-client";

/**
 * Dev: talk to the sync server on :3001.
 * Prod (same-origin Express serve): connect to the page host.
 * Override anytime with VITE_SERVER_URL.
 */
function createSocket() {
  if (import.meta.env.VITE_SERVER_URL) {
    return io(import.meta.env.VITE_SERVER_URL, { autoConnect: true });
  }

  if (import.meta.env.DEV) {
    return io("http://localhost:3001", { autoConnect: true });
  }

  return io({ autoConnect: true });
}

export const socket = createSocket();
