async function waitForDb(timeout = 5000) {
  const start = Date.now();
  while (!window.db) {
    if (Date.now() - start > timeout) throw new Error('Supabase init timeout');
    await new Promise(r => setTimeout(r, 50));
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await waitForDb();
    await Promise.all([
      loadCommunities(),
      loadEcosystemCards()
    ]);

    const user = await window.auth.getUser();
    if (user) {
      window.location.href = '/feed.html';
    }
  } catch (err) {
    console.error('Landing init error:', err);
  }
});

function communityLogoHtml(community) {
  if (community.logo_url) {
    return `
      <img src="${community.logo_url}" alt="${community.name}"
        style="width:48px;height:48px;border-radius:10px;object-fit:cover;flex-shrink:0;"
        onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
      <div style="display:none;width:48px;height:48px;border-radius:10px;background:var(--primary-dim);color:var(--primary);align-items:center;justify-content:center;font-size:20px;font-weight:800;flex-shrink:0;">
        ${community.name.charAt(0)}
      </div>`;
  }
  return `<div style="width:48px;height:48px;border-radius:10px;background:var(--primary-dim);color:var(--primary);display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800;flex-shrink:0;">${community.name.charAt(0)}</div>`;
}

async function loadCommunities() {
  const grid = document.getElementById('communities-grid');
  if (!grid) return;

  grid.innerHTML = '<div class="loading"><div class="spinner"></div>Loading communities...</div>';

  try {
    const { data: communities, error } = await window.db
      .from('communities')
      .select('*')
      .eq('is_official', true)
      .order('name');

    if (error) throw error;

    if (!communities || communities.length === 0) {
      grid.innerHTML = '<p class="loading">No communities yet.</p>';
      return;
    }

    grid.innerHTML = communities.map(community => `
      <a href="/community.html?slug=${community.slug}" class="community-card">
        <div class="community-card-header">
          ${communityLogoHtml(community)}
          <div>
            <div class="community-name">${community.name}</div>
            <div class="community-type">v/${community.slug}</div>
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
    const { data: cards, error } = await window.db
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
        <div class="ecosystem-card-header" style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
          ${card.logo_url ? `
            <img src="${card.logo_url}" alt="${card.name}"
              style="width:40px;height:40px;border-radius:8px;object-fit:cover;flex-shrink:0;"
              onerror="this.style.display='none'" />
          ` : ''}
          <div style="flex:1;display:flex;align-items:center;justify-content:space-between;">
            <div class="ecosystem-name">${card.name}</div>
            <span class="ecosystem-status ${card.status === 'live' ? 'status-live' : 'status-coming-soon'}">
              ${card.status === 'live' ? 'Live' : 'Coming Soon'}
            </span>
          </div>
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
