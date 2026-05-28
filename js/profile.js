async function waitForDb(timeout = 5000) {
  const start = Date.now();
  while (!window.db) {
    if (Date.now() - start > timeout) throw new Error('Supabase init timeout');
    await new Promise(r => setTimeout(r, 50));
  }
}

let currentUser = null;
let viewingProfile = null;
let isOwnProfile = false;
let isFollowing = false;
let mutedKeywords = [];
let callFrame = null;
let currentLiveSession = null;
let liveSessionSubscription = null;
let viewerCountInterval = null;

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

  setupLiveModalListeners();

  const params = new URLSearchParams(window.location.search);
  const username = params.get('user') || params.get('u');

  if (username) {
    await loadProfileByUsername(username);
  } else {
    await loadOwnProfile();
  }
});

// ─── BANNER UPLOAD ────────────────────────────────────────────────────────────

function setupBannerUpload() {
  const btn = document.getElementById('banner-upload-btn');
  const fileInput = document.getElementById('banner-file-input');
  if (!btn || !fileInput) return;

  btn.classList.add('visible');

  btn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    await uploadBanner(file);
    fileInput.value = '';
  });
}

async function uploadBanner(file) {
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowed.includes(file.type)) {
    alert('Please choose a JPG, PNG, or WEBP image.');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    alert('Banner image must be under 10MB.');
    return;
  }

  const btn = document.getElementById('banner-upload-btn');
  if (btn) { btn.textContent = 'Uploading...'; btn.disabled = true; }

  try {
    const ext = file.name.split('.').pop().toLowerCase() || 'jpg';
    const path = `banners/${currentUser.id}/${Date.now()}.${ext}`;

    const { error: uploadError } = await window.db.storage
      .from('voxxee-media')
      .upload(path, file, { upsert: true, contentType: file.type });

    if (uploadError) throw uploadError;

    const { data: urlData } = window.db.storage
      .from('voxxee-media')
      .getPublicUrl(path);

    const publicUrl = urlData.publicUrl;

    const { error: updateError } = await window.db
      .from('profiles')
      .update({ banner_url: publicUrl })
      .eq('user_id', currentUser.id);

    if (updateError) throw updateError;

    if (viewingProfile) viewingProfile.banner_url = publicUrl;
    renderBannerEl(publicUrl);

  } catch (err) {
    console.error('Banner upload error:', err);
    alert('Upload failed. Please try again.');
  } finally {
    if (btn) { btn.textContent = '📷 Change Banner'; btn.disabled = false; }
  }
}

async function removeBanner() {
  if (!confirm('Remove your banner photo?')) return;
  try {
    const { error } = await window.db
      .from('profiles')
      .update({ banner_url: null })
      .eq('user_id', currentUser.id);
    if (error) throw error;
    if (viewingProfile) viewingProfile.banner_url = null;
    renderBannerEl(null);
  } catch (err) {
    console.error('Remove banner error:', err);
    alert('Failed to remove banner. Please try again.');
  }
}

function renderBannerEl(bannerUrl) {
  const bannerEl = document.getElementById('profile-banner');
  const imgEl = document.getElementById('profile-banner-img');
  if (!bannerEl) return;
  if (bannerUrl && imgEl) {
    imgEl.src = bannerUrl;
    imgEl.style.display = 'block';
    bannerEl.style.background = '#000';
  } else {
    if (imgEl) imgEl.style.display = 'none';
    bannerEl.style.background = 'linear-gradient(135deg, var(--primary) 0%, #a78bfa 100%)';
  }
}

// ─── AVATAR UPLOAD ────────────────────────────────────────────────────────────

function setupAvatarUpload() {
  const section = document.getElementById('avatar-upload-section');
  const uploadBtn = document.getElementById('avatar-upload-btn');
  const deleteBtn = document.getElementById('avatar-delete-btn');
  const fileInput = document.getElementById('avatar-file-input');
  if (!uploadBtn || !fileInput) return;

  if (section) section.style.display = 'block';

  uploadBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    await uploadAvatar(file);
    fileInput.value = '';
  });

  if (deleteBtn) deleteBtn.addEventListener('click', removeAvatar);
}

async function removeAvatar() {
  if (!confirm('Remove your profile photo?')) return;
  try {
    const { error } = await window.db
      .from('profiles')
      .update({ avatar_url: null })
      .eq('user_id', currentUser.id);
    if (error) throw error;
    if (viewingProfile) viewingProfile.avatar_url = null;
    renderAvatarEl(null, viewingProfile?.username || '');
  } catch (err) {
    console.error('Remove avatar error:', err);
    alert('Failed to remove photo. Please try again.');
  }
}

