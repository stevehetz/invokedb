import { store } from '@/store';
import { http } from '@/core/http';
import { web_file_http } from '@/core/context/web-file/web-file-http';
import { TreeItemVo } from './tree-item-vo';
import { FileDirectory } from '@/core/context/file-directory/file-directory';

export const tree_manager = {
    async validate_file_directory(data) {
        const url = http.get_url(`/file-directory/validate`);
        return await http.post(
            url,
            Object.assign(data, {
                name: data.new_name
            })
        );
    },

    async get_tree() {
        const account = store.get('account');
        const url = http.get_url(`/file-directory?account_id=${account.id}`);
        const res = await http.get(url);
        const file_directory = res.map(f => new FileDirectory(f));
        return this.build_tree(file_directory);
    },

    async remove_items(tree_itemIds) {
        const url = http.get_url(`/file-directory/batch_delete`);
        return await http.post(url, { ids: tree_itemIds });
    },

    async add_item(data) {
        const url = http.get_url(`/file-directory`);
        return await http.post(
            url,
            new FileDirectory({
                account_id: store.get('account').id,
                name: data.name,
                type: data.type === 'dir' ? 'dir' : 'file',
                web_file_type: data.type === 'dir' ? null : data.type,
                parent_id: data.parent_id,
                status: data.status,
                status_reason: data.status_reason
            })
        );
    },

    async update_item(tree_item) {
        let account = store.get('account');
        tree_item.account_id = account.id;
        const url = http.get_url(`/file-directory/${tree_item.id}`);
        return await http.put(url, new FileDirectory(tree_item));
    },

    file_upload(type, file_ctx) {
        return web_file_http.file_upload(type, file_ctx);
    },

    build_tree(file_directory) {
        return file_directory
            .filter(item => item.parent_id === null)
            .map(function get_item_content(file_dir_item) {
                let tree_item = new TreeItemVo(file_dir_item);
                tree_item.children =
                    file_dir_item.type === 'dir'
                        ? file_directory
                              .filter(i => file_dir_item.id === i.parent_id)
                              .map(get_item_content)
                        : null;
                return tree_item;
            });
    },

    set_duplicate_opened_file_seq(tree_items, tabs) {
        tree_items.forEach(function set_dup(tree_item) {
            let regexp = /\([0-9]+\)/;
            let tab = tabs.find(tab => tree_item.id === tab.id);
            if (tab && regexp.test(tab.name)) {
                let part = tab.name.substring(1);
                tree_item.dup_opened_seq = part.substring(0, part.indexOf(')'));
            } else {
                tree_item.dup_opened_seq = null;
            }
            if (tree_item.children) tree_item.children.forEach(set_dup);
        });

        return tree_items;
    }
};
