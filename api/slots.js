const { google } = require("googleapis");

function getAuth() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return auth;
}

// Madrid UTC offset in minutes (negative = ahead of UTC)
function madridOffsetMin(date) {
  // Last Sunday of March → +2, last Sunday of October → +1
  const y = date.getUTCFullYear();
  const dstStart = lastSundayOf(y, 2, 2); // March, 02:00 UTC
  const dstEnd   = lastSundayOf(y, 9, 1); // October, 01:00 UTC
  const t = date.getTime();
  return (t >= dstStart && t < dstEnd) ? -120 : -60;
}

function lastSundayOf(year, month, utcHour) {
  // Find last Sunday of given month (0-indexed)
  const d = new Date(Date.UTC(year, month + 1, 0)); // last day
  d.setUTCDate(d.getUTCDate() - d.getUTCDay()); // rewind to Sunday
  d.setUTCHours(utcHour, 0, 0, 0);
  return d.getTime();
}

function offsetStr(offsetMin) {
  const abs = Math.abs(offsetMin);
  const h = String(Math.floor(abs / 60)).padStart(2, "0");
  const m = String(abs % 60).padStart(2, "0");
  return (offsetMin <= 0 ? "+" : "-") + h + ":" + m;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const auth     = getAuth();
    const calendar = google.calendar({ version: "v3", auth });

    // Collect next 7 working days (Mon–Fri) from tomorrow
    const todayUTC = new Date(); todayUTC.setUTCHours(0,0,0,0);
    const workingDays = [];
    let cursor = new Date(todayUTC);
    while (workingDays.length < 7) {
      cursor = new Date(cursor.getTime() + 86400000);
      const dow = cursor.getUTCDay();
      if (dow !== 0 && dow !== 6) workingDays.push(new Date(cursor));
    }

    const rangeStart = new Date(workingDays[0]);
    const rangeEnd   = new Date(workingDays[workingDays.length - 1].getTime() + 86400000);

    // Free/busy
    const fb = await calendar.freebusy.query({
      requestBody: {
        timeMin: rangeStart.toISOString(),
        timeMax: rangeEnd.toISOString(),
        timeZone: "Europe/Madrid",
        items: [{ id: "primary" }],
      },
    });
    const busy = (fb.data.calendars?.primary?.busy || []).map(b => ({
      start: new Date(b.start).getTime(),
      end:   new Date(b.end).getTime(),
    }));

    const now = Date.now();
    const slots = [];

    for (const wd of workingDays) {
      const y = wd.getUTCFullYear();
      const mo = wd.getUTCMonth();
      const day = wd.getUTCDate();
      const dateStr = `${y}-${String(mo+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;

      for (let h = 9; h < 18; h++) {
        for (const m of [0, 30]) {
          // Build as Madrid local time → UTC
          const localMs = Date.UTC(y, mo, day, h, m, 0);
          const off = madridOffsetMin(new Date(localMs));
          const slotStartUTC = localMs + off * 60000; // Madrid local → UTC
          const slotEndUTC   = slotStartUTC + 30 * 60000;

          if (slotStartUTC <= now) continue;
          const overlap = busy.some(b => slotStartUTC < b.end && slotEndUTC > b.start);
          if (overlap) continue;

          const iso = `${dateStr}T${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:00${offsetStr(off)}`;
          const endH = h + (m === 30 ? 1 : 0);
          const endM = m === 30 ? 0 : 30;
          const isoEnd = `${dateStr}T${String(endH).padStart(2,"0")}:${String(endM).padStart(2,"0")}:00${offsetStr(off)}`;

          slots.push({
            date:      dateStr,
            time:      `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`,
            start_iso: iso,
            end_iso:   isoEnd,
          });
        }
      }
    }

    res.status(200).json({ ok: true, slots });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
};