async function uploadAvatar(file) {
  const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!allowed.includes(file.type)) {
    alert('Please choose a JPG, PNG, GIF, or WEBP image.');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    alert('Image must be under 5MB.');
    return;
  }

  const uploadBtn = document.getElementById('avatar-upload-btn');
  const uploadingEl = document.getElementById('avatar-uploading');

  if (uploadBtn) uploadBtn.style.display = 'none';
  if (uploadingEl) uploadingEl.style.display = 'inline';

  try {
    const ext = file.name.split('.').pop().toLowerCase() || 'jpg';
    const path = `avatars/${currentUser.id}/${Date.now()}.${ext}`;

    const { error: uploadError } = await window.db.storage
      .from('voxxee-media')
      .upload(path, file, { upsert: true, contentType: file.type });

    if (uploadError) throw uploadError;

    const { data: urlData } = window.db.storage
      .from('voxxee-media')
      .getPublicUrl(path);

    const publicUrl = urlData.publicUrl;

    const { error: updateError } = await window.db
      .from('profiles')
      .update({ avatar_url: publicUrl })
      .eq('user_id', currentUser.id);

    if (updateError) throw updateError;

    if (viewingProfile) viewingProfile.avatar_url = publicUrl;
    renderAvatarEl(publicUrl, viewingProfile?.username || '');

  } catch (err) {
    console.error('Avatar upload error:', err);
    alert('Upload failed. Please try again.');
  } finally {
    if (uploadBtn) uploadBtn.style.display = 'inline-block';
    if (uploadingEl) uploadingEl.style.display = 'none';
  }
}

function renderAvatarEl(avatarUrl, username) {
  const initial = (username || '?').charAt(0).toUpperCase();
  const imgEl = document.getElementById('profile-avatar-img');
  const initialEl = document.getElementById('profile-avatar-initial');

  if (avatarUrl && imgEl) {
    imgEl.src = avatarUrl;
    imgEl.style.display = 'block';
    if (initialEl) initialEl.style.display = 'none';
  } else {
    if (imgEl) imgEl.style.display = 'none';
    if (initialEl) {
      initialEl.style.display = 'block';
      initialEl.textContent = initial;
    }
  }
}

// ─── INTRO VIDEO ──────────────────────────────────────────────────────────────

function setupIntroVideoUpload() {
  const uploadBtn = document.getElementById('intro-video-upload-btn');
  const deleteBtn = document.getElementById('intro-video-delete-btn');
  const fileInput = document.getElementById('intro-video-file-input');
  const section = document.getElementById('intro-video-upload-section');

  if (!uploadBtn || !fileInput) return;
  if (section) section.style.display = 'block';

  if (viewingProfile?.intro_video_url && deleteBtn) {
    deleteBtn.style.display = 'inline-flex';
  }

  uploadBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    await uploadIntroVideo(file);
    fileInput.value = '';
  });

  if (deleteBtn) deleteBtn.addEventListener('click', removeIntroVideo);
}

async function uploadIntroVideo(file) {
  const allowed = ['video/mp4', 'video/quicktime', 'video/webm'];
  if (!allowed.includes(file.type)) {
    alert('Please choose an MP4, MOV, or WEBM video.');
    return;
  }
  if (file.size > 50 * 1024 * 1024) {
    alert('Video must be under 50MB.');
    return;
  }

  // Check duration client-side
  const duration = await getVideoDuration(file);
  if (duration > 10) {
    alert('Intro video must be 10 seconds or less.');
    return;
  }

  const uploadBtn = document.getElementById('intro-video-upload-btn');
  const uploadingEl = document.getElementById('intro-video-uploading');
  const deleteBtn = document.getElementById('intro-video-delete-btn');

  if (uploadBtn) uploadBtn.style.display = 'none';
  if (uploadingEl) uploadingEl.style.display = 'inline';

  try {
    const ext = file.name.split('.').pop().toLowerCase() || 'mp4';
    const path = `intros/${currentUser.id}/${Date.now()}.${ext}`;

    const { error: uploadError } = await window.db.storage
      .from('voxxee-media')
      .upload(path, file, { upsert: true, contentType: file.type });

    if (uploadError) throw uploadError;

    const { data: urlData } = window.db.storage
      .from('voxxee-media')
      .getPublicUrl(path);

    const publicUrl = urlData.publicUrl;

    const { error: updateError } = await window.db
      .from('profiles')
      .update({ intro_video_url: publicUrl })
      .eq('user_id', currentUser.id);

    if (updateError) throw updateError;

    if (viewingProfile) viewingProfile.intro_video_url = publicUrl;
    renderIntroVideoEl(publicUrl);
    if (deleteBtn) deleteBtn.style.display = 'inline-flex';

  } catch (err) {
    console.error('Intro video upload error:', err);
    alert('Upload failed. Please try again.');
  } finally {
    if (uploadBtn) uploadBtn.style.display = 'inline-flex';
    if (uploadingEl) uploadingEl.style.display = 'none';
  }
}

function getVideoDuration(file) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src);
      resolve(video.duration);
    };
    video.onerror = () => resolve(0);
    video.src = URL.createObjectURL(file);
  });
}

