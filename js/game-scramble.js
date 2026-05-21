async function waitForDb(timeout = 5000) {
  const start = Date.now();
  while (!window.db) {
    if (Date.now() - start > timeout) throw new Error('Supabase init timeout');
    await new Promise(r => setTimeout(r, 50));
  }
}

let currentUser = null;
let currentProfile = null;
let todayWord = null;
let scrambledWord = null;
let attempts = 0;
let hintUsed = false;
const today = new Date().toISOString().split('T')[0];

// Word list with hints — seeded by day of year so everyone gets same word
const WORDS = [
  { word: 'FREEDOM', hint: 'The right to act without restriction' },
  { word: 'JUSTICE', hint: 'Fair treatment under the law' },
  { word: 'LIBERTY', hint: 'Freedom from oppressive restrictions' },
  { word: 'NETWORK', hint: 'A system of connected things or people' },
  { word: 'PROFILE', hint: 'A personal page describing someone' },
  { word: 'COMMENT', hint: 'A response or remark on a post' },
  { word: 'VOXXEE', hint: 'Say exactly what you mean' },
  { word: 'TRIUMPH', hint: 'A great victory or achievement' },
  { word: 'CITIZEN', hint: 'A member of a country or community' },
  { word: 'PRIVACY', hint: 'The right to keep personal info secret' },
  { word: 'BALANCE', hint: 'Equal distribution of weight or power' },
  { word: 'CHAPTER', hint: 'A section of a book or a new beginning' },
  { word: 'DIGITAL', hint: 'Relating to computer technology' },
  { word: 'ECONOMY', hint: 'The system of trade and industry' },
  { word: 'FACTION', hint: 'A small group within a larger one' },
  { word: 'GENESIS', hint: 'The origin or beginning of something' },
  { word: 'HISTORY', hint: 'The study of past events' },
  { word: 'INSIGHT', hint: 'A deep understanding of something' },
  { word: 'JOURNEY', hint: 'An act of traveling from one place to another' },
  { word: 'KINGDOM', hint: 'A country ruled by a king or queen' },
  { word: 'LOYALTY', hint: 'Faithfulness to a person or cause' },
  { word: 'MISSION', hint: 'An important task or assignment' },
  { word: 'NEUTRAL', hint: 'Not supporting either side' },
  { word: 'OPINION', hint: 'A personal view or judgment' },
  { word: 'PASSION', hint: 'Strong emotion or enthusiasm' },
  { word: 'QUANTUM', hint: 'The smallest possible unit of energy' },
  { word: 'RADICAL', hint: 'Relating to fundamental change' },
  { word: 'SCIENCE', hint: 'Systematic study of the natural world' },
  { word: 'THUNDER', hint: 'The loud sound after lightning' },
  { word: 'UTOPIAN', hint: 'Relating to an ideal perfect society' },
  { word: 'VENTURE', hint: 'A risky or daring undertaking' },
  { word: 'WARRIOR', hint: 'A brave or experienced soldier' },
  { word: 'PARADOX', hint: 'A statement that contradicts itself' },
  { word: 'MYSTERY', hint: 'Something unexplained or secret' },
  { word: 'FORWARD', hint: 'Toward the future or front' },
  { word: 'ANCIENT', hint: 'Belonging to the very distant past' },
  { word: 'BROWSER', hint: 'Software used to access the internet' },
  { word: 'CAPTION', hint: 'Text below an image explaining it' },
  { word: 'DISCORD', hint: 'Disagreement or conflict' },
  { word: 'ECLIPSE', hint: 'When one celestial body blocks another' },
  { word: 'FANTASY', hint: 'The faculty of imagining impossible things' },
  { word: 'GADGETS', hint: 'Small mechanical or electronic devices' },
  { word: 'HARVEST', hint: 'The process of gathering crops' },
  { word: 'IMPULSE', hint: 'A sudden strong urge' },
  { word: 'JAVELIN', hint: 'A light spear thrown in athletics' },
  { word: 'KEYSTONE', hint: 'The central stone of an arch' },
  { word: 'LANTERN', hint: 'A portable lamp with a transparent case' },
  { word: 'MINDSET', hint: 'A habitual way of thinking' },
  { word: 'NUCLEAR', hint: 'Relating to the nucleus of an atom' },
  { word: 'OBSCURE', hint: 'Not well known or hard to understand' },
  { word: 'PHOENIX', hint: 'A mythical bird reborn from ashes' },
  { word: 'QUANTUM', hint: 'The minimum amount of a physical quantity' },
  { word: 'RESOLVE', hint: 'Firm determination to do something' },
  { word: 'SILENCE', hint: 'Complete absence of sound' },
  { word: 'TACTICS', hint: 'Plans for achieving a goal' },
  { word: 'UNIFIED', hint: 'Made into a single unit' },
  { word: 'VIBRANT', hint: 'Full of energy and enthusiasm' },
  { word: 'WILDCAT', hint: 'An uncontrolled or risky venture' },
  { word: 'ABSOLVE', hint: 'To declare someone free from blame' },
  { word: 'BOYCOTT', hint: 'Withdraw from commercial or social relations' },
  { word: 'CANDID', hint: 'Truthful and straightforward' },
  { word: 'DOSSIER', hint: 'A collection of documents about a person' },
  { word: 'ELASTIC', hint: 'Able to stretch and return to shape' },
  { word: 'FERVENT', hint: 'Having strong feelings about something' },
  { word: 'GRAVEL', hint: 'Small loose stones' },
  { word: 'HOSTILE', hint: 'Unfriendly or aggressive' },
  { word: 'IMMENSE', hint: 'Extremely large' },
  { word: 'JIGSAW', hint: 'A puzzle made of interlocking pieces' },
];

