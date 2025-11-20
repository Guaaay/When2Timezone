const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

let db = { schedules: {} };

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    db = JSON.parse(raw);
  } catch (err) {
    db = { schedules: {} };
  }
}

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

function send(res, status, data, headers = {}) {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(payload);
}

function serveStatic(req, res) {
  const urlPath = req.url.split('?')[0];
  const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = safePath === '/' ? path.join(PUBLIC_DIR, 'index.html') : path.join(PUBLIC_DIR, safePath);

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const typeMap = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.png': 'image/png',
      '.svg': 'image/svg+xml'
    };
    res.writeHead(200, { 'Content-Type': typeMap[ext] || 'text/plain' });
    res.end(content);
  });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        resolve(parsed);
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function generateId() {
  return Math.random().toString(36).slice(2, 8);
}

function getTimezoneOffset(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const parts = fmt.formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return (asUTC - date.getTime()) / 60000;
}

function toUtc(dateStr, hour, minute, timeZone) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const initial = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const offset = getTimezoneOffset(initial, timeZone);
  return new Date(initial.getTime() - offset * 60000);
}

function buildSlots({ startDate, endDate, startHour, endHour, slotMinutes, baseTimeZone }) {
  const slots = [];
  const slotDayIndex = [];
  const days = [];

  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  const start = new Date(Date.UTC(sy, sm - 1, sd));
  const end = new Date(Date.UTC(ey, em - 1, ed));

  let dayCursor = new Date(start);
  let dayIndex = 0;
  while (dayCursor.getTime() <= end.getTime()) {
    const dayStr = `${dayCursor.getUTCFullYear()}-${String(dayCursor.getUTCMonth() + 1).padStart(2, '0')}-${String(
      dayCursor.getUTCDate()
    ).padStart(2, '0')}`;
    days.push(dayStr);
    const dayStartUtc = toUtc(dayStr, startHour, 0, baseTimeZone);
    const totalMinutes = (endHour - startHour) * 60;
    const slotCount = Math.max(0, Math.floor(totalMinutes / slotMinutes));
    for (let i = 0; i < slotCount; i++) {
      const slotStart = new Date(dayStartUtc.getTime() + i * slotMinutes * 60000);
      slots.push(slotStart.toISOString());
      slotDayIndex.push(dayIndex);
    }
    dayIndex += 1;
    dayCursor = new Date(dayCursor.getTime() + 24 * 60 * 60 * 1000);
  }

  return { slots, slotDayIndex, days };
}

function computeAggregated(schedule) {
  const counts = new Array(schedule.slots.length).fill(0);
  const list = Object.values(schedule.participants || {});
  list.forEach(p => {
    (p.availability || []).forEach(idx => {
      if (counts[idx] !== undefined) counts[idx] += 1;
    });
  });
  const maxCount = counts.reduce((a, b) => Math.max(a, b), 0);
  return { counts, maxCount, participants: list };
}

function requireSchedule(id) {
  const schedule = db.schedules[id];
  if (!schedule) return null;
  return schedule;
}

function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const segments = url.pathname.split('/').filter(Boolean);

  if (req.method === 'POST' && segments[0] === 'api' && segments[1] === 'schedules') {
    parseBody(req)
      .then(body => {
        const title = (body.title || '').trim();
        const startDate = (body.startDate || '').trim();
        const endDate = (body.endDate || startDate || '').trim();
        const startHour = Number(body.startHour);
        const endHour = Number(body.endHour);
        const slotMinutes = Number(body.slotMinutes) || 30;
        const baseTimeZone = (body.baseTimeZone || 'UTC').trim();
        if (!title || !startDate || Number.isNaN(startHour) || Number.isNaN(endHour)) {
          send(res, 400, { error: 'Missing required fields' });
          return;
        }
        if (endHour <= startHour) {
          send(res, 400, { error: 'End hour must be after start hour' });
          return;
        }
        if (!Number.isFinite(slotMinutes) || slotMinutes <= 0 || slotMinutes > 240) {
          send(res, 400, { error: 'Slot minutes must be between 1 and 240' });
          return;
        }
        if (!endDate) {
          send(res, 400, { error: 'End date is required' });
          return;
        }
        if (new Date(endDate) < new Date(startDate)) {
          send(res, 400, { error: 'End date must be the same or after start date' });
          return;
        }
        const id = generateId();
        const slotInfo = buildSlots({ startDate, endDate, startHour, endHour, slotMinutes, baseTimeZone });
        const schedule = {
          id,
          title,
          startDate,
          endDate,
          startHour,
          endHour,
          slotMinutes,
          baseTimeZone,
          slots: slotInfo.slots,
          slotDayIndex: slotInfo.slotDayIndex,
          days: slotInfo.days,
          participants: {},
          createdAt: new Date().toISOString()
        };
        db.schedules[id] = schedule;
        saveData();
        const aggregated = computeAggregated(schedule);
        send(res, 200, { schedule, aggregated });
      })
      .catch(() => send(res, 400, { error: 'Invalid JSON' }));
    return true;
  }

  if (segments[0] === 'api' && segments[1] === 'schedules' && segments[2]) {
    const scheduleId = segments[2];
    const schedule = requireSchedule(scheduleId);
    if (!schedule) {
      send(res, 404, { error: 'Schedule not found' });
      return true;
    }

    if (req.method === 'GET' && segments.length === 3) {
      const agg = computeAggregated(schedule);
      send(res, 200, { schedule, aggregated: agg });
      return true;
    }

    if (segments[3] === 'participants' && segments[4]) {
      const nameKey = decodeURIComponent(segments.slice(4).join('/'));
      if (req.method === 'GET') {
        const participant = schedule.participants[nameKey];
        send(res, 200, { participant: participant || null });
        return true;
      }
      if (req.method === 'PUT') {
        parseBody(req)
          .then(body => {
            const name = (body.name || '').trim();
            const timeZone = (body.timeZone || '').trim() || 'UTC';
            const availability = Array.isArray(body.availability) ? body.availability.map(Number) : [];
            if (!name) {
              send(res, 400, { error: 'Name is required' });
              return;
            }
            const safeAvailability = availability.filter(idx => Number.isInteger(idx) && idx >= 0 && idx < schedule.slots.length);
            schedule.participants[name] = {
              name,
              timeZone,
              availability: safeAvailability,
              updatedAt: new Date().toISOString()
            };
            saveData();
            const agg = computeAggregated(schedule);
            send(res, 200, { participant: schedule.participants[name], aggregated: agg });
          })
          .catch(() => send(res, 400, { error: 'Invalid JSON' }));
        return true;
      }
    }
  }
  return false;
}

function handler(req, res) {
  if (req.url.startsWith('/api')) {
    const handled = handleApi(req, res);
    if (handled) return;
  }
  serveStatic(req, res);
}

loadData();
const server = http.createServer(handler);
server.listen(PORT, () => {
  console.log(`When2Timezone running on http://localhost:${PORT}`);
});
