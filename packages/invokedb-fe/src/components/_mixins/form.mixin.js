export const form_mixin = {
	data: function () {
		return {
			$_form: {
				// The form element reference
				name: `${this.$options.name}_name`,
				el: null,
				editing: false,
				on_save: null,
				old_data: {},
				data: {},
				rules: {},
			},
		};
	},

	mounted() {
		this.$data.$_form.el = this.$refs[this.$data.$_form.name];
	},

	methods: {
		$_form_set(data) {
			this.$data.$_form.data = Object.assign({}, data);
		},

		$_form_get_data() {
			return this.$data.$_form.data;
		},

		$_form_edit() {
			this.$data.$_form.old_data = Object.assign({}, this.$data.$_form.data);
			this.$data.$_form.editing = true;
		},

		$_form_cancel() {
			this.$data.$_form.el.clearValidate();
			this.$data.$_form.data = Object.assign({}, this.$data.$_form.old_data);
			this.$data.$_form.editing = false;
		},

		$_form_clear() {
			this.$data.$_form.data = {};
		},

		async $_form_validate_response(ex_rules) {
			const { el } = this.$data.$_form;
			this.$_form_build_rules_array(ex_rules);
			window.setTimeout(() => el.validate((valid) => false), 0);
		},

		$_form_build_rules_array(ex_rules) {
			this.$data.$_form.rules = {};
			ex_rules.forEach(({ property, constraints }) => {
				this.$data.$_form.rules[property] = [];
				Object.keys(constraints).forEach((conKey) => {
					this.$data.$_form.rules[property].push({
						validator: (r, v, c) => c(new Error(constraints[conKey])),
					});
				});
			});
		},

		async $_form_save() {
			this.$data.$_form.el.clearValidate();
			if (this.on_save) {
				try {
					this.$data.$_form.editing = false;
					await this.on_save(this.$data.$_form.data);
				} catch (ex) {
					if (ex.status === 400) {
						if (ex.rules) {
							this.$_form_validate_response(ex.rules);
						} else {
							bus.emit('notify:error', ex.message || 'Error submitting form');
						}
					} else {
						bus.emit('notify:error', 'Error submitting form');
					}
					this.$data.$_form.editing = true;
				}
			} else {
				throw new Error('on_save not implemented');
			}
		},
	},
};
