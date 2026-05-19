const SUPABASE_URL = 'https://vclvqbblcnimzbdwejzl.supabase.co';

// Anon key is safe for frontend — RLS policies protect the data
// Loaded via Netlify environment variable injection
const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || '';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const auth = {
  async signUp(email, password, dateOfBirth) {
    const { data, error } = await db.auth.signUp({
      email,
      password,
      options: { data: { date_of_birth: dateOfBirth } }
    });
    return { data, error };
  },

  async signIn(email, password) {
    const { data, error } = await db.auth.signInWithPassword({
      email,
      password
    });
    return { data, error };
  },

  async signOut() {
    const { error } = await db.auth.signOut();
    return { error };
  },

  async getUser() {
    const { data: { user } } = await db.auth.getUser();
    return user;
  },

  async getSession() {
    const { data: { session } } = await db.auth.getSession();
    return session;
  },

  onAuthStateChange(callback) {
    return db.auth.onAuthStateChange(callback);
  }
};

function isOver18(dateOfBirth) {
  const dob = new Date(dateOfBirth);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age >= 18;
}