async function removeIntroVideo() {
  if (!confirm('Remove your intro video?')) return;
  try {
    const { error } = await window.db
      .from('profiles')
      .update({ intro_video_url: null })
      .eq('user_id', currentUser.id);
    if (error) throw error;
    if (viewingProfile) viewingProfile.intro_video_url = null;
    renderIntroVideoEl(null);
    const deleteBtn = document.getElementById('intro-video-delete-btn');
    if (deleteBtn) deleteBtn.style.display = 'none';
  } catch (err) {
    console.error('Remove intro video error:', err);
    alert('Failed to remove video. Please try again.');
  }
}

function renderIntroVideoEl(videoUrl) {
  const section = document.getElementById('intro-video-section');
  const player = document.getElementById('intro-video-player');
  if (!section || !player) return;
  if (videoUrl) {
    player.src = videoUrl;
    section.style.display = 'block';
  } else {
    player.src = '';
    section.style.display = 'none';
  }
}

// ─── TOGGLE HELPERS ───────────────────────────────────────────────────────────

function setToggleState(trackId, knobId, value) {
  const track = document.getElementById(trackId);
  const knob = document.getElementById(knobId);
  if (!track || !knob) return;
  track.dataset.on = value ? 'true' : 'false';
  track.style.background = value ? '#00e5ff' : '#444';
  knob.style.transform = value ? 'translateX(20px)' : 'translateX(0px)';
}

function getToggleValue(trackId) {
  const track = document.getElementById(trackId);
  if (!track) return false;
  return track.dataset.on === 'true';
}

// ─── LIVE SESSION ─────────────────────────────────────────────────────────────

function setupLiveModalListeners() {
  document.getElementById('go-live-btn').addEventListener('click', () => {
    document.getElementById('golive-modal').classList.add('visible');
    document.getElementById('golive-title-input').value = '';
    document.getElementById('golive-title-input').focus();
  });

  document.getElementById('golive-cancel-btn').addEventListener('click', () => {
    document.getElementById('golive-modal').classList.remove('visible');
  });

  document.getElementById('golive-start-btn').addEventListener('click', startLiveSession);

  document.getElementById('join-live-btn').addEventListener('click', () => {
    if (currentLiveSession) joinLiveSession(currentLiveSession, false);
  });

  document.getElementById('leave-live-btn').addEventListener('click', leaveLiveSession);
  document.getElementById('end-live-btn').addEventListener('click', endLiveSession);

  document.getElementById('golive-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('golive-modal')) {
      document.getElementById('golive-modal').classList.remove('visible');
    }
  });
}

async function startLiveSession() {
  if (!viewingProfile?.is_verified) {
    alert('You must be a verified user to go live.');
    return;
  }

  const title = document.getElementById('golive-title-input').value.trim();
  const btn = document.getElementById('golive-start-btn');
  btn.textContent = 'Starting...';
  btn.disabled = true;

  try {
    const { data: existing } = await window.db
      .from('live_sessions')
      .select('id')
      .eq('host_user_id', currentUser.id)
      .eq('is_active', true)
      .single();

    if (existing) {
      alert('You already have an active live session.');
      btn.textContent = 'Start Stream';
      btn.disabled = false;
      return;
    }

    const roomName = `voxxee-profile-${currentUser.id}-${Date.now()}`;
    const { data: { session } } = await window.db.auth.getSession();

    const response = await fetch('/.netlify/functions/create-room', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ room_name: roomName, title })
    });

    if (!response.ok) throw new Error('Failed to create room');
    const { room_url } = await response.json();

    const { data: liveSession, error } = await window.db
      .from('live_sessions')
      .insert({
        host_user_id: currentUser.id,
        community_id: null,
        room_name: roomName,
        room_url,
        title: title || null,
        is_active: true
      })
      .select()
      .single();

    if (error) throw error;

    currentLiveSession = liveSession;
    await notifyFollowersLive(liveSession, title);

    document.getElementById('golive-modal').classList.remove('visible');
    await joinLiveSession(liveSession, true);

  } catch (err) {
    console.error('Start live error:', err);
    alert('Could not start live session. Please try again.');
  }

  btn.textContent = 'Start Stream';
  btn.disabled = false;
}

async function joinLiveSession(session, isHost) {
  const modal = document.getElementById('live-modal');
  const container = document.getElementById('daily-frame-container');
  const endBtn = document.getElementById('end-live-btn');
  const titleEl = document.getElementById('live-modal-title-text');

  titleEl.textContent = session.title ? `Live: ${session.title}` : 'Live Stream';
  endBtn.style.display = isHost ? 'block' : 'none';

  modal.classList.add('visible');
  container.innerHTML = '';

  callFrame = window.DailyIframe.createFrame(container, {
    showLeaveButton: false,
    showFullscreenButton: true,
    iframeStyle: { width: '100%', height: '100%', border: 'none' }
  });

  await callFrame.join({ url: session.room_url });

  callFrame.on('left-meeting', () => {
    if (isHost) endLiveSession();
    else leaveLiveSession();
  });

  updateViewerCount(session.id);
  viewerCountInterval = setInterval(() => updateViewerCount(session.id), 10000);
}

