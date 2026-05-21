const REPUTATION_POINTS = {
  post_created: 2,
  comment_created: 1,
  reaction_received: 1,
  downvote_received: -1,
  post_removed: -3,
  joined_community: 1
};

const REPUTATION_RANKS = [
  { min: 1000, label: '👑 Legend' },
  { min: 500,  label: '🔥 Veteran' },
  { min: 200,  label: '⭐ Contributor' },
  { min: 50,   label: '💬 Regular' },
  { min: 0,    label: '🌱 Seedling' }
];

function getRepLabel(score) {
  if (!score || score <= 0) return '🌱 Seedling';
  const rank = REPUTATION_RANKS.find(r => score >= r.min);
  return rank ? rank.label : '🌱 Seedling';
}

function getRepColor(score) {
  if (score >= 1000) return '#f5a623';
  if (score >= 500)  return '#ef4444';
  if (score >= 200)  return '#6366f1';
  if (score >= 50)   return '#4caf7d';
  return 'var(--text-muted)';
}

async function awardReputation(userId, eventType, targetId = null, targetType = null, sourceUserId = null) {
  if (!userId || !eventType) return;
  if (!window.db) return;

  const points = REPUTATION_POINTS[eventType];
  if (points === undefined) return;

  try {
    // Insert reputation event
    await window.db.from('reputation_events').insert({
      user_id: userId,
      source_user_id: sourceUserId,
      event_type: eventType,
      points,
      target_id: targetId,
      target_type: targetType
    });

    // Update profile reputation total
    const { data: profile } = await window.db
      .from('profiles').select('reputation').eq('user_id', userId).single();

    const current = profile?.reputation || 0;
    const newTotal = Math.max(0, current + points);

    await window.db.from('profiles')
      .update({ reputation: newTotal }).eq('user_id', userId);

  } catch (err) {
    // Reputation errors are non-critical — fail silently
    console.warn('Reputation award failed (non-critical):', err);
  }
}

// Render a small inline reputation badge
function repBadgeHtml(reputation) {
  if (!reputation || reputation <= 0) return '';
  const color = getRepColor(reputation);
  return `<span style="font-size:11px;color:${color};font-weight:600;margin-left:4px;" title="${getRepLabel(reputation)}">${reputation}</span>`;
}
