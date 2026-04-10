/* ============================================
   Boston Marathon 2026 Event Tracker
   app.js — Main application logic
   ============================================ */

let allEvents = [];
let filteredEvents = [];
let currentView = 'grid';
let seenEventIds = new Set();

// Guard: filter out any scraped events whose "name" is just a date string
// e.g. "Wednesday,15 Apr" or "Tuesday , 14 Apr"
// Only matches names that are purely a date string with nothing meaningful after
// e.g. "Wednesday,15 Apr" or "Tuesday , 14 Apr" — NOT "Sunday, April 20: Shake it out..."
const DATE_NAME_RE = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*[\s,]+(?:\d{1,2}\s+)?(?:Apr|April)\s*\d{0,2}\s*$/i;

// Category → CSS class mapping
const CATEGORY_CLASS = {
  'Marathon':              'cat-marathon',
  'Race':                  'cat-race',
  'Youth Race':            'cat-youth',
  'Shakeout Run':          'cat-shakeout',
  'Expo':                  'cat-expo',
  'Fan Event':             'cat-fan-event',
  'Brand Activation':      'cat-brand',
  'Post-Race Party':       'cat-post-race',
  'Post-Race Celebration': 'cat-celebration',
  'Community Run':         'cat-community',
  'Community Service':     'cat-service',
  'Film / Community':      'cat-film',
  'Film Premiere':         'cat-film-premiere',
  'Meet & Greet':          'cat-meet',
  'Evening Event':         'cat-evening',
  'Dinner Event':          'cat-dinner',
  'Block Party':           'cat-block-party',
  'Spectator / Cheer Zone':'cat-cheer',
  'Youth Activation':      'cat-race',
  'Official BAA':          'cat-official',
  'Awards / Community':    'cat-awards',
  'Podcast / Community':   'cat-podcast',
  'Race-Day Activation':   'cat-race-day',
  'Street Fair':           'cat-community',
};

// Day labels
const DAY_LABELS = {
  '2026-04-14': { label: 'Tue, April 14', sub: 'Race Week Begins' },
  '2026-04-15': { label: 'Wed, April 15', sub: '' },
  '2026-04-16': { label: 'Thu, April 16', sub: 'Pre-Expo' },
  '2026-04-17': { label: 'Fri, April 17', sub: 'Expo Opens' },
  '2026-04-18': { label: 'Sat, April 18', sub: 'BAA 5K Day' },
  '2026-04-19': { label: 'Sun, April 19', sub: 'Shakeout Sunday' },
  '2026-04-20': { label: 'Mon, April 20 🏃', sub: "RACE DAY — Patriots' Day", isRaceDay: true },
  '2026-04-21': { label: 'Tue, April 21', sub: 'Celebration Day' },
};

// ============================================
// INIT
// ============================================
async function init() {
  await loadEvents();
  buildFilters();
  filterEvents();
  updateStats();
  updateLastUpdated();

  // Store seen event IDs so we can detect new ones on refresh
  allEvents.forEach(e => seenEventIds.add(e.id));

  // Auto-check for updates every 30 minutes
  setInterval(() => {
    refreshEvents(true); // silent refresh
  }, 30 * 60 * 1000);
}

// ============================================
// LOAD EVENTS
// ============================================
async function loadEvents() {
  try {
    const resp = await fetch('data/events.json?t=' + Date.now());
    const data = await resp.json();
    allEvents = (data.events || []).filter(e => !DATE_NAME_RE.test(e.name));
    window._meta = data.meta || {};
  } catch (e) {
    console.warn('Could not load events.json, using embedded data');
    allEvents = (EMBEDDED_EVENTS || []).filter(e => !DATE_NAME_RE.test(e.name));
    window._meta = { last_updated: new Date().toISOString() };
  }
  filteredEvents = [...allEvents];
}

// ============================================
// MANUAL REFRESH
// ============================================
async function manualRefresh() {
  const btn = document.getElementById('refreshBtn');
  btn.classList.add('loading');
  btn.innerHTML = '<span class="refresh-icon">↻</span> Checking...';
  await refreshEvents(false);
  btn.classList.remove('loading');
  btn.innerHTML = '<span class="refresh-icon">↻</span> Check for New Events';
}

