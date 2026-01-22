require("dotenv").config();

const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const cron = require("node-cron"); // (mantido, mesmo não usado ainda)
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
// ================================
// 🔁 SCHEDULER CENTRAL (AUTOMAÇÃO)
// ================================

function now() {
  return new Date();
}

function sameMinute(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate() &&
    a.getHours() === b.getHours() &&
    a.getMinutes() === b.getMinutes()
  );
}

// Roda a cada 1 minuto
cron.schedule("* * * * *", async () => {
  const current = now();

  for (const userId in users) {
    const user = users[userId];

    // =========================
    // 📅 AGENDA / REUNIÕES
    // =========================
    if (user.agenda) {
      for (const item of user.agenda) {
        if (item.notified) continue;
        if (!item.datetime) continue;

        const eventTime = new Date(item.datetime);
        if (eventTime <= current) {
          try {
            await sendWhatsApp(
              userId,
              `⏰ Lembrete: ${item.title || "Compromisso"} agora.`
            );
            item.notified = true;
          } catch (e) {
            console.error("Erro agenda:", e);
          }
        }
      }
    }

    // =========================
    // 🏃 SAÚDE (ESPORTES / MEDS / SUPLEMENTOS)
    // =========================
    if (user.health) {
      const allHealth = [
        ...(user.health.sports || []),
        ...(user.health.meds || []),
        ...(user.health.supplements || [])
      ];

      for (const h of allHealth) {
        if (!h.time) continue;

        const target = new Date(current);
        const [hh, mm] = String(h.time).split(":");
        target.setHours(Number(hh), Number(mm), 0, 0);

        // dispara apenas 1x por minuto-alvo
        if (sameMinute(current, target)) {
          if (h.lastNotified && sameMinute(new Date(h.lastNotified), target)) continue;

          try {
            await sendWhatsApp(userId, `💪 Lembrete: ${h.label}`);
            h.lastNotified = target.toISOString();
          } catch (e) {
            console.error("Erro saúde:", e);
          }
        }
      }
    }

    // =========================
    // 💰 FINANÇAS (CONTAS)
    // =========================
    if (user.finance) {
      for (const bill of user.finance) {
        if (bill.notified) continue;
        if (!bill.dueDate) continue;

        const due = new Date(bill.dueDate);
        if (due <= current) {
          try {
            await sendWhatsApp(
              userId,
              `💸 Conta a pagar hoje: ${bill.title} — R$ ${bill.amount}`
            );
            bill.notified = true;
          } catch (e) {
            console.error("Erro finanças:", e);
          }
        }
      }
    }
  }
});

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

  const input = [
    { role: "system", content: system },
    ...history,
    { role: "user", content: message }
  ];

  try {
    const resp = await axios.post(
      "https://api.openai.com/v1/responses",
      {
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        input
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 15000
      }
    );

    // Extrai texto da Responses API
    const out = resp.data.output || [];
    const parts = [];

    for (const item of out) {
      if (item.type === "message" && item.content) {
        for (const c of item.content) {
          if (c.type === "output_text") parts.push(c.text);
        }
      }
    }

    const text = parts.join("\n").trim();
    return text || "Entendi 😊 Me diz só mais um detalhe pra eu organizar certinho?";
  } catch (err) {
    console.error("OpenAI erro:", err?.response?.data || err?.message || err);
    return "Tive um probleminha aqui 😅 Pode tentar de novo em 1 minutinho?";
  }
}

function uid() {
  return Math.random().toString(16).slice(2);
}

app.post("/whatsapp", (req, res) => {
  // Responde IMEDIATAMENTE ao Twilio via TwiML (evita 11200/502)
  try {
    res.set("Content-Type", "text/xml");
    res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Recebi! 😊 Já já eu te respondo.</Message>
</Response>`);
  } catch (e) {
    try { res.sendStatus(200); } catch (_) {}
  }

  // Processa em segundo plano
  setImmediate(async () => {
    try {
      const from = req.body?.From;
      const body = (req.body?.Body || "").trim();
      if (!from) return;

      const user = getUser(from);
      user.memory.push({ role: "user", content: body });

      const reply = await askOpenAI(user, body);
      user.memory.push({ role: "assistant", content: reply });

      await sendWhatsApp(from, reply);
    } catch (err) {
      console.error("Erro no processamento:", err?.response?.data || err?.message || err);
      try {
        if (req.body?.From) {
          await sendWhatsApp(req.body.From, "Tive um erro rapidinho 😅 tenta de novo em 1 minutinho.");
        }
      } catch (_) {}
    }
  });
});

app.get("/", (req, res) => {
  res.send("Meu Faz Tudo está online ✅");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Meu Faz Tudo rodando 🚀"));
