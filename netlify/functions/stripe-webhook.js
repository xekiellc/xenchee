// netlify/functions/stripe-webhook.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const sig = event.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    const userId = session.metadata?.user_id;

    if (!userId) {
      console.error('No user_id in session metadata');
      return { statusCode: 400, body: 'Missing user_id in metadata' };
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { error } = await supabase
      .from('profiles')
      .update({ is_verified: true, verified_type: 'identity' })
      .eq('user_id', userId);

    if (error) {
      console.error('Supabase update error:', error);
      return { statusCode: 500, body: 'Database update failed' };
    }

    console.log(`Verified badge granted to user: ${userId}`);
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
