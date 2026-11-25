export function validate_email(email) {
    const re =
        /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return re.test(String(email).toLowerCase());
}

export function validate_password(password) {
    // Any character that isn't an ASCII letter or digit counts as the special character.
    const re = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9])(?=.{8,})/s;
    return typeof password === 'string' && re.test(password);
}

export function validate_file_dir_name(value) {
    const regex = new RegExp('^[A-Za-z0-9_\\-]+$');
    return regex.test(value);
}

export function validate_file_dir_msg() {
    return 'Name of file must be: Alphanumeric, -, _';
}
