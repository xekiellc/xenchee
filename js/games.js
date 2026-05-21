async function waitForDb(timeout = 5000) {
  const start = Date.now();
  while (!window.db) {
    if (Date.now() - start > timeout) throw new Error('Supabase init timeout');
    await new Promise(r => setTimeout(r, 50));
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await waitForDb();

  const user = await window.auth.getUser();
  if (!user) {
    window.location.href = '/login.html';
    return;
  }

  document.getElementById('logout-btn').addEventListener('click', async () => {
    await window.auth.signOut();
    window.location.href = '/';
  });

  await loadTriviaLeaderboardSidebar();
});

async function loadTriviaLeaderboardSidebar() {
  const container = document.getElementById('trivia-leaderboard-sidebar');
  if (!container) return;

  try {
    const today = new Date().toISOString().split('T')[0];

    const { data: scores, error } = await window.db
      .from('trivia_scores')
      .select('user_id, score, total')
      .eq('played_at', today)
      .order('score', { ascending: false })
      .limit(10);

    if (error) throw error;

    if (!scores || scores.length === 0) {
      container.innerHTML = '<div style="font-size:13px;color:var(--text-muted);">No scores yet today. Be the first to play!</div>';
      return;
    }

    const userIds = scores.map(s => s.user_id);
    const { data: profiles } = await window.db
      .from('profiles')
      .select('user_id, username, display_name')
      .in('user_id', userIds);

    const profileMap = {};
    if (profiles) profiles.forEach(p => { profileMap[p.user_id] = p; });

    container.innerHTML = scores.map((s, i) => {
      const profile = profileMap[s.user_id];
      const username = profile?.username || 'unknown';
      const displayName = profile?.display_name || username;
      const rank = i + 1;
      const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;

      return `
        <a href="/profile.html?user=${encodeURIComponent(username)}" style="display:flex;align-items:center;gap:8px;padding:8px 0;text-decoration:none;border-bottom:1px solid var(--border);">
          <div style="font-size:16px;width:28px;text-align:center;flex-shrink:0;">${medal}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(displayName)}</div>
            <div style="font-size:11px;color:var(--text-muted);">@${escapeHtml(username)}</div>
          </div>
          <div style="font-size:14px;font-weight:700;color:var(--primary);flex-shrink:0;">${s.score}/${s.total}</div>
        </a>
      `;
    }).join('');

  } catch (err) {
    console.error('Leaderboard error:', err);
    container.innerHTML = '<div style="font-size:13px;color:var(--text-muted);">Could not load leaderboard.</div>';
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}
