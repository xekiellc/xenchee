const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

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

  // Decode HTML entities
  function decodeHtml(str) {
    return str
      .replace(/&#8216;/g, '\u2018')
      .replace(/&#8217;/g, '\u2019')
      .replace(/&#8220;/g, '\u201C')
      .replace(/&#8221;/g, '\u201D')
      .replace(/&#8212;/g, '\u2014')
      .replace(/&#8211;/g, '\u2013')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#[0-9]+;/g, m => String.fromCharCode(parseInt(m.slice(2, -1))));
  }

  const cleanTitle = decodeHtml(title);
  const cleanSummary = summary ? decodeHtml(summary) : '';

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    const { data: community, error: communityError } = await supabase
      .from('communities')
      .select('id, name')
      .eq('slug', slug)
      .single();

    if (communityError || !community) {
      return { statusCode: 404, body: `Community not found: ${slug}` };
    }

    const content = cleanSummary
      ? `${cleanTitle}\n\n${cleanSummary}\n\n🔗 ${url}`
      : `${cleanTitle}\n\n🔗 ${url}`;

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
        title: cleanTitle
      })
    };

  } catch (err) {
    console.error('Pipeline post error:', err);
    return { statusCode: 500, body: 'Internal server error' };
  }
};
