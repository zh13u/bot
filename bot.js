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

// 👉 THÊM WEATHER
const WEATHER_API_KEY = process.env.WEATHER_API_KEY;
const CITY = "Ho Chi Minh";

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

// ===== WEATHER =====
async function getWeather() {
  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${CITY}&appid=${WEATHER_API_KEY}&units=metric&lang=vi`;
    const res = await axios.get(url);

    const d = res.data;

    return {
      temp: d.main.temp,
      feels: d.main.feels_like,
      humidity: d.main.humidity,
      temp_min: d.main.temp_min,
      temp_max: d.main.temp_max,
      pressure: d.main.pressure,

      weather: d.weather[0].description,

      wind: d.wind.speed,
      clouds: d.clouds.all,
      visibility: d.visibility,

      sunrise: d.sys.sunrise,
      sunset: d.sys.sunset,

      city: d.name,
    };
  } catch (err) {
    console.log("❌ WEATHER ERROR:", err.response?.data || err.message);
    return null;
  }
}

// ===== FORMAT WEATHER BASIC =====
async function formatWeatherBasic() {
  const w = await getWeather();
  if (!w) return "";

  const sunrise = new Date(w.sunrise * 1000).toLocaleTimeString("vi-VN");
  const sunset = new Date(w.sunset * 1000).toLocaleTimeString("vi-VN");

  return `
${getWeatherEmoji(w.weather)} *Thời tiết ${w.city}*
_${w.weather}_

🌡 *${w.temp}°C* (cảm giác ${w.feels}°C)
🔻 ${w.temp_min}°C • 🔺 ${w.temp_max}°C
💧 ${w.humidity}% • 🌥 ${w.clouds}%

🌬 ${w.wind} m/s • 👁 ${(w.visibility / 1000).toFixed(1)} km
📈 ${w.pressure} hPa

🌅 ${sunrise} • 🌇 ${sunset}
━━━━━━━━━━━━━━

`;
}

async function getForecast() {
  try {
    const url = `https://api.openweathermap.org/data/2.5/forecast?q=${CITY}&appid=${WEATHER_API_KEY}&units=metric&lang=vi`;
    const res = await axios.get(url);

    // lấy 3 mốc gần nhất (đỡ spam)
    return res.data.list.slice(0, 3);
  } catch (err) {
    console.log("Forecast error:", err.message);
    return [];
  }
}

// ===== WEATHER DETAIL =====
async function formatWeatherDetail() {
  const w = await getWeather();
  const forecast = await getForecast();

  if (!w) return "❌ Không lấy được dữ liệu thời tiết";

  let msg = `
🌍 *THỜI TIẾT CHI TIẾT*

📍 *${w.city}*

${getWeatherEmoji(w.weather)} ${w.weather}

🌡 ${w.temp}°C (cảm giác ${w.feels}°C)
🔻 ${w.temp_min}°C • 🔺 ${w.temp_max}°C
💧 ${w.humidity}% • 🌥 ${w.clouds}%
🌬 ${w.wind} m/s
📈 ${w.pressure} hPa

━━━━━━━━━━━━━━
📊 *Dự báo sắp tới*
`;

  forecast.forEach(f => {
    const time = new Date(f.dt * 1000).toLocaleTimeString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
    });

    msg += `
🕒 ${time}
🌡 ${f.main.temp}°C
💧 ${f.main.humidity}%
_${f.weather[0].description}_
`;
  });

  msg += `\n━━━━━━━━━━━━━━\n⏰ _Realtime_`;

  return msg;
}

function getWeatherEmoji(desc) {
  desc = desc.toLowerCase();

  if (desc.includes("mưa")) return "🌧";
  if (desc.includes("nắng") || desc.includes("clear")) return "☀️";
  if (desc.includes("mây")) return "☁️";
  if (desc.includes("giông")) return "⛈";
  if (desc.includes("sương")) return "🌫";

  return "🌤";
}

// ===== PARSE DATE =====
function parseVNDate(dateStr) {
  if (!dateStr) return null;

  const [datePart, timePart] = dateStr.split(" ");
  const [day, month, year] = datePart.split("/");
  let [hour, minute, second] = timePart.split(":");

  return new Date(year, month - 1, day, hour, minute, second);
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

    body += `*${title}*\n`;
    body += `⏰ _${endStr}_\n`;
    body += `📝 _${content}_\n`;
    body += `👾 _${statusLine}_\n`;
    body += `⏳ _${getRemainingTime(diff)}_\n`;
    body += `_${state}_\n`;
    body += `━━━━━━━━━━━━━━\n\n`;
  }

  // 👉 THÊM WEATHER VÀO HEADER
  const weather = await formatWeatherBasic();

  let msg = `📅 *${todayHeader}*\n\n`;

  msg += weather; // 🔥 CHÈN WEATHER Ở ĐÂY

  msg += `📊 *Tổng: ${total}*\n`;
  msg += `🔥 Sắp hết: ${urgent}\n`;
  msg += `✅ Còn hạn: ${normal}\n`;
  msg += `❌ Hết hạn: ${expired}\n\n`;

  msg += `👉 [Mở Google Sheet để tắt task đã hết hạn](https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit?gid=710842622#gid=710842622)\n\n`;

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

  // 👉 THÊM COMMAND MỚI
  if (text === "/weather_detail") {
    const msg = await formatWeatherDetail();
    return sendTelegram(chatId, msg);
  }

  if (text === "/help") {
    return sendTelegram(chatId,
`📌 COMMAND:
/today
/end_today
/restart
/weather_detail
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
}, 15 * 60 * 1000);

// 🔥 SORT TASK: hết hạn -> sắp hết -> còn hạn
rows.sort((a, b) => {
  let endA = parseVNDate(a["End Time"]);
  let endB = parseVNDate(b["End Time"]);

  if (!endA) return 1;
  if (!endB) return -1;

  let diffA = endA - now;
  let diffB = endB - now;

  const priority = (diff) => {
    if (diff <= 0) return 0; // hết hạn
    if (diff <= 7 * 24 * 60 * 60 * 1000) return 1; // sắp hết
    return 2; // còn hạn
  };

  let pA = priority(diffA);
  let pB = priority(diffB);

  if (pA !== pB) return pA - pB;

  return diffA - diffB;
});

// ===== HEALTH =====
app.get("/", (req, res) => {
  res.send("alive");
});

// ===== START =====
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Bot running on port " + PORT);
});