async function refreshEvents(silent) {
  const prevCount = allEvents.length;
  const prevIds = new Set(allEvents.map(e => e.id));
  await loadEvents();

  const newEvents = allEvents.filter(e => !prevIds.has(e.id));
  if (newEvents.length > 0) {
    const badge = document.getElementById('newEventsBadge');
    document.getElementById('newEventsCount').textContent = newEvents.length;
    badge.style.display = 'flex';

    // Mark new events
    newEvents.forEach(e => e._isNew = true);

    if (!silent) {
      alert(`🎉 ${newEvents.length} new event${newEvents.length > 1 ? 's' : ''} found!`);
    }
  } else if (!silent) {
    // Show brief "up to date" message
    const badge = document.getElementById('newEventsBadge');
    badge.style.display = 'flex';
    badge.style.background = '#d4edda';
    badge.style.borderColor = '#28a745';
    badge.style.color = '#155724';
    badge.innerHTML = '✓ Up to date';
    setTimeout(() => {
      badge.style.display = 'none';
      badge.style.background = '';
      badge.style.borderColor = '';
      badge.style.color = '';
    }, 3000);
  }

  filterEvents();
  updateStats();
  updateLastUpdated();
}

// ============================================
// BUILD FILTERS
// ============================================
function buildFilters() {
  // Categories
  const cats = [...new Set(allEvents.map(e => e.category))].sort();
  const catSel = document.getElementById('filterCategory');
  cats.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    catSel.appendChild(opt);
  });

  // Sponsors
  const allSponsors = new Set();
  allEvents.forEach(e => (e.sponsors || []).forEach(s => allSponsors.add(s)));
  const sortedSponsors = [...allSponsors].sort();
  const spSel = document.getElementById('filterSponsor');
  sortedSponsors.forEach(sp => {
    const opt = document.createElement('option');
    opt.value = sp;
    opt.textContent = sp;
    spSel.appendChild(opt);
  });
}