function getDailyWord() {
  const start = new Date('2026-01-01');
  const now = new Date();
  const dayOfYear = Math.floor((now - start) / (1000 * 60 * 60 * 24));
  return WORDS[dayOfYear % WORDS.length];
}

function scramble(word) {
  const arr = word.split('');
  let scrambled;
  let attempts = 0;
  do {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    scrambled = arr.join('');
    attempts++;
  } while (scrambled === word && attempts < 20);
  return scrambled;
}

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

  const wordObj = getDailyWord();
  todayWord = wordObj.word;
  scrambledWord = scramble(todayWord);

  await loadStats();

  // Check if already played
  const { data: existing } = await window.db
    .from('scramble_scores')
    .select('*')
    .eq('user_id', currentUser.id)
    .eq('played_at', today)
    .single();

  if (existing) {
    showAlreadyPlayed(existing, wordObj);
  } else {
    renderGame(wordObj);
  }
});

function renderGame(wordObj) {
  const gameArea = document.getElementById('game-area');
  gameArea.innerHTML = `
    <div class="post-card" style="margin-bottom:16px;">
      <div style="text-align:center;margin-bottom:20px;">
        <div style="font-size:13px;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:1px;">Today's Scramble</div>
        <div id="scramble-display" style="font-size:42px;font-weight:800;letter-spacing:12px;color:var(--primary);margin-bottom:8px;">${scrambledWord}</div>
        <div style="font-size:13px;color:var(--text-muted);">${todayWord.length} letters</div>
      </div>

      <div id="hint-area" style="margin-bottom:16px;min-height:32px;">
        <button id="hint-btn" class="btn btn-ghost" style="font-size:13px;width:100%;">💡 Show Hint</button>
      </div>

      <div class="form-group">
        <input type="text" id="answer-input" class="form-input"
          placeholder="Type your answer..."
          maxlength="${todayWord.length + 2}"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="characters"
          style="text-align:center;font-size:20px;font-weight:700;letter-spacing:4px;text-transform:uppercase;" />
      </div>

      <div id="attempt-feedback" style="min-height:24px;text-align:center;margin-bottom:12px;font-size:14px;"></div>

      <button id="submit-btn" class="btn btn-primary" style="width:100%;justify-content:center;">
        Submit Answer
      </button>

      <div style="text-align:center;margin-top:12px;font-size:12px;color:var(--text-muted);">
        Attempts: <span id="attempt-count">0</span>
      </div>
    </div>
  `;

  document.getElementById('hint-btn').addEventListener('click', () => {
    hintUsed = true;
    document.getElementById('hint-area').innerHTML = `
      <div style="padding:10px 14px;background:rgba(245,166,35,0.1);border:1px solid rgba(245,166,35,0.3);border-radius:8px;font-size:13px;color:#f5a623;">
        💡 ${wordObj.hint}
      </div>
    `;
  });

  document.getElementById('submit-btn').addEventListener('click', handleSubmit);
  document.getElementById('answer-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSubmit();
  });
}