async function updateViewerCount(sessionId) {
  try {
    if (!callFrame) return;
    const participants = callFrame.participants();
    const count = Object.keys(participants).length;
    document.getElementById('live-viewer-count').textContent = `${count} viewer${count !== 1 ? 's' : ''}`;
    await window.db.from('live_sessions').update({ viewer_count: count }).eq('id', sessionId);
  } catch (err) {
    console.error('Viewer count error:', err);
  }
}

async function leaveLiveSession() {
  if (callFrame) {
    await callFrame.leave();
    callFrame.destroy();
    callFrame = null;
  }
  if (viewerCountInterval) {
    clearInterval(viewerCountInterval);
    viewerCountInterval = null;
  }
  document.getElementById('live-modal').classList.remove('visible');
  document.getElementById('daily-frame-container').innerHTML = '';
}

async function endLiveSession() {
  if (!confirm('End your live stream?')) return;
  try {
    if (currentLiveSession) {
      await window.db.from('live_sessions')
        .update({ is_active: false, ended_at: new Date().toISOString() })
        .eq('id', currentLiveSession.id);
    }
  } catch (err) {
    console.error('End session error:', err);
  }
  await leaveLiveSession();
  currentLiveSession = null;
  hideLiveBanner();
}

async function notifyFollowersLive(session, title) {
  try {
    const { data: followers } = await window.db
      .from('follows')
      .select('follower_id')
      .eq('following_id', currentUser.id)
      .limit(100);

    if (!followers || followers.length === 0) return;

    const notifications = followers.map(f => ({
      user_id: f.follower_id,
      type: 'live_started',
      reference_id: session.id,
      reference_type: 'live_session',
      content: `${viewingProfile?.display_name || viewingProfile?.username || 'Someone'} is live${title ? ': ' + title : ''}`
    }));

    await window.db.from('notifications').insert(notifications);
  } catch (err) {
    console.error('Notify followers error:', err);
  }
}

async function checkActiveLiveSession(userId) {
  try {
    const { data: session } = await window.db
      .from('live_sessions')
      .select('*')
      .eq('host_user_id', userId)
      .eq('is_active', true)
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    if (session) {
      currentLiveSession = session;
      showLiveBanner(session);
    } else {
      hideLiveBanner();
    }
  } catch {
    hideLiveBanner();
  }
}

function showLiveBanner(session) {
  const banner = document.getElementById('live-banner');
  const hostName = viewingProfile?.display_name || viewingProfile?.username || 'Someone';
  document.getElementById('live-host-name').textContent = hostName;
  document.getElementById('live-session-title').textContent = session.title ? `— ${session.title}` : '';
  banner.classList.add('visible');
}

function hideLiveBanner() {
  document.getElementById('live-banner').classList.remove('visible');
}

