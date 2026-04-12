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

// WEATHERAPI
const WEATHER_API_KEY = process.env.WEATHER_API_KEY;
const CITY = "Ho Chi Minh";

// ===== MEMORY =====
let isPausedToday = false;
let pausedDate = "";

// ===== TELEGRAM =====
async function sendTelegram(chatId, text) {
  await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    chat_id: chatId,
    text: text,
    parse_mode: "Markdown",
  });
}

// ===== TIME =====
function getNowVN() {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" })
  );
}

// ===== WEATHER BASIC =====
async function getWeather() {
  try {
    const url = `http://api.weatherapi.com/v1/current.json?key=${WEATHER_API_KEY}&q=${CITY}&lang=vi`;
    const res = await axios.get(url);

    const d = res.data;

    return {
      temp: d.current.temp_c,
      feels: d.current.feelslike_c,
      humidity: d.current.humidity,
      wind: d.current.wind_kph,
      condition: d.current.condition.text,
      city: d.location.name,
      time: d.location.localtime,
    };
  } catch (err) {
    console.log("WEATHER ERROR:", err.message);
    return null;
  }
}

async function formatWeatherBasic() {
  const w = await getWeather();
  if (!w) return "";

  return `
🌤 *${w.city}*
_${w.condition}_

🌡 *${w.temp}°C* (cảm giác ${w.feels}°C)
💧 ${w.humidity}% • 🌬 ${w.wind} km/h

━━━━━━━━━━━━━━
`;
}

// ===== WEATHER DETAIL =====
async function formatWeatherDetail() {
  try {
    const url = `http://api.weatherapi.com/v1/forecast.json?key=${WEATHER_API_KEY}&q=${CITY}&days=3&aqi=yes&alerts=yes&lang=vi`;
    const res = await axios.get(url);

    const d = res.data;
    const current = d.current;

    let msg = `
🌍 *THỜI TIẾT FULL DETAIL*

📍 *${d.location.name}, ${d.location.country}*
🕒 ${d.location.localtime}

━━━━━━━━━━━━━━
🌤 *HIỆN TẠI*
_${current.condition.text}_

🌡 ${current.temp_c}°C (feels ${current.feelslike_c}°C)
💧 ${current.humidity}%
🌬 ${current.wind_kph} km/h (${current.wind_dir})
💨 Gust: ${current.gust_kph} km/h
👁 ${current.vis_km} km
📊 Pressure: ${current.pressure_mb} mb
☀️ UV: ${current.uv}

🌧 Rain: ${current.precip_mm} mm
☁️ Cloud: ${current.cloud}%

📊 AQI (PM2.5): ${current.air_quality?.pm2_5?.toFixed(1) || "N/A"}

━━━━━━━━━━━━━━
📅 *DỰ BÁO 3 NGÀY*
`;

    d.forecast.forecastday.forEach(day => {
      msg += `
📆 ${day.date}

🌡 ${day.day.mintemp_c}°C - ${day.day.maxtemp_c}°C
_${day.day.condition.text}_

💧 ${day.day.avghumidity}%
🌧 ${day.day.daily_chance_of_rain}%
☀️ UV: ${day.day.uv}

🌅 ${day.astro.sunrise} | 🌇 ${day.astro.sunset}
🌙 ${day.astro.moon_phase}
`;
    });

    msg += `\n━━━━━━━━━━━━━━\n🕒 *DỰ BÁO THEO GIỜ (12h tới)*`;

    const hours = d.forecast.forecastday[0].hour.slice(0, 12);

    hours.forEach(h => {
      const time = h.time.split(" ")[1];

      msg += `
🕒 ${time}
🌡 ${h.temp_c}°C (feels ${h.feelslike_c})
💧 ${h.humidity}%
🌧 ${h.chance_of_rain}%
🌬 ${h.wind_kph} km/h
_${h.condition.text}_
`;
    });

    msg += `\n━━━━━━━━━━━━━━\n⏰ _Realtime update_`;

    return msg;

  } catch (err) {
    console.log(err);
    return "❌ Lỗi lấy weather detail";
  }
}

// ===== DATE =====
function parseVNDate(dateStr) {
  if (!dateStr) return null;

  const [datePart, timePart] = dateStr.split(" ");
  const [day, month, year] = datePart.split("/");
  let [hour, minute, second] = timePart.split(":");

  return new Date(year, month - 1, day, hour, minute, second);
}

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

function getRemainingTime(diff) {
  if (diff <= 0) return "Đã hết hạn";

  let days = Math.floor(diff / (1000 * 60 * 60 * 24));
  let hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  let mins = Math.floor((diff / (1000 * 60)) % 60);

  return `${days}d ${hours}h ${mins}m`;
}

// ===== TASK =====
async function formatTasks(rows) {
  let now = getNowVN();

  // SORT
  rows.sort((a, b) => {
    const dateA = parseVNDate(a["End Time"]);
    const dateB = parseVNDate(b["End Time"]);

    if (!dateA) return 1;
    if (!dateB) return -1;

    const diffA = dateA - now;
    const diffB = dateB - now;

    if (diffA <= 0 && diffB > 0) return 1;
    if (diffB <= 0 && diffA > 0) return -1;

    return diffA - diffB;
  });

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

  const weather = await formatWeatherBasic();

  let msg = `📅 *${todayHeader}*\n━━━━━━━━━━━━━━\n\n`;
  msg += weather;

  msg += `📊 *Tổng: ${total}*\n`;
  msg += `🔥 Sắp hết: ${urgent}\n`;
  msg += `✅ Còn hạn: ${normal}\n`;
  msg += `❌ Hết hạn: ${expired}\n\n`;

  msg += `👉 [Mở Sheet](https://docs.google.com/spreadsheets/d/${SHEET_ID})\n\n`;

  msg += `━━━━━━━━━━━━━━\n\n`;
  msg += body;

  return msg || "Không có công việc nào";
}

// ===== SHEET =====
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
    return sendTelegram(chatId, "⛔ Đã tắt hôm nay");
  }

  if (text === "/restart") {
    isPausedToday = false;
    return sendTelegram(chatId, "▶️ Đã bật lại");
  }

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

// ===== AUTO =====
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

// ===== HEALTH =====
app.get("/", (req, res) => {
  res.send("alive");
});

// ===== START =====
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Bot running on port " + PORT);
});
