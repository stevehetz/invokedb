function throttle(fn, interval) {
    let last_call, timeout_id;
    return function () {
        const now = Date.now();
        if (last_call && now < last_call + interval) {
            clearTimeout(timeout_id);
            timeout_id = setTimeout(
                () => {
                    last_call = now;
                    fn();
                },
                interval - (now - last_call)
            );
        } else {
            last_call = now;
            fn();
        }
    };
}

/**
 * Marks the nav link of the section scrolled to with `active` (used by the docs and guide pages).
 * A section counts once its top is within `offset` px of the top of the viewport.
 * Returns a function that removes the scroll listener.
 */
export function scroll_spy({ container, links, sections, offset }) {
    const scroller = document.querySelector(container);
    const nav_links = [...document.querySelectorAll(links)];
    // Last section first, so the first match is the one furthest down the page
    const all_sections = [...document.querySelectorAll(sections)].reverse();

    const highlight = () => {
        const section = all_sections.find(
            s => s.getBoundingClientRect().top <= offset
        );
        if (!section) return;
        const link = nav_links.find(
            a => a.getAttribute('href') === `#${section.id}`
        );
        if (!link || link.classList.contains('active')) return;
        nav_links.forEach(a => a.classList.remove('active'));
        link.classList.add('active');
    };

    const on_scroll = throttle(highlight, 100);
    if (scroller) scroller.addEventListener('scroll', on_scroll);
    highlight();
    return () => scroller && scroller.removeEventListener('scroll', on_scroll);
}
