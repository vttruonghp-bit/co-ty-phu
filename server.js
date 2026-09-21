"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const PORT = Number(process.env.PORT) || 3000;
const ROOM_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_STATE_BYTES = 600_000;
const app = express();
const server = http.createServer(app);

const allowedOrigins = (process.env.CLIENT_ORIGIN || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const io = new Server(server, {
  cors: allowedOrigins.length
    ? { origin: allowedOrigins, methods: ["GET", "POST"] }
    : undefined,
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: true,
  },
  maxHttpBufferSize: MAX_STATE_BYTES,
});

const rooms = new Map();

const indexCandidates = [
  path.join(__dirname, "public", "index.html"),
  path.join(__dirname, "index.html"),
  path.join(__dirname, "index (1).html"),
];
const indexFile = indexCandidates.find((candidate) => fs.existsSync(candidate));
const staticDirectory = indexFile ? path.dirname(indexFile) : path.join(__dirname, "public");

app.disable("x-powered-by");
app.get("/health", (_req, res) => {
  res.json({ ok: true, rooms: rooms.size, now: Date.now() });
});
app.use(express.static(staticDirectory, {
  extensions: ["html"],
  maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-store");
  },
}));
app.get("*", (_req, res) => {
  if (indexFile) {
    res.setHeader("Cache-Control", "no-store");
    return res.sendFile(indexFile);
  }
  return res.status(503).type("text/plain").send(
    "Khong tim thay giao dien game. Hay tai public/index.html (hoac index.html) len GitHub rồi deploy lai."
  );
});

function roomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let code = "";
    for (let i = 0; i < 6; i += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    if (!rooms.has(code)) return code;
  }
  throw new Error("Không thể tạo mã phòng");
}

