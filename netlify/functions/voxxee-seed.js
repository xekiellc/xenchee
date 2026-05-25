const { createClient } = require('@supabase/supabase-js');

const VOXXEEBOT_USER_ID = '5347572e-107f-43b2-a43e-aafe35e68014';

const COMMUNITY_MAP = {
  'diamond-hands-daily':         { topics: ['crypto investing', 'stock market', 'alternative finance'], newsQuery: 'crypto stocks alternative investing' },
  'extraterrestreal':            { topics: ['UFO', 'UAP', 'space exploration', 'consciousness', 'fringe science'], newsQuery: 'UAP UFO space consciousness' },
  'free-elizabeth-holmes':       { topics: ['Elizabeth Holmes', 'Theranos', 'wrongful conviction'], newsQuery: 'Elizabeth Holmes Theranos' },
  'global-politics-360':         { topics: ['geopolitics', 'world news', 'political analysis'], newsQuery: 'geopolitics world news analysis' },
  'golazo-global':               { topics: ['soccer', 'football', 'FIFA', 'World Cup 2026'], newsQuery: 'soccer football FIFA World Cup 2026' },
  'i-love-cbnc':                 { topics: ['Carolina Beach', 'Kure Beach', 'North Carolina coast'], newsQuery: 'Carolina Beach NC news' },
  'kpop-network':                { topics: ['K-pop', 'BTS', 'HYBE', 'Korean music'], newsQuery: 'kpop BTS HYBE Korean music' },
  'kayfabe-heat':                { topics: ['pro wrestling', 'WWE', 'AEW', 'indie wrestling'], newsQuery: 'pro wrestling WWE AEW' },
  'lulzsec':                     { topics: ['cybersecurity', 'hacking', 'digital rights', 'internet freedom'], newsQuery: 'cybersecurity hacking digital rights' },
  'majestic-wicket':             { topics: ['cricket', 'IPL', 'Test cricket'], newsQuery: 'cricket IPL Test match' },
  'pardon-john-kiriakou':        { topics: ['John Kiriakou', 'whistleblowers', 'CIA torture', 'national security'], newsQuery: 'John Kiriakou whistleblower CIA' },
  'science-silenced':            { topics: ['censored science', 'medical freedom', 'heterodox research'], newsQuery: 'medical censorship science freedom' },
  'sir-jony-ive':                { topics: ['Jony Ive', 'LoveFrom', 'Apple design', 'industrial design'], newsQuery: 'Jony Ive LoveFrom design' },
  'uniparty-politics':           { topics: ['political corruption', 'deep state', 'Washington DC'], newsQuery: 'political corruption Washington DC' },
  'yamanaka-factors':            { topics: ['longevity', 'anti-aging', 'Yamanaka factors', 'epigenetics'], newsQuery: 'longevity anti-aging Yamanaka epigenetics' },
  'youngstown-state-university': { topics: ['YSU', 'Youngstown State', 'Penguins', 'Ohio university'], newsQuery: 'Youngstown State University YSU' },
};

const POLL_TEMPLATES = {
  'diamond-hands-daily':         { question: 'Where do you see Bitcoin in 6 months?', options: ['Above $150k', '$100k-$150k', '$50k-$100k', 'Below $50k'] },
  'extraterrestreal':            { question: 'Do you believe the government is hiding UFO evidence?', options: ['Absolutely yes', 'Probably yes', 'Probably not', 'Definitely not'] },
  'free-elizabeth-holmes':       { question: 'Was Elizabeth Holmes treated fairly by the justice system?', options: ['No — too harsh', 'Yes — justice served', 'Partially fair', 'Not sure'] },
  'global-politics-360':         { question: 'Who controls the global narrative most?', options: ['Legacy media', 'Big Tech', 'Governments', 'Corporations'] },
  'golazo-global':               { question: 'Who wins the 2026 World Cup?', options: ['USA', 'Brazil', 'France', 'England'] },
  'i-love-cbnc':                 { question: 'Best season to visit Carolina Beach?', options: ['Summer', 'Fall', 'Spring', 'Winter'] },
  'kpop-network':                { question: 'Best K-pop group of 2026?', options: ['BTS', 'BLACKPINK', 'aespa', 'Other'] },
  'kayfabe-heat':                { question: 'Best wrestling promotion right now?', options: ['WWE', 'AEW', 'TNA', 'Indie scene'] },
  'lulzsec':                     { question: 'Is the internet more or less free than 10 years ago?', options: ['Much less free', 'Somewhat less free', 'About the same', 'More free'] },
  'majestic-wicket':             { question: 'Who wins the next major Test series?', options: ['England', 'Australia', 'India', 'South Africa'] },
  'pardon-john-kiriakou':        { question: 'Should John Kiriakou receive a full pardon?', options: ['Yes — he is a hero', 'Yes — sentence was unjust', 'No opinion', 'No'] },
  'science-silenced':            { question: 'Do you trust mainstream medical institutions?', options: ['Not at all', 'Somewhat', 'Mostly', 'Completely'] },
  'sir-jony-ive':                { question: 'What should LoveFrom design next?', options: ['A phone', 'A car', 'Wearables', 'Home products'] },
  'uniparty-politics':           { question: 'Is there a real difference between the two parties?', options: ['No — same owners', 'Slightly different', 'Meaningfully different', 'Completely different'] },
  'yamanaka-factors':            { question: 'Will human lifespan reach 150 years in your lifetime?', options: ['Yes definitely', 'Probably', 'Unlikely', 'No way'] },
  'youngstown-state-university': { question: 'Are you or a loved one a YSU alum?', options: ['Yes — I am', 'Yes — family member', 'No — just a fan', 'No connection yet'] },
};

