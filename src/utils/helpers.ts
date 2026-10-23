export function generateId(): string {
  // 优先使用加密级 UUID（同毫秒/同随机碰撞概率归零），旧环境回退到时间戳+随机串
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

export function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function isValidURL(string: string): boolean {
  try {
    new URL(string);
    return true;
  } catch {
    return false;
  }
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim();
}

export function generateArticleFileName(template: string, article: { title: string; published: string; author?: string; feedTitle?: string }): string {
  let fileName = template;
  
  const date = new Date(article.published);
  const dateStr = date.toISOString().split('T')[0].replace(/-/g, '');
  
  fileName = fileName.replace('{date}', dateStr);
  fileName = fileName.replace('{title}', sanitizeFileName(article.title));
  fileName = fileName.replace('{author}', sanitizeFileName(article.author || ''));
  fileName = fileName.replace('{source}', sanitizeFileName(article.feedTitle || ''));
  
  if (!fileName.endsWith('.md')) {
    fileName += '.md';
  }
  
  return fileName;
}
