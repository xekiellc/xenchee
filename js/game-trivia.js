async function waitForDb(timeout = 5000) {
  const start = Date.now();
  while (!window.db) {
    if (Date.now() - start > timeout) throw new Error('Supabase init timeout');
    await new Promise(r => setTimeout(r, 50));
  }
}

let currentUser = null;
let currentProfile = null;
let questions = [];
let currentQuestion = 0;
let score = 0;
let answered = false;
let gameStartTime = null;
let today = new Date().toISOString().split('T')[0];

// Fallback questions if API is down
const FALLBACK_QUESTIONS = [
  { question: "What is the capital of France?", correct: "Paris", options: ["Paris", "London", "Berlin", "Madrid"], category: "Geography", difficulty: "easy" },
  { question: "Which planet is closest to the Sun?", correct: "Mercury", options: ["Mercury", "Venus", "Earth", "Mars"], category: "Science", difficulty: "easy" },
  { question: "Who painted the Mona Lisa?", correct: "Leonardo da Vinci", options: ["Leonardo da Vinci", "Michelangelo", "Raphael", "Donatello"], category: "Art", difficulty: "easy" },
  { question: "What year did World War II end?", correct: "1945", options: ["1945", "1944", "1943", "1946"], category: "History", difficulty: "medium" },
  { question: "What is the chemical symbol for gold?", correct: "Au", options: ["Au", "Ag", "Fe", "Cu"], category: "Science", difficulty: "medium" },
  { question: "How many bones are in the adult human body?", correct: "206", options: ["206", "208", "212", "195"], category: "Science", difficulty: "medium" },
  { question: "What is the largest ocean on Earth?", correct: "Pacific Ocean", options: ["Pacific Ocean", "Atlantic Ocean", "Indian Ocean", "Arctic Ocean"], category: "Geography", difficulty: "easy" },
  { question: "Who wrote 'Romeo and Juliet'?", correct: "William Shakespeare", options: ["William Shakespeare", "Charles Dickens", "Jane Austen", "Mark Twain"], category: "Literature", difficulty: "easy" },
  { question: "What is the speed of light in a vacuum (approximately)?", correct: "299,792 km/s", options: ["299,792 km/s", "150,000 km/s", "399,792 km/s", "199,792 km/s"], category: "Science", difficulty: "hard" },
  { question: "Which country has the most natural lakes?", correct: "Canada", options: ["Canada", "Russia", "USA", "Finland"], category: "Geography", difficulty: "hard" }
];

document.addEventListener('DOMContentLoaded', async () => {
  await waitForDb();

  currentUser = await window.auth.getUser();
  if (!currentUser) {
    window.location.href = '/login.html';
    return;
  }

  const { data: profile } = await window.db
    .from('profiles').select('*').eq('user_id', currentUser.id).single();
  currentProfile = profile;

  document.getElementById('logout-btn').addEventListener('click', async () => {
    await window.auth.signOut();
    window.location.href = '/';
  });

  await loadLeaderboard();

  const { data: existing } = await window.db
    .from('trivia_scores').select('*')
    .eq('user_id', currentUser.id).eq('played_at', today).single();

  if (existing) {
    await showAlreadyPlayed(existing);
  } else {
    await startGame();
  }
});

async function fetchTriviaQuestions() {
  // Try opentdb with up to 2 attempts (handles rate limit code 5)
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      if (attempt > 1) await new Promise(r => setTimeout(r, 2000));
      const res = await fetch('https://opentdb.com/api.php?amount=10&type=multiple&encode=url3986');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // response_code 5 = rate limited, 0 = success
      if (data.response_code === 5) {
        console.warn(`opentdb rate limited (attempt ${attempt})`);
        continue;
      }
      if (data.response_code !== 0 || !data.results?.length) throw new Error('Bad response');
      return data.results.map(q => ({
        question: decodeURIComponent(q.question),
        correct: decodeURIComponent(q.correct_answer),
        options: shuffle([
          decodeURIComponent(q.correct_answer),
          ...q.incorrect_answers.map(a => decodeURIComponent(a))
        ]),
        category: decodeURIComponent(q.category),
        difficulty: q.difficulty
      }));
    } catch (err) {
      console.warn(`Trivia API attempt ${attempt} failed:`, err);
    }
  }
  // Fallback to local questions
  console.warn('Using fallback questions');
  return shuffle([...FALLBACK_QUESTIONS]).slice(0, 10).map(q => ({
    ...q,
    options: shuffle([...q.options])
  }));
}

