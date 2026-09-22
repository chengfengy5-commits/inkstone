import assert from 'node:assert/strict'
import test from 'node:test'
import { parseArchiveTree, parseGitTree, parseRssItems, rssCandidate, selectKeyPaths } from './learning-library-collector.mjs'

test('parses RSS CDATA, source links, discussion links, and categories', () => {
  const [item] = parseRssItems(`<?xml version="1.0"?>
    <rss><channel><item>
      <title><![CDATA[Useful JVM article]]></title>
      <link>https://example.com/article</link>
      <comments>https://example.com/discussion</comments>
      <guid>post-42</guid>
      <pubDate>Mon, 21 Sep 2026 08:00:00 GMT</pubDate>
      <category><![CDATA[java]]></category>
      <description><![CDATA[<p>Points: 51</p><p># Comments: 8</p>]]></description>
    </item></channel></rss>`)

  assert.equal(item.title, 'Useful JVM article')
  assert.equal(item.link, 'https://example.com/article')
  assert.equal(item.comments, 'https://example.com/discussion')
  assert.deepEqual(item.categories, ['java'])

  const candidate = rssCandidate({
    source: '测试社区',
    sourceKind: 'community',
    area: '开源与工程',
    weight: 1_000,
    provider: 'rss',
  }, item)
  assert.equal(candidate.sourceKind, 'community')
  assert.equal(candidate.url, 'https://example.com/discussion')
  assert.equal(candidate.originalUrl, 'https://example.com/article')
  assert.equal(candidate.engagement, 67)
  assert.equal(candidate.area, '后端与虚拟机')
})

test('parses Atom entry links and content', () => {
  const [item] = parseRssItems(`<?xml version="1.0"?>
    <feed xmlns="http://www.w3.org/2005/Atom"><entry>
      <title>Agent runtime design</title>
      <link rel="alternate" href="https://example.com/agent-runtime" />
      <id>tag:example.com,2026:agent-runtime</id>
      <updated>2026-09-21T08:00:00Z</updated>
      <content type="html"><![CDATA[<p>An MCP agent runtime.</p>]]></content>
    </entry></feed>`)

  assert.equal(item.link, 'https://example.com/agent-runtime')
  assert.equal(item.guid, 'tag:example.com,2026:agent-runtime')
  assert.match(item.content, /MCP agent runtime/)
})

test('selects build metadata and representative nested source files from a shallow Git tree', () => {
  const tree = parseGitTree([
    '100644 blob aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1200\tpom.xml',
    '100644 blob bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 4200\tdubbo-common/src/main/java/org/apache/dubbo/common/Version.java',
    '100644 blob cccccccccccccccccccccccccccccccccccccccc 5200\tquiche/src/lib.rs',
    '100644 blob dddddddddddddddddddddddddddddddddddddddd 900\tskills/security-audit/SKILL.md',
    '100644 blob eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee 800\texamples/demo/src/main/java/Demo.java',
  ].join('\n'))

  assert.deepEqual(selectKeyPaths(tree), [
    'pom.xml',
    'quiche/src/lib.rs',
    'dubbo-common/src/main/java/org/apache/dubbo/common/Version.java',
    'skills/security-audit/SKILL.md',
  ])
})

test('normalizes GitHub source archive paths without extracting the archive', () => {
  const result = parseArchiveTree([
    'quiche-main/',
    'quiche-main/README.md',
    'quiche-main/Cargo.toml',
    'quiche-main/quiche/src/lib.rs',
    'quiche-main/src/',
  ].join('\n'))

  assert.equal(result.prefix, 'quiche-main/')
  assert.deepEqual(result.tree.map((entry) => entry.path), ['README.md', 'Cargo.toml', 'quiche/src/lib.rs'])
})