function subscribeToLiveSessions(userId) {
  if (liveSessionSubscription) liveSessionSubscription.unsubscribe();
  liveSessionSubscription = window.db
    .channel(`live-sessions-profile-${userId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'live_sessions',
      filter: `host_user_id=eq.${userId}`
    }, async () => {
      await checkActiveLiveSession(userId);
    })
    .subscribe();
}

// ─── PROFILE LOAD ─────────────────────────────────────────────────────────────

async function loadOwnProfile() {
  const { data: profile } = await window.db
    .from('profiles').select('*').eq('user_id', currentUser.id).single();

  if (!profile) {
    document.getElementById('profile-header').innerHTML = '<div class="loading">Profile not found.</div>';
    return;
  }

  viewingProfile = profile;
  isOwnProfile = true;
  mutedKeywords = profile.muted_keywords || [];
  renderProfile(profile);
  setupAvatarUpload();
  setupBannerUpload();
  setupIntroVideoUpload();

  if (profile.is_verified) {
    document.getElementById('go-live-btn').style.display = 'block';
  }

  await checkActiveLiveSession(currentUser.id);
  subscribeToLiveSessions(currentUser.id);

  await Promise.all([
    loadProfilePosts(profile.user_id),
    loadProfileCommunities(),
    loadProfileAnalytics(profile.user_id)
  ]);
}

async function loadProfileByUsername(username) {
  const { data: profile } = await window.db
    .from('profiles').select('*').eq('username', username.toLowerCase()).single();

  if (!profile) {
    document.getElementById('profile-header').innerHTML = '<div class="loading">User not found.</div>';
    return;
  }

  viewingProfile = profile;
  isOwnProfile = profile.user_id === currentUser.id;
  mutedKeywords = profile.muted_keywords || [];

  if (!isOwnProfile) {
    const { data: followRow } = await window.db
      .from('follows').select('id')
      .eq('follower_id', currentUser.id).eq('following_id', profile.user_id).single();
    isFollowing = !!followRow;
  }

  renderProfile(profile);
  if (isOwnProfile) {
    setupAvatarUpload();
    setupBannerUpload();
    setupIntroVideoUpload();
  }

  if (isOwnProfile && profile.is_verified) {
    document.getElementById('go-live-btn').style.display = 'block';
  }

  await checkActiveLiveSession(profile.user_id);
  subscribeToLiveSessions(profile.user_id);

  await Promise.all([
    loadProfilePosts(profile.user_id),
    loadProfileCommunities(),
    isOwnProfile ? loadProfileAnalytics(profile.user_id) : Promise.resolve()
  ]);
}

async function loadProfileAnalytics(userId) {
  const analyticsEl = document.getElementById('profile-analytics');
  if (!analyticsEl) return;

  try {
    const { data: posts } = await window.db
      .from('posts').select('id').eq('user_id', userId).eq('is_removed', false);

    if (!posts || posts.length === 0) {
      analyticsEl.style.display = 'block';
      document.getElementById('analytics-views').textContent = '0';
      document.getElementById('analytics-reactions').textContent = '0';
      document.getElementById('analytics-comments').textContent = '0';
      document.getElementById('analytics-engagement').textContent = '0%';
      return;
    }

    const postIds = posts.map(p => p.id);

    const [viewsRes, reactionsRes, commentsRes] = await Promise.all([
      window.db.from('post_views').select('post_id', { count: 'exact', head: true }).in('post_id', postIds),
      window.db.from('reactions').select('id', { count: 'exact', head: true }).in('target_id', postIds).eq('target_type', 'post'),
      window.db.from('comments').select('id', { count: 'exact', head: true }).in('post_id', postIds).eq('is_removed', false)
    ]);

    const totalViews = viewsRes.count || 0;
    const totalReactions = reactionsRes.count || 0;
    const totalComments = commentsRes.count || 0;
    const engagementRate = totalViews > 0
      ? ((totalReactions + totalComments) / totalViews * 100).toFixed(1)
      : '0.0';

    analyticsEl.style.display = 'block';
    document.getElementById('analytics-views').textContent = totalViews.toLocaleString();
    document.getElementById('analytics-reactions').textContent = totalReactions.toLocaleString();
    document.getElementById('analytics-comments').textContent = totalComments.toLocaleString();
    document.getElementById('analytics-engagement').textContent = engagementRate + '%';

  } catch (err) {
    console.error('Analytics error:', err);
  }
}

function renderProfile(profile) {
  renderAvatarEl(profile.avatar_url, profile.username);
  renderBannerEl(profile.banner_url);
  renderIntroVideoEl(profile.intro_video_url);

  document.getElementById('profile-display-name').textContent = profile.display_name || profile.username;
  document.getElementById('profile-username').textContent = '@' + profile.username;
  document.getElementById('profile-post-count').textContent = (profile.post_count || 0).toLocaleString();
  document.getElementById('profile-follower-count').textContent = (profile.follower_count || 0).toLocaleString();
  document.getElementById('profile-following-count').textContent = (profile.following_count || 0).toLocaleString();

  if (profile.bio) document.getElementById('profile-bio').textContent = profile.bio;

  const metaEl = document.getElementById('profile-meta');
  if (metaEl) {
    const parts = [];
    if (profile.location) parts.push(`📍 ${escapeHtml(profile.location)}`);
    if (profile.website) parts.push(`🔗 <a href="${escapeHtml(profile.website)}" target="_blank" rel="noopener" style="color:var(--primary);text-decoration:none;">${escapeHtml(profile.website.replace(/^https?:\/\//, ''))}</a>`);
    metaEl.innerHTML = parts.join('<span style="margin:0 4px;">·</span>');
  }

  const badge = document.getElementById('verified-badge');
  if (badge && profile.is_verified) badge.style.display = 'inline';

  const repEl = document.getElementById('profile-reputation');
  if (repEl) {
    const rep = profile.reputation || 0;
    const label = getRepLabel(rep);
    const color = getRepColor(rep);
    repEl.innerHTML = `
      <span style="font-size:15px;font-weight:700;color:${color};">${rep.toLocaleString()}</span>
      <span style="font-size:13px;color:var(--text-muted);margin-left:6px;">${label}</span>
    `;
  }

  if (profile.is_adult_creator && !isOwnProfile) {
    const nameEl = document.getElementById('profile-display-name');
    if (nameEl && !document.querySelector('.adult-badge')) {
      const span = document.createElement('span');
      span.className = 'adult-badge';
      span.style.cssText = 'font-size:11px;padding:2px 8px;border-radius:100px;background:rgba(239,68,68,0.15);color:#ef4444;font-weight:600;margin-left:8px;';
      span.textContent = '🔞 Adult Creator';
      nameEl.after(span);
    }
  }

  if (isOwnProfile) {
    const editBtn = document.getElementById('edit-profile-btn');
    if (editBtn) {
      editBtn.style.display = 'block';
      editBtn.addEventListener('click', () => showEditForm(viewingProfile));
    }
  } else {
    const followBtn = document.getElementById('follow-btn');
    if (followBtn) {
      followBtn.style.display = 'block';
      followBtn.textContent = isFollowing ? 'Unfollow' : 'Follow';
      followBtn.className = isFollowing ? 'btn btn-ghost' : 'btn btn-primary';
      followBtn.addEventListener('click', handleFollowToggle);
    }
  }
}

async function handleFollowToggle() {
  const btn = document.getElementById('follow-btn');
  btn.disabled = true;
  try {
    if (isFollowing) {
      await window.db.from('follows').delete()
        .eq('follower_id', currentUser.id).eq('following_id', viewingProfile.user_id);
      await window.db.from('profiles')
        .update({ follower_count: Math.max((viewingProfile.follower_count || 1) - 1, 0) })
        .eq('user_id', viewingProfile.user_id);
      await window.db.from('profiles')
        .update({ following_count: Math.max((viewingProfile.following_count || 1) - 1, 0) })
        .eq('user_id', currentUser.id);
      isFollowing = false;
      viewingProfile.follower_count = Math.max((viewingProfile.follower_count || 1) - 1, 0);
    } else {
      await window.db.from('follows').insert({
        follower_id: currentUser.id, following_id: viewingProfile.user_id
      });
      await window.db.from('profiles')
        .update({ follower_count: (viewingProfile.follower_count || 0) + 1 })
        .eq('user_id', viewingProfile.user_id);
      await window.db.from('profiles')
        .update({ following_count: (viewingProfile.following_count || 0) + 1 })
        .eq('user_id', currentUser.id);
      isFollowing = true;
      viewingProfile.follower_count = (viewingProfile.follower_count || 0) + 1;
    }
    btn.textContent = isFollowing ? 'Unfollow' : 'Follow';
    btn.className = isFollowing ? 'btn btn-ghost' : 'btn btn-primary';
    document.getElementById('profile-follower-count').textContent = viewingProfile.follower_count.toLocaleString();
  } catch (err) {
    console.error('Follow error:', err);
  }
  btn.disabled = false;
}

function renderKeywordTags() {
  const container = document.getElementById('muted-keywords-list');
  if (!container) return;
  if (mutedKeywords.length === 0) {
    container.innerHTML = '<span style="font-size:13px;color:var(--text-muted);font-style:italic;">No muted keywords yet.</span>';
    return;
  }
  container.innerHTML = mutedKeywords.map((kw, idx) => `
    <span style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;background:rgba(244,63,94,0.1);border:1px solid rgba(244,63,94,0.3);border-radius:100px;font-size:13px;color:#f43f5e;font-weight:600;">
      ${escapeHtml(kw)}
      <button data-idx="${idx}" class="remove-keyword-btn" style="background:none;border:none;cursor:pointer;color:#f43f5e;font-size:14px;line-height:1;padding:0;opacity:0.7;">×</button>
    </span>
  `).join('');
  container.querySelectorAll('.remove-keyword-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      mutedKeywords.splice(parseInt(btn.dataset.idx), 1);
      renderKeywordTags();
    });
  });
}

