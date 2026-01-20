require("dotenv").config();

const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const cron = require("node-cron");
const Twilio = require("twilio");

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const twilio = Twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Banco simples em memória (MVP)
const users = {};

function getUser(userId) {
  if (!users[userId]) {
    users[userId] = {
      profile: { tone: "amigavel" },
      agenda: [],
      finance: [],
      health: { sports: [], meds: [], supplements: [], meals: [] },
      memory: []
    };
  }
  return users[userId];
}

async function sendWhatsApp(to, text) {
  await twilio.messages.create({
    from: process.env.TWILIO_WHATSAPP_FROM,
    to,
    body: text
  });
}

async function askOpenAI(user, message) {
  const history = user.memory.slice(-6);

  const system = `
Você é o "Meu Faz Tudo", um assistente pessoal via WhatsApp.
Personalidade: amigável, humano e claro.
Organiza agenda, finanças básicas e rotina saudável
(esportes, medicações, suplementação e alimentação).
Nunca prescreve nem dá diagnóstico.
`;

  const messages = [
    { role: "system", content: system },
    ...history,
    { role: "user", content: message }
  ];

  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4.1-mini",
      messages
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      }
    }
  );

  return response.data.choices[0].message.content;
}

function uid() {
  return Math.random().toString(16).slice(2);
}

app.post("/whatsapp", async (req, res) => {
  const from = req.body.From;
  const body = req.body.Body;

  const user = getUser(from);
  user.memory.push({ role: "user", content: body });

  const reply = await askOpenAI(user, body);
  user.memory.push({ role: "assistant", content: reply });

  await sendWhatsApp(from, reply);
  res.sendStatus(200);
});

app.get("/", (req, res) => {
  res.send("Meu Faz Tudo está online ✅");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Meu Faz Tudo rodando 🚀"));
