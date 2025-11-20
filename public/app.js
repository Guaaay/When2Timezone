(() => {
  const loadForm = document.getElementById('load-form');
  const participantTzSelect = document.getElementById('participant-timezone');
  const participantNameInput = document.getElementById('participant-name');
  const loadParticipantBtn = document.getElementById('load-participant');
  const saveAvailabilityBtn = document.getElementById('save-availability');
  const scheduleTitleEl = document.getElementById('schedule-title');
  const scheduleRangeEl = document.getElementById('schedule-range');
  const shareLinkEl = document.getElementById('share-link');
  const metaPillsEl = document.getElementById('meta-pills');
  const appEl = document.getElementById('app');
  const bandsEl = document.getElementById('bands');
  const topSlotsEl = document.getElementById('top-slots');
  const yourTableEl = document.getElementById('your-table');
  const groupTableEl = document.getElementById('group-table');
  let tooltipEl = createTooltip();

  const state = {
    schedule: null,
    aggregated: null,
    selected: new Set(),
    viewerTimeZone: guessTimeZone(),
    drag: {
      active: false,
      mode: null
    }
  };

  function guessTimeZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch (err) {
      return 'UTC';
    }
  }

  function supportedTimeZones() {
    if (typeof Intl.supportedValuesOf === 'function') {
      return Intl.supportedValuesOf('timeZone');
    }
    return [
      'UTC',
      'America/Los_Angeles',
      'America/Denver',
      'America/Chicago',
      'America/New_York',
      'Europe/London',
      'Europe/Berlin',
      'Europe/Paris',
      'Asia/Dubai',
      'Asia/Kolkata',
      'Asia/Shanghai',
      'Asia/Tokyo',
      'Australia/Sydney'
    ];
  }

  function populateTimeZones(select, preferred) {
    if (!select) return;
    const tzs = supportedTimeZones();
    select.innerHTML = '';
    tzs.forEach(tz => {
      const opt = document.createElement('option');
      opt.value = tz;
      opt.textContent = tz;
      if (tz === preferred) opt.selected = true;
      select.appendChild(opt);
    });
  }

  function pad(num) {
    return num.toString().padStart(2, '0');
  }

  function formatSlot(iso, tz) {
    return new Date(iso).toLocaleString(undefined, {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function formatRange(iso, minutes, tz) {
    const start = new Date(iso);
    const end = new Date(start.getTime() + minutes * 60000);
    const startStr = start.toLocaleString(undefined, { timeZone: tz, hour: '2-digit', minute: '2-digit' });
    const endStr = end.toLocaleString(undefined, { timeZone: tz, hour: '2-digit', minute: '2-digit' });
    const dayStr = start.toLocaleDateString(undefined, { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' });
    return `${startStr} - ${endStr} (${dayStr})`;
  }

  function formatDay(dateStr, tz) {
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' });
  }

  function slotColor(count, max) {
    if (max === 0 || count === 0) return 'rgba(255,255,255,0.03)';
    const intensity = count / max;
    const alpha = 0.18 + intensity * 0.5;
    return `rgba(79, 129, 255, ${alpha})`;
  }

  function setStatus(text) {
    if (scheduleTitleEl) scheduleTitleEl.textContent = text;
  }

  function createTooltip() {
    if (typeof document === 'undefined' || !document.body) return null;
    const el = document.createElement('div');
    el.className = 'hover-card';
    document.body.appendChild(el);
    return el;
  }

  function showTooltip({ idx, iso, dayStr, tz, anchorEvent }) {
    if (!tooltipEl) tooltipEl = createTooltip();
    if (!tooltipEl) return;
    const names = namesAvailableAt(idx);
    const count = state.aggregated ? state.aggregated.counts[idx] : 0;
    const timeLabel = formatSlot(iso, tz);
    tooltipEl.innerHTML = `
      <h5>${timeLabel}</h5>
      <div class="hover-meta">${dayStr}</div>
      <div class="hover-names">${names.length ? names.join(', ') : 'No one available yet'}</div>
      <div class="hover-meta">${count} currently available</div>
    `;
    tooltipEl.style.display = 'block';
    positionTooltip(anchorEvent);
  }

  function positionTooltip(evt) {
    if (!tooltipEl || !evt) return;
    const padding = 12;
    const width = tooltipEl.offsetWidth || 240;
    const height = tooltipEl.offsetHeight || 120;
    let left = evt.clientX + 14;
    let top = evt.clientY + 14;
    if (left + width + padding > window.innerWidth) {
      left = window.innerWidth - width - padding;
    }
    if (top + height + padding > window.innerHeight) {
      top = window.innerHeight - height - padding;
    }
    tooltipEl.style.left = `${left}px`;
    tooltipEl.style.top = `${top}px`;
  }

  function hideTooltip() {
    if (!tooltipEl) return;
    tooltipEl.style.display = 'none';
  }

  async function loadSchedule(id) {
    if (!id) return;
    try {
      const res = await fetch(`/api/schedules/${encodeURIComponent(id)}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Unable to load schedule');
      }
      pushQueryId(id);
      hydrateSchedule(data.schedule, data.aggregated);
    } catch (err) {
      setStatus('No schedule loaded');
      if (scheduleRangeEl) scheduleRangeEl.textContent = 'Could not load schedule. Double-check the ID or try again.';
      if (shareLinkEl) shareLinkEl.hidden = true;
      console.error(err);
      if (err?.message) alert(err.message);
    }
  }

  function pushQueryId(id) {
    const url = new URL(window.location.href);
    url.searchParams.set('schedule', id);
    window.history.replaceState({}, '', url.toString());
  }

  function hydrateSchedule(schedule, aggregated) {
    state.schedule = schedule;
    state.aggregated = aggregated || null;
    state.selected = new Set();
    if (loadForm && loadForm.scheduleId) loadForm.scheduleId.value = schedule.id;
    renderMeta();
    renderBands();
    renderTables();
    renderTopSlots();
    if (appEl) appEl.dataset.loaded = 'true';
  }

  function renderMeta() {
    if (!state.schedule || !scheduleRangeEl || !shareLinkEl || !metaPillsEl) {
      setStatus('No schedule loaded');
      if (scheduleRangeEl) scheduleRangeEl.textContent = '';
      if (shareLinkEl) shareLinkEl.hidden = true;
      if (metaPillsEl) metaPillsEl.innerHTML = '';
      return;
    }
    const s = state.schedule;
    setStatus(s.title);
    const rangeText =
      s.startDate === s.endDate
        ? `${s.startDate} from ${pad(s.startHour)}:00 to ${pad(s.endHour)}:00`
        : `${s.startDate} → ${s.endDate}, ${pad(s.startHour)}:00-${pad(s.endHour)}:00`;
    scheduleRangeEl.textContent = `${rangeText} (${s.slotMinutes}m slots)`;
    const url = new URL(window.location.href);
    url.searchParams.set('schedule', s.id);
    if (shareLinkEl) {
      shareLinkEl.textContent = url.toString();
      shareLinkEl.hidden = false;
    }
    if (!metaPillsEl) return;
    metaPillsEl.innerHTML = '';
    const pill = (label) => {
      const el = document.createElement('div');
      el.className = 'pill';
      el.textContent = label;
      return el;
    };
    metaPillsEl.appendChild(pill(`Base TZ: ${s.baseTimeZone}`));
    metaPillsEl.appendChild(pill(`${s.slots.length} slots`));
    if (state.aggregated) {
      metaPillsEl.appendChild(pill(`Participants: ${state.aggregated.participants.length}`));
    }
  }

  function toggleSlot(idx, targetEl) {
    if (state.selected.has(idx)) {
      state.selected.delete(idx);
      if (targetEl) targetEl.classList.remove('you-selected');
    } else {
      state.selected.add(idx);
      if (targetEl) targetEl.classList.add('you-selected');
    }
  }

  function startDrag(evt, idx, el) {
    evt.preventDefault();
    state.drag.active = true;
    state.drag.mode = state.selected.has(idx) ? 'remove' : 'add';
    applyDragSelection(idx, el);
  }

  function dragOver(idx, el) {
    if (!state.drag.active || !state.drag.mode) return;
    applyDragSelection(idx, el);
  }

  function applyDragSelection(idx, el) {
    const shouldAdd = state.drag.mode === 'add';
    if (shouldAdd && !state.selected.has(idx)) {
      state.selected.add(idx);
      if (el) el.classList.add('you-selected');
    } else if (!shouldAdd && state.selected.has(idx)) {
      state.selected.delete(idx);
      if (el) el.classList.remove('you-selected');
    }
  }

  async function loadParticipant() {
    if (!state.schedule) return alert('Load a schedule first.');
    const name = participantNameInput ? participantNameInput.value.trim() : '';
    if (!name) return alert('Enter your name first.');
    const res = await fetch(`/api/schedules/${encodeURIComponent(state.schedule.id)}/participants/${encodeURIComponent(name)}`);
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Could not fetch participant');
      return;
    }
    if (!data.participant) {
      alert('No saved availability with that name yet.');
      return;
    }
    state.selected = new Set(data.participant.availability || []);
    if (participantTzSelect) participantTzSelect.value = data.participant.timeZone || state.viewerTimeZone;
    renderTables();
    renderBands();
    renderTopSlots();
  }

  async function saveAvailability() {
    if (!state.schedule) return alert('Load a schedule first.');
    const name = participantNameInput ? participantNameInput.value.trim() : '';
    if (!name) return alert('Enter your name.');
    const availability = Array.from(state.selected.values());
    const body = { name, timeZone: participantTzSelect ? participantTzSelect.value : 'UTC', availability };
    const res = await fetch(`/api/schedules/${encodeURIComponent(state.schedule.id)}/participants/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Could not save availability');
      return;
    }
    state.aggregated = data.aggregated;
    renderMeta();
    renderBands();
    renderTables();
    renderTopSlots();
  }

  function renderBands() {
    if (!bandsEl) return;
    bandsEl.innerHTML = '';
    if (!state.schedule) return;
    const tzSet = new Set();
    tzSet.add(participantTzSelect ? participantTzSelect.value : state.viewerTimeZone);
    (state.aggregated?.participants || []).forEach(p => tzSet.add(p.timeZone));
    const tzs = Array.from(tzSet);
    const dayIndex = state.schedule.slotDayIndex || Array(state.schedule.slots.length).fill(0);
    tzs.forEach(tz => {
      const band = document.createElement('div');
      band.className = 'band';
      const label = document.createElement('div');
      label.className = 'band-label';
      label.textContent = tz;
      const track = document.createElement('div');
      track.className = 'band-track';
      const max = state.aggregated ? state.aggregated.maxCount : 0;
      state.schedule.slots.forEach((iso, idx) => {
        const cell = document.createElement('div');
        cell.className = 'band-cell';
        if (idx % Math.ceil(60 / state.schedule.slotMinutes) === 0) {
          cell.dataset.time = formatSlot(iso, tz);
        } else {
          cell.dataset.time = '';
        }
        const count = state.aggregated ? state.aggregated.counts[idx] : 0;
        cell.style.background = slotColor(count, max);
        if (idx > 0 && dayIndex[idx] !== dayIndex[idx - 1]) {
          cell.classList.add('band-separator');
        }
        track.appendChild(cell);
      });
      band.appendChild(label);
      band.appendChild(track);
      bandsEl.appendChild(band);
    });
  }

  function groupSlotsByDay() {
    if (!state.schedule) return { days: [], grouped: [] };
    const days = state.schedule.days && state.schedule.days.length ? state.schedule.days : [state.schedule.startDate];
    const grouped = days.map(() => []);
    const indices = state.schedule.slotDayIndex || [];
    state.schedule.slots.forEach((iso, idx) => {
      const d = indices[idx] ?? 0;
      if (!grouped[d]) grouped[d] = [];
      grouped[d].push({ iso, idx });
    });
    return { days, grouped };
  }

  function namesAvailableAt(idx) {
    if (!state.aggregated || !state.aggregated.participants) return [];
    const names = [];
    state.aggregated.participants.forEach(p => {
      if (Array.isArray(p.availability) && p.availability.includes(idx)) names.push(p.name || 'Unknown');
    });
    return names;
  }

  function renderTable(target, mode) {
    if (!target || !state.schedule) return;
    target.innerHTML = '';
    const { days, grouped } = groupSlotsByDay();
    if (!grouped.length || !grouped[0]) return;
    const rowsPerDay = grouped[0].length;
    const tz = participantTzSelect ? participantTzSelect.value : state.viewerTimeZone;
    const max = state.aggregated ? state.aggregated.maxCount : 0;

    const head = document.createElement('div');
    head.className = 'heat-row head';
    head.style.gridTemplateColumns = `120px repeat(${days.length}, 1fr)`;
    const empty = document.createElement('div');
    empty.className = 'heat-time';
    head.appendChild(empty);
    days.forEach(day => {
      const cell = document.createElement('div');
      cell.className = 'heat-cell head-cell';
      cell.style.border = 'none';
      cell.style.background = 'transparent';
      cell.innerHTML = `<strong>${formatDay(day, tz)}</strong>`;
      head.appendChild(cell);
    });
    target.appendChild(head);

    for (let r = 0; r < rowsPerDay; r++) {
      const row = document.createElement('div');
      row.className = 'heat-row';
      row.style.gridTemplateColumns = `120px repeat(${days.length}, 1fr)`;
      const time = document.createElement('div');
      time.className = 'heat-time';
      const sample = grouped[0][r];
      time.textContent = sample ? formatSlot(sample.iso, tz) : '';
      row.appendChild(time);

      days.forEach((dayStr, di) => {
        const entry = grouped[di][r];
        const cell = document.createElement('div');
        cell.className = 'heat-cell';
        if (entry) {
          const count = state.aggregated ? state.aggregated.counts[entry.idx] : 0;
          cell.style.background = slotColor(count, max);
          const hoverPayload = { idx: entry.idx, iso: entry.iso, dayStr: formatDay(dayStr, tz), tz };
          if (mode === 'you') {
            if (state.selected.has(entry.idx)) {
              cell.classList.add('you-selected');
            }
            cell.dataset.index = entry.idx;
            cell.addEventListener('mousedown', (evt) => startDrag(evt, entry.idx, cell));
            cell.addEventListener('mouseover', () => dragOver(entry.idx, cell));
            cell.addEventListener('mouseenter', (evt) => showTooltip({ ...hoverPayload, anchorEvent: evt }));
            cell.addEventListener('mousemove', positionTooltip);
            cell.addEventListener('mouseleave', hideTooltip);
          } else if (mode === 'group') {
            if (count > 0) {
              const label = document.createElement('span');
              label.className = 'count';
              label.textContent = `${count}`;
              cell.appendChild(label);
            }
            cell.addEventListener('mouseenter', (evt) => showTooltip({ ...hoverPayload, anchorEvent: evt }));
            cell.addEventListener('mousemove', positionTooltip);
            cell.addEventListener('mouseleave', hideTooltip);
          }
        }
        row.appendChild(cell);
      });
      target.appendChild(row);
    }
  }

  function renderTables() {
    renderTable(yourTableEl, 'you');
    renderTable(groupTableEl, 'group');
  }

  function renderTopSlots() {
    if (!topSlotsEl) return;
    topSlotsEl.innerHTML = '';
    if (!state.schedule || !state.aggregated) {
      topSlotsEl.textContent = 'No overlap yet. Mark availability to see matches.';
      return;
    }
    const pairs = state.aggregated.counts
      .map((count, idx) => ({ count, idx }))
      .filter(p => p.count > 0)
      .sort((a, b) => b.count - a.count);
    if (pairs.length === 0) {
      topSlotsEl.textContent = 'No overlap yet. Mark availability to see matches.';
      return;
    }
    const dayIndex = state.schedule.slotDayIndex || [];
    pairs.slice(0, 5).forEach(pair => {
      const wrap = document.createElement('div');
      wrap.className = 'top-slot';
      const range = formatRange(state.schedule.slots[pair.idx], state.schedule.slotMinutes, participantTzSelect ? participantTzSelect.value : state.viewerTimeZone);
      const dayLabel =
        dayIndex.length > pair.idx && state.schedule.days ? formatDay(state.schedule.days[dayIndex[pair.idx]], participantTzSelect ? participantTzSelect.value : state.viewerTimeZone) : '';
      const left = document.createElement('div');
      left.innerHTML = `<strong>${range}</strong><br/><span class="hint">${dayLabel ? dayLabel + ' • ' : ''}${pair.count} people available</span>`;
      const pill = document.createElement('div');
      pill.className = 'pill';
      pill.textContent = `Slot ${pair.idx + 1}`;
      wrap.appendChild(left);
      wrap.appendChild(pill);
      topSlotsEl.appendChild(wrap);
    });
  }

  function init() {
    populateTimeZones(participantTzSelect, state.viewerTimeZone);

    const url = new URL(window.location.href);
    const params = url.searchParams;
    let scheduleId = params.get('schedule') || params.get('id');
    if (!scheduleId) {
      const parts = url.pathname.split('/').filter(Boolean);
      const maybeId = parts.length > 1 && parts[0].startsWith('schedule') ? parts[1] : null;
      if (maybeId) scheduleId = maybeId;
    }
    if (scheduleId) loadSchedule(scheduleId);

    if (loadForm) {
      loadForm.addEventListener('submit', (evt) => {
        evt.preventDefault();
        const id = loadForm.scheduleId.value.trim();
        if (id) loadSchedule(id);
      });
    }
    if (loadParticipantBtn) loadParticipantBtn.addEventListener('click', loadParticipant);
    if (saveAvailabilityBtn) saveAvailabilityBtn.addEventListener('click', saveAvailability);
    if (participantTzSelect) {
      participantTzSelect.addEventListener('change', () => {
        renderBands();
        renderTables();
        renderTopSlots();
      });
    }

    window.addEventListener('mouseup', () => {
      state.drag.active = false;
      state.drag.mode = null;
      hideTooltip();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