async function startGame() {
  const gameArea = document.getElementById('game-area');
  gameArea.innerHTML = '<div class="loading"><div class="spinner"></div>Loading questions...</div>';

  questions = await fetchTriviaQuestions();

  if (!questions || questions.length === 0) {
    gameArea.innerHTML = `
      <div class="post-card" style="text-align:center;padding:40px;">
        <div style="font-size:32px;margin-bottom:12px;">😵</div>
        <div style="font-size:16px;font-weight:700;color:var(--text);margin-bottom:8px;">Could not load questions</div>
        <div style="font-size:13px;color:var(--text-muted);margin-bottom:16px;">Check your connection and try again.</div>
        <button class="btn btn-primary" onclick="startGame()">Try Again</button>
      </div>`;
    return;
  }

  currentQuestion = 0;
  score = 0;
  gameStartTime = Date.now();

  // GA4: game started
  gtag('event', 'trivia_start', { event_category: 'games', event_label: 'daily_trivia' });

  renderQuestion();
}

function renderQuestion() {
  const q = questions[currentQuestion];
  const progress = (currentQuestion / questions.length) * 100;
  const diffColor = q.difficulty === 'easy' ? '#4caf7d' : q.difficulty === 'medium' ? '#f5a623' : '#ef4444';

  document.getElementById('game-area').innerHTML = `
    <div style="margin-bottom:20px;">
      <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--text-muted);margin-bottom:6px;">
        <span>Question ${currentQuestion + 1} of ${questions.length}</span>
        <span>Score: ${score}</span>
      </div>
      <div style="height:6px;background:var(--border);border-radius:100px;overflow:hidden;">
        <div style="height:100%;width:${progress}%;background:var(--primary);border-radius:100px;transition:width 0.3s ease;"></div>
      </div>
    </div>

    <div class="post-card" style="margin-bottom:16px;">
      <div style="display:flex;gap:8px;margin-bottom:12px;">
        <span style="font-size:11px;padding:3px 10px;border-radius:100px;background:rgba(99,102,241,0.15);color:var(--primary);font-weight:600;">${q.category}</span>
        <span style="font-size:11px;padding:3px 10px;border-radius:100px;background:rgba(76,175,125,0.1);color:${diffColor};font-weight:600;text-transform:capitalize;">${q.difficulty}</span>
      </div>
      <div style="font-size:17px;font-weight:600;color:var(--text);line-height:1.5;">${q.question}</div>
    </div>

    <div id="options-container" style="display:flex;flex-direction:column;gap:10px;">
      ${q.options.map((opt, idx) => `
        <button class="option-btn" data-index="${idx}" data-answer="${escapeAttr(opt)}"
          style="text-align:left;padding:14px 18px;background:var(--bg-card);border:2px solid var(--border);border-radius:12px;cursor:pointer;font-size:15px;color:var(--text);transition:all 0.15s ease;width:100%;"
          onmouseover="if(!this.dataset.locked)this.style.borderColor='var(--primary)'"
          onmouseout="if(!this.dataset.locked)this.style.borderColor='var(--border)'">
          <span style="font-weight:700;color:var(--text-muted);margin-right:10px;">${String.fromCharCode(65 + idx)}</span>
          ${escapeHtml(opt)}
        </button>
      `).join('')}
    </div>
    <div id="feedback" style="margin-top:16px;"></div>
  `;

  document.querySelectorAll('.option-btn').forEach(btn => {
    btn.addEventListener('click', () => handleAnswer(btn));
  });
}

