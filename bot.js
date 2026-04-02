const express = require("express");
const axios = require("axios");
const { GoogleSpreadsheet } = require("google-spreadsheet");

const app = express();
app.use(express.json());

// ===== ENV =====
const TOKEN = process.env.TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const SHEET_ID = process.env.SHEET_ID;

// 🔒 credentials từ ENV
const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS);

// ===== SEND TELEGRAM =====
async function sendTelegram(chatId, text) {
  await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    chat_id: chatId,
    text: text,
  });
}

// ===== READ SHEET =====
async function getTodayTasks() {
  const doc = new GoogleSpreadsheet(SHEET_ID);

  await doc.useServiceAccountAuth(creds);
  await doc.loadInfo();

  const sheet = doc.sheetsByTitle["v2"];
  const rows = await sheet.getRows();

  let msg = "📅 Today:\n\n";

  rows.forEach((r) => {
    if (r.Send === true || r.Send === "TRUE") {
      msg += `📌 ${r.Title} | ${r["Start Time"]}-${r["End Time"]}\n`;
    }
  });

  return msg;
}

// ===== COMMAND =====
async function handleCommand(text, chatId) {
  if (text === "/start" || text === "/menu") {
    return sendTelegram(
      chatId,
      "📌 COMMAND:\n/today\n/status\n/help"
    );
  }

  if (text === "/status") {
    return sendTelegram(chatId, "🟢 BOT RUNNING");
  }

  if (text === "/help") {
    return sendTelegram(
      chatId,
      "/today - xem công việc\n/status\n/help"
    );
  }

  if (text === "/today") {
    const msg = await getTodayTasks();
    return sendTelegram(chatId, msg);
  }
}

// ===== WEBHOOK =====
app.post("/", async (req, res) => {
  res.send("OK"); // ⚡ trả ngay cho Telegram

  const data = req.body;

  if (!data.message) return;

  const text = data.message.text || "";
  const chatId = data.message.chat.id.toString();

  // 🔒 chỉ cho bạn dùng bot
  if (chatId !== CHAT_ID) return;

  try {
    await handleCommand(text, chatId);
  } catch (err) {
    console.log(err);
  }
});

// ===== HEALTH =====
app.get("/", (req, res) => {
  res.send("alive");
});

// ===== START SERVER =====
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Bot running on port " + PORT);
});