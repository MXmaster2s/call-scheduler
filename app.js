/* ===================================================================
   Quick Call — Supabase + Google Auth
   getAvailability() and submitBooking() now hit the real database.
   Times are stored in IST (host timezone) and displayed in the
   visitor's selected timezone via Intl.DateTimeFormat.
=================================================================== */

/* ---------- Supabase ---------- */
const SUPABASE_URL = 'https://lnhsvmyvpgvepuxhneia.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxuaHN2bXl2cGd2ZXB1eGhuZWlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4NDIyMDksImV4cCI6MjA5NzQxODIwOX0.Z-TUFkb8oiYuVUNMoq0cZ3kUH7fkPXrRDKqK6jxSxng';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const HOST      = { name: 'Rohit', durationMin: 30 };
const HOST_TZ   = 'Asia/Kolkata';     // slot HH:MM strings live in this tz
const WORK_START_HOUR   = 8;          // 8 am IST
const WORK_END_HOUR     = 19;         // last slot ends at 7 pm IST
const BOOKABLE_DAYS_AHEAD = 56;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let currentUser  = null;
let bookedByDate = {};  // 'YYYY-MM-DD' → Set<'HH:MM'> (IST)

/* ---------- Helpers ---------- */
function isWeekday(date) { const d = date.getDay(); return d !== 0 && d !== 6; }

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function allSlots() {
  const out = [];
  for (let h = WORK_START_HOUR; h < WORK_END_HOUR; h++) {
    for (const m of [0, 30]) {
      out.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  return out;
}

/* ---------- Starfield ---------- */
(function starfield() {
  const canvas = document.getElementById('starfield');
  const ctx = canvas.getContext('2d');
  let w, h, stars = [];

  function resize() {
    w = canvas.width  = window.innerWidth;
    h = canvas.height = window.innerHeight;
    const count = Math.round((w * h) / 9000);
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      r: Math.random() * 1.3 + 0.2,
      a: Math.random() * 0.6 + 0.15,
      tw: Math.random() * 0.015 + 0.003,
      dir: Math.random() > 0.5 ? 1 : -1,
      vy: Math.random() * 0.04 + 0.01,
    }));
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      s.a += s.tw * s.dir;
      if (s.a > 0.85 || s.a < 0.1) s.dir *= -1;
      if (!reducedMotion) { s.y += s.vy; if (s.y > h) s.y = 0; }
      ctx.beginPath();
      ctx.fillStyle = `rgba(230,228,255,${s.a})`;
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (!reducedMotion) requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize);
  resize();
  draw();
})();

/* ---------- Timezone select ---------- */
const TZ_LIST = [
  { id: 'Pacific/Honolulu',      name: 'Hawaii' },
  { id: 'America/Anchorage',     name: 'Alaska' },
  { id: 'America/Los_Angeles',   name: 'Pacific Time — US & Canada' },
  { id: 'America/Denver',        name: 'Mountain Time — US & Canada' },
  { id: 'America/Chicago',       name: 'Central Time — US & Canada' },
  { id: 'America/New_York',      name: 'Eastern Time — US & Canada' },
  { id: 'America/Halifax',       name: 'Atlantic Time — Canada' },
  { id: 'America/Sao_Paulo',     name: 'Brasília' },
  { id: 'Atlantic/Azores',       name: 'Azores' },
  { id: 'Europe/London',         name: 'London / Dublin / Lisbon' },
  { id: 'Europe/Paris',          name: 'Central Europe — Paris / Berlin' },
  { id: 'Europe/Helsinki',       name: 'Eastern Europe — Helsinki / Kyiv' },
  { id: 'Europe/Moscow',         name: 'Moscow' },
  { id: 'Asia/Dubai',            name: 'Gulf — Dubai / Abu Dhabi' },
  { id: 'Asia/Kabul',            name: 'Kabul' },
  { id: 'Asia/Karachi',          name: 'Pakistan — Karachi / Islamabad' },
  { id: 'Asia/Kolkata',          name: 'India — IST' },
  { id: 'Asia/Dhaka',            name: 'Bangladesh — Dhaka' },
  { id: 'Asia/Rangoon',          name: 'Myanmar — Yangon' },
  { id: 'Asia/Bangkok',          name: 'Bangkok / Jakarta / Hanoi' },
  { id: 'Asia/Singapore',        name: 'Singapore / KL / Hong Kong' },
  { id: 'Asia/Tokyo',            name: 'Japan / Korea' },
  { id: 'Australia/Adelaide',    name: 'Adelaide' },
  { id: 'Australia/Sydney',      name: 'Sydney / Melbourne' },
  { id: 'Pacific/Auckland',      name: 'Auckland / Wellington' },
];

