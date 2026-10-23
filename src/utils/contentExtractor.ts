import { requestUrl } from 'obsidian';

const NOISE_SELECTORS = [
  'script', 'style', 'noscript', 'iframe',
  'nav', 'header', 'footer',
  '.nav', '.navigation', '.navbar', '.menu', '.sidebar', '.side-bar',
  '.ad', '.ads', '.advertisement',
  '.comment', '.comments',
  '.social', '.share', '.sharing',
  '.breadcrumb',
  '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
  '[role="complementary"]',
];

const NOISE_TEXT_PATTERNS = [
  /^分享到/,
  /^换一批$/,
  /^大字体$/,
  /^小字体$/,
  /^\d+\/\d+$/,
  /^\d+\/\d+\*\*?\d+\/\d+/,
];

const NOISE_LINK_PATTERNS = [
  /^javascript:/,
];

export async function fetchFullContent(url: string): Promise<{ content: string; textContent: string }> {
  try {
    const response = await requestUrl({ url, method: 'GET' });
    const html = response.text;

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // 图片相对路径补全为绝对地址（基于原文 URL 解析），避免 Markdown 里出现死图
    absolutizeImageUrls(doc, url);

    removeNoise(doc);

    const contentBlock = findContentBlock(doc);

    if (contentBlock) {
      const content = contentBlock.innerHTML;
      const textContent = contentBlock.textContent || '';
      return { content, textContent: textContent.trim() };
    }

    return { content: '', textContent: '' };
  } catch (error) {
    console.error('Failed to fetch full content:', error);
    throw error;
  }
}

/** 将文档内所有 <img> 的相对 src 补全为绝对 URL（基于 baseUrl）。 */
function absolutizeImageUrls(doc: Document, baseUrl: string): void {
  doc.querySelectorAll('img').forEach(img => {
    const src = img.getAttribute('src');
    if (!src) return;
    try {
      img.setAttribute('src', new URL(src, baseUrl).toString());
    } catch {
      // 非法 URL 保持原样
    }
  });
}

function removeNoise(doc: Document): void {
  for (const selector of NOISE_SELECTORS) {
    try {
      doc.querySelectorAll(selector).forEach(el => el.remove());
    } catch {
      // skip
    }
  }
}

function findContentBlock(doc: Document): Element | null {
  const specificSelectors = [
    '.article-content', '.article-body', '.article-text',
    '.post-content', '.post-body', '.post-text', '.entry-content',
    '.content-body', '.content-text', '.story-body', '.story-content',
    '.news-content', '.news-body', '.news-text', '.detail-content', '.detail-body',
    '.main-content', '.main-article', '.main-text',
    '#article-content', '#post-content', '#content-body', '#article-body',
    '.text-content', '.text-body',
    '.editor-content', '.edit-content',
  ];

  for (const sel of specificSelectors) {
    try {
      const el = doc.querySelector(sel);
      if (el && el.textContent && el.textContent.trim().length > 100) {
        return el;
      }
    } catch {
      // skip
    }
  }

  return findBestContentBlock(doc);
}

function findBestContentBlock(doc: Document): Element | null {
  const articleEl = doc.querySelector('article');
  const mainEl = doc.querySelector('main');

  if (articleEl) {
    const best = findBestChild(articleEl);
    if (best) return best;
  }

  if (mainEl) {
    const best = findBestChild(mainEl);
    if (best) return best;
  }

  const allDivs = doc.querySelectorAll('div, section');
  let bestEl: Element | null = null;
  let bestScore = -1;

  allDivs.forEach(el => {
    const score = scoreContentBlock(el);
    if (score > bestScore) {
      bestScore = score;
      bestEl = el;
    }
  });

  return bestEl;
}

function findBestChild(root: Element): Element | null {
  let bestEl: Element | null = root;
  let bestScore = scoreContentBlock(root);

  const stack: Element[] = Array.from(root.children);
  while (stack.length > 0) {
    const el = stack.pop()!;
    const score = scoreContentBlock(el);

    if (score > bestScore) {
      bestScore = score;
      bestEl = el;
    }

    for (const child of Array.from(el.children)) {
      stack.push(child);
    }
  }

  return bestEl;
}

