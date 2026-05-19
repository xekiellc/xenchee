document.addEventListener('DOMContentLoaded', () => {
  const signupBtn = document.getElementById('signup-btn');
  signupBtn.addEventListener('click', handleSignup);
});

async function handleSignup() {
  const email = document.getElementById('email').value.trim();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const dob = document.getElementById('dob').value;
  const terms = document.getElementById('terms').checked;

  clearAlert();

  // Validation
  if (!email || !username || !password || !dob) {
    showAlert('Please fill in all fields.', 'error');
    return;
  }

  if (!terms) {
    showAlert('You must agree to the Terms of Service to join.', 'error');
    return;
  }

  if (!isOver18(dob)) {
    showAlert('You must be 18 or older to join XenChee.', 'error');
    return;
  }

  if (password.length < 8) {
    showAlert('Password must be at least 8 characters.', 'error');
    return;
  }

  const usernameRegex = /^[a-zA-Z0-9_]+$/;
  if (!usernameRegex.test(username)) {
    showAlert('Username can only contain letters, numbers, and underscores.', 'error');
    return;
  }

  const btn = document.getElementById('signup-btn');
  btn.textContent = 'Creating account...';
  btn.disabled = true;

  try {
    // Check username availability
    const { data: existing } = await db
      .from('profiles')
      .select('username')
      .eq('username', username.toLowerCase())
      .single();

    if (existing) {
      showAlert('That username is already taken. Please choose another.', 'error');
      btn.textContent = 'Create Account';
      btn.disabled = false;
      return;
    }

    // Create auth user
    const { data, error } = await auth.signUp(email, password, dob);

    if (error) {
      showAlert(error.message, 'error');
      btn.textContent = 'Create Account';
      btn.disabled = false;
      return;
    }

    if (data?.user) {
      // Create profile
      const { error: profileError } = await db
        .from('profiles')
        .insert({
          user_id: data.user.id,
          username: username.toLowerCase(),
          display_name: username,
        });

      if (profileError) {
        console.error('Profile creation error:', profileError);
      }

      // Create user record
      const { error: userError } = await db
        .from('users')
        .insert({
          id: data.user.id,
          email: email,
          date_of_birth: dob,
          is_18_verified: true,
        });

      if (userError) {
        console.error('User record error:', userError);
      }

      showAlert('Account created! Please check your email to confirm your account.', 'success');
      btn.textContent = 'Account Created';

      setTimeout(() => {
        window.location.href = '/login.html';
      }, 3000);
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
  const container = document.getElementById('alert-container');
  container.innerHTML = '';
}
