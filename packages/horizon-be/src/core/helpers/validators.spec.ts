import { validate_email, validate_password, validate_file_dir_name } from './validators';

describe('validate_email', () => {
    it.each(['a@b.co', 'demo2@invokedb.com', 'First.Last+tag@sub.example.org'])('accepts %s', e =>
        expect(validate_email(e)).toBe(true)
    );

    it.each(['', 'plain', 'a@b', '@b.co', 'a b@c.co', 'a@b.c'])('rejects "%s"', e =>
        expect(validate_email(e)).toBe(false)
    );
});

describe('validate_password', () => {
    it('accepts 8+ characters with lower, upper, digit and symbol', () => {
        expect(validate_password('Abcdef1!')).toBe(true);
    });

    it.each([
        ['too short', 'Abcde1!'],
        ['no upper case', 'abcdef1!'],
        ['no lower case', 'ABCDEF1!'],
        ['no digit', 'Abcdefg!'],
        ['no symbol', 'Abcdefg1']
    ])('rejects a password with %s', (_why, p) => expect(validate_password(p)).toBe(false));
});

describe('validate_file_dir_name', () => {
    it.each(['people', 'Sales_2026', 'a-b_c'])('accepts %s', n =>
        expect(validate_file_dir_name(n)).toBe(true)
    );

    it.each(['', 'has space', 'dot.name', 'slash/name', '$where'])('rejects "%s"', n =>
        expect(validate_file_dir_name(n)).toBe(false)
    );
});
