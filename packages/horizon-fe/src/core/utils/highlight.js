// highlight.js with just the JavaScript language (used by the docs page and the site home page).
// Bundled from npm so the core and the language file are always the same version.
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';

hljs.registerLanguage('javascript', javascript);

export function highlight_code_blocks() {
    /** @type {NodeListOf<HTMLElement>} */ (
        document.querySelectorAll('pre code')
    ).forEach(block => hljs.highlightElement(block));
}
