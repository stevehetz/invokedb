import { web_file_http } from '@/core/context/web-file/web-file-http';
import * as moment from 'moment';

export const data_grid_manager = {
	/*** Start: Row data ***/
	async get_new_column(id) {
		return await web_file_http.get_new_column(id);
	},

	async get_rows(id, params, page_size) {
		let page_params = {};
		page_params.skip = params.startRow;
		page_params.limit = page_size;

		if (params.sortModel && params.sortModel.length > 0) {
			page_params.sort_by = params.sortModel[0].colId;
			page_params.sort_dir = params.sortModel[0].sort;
			page_params.sort_by = this.sanitize_column_key(page_params.sort_by);
		}

		if (params.filterModel)
			Object.keys(params.filterModel).forEach((k) => {
				page_params.filters = page_params.filters || {};
				const new_k = this.sanitize_column_key(k);
				if (new_k === 'row_num') {
					page_params.filters[new_k] = {
						value: params.filterModel[k].filter,
						type: 'equals',
					};
				} else {
					page_params.filters[new_k] = this.parse_filter(params.filterModel[k].filter);
				}
			});
		return await web_file_http.get_by_id(id, 'data_grid_row', page_params);
	},

	sanitize_column_key(k) {
		if (k.startsWith('row_num')) {
			return 'row_num';
		} else {
			const index = k.indexOf('_');
			if (index > -1) {
				k = k.substring(0, index);
				return k;
			}
		}
		return k;
	},

	parse_filter(filter) {
		let value, type, col_type;
		try {
			filter = JSON.parse(filter);
			type = filter.filter_type;
			col_type = filter.col_type;
			if (col_type === 'number') {
				value = parseFloat(filter.filter_value);
			} else if (col_type === 'date') {
				value = moment.utc(filter.filter_value).toDate();
			} else {
				value = filter.filter_value;
			}
		} catch (ex) {
			console.log(ex);
		}

		return { value, type, col_type };
	},

	async save_rows(file_directory_id, data) {
		data.forEach((n) => delete n.new_row_index);
		return await web_file_http.batch_create('data_grid_row', file_directory_id, data);
	},

	async update_row(file_directory_id, data) {
		return await web_file_http.update('data_grid_row', file_directory_id, {
			web_doc_record: data,
		});
	},

	async remove_rows(file_directory_id, ids) {
		return await web_file_http.batch_delete('data_grid_row', file_directory_id, { ids });
	},
	/*** End: Row data ***/

	/*** Start: Column data ***/
	async get_columns(file_directory_id, grid_options, row_index_column) {
		const { data, count } = await web_file_http.get_by_id(
			file_directory_id,
			'data_grid_column',
		);

		if (count === 0) {
			return;
		}

		data.forEach((d) => {
			d.suppressMenu = true;
			d.filterParams = {
				caseSensitive: true,
			};
			d.floatingFilterComponent = 'agColumnFilter';
		});

		let columns = [row_index_column].concat(data);

		grid_options.api.setColumnDefs(_.sortBy(columns, 'order'));
	},

	async save_columns(file_directory_id, orig_col_defs, new_col_defs, del_col_defs) {
		if (del_col_defs && del_col_defs.length > 0) {
			await this.delete_columns(file_directory_id, {
				ids: del_col_defs.map((c) => c._id),
			});
		}

		const edit_defs = new_col_defs.filter((c) => !!c._id);
		if (edit_defs.length > 0) {
			let use_job = false;
			if (
				this.has_index_change(orig_col_defs, new_col_defs) ||
				this.has_col_type_change(orig_col_defs, new_col_defs)
			) {
				use_job = true;
			}
			const res = await this.update_columns(
				file_directory_id,
				use_job,
				edit_defs.map((col_def) => ({
					_id: col_def._id,
					col_index: col_def.col_index,
					file_directory_id: col_def.file_directory_id,
					headerName: col_def.headerName,
					field: col_def.field,
					width: col_def.width,
					order: col_def.order,
					col_type: col_def.col_type,
					deleted: false,
					indexed: col_def.indexed,
				})),
			);
			return res;
		} else {
			return 'done';
		}
	},

	has_index_change(orig_col_defs, new_col_defs) {
		const res = new_col_defs.filter((new_def) => {
			return orig_col_defs.find(
				(orig_def) =>
					orig_def.headerName === new_def.headerName &&
					orig_def.indexed !== new_def.indexed,
			);
		});

		return res.length > 0;
	},

	has_col_type_change(orig_col_defs, new_col_defs) {
		orig_col_defs.forEach((orig_def) => (orig_def.col_type = orig_def.col_type || 'string'));
		new_col_defs.forEach((orig_def) => (orig_def.col_type = orig_def.col_type || 'string'));
		const res = new_col_defs.filter((new_def) => {
			return orig_col_defs.find(
				(orig_def) =>
					orig_def.headerName === new_def.headerName &&
					orig_def.col_type !== new_def.col_type,
			);
		});

		return res.length > 0;
	},

	async update_columns(file_directory_id, use_job, data) {
		return await web_file_http.batch_update(
			'data_grid_column',
			file_directory_id,
			use_job,
			data,
		);
	},

	async delete_columns(file_directory_id, data) {
		await web_file_http.batch_delete('data_grid_column', file_directory_id, data);
	},
	/*** End: Column data ***/

	/*** Start: Add mode helpers ***/
	get_add_row_mode_params(total_rows, row_count) {
		let params = {};
		let skip = total_rows - row_count;
		params.startRow = skip > 0 ? skip : 0;
		params.endRow = row_count;
		return params;
	},

	add_new_row(current_rows, new_rows, total_rows, file_directory_id) {
		let new_row = {};
		let l = new_rows.length;
		let prev_index = l > 0 ? new_rows[l - 1].new_row_index : -1;
		new_row['new_row_index'] = prev_index + 1;
		new_row['file_directory_id'] = file_directory_id;
		new_rows.push(new_row);
		let all_rows = current_rows.concat(new_rows);
		return this.number_new_rows(all_rows, total_rows);
	},

	number_new_rows(rows, total_rows) {
		let i = total_rows;
		rows.forEach((r) => {
			if (r.new_row_index >= 0) r.row_num = ++i;
		});
		return rows;
	},
	/*** End: Add mode helpers ***/
};
