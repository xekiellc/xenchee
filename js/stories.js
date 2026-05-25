async function waitForDb(timeout = 5000) {
  const start = Date.now();
  while (!window.db) {
    if (Date.now() - start > timeout) throw new Error('Supabase init timeout');
    await new Promise(r => setTimeout(r, 50));
  }
}

let currentUser = null;
let currentProfile = null;
let allStoryGroups = [];
let currentGroupIdx = 0;
let currentStoryIdx = 0;
let storyTimer = null;
let storyDuration = 5000;
let selectedStoryFile = null;

document.addEventListener('DOMContentLoaded', async () => {
  await waitForDb();

  currentUser = await window.auth.getUser();
  if (!currentUser) { window.location.href = '/login.html'; return; }

  const { data: profile } = await window.db
    .from('profiles').select('*').eq('user_id', currentUser.id).single();
  currentProfile = profile;

  document.getElementById('logout-btn').addEventListener('click', async () => {
    await window.auth.signOut();
    window.location.href = '/';
  });

  setupUpload();
  setupViewer();
  await loadStories();
});

function setupUpload() {
  const fileInput = document.getElementById('story-file-input');
  const pickBtn = document.getElementById('story-pick-btn');
  const postBtn = document.getElementById('story-post-btn');
  const captionInput = document.getElementById('story-caption');
  const previewWrap = document.getElementById('story-preview-wrap');
  const previewImg = document.getElementById('story-preview-img');
  const previewVid = document.getElementById('story-preview-vid');
  const status = document.getElementById('story-upload-status');

  pickBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;

    const allowed = ['image/jpeg','image/png','image/gif','image/webp','video/mp4','video/quicktime','video/webm'];
    if (!allowed.includes(file.type)) {
      status.textContent = 'Only images and videos are supported.';
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      status.textContent = 'File must be under 50MB.';
      return;
    }

    selectedStoryFile = file;
    const url = URL.createObjectURL(file);
    const isVideo = file.type.startsWith('video/');

    previewImg.style.display = isVideo ? 'none' : 'block';
    previewVid.style.display = isVideo ? 'block' : 'none';

    if (isVideo) { previewVid.src = url; }
    else { previewImg.src = url; }

    previewWrap.style.display = 'block';
    captionInput.style.display = 'block';
    postBtn.style.display = 'inline-flex';
    status.textContent = '';
    fileInput.value = '';
  });

  postBtn.addEventListener('click', handlePostStory);
}

async function handlePostStory() {
  if (!selectedStoryFile) return;
  const postBtn = document.getElementById('story-post-btn');
  const status = document.getElementById('story-upload-status');
  const caption = document.getElementById('story-caption').value.trim();

  postBtn.textContent = 'Posting...';
  postBtn.disabled = true;
  status.textContent = 'Uploading...';

  try {
    const ext = selectedStoryFile.name.split('.').pop();
    const path = `stories/${currentUser.id}/${Date.now()}.${ext}`;
    const isVideo = selectedStoryFile.type.startsWith('video/');

    const { data: uploadData, error: uploadError } = await window.db.storage
      .from('voxxee-media')
      .upload(path, selectedStoryFile, { contentType: selectedStoryFile.type, upsert: false });

    if (uploadError) throw uploadError;

    const { data: urlData } = window.db.storage
      .from('voxxee-media')
      .getPublicUrl(path);

    const publicUrl = urlData?.publicUrl;
    if (!publicUrl) throw new Error('Could not get public URL');

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const { error: insertError } = await window.db.from('stories').insert({
      user_id: currentUser.id,
      media_url: publicUrl,
      media_type: isVideo ? 'video' : 'image',
      caption: caption || null,
      expires_at: expiresAt
    });

    if (insertError) throw insertError;

    // Reset form
    selectedStoryFile = null;
    document.getElementById('story-caption').value = '';
    document.getElementById('story-caption').style.display = 'none';
    document.getElementById('story-preview-wrap').style.display = 'none';
    document.getElementById('story-preview-img').src = '';
    document.getElementById('story-preview-vid').src = '';
    postBtn.style.display = 'none';
    status.textContent = '✅ Story posted!';
    setTimeout(() => { status.textContent = ''; }, 3000);

    await loadStories();

  } catch (err) {
    console.error('Story post error:', err);
    status.textContent = 'Failed to post story. Please try again.';
  }

  postBtn.textContent = 'Post Story';
  postBtn.disabled = false;
}

