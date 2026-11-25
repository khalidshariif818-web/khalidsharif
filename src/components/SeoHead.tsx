import React, { useEffect } from 'react';

interface SeoHeadProps {
  title: string;
  description: string;
  noIndex?: boolean;
  canonicalPath?: string;
  imagePath?: string;
  jsonLd?: Record<string, unknown>;
}

export const SeoHead: React.FC<SeoHeadProps> = ({
  title,
  description,
  noIndex = false,
  canonicalPath,
  imagePath,
  jsonLd,
}) => {
  useEffect(() => {
    document.title = title;

    const setMeta = (selector: string, attr: 'name' | 'property', key: string, content: string) => {
      let el = document.querySelector<HTMLMetaElement>(selector);
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, key);
        document.head.appendChild(el);
      }
      el.content = content;
    };

    const resolvedImage = imagePath
      ? imagePath.startsWith('http')
        ? imagePath
        : `${window.location.origin}${imagePath}`
      : `${window.location.origin}/og-cover.jpg`;

    setMeta('meta[name="description"]', 'name', 'description', description);
    setMeta('meta[property="og:title"]', 'property', 'og:title', title);
    setMeta('meta[property="og:description"]', 'property', 'og:description', description);
    setMeta('meta[property="og:image"]', 'property', 'og:image', resolvedImage);
    setMeta('meta[name="twitter:title"]', 'name', 'twitter:title', title);
    setMeta('meta[name="twitter:description"]', 'name', 'twitter:description', description);
    setMeta('meta[name="twitter:image"]', 'name', 'twitter:image', resolvedImage);
    setMeta('meta[name="robots"]', 'name', 'robots', noIndex ? 'noindex, nofollow' : 'index, follow');

    const canonicalHref = canonicalPath
      ? `${window.location.origin}${canonicalPath}`
      : `${window.location.origin}${window.location.pathname}`;
    let link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'canonical';
      document.head.appendChild(link);
    }
    link.href = canonicalHref;

    const scriptId = 'ksdl-dynamic-jsonld';
    const existingScript = document.getElementById(scriptId);
    if (jsonLd) {
      const script = existingScript || document.createElement('script');
      script.id = scriptId;
      script.setAttribute('type', 'application/ld+json');
      script.textContent = JSON.stringify(jsonLd);
      if (!existingScript) {
        document.head.appendChild(script);
      }
    } else if (existingScript) {
      existingScript.remove();
    }
  }, [title, description, noIndex, canonicalPath, jsonLd]);

  return null;
};
