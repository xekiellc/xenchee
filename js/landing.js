// Landing page — loads communities and ecosystem cards from Supabase

document.addEventListener('DOMContentLoaded', async () => {
  await Promise.all([
    loadCommunities(),
    loadEcosystemCards()
  ]);

  // Check if user is already logged in
  const user = await auth.getUser();
  if (user) {
    window.location.href = '/feed.html';
  }
});

async function loadCommunities() {
  const grid = document.getElementById('communities-grid');
  if (!grid) return;

  grid.innerHTML = '<div class="loading"><div class="spinner"></div>Loading communities...</div>';

  try {
    const { data: communities, error } = await db
      .from('communities')
      .select('*')
      .eq('community_type', 'portfolio')
      .order('name');

    if (error) throw error;

    if (!communities || communities.length === 0) {
      grid.innerHTML = '<p class="loading">No communities yet.</p>';
      return;
    }

    grid.innerHTML = communities.map(community => `
      <a href="/community.html?slug=${community.slug}" class="community-card">
        <div class="community-card-header">
          <div class="community-avatar">
            ${community.name.charAt(0)}
          </div>
          <div>
            <div class="community-name">${community.name}</div>
            <div class="community-type">Community</div>
          </div>
        </div>
        <div class="community-description">
          ${community.description || ''}
        </div>
        <div class="community-footer">
          <span class="community-members">
            ${community.member_count > 0 ? community.member_count.toLocaleString() + ' members' : 'Be the first to join'}
          </span>
          ${community.is_official ? '<span class="community-badge badge-official">Official</span>' : ''}
        </div>
      </a>
    `).join('');

  } catch (err) {
    console.error('Error loading communities:', err);
    grid.innerHTML = '<p class="loading">Could not load communities.</p>';
  }
}

async function loadEcosystemCards() {
  const grid = document.getElementById('ecosystem-grid');
  if (!grid) return;

  grid.innerHTML = '<div class="loading"><div class="spinner"></div>Loading ecosystem...</div>';

  try {
    const { data: cards, error } = await db
      .from('ecosystem_cards')
      .select('*')
      .order('display_order');

    if (error) throw error;

    if (!cards || cards.length === 0) {
      grid.innerHTML = '<p class="loading">Nothing here yet.</p>';
      return;
    }

    grid.innerHTML = cards.map(card => `
      <div class="ecosystem-card">
        <div class="ecosystem-card-header">
          <div class="ecosystem-name">${card.name}</div>
          <span class="ecosystem-status ${card.status === 'live' ? 'status-live' : 'status-coming-soon'}">
            ${card.status === 'live' ? 'Live' : 'Coming Soon'}
          </span>
        </div>
        <div class="ecosystem-tagline">${card.tagline || ''}</div>
        <div class="ecosystem-description">${card.description || ''}</div>
        ${card.external_url && card.status === 'live' ? `
          <a href="${card.external_url}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost" style="margin-top:16px;font-size:13px;">
            Visit Site →
          </a>
        ` : ''}
      </div>
    `).join('');

  } catch (err) {
    console.error('Error loading ecosystem:', err);
    grid.innerHTML = '<p class="loading">Could not load ecosystem.</p>';
  }
}
