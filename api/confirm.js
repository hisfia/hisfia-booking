const { google } = require("googleapis");

function getAuth() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return auth;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  const { slot_start, slot_end, slot_label, name, email, company, phone, notes } = req.body || {};

  if (!name || !email || !slot_start || !slot_end) {
    return res.status(400).json({ ok: false, message: "Faltan campos obligatorios." });
  }

  const title = `Videollamada hisfia · ${name}${company ? ` (${company})` : ""}`;
  const descLines = [
    "Reserva desde hisfia booking page.",
    `Nombre: ${name}`, `Email: ${email}`,
    company ? `Empresa: ${company}` : null,
    phone   ? `Teléfono: ${phone}`  : null,
    notes   ? `Mensaje: ${notes}`   : null,
  ].filter(Boolean);

  try {
    const auth     = getAuth();
    const calendar = google.calendar({ version: "v3", auth });

    const eventBody = {
      summary:     title,
      description: descLines.join("\n"),
      start: { dateTime: slot_start, timeZone: "Europe/Madrid" },
      end:   { dateTime: slot_end,   timeZone: "Europe/Madrid" },
      attendees: [{ email }],
      conferenceData: {
        createRequest: {
          requestId: `hisfia-${Date.now()}`,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: "email",  minutes: 60 },
          { method: "popup",  minutes: 15 },
        ],
      },
    };

    const event = await calendar.events.insert({
      calendarId:            "primary",
      resource:              eventBody,
      conferenceDataVersion: 1,
      sendUpdates:           "all",
    });

    const meetUrl = event.data.hangoutLink || event.data.htmlLink || "";

    // Telegram notification
    const tgToken   = process.env.TELEGRAM_BOT_TOKEN;
    const tgOwnerId = process.env.TELEGRAM_OWNER_ID;
    if (tgToken && tgOwnerId) {
      const lines = [
        "📅 *Nueva reserva de videollamada*",
        `👤 *${name}*${company ? ` · ${company}` : ""}`,
        `📧 \`${email}\`${phone ? `  📞 ${phone}` : ""}`,
        `🗓 _${slot_label || slot_start}_`,
        notes ? `💬 _${notes}_` : null,
        meetUrl ? `🎥 [Enlace Meet](${meetUrl})` : null,
      ].filter(Boolean).join("\n");

      await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ chat_id: tgOwnerId, text: lines, parse_mode: "Markdown" }),
      }).catch(() => {});
    }

    res.status(200).json({ ok: true, meet_url: meetUrl });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: e.message });
  }
};
