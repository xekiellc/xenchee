async function waitForDb(timeout = 5000) {
  const start = Date.now();
  while (!window.db) {
    if (Date.now() - start > timeout) throw new Error('Supabase init timeout');
    await new Promise(r => setTimeout(r, 50));
  }
}

let currentUser = null;
let currentProfile = null;
let postId = null;
let selectedGifUrl = null;
let giphyApiKey = null;

document.addEventListener('DOMContentLoaded', async () => {
  await waitForDb();

  currentUser = await window.auth.getUser();
  if (!currentUser) {
    window.location.href = '/login.html';
    return;
  }

  const params = new URLSearchParams(window.location.search);
  postId = params.get('post');

  if (!postId) {
    window.location.href = '/feed.html';
    return;
  }

  const { data: profile } = await window.db
    .from('profiles')
    .select('*')
    .eq('user_id', currentUser.id)
    .single();

  currentProfile = profile;

  if (profile) {
    const avatar = document.getElementById('current-user-avatar');
    if (avatar) avatar.textContent = profile.username.charAt(0).toUpperCase();
  }

  // Fetch Giphy API key from config
  try {
    const res = await fetch('/.netlify/functions/config');
    const config = await res.json();
    giphyApiKey = config.GIPHY_API_KEY;
  } catch (err) {
    console.error('Could not load Giphy key:', err);
  }

  // Init mention autocomplete
  initMentionAutocomplete('comment-content', 'comment-mention-dropdown');

  document.getElementById('logout-btn').addEventListener('click', async () => {
    await window.auth.signOut();
    window.location.href = '/';
  });

  document.getElementById('comment-btn').addEventListener('click', handleCreateComment);

  // GIF toggle
  document.getElementById('gif-toggle-btn').addEventListener('click', () => {
    const picker = document.getElementById('gif-picker');
    const isVisible = picker.style.display !== 'none';
    picker.style.display = isVisible ? 'none' : 'block';
    if (!isVisible) {
      document.getElementById('gif-search-input').focus();
      loadTrendingGifs();
    }
  });

  // GIF search
  document.getElementById('gif-search-btn').addEventListener('click', searchGifs);
  document.getElementById('gif-search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') searchGifs();
  });

  // Remove GIF
  document.getElementById('gif-remove-btn').addEventListener('click', () => {
    selectedGifUrl = null;
    document.getElementById('gif-preview').style.display = 'none';
    document.getElementById('gif-preview-img').src = '';
    document.getElementById('gif-toggle-btn').style.fontWeight = '';
  });

  await loadPost();
  await loadComments();
});

async function loadTrendingGifs() {
  if (!giphyApiKey) return;
  const container = document.getElementById('gif-results');
  container.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:8px;">Loading trending GIFs...</div>';

  try {
    const res = await fetch(`https://api.giphy.com/v1/gifs/trending?api_key=${giphyApiKey}&limit=12&rating=g`);
    const data = await res.json();
    renderGifResults(data.data);
  } catch (err) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:8px;">Could not load GIFs.</div>';
  }
}

async function searchGifs() {
  if (!giphyApiKey) return;
  const query = document.getElementById('gif-search-input').value.trim();
  if (!query) return;

  const container = document.getElementById('gif-results');
  container.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:8px;">Searching...</div>';

  try {
    const res = await fetch(`https://api.giphy.com/v1/gifs/search?api_key=${giphyApiKey}&q=${encodeURIComponent(query)}&limit=12&rating=g`);
    const data = await res.json();
    renderGifResults(data.data);
  } catch (err) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:8px;">Search failed.</div>';
  }
}

function renderGifResults(gifs) {
  const container = document.getElementById('gif-results');

  if (!gifs || gifs.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:8px;">No GIFs found.</div>';
    return;
  }

  container.innerHTML = gifs.map(gif => {
    const preview = gif.images.fixed_height_small.url;
    const full = gif.images.fixed_height.url;
    return `
      <img
        src="${preview}"
        data-full="${full}"
        alt="${escapeHtml(gif.title || 'GIF')}"
        style="width:100%;height:80px;object-fit:cover;border-radius:6px;cursor:pointer;transition:opacity 0.15s ease;"
        class="gif-result-item"
        onmouseover="this.style.opacity='0.8'"
        onmouseout="this.style.opacity='1'"
      />
    `;
  }).join('');

  container.querySelectorAll('.gif-result-item').forEach(img => {
    img.addEventListener('click', () => {
      selectedGifUrl = img.dataset.full;
      document.getElementById('gif-preview-img').src = selectedGifUrl;
      document.getElementById('gif-preview').style.display = 'block';
      document.getElementById('gif-picker').style.display = 'none';
      document.getElementById('gif-toggle-btn').style.fontWeight = '700';
    });
  });
}

