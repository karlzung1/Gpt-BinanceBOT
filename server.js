const express = require('express');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');
const cors = require('cors');

// Railway 환경 변수에서 토큰과 채팅 ID를 가져옵니다.
// 절대로 여기에 직접 문자열을 입력하지 마세요!
const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

// 토큰이 없으면 에러를 발생시키고 서버를 중지합니다.
if (!token || !chatId) {
  console.error('환경 변수(TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID)가 설정되지 않았습니다.');
  process.exit(1);
}

const bot = new TelegramBot(token);
const app = express();

// CORS와 body-parser 설정
app.use(cors());
app.use(bodyParser.json());

// 프론트엔드(App.js)에서 호출할 API 엔드포인트
app.post('/send-message', (req, res) => {
  const { message } = req.body; // 프론트에서 보낸 메시지 내용

  if (!message) {
    return res.status(400).send({ error: '메시지가 비어있습니다.' });
  }

  // 텔레그램 봇으로 메시지 전송
  bot.sendMessage(chatId, message)
    .then(() => {
      console.log('메시지 전송 성공:', message);
      res.status(200).send({ success: true, message: '메시지 전송 성공' });
    })
    .catch((error) => {
      console.error('메시지 전송 실패:', error);
      res.status(500).send({ success: false, message: '메시지 전송 실패' });
    });
});

// Railway가 제공하는 포트를 사용하거나, 기본으로 3001번 포트를 사용
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`서버가 ${PORT}번 포트에서 실행 중입니다.`);
});
