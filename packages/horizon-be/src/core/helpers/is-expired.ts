/** True when an `expired_datetime` column (sessions, reset tokens) is in the past. */
export function is_expired(expired_datetime: Date) {
    return !!expired_datetime && new Date(expired_datetime).getTime() < Date.now();
}
