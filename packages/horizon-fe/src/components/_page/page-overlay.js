import $ from 'jquery';
export let toggle_page_overlay = path => {
    if (path === '/app' || path === '/app/')
        $('.page-overlay').addClass('hidden');
    else $('.page-overlay').removeClass('hidden');
};
