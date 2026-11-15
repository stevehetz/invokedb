export let toggle_page_overlay = path => {
    const hidden = path === '/app' || path === '/app/';
    document
        .querySelectorAll('.page-overlay')
        .forEach(el => el.classList.toggle('hidden', hidden));
};
