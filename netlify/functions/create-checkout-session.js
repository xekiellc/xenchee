// netlify/functions/create-checkout-session.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const { user_id } = JSON.parse(event.body);

    if (!user_id) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing user_id' }) };
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: 'price_1TZc1X5Bl41T0zOmZbbxyAPi',
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: 'https://voxxee.com/profile.html?verified=true',
      cancel_url: 'https://voxxee.com/verified-badge.html?cancelled=true',
      metadata: {
        user_id: user_id,
      },
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ sessionId: session.id }),
    };

  } catch (err) {
    console.error('Stripe session error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
