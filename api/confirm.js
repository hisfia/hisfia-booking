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

  // ── Validación server-side ────────────────────────────────────────────
  const cleanName  = (name  || "").trim();
  const cleanEmail = (email || "").trim().toLowerCase();
  const cleanPhone = (phone || "").trim();

  if (!cleanName || !cleanEmail || !slot_start || !slot_end) {
    return res.status(400).json({ ok: false, message: "Faltan campos obligatorios." });
  }
  if (cleanName.length < 2 || /\d/.test(cleanName)) {
    return res.status(400).json({ ok: false, message: "El nombre no es válido." });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanEmail)) {
    return res.status(400).json({ ok: false, message: "El email no tiene un formato válido." });
  }
  if (cleanPhone) {
    const p = cleanPhone.replace(/[\s\-\.\(\)]/g, "").replace(/^00/, "+");
    if (!/^\+\d{7,15}$/.test(p) && !/^[6-9]\d{8}$/.test(p)) {
      return res.status(400).json({ ok: false, message: "El formato del teléfono no es válido." });
    }
  }
  // Validar que slot_start y slot_end sean fechas ISO válidas
  if (isNaN(Date.parse(slot_start)) || isNaN(Date.parse(slot_end))) {
    return res.status(400).json({ ok: false, message: "El horario seleccionado no es válido." });
  }

  const title = `Videollamada hisfia · ${cleanName}${company ? ` (${company.trim()})` : ""}`;
  const descLines = [
    "Reserva desde hisfia booking page.",
    `Nombre: ${cleanName}`, `Email: ${cleanEmail}`,
    company ? `Empresa: ${company.trim()}` : null,
    cleanPhone ? `Teléfono: ${cleanPhone}` : null,
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
      attendees: [{ email: cleanEmail }],
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

      const btns = [];
      if (cleanPhone) {
        btns.push({ text: "📞 Llamar", callback_data: `lead_call:${cleanPhone}`.slice(0, 64) });
      }
      btns.push({ text: "📧 Enviar email", callback_data: `lead_email:${cleanEmail}:${cleanName}`.slice(0, 64) });

      await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          chat_id:      tgOwnerId,
          text:         lines,
          parse_mode:   "Markdown",
          reply_markup: { inline_keyboard: [btns] },
        }),
      }).catch(() => {});
    }

    res.status(200).json({ ok: true, meet_url: meetUrl });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: e.message });
  }
};
