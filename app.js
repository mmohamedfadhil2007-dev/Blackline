import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config.js";

const clientId = crypto.randomUUID();
const consolePanel = document.querySelector("#console");
const onlineCount = document.querySelector("#online-count");
const pairStatus = document.querySelector("#pair-status");
const messageForm = document.querySelector("#message-form");
const messageInput = document.querySelector("#message-input");
const sendButton = document.querySelector("#send-button");
const connectButton = document.querySelector("#connect-button");
const skipButton = document.querySelector("#skip-button");
const clearButton = document.querySelector("#clear-button");
const panicButton = document.querySelector("#panic-button");
const noiseButton = document.querySelector("#noise-button");
const brightnessDown = document.querySelector("#brightness-down");
const brightnessUp = document.querySelector("#brightness-up");
const disconnectButton = document.querySelector("#disconnect-button");
const idleModal = document.querySelector("#idle-modal");
const idleYesButton = document.querySelector("#idle-yes");
const idleCountdown = document.querySelector("#idle-countdown");

const brightnessLevels = [0.48, 0.62, 0.78, 0.9, 1];
const replyDelay = 60000;
const replyGraceSeconds = 10;
const lobbyName = "blacklink:lobby:v1";

let brightnessIndex = brightnessLevels.length - 1;
let supabase = null;
let lobby = null;
let room = null;
let connected = false;
let paired = false;
let pairing = false;
let partnerId = "";
let roomId = "";
let replyTimer = null;
let replyGraceTimer = null;
let replyCountdownTimer = null;
let replySecondsLeft = replyGraceSeconds;

function writeLine(text, className = "system-line") {
  const line = document.createElement("p");
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  line.className = className;
  line.textContent = `[${time}] ${text}`;
  consolePanel.append(line);
  consolePanel.scrollTop = consolePanel.scrollHeight;
}

function canUseSupabaseConfig() {
  return SUPABASE_URL &&
    SUPABASE_ANON_KEY &&
    !SUPABASE_URL.includes("YOUR_PROJECT") &&
    !SUPABASE_ANON_KEY.includes("YOUR_ANON_KEY");
}

function setPairedState(nextPaired) {
  paired = nextPaired;
  messageInput.disabled = !paired;
  sendButton.disabled = !paired;
  skipButton.disabled = !connected;
  messageInput.placeholder = paired ? "type into the line" : "line closed";

  if (paired) {
    pairStatus.textContent = "linked";
    pairStatus.classList.add("live");
    messageInput.focus();
  } else if (connected) {
    pairStatus.textContent = "waiting";
    pairStatus.classList.remove("live");
  } else {
    pairStatus.textContent = "offline";
    pairStatus.classList.remove("live");
  }
}

function clearReplyPrompt() {
  window.clearTimeout(replyGraceTimer);
  window.clearInterval(replyCountdownTimer);
  replyGraceTimer = null;
  replyCountdownTimer = null;
  replySecondsLeft = replyGraceSeconds;
  idleCountdown.textContent = `disconnecting in ${replySecondsLeft}`;
  idleModal.classList.add("hidden");
}

function clearReplyCheck() {
  window.clearTimeout(replyTimer);
  replyTimer = null;
  clearReplyPrompt();
}

function scheduleReplyCheck() {
  window.clearTimeout(replyTimer);

  if (!connected || !paired) {
    clearReplyPrompt();
    return;
  }

  replyTimer = window.setTimeout(showIdlePrompt, replyDelay);
}

function showIdlePrompt() {
  if (!connected || !paired) {
    return;
  }

  replySecondsLeft = replyGraceSeconds;
  idleCountdown.textContent = `disconnecting in ${replySecondsLeft}`;
  idleModal.classList.remove("hidden");
  idleYesButton.focus();

  replyCountdownTimer = window.setInterval(() => {
    replySecondsLeft -= 1;
    idleCountdown.textContent = `disconnecting in ${replySecondsLeft}`;
  }, 1000);

  replyGraceTimer = window.setTimeout(() => {
    clearReplyCheck();
    disconnect("reply timeout. terminal disconnected.");
  }, replyGraceSeconds * 1000);
}