function handleAnswer(btn) {
  if (answered) return;
  answered = true;

  const selected = btn.dataset.answer;
  const correct = questions[currentQuestion].correct;
  const isCorrect = selected === correct;
  if (isCorrect) score++;

  // GA4: answer submitted
  gtag('event', 'trivia_answer', {
    event_category: 'games',
    event_label: isCorrect ? 'correct' : 'incorrect',
    value: currentQuestion + 1
  });

  document.querySelectorAll('.option-btn').forEach(b => {
    b.dataset.locked = 'true';
    b.style.cursor = 'default';
    const ans = b.dataset.answer;
    if (ans === correct) {
      b.style.borderColor = '#4caf7d';
      b.style.background = 'rgba(76,175,125,0.15)';
      b.style.color = '#4caf7d';
    } else if (b === btn && !isCorrect) {
      b.style.borderColor = '#ef4444';
      b.style.background = 'rgba(239,68,68,0.15)';
      b.style.color = '#ef4444';
    }
  });

  document.getElementById('feedback').innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;border-radius:10px;background:${isCorrect ? 'rgba(76,175,125,0.15)' : 'rgba(239,68,68,0.15)'};">
      <span style="font-size:20px;">${isCorrect ? '✅' : '❌'}</span>
      <div>
        <div style="font-size:14px;font-weight:700;color:${isCorrect ? '#4caf7d' : '#ef4444'};">${isCorrect ? 'Correct!' : 'Wrong!'}</div>
        ${!isCorrect ? `<div style="font-size:13px;color:var(--text-muted);">The answer was: <strong style="color:var(--text);">${escapeHtml(correct)}</strong></div>` : ''}
      </div>
      <button class="btn btn-primary" style="margin-left:auto;font-size:13px;" onclick="nextQuestion()">
        ${currentQuestion + 1 < questions.length ? 'Next →' : 'See Results'}
      </button>
    </div>`;

  answered = false;
}

async function nextQuestion() {
  currentQuestion++;
  if (currentQuestion < questions.length) {
    renderQuestion();
  } else {
    await finishGame();
  }
}

async function finishGame() {
  const gameArea = document.getElementById('game-area');
  gameArea.innerHTML = '<div class="loading"><div class="spinner"></div>Saving your score...</div>';

  const timeSpentSeconds = gameStartTime ? Math.round((Date.now() - gameStartTime) / 1000) : 0;

  // GA4: game completed
  gtag('event', 'trivia_complete', {
    event_category: 'games',
    event_label: 'daily_trivia',
    value: score,
    time_spent_seconds: timeSpentSeconds
  });

  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const { data: yesterdayScore } = await window.db
      .from('trivia_scores').select('streak')
      .eq('user_id', currentUser.id).eq('played_at', yesterdayStr).single();

    const streak = yesterdayScore ? (yesterdayScore.streak || 1) + 1 : 1;

    await window.db.from('trivia_scores').insert({
      user_id: currentUser.id, score, total: questions.length, played_at: today, streak
    });

    const { data: allScores } = await window.db
      .from('trivia_scores').select('score, user_id').eq('played_at', today)
      .order('score', { ascending: false });

    const totalPlayers = allScores ? allScores.length : 1;
    const rank = allScores ? allScores.findIndex(s => s.user_id === currentUser.id) + 1 : 1;
    const percentile = Math.round(((totalPlayers - rank) / totalPlayers) * 100);
    const pct = Math.round((score / questions.length) * 100);
    const emoji = pct === 100 ? '🏆' : pct >= 80 ? '🎉' : pct >= 60 ? '👍' : pct >= 40 ? '😅' : '😬';

    gameArea.innerHTML = `
      <div class="post-card" style="text-align:center;padding:32px 24px;">
        <div style="font-size:56px;margin-bottom:16px;">${emoji}</div>
        <div style="font-size:28px;font-weight:800;color:var(--text);margin-bottom:4px;">${score} / ${questions.length}</div>
        <div style="font-size:15px;color:var(--text-muted);margin-bottom:24px;">${pct}% correct</div>
        <div style="display:flex;justify-content:center;gap:24px;margin-bottom:24px;flex-wrap:wrap;">
          <div style="text-align:center;">
            <div style="font-size:24px;font-weight:800;color:var(--primary);">#${rank}</div>
            <div style="font-size:12px;color:var(--text-muted);">Rank Today</div>
          </div>
          <div style="text-align:center;">
            <div style="font-size:24px;font-weight:800;color:var(--primary);">${totalPlayers}</div>
            <div style="font-size:12px;color:var(--text-muted);">Players Today</div>
          </div>
          <div style="text-align:center;">
            <div style="font-size:24px;font-weight:800;color:var(--primary);">${percentile}th</div>
            <div style="font-size:12px;color:var(--text-muted);">Percentile</div>
          </div>
          <div style="text-align:center;">
            <div style="font-size:24px;font-weight:800;color:#f5a623;">🔥 ${streak}</div>
            <div style="font-size:12px;color:var(--text-muted);">Day Streak</div>
          </div>
        </div>
        <button class="btn btn-primary" style="width:100%;justify-content:center;margin-bottom:12px;"
          onclick="shareScore(${score}, ${questions.length}, ${rank}, ${percentile}, ${streak})">
          📣 Share My Score
        </button>
        <a href="/games.html" class="btn btn-ghost" style="width:100%;justify-content:center;text-decoration:none;">← Back to Games</a>
      </div>
      <div class="post-card" style="margin-top:20px;">
        <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:16px;">🏆 Today's Full Leaderboard</div>
        <div id="full-leaderboard"></div>
      </div>`;

    await loadLeaderboard();
    await loadFullLeaderboard(allScores);

  } catch (err) {
    console.error('Save score error:', err);
    gameArea.innerHTML = `
      <div class="post-card" style="text-align:center;padding:32px;">
        <div style="font-size:32px;margin-bottom:12px;">⚠️</div>
        <div style="font-size:16px;font-weight:700;color:var(--text);">Score could not be saved</div>
        <div style="font-size:13px;color:var(--text-muted);margin-top:8px;">Your score was ${score}/${questions.length}</div>
      </div>`;
  }
}

async function loadFullLeaderboard(allScores) {
  const container = document.getElementById('full-leaderboard');
  if (!container || !allScores) return;

  const userIds = allScores.map(s => s.user_id);
  const { data: profiles } = await window.db
    .from('profiles').select('user_id, username, display_name').in('user_id', userIds);

  const profileMap = {};
  if (profiles) profiles.forEach(p => { profileMap[p.user_id] = p; });

  const totalPlayers = allScores.length;

  container.innerHTML = allScores.map((s, i) => {
    const profile = profileMap[s.user_id];
    const username = profile?.username || 'unknown';
    const displayName = profile?.display_name || username;
    const rank = i + 1;
    const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
    const percentile = Math.round(((totalPlayers - rank) / totalPlayers) * 100);
    const isMe = s.user_id === currentUser?.id;

    return `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);${isMe ? 'background:rgba(99,102,241,0.08);border-radius:8px;padding:10px 8px;' : ''}">
        <div style="font-size:16px;width:32px;text-align:center;flex-shrink:0;">${medal}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:14px;font-weight:${isMe ? '700' : '600'};color:${isMe ? 'var(--primary)' : 'var(--text)'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            ${escapeHtml(displayName)}${isMe ? ' (you)' : ''}
          </div>
          <div style="font-size:11px;color:var(--text-muted);">${percentile}th percentile</div>
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div style="font-size:15px;font-weight:700;color:var(--primary);">${s.score}/10</div>
          <div style="font-size:11px;color:var(--text-muted);">${Math.round((s.score/10)*100)}%</div>
        </div>
      </div>`;
  }).join('');
}

async function showAlreadyPlayed(existing) {
  const { data: allScores } = await window.db
    .from('trivia_scores').select('score, user_id').eq('played_at', today)
    .order('score', { ascending: false });

  const totalPlayers = allScores ? allScores.length : 1;
  const rank = allScores ? allScores.findIndex(s => s.user_id === currentUser.id) + 1 : 1;
  const percentile = Math.round(((totalPlayers - rank) / totalPlayers) * 100);
  const pct = Math.round((existing.score / existing.total) * 100);
  const emoji = pct === 100 ? '🏆' : pct >= 80 ? '🎉' : pct >= 60 ? '👍' : pct >= 40 ? '😅' : '😬';

  document.getElementById('game-area').innerHTML = `
    <div class="post-card" style="text-align:center;padding:32px 24px;">
      <div style="font-size:40px;margin-bottom:12px;">${emoji}</div>
      <div style="font-size:20px;font-weight:800;color:var(--text);margin-bottom:4px;">You already played today!</div>
      <div style="font-size:14px;color:var(--text-muted);margin-bottom:24px;">Come back tomorrow for a new set of questions.</div>
      <div style="font-size:32px;font-weight:800;color:var(--primary);margin-bottom:4px;">${existing.score} / ${existing.total}</div>
      <div style="font-size:14px;color:var(--text-muted);margin-bottom:24px;">${pct}% correct</div>
      <div style="display:flex;justify-content:center;gap:24px;margin-bottom:24px;flex-wrap:wrap;">
        <div style="text-align:center;">
          <div style="font-size:24px;font-weight:800;color:var(--primary);">#${rank}</div>
          <div style="font-size:12px;color:var(--text-muted);">Rank Today</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:24px;font-weight:800;color:var(--primary);">${totalPlayers}</div>
          <div style="font-size:12px;color:var(--text-muted);">Players Today</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:24px;font-weight:800;color:var(--primary);">${percentile}th</div>
          <div style="font-size:12px;color:var(--text-muted);">Percentile</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:24px;font-weight:800;color:#f5a623;">🔥 ${existing.streak || 1}</div>
          <div style="font-size:12px;color:var(--text-muted);">Day Streak</div>
        </div>
      </div>
      <button class="btn btn-primary" style="width:100%;justify-content:center;margin-bottom:12px;"
        onclick="shareScore(${existing.score}, ${existing.total}, ${rank}, ${percentile}, ${existing.streak || 1})">
        📣 Share My Score
      </button>
      <a href="/games.html" class="btn btn-ghost" style="width:100%;justify-content:center;text-decoration:none;">← Back to Games</a>
    </div>
    <div class="post-card" style="margin-top:20px;">
      <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:16px;">🏆 Today's Full Leaderboard</div>
      <div id="full-leaderboard"></div>
    </div>`;

  await loadLeaderboard();
  if (allScores) await loadFullLeaderboard(allScores);
}

async function loadLeaderboard() {
  const container = document.getElementById('leaderboard-container');
  if (!container) return;

  try {
    const { data: scores } = await window.db
      .from('trivia_scores').select('user_id, score, total, streak')
      .eq('played_at', today).order('score', { ascending: false }).limit(10);

    if (!scores || scores.length === 0) {
      container.innerHTML = '<div style="font-size:13px;color:var(--text-muted);">No scores yet — be the first!</div>';
      return;
    }

    const userIds = scores.map(s => s.user_id);
    const { data: profiles } = await window.db
      .from('profiles').select('user_id, username, display_name').in('user_id', userIds);

    const profileMap = {};
    if (profiles) profiles.forEach(p => { profileMap[p.user_id] = p; });

    const totalPlayers = scores.length;

    container.innerHTML = scores.map((s, i) => {
      const profile = profileMap[s.user_id];
      const username = profile?.username || 'unknown';
      const displayName = profile?.display_name || username;
      const rank = i + 1;
      const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
      const isMe = s.user_id === currentUser?.id;
      const percentile = Math.round(((totalPlayers - rank) / totalPlayers) * 100);

      return `
        <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);">
          <div style="font-size:14px;width:24px;text-align:center;flex-shrink:0;">${medal}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:600;color:${isMe ? 'var(--primary)' : 'var(--text)'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(displayName)}${isMe ? ' ★' : ''}</div>
            <div style="font-size:10px;color:var(--text-muted);">${percentile}th pct</div>
          </div>
          <div style="font-size:13px;font-weight:700;color:var(--primary);flex-shrink:0;">${s.score}/10</div>
        </div>`;
    }).join('');

  } catch (err) {
    console.error('Leaderboard error:', err);
  }
}

async function shareScore(score, total, rank, percentile, streak) {
  const pct = Math.round((score / total) * 100);
  const emoji = pct === 100 ? '🏆' : pct >= 80 ? '🎉' : pct >= 60 ? '👍' : '😅';
  const text = `${emoji} I scored ${score}/${total} on today's Voxxee Daily Trivia!\n🏅 Rank #${rank} · ${percentile}th percentile · 🔥 ${streak} day streak\n\nCan you beat me? voxxee.com/game-trivia.html`;

  // GA4: score shared
  gtag('event', 'trivia_share', { event_category: 'games', event_label: 'daily_trivia', value: score });

  try {
    await navigator.clipboard.writeText(text);
    alert('Score copied to clipboard — paste it in your feed!');
  } catch {
    alert(text);
  }
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}

function escapeAttr(text) {
  return String(text).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
