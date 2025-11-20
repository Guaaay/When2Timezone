(() => {
  const createForm = document.getElementById('create-form');
  const joinForm = document.getElementById('join-form');
  const baseTzSelect = document.getElementById('base-timezone');

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

  function setTodayDefault() {
    const today = new Date();
    const iso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    createForm.startDate.value = iso;
    createForm.endDate.value = iso;
  }

  async function createSchedule(evt) {
    evt.preventDefault();
    const body = {
      title: createForm.title.value.trim(),
      startDate: createForm.startDate.value,
      endDate: createForm.endDate.value,
      startHour: Number(createForm.startHour.value || 0),
      endHour: Number(createForm.endHour.value || 0),
      slotMinutes: Number(createForm.slotMinutes.value || 30),
      baseTimeZone: createForm.baseTimeZone.value
    };
    const res = await fetch('/api/schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Could not create schedule');
      return;
    }
    window.location.href = `/schedule.html?schedule=${encodeURIComponent(data.schedule.id)}`;
  }

  function joinSchedule(evt) {
    evt.preventDefault();
    const id = joinForm.scheduleId.value.trim();
    if (!id) return;
    window.location.href = `/schedule.html?schedule=${encodeURIComponent(id)}`;
  }

  function init() {
    populateTimeZones(baseTzSelect, guessTimeZone());
    setTodayDefault();
    createForm.addEventListener('submit', createSchedule);
    joinForm.addEventListener('submit', joinSchedule);
  }

  init();
})();