function confirmPresence() {
  clearReplyPrompt();
  writeLine("presence confirmed.");
  scheduleReplyCheck();
}

function applyBrightness() {
  document.documentElement.style.setProperty("--brightness-level", brightnessLevels[brightnessIndex]);
  brightnessDown.disabled = brightnessIndex === 0;
  brightnessUp.disabled = brightnessIndex === brightnessLevels.length - 1;
}

function roomName(id) {
  return `blacklink:room:${id}`;
}

function makeRoomId(firstId, secondId) {
  return [firstId, secondId].sort().join(":");
}

function getPresenceUsers() {
  if (!lobby) {
    return [];
  }

  return Object.values(lobby.presenceState())
    .flat()
    .map((entry) => entry)
    .filter((entry) => entry.clientId);
}

function updateOnlineCount() {
  const users = getPresenceUsers();
  const count = new Set(users.map((user) => user.clientId)).size;
  onlineCount.textContent = `${String(count).padStart(2, "0")} online`;
}

function findPresenceUser(nextClientId) {
  return getPresenceUsers().find((user) => user.clientId === nextClientId);
}

function isWaitingUser(nextClientId) {
  return findPresenceUser(nextClientId)?.status === "waiting";
}

async function updateLobbyStatus(status) {
  if (!lobby) {
    return;
  }

  await lobby.track({
    clientId,
    status,
    roomId,
    partnerId,
    updatedAt: Date.now(),
  });
}

async function leaveRoom(notify = true) {
  clearReplyCheck();

  if (room && notify && partnerId) {
    await room.send({
      type: "broadcast",
      event: "room-left",
      payload: { from: clientId },
    }).catch(() => {});
  }

  if (room) {
    await supabase.removeChannel(room).catch(() => {});
  }

  room = null;
pairing = false;
roomId = "";
  partnerId = "";
  setPairedState(false);
}

async function openRoom(nextRoomId, nextPartnerId) {
  if (!findPresenceUser(nextPartnerId) || pairing || paired) {
    return;
  }

  pairing = true;
  await leaveRoom(false);
  pairing = true;

  roomId = nextRoomId;
  partnerId = nextPartnerId;
  room = supabase.channel(roomName(roomId), {
    config: { broadcast: { self: true } },
  });

  room.on("broadcast", { event: "message" }, ({ payload }) => {
    if (payload.roomId !== roomId || !payload.text) {
      return;
    }

    const fromSelf = payload.from === clientId;
    writeLine(`${fromSelf ? "you" : "unknown"}: ${payload.text}`, fromSelf ? "self-line" : "peer-line");

    if (fromSelf) {
      clearReplyCheck();
    } else {
      scheduleReplyCheck();
    }
  });

  room.on("broadcast", { event: "room-left" }, ({ payload }) => {
    if (payload.from === partnerId) {
      writeLine("system: counterpart disconnected.", "alert-line");
      joinChat("standing by for another live terminal");
    }
  });

  await room.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      setPairedState(true);
      writeLine("system: secure line opened.", "alert-line");
      await updateLobbyStatus("linked");
    }
  });
}

async function acceptMatch(match) {
  if (!connected || paired || match.targetId !== clientId || !findPresenceUser(match.from)) {
    return;
  }

  await openRoom(match.roomId, match.from);
}

function attemptPair() {
  if (!connected || paired || pairing || !lobby) {
    return;
  }

  const waitingUsers = getPresenceUsers()
    .filter((user) => user.clientId !== clientId && user.status === "waiting")
    .sort((first, second) => first.clientId.localeCompare(second.clientId));

  const partner = waitingUsers[0];
  if (!partner) {
    return;
  }

  if (clientId.localeCompare(partner.clientId) > 0) {
    return;
  }

  const nextRoomId = makeRoomId(clientId, partner.clientId);
  lobby.send({
    type: "broadcast",
    event: "match",
    payload: {
      from: clientId,
      targetId: partner.clientId,
      roomId: nextRoomId,
    },
  });
  openRoom(nextRoomId, partner.clientId);
}

