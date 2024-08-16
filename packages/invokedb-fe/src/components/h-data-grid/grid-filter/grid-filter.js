import { defineComponent, ref, onMounted } from 'vue';
import moment from 'moment';

const stringFilterTypes = {
	equals: '=',
	contains: '≈',
};

const numberFilterTypes = {
	equals: '=',
	lessThan: '<',
	lessThanOrEqual: '<=',
	greaterThan: '>',
	greaterThanOrEqual: '>=',
};

export default defineComponent({
	name: 'MyFilterComponent',
	props: {
		params: {
			type: Object,
			required: true,
		},
	},
	setup(props) {
		const inputValue = ref(null);
		const colType = ref(null);
		const filterTypes = ref({});
		const selectedType = ref(null);
		const timeout = ref(null);
		const loading = ref(null);

		const valueChanged = (event) => {
			inputValue.value = event.target.value;
			const debounceTime = colType.value === 'date' ? 1000 : 500;
			loading.value = true;
			clearTimeout(timeout.value);
			timeout.value = setTimeout(() => {
				inputValue.value = formatValue(event.target.value);
				updateFilter();
				loading.value = false;
			}, debounceTime);
		};

		const formatValue = (value) => {
			if (typeof value === 'string') {
				value = value.trim();
			}
			if (value !== '' && value !== undefined && value !== null) {
				if (colType.value === 'date') {
					value = moment.utc(value).format('YYYY-MM-DD hh:mm:ss A');
					if (value === 'Invalid date') {
						value = null;
					}
				}
			}
			return value;
		};

		const updateFilter = () => {
			let value = inputValue.value;
			try {
				if (value === '' || value === undefined || value === null) {
					value = inputValue.value = null;
				} else {
					value = JSON.stringify({
						col_type: props.params.column.colDef.col_type,
						filter_type: selectedType.value,
						filter_value: value,
					});
				}
				props.params.parentFilterInstance((instance) => {
					instance.onFloatingFilterChanged(null, value);
				});
			} catch (ex) {
				console.log(ex);
			}
		};

		const changeType = (value) => {
			selectedType.value = value;
			if (
				inputValue.value !== undefined &&
				inputValue.value !== null &&
				inputValue.value !== ''
			) {
				updateFilter();
			}
		};

		const filterTypeMenuHandlers = () => {
			let menuTimeout;
			const { menuToggle, menu } = this.$refs;

			const onMenuToggleClick = () => {
				menu.classList.add('show');
			};

			const onMenuToggleEnter = () => {
				clearTimeout(menuTimeout);
			};

			const onMenuToggleLeave = () => {
				menuTimeout = setTimeout(() => {
					menu.classList.remove('show');
				}, 500);
			};

			const onMenuMouseEnter = () => {
				clearTimeout(menuTimeout);
			};

			const onMenuMouseLeave = () => {
				menuTimeout = setTimeout(() => {
					menu.classList.remove('show');
				}, 500);
			};

			const onMenuMouseClick = () => {
				clearTimeout(menuTimeout);
				menu.classList.remove('show');
			};

			menuToggle.addEventListener('click', onMenuToggleClick);
			menuToggle.addEventListener('mouseenter', onMenuToggleEnter);
			menuToggle.addEventListener('mouseleave', onMenuToggleLeave);
			menu.addEventListener('mouseenter', onMenuMouseEnter);
			menu.addEventListener('mouseleave', onMenuMouseLeave);
			menu.addEventListener('click', onMenuMouseClick);
		};

		onMounted(() => {
			filterTypeMenuHandlers();
			colType.value = props.params.column.colDef.col_type;
			if (colType.value === 'number' || colType.value === 'date') {
				filterTypes.value = numberFilterTypes;
				selectedType.value = 'equals';
			} else {
				filterTypes.value = stringFilterTypes;
				selectedType.value = 'contains';
			}
		});

		return {
			inputValue,
			colType,
			filterTypes,
			selectedType,
			loading,
			valueChanged,
			changeType,
		};
	},
});
