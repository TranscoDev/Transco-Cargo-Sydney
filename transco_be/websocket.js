const { WebSocketServer, WebSocket } = require('ws');

let wss;

// Staff-only live event stream (new messages, bookings, status changes —
// customer names, phone numbers and message text all flow through here),
// so a connection is only accepted with a valid STAFF session token.
//
// Browsers can't set an Authorization header on a WebSocket, so the
// console sends the token as the second entry of the subprotocol list:
//   new WebSocket(url, ['transco-staff', token])
// That keeps it out of the URL (and so out of access logs). The server
// answers with the 'transco-staff' protocol only — the token is never
// echoed back. A customer (My Transco) token is signed with a different
// key and fails verifySession, so customers can't subscribe either.
const STAFF_PROTOCOL = 'transco-staff';

function tokenFromProtocols(header) {
  const parts = String(header || '').split(',').map(p => p.trim()).filter(Boolean);
  if (parts[0] !== STAFF_PROTOCOL || parts.length < 2) return null;
  return parts[1];
}

function initWebSocketServer(httpServer, { verifySession } = {}) {
  if (typeof verifySession !== 'function') {
    throw new Error('initWebSocketServer requires verifySession — the staff event stream must never be open');
  }

  wss = new WebSocketServer({
    server: httpServer,
    verifyClient: (info, done) => {
      const payload = verifySession(tokenFromProtocols(info.req.headers['sec-websocket-protocol']));
      if (!payload) return done(false, 401, 'Unauthorized');
      info.req.staffUser = payload;
      done(true);
    },
    handleProtocols: (protocols) => (protocols.has(STAFF_PROTOCOL) ? STAFF_PROTOCOL : false)
  });

  wss.on('connection', (socket, req) => {
    console.log(`Staff client connected via WebSocket (${req.staffUser && req.staffUser.email})`);
    socket.on('close', () => console.log('Staff client disconnected'));
  });
  return wss;
}

function broadcast(type, payload) {
  if (!wss) return;
  const message = JSON.stringify({ type, payload });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

module.exports = { initWebSocketServer, broadcast, STAFF_PROTOCOL };