async function connectRealtime() {
  if (lobby) {
    return;
  }

  if (!canUseSupabaseConfig()) {
    connectButton.disabled = true;
    skipButton.disabled = true;
    setPairedState(false);
    writeLine("config missing: copy config.example.js to config.js and add Supabase URL + anon key.", "danger-line");
    return;
  }

  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 4 } },
  });

  lobby = supabase.channel(lobbyName, {
    config: {
      presence: { key: clientId },
      broadcast: { self: false },
    },
  });

  lobby.on("presence", { event: "sync" }, () => {
    updateOnlineCount();

    if (paired && partnerId && !findPresenceUser(partnerId)) {
      joinChat("system: counterpart disconnected. standing by for another live terminal.").catch(() => {
        writeLine("system: reconnect to queue failed.", "danger-line");
      });
      return;
    }

    attemptPair();
  });

  lobby.on("broadcast", { event: "match" }, ({ payload }) => {
    acceptMatch(payload);
  });

  await lobby.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      writeLine("system: realtime relay online.");
      await updateLobbyStatus("online");
      joinChat();
    }

    if (status === "CHANNEL_ERROR") {
      writeLine("system: realtime reconnecting.", "alert-line");
    }
  });
}

async function joinChat(message = "uplink opened. waiting for another operator.", notifyPartner = false) {
  if (!lobby || (connected && !paired && !room)) {
    return;
  }

  connected = true;
  connectButton.disabled = true;
  skipButton.disabled = false;
  await leaveRoom(notifyPartner);
  setPairedState(false);
  writeLine(message);
  await updateLobbyStatus("waiting");
  attemptPair();
}

async function disconnect(message = "local terminal disconnected.") {
  connected = false;
  connectButton.disabled = false;
  await leaveRoom(true);
  await updateLobbyStatus("online");
  setPairedState(false);
  writeLine(message, "danger-line");
}

async function sendMessage(text) {
  if (!room || !paired) {
    return;
  }

  clearReplyCheck();
  await room.send({
    type: "broadcast",
    event: "message",
    payload: {
      from: clientId,
      roomId,
      text: text.slice(0, 700),
      sentAt: Date.now(),
    },
  });
}

messageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = messageInput.value.trim();
  if (!text || !paired) {
    return;
  }

  messageInput.value = "";
  sendMessage(text).catch(() => {
    writeLine("message failed. line may be closed.", "danger-line");
  });
});

connectButton.addEventListener("click", () => {
  joinChat().catch(() => writeLine("connect failed.", "danger-line"));
});

skipButton.addEventListener("click", () => {
  joinChat("system: requesting new line.", true).catch(() => {
    writeLine("new line request failed.", "danger-line");
  });
});

clearButton.addEventListener("click", () => {
  consolePanel.replaceChildren();
  writeLine("screen cleared.");
});

panicButton.addEventListener("click", () => {
  document.body.classList.toggle("blank");
  panicButton.textContent = document.body.classList.contains("blank") ? "Restore" : "Panic Blank";
});

noiseButton.addEventListener("click", () => {
  document.body.classList.toggle("noise");
});

brightnessDown.addEventListener("click", () => {
  brightnessIndex = Math.max(0, brightnessIndex - 1);
  applyBrightness();
});

brightnessUp.addEventListener("click", () => {
  brightnessIndex = Math.min(brightnessLevels.length - 1, brightnessIndex + 1);
  applyBrightness();
});

disconnectButton.addEventListener("click", () => {
  disconnect().catch(() => writeLine("disconnect failed.", "danger-line"));
});

idleYesButton.addEventListener("click", confirmPresence);

window.addEventListener("beforeunload", () => {
  if (lobby) {
    updateLobbyStatus("offline");
  }
});

applyBrightness();
connectRealtime();