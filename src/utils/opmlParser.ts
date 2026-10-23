export interface OPMLFeed {
  title: string;
  url: string;
  category?: string;
}

export function parseOPML(opmlContent: string): OPMLFeed[] {
  const feeds: OPMLFeed[] = [];

  const parser = new DOMParser();
  const doc = parser.parseFromString(opmlContent, 'text/xml');

  const body = doc.querySelector('body');
  if (!body) {
    return feeds;
  }

  parseOutline(body, feeds, undefined);

  return feeds;
}

function parseOutline(parent: Element, feeds: OPMLFeed[], category: string | undefined): void {
  const outlines = parent.querySelectorAll(':scope > outline');

  outlines.forEach(outline => {
    const xmlUrl = outline.getAttribute('xmlUrl') || outline.getAttribute('xmlurl');

    if (xmlUrl) {
      const title = outline.getAttribute('title') || outline.getAttribute('text') || xmlUrl;
      feeds.push({
        title,
        url: xmlUrl,
        category,
      });
    } else {
      const newCategory = outline.getAttribute('title') || outline.getAttribute('text') || category;
      parseOutline(outline, feeds, newCategory);
    }
  });
}
