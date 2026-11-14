import $ from 'jquery';

// jqtree (a jQuery plugin) looks up the global `jQuery` when it registers itself, so this must
// be imported before 'jqtree'. webpack's ProvidePlugin used to inject it; app code imports
// 'jquery' explicitly instead.
window.$ = window.jQuery = $;

export default $;