function getOffset(tz) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' })
      .formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value || '';
  } catch { return ''; }
}

function tzLabel(tz, name) {
  const offset = getOffset(tz);
  return name ? `${offset} — ${name}` : `${offset} — ${tz.split('/').pop().replace(/_/g, ' ')}`;
}

const detectedTz   = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const knownIds     = TZ_LIST.map(t => t.id);
let   selectedTzId = detectedTz;

/* ---------- Custom timezone picker ---------- */
const tzPicker   = document.getElementById('tzPicker');
const tzTrigger  = document.getElementById('tzTrigger');
const tzDisplay  = document.getElementById('tzDisplay');
const tzDropdown = document.getElementById('tzDropdown');
const tzSearch   = document.getElementById('tzSearch');
const tzList     = document.getElementById('tzList');

function tzShortLabel(id) {
  const offset = getOffset(id);
  const entry  = TZ_LIST.find(t => t.id === id);
  const name   = entry ? entry.name : id.split('/').pop().replace(/_/g, ' ');
  return `${offset} · ${name.split(' — ')[0]}`;
}

function buildTzItems(filter) {
  const q = (filter || '').toLowerCase();
  const all = [
    ...(!knownIds.includes(detectedTz) ? [{ id: detectedTz, name: detectedTz.split('/').pop().replace(/_/g, ' ') }] : []),
    ...TZ_LIST,
  ];
  return q ? all.filter(({ id, name }) =>
    name.toLowerCase().includes(q) || id.toLowerCase().includes(q) || getOffset(id).toLowerCase().includes(q)
  ) : all;
}

function renderTzItems(filter) {
  const items = buildTzItems(filter);
  tzList.innerHTML = '';
  if (!items.length) {
    const p = document.createElement('p');
    p.className = 'tz-empty'; p.textContent = 'No results';
    tzList.appendChild(p); return;
  }
  items.forEach(({ id, name }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tz-option' + (id === selectedTzId ? ' selected' : '');
    btn.dataset.tzId = id;
    btn.setAttribute('role', 'option');
    btn.setAttribute('aria-selected', String(id === selectedTzId));
    btn.innerHTML = `<span class="tz-option-offset">${getOffset(id)}</span><span class="tz-option-name">${name}</span>`;
    btn.addEventListener('click', () => selectTz(id));
    tzList.appendChild(btn);
  });
}

function selectTz(id) {
  selectedTzId = id;
  tzDisplay.textContent = tzShortLabel(id);
  closeTzDropdown();
  if (state.selectedDate) renderSlots(state.selectedDate);
  if (state.selectedTime) updateFormSummary();
}