function normalizeCode(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function normalizeToken(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
}

function validSnapshot(state) {
  if (!state || state.schema !== 1 || !Array.isArray(state.players)) return false;
  if (state.players.length < 2 || state.players.length > 6) return false;
  if (!Number.isInteger(Number(state.currentTurn))) return false;
  if (Number(state.currentTurn) < 0 || Number(state.currentTurn) >= state.players.length) return false;
  const ids = state.players.map((player) => Number(player.id));
  if (new Set(ids).size !== ids.length) return false;
  try {
    return Buffer.byteLength(JSON.stringify(state), "utf8") <= MAX_STATE_BYTES;
  } catch (_error) {
    return false;
  }
}

function playerList(room, clientToken = "") {
  return room.state.players.map((player) => {
    const id = Number(player.id);
    const seat = room.seats.get(id);
    return {
      id,
      name: String(player.name || `Người ${id + 1}`).slice(0, 40),
      color: String(player.color || "#64748b").slice(0, 20),
      taken: Boolean(seat),
      connected: Boolean(seat?.connected),
      mine: Boolean(seat && seat.token === clientToken),
    };
  });
}

function memberList(room) {
  return playerList(room).filter((player) => player.taken);
}

function broadcastMembers(room) {
  io.to(room.code).emit("room:members", {
    roomCode: room.code,
    members: memberList(room),
  });
}

function attachSeat(socket, room, playerId, token) {
  const existing = room.seats.get(playerId);
  if (existing?.socketId && existing.socketId !== socket.id) {
    const previous = io.sockets.sockets.get(existing.socketId);
    if (previous) previous.disconnect(true);
  }
  room.seats.set(playerId, {
    token,
    socketId: socket.id,
    connected: true,
    lastSeen: Date.now(),
  });
  socket.join(room.code);
  socket.data.roomCode = room.code;
  socket.data.playerId = playerId;
  socket.data.clientToken = token;
  room.updatedAt = Date.now();
}

function joinRoom(socket, payload, reply) {
  const code = normalizeCode(payload?.roomCode);
  const room = rooms.get(code);
  if (!room) return reply({ ok: false, code: "ROOM_NOT_FOUND", message: "Không tìm thấy phòng." });
  const playerId = Number(payload?.playerId);
  if (!Number.isInteger(playerId) || !room.state.players.some((player) => Number(player.id) === playerId)) {
    return reply({ ok: false, code: "INVALID_SEAT", message: "Ghế người chơi không hợp lệ." });
  }
  const token = normalizeToken(payload?.clientToken || socket.handshake.auth?.clientToken);
  if (!token) return reply({ ok: false, code: "INVALID_TOKEN", message: "Thiếu mã nhận diện thiết bị." });
  const occupied = room.seats.get(playerId);
  if (occupied && occupied.token !== token) {
    return reply({ ok: false, code: "SEAT_TAKEN", message: "Tên người chơi này đã có người chọn." });
  }
  attachSeat(socket, room, playerId, token);
  reply({
    ok: true,
    roomCode: code,
    playerId,
    version: room.version,
    state: room.state,
    members: memberList(room),
  });
  broadcastMembers(room);
}

io.on("connection", (socket) => {
  socket.on("room:create", (payload, callback = () => {}) => {
    const state = payload?.state;
    if (!validSnapshot(state)) {
      return callback({ ok: false, code: "INVALID_STATE", message: "Trạng thái ván chơi không hợp lệ." });
    }
    const token = normalizeToken(payload?.clientToken || socket.handshake.auth?.clientToken);
    if (!token) return callback({ ok: false, code: "INVALID_TOKEN", message: "Thiếu mã nhận diện thiết bị." });
    const creatorId = Number(payload?.playerId);
    if (!state.players.some((player) => Number(player.id) === creatorId)) {
      return callback({ ok: false, code: "INVALID_SEAT", message: "Không tìm thấy người tạo phòng trong ván." });
    }
    const code = roomCode();
    const room = {
      code,
      state,
      version: 1,
      seats: new Map(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    rooms.set(code, room);
    attachSeat(socket, room, creatorId, token);
    callback({
      ok: true,
      roomCode: code,
      playerId: creatorId,
      version: room.version,
      state: room.state,
      members: memberList(room),
    });
    broadcastMembers(room);
  });

  socket.on("room:inspect", (payload, callback = () => {}) => {
    const code = normalizeCode(payload?.roomCode);
    const room = rooms.get(code);
    if (!room) return callback({ ok: false, code: "ROOM_NOT_FOUND", message: "Không tìm thấy phòng." });
    const token = normalizeToken(socket.handshake.auth?.clientToken);
    callback({ ok: true, roomCode: code, version: room.version, players: playerList(room, token) });
  });

  socket.on("room:join", (payload, callback = () => {}) => joinRoom(socket, payload, callback));
  socket.on("room:resume", (payload, callback = () => {}) => joinRoom(socket, payload, callback));

  socket.on("game:state-request", (payload, callback = () => {}) => {
    const code = normalizeCode(payload?.roomCode || socket.data.roomCode);
    const room = rooms.get(code);
    if (!room) return callback({ ok: false, code: "ROOM_NOT_FOUND", message: "Không tìm thấy phòng." });
    callback({ ok: true, roomCode: code, version: room.version, state: room.state, members: memberList(room) });
  });

  socket.on("game:state", (payload, callback = () => {}) => {
    const code = normalizeCode(payload?.roomCode || socket.data.roomCode);
    const room = rooms.get(code);
    if (!room || socket.data.roomCode !== code) {
      return callback({ ok: false, code: "ROOM_NOT_FOUND", message: "Bạn chưa vào phòng này." });
    }
    const seat = room.seats.get(Number(socket.data.playerId));
    if (!seat || seat.token !== socket.data.clientToken) {
      return callback({ ok: false, code: "NOT_A_PLAYER", message: "Ghế người chơi không còn thuộc thiết bị này." });
    }
    const expectedActor = Number(room.state.currentTurn);
    if (Number(socket.data.playerId) !== expectedActor) {
      return callback({ ok: false, code: "NOT_YOUR_TURN", message: "Máy chủ từ chối: chưa đến lượt của bạn." });
    }
    if (Number(payload?.baseVersion) !== room.version) {
      return callback({ ok: false, code: "STALE_STATE", message: "Ván chơi đã có trạng thái mới hơn.", version: room.version, state: room.state });
    }
    const state = payload?.state;
    if (!validSnapshot(state) || state.players.length !== room.state.players.length) {
      return callback({ ok: false, code: "INVALID_STATE", message: "Máy chủ từ chối trạng thái không hợp lệ." });
    }
    const oldPlayers = room.state.players;
    const identityChanged = state.players.some((player, index) => {
      const old = oldPlayers[index];
      return !old || Number(player.id) !== Number(old.id) || String(player.name) !== String(old.name) || String(player.color) !== String(old.color);
    });
    if (identityChanged) {
      return callback({ ok: false, code: "IDENTITY_CHANGED", message: "Không được thay đổi danh tính người chơi giữa ván." });
    }
    const nextTurn = Number(state.currentTurn);
    const allowedNext = (expectedActor + 1) % state.players.length;
    if (nextTurn !== expectedActor && nextTurn !== allowedNext) {
      return callback({ ok: false, code: "INVALID_TURN", message: "Thứ tự lượt chơi không hợp lệ." });
    }
    room.state = state;
    room.version += 1;
    room.updatedAt = Date.now();
    seat.lastSeen = Date.now();
    socket.to(code).emit("game:state", {
      roomCode: code,
      version: room.version,
      reason: String(payload?.reason || "state").slice(0, 60),
      state: room.state,
    });
    callback({ ok: true, version: room.version });
  });

  socket.on("room:leave", (payload) => {
    const code = normalizeCode(payload?.roomCode || socket.data.roomCode);
    const room = rooms.get(code);
    if (!room) return;
    const playerId = Number(socket.data.playerId);
    const seat = room.seats.get(playerId);
    if (seat?.token === socket.data.clientToken) room.seats.delete(playerId);
    socket.leave(code);
    socket.data.roomCode = "";
    socket.data.playerId = null;
    broadcastMembers(room);
  });

  socket.on("disconnect", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const seat = room.seats.get(Number(socket.data.playerId));
    if (seat?.socketId === socket.id) {
      seat.connected = false;
      seat.socketId = "";
      seat.lastSeen = Date.now();
      room.updatedAt = Date.now();
      broadcastMembers(room);
    }
  });
});

setInterval(() => {
  const cutoff = Date.now() - ROOM_TTL_MS;
  for (const [code, room] of rooms) {
    if (room.updatedAt < cutoff) {
      io.to(code).emit("room:closed", { roomCode: code, reason: "expired" });
      rooms.delete(code);
    }
  }
}, 10 * 60 * 1000).unref();

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Cờ Tỉ Phú Socket.IO đang chạy tại cổng ${PORT}`);
  if (indexFile) {
    console.log(`Đang phục vụ giao diện từ: ${path.relative(__dirname, indexFile)}`);
  } else {
    console.error("Không tìm thấy public/index.html, index.html hoặc index (1).html");
  }
});
