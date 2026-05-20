const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  // Verify secret
  const authHeader = event.headers['x-pipeline-secret'];
  if (authHeader !== process.env.PIPELINE_SECRET) {
    return { statusCode: 401, body: 'Unauthorized' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (err) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { slug, title, summary, url } = body;

  if (!slug || !title || !url) {
    return { statusCode: 400, body: 'Missing required fields: slug, title, url' };
  }

  // Init Supabase with service role key
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    // Look up community by slug
    const { data: community, error: communityError } = await supabase
      .from('communities')
      .select('id, name')
      .eq('slug', slug)
      .single();

    if (communityError || !community) {
      return { statusCode: 404, body: `Community not found: ${slug}` };
    }

    // Build post content
    const content = summary
      ? `${title}\n\n${summary}\n\n🔗 ${url}`
      : `${title}\n\n🔗 ${url}`;

    // Post as aibot
    const AIBOT_USER_ID = '5347572e-107f-43b2-a43e-aafe35e68014';

    const { error: postError } = await supabase
      .from('posts')
      .insert({
        user_id: AIBOT_USER_ID,
        community_id: community.id,
        content: content,
        is_removed: false
      });

    if (postError) throw postError;

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        community: community.name,
        title: title
      })
    };

  } catch (err) {
    console.error('Pipeline post error:', err);
    return { statusCode: 500, body: 'Internal server error' };
  }
};