// ============================================
// FILTER EVENTS
// ============================================
function filterEvents() {
  const search    = document.getElementById('searchInput').value.toLowerCase().trim();
  const dayVal    = document.getElementById('filterDay').value;
  const catVal    = document.getElementById('filterCategory').value;
  const costVal   = document.getElementById('filterCost').value;
  const spVal     = document.getElementById('filterSponsor').value;

  filteredEvents = allEvents.filter(e => {
    // Search
    if (search) {
      const haystack = [
        e.name, e.description, e.location, e.category,
        ...(e.sponsors || []), ...(e.big_names || []), ...(e.giveaways || [])
      ].join(' ').toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    // Day
    if (dayVal && e.date !== dayVal) return false;
    // Category
    if (catVal && e.category !== catVal) return false;
    // Cost
    if (costVal === 'free' && !isFree(e)) return false;
    if (costVal === 'paid' && isFree(e)) return false;
    // Sponsor
    if (spVal && !(e.sponsors || []).includes(spVal)) return false;
    return true;
  });

  renderView();
  updateResultCount();
}

function isFree(e) {
  return !e.cost || e.cost.toLowerCase().startsWith('free') || e.cost === 'Public viewing';
}

function clearFilters() {
  document.getElementById('searchInput').value = '';
  document.getElementById('filterDay').value = '';
  document.getElementById('filterCategory').value = '';
  document.getElementById('filterCost').value = '';
  document.getElementById('filterSponsor').value = '';
  filterEvents();
}

// ============================================
// UPDATE STATS
// ============================================
function updateStats() {
  document.getElementById('totalEvents').textContent = allEvents.length;
  document.getElementById('totalFree').textContent = allEvents.filter(isFree).length;

  const allSponsors = new Set();
  allEvents.forEach(e => (e.sponsors || []).forEach(s => allSponsors.add(s)));
  document.getElementById('totalBrands').textContent = allSponsors.size;
}

function updateResultCount() {
  const el = document.getElementById('resultsCount');
  if (filteredEvents.length === allEvents.length) {
    el.textContent = `Showing all ${allEvents.length} events`;
  } else {
    el.textContent = `Showing ${filteredEvents.length} of ${allEvents.length} events`;
  }
}

function updateLastUpdated() {
  const meta = window._meta || {};
  const el = document.getElementById('lastUpdated');
  if (meta.last_updated) {
    const d = new Date(meta.last_updated);
    el.textContent = `Updated: ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
  }
}

// ============================================
// VIEW SWITCHING
// ============================================
function setView(view) {
  currentView = view;
  document.getElementById('viewGrid').style.display     = view === 'grid' ? '' : 'none';
  document.getElementById('viewList').style.display     = view === 'list' ? '' : 'none';
  document.getElementById('viewCalendar').style.display = view === 'calendar' ? '' : 'none';

  document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('btn' + view.charAt(0).toUpperCase() + view.slice(1)).classList.add('active');

  renderView();
}

// ============================================
// RENDER
// ============================================
function renderView() {
  if (currentView === 'grid')     renderGrid();
  else if (currentView === 'list') renderList();
  else if (currentView === 'calendar') renderCalendar();
}

// --- GRID ---
function renderGrid() {
  const container = document.getElementById('viewGrid');
  container.innerHTML = '';

  if (filteredEvents.length === 0) {
    container.innerHTML = `<div class="no-results"><div class="no-results-icon">🔍</div><p>No events match your search. Try adjusting the filters.</p></div>`;
    return;
  }

  // Group by date
  const grouped = groupByDate(filteredEvents);

  Object.keys(grouped).sort().forEach(date => {
    const info = DAY_LABELS[date] || { label: date, sub: '' };
    const events = grouped[date];

    // Day header
    const hdr = document.createElement('div');
    hdr.className = 'day-group-header';
    hdr.innerHTML = `
      <div class="day-label${info.isRaceDay ? ' race-day' : ''}">${info.label}</div>
      ${info.sub ? `<div class="day-label" style="font-weight:400;font-size:.8rem;color:var(--gray-400)">${info.sub}</div>` : ''}
      <div class="day-divider"></div>
      <div class="day-count">${events.length} event${events.length !== 1 ? 's' : ''}</div>
    `;
    container.appendChild(hdr);

    // Cards
    events.forEach(ev => {
      container.appendChild(buildCard(ev));
    });
  });
}

function buildCard(ev) {
  const catClass = CATEGORY_CLASS[ev.category] || 'cat-default';
  const isFreeEv = isFree(ev);
  const accentColor = getCategoryAccent(ev.category);

  const card = document.createElement('div');
  card.className = `event-card${ev._isNew ? ' new-event' : ''}`;
  card.style.setProperty('--card-accent', accentColor);
  card.onclick = () => openModal(ev);

  const sponsorTags = (ev.sponsors || []).slice(0, 3).map(s =>
    `<span class="sponsor-tag">${s}</span>`
  ).join('');

  const nameTags = (ev.big_names || []).filter(n => n && !n.includes('TBA')).slice(0, 3).map(n =>
    `<span class="name-tag">⭐ ${n}</span>`
  ).join('');

  const giveaways = (ev.giveaways || []).length > 0
    ? `<span class="card-giveaways">🎁 ${ev.giveaways[0]}${ev.giveaways.length > 1 ? ` +${ev.giveaways.length - 1}` : ''}</span>`
    : '';

  const registerBtn = ev.signup_link
    ? `<a class="card-register" href="${ev.signup_link}" target="_blank" onclick="event.stopPropagation()">Register →</a>`
    : '';

  card.innerHTML = `
    ${ev._isNew ? '<span class="new-badge">NEW</span>' : ''}
    <div class="card-top">
      <span class="card-time${ev.date === '2026-04-20' ? ' race-time' : ''}">${ev.time}</span>
      <span class="card-category ${catClass}">${ev.category}</span>
    </div>
    <div class="card-name">${ev.name}</div>
    <div class="card-location">📍 ${ev.location}</div>
    ${ev.description ? `<div class="card-description">${ev.description}</div>` : ''}
    ${nameTags ? `<div class="card-names">${nameTags}</div>` : ''}
    ${sponsorTags ? `<div class="card-sponsors">${sponsorTags}</div>` : ''}
    <div class="card-bottom">
      <span class="card-cost ${isFreeEv ? 'free' : 'paid'}">${isFreeEv ? '✓ Free' : '💲 ' + ev.cost}</span>
      ${giveaways}
      ${registerBtn}
    </div>
  `;

  return card;
}

// --- LIST ---
function renderList() {
  const container = document.getElementById('viewList');
  container.innerHTML = '';

  if (filteredEvents.length === 0) {
    container.innerHTML = `<div class="no-results"><div class="no-results-icon">🔍</div><p>No events match your search.</p></div>`;
    return;
  }

  const grouped = groupByDate(filteredEvents);

  Object.keys(grouped).sort().forEach(date => {
    const info = DAY_LABELS[date] || { label: date };
    const events = grouped[date];

    const group = document.createElement('div');
    group.className = 'list-day-group';

    const hdr = document.createElement('div');
    hdr.className = `list-day-header${info.isRaceDay ? ' race-day' : ''}`;
    hdr.innerHTML = `<span>${info.label}${info.sub ? ` — ${info.sub}` : ''}</span><span>${events.length} events</span>`;
    group.appendChild(hdr);

    events.forEach(ev => {
      const catClass = CATEGORY_CLASS[ev.category] || 'cat-default';
      const isFreeEv = isFree(ev);
      const item = document.createElement('div');
      item.className = 'list-item';
      item.onclick = () => openModal(ev);
      item.innerHTML = `
        <div class="list-time">${ev.time}</div>
        <div>
          <div class="list-name">${ev.name}${ev._isNew ? ' <span style="background:var(--gold);color:var(--blue);font-size:.6rem;padding:1px 6px;border-radius:10px;font-weight:800">NEW</span>' : ''}</div>
          <div class="list-location">📍 ${ev.location}</div>
        </div>
        <div class="list-cat"><span class="card-category ${catClass}" style="font-size:.65rem">${ev.category}</span></div>
        <div class="list-cost ${isFreeEv ? 'free' : 'paid'}">${isFreeEv ? 'Free' : ev.cost}</div>
        <div class="list-link">${ev.signup_link ? `<a href="${ev.signup_link}" target="_blank" onclick="event.stopPropagation()" style="color:var(--blue-mid);font-size:.75rem;font-weight:700">Register →</a>` : ''}</div>
      `;
      group.appendChild(item);
    });

    container.appendChild(group);
  });
}

// --- CALENDAR ---
function renderCalendar() {
  if (window.innerWidth <= 600) {
    renderCalendarMobile();
    return;
  }

  const container = document.getElementById('viewCalendar');
  container.innerHTML = '';

  const days = Object.keys(DAY_LABELS).sort();
  const grouped = groupByDate(filteredEvents);

  const timeBands = [
    { label: 'Morning\n6 AM–12 PM',  test: e => isTimeBand(e.time, 0, 12) },
    { label: 'Afternoon\n12–5 PM',    test: e => isTimeBand(e.time, 12, 17) },
    { label: 'Evening\n5–11 PM',      test: e => isTimeBand(e.time, 17, 24) },
    { label: 'All Day',               test: e => e.time.toLowerCase().includes('all day') },
  ];

  const table = document.createElement('table');
  table.className = 'calendar-table';

  // Header row
  const thead = document.createElement('thead');
  const hdrRow = document.createElement('tr');
  hdrRow.innerHTML = `<th>Time</th>`;
  days.forEach(d => {
    const info = DAY_LABELS[d];
    const shortDay = info.label.split(',')[0];
    const dateStr = info.label.split(',')[1]?.trim() || '';
    hdrRow.innerHTML += `<th class="${info.isRaceDay ? 'race-col' : ''}">${shortDay}<br><small>${dateStr}${info.isRaceDay ? '<br>🏃 RACE DAY' : ''}</small></th>`;
  });
  thead.appendChild(hdrRow);
  table.appendChild(thead);

  // Body rows
  const tbody = document.createElement('tbody');
  timeBands.forEach(band => {
    const tr = document.createElement('tr');
    const labelLines = band.label.split('\n');
    tr.innerHTML = `<td class="time-cell">${labelLines[0]}<br><small>${labelLines[1] || ''}</small></td>`;

    days.forEach(d => {
      const td = document.createElement('td');
      const dayEvents = (grouped[d] || []).filter(band.test);
      dayEvents.forEach(ev => {
        const catClass = CATEGORY_CLASS[ev.category] || 'cat-default';
        const div = document.createElement('div');
        div.className = `cal-event ${catClass}`;
        div.innerHTML = `${ev.name}<div class="cal-event-time">${ev.time}</div>`;
        div.onclick = () => openModal(ev);
        td.appendChild(div);
      });
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.appendChild(table);
}

// --- CALENDAR MOBILE (vertical day cards) ---
function renderCalendarMobile() {
  const container = document.getElementById('viewCalendar');
  container.innerHTML = '';

  if (filteredEvents.length === 0) {
    container.innerHTML = `<div class="no-results"><div class="no-results-icon">🔍</div><p>No events match your search.</p></div>`;
    return;
  }

  const days = Object.keys(DAY_LABELS).sort();
  const grouped = groupByDate(filteredEvents);

  const timeBands = [
    { label: '🌅 Morning · 6 AM–12 PM',   test: e => isTimeBand(e.time, 0, 12) },
    { label: '☀️ Afternoon · 12–5 PM',    test: e => isTimeBand(e.time, 12, 17) },
    { label: '🌆 Evening · 5–11 PM',       test: e => isTimeBand(e.time, 17, 24) },
    { label: '📅 All Day',                 test: e => e.time.toLowerCase().includes('all day') },
  ];

  days.forEach(date => {
    const dayEvents = grouped[date] || [];
    if (dayEvents.length === 0) return;

    const info = DAY_LABELS[date];
    const section = document.createElement('div');
    section.className = 'cal-mobile-day';

    // Day header
    const hdr = document.createElement('div');
    hdr.className = `cal-mobile-day-hdr${info.isRaceDay ? ' race-day' : ''}`;
    hdr.innerHTML = `<span>${info.label}${info.isRaceDay ? ' 🏃' : ''}</span><span class="cal-mobile-count">${dayEvents.length} event${dayEvents.length !== 1 ? 's' : ''}</span>`;
    section.appendChild(hdr);

    timeBands.forEach(band => {
      const bandEvents = dayEvents.filter(band.test);
      if (bandEvents.length === 0) return;

      const bandHdr = document.createElement('div');
      bandHdr.className = 'cal-mobile-band';
      bandHdr.textContent = band.label;
      section.appendChild(bandHdr);

      bandEvents.forEach(ev => {
        const catClass = CATEGORY_CLASS[ev.category] || 'cat-default';
        const isFreeEv = isFree(ev);
        const row = document.createElement('div');
        row.className = 'cal-mobile-event';
        row.onclick = () => openModal(ev);
        row.innerHTML = `
          <div class="cal-mobile-event-left">
            <div class="cal-mobile-time">${ev.time}</div>
            <div class="cal-mobile-name">${ev.name}</div>
            <div class="cal-mobile-loc">📍 ${ev.location}</div>
          </div>
          <div class="cal-mobile-event-right">
            <span class="card-category ${catClass}" style="font-size:.62rem;white-space:nowrap">${ev.category}</span>
            <div class="cal-mobile-cost ${isFreeEv ? 'free' : 'paid'}">${isFreeEv ? '✓ Free' : ev.cost}</div>
          </div>
        `;
        section.appendChild(row);
      });
    });

    container.appendChild(section);
  });
}

// ============================================
// MODAL
// ============================================
function openModal(ev) {
  const catClass = CATEGORY_CLASS[ev.category] || 'cat-default';
  const isFreeEv = isFree(ev);
  const dayInfo  = DAY_LABELS[ev.date] || { label: ev.date };

  const sponsorTags = (ev.sponsors || []).map(s => `<span class="sponsor-tag">${s}</span>`).join('');
  const nameTags    = (ev.big_names || []).filter(n => n && !n.includes('TBA')).map(n =>
    `<span class="name-tag">⭐ ${n}</span>`
  ).join('');
  const giveaways   = (ev.giveaways || []).map(g => `<span class="sponsor-tag">🎁 ${g}</span>`).join('');

  document.getElementById('modalContent').innerHTML = `
    <div class="modal-header">
      <span class="modal-category ${catClass}">${ev.category}</span>
      <div class="modal-title">${ev.name}</div>
      <div class="modal-time-location">
        <div class="modal-datetime">🗓 ${dayInfo.label} &nbsp;·&nbsp; 🕐 ${ev.time}</div>
        <div class="modal-address">📍 ${ev.location}${ev.address && ev.address !== ev.location ? `, ${ev.address}` : ''}</div>
      </div>
    </div>
    <div class="modal-body">
      <div>
        <div class="modal-section-title">About</div>
        <div class="modal-description">${ev.description || 'No description available.'}</div>
      </div>
      ${sponsorTags ? `<div><div class="modal-section-title">Sponsors &amp; Partners</div><div class="modal-tags">${sponsorTags}</div></div>` : ''}
      ${nameTags ? `<div><div class="modal-section-title">Featured Names</div><div class="modal-tags">${nameTags}</div></div>` : ''}
      ${giveaways ? `<div><div class="modal-section-title">Giveaways &amp; Perks</div><div class="modal-tags">${giveaways}</div></div>` : ''}
      <div>
        <div class="modal-section-title">Cost</div>
        <div class="modal-cost-row">
          <span class="modal-cost-badge ${isFreeEv ? 'free' : 'paid'}">${ev.cost || 'Free'}</span>
        </div>
      </div>
      <div class="modal-cta">
        ${ev.signup_link
          ? `<a class="modal-register-btn" href="${ev.signup_link}" target="_blank">Register / Sign Up →</a>`
          : sourceToUrl(ev.source)
            ? `<a class="modal-register-btn modal-search-btn" href="${sourceToUrl(ev.source)}" target="_blank">More Info →</a>`
            : ''
        }
      </div>
    </div>
  `;

  document.getElementById('modalOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal(e) {
  if (e && e.target !== document.getElementById('modalOverlay')) return;
  document.getElementById('modalOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

// ESC to close
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.getElementById('modalOverlay').classList.remove('open');
    document.body.style.overflow = '';
  }
});

// ============================================
// HELPERS
// ============================================

// Maps source labels/domains → proper URLs so every event always has a link
const SOURCE_URL_MAP = {
  'baa.org':                      'https://www.baa.org/races/boston-marathon/event-information',
  'BAA Marathon Weekend':         'https://www.baa.org/races/boston-marathon/event-information',
  'heartbreak.run':               'https://heartbreak.run',
  'Heartbreak Hill RC':           'https://heartbreak.run',
  'marathon-weekend.com':         'https://www.marathon-weekend.com/boston/2026',
  'Marathon Weekend .com':        'https://www.marathon-weekend.com/boston/2026',
  'eventbrite.com':               'https://www.eventbrite.com/d/ma--boston/boston-marathon/',
  'Eventbrite':                   'https://www.eventbrite.com/d/ma--boston/boston-marathon/',
  'tracksmith.com':               'https://www.tracksmith.com/events',
  'runsignup.com':                'https://runsignup.com',
  'RunSignUp Boston Shakeout':    'https://runsignup.com',
  'brooksboston26.rsvpify.com':   'https://brooksboston26.rsvpify.com',
  'prnewswire.com':               'https://www.prnewswire.com',
  'Boston Discovery Guide April': 'https://www.boston-discovery-guide.com/boston-marathon-events.html',
  'Meet Boston - Marathon Events':'https://www.meetboston.com/events/',
  'RunGuides Boston 2026':        'https://runguides.com',
};

function sourceToUrl(source) {
  if (!source) return null;
  if (source.startsWith('http')) return source;                        // already a full URL
  if (SOURCE_URL_MAP[source]) return SOURCE_URL_MAP[source];           // known label/domain
  if (source.includes('.') && !source.includes(' '))                   // bare domain like foo.com
    return 'https://' + source;
  return null;
}

function groupByDate(events) {
  return events.reduce((acc, ev) => {
    if (!acc[ev.date]) acc[ev.date] = [];
    acc[ev.date].push(ev);
    return acc;
  }, {});
}

function isTimeBand(timeStr, startH, endH) {
  if (!timeStr || timeStr.toLowerCase().includes('all day')) return false;
  const match = timeStr.match(/(\d+)(?::(\d+))?\s*(AM|PM)/i);
  if (!match) return false;
  let h = parseInt(match[1]);
  const meridiem = match[3].toUpperCase();
  if (meridiem === 'PM' && h !== 12) h += 12;
  if (meridiem === 'AM' && h === 12) h = 0;
  return h >= startH && h < endH;
}

function getCategoryAccent(cat) {
  const map = {
    'Marathon':              '#c00000',
    'Race':                  '#e87c00',
    'Youth Race':            '#66bb6a',
    'Shakeout Run':          '#2ecc71',
    'Expo':                  '#4a90d9',
    'Fan Event':             '#9b59b6',
    'Brand Activation':      '#f5c400',
    'Post-Race Party':       '#e91e8c',
    'Post-Race Celebration': '#e91e63',
    'Community Run':         '#1abc9c',
    'Community Service':     '#388e3c',
    'Film / Community':      '#8e44ad',
    'Film Premiere':         '#7e57c2',
    'Meet & Greet':          '#d63097',
    'Evening Event':         '#888',
    'Dinner Event':          '#d4ac0d',
    'Block Party':           '#e91e63',
    'Spectator / Cheer Zone':'#42a5f5',
    'Official BAA':          '#5c6bc0',
    'Awards / Community':    '#ab47bc',
    'Podcast / Community':   '#26a69a',
    'Race-Day Activation':   '#ffca28',
    'Street Fair':           '#1abc9c',
  };
  return map[cat] || 'var(--blue)';
}

// ============================================
// SUBMIT EVENT MODAL
// ============================================
function openSubmitModal() {
  // Reset to step 1 each time
  document.getElementById('submitStep1').style.display = '';
  document.getElementById('submitStep2').style.display = 'none';
  clearSubmitForm();
  document.getElementById('submitOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  // Focus first field
  setTimeout(() => document.getElementById('sf-name')?.focus(), 100);
}

function closeSubmitModal(e) {
  if (e && e.target !== document.getElementById('submitOverlay')) return;
  document.getElementById('submitOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

function clearSubmitForm() {
  ['sf-name','sf-date','sf-time','sf-cost','sf-location','sf-description',
   'sf-sponsor','sf-names','sf-giveaways','sf-link','sf-source','sf-submitter']
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
      if (el) el.classList.remove('error');
    });
  ['err-name','err-date','err-location'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '';
  });
}

function submitEvent() {
  // Validate required fields
  const name     = document.getElementById('sf-name').value.trim();
  const date     = document.getElementById('sf-date').value;
  const location = document.getElementById('sf-location').value.trim();
  let valid = true;

  if (!name) {
    document.getElementById('sf-name').classList.add('error');
    document.getElementById('err-name').textContent = 'Event name is required.';
    valid = false;
  } else {
    document.getElementById('sf-name').classList.remove('error');
    document.getElementById('err-name').textContent = '';
  }

  if (!date) {
    document.getElementById('sf-date').classList.add('error');
    document.getElementById('err-date').textContent = 'Please select a date.';
    valid = false;
  } else {
    document.getElementById('sf-date').classList.remove('error');
    document.getElementById('err-date').textContent = '';
  }

  if (!location) {
    document.getElementById('sf-location').classList.add('error');
    document.getElementById('err-location').textContent = 'Location is required.';
    valid = false;
  } else {
    document.getElementById('sf-location').classList.remove('error');
    document.getElementById('err-location').textContent = '';
  }

  if (!valid) return;

  // Collect all fields
  const time       = document.getElementById('sf-time').value.trim();
  const cost       = document.getElementById('sf-cost').value.trim();
  const desc       = document.getElementById('sf-description').value.trim();
  const sponsor    = document.getElementById('sf-sponsor').value.trim();
  const names      = document.getElementById('sf-names').value.trim();
  const giveaways  = document.getElementById('sf-giveaways').value.trim();
  const link       = document.getElementById('sf-link').value.trim();
  const source     = document.getElementById('sf-source').value.trim();
  const submitter  = document.getElementById('sf-submitter').value.trim();

  // Build email body
  const line = (label, val) => val ? `${label}: ${val}\n` : '';
  const body = [
    '📬 NEW EVENT SUBMISSION — Boston Marathon 2026 Event Tracker',
    '='.repeat(55),
    '',
    line('Event Name',    name),
    line('Date',          date),
    line('Time',          time),
    line('Location',      location),
    line('Cost',          cost),
    '',
    line('Description',   desc),
    '',
    line('Sponsor / Brand',          sponsor),
    line('Notable Names / Athletes', names),
    line('Giveaways / Perks',        giveaways),
    line('Signup / Event Link',      link),
    '',
    '— Submission Details —',
    line('Source (where they saw it)', source),
    line('Submitter Email',            submitter),
    '',
    `Submitted via Boston Marathon 2026 Event Tracker on ${new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })}`,
  ].join('\n');

  const subject = encodeURIComponent(`[Event Submission] ${name} — ${date}`);
  const bodyEnc = encodeURIComponent(body);
  const mailto  = `mailto:bostonmarathonevents@gmail.com?subject=${subject}&body=${bodyEnc}`;

  // Open mail client
  window.location.href = mailto;

  // Show success step after a short delay (give mailto time to trigger)
  setTimeout(() => {
    document.getElementById('submitStep1').style.display = 'none';
    document.getElementById('submitStep2').style.display = '';
  }, 600);
}

// ============================================
// CONTACT MODAL
// ============================================
function openContactModal() {
  document.getElementById('contactStep1').style.display = '';
  document.getElementById('contactStep2').style.display = 'none';
  ['cf-name','cf-email','cf-message'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('cf-subject').value = 'General Question';
  document.getElementById('err-cf-message').textContent = '';
  document.getElementById('cf-message').classList.remove('error');
  document.getElementById('contactOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('cf-name')?.focus(), 100);
}

function closeContactModal(e) {
  if (e && e.target !== document.getElementById('contactOverlay')) return;
  document.getElementById('contactOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

function sendContact() {
  const message = document.getElementById('cf-message').value.trim();
  if (!message) {
    document.getElementById('cf-message').classList.add('error');
    document.getElementById('err-cf-message').textContent = 'Please enter a message.';
    return;
  }
  document.getElementById('cf-message').classList.remove('error');
  document.getElementById('err-cf-message').textContent = '';

  const name    = document.getElementById('cf-name').value.trim();
  const email   = document.getElementById('cf-email').value.trim();
  const subject = document.getElementById('cf-subject').value;

  const line = (label, val) => val ? `${label}: ${val}\n` : '';
  const body = [
    `📬 CONTACT MESSAGE — Boston Marathon 2026 Event Tracker`,
    '='.repeat(50),
    '',
    line('Name',  name),
    line('Email', email),
    '',
    'Message:',
    message,
    '',
    `Sent via Boston Marathon 2026 Event Tracker on ${new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })}`,
  ].join('\n');

  const subjectEnc = encodeURIComponent(`[${subject}] Boston Marathon 2026 Event Tracker`);
  const bodyEnc    = encodeURIComponent(body);
  window.location.href = `mailto:bostonmarathonevents@gmail.com?subject=${subjectEnc}&body=${bodyEnc}`;

  setTimeout(() => {
    document.getElementById('contactStep1').style.display = 'none';
    document.getElementById('contactStep2').style.display = '';
  }, 600);
}

// ============================================
// START
// ============================================
init();
