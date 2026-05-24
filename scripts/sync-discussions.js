const fs = require('fs');
const path = require('path');

const OWNER = process.env.REPO_OWNER;
const REPO = process.env.REPO_NAME;
const DISCUSSION_NUMBER = Number(process.env.DISCUSSION_NUMBER || '2');
const TOKEN = process.env.GITHUB_TOKEN;

if (!OWNER || !REPO || !TOKEN) {
  console.error('Missing REPO_OWNER, REPO_NAME, or GITHUB_TOKEN');
  process.exit(1);
}

const query = `
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    discussion(number: $number) {
      title
      url
      body
      createdAt
      author {
        login
      }
      comments(first: 100) {
        nodes {
          id
          body
          createdAt
          url
          author {
            login
          }
        }
      }
    }
  }
}`;

function classify(text) {
  const t = (text || '').toLowerCase();
  const proHints = ['за', 'підтрим', 'цінність', 'переваг', 'сильн', 'корисн', 'mvp'];
  const conHints = ['проти', 'ризик', 'слабк', 'проблем', 'не спрацю', 'занадто', 'складн'];
  if (proHints.some(x => t.includes(x))) return 'pro';
  if (conHints.some(x => t.includes(x))) return 'con';
  return 'neutral';
}

function trimText(text, n = 280) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > n ? clean.slice(0, n - 1) + '…' : clean;
}

async function main() {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TOKEN}`,
      'User-Agent': 'avvd-discussion-sync'
    },
    body: JSON.stringify({
      query,
      variables: { owner: OWNER, repo: REPO, number: DISCUSSION_NUMBER }
    })
  });

  const json = await res.json();

  if (!res.ok || json.errors) {
    console.error(JSON.stringify(json, null, 2));
    process.exit(1);
  }

  const discussion = json.data.repository.discussion;
  const comments = discussion.comments.nodes || [];

  const starterItem = {
    id: `discussion-${DISCUSSION_NUMBER}`,
    label: classify(discussion.body),
    title: discussion.title,
    body: trimText(discussion.body),
    author: discussion.author?.login || 'unknown',
    source: 'GitHub Discussions',
    createdAt: discussion.createdAt,
    url: discussion.url
  };

  const commentItems = comments.map((c, idx) => ({
    id: c.id,
    label: classify(c.body),
    title: `Коментар #${idx + 1}`,
    body: trimText(c.body),
    author: c.author?.login || 'unknown',
    source: 'GitHub Discussions',
    createdAt: c.createdAt,
    url: c.url
  }));

  const items = [starterItem, ...commentItems];

  const counts = {
    posts: items.length,
    pro: items.filter(x => x.label === 'pro').length,
    con: items.filter(x => x.label === 'con').length,
    neutral: items.filter(x => x.label === 'neutral').length
  };

  const output = {
    meta: {
      repo: `${OWNER}/${REPO}`,
      discussionNumber: DISCUSSION_NUMBER,
      discussionTitle: discussion.title,
      discussionUrl: discussion.url,
      updatedAt: new Date().toISOString()
    },
    counts,
    items
  };

  fs.mkdirSync(path.join(process.cwd(), 'data'), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), 'data', 'discussions.json'), JSON.stringify(output, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