function showEditForm(profile) {
  document.getElementById('edit-profile-form').style.display = 'block';
  document.getElementById('edit-display-name').value = profile.display_name || '';
  document.getElementById('edit-bio').value = profile.bio || '';
  document.getElementById('edit-location').value = profile.location || '';
  document.getElementById('edit-website').value = profile.website || '';
  mutedKeywords = [...(profile.muted_keywords || [])];
  renderKeywordTags();

  if (window.loadMutedCommunities) {
    window.loadMutedCommunities(profile.muted_communities || []);
  }

  setToggleState('toggle-show-adult', 'toggle-show-adult-knob', !!profile.show_adult_content);
  setToggleState('toggle-is-adult-creator', 'toggle-is-adult-creator-knob', !!profile.is_adult_creator);

  const addBtn = document.getElementById('add-keyword-btn');
  const keywordInput = document.getElementById('keyword-input');
  addBtn.onclick = () => addKeyword();
  keywordInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); addKeyword(); } };

  document.getElementById('save-profile-btn').onclick = saveProfile;
  document.getElementById('cancel-edit-btn').onclick = () => {
    document.getElementById('edit-profile-form').style.display = 'none';
  };
  document.getElementById('remove-avatar-btn').onclick = removeAvatar;
  document.getElementById('remove-banner-btn').onclick = removeBanner;
}

function addKeyword() {
  const input = document.getElementById('keyword-input');
  const kw = input.value.trim().toLowerCase();
  if (!kw) return;
  if (mutedKeywords.length >= 50) { alert('Maximum 50 muted keywords.'); return; }
  if (mutedKeywords.includes(kw)) { input.value = ''; return; }
  mutedKeywords.push(kw);
  input.value = '';
  renderKeywordTags();
}

