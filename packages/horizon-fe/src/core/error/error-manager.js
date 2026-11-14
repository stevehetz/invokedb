export const error_manager = {
    rule_msgs: (prop, rules) => {
        if (!prop) throw new Error('Must provide a property');

        if (!rules) return null;

        const filtered = rules.filter(r => r.property === prop);

        const rule = filtered[0];

        if (!rule || !rule.constraints) return null;

        return Object.keys(rule.constraints).map(key => rule.constraints[key]);
    },

    first_rule_msg: (prop, rules) => {
        if (!prop) throw new Error('Must provide a property');

        if (!rules) return null;

        return rules
            .filter(r => {
                return r.property === prop;
            })
            .reduce((a, c) => {
                let value = null;
                Object.keys(c.constraints).forEach(key => {
                    if (!value) value = c.constraints[key];
                });
                return value;
            }, '');
    },

    last_rule_msg: (prop, rules) => {
        if (!prop) throw new Error('Must provide a property');

        if (!rules) return null;

        return rules
            .filter(r => {
                return r.property === prop;
            })
            .reduce((a, c) => {
                let value = null;
                Object.keys(c.constraints).forEach(
                    key => (value = c.constraints[key])
                );
                return value;
            }, '');
    }
};