async function loadPost() {
  const container = document.getElementById('original-post');

  try {
    const { data: post, error } = await window.db
      .from('posts')
      .select('*')
      .eq('id', postId)
      .eq('is_removed', false)
      .single();

    if (error || !post) {
      container.innerHTML = '<div class="loading">Post not found.</div>';
      return;
    }

    const { data: profile } = await window.db
      .from('profiles')
      .select('username, display_name')
      .eq('user_id', post.user_id)
      .single();

    const username = profile?.username || 'unknown';
    const displayName = profile?.display_name || username;
    const initial = username.charAt(0).toUpperCase();
    const timestamp = new Date(post.created_at).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    container.innerHTML = `
      <div class="post-header">
        <div class="post-avatar">${initial}</div>
        <div class="post-meta">
          <div class="post-username">
            <a href="/profile.html?user=${encodeURIComponent(username)}" style="text-decoration:none;color:inherit;">${escapeHtml(displayName)}</a>
            <span style="font-weight:400;color:var(--text-muted);font-size:13px;">@${escapeHtml(username)}</span>
          </div>
          <span class="post-timestamp">${timestamp}</span>
        </div>
      </div>
      <div class="post-content" style="margin-top:12px;">${renderMentions(post.content || '')}</div>
    `;

  } catch (err) {
    console.error('Load post error:', err);
    container.innerHTML = '<div class="loading">Could not load post.</div>';
  }
}

async function loadComments() {
  const container = document.getElementById('comments-container');
  container.innerHTML = '<div class="loading"><div class="spinner"></div>Loading comments...</div>';

  try {
    const { data: comments, error } = await window.db
      .from('comments')
      .select('*')
      .eq('post_id', postId)
      .eq('is_removed', false)
      .order('created_at', { ascending: true });

    if (error) throw error;

    if (!comments || comments.length === 0) {
      container.innerHTML = '<div class="loading">No comments yet. Be the first.</div>';
      return;
    }

    const userIds = [...new Set(comments.map(c => c.user_id))];
    const { data: profiles } = await window.db
      .from('profiles')
      .select('user_id, username, display_name')
      .in('user_id', userIds);

    const profileMap = {};
    if (profiles) profiles.forEach(p => { profileMap[p.user_id] = p; });

    container.innerHTML = comments.map(comment => renderComment(comment, profileMap)).join('');
    attachCommentListeners();

  } catch (err) {
    console.error('Load comments error:', err);
    container.innerHTML = '<div class="loading">Could not load comments.</div>';
  }
}

function renderComment(comment, profileMap) {
  const profile = profileMap[comment.user_id];
  const username = profile?.username || 'unknown';
  const displayName = profile?.display_name || username;
  const initial = username.charAt(0).toUpperCase();
  const timestamp = new Date(comment.created_at).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  const isGif = comment.content &&
    comment.content.startsWith('https://media') &&
    comment.content.includes('giphy.com');

  const contentHtml = isGif
    ? `<img src="${comment.content}" alt="GIF" style="max-width:100%;max-height:200px;border-radius:8px;margin-top:8px;display:block;" />`
    : `<div class="post-content" style="margin-top:8px;font-size:15px;">${renderMentions(comment.content || '')}</div>`;

  return `
    <div class="post-card" data-comment-id="${comment.id}">
      <div class="post-header">
        <div class="post-avatar" style="width:36px;height:36px;font-size:14px;">${initial}</div>
        <div class="post-meta">
          <div class="post-username">
            <a href="/profile.html?user=${encodeURIComponent(username)}" style="text-decoration:none;color:inherit;">${escapeHtml(displayName)}</a>
            <span style="font-weight:400;color:var(--text-muted);font-size:13px;">@${escapeHtml(username)}</span>
          </div>
          <span class="post-timestamp">${timestamp}</span>
        </div>
      </div>
      ${contentHtml}
      <div class="post-actions">
        ${comment.user_id === currentUser?.id ? `
          <button class="post-action-btn delete-comment-btn" data-comment-id="${comment.id}" style="margin-left:auto;color:var(--danger);">
            🗑️
          </button>
        ` : ''}
      </div>
    </div>
  `;
}

function attachCommentListeners() {
  document.querySelectorAll('.delete-comment-btn').forEach(btn => {
    btn.addEventListener('click', () => handleDeleteComment(btn.dataset.commentId));
  });
}

async function handleCreateComment() {
  if (!currentUser) return;

  const content = document.getElementById('comment-content').value.trim();
  const hasGif = !!selectedGifUrl;

  if (!content && !hasGif) return;

  const btn = document.getElementById('comment-btn');
  btn.textContent = 'Posting...';
  btn.disabled = true;

  try {
    if (content) {
      const { error } = await window.db
        .from('comments')
        .insert({
          post_id: postId,
          user_id: currentUser.id,
          content: content
        });
      if (error) throw error;
    }

    if (hasGif) {
      const { error } = await window.db
        .from('comments')
        .insert({
          post_id: postId,
          user_id: currentUser.id,
          content: selectedGifUrl
        });
      if (error) throw error;
    }

    document.getElementById('comment-content').value = '';
    selectedGifUrl = null;
    document.getElementById('gif-preview').style.display = 'none';
    document.getElementById('gif-preview-img').src = '';
    document.getElementById('gif-toggle-btn').style.fontWeight = '';

    btn.textContent = 'Comment';
    btn.disabled = false;
    await loadComments();

  } catch (err) {
    console.error('Comment error:', err);
    btn.textContent = 'Comment';
    btn.disabled = false;
  }
}

async function handleDeleteComment(commentId) {
  if (!currentUser) return;
  if (!confirm('Delete this comment?')) return;

  await window.db
    .from('comments')
    .update({ is_removed: true })
    .eq('id', commentId)
    .eq('user_id', currentUser.id);

  await loadComments();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}
