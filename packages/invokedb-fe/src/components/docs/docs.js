import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';

hljs.registerLanguage('javascript', javascript);
import * as samples from './code-samples';
import { store } from '@/store';

let $navigationLinks;
let $sections;
let sectionIdTonavigationLink;

function throttle(fn, interval) {
    let lastCall, timeoutId;
    return function() {
        let now = new Date().getTime();
        if (lastCall && now < lastCall + interval) {
            // if we are inside the interval we wait
            clearTimeout(timeoutId);
            timeoutId = setTimeout(function() {
                lastCall = now;
                fn.call();
            }, interval - (now - lastCall));
        } else {
            // otherwise, we directly call the function
            lastCall = now;
            fn.call();
        }
    };
}

function highlightNavigation() {
    // get the current vertical position of the scroll bar
    let scrollPosition = $(window).scrollTop();

    // iterate the sections
    $sections.each(function() {
        let currentSection = $(this);
        // get the position of the section
        let sectionTop = currentSection.offset().top;

        // if the user has scrolled over the top of the section
        if (scrollPosition >= sectionTop - 180) {
            // get the section id
            let id = currentSection.attr('id');
            // get the corresponding navigation link
            let $navigationLink = sectionIdTonavigationLink[id];
            // if the link is not active
            if (!$navigationLink.hasClass('active')) {
                // remove .active class from all the links
                $navigationLinks.removeClass('active');
                // add .active class to the current link
                $navigationLink.addClass('active');
            }
            // we have found our section, so we return false to exit the each loop
            return false;
        }
    });
}

export default {
    name: 'Doc',

    data() {
        return {
            base_url: null,
            account: null,
            code: {
                get_paging: samples.get_paging,
                get_sorting: samples.get_sorting,
                search_text_contains: samples.search_text_contains,
                search_text_exact: samples.search_text_exact,
                search_number: samples.search_number,
                search_date: samples.search_date,
                search_one_column_and: samples.search_one_column_and,
                search_one_column_or: samples.search_one_column_or,
                search_two_columns_and: samples.search_two_columns_and,
                search_two_columns_or: samples.search_two_columns_or,
                search_group: samples.search_group,
                create: samples.create,
                update: samples.update,
                remove: samples.remove
            }
        };
    },

    mounted() {
        window.addEventListener('popstate', this.go_to_hash);
        this.account = store.get('account');
        this.$nextTick(() => {
            this.go_to_hash();

            // cache the navigation links
            $navigationLinks = $('.docs-nav > a');
            // cache (in reversed order) the sections
            $sections = $(
                $('.overview-title')
                    .get()
                    .reverse()
            );

            // map each section id to their corresponding navigation link
            sectionIdTonavigationLink = {};
            $sections.each(function() {
                let id = $(this).attr('id');
                sectionIdTonavigationLink[id] = $(
                    '.docs-nav > a[href=\\#' + id + ']'
                );
            });

            $('.docs-page').scroll(throttle(highlightNavigation, 100));
            highlightNavigation();
        });
        store.subscribe('env', env => {
            this.base_url = `${env.HORIZON_BE_PUB_HTTP_URL}/api`
                .replace(':443', '')
                .replace('be.', 'api.');
            this.base_url += '/v1';
        });
        this.highlight();
    },

    beforeDestroy() {
        $('.docs-page').off('scroll', throttle(highlightNavigation, 100));
        window.removeEventListener('popstate', this.go_to_hash);
    },

    methods: {
        go_to_hash() {
            const { hash } = window.location;
            if (hash && hash.length > 1) {
                const element = document.querySelector(hash);
                if (element) {
                    element.scrollIntoView();
                }
            }
        },

        highlight() {
            document.querySelectorAll('pre code').forEach(block => {
                hljs.highlightBlock(block);
            });
        }
    }
};
