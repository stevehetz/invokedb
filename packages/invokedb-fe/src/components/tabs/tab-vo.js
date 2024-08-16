export class TabVo {
    constructor(opts) {
        this.id = opts.id || null;
        this.name = opts.name || null;
        this.actual_name = opts.actual_name || null;
        this.parent_id = opts.parent_id || null;
        this.type = opts.type || null;
        this.web_file_type = opts.web_file_type || null;
        this.locked = opts.locked || null;
        this.locked_reason = opts.locked_reason || null;
        this.status = opts.status || null;
        this.status_reason = opts.status_reason || null;
    }
}