async function saveProfile() {
  const displayName = document.getElementById('edit-display-name').value.trim();
  const bio = document.getElementById('edit-bio').value.trim();
  const location = document.getElementById('edit-location').value.trim();
  const website = document.getElementById('edit-website').value.trim();
  const showAdultContent = getToggleValue('toggle-show-adult');
  const isAdultCreator = getToggleValue('toggle-is-adult-creator');

  const mutedCommunityEls = document.querySelectorAll('#muted-communities-list .muted-community-item');
  const currentMutedCommunities = Array.from(mutedCommunityEls).map(el => el.id.replace('muted-c-', ''));

  const btn = document.getElementById('save-profile-btn');
  btn.textContent = 'Saving...';
  btn.disabled = true;

  try {
    const { error } = await window.db.from('profiles').update({
      display_name: displayName,
      bio,
      location,
      website,
      show_adult_content: showAdultContent,
      is_adult_creator: isAdultCreator,
      muted_keywords: mutedKeywords,
      muted_communities: currentMutedCommunities
    }).eq('user_id', currentUser.id);

    if (error) throw error;

    viewingProfile = {
      ...viewingProfile,
      display_name: displayName,
      bio,
      location,
      website,
      show_adult_content: showAdultContent,
      is_adult_creator: isAdultCreator,
      muted_keywords: mutedKeywords,
      muted_communities: currentMutedCommunities
    };

    document.getElementById('profile-display-name').textContent = displayName || viewingProfile.username;
    document.getElementById('profile-bio').textContent = bio;

    const metaEl = document.getElementById('profile-meta');
    if (metaEl) {
      const parts = [];
      if (location) parts.push(`📍 ${escapeHtml(location)}`);
      if (website) parts.push(`🔗 <a href="${escapeHtml(website)}" target="_blank" rel="noopener" style="color:var(--primary);text-decoration:none;">${escapeHtml(website.replace(/^https?:\/\//, ''))}</a>`);
      metaEl.innerHTML = parts.join('<span style="margin:0 4px;">·</span>');
    }

    document.getElementById('edit-profile-form').style.display = 'none';

  } catch (err) {
    console.error('Save profile error:', err);
    alert('Save failed. Please try again.');
  }

  btn.textContent = 'Save Profile';
  btn.disabled = false;
}

