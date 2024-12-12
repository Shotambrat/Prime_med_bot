const express = require("express");
const axios = require("axios");
const https = require("https");
const md5 = require("md5");
const fs = require("fs");
const path = require("path");
const TelegramBot = require("node-telegram-bot-api");

const app = express();
const ucmData = {
  ip: "192.166.231.221",
  port: "10450",
  username: "cdrapi",
  password: "cdrapi123",
  apiUrl: `https://192.166.231.221:10450/api`,
};

function getHourTime() {
  let now = new Date();
  let oneHourAgo = new Date(now.getTime() - 3600000);
  let formattedTime = oneHourAgo.toISOString().replace("Z", "+05:00");
  console.log("FORMATED TIME ##################################",formattedTime);
  return formattedTime;
}
// 6442868170:AAEL3S-PAWzVhO20FtiTar7U7Jp1mXaNO6g
// -1002138763777

const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const bot = new TelegramBot("7438879701:AAHdA2DjlXDmbIQ49VLY39o4ABLlkq6qUo8", {
  polling: true,
});
const chatId = -1002236832717;
let lastUniqueId = "";

async function authenticate() {
  let response = await axios.post(
    `${ucmData.apiUrl}`,
    { request: { action: "challenge", user: "cdrapi", version: "1.0" } },
    { httpsAgent }
  );
  let challenge = response.data.response.challenge;
  let token = md5(challenge + ucmData.password);
  response = await axios.post(
    `${ucmData.apiUrl}`,
    { request: { action: "login", token, user: ucmData.username } },
    { httpsAgent }
  );
  return response.data.response.cookie;
}

async function fetchCDR(cookie) {
  const startTime = getHourTime();
  const response = await axios.post(
    `${ucmData.apiUrl}`,
    {
      request: {
        action: "cdrapi",
        cookie,
        format: "json",
        numRecords: "200",
        startTime,
        minDur: 10,
      },
    },
    { httpsAgent }
  );


  return response.data;
}

async function sendRecMessage(time, src, dst, cookie) {
  const date = new Date(time);
  let dateOfRec = Math.floor(date.getTime() / 1000);

  const filename = `auto-${dateOfRec}-${src}-${dst == 210 || dst == 201 ? 6500 : dst}.wav`;
  console.log("FILENAME ##",filename);
  const localPath = path.resolve(__dirname, filename);

  let response = await axios.post(
    `${ucmData.apiUrl}`,
    { request: { action: "recapi", cookie, filedir: "monitor", filename } },
    { responseType: "stream", httpsAgent }
  );

  if (response.headers["content-length"] > 60) {
    const writer = fs.createWriteStream(localPath);
    response.data.pipe(writer);
    writer.on("finish", async () => {
      try {
        const voiceStream = fs.createReadStream(localPath);
        await bot.sendVoice(chatId, voiceStream, {
          caption: "Запись разговора",
        });
        console.log("Голосовое сообщение успешно отправлено!");
      } catch (error) {
        console.error("Ошибка при отправке голосового сообщения:", error);
      } finally {
        fs.unlinkSync(localPath); // Удаляем файл после отправки
      }
    });
  } else {
    console.log("Получен пустой файл, сообщение не отправлено.");
    bot.sendMessage(chatId, "Запись к этому звонку не существует");
  }
}

async function sendToTelegram(cdr, cookie) {
  const message = `Новый звонок:
  - От кого: ${cdr.src == 201 || cdr.src == 204 ? cdr.src : "+998" + cdr.src}
  - Куда: ${cdr.dst == 201 || cdr.dst == 202 || cdr.dst == 210 ? "+998781131343" : "+998" + cdr.dst}
  - Начало: ${cdr.start} 
  - Конец: ${cdr.end} 
  - Длительность: ${cdr.duration} секунд
  - Статус: ${cdr.disposition == "ANSWERED" ? "#Отвечен" : "#Не отвечен"}`;
  console.log(message);
  bot.sendMessage(chatId, message);
  await sendRecMessage(cdr.start, cdr.src, cdr.dst, cookie);
  lastUniqueId = cdr.uniqueid;
}

app.listen(3000, async () => {
  console.log("Server running on http://localhost:3000");
  const cookie = await authenticate();
  setInterval(async () => {
    const cdrData = await fetchCDR(cookie);
    if (
      cdrData &&
      cdrData.response &&
      cdrData.response.cdr_root &&
      cdrData.response.cdr_root.length > 0
    ) {
      const lastCall =
        cdrData.response.cdr_root[cdrData.response.cdr_root.length - 1];
      if (lastCall.uniqueid !== lastUniqueId) {
        sendToTelegram(lastCall, cookie);
      }
    }
    console.log("It.s ok yet");
  }, 3000);
});