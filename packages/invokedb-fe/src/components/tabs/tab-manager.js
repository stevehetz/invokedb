export const tab_manager = {
    select_tab(tabs, tab) {
        let active_tab_name = null;
        tabs.forEach(t => {
            if (t.id === tab.id) {
                active_tab_name = t.name;
            }
        });
        return active_tab_name;
    },

    create_tab(tabs, active_tab_name, item) {
        let new_item = this.decorate_item(item);
        if (this.tab_exists(tabs, item)) {
            return { tabs, active_tab_name };
        }

        let new_tabs = this.clear_sequence_numbers(tabs);

        new_tabs.push(new_item);
        new_tabs = this.handle_duplicate_names(new_tabs);

        new_item = new_tabs.find(n => new_item.id === n.id);
        active_tab_name = new_item.name;
        return { tabs: new_tabs, active_tab_name, active_tab: new_item };
    },

    update_tab(tabs, tab) {
        if (!this.tab_exists(tabs, tab)) return tabs;

        return tabs.map(t => {
            if (t.id === tab.id) return this.decorate_item(tab);
            else return t;
        });
    },

    decorate_item(item) {
        let new_item = Object.assign({}, item);
        if (new_item.status === 'PENDING') {
            new_item.name = new_item.name.substring() + '.p';
            return new_item;
        } else if (new_item.status === 'ERROR') {
            new_item.name = new_item.name.substring() + '.e';
            return new_item;
        }

        switch (new_item.web_file_type) {
            case 'data-grid':
                new_item.name = new_item.name + '.g';
                break;
            default:
                new_item.name = new_item.name + '';
                break;
        }
        return new_item;
    },

    tab_exists(tabs, item) {
        let exists = false;

        tabs.forEach(tab => {
            if (tab.id === item.id) exists = true;
        });
        return exists;
    },

    remove_tab(tabs, active_tab_name, target_name) {
        let active_tab_removed = false;
        let active_tab = null;
        let old_active_tab_index = -1;

        if (active_tab_name === target_name) {
            active_tab_removed = true;
            old_active_tab_index = tabs.findIndex(
                tab => tab.name === target_name
            );
        } else {
            active_tab = tabs.find(tab => tab.name === active_tab_name);
        }

        tabs = tabs.filter(tab => tab.name !== target_name);

        let new_tabs = this.clear_sequence_numbers(tabs);
        new_tabs = this.handle_duplicate_names(new_tabs);

        let next_tab = null;
        if (active_tab_removed) {
            next_tab =
                new_tabs[old_active_tab_index] ||
                new_tabs[old_active_tab_index - 1];
        } else {
            next_tab = new_tabs.find(tab => tab.id === active_tab.id);
        }

        active_tab_name = next_tab ? next_tab.name : null;

        return { active_tab: next_tab, active_tab_name, tabs: new_tabs };
    },

    handle_duplicate_names(tabs) {
        let new_tabs = [];
        let tab_set, count;

        // Iterate through all tabs
        for (let i = 0; i < tabs.length; i++) {
            tab_set = [];
            count = 0;

            // Tab name has alredy been accounted for (it was added part of a sequence)
            if (new_tabs.filter(t => t.actual_name === tabs[i].name).length > 0)
                continue;

            // Add the current tab to the set
            tab_set.push(Object.assign({}, tabs[i]));

            // Look for duplicates
            for (let j = i + 1; j < tabs.length; j++) {
                if (tabs[i].name === tabs[j].name) {
                    tab_set.push(Object.assign({}, tabs[j]));
                }
            }

            // If there are duplicates, update the name
            if (tab_set.length > 1) {
                for (let k = 0; k < tab_set.length; k++) {
                    tab_set[k].actual_name = tabs[i].name;
                    tab_set[k].name = '(' + (k + 1) + ') ' + tabs[i].name;
                }
            }

            // Add all tabs for this iteration to the new_tabs array
            new_tabs = new_tabs.concat(tab_set);
        }

        return new_tabs;
    },

    clear_sequence_numbers(tabs) {
        let regexp = /\([0-9]+\)/;
        tabs.forEach(tab => {
            if (regexp.test(tab.name)) {
                const part = tab.name.substring(1);
                tab.name = part.substring(part.indexOf(')') + 2);
            }
        });

        return [].concat(tabs);
    }
};