function handleSubmit() {
  const input = document.getElementById('answer-input');
  const val = input.value.trim().toUpperCase();
  const feedback = document.getElementById('attempt-feedback');

  if (!val) return;

  attempts++;
  document.getElementById('attempt-count').textContent = attempts;

  if (val === todayWord) {
    saveAndShowResult(true);
  } else {
    // Wrong answer feedback
    input.value = '';
    input.style.borderColor = 'var(--danger)';
    setTimeout(() => { input.style.borderColor = ''; }, 600);

    if (attempts >= 5) {
      feedback.innerHTML = `<span style="color:var(--danger);">Not quite. ${5 - attempts <= 0 ? 'Last chance!' : `${5 - attempts} attempts left`}</span>`;
      // Give up after 6 attempts
      if (attempts >= 6) {
        saveAndShowResult(false);
        return;
      }
    } else {
      feedback.innerHTML = `<span style="color:var(--danger);">Not quite — try again!</span>`;
    }

    // Reshuffled display to help
    if (attempts >= 3) {
      const newScramble = scramble(todayWord);
      document.getElementById('scramble-display').textContent = newScramble;
      feedback.innerHTML += `<span style="color:var(--text-muted);font-size:12px;display:block;margin-top:4px;">Letters reshuffled to help.</span>`;
    }
  }
}

async function saveAndShowResult(solved) {
  const gameArea = document.getElementById('game-area');
  gameArea.innerHTML = '<div class="loading"><div class="spinner"></div>Saving...</div>';

  try {
    await window.db.from('scramble_scores').insert({
      user_id: currentUser.id,
      solved,
      attempts,
      played_at: today
    });

    // Get today's stats
    const { data: todayScores } = await window.db
      .from('scramble_scores')
      .select('solved, attempts')
      .eq('played_at', today);

    const totalPlayed = todayScores ? todayScores.length : 1;
    const totalSolved = todayScores ? todayScores.filter(s => s.solved).length : 0;
    const solveRate = Math.round((totalSolved / totalPlayed) * 100);

    const emoji = solved ? (attempts <= 2 ? '🏆' : attempts <= 4 ? '🎉' : '✅') : '😬';

    gameArea.innerHTML = `
      <div class="post-card" style="text-align:center;padding:32px 24px;margin-bottom:16px;">
        <div style="font-size:48px;margin-bottom:12px;">${emoji}</div>
        <div style="font-size:22px;font-weight:800;color:var(--text);margin-bottom:8px;">
          ${solved ? 'You got it!' : 'Better luck tomorrow!'}
        </div>
        <div style="font-size:28px;font-weight:800;color:var(--primary);letter-spacing:6px;margin-bottom:4px;">${todayWord}</div>
        ${wordObj_hint(todayWord)}
        <div style="margin:20px 0;padding:16px;background:var(--bg-input);border-radius:12px;">
          <div style="display:flex;justify-content:center;gap:32px;">
            <div>
              <div style="font-size:22px;font-weight:800;color:var(--primary);">${solved ? attempts : '✗'}</div>
              <div style="font-size:12px;color:var(--text-muted);">${solved ? 'Attempts' : 'Not solved'}</div>
            </div>
            <div>
              <div style="font-size:22px;font-weight:800;color:var(--primary);">${solveRate}%</div>
              <div style="font-size:12px;color:var(--text-muted);">Solve Rate Today</div>
            </div>
            <div>
              <div style="font-size:22px;font-weight:800;color:var(--primary);">${totalPlayed}</div>
              <div style="font-size:12px;color:var(--text-muted);">Played Today</div>
            </div>
          </div>
        </div>
        <button class="btn btn-primary" style="width:100%;justify-content:center;margin-bottom:12px;" onclick="shareScramble(${solved}, ${attempts})">
          📣 Share Result
        </button>
        <a href="/games.html" class="btn btn-ghost" style="width:100%;justify-content:center;text-decoration:none;">← Back to Games</a>
      </div>
    `;

    await loadStats();

  } catch (err) {
    console.error('Save scramble error:', err);
    gameArea.innerHTML = `<div class="post-card" style="text-align:center;padding:32px;">
      <div style="font-size:32px;">⚠️</div>
      <div style="font-size:15px;color:var(--text);margin-top:12px;">Could not save result. The word was: <strong>${todayWord}</strong></div>
    </div>`;
  }
}

