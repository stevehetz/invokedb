import $ from 'jquery';
import { store } from '@/store';

let $navigationLinks;
let $sections;
let sectionIdTonavigationLink;

function throttle(fn, interval) {
    let lastCall, timeoutId;
    return function () {
        let now = new Date().getTime();
        if (lastCall && now < lastCall + interval) {
            // if we are inside the interval we wait
            clearTimeout(timeoutId);
            timeoutId = setTimeout(
                function () {
                    lastCall = now;
                    fn.call();
                },
                interval - (now - lastCall)
            );
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
    $sections.each(function () {
        let currentSection = $(this);
        // get the position of the section
        let sectionTop = currentSection.offset().top;

        // if the user has scrolled over the top of the section
        if (scrollPosition >= sectionTop - 150) {
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
    name: 'Guide',

    data() {
        return {
            base_url: null,
            account: null,
            env: {}
        };
    },

    mounted() {
        window.addEventListener('popstate', this.go_to_hash);
        this.account = store.get('account');
        this.env = store.get('env');
        this.$nextTick(() => {
            this.go_to_hash();

            // cache the navigation links
            $navigationLinks = $('.guide-nav > a');

            // cache (in reversed order) the sections
            $sections = $($('.guide-section-title').get().reverse());

            // map each section id to their corresponding navigation link
            sectionIdTonavigationLink = {};
            $sections.each(function () {
                let id = $(this).attr('id');
                sectionIdTonavigationLink[id] = $(
                    '.guide-nav > a[href=\\#' + id + ']'
                );
            });

            $('.guide-page').scroll(throttle(highlightNavigation, 100));
            highlightNavigation();
        });
        store.subscribe('env', env => {
            this.base_url = `${env.HORIZON_BE_PUB_HTTP_URL}/api`;
        });
    },

    beforeDestroy() {
        $('.guide-page').off('scroll', throttle(highlightNavigation, 100));
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
        }
    }
};
