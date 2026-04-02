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

// ===== FORMAT + UPDATE SHEET =====
async function formatTasks(rows) {
  let now = getNowVN();

  let todayHeader = now.toLocaleDateString("en-US", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  let msg = `📅 *${todayHeader}*\n\n`;

  let total = 0;
  let urgent = 0;
  let normal = 0;

  let body = "";

  for (let r of rows) {
    if (!(r.Send === true || r.Send === "TRUE")) continue;

    let end = parseVNDate(r["End Time"]);
    if (!end || isNaN(end)) continue;

    let diff = end.getTime() - now.getTime();

    let title = (r.Title || "NONE").toUpperCase().trim();
    let content = (r.Content || "None").trim();
    let status = (r.Status || "None").trim();
    let endStr = formatDate(end);

    let state = "";
    let newStatus = status;

    total++;

    if (diff <= 0) {
      state = "❌ *Hết hạn*";
      newStatus = "Hết hạn";
    } else if (diff <= 7 * 24 * 60 * 60 * 1000) {
      state = "🔥 *Sắp hết hạn*";
      newStatus = "Sắp hết hạn";
      urgent++;
    } else {
      state = "✅ *Còn hạn*";
      newStatus = "Còn hạn";
      normal++;
    }

    // 🔥 UPDATE SHEET nếu khác
    if (r.Status !== newStatus) {
      r.Status = newStatus;
      await r.save();
    }

    body += `📌 *${title}*\n`;
    body += `⏰ _${endStr}_\n`;
    body += `📝 ${content}\n`;
    body += `👾 ${newStatus}\n`;
    body += `${state}\n`;
    body += `━━━━━━━━━━━━━━\n\n`;
  }

  msg += `📊 *Tổng: ${total}*\n🔥 Sắp hết: ${urgent}\n✅ Còn hạn: ${normal}\n\n`;
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
    return sendTelegram(
      chatId,
`📌 COMMAND:
/today
/end_today
/restart
/help`
    );
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
}, 60 * 1000); // 👉 nên để 1 phút

// ===== HEALTH =====
app.get("/", (req, res) => {
  res.send("alive");
});

// ===== START =====
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Bot running on port " + PORT);
});