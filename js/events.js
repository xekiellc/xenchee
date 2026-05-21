async function waitForDb(timeout = 5000) {
  const start = Date.now();
  while (!window.db) {
    if (Date.now() - start > timeout) throw new Error('Supabase init timeout');
    await new Promise(r => setTimeout(r, 50));
  }
}

let currentUser = null;
let currentProfile = null;
let currentFilter = 'upcoming';
let allCommunities = [];

document.addEventListener('DOMContentLoaded', async () => {
  await waitForDb();

  currentUser = await window.auth.getUser();
  if (!currentUser) {
    window.location.href = '/login.html';
    return;
  }

  const { data: profile } = await window.db
    .from('profiles')
    .select('*')
    .eq('user_id', currentUser.id)
    .single();

  currentProfile = profile;

  document.getElementById('logout-btn').addEventListener('click', async () => {
    await window.auth.signOut();
    window.location.href = '/';
  });

  // Load communities for dropdown
  const { data: communities } = await window.db
    .from('communities')
    .select('id, name')
    .order('name');

  if (communities) {
    allCommunities = communities;
    const select = document.getElementById('event-community');
    communities.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      select.appendChild(opt);
    });
  }

  // Filter buttons
  document.querySelectorAll('.event-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentFilter = btn.dataset.filter;
      document.querySelectorAll('.event-filter-btn').forEach(b => b.className = 'btn btn-ghost event-filter-btn');
      btn.className = 'btn btn-primary event-filter-btn';
      loadEvents();
    });
  });

  // Create event
  document.getElementById('create-event-btn').addEventListener('click', () => {
    const form = document.getElementById('create-event-form');
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
    form.scrollIntoView({ behavior: 'smooth' });
  });

  document.getElementById('cancel-event-btn').addEventListener('click', () => {
    document.getElementById('create-event-form').style.display = 'none';
    clearEventForm();
  });

  document.getElementById('save-event-btn').addEventListener('click', handleCreateEvent);

  // Online toggle — hide/show location
  document.getElementById('event-is-online').addEventListener('change', (e) => {
    document.getElementById('location-group').style.display = e.target.checked ? 'none' : 'block';
  });

  // Set default date to now
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  document.getElementById('event-date').value = now.toISOString().slice(0, 16);

  await Promise.all([
    loadEvents(),
    loadThisWeekSidebar(),
    loadMyRsvpsSidebar()
  ]);
});

async function loadEvents() {
  const container = document.getElementById('events-container');
  container.innerHTML = '<div class="loading"><div class="spinner"></div>Loading events...</div>';

  try {
    const now = new Date().toISOString();
    const weekEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    let query = window.db
      .from('events')
      .select('*')
      .order('event_date', { ascending: true });

    if (currentFilter === 'upcoming') {
      query = query.gte('event_date', now);
    } else if (currentFilter === 'today') {
      query = query.gte('event_date', todayStart.toISOString()).lte('event_date', todayEnd.toISOString());
    } else if (currentFilter === 'this_week') {
      query = query.gte('event_date', now).lte('event_date', weekEnd);
    } else if (currentFilter === 'past') {
      query = query.lt('event_date', now).order('event_date', { ascending: false });
    } else if (currentFilter === 'going') {
      // Get event IDs user RSVPd going to
      const { data: rsvps } = await window.db
        .from('event_rsvps')
        .select('event_id')
        .eq('user_id', currentUser.id)
        .eq('status', 'going');

      if (!rsvps || rsvps.length === 0) {
        container.innerHTML = `
          <div class="post-card" style="text-align:center;padding:40px;">
            <div style="font-size:40px;margin-bottom:12px;">🎟️</div>
            <div style="font-size:17px;font-weight:700;color:var(--text);margin-bottom:8px;">No RSVPs yet</div>
            <div style="font-size:14px;color:var(--text-muted);">Mark yourself as Going on events you plan to attend.</div>
          </div>
        `;
        return;
      }

      const eventIds = rsvps.map(r => r.event_id);
      query = window.db.from('events').select('*').in('id', eventIds).order('event_date', { ascending: true });
    }

    const { data: events, error } = await query.limit(50);
    if (error) throw error;

    if (!events || events.length === 0) {
      container.innerHTML = `
        <div class="post-card" style="text-align:center;padding:40px;">
          <div style="font-size:40px;margin-bottom:12px;">📭</div>
          <div style="font-size:17px;font-weight:700;color:var(--text);margin-bottom:8px;">No events found</div>
          <div style="font-size:14px;color:var(--text-muted);">Be the first to create one!</div>
          <button class="btn btn-primary" style="margin-top:16px;" onclick="document.getElementById('create-event-btn').click()">+ Create Event</button>
        </div>
      `;
      return;
    }

    // Fetch RSVP counts and user's RSVPs
    const eventIds = events.map(e => e.id);

    const { data: rsvpCounts } = await window.db
      .from('event_rsvps')
      .select('event_id, status')
      .in('event_id', eventIds);

    const rsvpCountMap = {};
    if (rsvpCounts) {
      rsvpCounts.forEach(r => {
        if (!rsvpCountMap[r.event_id]) rsvpCountMap[r.event_id] = { going: 0, interested: 0 };
        if (r.status === 'going') rsvpCountMap[r.event_id].going++;
        if (r.status === 'interested') rsvpCountMap[r.event_id].interested++;
      });
    }

    const { data: myRsvps } = await window.db
      .from('event_rsvps')
      .select('event_id, status')
      .in('event_id', eventIds)
      .eq('user_id', currentUser.id);

    const myRsvpMap = {};
    if (myRsvps) myRsvps.forEach(r => { myRsvpMap[r.event_id] = r.status; });

    // Fetch community names
    const communityIds = [...new Set(events.filter(e => e.community_id).map(e => e.community_id))];
    const communityMap = {};
    if (communityIds.length > 0) {
      const { data: comms } = await window.db
        .from('communities')
        .select('id, name, slug')
        .in('id', communityIds);
      if (comms) comms.forEach(c => { communityMap[c.id] = c; });
    }

    // Fetch creator profiles
    const creatorIds = [...new Set(events.map(e => e.created_by).filter(Boolean))];
    const creatorMap = {};
    if (creatorIds.length > 0) {
      const { data: creators } = await window.db
        .from('profiles')
        .select('user_id, username, display_name')
        .in('user_id', creatorIds);
      if (creators) creators.forEach(p => { creatorMap[p.user_id] = p; });
    }

    container.innerHTML = events.map(event =>
      renderEventCard(event, rsvpCountMap, myRsvpMap, communityMap, creatorMap)
    ).join('');

    attachEventListeners();

  } catch (err) {
    console.error('Events error:', err);
    container.innerHTML = '<div class="loading">Could not load events. Please refresh.</div>';
  }
}

