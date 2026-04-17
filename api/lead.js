module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  const { nombre, email, telefono, sector, source, quiz_answers } = req.body || {};

  if (!nombre || !email) {
    return res.status(400).json({ ok: false, message: "Faltan nombre y email." });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  // 1. Guardar en Supabase leads table
  try {
    await fetch(`${supabaseUrl}/rest/v1/leads`, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "apikey":        supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Prefer":        "return=minimal",
      },
      body: JSON.stringify({
        nombre,
        email,
        telefono: telefono || null,
        sector:   sector   || null,
        source:   source   || "web",
        quiz_answers: quiz_answers ? JSON.stringify(quiz_answers) : null,
        created_at: new Date().toISOString(),
      }),
    });
  } catch (e) {
    console.error("Supabase error:", e.message);
  }

  // 2. Notificar por Telegram
  const tgToken   = process.env.TELEGRAM_BOT_TOKEN;
  const tgOwnerId = process.env.TELEGRAM_OWNER_ID;
  if (tgToken && tgOwnerId) {
    const lines = [
      "🔥 *Nuevo lead desde la web*",
      `👤 *${nombre}*`,
      `📧 \`${email}\``,
      telefono ? `📞 ${telefono}` : null,
      sector   ? `🏢 ${sector}`   : null,
      source   ? `🌐 Origen: ${source}` : null,
      quiz_answers ? `📋 _Quiz respondido_` : null,
    ].filter(Boolean).join("\n");

    await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ chat_id: tgOwnerId, text: lines, parse_mode: "Markdown" }),
    }).catch(() => {});
  }

  res.status(200).json({ ok: true });
};