function wordObj_hint(word) {
  const found = WORDS.find(w => w.word === word);
  if (!found) return '';
  return `<div style="font-size:13px;color:var(--text-muted);margin-bottom:4px;">${found.hint}</div>`;
}

function showAlreadyPlayed(existing, wordObj) {
  const gameArea = document.getElementById('game-area');
  const emoji = existing.solved ? (existing.attempts <= 2 ? '🏆' : '🎉') : '😬';

  gameArea.innerHTML = `
    <div class="post-card" style="text-align:center;padding:32px 24px;">
      <div style="font-size:40px;margin-bottom:12px;">${emoji}</div>
      <div style="font-size:20px;font-weight:800;color:var(--text);margin-bottom:4px;">You already played today!</div>
      <div style="font-size:14px;color:var(--text-muted);margin-bottom:20px;">Come back tomorrow for a new word.</div>
      <div style="font-size:28px;font-weight:800;color:var(--primary);letter-spacing:6px;margin-bottom:4px;">${todayWord}</div>
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:20px;">${wordObj.hint}</div>
      <div style="display:flex;justify-content:center;gap:32px;margin-bottom:24px;">
        <div>
          <div style="font-size:22px;font-weight:800;color:var(--primary);">${existing.solved ? existing.attempts : '✗'}</div>
          <div style="font-size:12px;color:var(--text-muted);">${existing.solved ? 'Attempts' : 'Not solved'}</div>
        </div>
      </div>
      <button class="btn btn-primary" style="width:100%;justify-content:center;margin-bottom:12px;" onclick="shareScramble(${existing.solved}, ${existing.attempts})">
        📣 Share Result
      </button>
      <a href="/games.html" class="btn btn-ghost" style="width:100%;justify-content:center;text-decoration:none;">← Back to Games</a>
    </div>
  `;
}

async function loadStats() {
  const container = document.getElementById('scramble-stats');
  if (!container) return;

  try {
    const { data: todayScores } = await window.db
      .from('scramble_scores')
      .select('solved, attempts')
      .eq('played_at', today);

    if (!todayScores || todayScores.length === 0) {
      container.innerHTML = '<div style="font-size:13px;color:var(--text-muted);">No one has played yet today.</div>';
      return;
    }

    const totalPlayed = todayScores.length;
    const totalSolved = todayScores.filter(s => s.solved).length;
    const solveRate = Math.round((totalSolved / totalPlayed) * 100);
    const avgAttempts = totalSolved > 0
      ? (todayScores.filter(s => s.solved).reduce((a, b) => a + b.attempts, 0) / totalSolved).toFixed(1)
      : '—';

    container.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div style="display:flex;justify-content:space-between;font-size:13px;">
          <span style="color:var(--text-muted);">Players today</span>
          <span style="font-weight:700;color:var(--text);">${totalPlayed}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:13px;">
          <span style="color:var(--text-muted);">Solve rate</span>
          <span style="font-weight:700;color:var(--text);">${solveRate}%</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:13px;">
          <span style="color:var(--text-muted);">Avg attempts</span>
          <span style="font-weight:700;color:var(--text);">${avgAttempts}</span>
        </div>
      </div>
    `;
  } catch (err) {
    console.error('Stats error:', err);
  }
}

function shareScramble(solved, attempts) {
  const boxes = solved
    ? Array(attempts).fill('🟨').join('') + ' ✅'
    : '❌ Unsolved';
  const text = `🔤 XenChee Word Scramble — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}\n${boxes}\n${solved ? `Solved in ${attempts} attempt${attempts !== 1 ? 's' : ''}!` : 'Could not crack it today.'}\n\nPlay at xenchee.netlify.app/game-scramble.html`;

  navigator.clipboard.writeText(text).then(() => {
    alert('Result copied — paste it in your feed!');
  }).catch(() => {
    alert(text);
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}
