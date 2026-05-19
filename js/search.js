async function waitForDb(timeout = 5000) {
  const start = Date.now();
  while (!window.db) {
    if (Date.now() - start > timeout) throw new Error('Supabase init timeout');
    await new Promise(r => setTimeout(r, 50));
  }
}

let currentUser = null;
let activeTab = 'users';

document.addEventListener('DOMContentLoaded', async () => {
  await waitForDb();

  currentUser = await window.auth.getUser();
  if (!currentUser) {
    window.location.href = '/login.html';
    return;
  }

  document.getElementById('logout-btn').addEventListener('click', async () => {
    await window.auth.signOut();
    window.location.href = '/';
  });

  document.getElementById('search-btn').addEventListener('click', runSearch);

  document.getElementById('search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runSearch();
  });

  document.querySelectorAll('.search-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      activeTab = tab.dataset.tab;
      document.querySelectorAll('.search-tab').forEach(t => {
        t.className = 'btn btn-ghost search-tab';
        t.style.fontSize = '13px';
      });
      tab.className = 'btn btn-primary search-tab';
      tab.style.fontSize = '13px';

      const query = document.getElementById('search-input').value.trim();
      if (query) runSearch();
    });
  });

  // Check for query in URL
  const params = new URLSearchParams(window.location.search);
  const q = params.get('q');
  if (q) {
    document.getElementById('search-input').value = q;
    runSearch();
  }
});

async function runSearch() {
  const query = document.getElementById('search-input').value.trim();
  if (!query) return;

  // Update URL without reload
  const url = new URL(window.location);
  url.searchParams.set('q', query);
  window.history.replaceState({}, '', url);

  const container = document.getElementById('search-results');
  container.innerHTML = '<div class="loading"><div class="spinner"></div>Searching...</div>';

  if (activeTab === 'users') {
    await searchUsers(query, container);
  } else if (activeTab === 'posts') {
    await searchPosts(query, container);
  } else if (activeTab === 'communities') {
    await searchCommunities(query, container);
  }
}