async function fetchNews(query, apiKey) {
  const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&sortBy=publishedAt&pageSize=3&language=en&apiKey=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.articles || [];
}

async function generateDiscussionStarter(topic, claudeApiKey) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': claudeApiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `Write a short provocative discussion starter post (2-3 sentences max) for a free speech social platform community focused on: ${topic}. Make it opinionated and conversation-starting. No hashtags. No emojis. Direct and raw.`
      }]
    })
  });
  const data = await res.json();
  return data.content?.[0]?.text || null;
}

exports.handler = async (event) => {
  const secret = event.headers['x-pipeline-secret'] || event.queryStringParameters?.secret;
  if (secret !== process.env.PIPELINE_SECRET) {
    return { statusCode: 401, body: 'Unauthorized' };
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const newsApiKey = process.env.NEWS_API_KEY;
  const claudeApiKey = process.env.CLAUDE_API_KEY;

  const { data: communities } = await supabase
    .from('communities')
    .select('id, slug');

  const communityLookup = {};
  for (const c of communities) {
    communityLookup[c.slug] = c.id;
  }

  const results = [];

  for (const [slug, config] of Object.entries(COMMUNITY_MAP)) {
    const communityId = communityLookup[slug];
    if (!communityId) continue;

    try {
      // 1. Post latest news article
      const articles = await fetchNews(config.newsQuery, newsApiKey);
      if (articles.length > 0) {
        const article = articles[0];
        const content = `📰 ${article.title}\n\n${article.description || ''}\n\n🔗 ${article.url}`;
        await supabase.from('posts').insert({
          user_id: VOXXEEBOT_USER_ID,
          community_id: communityId,
          content: content.slice(0, 2000),
          is_explicit: false,
          is_adult: false,
          view_count: 0
        });
        results.push({ slug, type: 'news', status: 'ok' });
      }

      // 2. Post AI discussion starter
      const topic = config.topics[Math.floor(Math.random() * config.topics.length)];
      const discussion = await generateDiscussionStarter(topic, claudeApiKey);
      if (discussion) {
        await supabase.from('posts').insert({
          user_id: VOXXEEBOT_USER_ID,
          community_id: communityId,
          content: discussion,
          is_explicit: false,
          is_adult: false,
          view_count: 0
        });
        results.push({ slug, type: 'discussion', status: 'ok' });
      }

      // 3. Poll — once per day per community
      const today = new Date().toISOString().split('T')[0];
      const { data: existingPolls } = await supabase
        .from('polls')
        .select('id')
        .eq('post_id', communityId)
        .gte('created_at', today)
        .limit(1);

      if (!existingPolls || existingPolls.length === 0) {
        const pollTemplate = POLL_TEMPLATES[slug];
        if (pollTemplate) {
          const { data: pollPost } = await supabase.from('posts').insert({
            user_id: VOXXEEBOT_USER_ID,
            community_id: communityId,
            content: `📊 Daily Poll: ${pollTemplate.question}`,
            is_explicit: false,
            is_adult: false,
            view_count: 0
          }).select().single();

          if (pollPost) {
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
            await supabase.from('polls').insert({
              post_id: pollPost.id,
              user_id: VOXXEEBOT_USER_ID,
              question: pollTemplate.question,
              options: pollTemplate.options,
              duration_hours: 24,
              expires_at: expiresAt,
              is_anonymous: false
            });
            results.push({ slug, type: 'poll', status: 'ok' });
          }
        }
      }

    } catch (err) {
      results.push({ slug, status: 'error', error: err.message });
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ seeded: results.length, results })
  };
};
