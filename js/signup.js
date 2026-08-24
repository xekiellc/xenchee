async function waitForDb(timeout = 5000) {
  const start = Date.now();
  while (!window.db) {
    if (Date.now() - start > timeout) throw new Error('Supabase init timeout');
    await new Promise(r => setTimeout(r, 50));
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await waitForDb();

  const { data: { session } } = await window.db.auth.getSession();
  if (session?.user) {
    window.location.href = '/feed.html';
    return;
  }

  document.getElementById('signup-btn').addEventListener('click', handleSignup);

  document.getElementById('password-toggle').addEventListener('click', () => {
    const input = document.getElementById('password');
    const btn = document.getElementById('password-toggle');
    const shown = input.type === 'text';
    input.type = shown ? 'password' : 'text';
    btn.textContent = shown ? '👁️' : '🙈';
    btn.setAttribute('aria-label', shown ? 'Show password' : 'Hide password');
    input.focus();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSignup();
  });
});

async function handleSignup() {
  const email = document.getElementById('email').value.trim();
  const username = document.getElementById('username').value.trim().toLowerCase();
  const password = document.getElementById('password').value;
  const dob = document.getElementById('dob').value;
  const termsChecked = document.getElementById('terms').checked;

  clearAlert();

  if (!email || !username || !password || !dob) {
    showAlert('Please fill in all fields.', 'error');
    return;
  }

  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    showAlert('Username can only contain letters, numbers, and underscores.', 'error');
    return;
  }

  if (username.length < 3) {
    showAlert('Username must be at least 3 characters.', 'error');
    return;
  }

  if (password.length < 8) {
    showAlert('Password must be at least 8 characters.', 'error');
    return;
  }

  if (!window.isOver18(dob)) {
    showAlert('You must be 18 or older to join Voxxee.', 'error');
    return;
  }

  if (!termsChecked) {
    showAlert('Please agree to the Terms of Service and Privacy Policy.', 'error');
    return;
  }

  const recaptchaResponse = grecaptcha.getResponse();
  if (!recaptchaResponse) {
    showAlert('Please complete the reCAPTCHA verification.', 'error');
    return;
  }

  const btn = document.getElementById('signup-btn');
  btn.textContent = 'Creating account...';
  btn.disabled = true;

  try {
    // Check username availability — maybeSingle() returns null instead of 406 when not found
    const { data: existing, error: checkError } = await window.db
      .from('profiles')
      .select('username')
      .eq('username', username)
      .maybeSingle();

    if (checkError) {
      console.error('Username check error:', checkError);
    }

    if (existing) {
      showAlert('That username is already taken. Please choose another.', 'error');
      btn.textContent = 'Create Account';
      btn.disabled = false;
      return;
    }

    // Sign up — DB triggers auto-create users + profiles rows
    const { data, error } = await window.auth.signUp(email, password, dob);

    if (error) {
      if (error.message.includes('already registered')) {
        showAlert('An account with this email already exists.', 'error');
      } else {
        showAlert(error.message || 'Signup failed. Please try again.', 'error');
      }
      btn.textContent = 'Create Account';
      btn.disabled = false;
      return;
    }

    if (data?.user) {
      // Update the trigger-created profile with the chosen username
      await window.db
        .from('profiles')
        .update({ username, display_name: username, onboarding_complete: false })
        .eq('user_id', data.user.id);

      window.location.href = '/onboarding.html';
    }

  } catch (err) {
    console.error('Signup error:', err);
    showAlert('Something went wrong. Please try again.', 'error');
    btn.textContent = 'Create Account';
    btn.disabled = false;
  }
}

function showAlert(message, type) {
  const container = document.getElementById('alert-container');
  container.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
}

function clearAlert() {
  document.getElementById('alert-container').innerHTML = '';
}