async function loadProfilePosts(userId) {
  const container = document.getElementById('profile-posts');
  const { data: posts } = await window.db
    .from('posts').select('*').eq('user_id', userId).eq('is_removed', false)
    .order('created_at', { ascending: false }).limit(20);

  if (!posts || posts.length === 0) {
    container.innerHTML = '<div class="loading">No posts yet.</div>';
    return;
  }

  const { data: profile } = await window.db
    .from('profiles').select('username, display_name, avatar_url, is_verified, verified_type, reputation')
    .eq('user_id', userId).single();

  const postIds = posts.map(p => p.id);

  const [reactionsRes, commentsRes] = await Promise.all([
    window.db.from('reactions').select('target_id, reaction_type').in('target_id', postIds).eq('target_type', 'post'),
    window.db.from('comments').select('post_id').in('post_id', postIds).eq('is_removed', false)
  ]);

  const reactionMap = {};
  if (reactionsRes.data) {
    reactionsRes.data.forEach(r => {
      if (!reactionMap[r.target_id]) reactionMap[r.target_id] = {};
      reactionMap[r.target_id][r.reaction_type] = (reactionMap[r.target_id][r.reaction_type] || 0) + 1;
    });
  }

  const commentCountMap = {};
  if (commentsRes.data) {
    commentsRes.data.forEach(c => { commentCountMap[c.post_id] = (commentCountMap[c.post_id] || 0) + 1; });
  }

  const username = profile?.username || 'unknown';
  const displayName = profile?.display_name || username;
  const avatarUrl = profile?.avatar_url || '';
  const initial = username.charAt(0).toUpperCase();

  const postAvatarHtml = avatarUrl
    ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(displayName)}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;flex-shrink:0;" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><div class="post-avatar" style="display:none;">${initial}</div>`
    : `<div class="post-avatar">${initial}</div>`;

  const verifiedBadge = profile?.is_verified ? (() => {
    const badges = { staff: '🟣', notable: '⭐', identity: '🔵' };
    return `<span style="font-size:14px;">${badges[profile.verified_type] || '🔵'}</span>`;
  })() : '';
  const repBadge = repBadgeHtml(profile?.reputation);

  container.innerHTML = posts.map(post => {
    const timestamp = new Date(post.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const postReactions = reactionMap[post.id] || {};
    const likes = postReactions.like || 0;
    const commentCount = commentCountMap[post.id] || 0;
    const adultBadge = post.is_adult
      ? `<span style="font-size:11px;padding:2px 8px;border-radius:100px;background:rgba(239,68,68,0.15);color:#ef4444;font-weight:600;margin-left:8px;">🔞</span>`
      : '';

    const mediaUrls = post.media_urls || [];
    let mediaHtml = '';
    if (mediaUrls.length > 0) {
      const grid = mediaUrls.length === 1 ? '1fr' : 'repeat(2,1fr)';
      mediaHtml = `<div style="display:grid;grid-template-columns:${grid};gap:6px;margin-top:10px;border-radius:10px;overflow:hidden;">
        ${mediaUrls.map(url => {
          const isVideo = url.match(/\.(mp4|mov|webm)(\?|$)/i);
          return isVideo
            ? `<video src="${url}" controls style="width:100%;max-height:300px;object-fit:cover;" playsinline></video>`
            : `<img src="${url}" style="width:100%;${mediaUrls.length===1?'max-height:300px;':'aspect-ratio:1;'}object-fit:cover;cursor:pointer;" onclick="window.open('${url}','_blank')" />`;
        }).join('')}
      </div>`;
    }

    const checkinHtml = post.checkin_location
      ? `<div style="font-size:13px;color:var(--text-muted);margin-top:6px;">📍 ${escapeHtml(post.checkin_location)}</div>`
      : '';

    return `
      <div class="post-card" data-post-id="${post.id}">
        <div class="post-header">
          <div style="display:flex;align-items:center;flex-shrink:0;">${postAvatarHtml}</div>
          <div class="post-meta">
            <div class="post-username">
              ${escapeHtml(displayName)}
              ${verifiedBadge}
              <span style="font-weight:400;color:var(--text-muted);font-size:13px;">@${escapeHtml(username)}</span>
              ${repBadge}
              ${adultBadge}
            </div>
            <span class="post-timestamp">${timestamp}</span>
          </div>
        </div>
        <div class="post-content">${escapeHtml(post.content || '')}</div>
        ${checkinHtml}
        ${mediaHtml}
        <div class="post-actions">
          <button class="post-action-btn">❤️ ${likes > 0 ? likes : ''}</button>
          <button class="post-action-btn comment-link-btn" data-post-id="${post.id}">
            💬 ${commentCount > 0 ? commentCount : ''} Comment${commentCount !== 1 ? 's' : ''}
          </button>
          <button class="post-action-btn share-link-btn" data-post-id="${post.id}">🔗 Share</button>
          ${isOwnProfile ? `<button class="post-action-btn delete-btn" data-post-id="${post.id}" style="margin-left:auto;color:var(--danger);">🗑️</button>` : ''}
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.comment-link-btn').forEach(btn => {
    btn.addEventListener('click', () => { window.location.href = `/comments.html?post=${btn.dataset.postId}`; });
  });
  container.querySelectorAll('.share-link-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const url = `${window.location.origin}/comments.html?post=${btn.dataset.postId}`;
      navigator.clipboard.writeText(url).then(() => {
        btn.textContent = '✅ Copied';
        setTimeout(() => { btn.textContent = '🔗 Share'; }, 2000);
      });
    });
  });
  container.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', () => deletePost(btn.dataset.postId));
  });
}

async function deletePost(postId) {
  if (!confirm('Delete this post?')) return;
  await window.db.from('posts').update({ is_removed: true }).eq('id', postId);
  await loadProfilePosts(currentUser.id);
}

async function loadProfileCommunities() {
  const container = document.getElementById('profile-communities');
  if (!container) return;
  const { data: communities } = await window.db
    .from('communities').select('name, slug, logo_url').eq('is_official', true).order('name').limit(8);
  if (!communities) return;
  container.innerHTML = communities.map(c => {
    const logoHtml = c.logo_url
      ? `<img src="${c.logo_url}" alt="${escapeHtml(c.name)}" style="width:24px;height:24px;border-radius:4px;object-fit:cover;flex-shrink:0;" onerror="this.style.display='none'" />`
      : `<div style="width:24px;height:24px;border-radius:4px;background:var(--primary-dim);color:var(--primary);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;">${c.name.charAt(0)}</div>`;
    return `
      <a href="/community.html?slug=${c.slug}" style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:8px;margin-bottom:6px;background:var(--bg-card);border:1px solid var(--border);color:var(--text);font-size:14px;text-decoration:none;">
        ${logoHtml}
        <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(c.name)}</span>
      </a>
    `;
  }).join('');
}

function getRepLabel(rep) {
  if (rep >= 1000) return '👑 Legend';
  if (rep >= 500) return '🔥 Veteran';
  if (rep >= 200) return '⭐ Contributor';
  if (rep >= 50) return '💬 Regular';
  return '🌱 Seedling';
}

function getRepColor(rep) {
  if (rep >= 1000) return '#f59e0b';
  if (rep >= 500) return '#ef4444';
  if (rep >= 200) return '#8b5cf6';
  if (rep >= 50) return 'var(--primary)';
  return 'var(--text-muted)';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}
