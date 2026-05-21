exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { token } = body;

  if (!token) {
    return {
      statusCode: 200,
      body: JSON.stringify({ success: false, error: 'No token provided' })
    };
  }

  try {
    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${process.env.RECAPTCHA_SECRET}&response=${token}`
    });

    const data = await response.json();

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: data.success,
        score: data.score || null,
        errors: data['error-codes'] || []
      })
    };

  } catch (err) {
    console.error('reCAPTCHA verify error:', err);
    return {
      statusCode: 200,
      body: JSON.stringify({ success: false, error: 'Verification request failed' })
    };
  }
};
