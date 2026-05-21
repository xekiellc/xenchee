exports.handler = async () => {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify({
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
      GIPHY_API_KEY: process.env.GIPHY_API_KEY,
      RECAPTCHA_SITE_KEY: '6LeOqfQsAAAAAF1mZktRAvH850-95HxEzpfVoTZA'
    })
  };
};
