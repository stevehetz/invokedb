import { Injectable } from '@nestjs/common';
import { MongoDbCollections } from '../mongodb/collections';
import { FormSettings, is_form_id } from './form';

const FORMS = 'tracking:form';

// A shareable form that adds rows to one table (#145)
export interface Form extends FormSettings {
    id: string;
    account_id: number;
    file_id: number;
    created_at: number;
    updated_at: number;
    submissions: number;
    last_submission_at: number | null;
}

// The forms of every account, in one collection of the tracking database, so a public link
// (just the form's id) can be looked up without knowing the account. Every read and write from
// the app filters on account_id as well as the id; only the public lookup (get_public) doesn't.
@Injectable()
export class FormManager {
    private indexed = false;

    constructor(private _collections: MongoDbCollections) {}

    private async collection() {
        const forms = await this._collections.get_shared_tracking_collection(FORMS);
        if (!this.indexed) {
            await forms.createIndex({ id: 1 }, { unique: true });
            await forms.createIndex({ account_id: 1, file_id: 1 });
            this.indexed = true;
        }
        return forms;
    }

    /** The account's forms; with a table id, only that table's. */
    async list(account_id: number, file_id?: number): Promise<Form[]> {
        if (!account_id) return [];
        const forms = await this.collection();
        const filter: any = { account_id };
        if (file_id) filter.file_id = file_id;
        const docs = await forms
            .find(filter, { projection: { _id: 0 } })
            .sort({ created_at: 1 })
            .toArray();
        return docs as unknown as Form[];
    }

    async count(account_id: number) {
        if (!account_id) return 0;
        const forms = await this.collection();
        return await forms.countDocuments({ account_id });
    }

    async get(account_id: number, id: string): Promise<Form | null> {
        if (!account_id || !is_form_id(id)) return null;
        const forms = await this.collection();
        const doc = await forms.findOne({ account_id, id }, { projection: { _id: 0 } });
        return (doc as unknown as Form) || null;
    }

    /** A form by its id alone, for its public link. */
    async get_public(id: string): Promise<Form | null> {
        if (!is_form_id(id)) return null;
        const forms = await this.collection();
        const doc = await forms.findOne({ id }, { projection: { _id: 0 } });
        return (doc as unknown as Form) || null;
    }

    async create(form: Form) {
        const forms = await this.collection();
        await forms.insertOne({ ...form });
        return form;
    }

    async update(account_id: number, id: string, changes: Partial<Form>) {
        if (!account_id || !is_form_id(id)) return null;
        const forms = await this.collection();
        const { account_id: _a, id: _i, file_id: _f, submissions: _s, ...rest } = changes as any;
        await forms.updateOne({ account_id, id }, { $set: { ...rest, updated_at: Date.now() } });
        return await this.get(account_id, id);
    }

    async remove(account_id: number, id: string) {
        if (!account_id || !is_form_id(id)) return;
        const forms = await this.collection();
        await forms.deleteOne({ account_id, id });
    }

    /** Removes the forms of a deleted table, so their links stop working. */
    async remove_for_table(account_id: number, file_id: number) {
        if (!account_id || !file_id) return;
        const forms = await this.collection();
        await forms.deleteMany({ account_id, file_id });
    }

    async submitted(form: Form, at: number) {
        const forms = await this.collection();
        await forms.updateOne(
            { account_id: form.account_id, id: form.id },
            { $inc: { submissions: 1 }, $set: { last_submission_at: at } }
        );
    }
}