async function loadStories() {
  const bar = document.getElementById('stories-bar');
  bar.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  try {
    const { data: stories } = await window.db
      .from('stories')
      .select('*')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (!stories || stories.length === 0) {
      bar.innerHTML = '<div style="font-size:14px;color:var(--text-muted);padding:8px 0;">No active stories yet. Be the first!</div>';
      return;
    }

    // Group by user
    const groups = {};
    const groupOrder = [];
    for (const story of stories) {
      if (!groups[story.user_id]) {
        groups[story.user_id] = [];
        groupOrder.push(story.user_id);
      }
      groups[story.user_id].push(story);
    }

    // Fetch profiles
    const { data: profiles } = await window.db
      .from('profiles')
      .select('user_id, username, display_name')
      .in('user_id', groupOrder);

    const profileMap = {};
    if (profiles) profiles.forEach(p => { profileMap[p.user_id] = p; });

    // Build story groups array for viewer
    allStoryGroups = groupOrder.map(uid => ({
      profile: profileMap[uid] || { username: 'unknown', display_name: 'Unknown' },
      stories: groups[uid]
    }));

    // Own stories first
    const ownIdx = allStoryGroups.findIndex(g => g.profile.user_id === currentUser.id);
    if (ownIdx > 0) {
      const own = allStoryGroups.splice(ownIdx, 1)[0];
      allStoryGroups.unshift(own);
    }

    // Render bubbles
    bar.innerHTML = allStoryGroups.map((group, idx) => {
      const profile = group.profile;
      const initial = (profile.username || '?').charAt(0).toUpperCase();
      const name = profile.username === currentProfile?.username ? 'You' : (profile.display_name || profile.username);
      const isOwn = profile.user_id === currentUser.id;
      return `
        <div class="story-bubble ${isOwn ? 'add-story-bubble' : ''}" data-group-idx="${idx}">
          <div class="story-ring">
            <div class="story-ring-inner">${initial}</div>
          </div>
          <div class="story-label">${escapeHtml(name)}</div>
        </div>
      `;
    }).join('');

    bar.querySelectorAll('.story-bubble').forEach(bubble => {
      bubble.addEventListener('click', () => {
        const idx = parseInt(bubble.dataset.groupIdx);
        openStoryViewer(idx);
      });
    });

  } catch (err) {
    console.error('Load stories error:', err);
    bar.innerHTML = '<div style="font-size:14px;color:var(--text-muted);">Could not load stories.</div>';
  }
}

function setupViewer() {
  document.getElementById('story-close').addEventListener('click', closeStoryViewer);
  document.getElementById('story-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('story-modal')) closeStoryViewer();
  });
  document.getElementById('story-nav-left').addEventListener('click', () => prevStory());
  document.getElementById('story-nav-right').addEventListener('click', () => nextStory());

  document.addEventListener('keydown', (e) => {
    const modal = document.getElementById('story-modal');
    if (!modal.classList.contains('active')) return;
    if (e.key === 'ArrowRight') nextStory();
    if (e.key === 'ArrowLeft') prevStory();
    if (e.key === 'Escape') closeStoryViewer();
  });
}

function openStoryViewer(groupIdx) {
  currentGroupIdx = groupIdx;
  currentStoryIdx = 0;
  document.getElementById('story-modal').classList.add('active');
  document.body.style.overflow = 'hidden';
  showStory();
}

function closeStoryViewer() {
  clearTimeout(storyTimer);
  document.getElementById('story-modal').classList.remove('active');
  document.body.style.overflow = '';
  const vid = document.getElementById('story-viewer-vid');
  vid.pause();
  vid.src = '';
}

function showStory() {
  clearTimeout(storyTimer);

  const group = allStoryGroups[currentGroupIdx];
  if (!group) { closeStoryViewer(); return; }

  const story = group.stories[currentStoryIdx];
  if (!story) { closeStoryViewer(); return; }

  const profile = group.profile;
  const initial = (profile.username || '?').charAt(0).toUpperCase();

  document.getElementById('story-viewer-avatar').textContent = initial;
  document.getElementById('story-viewer-username').textContent = profile.display_name || profile.username;

  const age = Math.round((Date.now() - new Date(story.created_at).getTime()) / 60000);
  const timeLabel = age < 60 ? `${age}m ago` : `${Math.round(age/60)}h ago`;
  document.getElementById('story-viewer-time').textContent = timeLabel;

  const img = document.getElementById('story-viewer-img');
  const vid = document.getElementById('story-viewer-vid');
  const caption = document.getElementById('story-viewer-caption');

  if (story.media_type === 'video') {
    img.style.display = 'none';
    vid.style.display = 'block';
    vid.src = story.media_url;
    vid.play();
    storyDuration = 15000;
  } else {
    vid.pause();
    vid.style.display = 'none';
    img.style.display = 'block';
    img.src = story.media_url;
    storyDuration = 5000;
  }

  if (story.caption) {
    caption.textContent = story.caption;
    caption.style.display = 'block';
  } else {
    caption.style.display = 'none';
  }

  // Progress bar
  const fill = document.getElementById('story-progress-fill');
  fill.style.transition = 'none';
  fill.style.width = '0%';
  setTimeout(() => {
    fill.style.transition = `width ${storyDuration}ms linear`;
    fill.style.width = '100%';
  }, 50);

  storyTimer = setTimeout(() => nextStory(), storyDuration);
}

function nextStory() {
  const group = allStoryGroups[currentGroupIdx];
  if (!group) { closeStoryViewer(); return; }

  if (currentStoryIdx < group.stories.length - 1) {
    currentStoryIdx++;
    showStory();
  } else if (currentGroupIdx < allStoryGroups.length - 1) {
    currentGroupIdx++;
    currentStoryIdx = 0;
    showStory();
  } else {
    closeStoryViewer();
  }
}

function prevStory() {
  if (currentStoryIdx > 0) {
    currentStoryIdx--;
    showStory();
  } else if (currentGroupIdx > 0) {
    currentGroupIdx--;
    currentStoryIdx = allStoryGroups[currentGroupIdx].stories.length - 1;
    showStory();
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}