function openTzDropdown() {
  renderTzItems('');
  tzDropdown.hidden = false;
  tzTrigger.setAttribute('aria-expanded', 'true');
  tzSearch.value = '';
  tzSearch.focus();
  setTimeout(() => {
    const sel = tzList.querySelector('.selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }, 50);
}

function closeTzDropdown() {
  tzDropdown.hidden = true;
  tzTrigger.setAttribute('aria-expanded', 'false');
}

tzTrigger.addEventListener('click', () => {
  if (tzDropdown.hidden) openTzDropdown(); else closeTzDropdown();
});
tzSearch.addEventListener('input', () => renderTzItems(tzSearch.value));
document.addEventListener('click', e => {
  if (!tzPicker.contains(e.target)) closeTzDropdown();
});

// Initialize display
tzDisplay.textContent = tzShortLabel(selectedTzId);

/* ---------- Format slot time in visitor's timezone ---------- */
// hhmm = 'HH:MM' in IST (host tz). date = JS Date for the calendar day chosen.
function formatSlotTime(hhmm, date) {
  const iso = `${localDateKey(date)}T${hhmm}:00+05:30`; // +05:30 = IST
  return new Intl.DateTimeFormat('en-US', {
    timeZone: selectedTzId,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

/* ---------- Availability — real Supabase ---------- */
async function fetchMonthAvailability(year, month) {
  try {
    const { data } = await sb.rpc('get_booked_slots_for_month', {
      p_year: year,
      p_month: month + 1,  // JS months are 0-indexed
    });
    bookedByDate = {};
    if (data) {
      for (const row of data) {
        const key = row.date;          // 'YYYY-MM-DD'
        if (!bookedByDate[key]) bookedByDate[key] = new Set();
        bookedByDate[key].add((row.time_slot || '').slice(0, 5));  // 'HH:MM'
      }
    }
  } catch (e) {
    console.error('Availability fetch failed:', e);
  }
}

function prevSlotHhmm(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m - 30;
  if (total < 0) return null;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function getAvailability(date) {
  if (!isWeekday(date)) return [];
  const key    = localDateKey(date);
  const booked = bookedByDate[key] || new Set();
  const now    = Date.now();

  return allSlots().filter(s => {
    if (booked.has(s)) return false;
    // 15-min buffer: block the slot immediately after any booked slot
    const prev = prevSlotHhmm(s);
    if (prev && booked.has(prev)) return false;
    const slotMs = new Date(`${key}T${s}:00+05:30`).getTime();
    return slotMs > now + 30 * 60 * 1000;
  });
}

/* ---------- Submit booking — real Supabase insert + email ---------- */
async function submitBooking({ date, time, name, email, reason }) {
  const dateStr     = localDateKey(date);
  const isReschedule = Boolean(reschedulingBookingId);

  // Insert and get the new row ID so we can attach the Meet link later
  const { data: insertedRow, error } = await sb
    .from('bookings')
    .insert({
      attendee_name:  name,
      attendee_email: email,
      reason,
      date:       dateStr,
      time_slot:  time,
      owner_uid:  currentUser.id,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      return { ok: false, error: 'That slot was just taken — please pick another time.' };
    }
    return { ok: false, error: error.message };
  }

  const bookingId = insertedRow?.id ?? null;

  // If rescheduling, cancel the old booking now that the new one is confirmed
  if (reschedulingBookingId) {
    const { error: cancelErr } = await sb
      .from('bookings')
      .update({ status: 'cancelled' })
      .eq('id', reschedulingBookingId)
      .eq('owner_uid', currentUser.id);
    if (cancelErr) console.warn('Could not cancel old booking:', cancelErr.message);
    reschedulingBookingId = null;
  }

  // Await the edge function so we get the Meet link back
  let meetLink = '';
  try {
    const { data: fnData, error: fnErr } = await sb.functions.invoke('send-booking-confirmation', {
      body: {
        attendee_name:  name,
        attendee_email: email,
        reason,
        date:           dateStr,
        time_slot:      time,
        booking_id:     bookingId,
        is_reschedule:  isReschedule,
      },
    });
    if (fnErr) console.warn('[email/calendar]', fnErr);
    else meetLink = fnData?.meet_link || '';
  } catch (e) {
    console.warn('[email/calendar]', e);
  }

  return { ok: true, meetLink };
}

/* ---------- Calendar ---------- */
const state = {
  viewYear: null, viewMonth: null,
  selectedDate: null, selectedTime: null,
};

const today = new Date();
today.setHours(0, 0, 0, 0);
state.viewYear  = today.getFullYear();
state.viewMonth = today.getMonth();

const maxDate = new Date(today);
maxDate.setDate(maxDate.getDate() + BOOKABLE_DAYS_AHEAD);

const monthLabel = document.getElementById('monthLabel');
const dayGrid    = document.getElementById('dayGrid');
const prevBtn    = document.getElementById('prevMonth');
const nextBtn    = document.getElementById('nextMonth');

function sameDay(a, b) { return a.toDateString() === b.toDateString(); }

function renderCalendar() {
  const first       = new Date(state.viewYear, state.viewMonth, 1);
  const startOffset = first.getDay();
  const daysInMonth = new Date(state.viewYear, state.viewMonth + 1, 0).getDate();
  monthLabel.textContent = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  dayGrid.innerHTML = '';
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;

  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - startOffset + 1;
    const cell   = document.createElement('button');
    cell.type    = 'button';
    cell.className = 'day-cell';

    if (dayNum < 1 || dayNum > daysInMonth) {
      cell.classList.add('outside');
      cell.disabled = true;
      dayGrid.appendChild(cell);
      continue;
    }

    const cellDate = new Date(state.viewYear, state.viewMonth, dayNum);
    cell.textContent = String(dayNum);

    const inRange = cellDate >= today && cellDate <= maxDate;
    const hasSlots = inRange && getAvailability(cellDate).length > 0;

    if (sameDay(cellDate, today))   cell.classList.add('today');
    if (!inRange || !hasSlots) {
      cell.classList.add('unavailable');
    } else {
      cell.classList.add('has-slots');
      cell.addEventListener('click', () => selectDate(cellDate));
    }
    if (state.selectedDate && sameDay(cellDate, state.selectedDate)) {
      cell.classList.add('selected');
      cell.setAttribute('aria-current', 'date');
    }
    dayGrid.appendChild(cell);
  }

  const prevMonthEnd  = new Date(state.viewYear, state.viewMonth, 0);
  prevBtn.disabled    = prevMonthEnd < new Date(today.getFullYear(), today.getMonth(), 1);
  const nextMonthStart = new Date(state.viewYear, state.viewMonth + 1, 1);
  nextBtn.disabled    = nextMonthStart > maxDate;
}

async function loadMonthAndRender(year, month) {
  // Show a subtle loading indicator in the grid
  dayGrid.innerHTML = '<span style="color:var(--text-faint);font-size:12px;padding:10px 0;display:block;text-align:center;">Loading…</span>';
  await fetchMonthAvailability(year, month);
  renderCalendar();
}

prevBtn.addEventListener('click', () => {
  state.viewMonth -= 1;
  if (state.viewMonth < 0) { state.viewMonth = 11; state.viewYear -= 1; }
  loadMonthAndRender(state.viewYear, state.viewMonth);
});
nextBtn.addEventListener('click', () => {
  state.viewMonth += 1;
  if (state.viewMonth > 11) { state.viewMonth = 0; state.viewYear += 1; }
  loadMonthAndRender(state.viewYear, state.viewMonth);
});

/* ---------- Slots ---------- */
const selectedDateLabel = document.getElementById('selectedDateLabel');
const slotsEmpty        = document.getElementById('slotsEmpty');
const slotsList         = document.getElementById('slotsList');
const stepDate          = document.getElementById('stepDate');
const stepTime          = document.getElementById('stepTime');
const stepConfirm       = document.getElementById('stepConfirm');
const signalFill        = document.getElementById('signalFill');
const signalFill2       = document.getElementById('signalFill2');

/* ---------- Sign-in gate ---------- */
const signInGate        = document.getElementById('signInGate');
const signInGateConfirm = document.getElementById('signInGateConfirm');
const signInGateCancel  = document.getElementById('signInGateCancel');
const signInGateDismiss = document.getElementById('signInGateDismiss');
let   pendingDateForGate = null;   // date user clicked before signing in

function closeSignInGate() {
  signInGate.hidden    = true;
  pendingDateForGate   = null;
}

signInGateDismiss.addEventListener('click', closeSignInGate);
signInGateCancel.addEventListener('click',  closeSignInGate);
signInGate.addEventListener('click', e => { if (e.target === signInGate) closeSignInGate(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (!signInGate.hidden) closeSignInGate();
    else if (!tzDropdown.hidden) { closeTzDropdown(); tzTrigger.focus(); }
  }
});

signInGateConfirm.addEventListener('click', async () => {
  if (pendingDateForGate) {
    sessionStorage.setItem('pendingDate', localDateKey(pendingDateForGate));
  }
  closeSignInGate();
  await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname },
  });
});

/* ---------- Restore selected date after OAuth redirect ---------- */
async function checkPendingDate() {
  const raw = sessionStorage.getItem('pendingDate');
  if (!raw || !currentUser) return;
  sessionStorage.removeItem('pendingDate');
  const dateObj = new Date(raw + 'T12:00:00');
  if (dateObj.getMonth() !== state.viewMonth || dateObj.getFullYear() !== state.viewYear) {
    state.viewYear  = dateObj.getFullYear();
    state.viewMonth = dateObj.getMonth();
    await fetchMonthAvailability(state.viewYear, state.viewMonth);
  }
  renderCalendar();
  selectDate(dateObj);
  document.getElementById('panels').scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
}

function selectDate(date) {
  // Gate: unsigned users see the sign-in prompt instead of time slots
  if (!currentUser) {
    pendingDateForGate   = date;
    signInGate.hidden    = false;
    signInGateConfirm.focus();
    return;
  }
  state.selectedDate = date;
  state.selectedTime = null;
  hideForm();
  renderCalendar();
  renderSlots(date);
  stepDate.classList.remove('active'); stepDate.classList.add('done');
  signalFill.style.width = '100%';
  stepTime.classList.add('active');
  signalFill2.style.width = '0%';
  stepConfirm.classList.remove('active', 'done');
}

function renderSlots(date) {
  selectedDateLabel.textContent = date.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
  const slots = getAvailability(date);

  if (!slots.length) {
    slotsEmpty.hidden = false;
    slotsEmpty.textContent = 'No open times this day — try another.';
    slotsList.hidden = true;
    return;
  }

  slotsEmpty.hidden = true;
  slotsList.hidden  = false;
  slotsList.innerHTML = '';

  slots.forEach(hhmm => {
    const btn = document.createElement('button');
    btn.type  = 'button';
    btn.className    = 'slot-btn';
    btn.dataset.hhmm = hhmm;
    btn.textContent  = formatSlotTime(hhmm, date);
    btn.addEventListener('click', () => selectTime(hhmm, btn));
    slotsList.appendChild(btn);
  });
}

function selectTime(hhmm, btnEl) {
  state.selectedTime = hhmm;
  [...slotsList.children].forEach(b => b.classList.remove('selected'));
  btnEl.classList.add('selected');
  signalFill2.style.width = '100%';
  stepTime.classList.add('done');
  stepConfirm.classList.add('active');
  showForm();
}

/* ---------- My Bookings ---------- */
const myBookingsPanel = document.getElementById('myBookingsPanel');
const myBookingsList  = document.getElementById('myBookingsList');
let reschedulingBookingId = null;

applyTheme(localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  themeMoonEl.hidden = theme !== 'light';
  themeSunEl.hidden  = theme === 'light';
}

themeBtn.addEventListener('click', () => {
  applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
});

sb.auth.onAuthStateChange((_event, session) => {
  updateAuthUI(session?.user || null);
});

(async () => {
  const { data: { session } } = await sb.auth.getSession();
  updateAuthUI(session?.user || null);
  await loadMonthAndRender(state.viewYear, state.viewMonth);
  if (session?.user) {
    await checkPendingDate();
    await checkPendingBooking();
  }
})();