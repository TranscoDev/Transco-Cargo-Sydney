const { WebSocketServer, WebSocket } = require('ws');

let wss;

function initWebSocketServer(httpServer) {
  wss = new WebSocketServer({ server: httpServer });
  wss.on('connection', (socket) => {
    console.log('Staff client connected via WebSocket');
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

module.exports = { initWebSocketServer, broadcast };
