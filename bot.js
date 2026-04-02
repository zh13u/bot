const express = require("express");
const axios = require("axios");
const { GoogleSpreadsheet } = require("google-spreadsheet");

const app = express();
app.use(express.json());

// ===== ENV =====
const TOKEN = process.env.TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const SHEET_ID = process.env.SHEET_ID;
const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS);

// ===== MEMORY =====
let isPausedToday = false;
let pausedDate = "";

// ===== SEND TELEGRAM =====
async function sendTelegram(chatId, text) {
  await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    chat_id: chatId,
    text: text,
  });
}

// ===== FORMAT TASK =====
function formatTasks(rows) {
  let now = new Date();
  let todayStr = now.toLocaleDateString("vi-VN");

  let msg = `📅 ${todayStr}\n\n`;

  rows.forEach((r) => {
    if (!(r.Send === true || r.Send === "TRUE")) return;

    let start = new Date(r["Start Time"]);
    let end = new Date(r["End Time"]);

    let s = start.toLocaleTimeString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
    });

    let e = end.toLocaleTimeString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
    });

    msg += `📌 ${r.Title || "None"} | ${s} - ${e}\n`;
    msg += `📝 ${r.Content || "None"}\n`;
    msg += `👾 ${r.Status || "None"}\n`;
    msg += "----------------------\n\n";
  });

  return msg;
}

// ===== READ SHEET =====
async function getTodayTasks() {
  const doc = new GoogleSpreadsheet(SHEET_ID);

  await doc.useServiceAccountAuth(creds);
  await doc.loadInfo();

  const sheet = doc.sheetsByTitle["v2"];
  const rows = await sheet.getRows();

  return formatTasks(rows);
}

// ===== COMMAND =====
async function handleCommand(text, chatId) {
  const today = new Date().toDateString();

  // reset ngày mới
  if (pausedDate !== today) {
    isPausedToday = false;
  }

  if (text === "/today") {
    const msg = await getTodayTasks();
    return sendTelegram(chatId, msg);
  }

  if (text === "/end_today") {
    isPausedToday = true;
    pausedDate = today;
    return sendTelegram(chatId, "⛔ Đã tắt thông báo hôm nay");
  }

  if (text === "/restart") {
    isPausedToday = false;
    return sendTelegram(chatId, "▶️ Đã bật lại thông báo");
  }

  if (text === "/help") {
    return sendTelegram(
      chatId,
`📌 COMMAND:
/today - xem công việc
/end_today - tắt hôm nay
/restart - bật lại
/help - trợ giúp`
    );
  }

  // ❌ sai command
  if (text.startsWith("/")) {
    return sendTelegram(
      chatId,
`❌ Sai lệnh!
👉 Dùng /help để xem danh sách lệnh`
    );
  }
}

// ===== WEBHOOK =====
app.post("/", async (req, res) => {
  res.send("OK");

  const data = req.body;
  if (!data.message) return;

  const text = data.message.text || "";
  const chatId = data.message.chat.id.toString();

  if (chatId !== CHAT_ID) return;

  try {
    await handleCommand(text, chatId);
  } catch (err) {
    console.log(err);
  }
});

// ===== AUTO SEND (5 PHÚT) =====
setInterval(async () => {
  const today = new Date().toDateString();

  if (isPausedToday && pausedDate === today) return;

  try {
    const msg = await getTodayTasks();
    await sendTelegram(CHAT_ID, msg);
  } catch (e) {
    console.log(e);
  }
}, 5 * 60 * 1000);

// ===== HEALTH =====
app.get("/", (req, res) => {
  res.send("alive");
});

// ===== START =====
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Bot running on port " + PORT);
});