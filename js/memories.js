async function waitForDb(timeout = 5000) {
  const start = Date.now();
  while (!window.db) {
    if (Date.now() - start > timeout) throw new Error('Supabase init timeout');
    await new Promise(r => setTimeout(r, 50));
  }
}

let currentUser = null;
let currentProfile = null;

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

  // Set date picker to today
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  document.getElementById('memory-date').value = todayStr;

  document.getElementById('browse-btn').addEventListener('click', () => {
    const val = document.getElementById('memory-date').value;
    if (val) loadMemories(new Date(val + 'T00:00:00'));
  });

  document.getElementById('today-btn').addEventListener('click', () => {
    document.getElementById('memory-date').value = todayStr;
    loadMemories(today);
  });

  document.getElementById('memory-date').addEventListener('change', (e) => {
    if (e.target.value) loadMemories(new Date(e.target.value + 'T00:00:00'));
  });

  await loadMemories(today);
});

async function loadMemories(date) {
  const container = document.getElementById('memories-container');
  const label = document.getElementById('memory-date-label');
  const sidebar = document.getElementById('memory-years-sidebar');

  container.innerHTML = '<div class="loading"><div class="spinner"></div>Loading memories...</div>';

  const month = date.getMonth() + 1;
  const day = date.getDate();
  const currentYear = new Date().getFullYear();

  const monthName = date.toLocaleDateString('en-US', { month: 'long' });
  const isToday = month === (new Date().getMonth() + 1) && day === new Date().getDate();

  label.textContent = isToday
    ? `On This Day — ${monthName} ${day}`
    : `${monthName} ${day} — Past Years`;

  try {
    // Fetch all user's posts
    const { data: allPosts, error } = await window.db
      .from('posts')
      .select('*')
      .eq('user_id', currentUser.id)
      .eq('is_removed', false)
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (!allPosts || allPosts.length === 0) {
      container.innerHTML = '<div class="loading">No posts yet — start posting to build memories!</div>';
      sidebar.innerHTML = '<div style="color:var(--text-muted);font-size:13px;">No memories yet.</div>';
      return;
    }

    // Filter to matching month/day, exclude current year for "on this day"
    const memories = allPosts.filter(post => {
      const postDate = new Date(post.created_at);
      const postMonth = postDate.getMonth() + 1;
      const postDay = postDate.getDate();
      const postYear = postDate.getFullYear();
      return postMonth === month && postDay === day && postYear !== currentYear;
    });

    // Build years sidebar
    const years = [...new Set(memories.map(p => new Date(p.created_at).getFullYear()))].sort((a, b) => b - a);

    if (years.length === 0) {
      sidebar.innerHTML = '<div style="color:var(--text-muted);font-size:13px;">No memories on this date.</div>';
    } else {
      sidebar.innerHTML = years.map(year => {
        const count = memories.filter(p => new Date(p.created_at).getFullYear() === year).length;
        return `
          <a href="#year-${year}" style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-radius:8px;margin-bottom:6px;background:var(--bg-card);border:1px solid var(--border);text-decoration:none;transition:all 0.15s ease;">
            <span style="font-size:14px;font-weight:600;color:var(--text);">${year}</span>
            <span style="font-size:12px;color:var(--text-muted);">${count} post${count !== 1 ? 's' : ''}</span>
          </a>
        `;
      }).join('');
    }

    if (memories.length === 0) {
      container.innerHTML = `
        <div class="post-card" style="text-align:center;padding:40px 24px;">
          <div style="font-size:48px;margin-bottom:16px;">📭</div>
          <div style="font-size:18px;font-weight:700;color:var(--text);margin-bottom:8px;">No memories on this day</div>
          <div style="font-size:14px;color:var(--text-muted);">You haven't posted anything on ${monthName} ${day} in previous years.</div>
        </div>
      `;
      return;
    }

    // Group by year
    const byYear = {};
    memories.forEach(post => {
      const year = new Date(post.created_at).getFullYear();
      if (!byYear[year]) byYear[year] = [];
      byYear[year].push(post);
    });

    const sortedYears = Object.keys(byYear).sort((a, b) => b - a);

    container.innerHTML = sortedYears.map(year => {
      const yearsPast = currentYear - parseInt(year);
      const yearLabel = yearsPast === 1 ? '1 year ago' : `${yearsPast} years ago`;

      return `
        <div id="year-${year}" style="margin-bottom:32px;">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
            <div style="font-size:28px;">🕰️</div>
            <div>
              <div style="font-size:18px;font-weight:800;color:var(--text);">${year}</div>
              <div style="font-size:13px;color:var(--text-muted);">${yearLabel} · ${monthName} ${day}</div>
            </div>
          </div>
          ${byYear[year].map(post => renderMemoryPost(post)).join('')}
        </div>
      `;
    }).join('');

  } catch (err) {
    console.error('Memories error:', err);
    container.innerHTML = '<div class="loading">Could not load memories. Please refresh.</div>';
  }
}

function renderMemoryPost(post) {
  const username = currentProfile?.username || 'unknown';
  const displayName = currentProfile?.display_name || username;
  const initial = username.charAt(0).toUpperCase();
  const timestamp = new Date(post.created_at).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  return `
    <div class="post-card" style="margin-bottom:12px;">
      <div class="post-header">
        <div class="post-avatar">${initial}</div>
        <div class="post-meta">
          <div class="post-username">
            ${escapeHtml(displayName)}
            <span style="font-weight:400;color:var(--text-muted);font-size:13px;">@${escapeHtml(username)}</span>
          </div>
          <span class="post-timestamp">${timestamp}</span>
        </div>
      </div>
      <div class="post-content" style="margin-top:8px;">${escapeHtml(post.content || '')}</div>
      <div class="post-actions">
        <button class="post-action-btn" onclick="window.location.href='/comments.html?post=${post.id}'">
          💬 View Post
        </button>
        <button class="post-action-btn" onclick="shareMemory('${post.id}')">
          🔗 Share Memory
        </button>
      </div>
    </div>
  `;
}

function shareMemory(postId) {
  const url = `${window.location.origin}/comments.html?post=${postId}`;
  navigator.clipboard.writeText(url).then(() => {
    alert('Link copied!');
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}
