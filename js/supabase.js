(function() {
  const SUPABASE_URL = 'https://vclvqbblcnimzbdwejzl.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZjbHZxYmJsY25pbXpiZHdlanpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDUyNjkxNzMsImV4cCI6MjA2MDg0NTE3M30.GCOFPBMOAnr-q6DqN_xpPx2eqG48vZSXNJzxeSXoBiM';

  const { createClient } = supabase;
  window.db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  window.auth = {
    async signUp(email, password, dateOfBirth) {
      const { data, error } = await window.db.auth.signUp({
        email,
        password,
        options: { data: { date_of_birth: dateOfBirth } }
      });
      return { data, error };
    },

    async signIn(email, password) {
      const { data, error } = await window.db.auth.signInWithPassword({
        email,
        password
      });
      return { data, error };
    },

    async signOut() {
      const { error } = await window.db.auth.signOut();
      return { error };
    },

    async getUser() {
      const { data: { user } } = await window.db.auth.getUser();
      return user;
    },

    async getSession() {
      const { data: { session } } = await window.db.auth.getSession();
      return session;
    },

    onAuthStateChange(callback) {
      return window.db.auth.onAuthStateChange(callback);
    }
  };

  window.isOver18 = function(dateOfBirth) {
    const dob = new Date(dateOfBirth);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
      age--;
    }
    return age >= 18;
  };

  // Lazy load other API keys only when needed
  window.loadApiKeys = async function() {
    if (window.giphyApiKey) return;
    try {
      const response = await fetch('/.netlify/functions/config');
      const config = await response.json();
      window.giphyApiKey = config.GIPHY_API_KEY;
      window.recaptchaSiteKey = config.RECAPTCHA_SITE_KEY;
    } catch (err) {
      console.error('Failed to load API keys:', err);
    }
  };
})();
