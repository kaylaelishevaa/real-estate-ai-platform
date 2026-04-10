import { Transform } from 'class-transformer';
import sanitizeHtml from 'sanitize-html';

/**
 * Allowed HTML configuration for user-generated content fields.
 * Permits basic formatting/structure used in the CMS rich-text editor
 * but strips scripts, event handlers, and dangerous attributes.
 */
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    // Structure
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'div', 'span',
    // Lists
    'ul', 'ol', 'li',
    // Formatting
    'b', 'i', 'u', 'strong', 'em', 'small', 'sub', 'sup', 'mark',
    // Links & media
    'a', 'img', 'figure', 'figcaption',
    // Tables
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    // Block
    'blockquote', 'pre', 'code',
    // Iframe (for embedded videos — restricted to allowed hosts below)
    'iframe',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
    iframe: ['src', 'width', 'height', 'frameborder', 'allow', 'allowfullscreen'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan'],
    '*': ['class', 'style'],
  },
  allowedIframeHostnames: ['www.youtube.com', 'youtube.com', 'player.vimeo.com'],
  // Strip all JS event handlers (onclick, onerror, etc.)
  allowedSchemes: ['http', 'https', 'mailto'],
};

/**
 * Property decorator that sanitizes HTML strings during DTO transformation.
 * Apply to any string field that may contain user-provided HTML content.
 *
 * Usage: `@SanitizeHtml() content?: string;`
 */
export function SanitizeHtml(): PropertyDecorator {
  return Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    return sanitizeHtml(value, SANITIZE_OPTIONS);
  });
}
