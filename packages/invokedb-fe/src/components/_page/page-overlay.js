export let toggle_page_overlay = (path) => {
	if (path === '/') {
		$('.page-overlay').addClass('hidden');
	} else {
		$('.page-overlay').removeClass('hidden');
	}
};