async function searchUsers(query, container) {
  try {
    const { data: users, error } = await window.db
      .from('profiles')
      .select('user_id, username, display_name, bio, follower_count, post_count')
      .or(`username.ilike.%${query}%,display_name.ilike.%${query}%`)
      .order('follower_count', { ascending: false })
      .limit(20);

    if (error) throw error;

    if (!users || users.length === 0) {
      container.innerHTML = '<div class="loading">No users found.</div>';
      return;
    }

    // Check which users current user follows
    const userIds = users.map(u => u.user_id);
    const { data: follows } = await window.db
      .from('follows')
      .select('following_id')
      .eq('follower_id', currentUser.id)
      .in('following_id', userIds);

    const followingSet = new Set(follows ? follows.map(f => f.following_id) : []);

    container.innerHTML = users.map(user => {
      const isOwnProfile = user.user_id === currentUser.id;
      const isFollowing = followingSet.has(user.user_id);
      const initial = (user.username || '?').charAt(0).toUpperCase();

      return `
        <div class="post-card" style="display:flex;align-items:center;gap:14px;">
          <a href="/profile.html?user=${encodeURIComponent(user.username)}" style="text-decoration:none;flex-shrink:0;">
            <div class="post-avatar" style="width:48px;height:48px;font-size:20px;">${initial}</div>
          </a>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <a href="/profile.html?user=${encodeURIComponent(user.username)}" style="text-decoration:none;">
                <span style="font-size:15px;font-weight:700;color:var(--text);">${escapeHtml(user.display_name || user.username)}</span>
              </a>
              <span style="font-size:13px;color:var(--text-muted);">@${escapeHtml(user.username)}</span>
            </div>
            ${user.bio ? `<div style="font-size:13px;color:var(--text-muted);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(user.bio)}</div>` : ''}
            <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">
              ${user.follower_count || 0} followers · ${user.post_count || 0} posts
            </div>
          </div>
          ${!isOwnProfile ? `
            <button class="btn ${isFollowing ? 'btn-ghost' : 'btn-primary'} follow-btn"
              data-user-id="${user.user_id}"
              data-username="${escapeHtml(user.username)}"
              data-following="${isFollowing}"
              style="flex-shrink:0;font-size:13px;padding:6px 16px;">
              ${isFollowing ? 'Unfollow' : 'Follow'}
            </button>
          ` : ''}
        </div>
      `;
    }).join('');

    attachFollowListeners();

  } catch (err) {
    console.error('Search users error:', err);
    container.innerHTML = '<div class="loading">Search failed. Try again.</div>';
  }
}

async function searchPosts(query, container) {
  try {
    const { data: posts, error } = await window.db
      .from('posts')
      .select('*')
      .ilike('content', `%${query}%`)
      .eq('is_removed', false)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) throw error;

    if (!posts || posts.length === 0) {
      container.innerHTML = '<div class="loading">No posts found.</div>';
      return;
    }

    const userIds = [...new Set(posts.map(p => p.user_id))];
    const { data: profiles } = await window.db
      .from('profiles')
      .select('user_id, username, display_name')
      .in('user_id', userIds);

    const profileMap = {};
    if (profiles) profiles.forEach(p => { profileMap[p.user_id] = p; });

    container.innerHTML = posts.map(post => {
      const profile = profileMap[post.user_id];
      const username = profile?.username || 'unknown';
      const displayName = profile?.display_name || username;
      const initial = username.charAt(0).toUpperCase();
      const timestamp = new Date(post.created_at).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });

      // Highlight matching text
      const highlighted = highlightMatch(post.content || '', query);

      return `
        <div class="post-card" style="cursor:pointer;" onclick="window.location.href='/comments.html?post=${post.id}'">
          <div class="post-header">
            <div class="post-avatar" style="cursor:pointer;" onclick="event.stopPropagation();window.location.href='/profile.html?user=${encodeURIComponent(username)}'">${initial}</div>
            <div class="post-meta">
              <div class="post-username">
                <a href="/profile.html?user=${encodeURIComponent(username)}" style="text-decoration:none;color:inherit;" onclick="event.stopPropagation();">${escapeHtml(displayName)}</a>
                <span style="font-weight:400;color:var(--text-muted);font-size:13px;">@${escapeHtml(username)}</span>
              </div>
              <span class="post-timestamp">${timestamp}</span>
            </div>
          </div>
          <div class="post-content" style="margin-top:8px;">${highlighted}</div>
        </div>
      `;
    }).join('');

  } catch (err) {
    console.error('Search posts error:', err);
    container.innerHTML = '<div class="loading">Search failed. Try again.</div>';
  }
}

async function searchCommunities(query, container) {
  try {
    const { data: communities, error } = await window.db
      .from('communities')
      .select('*')
      .or(`name.ilike.%${query}%,description.ilike.%${query}%`)
      .order('member_count', { ascending: false })
      .limit(20);

    if (error) throw error;

    if (!communities || communities.length === 0) {
      container.innerHTML = '<div class="loading">No communities found.</div>';
      return;
    }

    container.innerHTML = communities.map(c => {
      const initial = c.name.charAt(0).toUpperCase();

      return `
        <a href="/community.html?slug=${c.slug}" style="text-decoration:none;">
          <div class="post-card" style="display:flex;align-items:center;gap:14px;transition:border-color 0.15s ease;">
            <div class="post-avatar" style="width:48px;height:48px;font-size:20px;flex-shrink:0;">${initial}</div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:3px;">${escapeHtml(c.name)}</div>
              ${c.description ? `<div style="font-size:13px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(c.description)}</div>` : ''}
              <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">
                ${c.member_count || 0} members · ${c.post_count || 0} posts
              </div>
            </div>
            <div class="btn btn-ghost" style="flex-shrink:0;font-size:13px;padding:6px 16px;">View →</div>
          </div>
        </a>
      `;
    }).join('');

  } catch (err) {
    console.error('Search communities error:', err);
    container.innerHTML = '<div class="loading">Search failed. Try again.</div>';
  }
}

function attachFollowListeners() {
  document.querySelectorAll('.follow-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const userId = btn.dataset.userId;
      const isFollowing = btn.dataset.following === 'true';
      btn.disabled = true;

      try {
        if (isFollowing) {
          await window.db
            .from('follows')
            .delete()
            .eq('follower_id', currentUser.id)
            .eq('following_id', userId);

          btn.textContent = 'Follow';
          btn.className = 'btn btn-primary follow-btn';
          btn.dataset.following = 'false';
        } else {
          await window.db
            .from('follows')
            .insert({ follower_id: currentUser.id, following_id: userId });

          btn.textContent = 'Unfollow';
          btn.className = 'btn btn-ghost follow-btn';
          btn.dataset.following = 'true';
        }
      } catch (err) {
        console.error('Follow error:', err);
      }

      btn.disabled = false;
    });
  });
}

function highlightMatch(text, query) {
  const escaped = escapeHtml(text);
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedQuery})`, 'gi');
  return escaped.replace(regex, '<mark style="background:rgba(99,102,241,0.3);color:var(--text);border-radius:2px;padding:0 2px;">$1</mark>');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}
