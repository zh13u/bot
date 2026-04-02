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
    parse_mode: "Markdown",
  });
}

// ===== TIME VN =====
function getNowVN() {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" })
  );
}

// ===== PARSE DATE =====
function parseVNDate(dateStr) {
  if (!dateStr) return null;

  const [datePart, timePart] = dateStr.split(" ");
  const [day, month, year] = datePart.split("/");
  let [hour, minute, second] = timePart.split(":");

  return new Date(
    year,
    month - 1,
    day,
    parseInt(hour),
    parseInt(minute),
    parseInt(second)
  );
}

// ===== FORMAT DATE =====
function formatDate(date) {
  return date.toLocaleString("en-US", {
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// ===== COUNTDOWN =====
function getRemainingTime(diff) {
  if (diff <= 0) return "Đã hết hạn";

  let days = Math.floor(diff / (1000 * 60 * 60 * 24));
  let hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  let mins = Math.floor((diff / (1000 * 60)) % 60);

  return `${days}d ${hours}h ${mins}m`;
}

// ===== FORMAT TASK =====
async function formatTasks(rows) {
  let now = getNowVN();

  let todayHeader = now.toLocaleDateString("en-US", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  let total = 0, urgent = 0, normal = 0, expired = 0;

  let body = "";

  for (let r of rows) {
    if (!(r.Send === true || r.Send === "TRUE")) continue;

    let end = parseVNDate(r["End Time"]);
    if (!end) continue;

    let diff = end - now;

    let title = (r.Title || "NONE").toUpperCase();
    let content = r.Content || "None";
    let endStr = formatDate(end);

    total++;

    let state = "";
    let statusLine = "Đang thực hiện";

    if (diff <= 0) {
      state = "❌ *Hết hạn*";
      statusLine = "Hết hạn";
      expired++;

      // 🔥 CHỈ UPDATE KHI HẾT HẠN
      if (r.Status !== "Hết hạn") {
        r.Status = "Hết hạn";
        await r.save();
      }

    } else if (diff <= 7 * 24 * 60 * 60 * 1000) {
      state = "🔥 *Sắp hết hạn*";
      urgent++;
      normal++;
    } else {
      state = "✅ *Còn hạn*";
      normal++;
    }

    body += `📌 *${title}*\n`;
    body += `⏰ _${endStr}_\n`;
    body += `📝 ${content}\n`;
    body += `👾 ${statusLine}\n`;
    body += `⏳ ${getRemainingTime(diff)}\n`;
    body += `${state}\n`;
    body += `━━━━━━━━━━━━━━\n\n`;
  }

  let msg = `📅 *${todayHeader}*\n\n`;
  msg += `📊 *Tổng: ${total}*\n`;
  msg += `🔥 Sắp hết: ${urgent}\n`;
  msg += `✅ Còn hạn: ${normal}\n`;
  msg += `❌ Hết hạn: ${expired}\n\n`;

  msg += `👉 [Mở Google Sheet để tắt task](https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit?gid=710842622#gid=710842622)\n\n`;

  msg += `━━━━━━━━━━━━━━\n\n`;
  msg += body;

  return msg || "Không có công việc nào";
}

// ===== READ SHEET =====
async function getTodayTasks() {
  const doc = new GoogleSpreadsheet(SHEET_ID);

  await doc.useServiceAccountAuth(creds);
  await doc.loadInfo();

  const sheet = doc.sheetsByTitle["v2"];
  const rows = await sheet.getRows();

  return await formatTasks(rows);
}

// ===== COMMAND =====
async function handleCommand(text, chatId) {
  const today = getNowVN().toDateString();

  if (pausedDate !== today) isPausedToday = false;

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
    return sendTelegram(chatId,
`📌 COMMAND:
/today
/end_today
/restart
/help`);
  }

  if (text.startsWith("/")) {
    return sendTelegram(chatId, "❌ Sai lệnh!");
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

// ===== AUTO SEND =====
setInterval(async () => {
  const today = getNowVN().toDateString();

  if (isPausedToday && pausedDate === today) return;

  try {
    const msg = await getTodayTasks();
    await sendTelegram(CHAT_ID, msg);
  } catch (e) {
    console.log(e);
  }
}, 10 * 1000);

// ===== HEALTH =====
app.get("/", (req, res) => {
  res.send("alive");
});

// ===== START =====
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Bot running on port " + PORT);
});