import {
    ValidatorConstraint,
    ValidatorConstraintInterface,
    ValidationArguments
} from 'class-validator';
import { validate_file_dir_name, validate_file_dir_msg } from '@app/core/helpers/validators';

@ValidatorConstraint({ name: 'fileDirName', async: false })
export class FileDirNameValidator implements ValidatorConstraintInterface {
    validate(text: string, args: ValidationArguments) {
        return validate_file_dir_name(text);
    }

    defaultMessage(args: ValidationArguments) {
        return validate_file_dir_msg();
    }
}
