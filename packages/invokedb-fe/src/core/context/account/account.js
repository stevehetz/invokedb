export default class AccountDto {
    constructor(opts) {
        this.id = opts.id || null;
        this.username = opts.username || null;
        this.first_name = opts.first_name || null;
        this.last_name = opts.last_name || null;
        this.locked = opts.locked || null;
        this.locked_reason = opts.locked_reason || null;
    }
}