function renderEventCard(event, rsvpCountMap, myRsvpMap, communityMap, creatorMap) {
  const eventDate = new Date(event.event_date);
  const now = new Date();
  const isPast = eventDate < now;

  const dateStr = eventDate.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  const endStr = event.end_date
    ? new Date(event.end_date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    : null;

  const community = event.community_id && communityMap[event.community_id];
  const creator = event.created_by && creatorMap[event.created_by];
  const counts = rsvpCountMap[event.id] || { going: 0, interested: 0 };
  const myRsvp = myRsvpMap[event.id];
  const isOwner = event.created_by === currentUser?.id;

  const daysUntil = Math.ceil((eventDate - now) / (1000 * 60 * 60 * 24));
  let urgencyBadge = '';
  if (!isPast) {
    if (daysUntil === 0) urgencyBadge = `<span style="font-size:11px;padding:2px 8px;border-radius:100px;background:rgba(239,68,68,0.15);color:#ef4444;font-weight:600;">Today</span>`;
    else if (daysUntil === 1) urgencyBadge = `<span style="font-size:11px;padding:2px 8px;border-radius:100px;background:rgba(245,166,35,0.15);color:#f5a623;font-weight:600;">Tomorrow</span>`;
    else if (daysUntil <= 7) urgencyBadge = `<span style="font-size:11px;padding:2px 8px;border-radius:100px;background:rgba(99,102,241,0.15);color:var(--primary);font-weight:600;">This week</span>`;
  }

  const goingBtnStyle = myRsvp === 'going'
    ? 'background:var(--primary);color:#fff;border-color:var(--primary);font-weight:700;'
    : '';
  const interestedBtnStyle = myRsvp === 'interested'
    ? 'background:rgba(99,102,241,0.15);color:var(--primary);border-color:var(--primary);font-weight:700;'
    : '';

  return `
    <div class="post-card" data-event-id="${event.id}" style="margin-bottom:16px;${isPast ? 'opacity:0.7;' : ''}">
      ${event.cover_url ? `
        <div style="margin:-1px -1px 16px -1px;border-radius:var(--radius-lg) var(--radius-lg) 0 0;overflow:hidden;height:160px;">
          <img src="${escapeHtml(event.cover_url)}" alt="${escapeHtml(event.title)}"
            style="width:100%;height:100%;object-fit:cover;"
            onerror="this.parentElement.style.display='none'" />
        </div>
      ` : ''}

      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">
            ${urgencyBadge}
            ${event.is_online ? `<span style="font-size:11px;padding:2px 8px;border-radius:100px;background:rgba(76,175,125,0.15);color:#4caf7d;font-weight:600;">🌐 Online</span>` : ''}
            ${isPast ? `<span style="font-size:11px;padding:2px 8px;border-radius:100px;background:var(--bg-input);color:var(--text-muted);font-weight:600;">Past</span>` : ''}
          </div>

          <div style="font-size:18px;font-weight:800;color:var(--text);margin-bottom:6px;line-height:1.3;">
            ${escapeHtml(event.title)}
          </div>

          <div style="font-size:14px;color:var(--primary);font-weight:600;margin-bottom:4px;">
            📅 ${dateStr}${endStr ? ` — ${endStr}` : ''}
          </div>

          ${event.location ? `<div style="font-size:13px;color:var(--text-muted);margin-bottom:4px;">📍 ${escapeHtml(event.location)}</div>` : ''}
          ${event.url ? `<div style="font-size:13px;margin-bottom:4px;"><a href="${escapeHtml(event.url)}" target="_blank" rel="noopener" style="color:var(--primary);text-decoration:none;">🔗 ${escapeHtml(event.url.replace(/^https?:\/\//, '').slice(0, 40))}${event.url.length > 45 ? '...' : ''}</a></div>` : ''}
          ${community ? `<div style="font-size:13px;color:var(--text-muted);margin-bottom:4px;">💬 <a href="/community.html?slug=${community.slug}" style="color:var(--text-muted);text-decoration:none;">${escapeHtml(community.name)}</a></div>` : ''}
          ${creator ? `<div style="font-size:12px;color:var(--text-muted);">by @${escapeHtml(creator.username)}</div>` : ''}
        </div>

        ${isOwner && !isPast ? `
          <button class="delete-event-btn btn btn-ghost" data-event-id="${event.id}"
            style="font-size:12px;color:var(--danger);flex-shrink:0;padding:6px 10px;">
            🗑️
          </button>
        ` : ''}
      </div>

      ${event.description ? `
        <div style="font-size:14px;color:var(--text-secondary);line-height:1.6;margin-top:12px;margin-bottom:12px;">
          ${escapeHtml(event.description).slice(0, 200)}${event.description.length > 200 ? '...' : ''}
        </div>
      ` : ''}

      <div style="display:flex;gap:8px;align-items:center;margin-top:12px;flex-wrap:wrap;">
        ${!isPast ? `
          <button class="rsvp-going-btn post-action-btn" data-event-id="${event.id}"
            style="font-size:13px;border:1px solid var(--border);border-radius:8px;padding:6px 14px;${goingBtnStyle}">
            ✅ Going ${counts.going > 0 ? `(${counts.going})` : ''}
          </button>
          <button class="rsvp-interested-btn post-action-btn" data-event-id="${event.id}"
            style="font-size:13px;border:1px solid var(--border);border-radius:8px;padding:6px 14px;${interestedBtnStyle}">
            ⭐ Interested ${counts.interested > 0 ? `(${counts.interested})` : ''}
          </button>
        ` : `
          <span style="font-size:13px;color:var(--text-muted);">
            ${counts.going} went · ${counts.interested} were interested
          </span>
        `}
      </div>
    </div>
  `;
}

function attachEventListeners() {
  document.querySelectorAll('.rsvp-going-btn').forEach(btn => {
    btn.addEventListener('click', () => handleRsvp(btn.dataset.eventId, 'going'));
  });

  document.querySelectorAll('.rsvp-interested-btn').forEach(btn => {
    btn.addEventListener('click', () => handleRsvp(btn.dataset.eventId, 'interested'));
  });

  document.querySelectorAll('.delete-event-btn').forEach(btn => {
    btn.addEventListener('click', () => handleDeleteEvent(btn.dataset.eventId));
  });
}

async function handleRsvp(eventId, status) {
  if (!currentUser) return;

  try {
    const { data: existing } = await window.db
      .from('event_rsvps')
      .select('id, status')
      .eq('event_id', eventId)
      .eq('user_id', currentUser.id)
      .single();

    if (existing) {
      if (existing.status === status) {
        // Toggle off
        await window.db.from('event_rsvps').delete().eq('id', existing.id);
      } else {
        // Change status
        await window.db.from('event_rsvps').update({ status }).eq('id', existing.id);
      }
    } else {
      await window.db.from('event_rsvps').insert({
        event_id: eventId,
        user_id: currentUser.id,
        status
      });
    }

    await Promise.all([loadEvents(), loadMyRsvpsSidebar()]);

  } catch (err) {
    console.error('RSVP error:', err);
  }
}

async function handleDeleteEvent(eventId) {
  if (!confirm('Delete this event?')) return;
  await window.db.from('events').delete().eq('id', eventId).eq('created_by', currentUser.id);
  await loadEvents();
}

async function handleCreateEvent() {
  const title = document.getElementById('event-title').value.trim();
  const description = document.getElementById('event-description').value.trim();
  const eventDate = document.getElementById('event-date').value;
  const endDate = document.getElementById('event-end-date').value;
  const location = document.getElementById('event-location').value.trim();
  const url = document.getElementById('event-url').value.trim();
  const communityId = document.getElementById('event-community').value;
  const isOnline = document.getElementById('event-is-online').checked;

  const errorEl = document.getElementById('create-event-error');
  errorEl.style.display = 'none';

  if (!title) { showEventError('Event title is required.'); return; }
  if (!eventDate) { showEventError('Start date and time is required.'); return; }

  const btn = document.getElementById('save-event-btn');
  btn.textContent = 'Creating...';
  btn.disabled = true;

  try {
    const { error } = await window.db.from('events').insert({
      title,
      description: description || null,
      event_date: new Date(eventDate).toISOString(),
      end_date: endDate ? new Date(endDate).toISOString() : null,
      location: location || null,
      url: url || null,
      community_id: communityId || null,
      is_online: isOnline,
      created_by: currentUser.id
    });

    if (error) throw error;

    document.getElementById('create-event-form').style.display = 'none';
    clearEventForm();
    currentFilter = 'upcoming';
    document.querySelectorAll('.event-filter-btn').forEach(b => b.className = 'btn btn-ghost event-filter-btn');
    document.querySelector('.event-filter-btn[data-filter="upcoming"]').className = 'btn btn-primary event-filter-btn';
    await Promise.all([loadEvents(), loadThisWeekSidebar()]);

  } catch (err) {
    console.error('Create event error:', err);
    showEventError('Something went wrong. Please try again.');
  }

  btn.textContent = 'Create Event';
  btn.disabled = false;
}

function showEventError(msg) {
  const el = document.getElementById('create-event-error');
  el.textContent = msg;
  el.style.display = 'block';
}

function clearEventForm() {
  document.getElementById('event-title').value = '';
  document.getElementById('event-description').value = '';
  document.getElementById('event-end-date').value = '';
  document.getElementById('event-location').value = '';
  document.getElementById('event-url').value = '';
  document.getElementById('event-community').value = '';
  document.getElementById('event-is-online').checked = false;
  document.getElementById('location-group').style.display = 'block';
  document.getElementById('create-event-error').style.display = 'none';
}

async function loadThisWeekSidebar() {
  const container = document.getElementById('this-week-sidebar');
  if (!container) return;

  try {
    const now = new Date().toISOString();
    const weekEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: events } = await window.db
      .from('events')
      .select('id, title, event_date, is_online, location')
      .gte('event_date', now)
      .lte('event_date', weekEnd)
      .order('event_date', { ascending: true })
      .limit(5);

    if (!events || events.length === 0) {
      container.innerHTML = '<div style="font-size:13px;color:var(--text-muted);">No events this week.</div>';
      return;
    }

    container.innerHTML = events.map(e => {
      const d = new Date(e.event_date);
      const dateStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      return `
        <div style="padding:10px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;margin-bottom:8px;">
          <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:2px;">${escapeHtml(e.title)}</div>
          <div style="font-size:11px;color:var(--primary);">${dateStr}</div>
          ${e.is_online ? '<div style="font-size:11px;color:var(--text-muted);">🌐 Online</div>' : e.location ? `<div style="font-size:11px;color:var(--text-muted);">📍 ${escapeHtml(e.location.slice(0, 30))}</div>` : ''}
        </div>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = '<div style="font-size:13px;color:var(--text-muted);">Could not load.</div>';
  }
}

async function loadMyRsvpsSidebar() {
  const container = document.getElementById('my-rsvps-sidebar');
  if (!container) return;

  try {
    const { data: rsvps } = await window.db
      .from('event_rsvps')
      .select('event_id, status')
      .eq('user_id', currentUser.id)
      .eq('status', 'going');

    if (!rsvps || rsvps.length === 0) {
      container.innerHTML = '<div style="font-size:13px;color:var(--text-muted);">No upcoming RSVPs.</div>';
      return;
    }

    const eventIds = rsvps.map(r => r.event_id);
    const { data: events } = await window.db
      .from('events')
      .select('id, title, event_date')
      .in('id', eventIds)
      .gte('event_date', new Date().toISOString())
      .order('event_date', { ascending: true })
      .limit(5);

    if (!events || events.length === 0) {
      container.innerHTML = '<div style="font-size:13px;color:var(--text-muted);">No upcoming RSVPs.</div>';
      return;
    }

    container.innerHTML = events.map(e => {
      const d = new Date(e.event_date);
      const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `
        <div style="padding:10px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;margin-bottom:8px;">
          <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:2px;">${escapeHtml(e.title)}</div>
          <div style="font-size:11px;color:#4caf7d;">✅ Going · ${dateStr}</div>
        </div>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = '<div style="font-size:13px;color:var(--text-muted);">Could not load.</div>';
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(text || ''));
  return div.innerHTML;
}