function scoreContentBlock(el: Element): number {
  const text = (el.textContent || '').trim();
  if (text.length < 100) return -1;

  const html = el.innerHTML;

  const textOnly = (el.textContent || '').replace(/\s+/g, '').length;
  const htmlLen = html.replace(/\s+/g, '').length;
  const textRatio = textOnly / Math.max(htmlLen, 1);

  const pCount = (html.match(/<p[\s>]/gi) || []).length;
  const aCount = (html.match(/<a[\s>]/gi) || []).length;
  const imgCount = (html.match(/<img[\s>]/gi) || []).length;

  const linkRatio = aCount / Math.max(pCount, 1);

  let score = 0;

  score += textOnly * 0.5;

  score += pCount * 30;

  score -= aCount * 15;

  score -= imgCount * 5;

  if (linkRatio > 1.0) score -= 200;
  if (linkRatio > 2.0) score -= 500;

  if (textRatio > 0.4) score += 200;
  if (textRatio > 0.6) score += 300;
  if (textRatio < 0.15) score -= 300;

  const classAttr = ((el.getAttribute('class') || '') + ' ' + (el.getAttribute('id') || '')).toLowerCase();
  if (/content|article|post|entry|body|text|story|detail/.test(classAttr)) score += 300;
  if (/sidebar|widget|comment|footer|nav|menu|ad|recommend|hot|rank|related|trending|video|photo|live|special|select/.test(classAttr)) score -= 500;

  const childCount = el.children.length;
  if (childCount > 0) {
    const avgChildText = textOnly / childCount;
    if (avgChildText > 20) score += 100;
  }

  return score;
}

export function htmlToMarkdown(html: string): string {
  let text = html;

  text = text.replace(/<!--[\s\S]*?-->/g, '');

  text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n\n');
  text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n\n');
  text = text.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n\n');
  text = text.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n\n');
  text = text.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '\n##### $1\n\n');
  text = text.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '\n###### $1\n\n');

  text = text.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');

  text = text.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**');
  text = text.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**');
  text = text.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*');
  text = text.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*');

  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_: string, href: string, content: string) => {
    const cleanContent = content.trim();
    if (!cleanContent || NOISE_LINK_PATTERNS.some(p => p.test(href))) return '';
    return `[${cleanContent}](${href})`;
  });

  text = text.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, (_: string, src: string, alt: string) => {
    return `![${alt}](${makeAbsoluteUrl(src)})`;
  });
  text = text.replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, (_: string, src: string) => {
    return `![](${makeAbsoluteUrl(src)})`;
  });

  text = text.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_: string, content: string) => {
    const lines = content.trim().split('\n');
    return lines.map((l: string) => `> ${l.trim()}`).join('\n') + '\n\n';
  });

  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');
  text = text.replace(/<\/ul>|<\/ol>/gi, '\n');

  text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
  text = text.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '```\n$1\n```\n\n');

  text = text.replace(/<hr\s*\/?>/gi, '\n---\n\n');

  text = text.replace(/<(div|section|article|figure)[^>]*>/gi, '\n');
  text = text.replace(/<\/(div|section|article|figure)>/gi, '\n');
  text = text.replace(/<span[^>]*>/gi, '');
  text = text.replace(/<\/span>/gi, '');
  text = text.replace(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/gi, '\n$1\n');

  text = text.replace(/<[^>]+>/g, '');

  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&#(\d+);/g, (_: string, code: string) => String.fromCharCode(parseInt(code)));

  const lines = text.split('\n');
  const cleanedLines: string[] = [];
  let prevEmpty = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (NOISE_TEXT_PATTERNS.some(p => p.test(trimmed))) continue;

    if (trimmed === '') {
      if (!prevEmpty) {
        cleanedLines.push('');
        prevEmpty = true;
      }
      continue;
    }

    prevEmpty = false;
    cleanedLines.push(trimmed);
  }

  text = cleanedLines.join('\n').trim();

  return text;
}

function makeAbsoluteUrl(src: string): string {
  if (src.startsWith('//')) return 'https:' + src;
  if (src.startsWith('http://') || src.startsWith('https://')) return src;
  return src;
}
