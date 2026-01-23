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
// 📅 AGENDA / REUNIÕES (INTELIGENTE)
// =========================
if (user.agenda) {
  for (const item of user.agenda) {
  if (item.done) continue;
  if (!item.datetime) continue;

    const eventTime = new Date(item.datetime);

    // 🏢 PRESENCIAL → 1h antes
    if (item.type === "presencial") {
      const oneHourBefore = new Date(eventTime.getTime() - 60 * 60 * 1000);

      if (sameMinute(current, oneHourBefore) && !item.notified1) {
        try {
          await sendWhatsApp(
            userId,
            `⏰ Reunião presencial em 1 hora.`
          );
          item.notified1 = true;
          item.done = true;
        } catch (e) {
          console.error("Erro reunião presencial:", e);
        }
      }
    }

    // 💻 ONLINE → 20min e 5min antes
    if (item.type === "online") {
      const twentyMinBefore = new Date(eventTime.getTime() - 20 * 60 * 1000);
      const fiveMinBefore = new Date(eventTime.getTime() - 5 * 60 * 1000);

      if (sameMinute(current, twentyMinBefore) && !item.notified1) {
        try {
          await sendWhatsApp(
            userId,
            `💻 Reunião online em 20 minutos.`
          );
          item.notified1 = true;
        } catch (e) {
          console.error("Erro reunião online 20min:", e);
        }
      }

      if (sameMinute(current, fiveMinBefore) && !item.notified2) {
        try {
          await sendWhatsApp(
            userId,
            `💻 Reunião online em 5 minutos.`
          );
          item.notified2 = true;
          item.done = true;
        } catch (e) {
          console.error("Erro reunião online 5min:", e);
        }
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
// ======================================
// 🧠 COMANDOS DE SAÚDE + CONFIRMAÇÃO
// ======================================

function normalize(s) {
  return String(s || "").trim();
}

function isYes(text) {
  const t = normalize(text).toLowerCase();
  return ["sim", "s", "ok", "confirmo", "confirmar", "pode", "isso"].includes(t);
}

function isNo(text) {
  const t = normalize(text).toLowerCase();
  return ["não", "nao", "n", "cancela", "cancelar", "negativo"].includes(t);
}

function parseHHMM(text) {
  const m = normalize(text).match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

// Detecta comandos do tipo: "Esporte: corrida 07:00"
function parseHealthAdd(text) {
  const raw = normalize(text);

  const isSport = /^esporte\s*:/i.test(raw);
  const isMed = /^(rem[eé]dio|medic(a|á)ção|med)\s*:/i.test(raw);
  const isSupp = /^(suplemento|supp)\s*:/i.test(raw);

  if (!isSport && !isMed && !isSupp) return null;

  const category = isSport ? "sports" : isMed ? "meds" : "supplements";
  const afterColon = raw.split(":").slice(1).join(":").trim();

  const time = parseHHMM(afterColon);
  if (!time) return { error: "Preciso do horário no formato HH:MM. Ex: Esporte: corrida 07:00" };

  // label = tudo antes do horário
  const label = afterColon.replace(time, "").trim().replace(/\s+/g, " ");
  if (!label) return { error: "Me diga o nome. Ex: Suplemento: creatina 08:00" };

  return { category, label, time };
}

function parseHealthList(text) {
  return /^sa[uú]de\s*:\s*listar\s*$/i.test(normalize(text));
}

function parseHealthRemove(text) {
  const m = normalize(text).match(/^sa[uú]de\s*:\s*remover\s+(.+)\s*$/i);
  if (!m) return null;
  const label = m[1].trim();
  return label ? { label } : null;
}

function formatHealthList(user) {
  const lines = [];
  const sports = user.health?.sports || [];
  const meds = user.health?.meds || [];
  const sups = user.health?.supplements || [];

  if (!sports.length && !meds.length && !sups.length) {
    return "🩺 Você ainda não cadastrou nada de saúde. Ex: Esporte: corrida 07:00";
  }

  if (sports.length) {
    lines.push("🏃 Esportes:");
    for (const s of sports) lines.push(`- ${s.label} — ${s.time}`);
  }
  if (meds.length) {
    lines.push("💊 Medicações:");
    for (const m of meds) lines.push(`- ${m.label} — ${m.time}`);
  }
  if (sups.length) {
    lines.push("🧪 Suplementos:");
    for (const sp of sups) lines.push(`- ${sp.label} — ${sp.time}`);
  }

  lines.push("\nPara remover: Saúde: remover NOME");
  return lines.join("\n");
}

function handleHealthCommands(user, text) {
  // Confirmação pendente
  if (user.pendingHealth) {
    if (isYes(text)) {
      const { category, label, time } = user.pendingHealth;
      user.health[category].push({ label, time, lastNotified: null });
      user.pendingHealth = null;
      return `✅ Fechado. Salvei: ${label} às ${time}.`;
    }
    if (isNo(text)) {
      user.pendingHealth = null;
      return "❌ Cancelado. Me diga de novo quando quiser.";
    }
    return "Só pra confirmar: responde *sim* ou *não* 🙂";
  }

  // Listar
  if (parseHealthList(text)) {
    return formatHealthList(user);
  }

  // Remover
  const rem = parseHealthRemove(text);
  if (rem) {
    const target = rem.label.toLowerCase();
    const buckets = ["sports", "meds", "supplements"];
    let removed = 0;

    for (const b of buckets) {
      const arr = user.health[b] || [];
      const before = arr.length;
      user.health[b] = arr.filter(x => String(x.label).toLowerCase() !== target);
      removed += (before - user.health[b].length);
    }

    if (!removed) return `Não achei "${rem.label}" na sua saúde. Use "Saúde: listar" pra ver o que existe.`;
    return `🗑️ Removi "${rem.label}".`;
  }

  // Adicionar
  const add = parseHealthAdd(text);
  if (add) {
    if (add.error) return add.error;

    // cria pendência para confirmação
    user.pendingHealth = add;
    const tipo = add.category === "sports" ? "esporte" : add.category === "meds" ? "medicação" : "suplemento";
    return `Confirmar cadastro de ${tipo}: *${add.label}* às *${add.time}*? (sim/não)`;
  }

  return null; // não era comando de saúde
}
// ======================================
// 📅 COMANDOS DE REUNIÕES + CONFIRMAÇÃO
// ======================================

function parseDateTime(text) {
  const now = new Date();

  // hoje / amanhã
  if (/amanh[aã]/i.test(text)) {
    now.setDate(now.getDate() + 1);
  }

  const time = parseHHMM(text);
  if (!time) return null;

  const [hh, mm] = time.split(":").map(Number);
  now.setHours(hh, mm, 0, 0);

  return now;
}

function parseMeetingAdd(text) {
  const raw = normalize(text);

  if (!/^reuni[aã]o/i.test(raw)) return null;

  const isOnline = /online/i.test(raw);
  const isPresencial = /presencial/i.test(raw);

  if (!isOnline && !isPresencial) {
    return { error: "A reunião é presencial ou online?" };
  }

  const datetime = parseDateTime(raw);
  if (!datetime) {
    return { error: "Não entendi a data/hora. Ex: Reunião amanhã às 15h presencial" };
  }

  return {
    title: "Reunião",
    type: isOnline ? "online" : "presencial",
    datetime: datetime.toISOString()
  };
}

function parseMeetingList(text) {
  return /^reuni[oõ]es\s*:\s*listar\s*$/i.test(normalize(text));
}

function parseMeetingRemove(text) {
  const m = normalize(text).match(/^reuni[oõ]es\s*:\s*remover\s+(.+)\s*$/i);
  if (!m) return null;
  return { hint: m[1] };
}

function formatMeetings(user) {
  if (!user.agenda || !user.agenda.length) {
    return "📅 Você não tem reuniões cadastradas.";
  }

  const lines = ["📅 Suas reuniões:"];
  for (const m of user.agenda) {
    const dt = new Date(m.datetime);
    lines.push(
      `- ${m.type} em ${dt.toLocaleDateString("pt-BR")} às ${dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
    );
  }
  return lines.join("\n");
}

function handleMeetingCommands(user, text) {
  // confirmação pendente
  if (user.pendingMeeting) {
    if (isYes(text)) {
      const m = user.pendingMeeting;
      user.agenda.push({
        ...m,
        notified1: false,
        notified2: false
      });
      user.pendingMeeting = null;
      return `✅ Reunião ${m.type} confirmada para ${new Date(m.datetime).toLocaleString("pt-BR")}.`;
    }
    if (isNo(text)) {
      user.pendingMeeting = null;
      return "❌ Reunião cancelada.";
    }
    return "Só pra confirmar: responde *sim* ou *não* 🙂";
  }

  // listar
  if (parseMeetingList(text)) {
    return formatMeetings(user);
  }

  // remover
  const rem = parseMeetingRemove(text);
  if (rem) {
    user.agenda = [];
    return "🗑️ Reuniões removidas.";
  }

  // adicionar
  const add = parseMeetingAdd(text);
  if (add) {
    if (add.error) return add.error;
    user.pendingMeeting = add;
    return `Confirma reunião *${add.type}* em ${new Date(add.datetime).toLocaleString("pt-BR")}? (sim/não)`;
  }

  return null;
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

      // 0) comandos de reunião
const meetReply = handleMeetingCommands(user, body);
if (meetReply) {
  await sendWhatsApp(from, meetReply);
  return;
}

      // 1) tenta comandos de saúde primeiro (com confirmação)
const cmdReply = handleHealthCommands(user, body);
if (cmdReply) {
  await sendWhatsApp(from, cmdReply);
  return;
}

// 2) se não for comando, segue IA
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
